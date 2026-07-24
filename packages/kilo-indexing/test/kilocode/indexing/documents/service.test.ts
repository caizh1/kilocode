import { describe, expect, test } from "bun:test"
import { randomUUID } from "crypto"
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from "fs/promises"
import ignore from "ignore"
import { tmpdir } from "os"
import path from "path"
import { utils, write } from "xlsx"
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

  test("treats an explicit empty path list as the current workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    let embeddings = 0
    try {
      await writeFile(path.join(root, "notes.md"), "workspace notes")
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
        processedFiles: 1,
        totalFiles: 1,
        percent: 100,
        validFileCount: 1,
      })
      expect(embeddings).toBeGreaterThan(0)
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

  test("rejects unapproved external paths before embedding", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "kilo-doc-external-"))
    let embeddings = 0
    try {
      await writeFile(path.join(external, "secret.md"), "must not be embedded")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: [external],
        },
      })
      const guarded = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          embeddings += 1
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, guarded, store, ignore())

      await service.start("manual")

      expect(service.getStatus().state).toBe("Error")
      expect(service.getStatus().message).toContain("not approved")
      expect(embeddings).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test("rejects a missing unapproved absolute path instead of probing and skipping it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    let embeddings = 0
    try {
      const external = path.join(tmpdir(), `kilo-doc-unapproved-${randomUUID()}`)
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true, paths: [external] },
      })
      const guarded = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          embeddings += texts.length
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, guarded, store, ignore())

      await service.start("manual")

      expect(service.getStatus().state).toBe("Error")
      expect(service.getStatus().message).toContain("not approved")
      expect(embeddings).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects workspace-relative traversal even when its target root is approved", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "kilo-doc-parent-"))
    const root = path.join(parent, "workspace")
    const external = path.join(parent, "external")
    let embeddings = 0
    try {
      await mkdir(root)
      await mkdir(external)
      await writeFile(path.join(external, "guide.md"), "external guide")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: [path.join("..", "external")],
          approvedExternalRoots: [{ path: external }],
        },
      })
      const guarded = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          embeddings += texts.length
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, guarded, store, ignore())

      await service.start("manual")

      expect(service.getStatus().state).toBe("Error")
      expect(service.getStatus().message).toContain("relative document path")
      expect(embeddings).toBe(0)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test("indexes an approved workspace-scoped external root with absolute search references", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "kilo-doc-external-"))
    const points: PointStruct[] = []
    try {
      const workspaceFile = path.join(root, "workspace.md")
      const file = path.join(external, "guide.md")
      await writeFile(workspaceFile, "workspace retention overview")
      await writeFile(file, "external retention policy")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: [external],
          approvedExternalRoots: [{ path: external, workspace: root }],
        },
      })
      const memory = {
        ...store,
        upsertPoints: async (items: PointStruct[]) => {
          points.push(...items)
        },
        search: async (): Promise<VectorStoreSearchResult[]> =>
          points.map((point) => ({ id: point.id, score: 0.9, payload: point.payload })),
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, memory, ignore())

      await service.start("manual")
      const results = await service.search("retention")
      const canonical = await realpath(file)
      const externalPoint = points.find((point) => point.payload.filePath.startsWith("@external/"))

      expect(service.getStatus()).toMatchObject({ state: "Complete", validFileCount: 2 })
      expect(externalPoint?.payload.filePath).toMatch(/^@external\/[0-9a-f]{16}\/guide\.md$/)
      expect(new Set(results.map((item) => item.filePath))).toEqual(
        new Set(["workspace.md", canonical.replaceAll("\\", "/")]),
      )
      expect(results.find((item) => item.filePath === canonical.replaceAll("\\", "/"))?.sourceRef).toContain(
        `${canonical.replaceAll("\\", "/")}:`,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test("keeps same-named files from multiple approved external roots distinct", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const left = await mkdtemp(path.join(tmpdir(), "kilo-doc-external-left-"))
    const right = await mkdtemp(path.join(tmpdir(), "kilo-doc-external-right-"))
    const points: PointStruct[] = []
    try {
      await writeFile(path.join(left, "guide.md"), "left guide")
      await writeFile(path.join(right, "guide.md"), "right guide")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: [left, right],
          approvedExternalRoots: [{ path: left }, { path: right }],
        },
      })
      const memory = {
        ...store,
        upsertPoints: async (items: PointStruct[]) => {
          points.push(...items)
        },
        search: async (): Promise<VectorStoreSearchResult[]> =>
          points.map((point) => ({ id: point.id, score: 0.9, payload: point.payload })),
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, memory, ignore())

      await service.start("manual")
      const results = await service.search("guide")

      expect(new Set(points.map((point) => point.payload.filePath)).size).toBe(2)
      expect(new Set(results.map((result) => result.filePath))).toEqual(
        new Set([
          (await realpath(path.join(left, "guide.md"))).replaceAll("\\", "/"),
          (await realpath(path.join(right, "guide.md"))).replaceAll("\\", "/"),
        ]),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(left, { recursive: true, force: true })
      await rm(right, { recursive: true, force: true })
    }
  })

  test("reuses external cache entries and deletes vectors for removed files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "kilo-doc-external-"))
    const removed: string[] = []
    let embeddings = 0
    try {
      const file = path.join(external, "guide.md")
      await writeFile(file, "cached external guide")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: [external],
          approvedExternalRoots: [{ path: external }],
        },
      })
      const tracked = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          embeddings += texts.length
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const memory = {
        ...store,
        deletePointsByFilePath: async (filePath: string) => {
          removed.push(filePath)
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, tracked, memory, ignore())

      await service.start("manual")
      expect(embeddings).toBeGreaterThan(0)
      const count = embeddings

      await service.start("manual")
      expect(embeddings).toBe(count)

      await unlink(file)
      await service.start("manual")
      expect(removed).toHaveLength(1)
      expect(removed[0]).toMatch(/^@external\/[0-9a-f]{16}\/guide\.md$/)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  if (process.platform !== "win32") {
    test("indexes an approved external PDF with an absolute page reference", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
      const external = await mkdtemp(path.join(tmpdir(), "kilo-doc-external-"))
      const points: PointStruct[] = []
      const before = process.env.KILO_PDFTOTEXT_PATH
      try {
        const file = path.join(external, "guide.pdf")
        const exe = path.join(root, "pdftotext")
        await writeFile(file, "%PDF-1.4\n% external document fixture\n")
        await writeFile(exe, "#!/bin/sh\nprintf 'external PDF page\\f'\n")
        await chmod(exe, 0o755)
        process.env.KILO_PDFTOTEXT_PATH = exe
        const cfg = new CodeIndexConfigManager({
          enabled: true,
          embedderProvider: "openai",
          openAiKey: "sk-test",
          documents: {
            enabled: true,
            paths: [external],
            approvedExternalRoots: [{ path: external }],
          },
        })
        const memory = {
          ...store,
          upsertPoints: async (items: PointStruct[]) => {
            points.push(...items)
          },
          search: async (): Promise<VectorStoreSearchResult[]> =>
            points.map((point) => ({ id: point.id, score: 0.9, payload: point.payload })),
        } satisfies IVectorStore
        const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, memory, ignore())

        await service.start("manual")
        const results = await service.search("external PDF")
        const canonical = (await realpath(file)).replaceAll("\\", "/")

        expect(service.getStatus()).toMatchObject({ state: "Complete", validFileCount: 1 })
        expect(results[0]?.filePath).toBe(canonical)
        expect(results[0]?.sourceRef).toBe(`${canonical}#page=1`)
      } finally {
        if (before === undefined) delete process.env.KILO_PDFTOTEXT_PATH
        else process.env.KILO_PDFTOTEXT_PATH = before
        await rm(root, { recursive: true, force: true })
        await rm(external, { recursive: true, force: true })
      }
    })
  }

  test("returns an absolute sheet reference for an approved external spreadsheet", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "kilo-doc-external-"))
    const points: PointStruct[] = []
    try {
      const file = path.join(external, "data.xlsx")
      const book = utils.book_new()
      utils.book_append_sheet(book, utils.aoa_to_sheet([["Name"], ["alpha"]]), "Data Sheet")
      await writeFile(file, write(book, { type: "buffer", bookType: "xlsx" }))
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: [external],
          approvedExternalRoots: [{ path: external }],
        },
      })
      const memory = {
        ...store,
        upsertPoints: async (items: PointStruct[]) => {
          points.push(...items)
        },
        search: async (): Promise<VectorStoreSearchResult[]> =>
          points.map((point) => ({ id: point.id, score: 0.9, payload: point.payload })),
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, memory, ignore())

      await service.start("manual")
      const results = await service.search("alpha")
      const canonical = (await realpath(file)).replaceAll("\\", "/")

      expect(results[0]?.sourceRef).toBe(`${canonical}#sheet=Data%20Sheet rows=1-2`)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test("applies external include, exclude, and ignore rules relative to the approved root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "kilo-doc-external-"))
    const points: PointStruct[] = []
    try {
      await mkdir(path.join(external, "docs"))
      await writeFile(path.join(external, "docs", "included.md"), "included")
      await writeFile(path.join(external, "docs", "excluded.md"), "excluded")
      await writeFile(path.join(external, "docs", "ignored.md"), "ignored")
      await writeFile(path.join(external, ".gitignore"), "docs/ignored.md\n")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: [external],
          include: ["docs/**/*.md"],
          exclude: ["docs/excluded.md"],
          approvedExternalRoots: [{ path: external }],
        },
      })
      const memory = {
        ...store,
        upsertPoints: async (items: PointStruct[]) => {
          points.push(...items)
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, memory, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({ state: "Complete", validFileCount: 1 })
      expect(new Set(points.map((point) => point.payload.filePath)).size).toBe(1)
      expect(points[0]?.payload.filePath).toMatch(/\/docs\/included\.md$/)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test("skips a document symlink that escapes an approved external root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "kilo-doc-external-"))
    const outside = await mkdtemp(path.join(tmpdir(), "kilo-doc-outside-"))
    let embeddings = 0
    try {
      const secret = path.join(outside, "secret.md")
      await writeFile(secret, "secret")
      await symlink(secret, path.join(external, "linked.md"))
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: [external],
          approvedExternalRoots: [{ path: external }],
        },
      })
      const guarded = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          embeddings += 1
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, guarded, store, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({ state: "Complete", validFileCount: 0, skippedCount: 1 })
      expect(service.getStatus().recentErrors?.[0]?.message).toContain("symlink escapes")
      expect(embeddings).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  test("reports and skips an inaccessible configured root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    try {
      const missing = path.join(root, "missing-docs")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true, paths: [missing] },
      })
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, store, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({ state: "Complete", validFileCount: 0, skippedCount: 1 })
      expect(service.getStatus().recentErrors?.[0]?.message).toContain("not accessible")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reports and skips a missing approved external root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-doc-workspace-"))
    try {
      const external = path.join(tmpdir(), `kilo-doc-approved-${randomUUID()}`)
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: {
          enabled: true,
          paths: [external],
          approvedExternalRoots: [{ path: external }],
        },
      })
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, store, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({ state: "Complete", validFileCount: 0, skippedCount: 1 })
      expect(service.getStatus().recentErrors?.[0]?.message).toContain("not accessible")
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
