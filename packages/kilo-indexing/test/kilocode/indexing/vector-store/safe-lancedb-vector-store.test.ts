import { describe, expect, test } from "bun:test"
import { randomUUID } from "crypto"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { EmbeddingRuntimeStore } from "../../../../src/indexing/embedding-runtime-store"
import type { EmbeddingRuntimeProfile } from "../../../../src/indexing/interfaces/embedder"
import type {
  IVectorStore,
  PointStruct,
  VectorStoreSearchResult,
} from "../../../../src/indexing/interfaces/vector-store"
import {
  loadActiveEmbeddingProfile,
  SafeLanceDBVectorStore,
} from "../../../../src/indexing/vector-store/safe-lancedb-vector-store"

function vector(seed: number, dimension = 64): number[] {
  return Array.from({ length: dimension }, (_, index) => Math.cos((index + 1) * seed) + seed * 0.013 + 0.021)
}

function profile(fingerprintDigest: string): EmbeddingRuntimeProfile {
  return {
    provider: "openai-compatible",
    modelId: "qwen3-embedding-8b",
    dimensionMode: "auto",
    dimension: 64,
    endpointDigest: "endpoint",
    fingerprint: Array.from({ length: 6 }, (_, index) => vector(index + 1)),
    fingerprintDigest,
    qualityVersion: "qwen3-dense-v1",
    instructionVersion: "qwen3-retrieval-v1",
  }
}

function point(file: string, seed: number): PointStruct {
  return {
    id: randomUUID(),
    vector: vector(seed),
    payload: {
      workspaceId: "workspace",
      normalizedRoot: "/workspace",
      filePath: file,
      fileHash: `hash-${seed}`,
      chunkHash: `chunk-${seed}`,
      chunkRange: "1:3",
      runId: "run",
      generation: `generation-${seed}`,
      checkpointMetaHash: "checkpoint",
      active: false,
      codeChunk: `int value_${seed}(void) { return ${seed}; }`,
      startLine: 1,
      endLine: 3,
      segmentHash: `segment-${seed}`,
    },
  }
}

class MemoryStore implements IVectorStore {
  readonly points = new Map<string, PointStruct>()
  complete = false

  openExisting(): Promise<void> {
    if (!this.complete) return Promise.reject(new Error("incomplete"))
    return Promise.resolve()
  }

  initialize(): Promise<boolean> {
    return Promise.resolve(this.points.size === 0)
  }

  upsertPoints(points: PointStruct[]): Promise<void> {
    for (const item of points) this.points.set(String(item.id), structuredClone(item))
    return Promise.resolve()
  }

  search(vector: number[], prefix?: string, _score?: number, max = 50): Promise<VectorStoreSearchResult[]> {
    const results = [...this.points.values()]
      .filter((item) => item.payload.active === true)
      .filter((item) => !prefix || String(item.payload.filePath).startsWith(prefix))
      .map((item) => ({
        id: item.id,
        score: item.vector.every((value, index) => value === vector[index]) ? 1 : 0.5,
        payload: item.payload,
      }))
      .slice(0, max)
    return Promise.resolve(results)
  }

  deletePointsByFilePath(file: string): Promise<void> {
    return this.deletePointsByMultipleFilePaths([file])
  }

  deletePointsByMultipleFilePaths(files: string[]): Promise<void> {
    for (const [id, item] of this.points) if (files.includes(item.payload.filePath)) this.points.delete(id)
    return Promise.resolve()
  }

  activateFileGeneration(file: string, generation: string, run: string): Promise<void> {
    for (const item of this.points.values()) {
      if (item.payload.filePath !== file) continue
      item.payload.active = item.payload.generation === generation && item.payload.runId === run
    }
    return Promise.resolve()
  }

  deleteInactiveFilePoints(file: string, generation: string): Promise<void> {
    for (const [id, item] of this.points) {
      if (item.payload.filePath === file && item.payload.generation !== generation) this.points.delete(id)
    }
    return Promise.resolve()
  }

  clearCollection(): Promise<void> {
    this.points.clear()
    return Promise.resolve()
  }

  deleteCollection(): Promise<void> {
    return this.clearCollection()
  }

  collectionExists(): Promise<boolean> {
    return Promise.resolve(true)
  }

  hasIndexedData(): Promise<boolean> {
    return Promise.resolve(this.complete && this.points.size > 0)
  }

  markIndexingComplete(): Promise<void> {
    this.complete = true
    return Promise.resolve()
  }

  markIndexingIncomplete(): Promise<void> {
    return Promise.resolve()
  }
}

