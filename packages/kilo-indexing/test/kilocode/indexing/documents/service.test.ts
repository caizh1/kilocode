import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import ignore from "ignore"
import { tmpdir } from "os"
import path from "path"
import { CodeIndexConfigManager } from "../../../../src/indexing/config-manager"
import { DocumentIndexService } from "../../../../src/indexing/documents"
import type { IEmbedder } from "../../../../src/indexing/interfaces/embedder"
import type { IVectorStore, PointStruct, VectorStoreSearchResult } from "../../../../src/indexing/interfaces/vector-store"

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
