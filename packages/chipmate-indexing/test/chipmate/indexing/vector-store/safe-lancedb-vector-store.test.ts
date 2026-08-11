import { describe, expect, test } from "bun:test"
import { createHash, randomUUID } from "crypto"
import { mkdir, mkdtemp, rm, stat, writeFile } from "fs/promises"
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
import { legacySafeGenerationRoot } from "../../../../src/indexing/vector-store/lancedb-paths"

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

class ReadbackStore extends MemoryStore {
  activeSearches = 0
  maximumSearches = 0

  override async search(
    vector: number[],
    prefix?: string,
    score?: number,
    max?: number,
  ): Promise<VectorStoreSearchResult[]> {
    this.activeSearches += 1
    this.maximumSearches = Math.max(this.maximumSearches, this.activeSearches)
    await Bun.sleep(5)
    try {
      return await super.search(vector, prefix, score, max)
    } finally {
      this.activeSearches -= 1
    }
  }
}

describe("SafeLanceDBVectorStore", () => {
  test("uses compact unique generation identities for Windows path headroom", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-compact-generation-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    let generation = ""
    const store = new SafeLanceDBVectorStore(workspace, root, profile("space-compact"), runtime, (value) => {
      generation = value
      return new MemoryStore()
    })

    try {
      await store.initialize()
      expect(generation).toMatch(/^[A-Za-z0-9_-]{8}$/)
      expect(generation).toHaveLength(8)
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("preserves a previous-format incomplete candidate until compact promotion succeeds", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-legacy-candidate-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 24)
    const generationRoot = path.join(root, "safe-generations", hash)
    const legacyGeneration = "mr0d8q2w-0123456789ab"
    const legacyDirectory = path.join(generationRoot, legacyGeneration)
    await mkdir(legacyDirectory, { recursive: true })
    await writeFile(
      path.join(generationRoot, "candidate.json"),
      `${JSON.stringify({
        schema: 1,
        generation: legacyGeneration,
        createdAt: new Date().toISOString(),
        profile: profile("space-legacy-candidate"),
      })}\n`,
    )
    let resumedGeneration = ""
    const store = new SafeLanceDBVectorStore(
      workspace,
      root,
      profile("space-legacy-candidate"),
      runtime,
      (generation) => {
        resumedGeneration = generation
        return new MemoryStore()
      },
    )

    try {
      expect(await store.initialize()).toBe(true)
      expect(resumedGeneration).not.toBe(legacyGeneration)
      expect(resumedGeneration).toMatch(/^[A-Za-z0-9_-]{8}$/)
      expect(
        await stat(legacyDirectory)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      await store.markIndexingComplete({ allowEmpty: true })
      expect(
        await stat(legacyDirectory)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reuses a readable legacy active generation while its write path remains within budget", async () => {
    const root = await mkdtemp(path.join(process.platform === "win32" ? tmpdir() : "/tmp", "safe-legacy-active-"))
    const workspace = path.join(root, "workspace-with-a-long-name")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const current = profile("space-legacy-active")
    const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 24)
    const generationRoot = path.join(root, "safe-generations", hash)
    const legacyGeneration = `${Date.now()}-${randomUUID()}`
    const existing = point("src/existing.c", 31)
    existing.payload.active = true
    const fallback = new MemoryStore()
    await fallback.upsertPoints([existing])
    await fallback.markIndexingComplete()
    const stores = new Map<string, MemoryStore>([[legacyGeneration, fallback]])
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    await mkdir(generationRoot, { recursive: true })
    await writeFile(
      path.join(generationRoot, "active.json"),
      JSON.stringify({
        schema: 1,
        generation: legacyGeneration,
        promotedAt: new Date().toISOString(),
        profile: current,
      }),
    )
    const store = new SafeLanceDBVectorStore(workspace, root, current, runtime, make)

    try {
      expect(await store.initialize()).toBe(false)
      expect(store.getLastCompatibilityDecision()).toEqual({
        action: "reuse",
        reason: "validated active generation",
        created: false,
      })
      expect((await store.search(existing.vector, "src/existing.c", 0, 5))[0]?.id).toBe(existing.id)
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reuses a readable generation created by the previous compact format", async () => {
    const root = await mkdtemp(path.join(process.platform === "win32" ? tmpdir() : "/tmp", "safe-previous-active-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const current = profile("space-previous-compact-active")
    const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 24)
    const generationRoot = path.join(root, "safe-generations", hash)
    const previousGeneration = "mr0d8q2w-0123456789ab"
    const existing = point("src/existing.c", 33)
    existing.payload.active = true
    const active = new MemoryStore()
    await active.upsertPoints([existing])
    await active.markIndexingComplete()
    const generations: string[] = []
    await mkdir(generationRoot, { recursive: true })
    await writeFile(
      path.join(generationRoot, "active.json"),
      JSON.stringify({
        schema: 1,
        generation: previousGeneration,
        promotedAt: new Date().toISOString(),
        profile: current,
      }),
    )
    const store = new SafeLanceDBVectorStore(workspace, root, current, runtime, (generation) => {
      generations.push(generation)
      return active
    })

    try {
      expect(await store.initialize()).toBe(false)
      expect(generations).toEqual([previousGeneration])
      expect(store.getLastCompatibilityDecision()).toEqual({
        action: "reuse",
        reason: "validated active generation",
        created: false,
      })
      expect((await store.search(existing.vector, "src/existing.c", 0, 5))[0]?.id).toBe(existing.id)
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("migrates a readable previous-format generation when its transaction path is too long", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-long-previous-active-"))
    const workspace = path.join(root, "workspace")
    const base = path.join(root, "x".repeat(30))
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const current = profile("space-long-previous-active")
    const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 24)
    const generationRoot = path.join(base, "safe-generations", hash)
    const previousGeneration = "mr0d8q2w-0123456789ab"
    const active = new MemoryStore()
    await active.markIndexingComplete()
    let replacement = ""
    await mkdir(generationRoot, { recursive: true })
    await writeFile(
      path.join(generationRoot, "active.json"),
      JSON.stringify({
        schema: 1,
        generation: previousGeneration,
        promotedAt: new Date().toISOString(),
        profile: current,
      }),
    )
    const store = new SafeLanceDBVectorStore(workspace, base, current, runtime, (generation) => {
      if (generation === previousGeneration) return active
      replacement = generation
      return new MemoryStore()
    })

    try {
      expect(await store.initialize()).toBe(true)
      expect(replacement).toMatch(/^[A-Za-z0-9_-]{8}$/)
      expect(store.getLastCompatibilityDecision()).toEqual({
        action: "rebuild",
        reason: "legacy active generation requires compact-path migration",
        created: true,
      })
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("keeps a cross-root legacy generation until compact promotion succeeds", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-cross-root-"))
    const workspace = path.join(root, "workspace")
    const currentBase = path.join(root, "n")
    const legacyBase = path.join(root, "x".repeat(40))
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const current = profile("space-cross-root")
    const legacyRoot = legacySafeGenerationRoot(workspace, legacyBase)
    const legacyGeneration = "mr0d8q2w-0123456789ab"
    const active = new MemoryStore()
    await active.markIndexingComplete()
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(
      path.join(legacyRoot, "active.json"),
      JSON.stringify({
        schema: 1,
        generation: legacyGeneration,
        promotedAt: new Date().toISOString(),
        profile: current,
      }),
    )
    const store = new SafeLanceDBVectorStore(
      workspace,
      currentBase,
      current,
      runtime,
      (generation) => (generation === legacyGeneration ? active : new MemoryStore()),
      [legacyBase],
    )
    const save = runtime.save.bind(runtime)

    try {
      expect(await store.initialize()).toBe(true)
      expect(await stat(legacyRoot).then(() => true)).toBe(true)
      runtime.save = () => Promise.reject(new Error("runtime persistence failed"))
      await expect(store.markIndexingComplete({ allowEmpty: true })).rejects.toThrow("runtime persistence failed")
      expect(await stat(legacyRoot).then(() => true)).toBe(true)

      runtime.save = save
      await store.markIndexingComplete({ allowEmpty: true })
      expect(
        await stat(legacyRoot)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rebuilds when a legacy active generation is already too long to reopen", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-unreadable-legacy-active-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const current = profile("space-unreadable-legacy-active")
    const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 24)
    const generationRoot = path.join(root, "safe-generations", hash)
    const legacyGeneration = `${Date.now()}-${randomUUID()}`
    await mkdir(generationRoot, { recursive: true })
    await writeFile(
      path.join(generationRoot, "active.json"),
      JSON.stringify({
        schema: 1,
        generation: legacyGeneration,
        promotedAt: new Date().toISOString(),
        profile: current,
      }),
    )
    let compactGeneration = ""
    const store = new SafeLanceDBVectorStore(workspace, root, current, runtime, (generation) => {
      if (generation === legacyGeneration) return new MemoryStore()
      compactGeneration = generation
      return new MemoryStore()
    })

    try {
      expect(await store.initialize()).toBe(true)
      expect(compactGeneration).toMatch(/^[A-Za-z0-9_-]{8}$/)
      expect(store.getLastCompatibilityDecision()).toMatchObject({
        action: "rebuild",
        reason: "legacy active generation requires compact-path migration",
      })
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("promotes an explicitly validated empty candidate for document-only workspaces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-empty-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const stores = new Map<string, MemoryStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    const store = new SafeLanceDBVectorStore(workspace, root, profile("space-empty"), runtime, make)

    try {
      await store.initialize()
      await expect(store.markIndexingComplete()).rejects.toThrow("contains no validated source vectors")
      expect([...stores.values()].every((item) => !item.complete)).toBe(true)
      await store.markIndexingComplete({ allowEmpty: true })
      await store.close()

      const reopened = new SafeLanceDBVectorStore(workspace, root, profile("space-empty"), runtime, make)
      expect(await reopened.initialize()).toBe(false)
      expect(await reopened.collectionExists()).toBe(true)
      expect(await reopened.search(vector(1), undefined, 0, 5)).toEqual([])
      await reopened.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("allows duplicate vectors for chunks with distinct source locations", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-duplicates-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const target = new MemoryStore()
    const store = new SafeLanceDBVectorStore(workspace, root, profile("space-duplicates"), runtime, () => target)
    const first = point("src/a.c", 1)
    const second = { ...point("src/b.c", 2), vector: first.vector.slice() }

    try {
      await store.initialize()
      await store.upsertPoints([first, second])

      expect(target.points.size).toBe(2)
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("bounds candidate readback concurrency before promotion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-readback-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const target = new ReadbackStore()
    const store = new SafeLanceDBVectorStore(workspace, root, profile("space-readback"), runtime, () => target)
    const samples = Array.from({ length: 6 }, (_, index) => point(`src/sample-${index}.c`, index + 1))

    try {
      await store.initialize()
      await store.upsertPoints(samples)
      await store.finalizeFileGenerations(
        samples.map((item) => ({
          filePath: item.payload.filePath,
          generation: item.payload.generation,
          runId: item.payload.runId,
        })),
      )
      await store.markIndexingComplete()

      expect(target.maximumSearches).toBeLessThanOrEqual(2)
      expect(await store.hasIndexedData()).toBe(true)
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

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

  test("resumes a compatible incomplete candidate after a worker exit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-resume-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const stores = new Map<string, MemoryStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    const first = new SafeLanceDBVectorStore(workspace, root, profile("space-resume"), runtime, make)
    const before = point("src/before.c", 12)

    try {
      expect(await first.initialize()).toBe(true)
      await first.markIndexingIncomplete()
      await first.upsertPoints([before])
      await first.activateFileGeneration?.("src/before.c", "generation-12", "run")
      await first.close()

      const resumed = new SafeLanceDBVectorStore(workspace, root, profile("space-resume"), runtime, make)
      expect(await resumed.initialize()).toBe(false)
      expect(resumed.getLastCompatibilityDecision()).toEqual({
        action: "rebuild",
        reason: "resumed incomplete candidate",
        created: false,
      })

      const after = point("src/after.c", 13)
      await resumed.upsertPoints([after])
      await resumed.activateFileGeneration?.("src/after.c", "generation-13", "run")
      await resumed.markIndexingComplete()

      expect((await resumed.search(before.vector, "src/before.c", 0, 5))[0]?.id).toBe(before.id)
      expect((await resumed.search(after.vector, "src/after.c", 0, 5))[0]?.id).toBe(after.id)
      await resumed.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("promotes a resumed candidate when every file was already checkpointed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "safe-lancedb-resume-complete-"))
    const workspace = path.join(root, "workspace")
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const stores = new Map<string, MemoryStore>()
    const make = (generation: string) => {
      const store = stores.get(generation) ?? new MemoryStore()
      stores.set(generation, store)
      return store
    }
    const first = new SafeLanceDBVectorStore(workspace, root, profile("space-resume-complete"), runtime, make)
    const item = point("src/checkpointed.c", 14)

    try {
      expect(await first.initialize()).toBe(true)
      await first.markIndexingIncomplete()
      await first.upsertPoints([item])
      await first.finalizeFileGenerations([
        { filePath: "src/checkpointed.c", generation: "generation-14", runId: "run" },
      ])

      const resumed = new SafeLanceDBVectorStore(workspace, root, profile("space-resume-complete"), runtime, make)
      expect(await resumed.initialize()).toBe(false)
      await resumed.markIndexingComplete()

      expect(await resumed.hasIndexedData()).toBe(true)
      expect((await resumed.search(item.vector, "src/checkpointed.c", 0, 5))[0]?.id).toBe(item.id)
      await resumed.close()
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