describe("SafeLanceDBVectorStore", () => {
  test("promotes a validated candidate atomically and reopens it as active", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const stores = new Map<string, MemoryStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    const store = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
    const item = point("src/a.c", 1)

    try {
      expect(await store.initialize()).toBe(true)
      await store.markIndexingIncomplete()
      await store.upsertPoints([item])
      await store.activateFileGeneration?.("src/a.c", "generation-1", "run")
      await store.markIndexingComplete()
      expect((await store.search(item.vector, "src/a.c", 0, 5))[0]?.id).toBe(item.id)
      await store.close()

      const reopened = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
      expect(await reopened.initialize()).toBe(false)
      expect(await reopened.hasIndexedData()).toBe(true)
      expect((await reopened.search(item.vector, "src/a.c", 0, 5))[0]?.id).toBe(item.id)
      await reopened.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects a bad candidate without changing the last-known-good active generation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const stores = new Map<string, MemoryStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    const good = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
    const item = point("src/good.c", 2)

    try {
      await good.initialize()
      await good.markIndexingIncomplete()
      await good.upsertPoints([item])
      await good.activateFileGeneration?.("src/good.c", "generation-2", "run")
      await good.markIndexingComplete()
      await good.close()

      const candidate = new SafeLanceDBVectorStore(workspace, root, profile("space-b"), runtime, make)
      expect(await candidate.initialize()).toBe(true)
      await expect(
        candidate.upsertPoints([{ ...point("src/bad.c", 3), vector: [...vector(3, 54), ...new Array(10).fill(0)] }]),
      ).rejects.toThrow("zero values")
      await candidate.abortCandidate?.()
      await candidate.close()

      const reopened = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
      expect(await reopened.initialize()).toBe(false)
      expect((await reopened.search(item.vector, "src/good.c", 0, 5))[0]?.id).toBe(item.id)
      await reopened.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("isolates worktree and document resets from the active generation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const stores = new Map<string, MemoryStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    const store = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
    const active = point("src/active.c", 4)

    try {
      await store.initialize()
      await store.markIndexingIncomplete()
      await store.upsertPoints([active])
      await store.activateFileGeneration?.("src/active.c", "generation-4", "run")
      await store.markIndexingComplete()

      await store.clearCollection()
      expect((await store.search(active.vector, "src/active.c", 0, 5))[0]?.id).toBe(active.id)
      await expect(
        store.upsertPoints([{ ...point("src/bad.c", 5), vector: [...vector(5, 54), ...new Array(10).fill(0)] }]),
      ).rejects.toThrow("zero values")
      await store.abortCandidate?.()

      expect(await store.hasIndexedData()).toBe(true)
      expect((await store.search(active.vector, "src/active.c", 0, 5))[0]?.id).toBe(active.id)
      await store.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("serves a matching vector space while a new dimension mode remains unapplied", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const stores = new Map<string, MemoryStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    const auto = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
    const active = point("src/active.c", 6)

    try {
      await auto.initialize()
      await auto.markIndexingIncomplete()
      await auto.upsertPoints([active])
      await auto.activateFileGeneration?.("src/active.c", "generation-6", "run")
      await auto.markIndexingComplete()
      await auto.close()

      const fixedProfile = {
        ...profile("space-a"),
        dimensionMode: "fixed" as const,
        requestedDimension: 64,
      }
      const fixed = new SafeLanceDBVectorStore(workspace, root, fixedProfile, runtime, make)
      expect(await fixed.initialize()).toBe(true)
      expect((await fixed.search(active.vector, "src/active.c", 0, 5))[0]?.id).toBe(active.id)
      await fixed.abortCandidate?.()
      expect(await fixed.hasIndexedData()).toBe(true)
      await fixed.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("does not switch the active pointer when runtime profile persistence fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const stores = new Map<string, MemoryStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    const good = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
    const active = point("src/active.c", 7)

    try {
      await good.initialize()
      await good.markIndexingIncomplete()
      await good.upsertPoints([active])
      await good.activateFileGeneration?.("src/active.c", "generation-7", "run")
      await good.markIndexingComplete()
      await good.close()

      class BrokenRuntime extends EmbeddingRuntimeStore {
        override save(): Promise<void> {
          return Promise.reject(new Error("runtime profile write failed"))
        }
      }
      const broken = new SafeLanceDBVectorStore(
        workspace,
        root,
        profile("space-b"),
        new BrokenRuntime(root, workspace),
        make,
      )
      const candidate = point("src/candidate.c", 8)
      await broken.initialize()
      await broken.markIndexingIncomplete()
      await broken.upsertPoints([candidate])
      await broken.activateFileGeneration?.("src/candidate.c", "generation-8", "run")
      await expect(broken.markIndexingComplete()).rejects.toThrow("runtime profile write failed")
      await broken.abortCandidate?.()
      await broken.close()

      const reopened = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
      expect(await reopened.initialize()).toBe(false)
      expect((await reopened.search(active.vector, "src/active.c", 0, 5))[0]?.id).toBe(active.id)
      await reopened.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("uses the active manifest when an unpromoted runtime cache has a different profile", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const stores = new Map<string, MemoryStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    const store = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
    const active = point("src/active.c", 11)

    try {
      await store.initialize()
      await store.markIndexingIncomplete()
      await store.upsertPoints([active])
      await store.activateFileGeneration?.("src/active.c", "generation-11", "run")
      await store.markIndexingComplete()
      await store.close()

      await runtime.save(profile("space-b"))
      expect((await runtime.load())?.fingerprintDigest).toBe("space-b")
      expect((await loadActiveEmbeddingProfile(workspace, root))?.fingerprintDigest).toBe("space-a")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("requires every source-backed readback sample before promotion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    class PartialStore extends MemoryStore {
      override search(
        vector: number[],
        prefix?: string,
        score?: number,
        max?: number,
      ): Promise<VectorStoreSearchResult[]> {
        if (prefix === "src/missing.c") return Promise.resolve([])
        return super.search(vector, prefix, score, max)
      }
    }
    const stores = new Map<string, PartialStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new PartialStore()
      stores.set(generation, store)
      return store
    }
    const store = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
    const found = point("src/found.c", 9)
    const missing = point("src/missing.c", 10)

    try {
      await store.initialize()
      await store.markIndexingIncomplete()
      await store.upsertPoints([found, missing])
      await store.activateFileGeneration?.("src/found.c", "generation-9", "run")
      await store.activateFileGeneration?.("src/missing.c", "generation-10", "run")
      await expect(store.markIndexingComplete()).rejects.toThrow("source-backed readback")
      await store.abortCandidate?.()

      const reopened = new SafeLanceDBVectorStore(workspace, root, profile("space-a"), runtime, make)
      expect(await reopened.collectionExists()).toBe(false)
      await reopened.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
