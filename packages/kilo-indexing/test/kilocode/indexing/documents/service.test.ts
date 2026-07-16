import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import ignore from "ignore"
import { tmpdir } from "os"
import path from "path"
import { CodeIndexConfigManager } from "../../../../src/indexing/config-manager"
import { DocumentIndexService } from "../../../../src/indexing/documents"
import type { IEmbedder } from "../../../../src/indexing/interfaces/embedder"
import type {
  IVectorStore,
  PointStruct,
  VectorStoreSearchResult,
} from "../../../../src/indexing/interfaces/vector-store"

const embedder = {
  embedderInfo: { name: "openai" },
  createEmbeddings: async (texts: string[]) => ({ embeddings: texts.map(() => [0.1]) }),
  validateConfiguration: async () => ({ valid: true }),
} satisfies IEmbedder

const store = {
  initialize: async () => false,
  upsertPoints: async (_points: PointStruct[]) => {},
  search: async (): Promise<VectorStoreSearchResult[]> => [],
  deletePointsByFilePath: async (_filePath: string) => {},
  deletePointsByMultipleFilePaths: async (_filePaths: string[]) => {},
  clearCollection: async () => {},
  deleteCollection: async () => {},
  collectionExists: async () => true,
  hasIndexedData: async () => false,
  markIndexingComplete: async () => {},
  markIndexingIncomplete: async () => {},
  getCollectionName: () => "documents",
} satisfies IVectorStore

describe("DocumentIndexService", () => {
  test("completes an empty document scan with zero files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    try {
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, store, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({
        state: "Complete",
        processedFiles: 0,
        totalFiles: 0,
        percent: 100,
        validFileCount: 0,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("treats an explicit empty path list as a completed empty collection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    let embeddings = 0
    try {
      await writeFile(path.join(root, "notes.md"), "must not be discovered")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true, paths: [] },
      })
      const unused = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          embeddings += 1
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, unused, store, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({
        state: "Complete",
        processedFiles: 0,
        totalFiles: 0,
        percent: 100,
        validFileCount: 0,
      })
      expect(embeddings).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("discovers documents across the workspace without configured paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    try {
      await writeFile(path.join(root, "notes.md"), "workspace document")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, store, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({
        state: "Complete",
        validFileCount: 1,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("pauses before indexing when automatic discovery exceeds the document limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    try {
      await writeFile(path.join(root, "one.md"), "one")
      await writeFile(path.join(root, "two.md"), "two")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true, maxFiles: 1 },
      })
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, store, ignore())

      await service.start("manual")

      expect(service.getStatus().state).toBe("Standby")
      expect(service.getStatus().message).toContain("more than 1 documents")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("writes document vectors one embedding batch at a time", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const batches: number[] = []
    try {
      await writeFile(
        path.join(root, "notes.md"),
        Array.from({ length: 24 }, (_, index) => `bounded document line ${index}`).join("\n"),
      )
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        embeddingBatchSize: 5,
        documents: { enabled: true, chunkChars: 20, chunkOverlapChars: 0 },
      })
      const bounded = {
        ...store,
        upsertPoints: async (points: PointStruct[]) => {
          batches.push(points.length)
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, bounded, ignore())

      await service.start("manual")

      expect(batches.length).toBeGreaterThan(1)
      expect(Math.max(...batches)).toBeLessThanOrEqual(5)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reports embedding failures as a document pipeline error", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    try {
      await writeFile(path.join(root, "notes.md"), "document embedding failure")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const failed = {
        ...embedder,
        createEmbeddings: async () => {
          throw new Error("embedding service unavailable")
        },
      } satisfies IEmbedder
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, failed, store, ignore())

      await service.start("manual")

      expect(service.getStatus().state).toBe("Error")
      expect(service.getStatus().message).toContain("embedding service unavailable")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("dispose waits for an in-flight embedding and prevents later writes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const gate = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<void>()
    const writes: string[] = []
    let closes = 0
    try {
      await writeFile(path.join(root, "notes.md"), "document indexing cancellation")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const delayed = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          ready.resolve()
          await gate.promise
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const tracked = {
        ...store,
        upsertPoints: async (_points: PointStruct[]) => {
          writes.push("upsert")
        },
        activateFileGeneration: async () => {
          writes.push("activate")
        },
        deleteInactiveFilePoints: async () => {
          writes.push("cleanup")
        },
        markIndexingComplete: async () => {
          writes.push("complete")
        },
        close: async () => {
          closes += 1
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, delayed, tracked, ignore())

      const running = service.start("manual")
      await ready.promise
      const draining = service.dispose()
      const repeated = service.dispose()

      expect(repeated).toBe(draining)
      expect(await Promise.race([draining.then(() => "done"), Promise.resolve("pending")])).toBe("pending")
      expect(closes).toBe(0)
      gate.resolve()
      await Promise.all([running, draining, repeated])

      expect(writes).toEqual([])
      expect(closes).toBe(1)
      expect(service.getStatus().state).not.toBe("Complete")
    } finally {
      gate.resolve()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("does not activate or complete after an in-flight upsert is cancelled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const gate = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<void>()
    const writes: string[] = []
    try {
      await writeFile(path.join(root, "notes.md"), "document upsert cancellation")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const delayed = {
        ...store,
        markIndexingIncomplete: async () => {
          writes.push("incomplete")
        },
        upsertPoints: async (_points: PointStruct[]) => {
          ready.resolve()
          await gate.promise
          writes.push("upsert")
        },
        activateFileGeneration: async () => {
          writes.push("activate")
        },
        deleteInactiveFilePoints: async () => {
          writes.push("cleanup")
        },
        markIndexingComplete: async () => {
          writes.push("complete")
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, delayed, ignore())

      const running = service.start("manual")
      await ready.promise
      const draining = service.dispose()
      gate.resolve()
      await Promise.all([running, draining])

      expect(writes).toEqual(["incomplete", "upsert"])
      expect(service.getStatus().state).not.toBe("Complete")
    } finally {
      gate.resolve()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects configured paths outside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    try {
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: ["../outside"],
        },
      })
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, store, ignore())

      await service.start("manual")

      expect(service.getStatus().state).toBe("Error")
      expect(service.getStatus().message).toContain("within the current workspace")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("counts unsupported Office formats as skipped", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    try {
      await writeFile(path.join(root, "legacy.doc"), "old office binary placeholder")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: ["."],
        },
      })
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, store, ignore())

      await service.start("manual")

      expect(service.getStatus().state).toBe("Complete")
      expect(service.getStatus().skippedCount).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
