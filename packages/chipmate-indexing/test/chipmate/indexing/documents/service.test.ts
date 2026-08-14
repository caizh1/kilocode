import { describe, expect, test } from "bun:test"
import { randomUUID } from "crypto"
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "fs/promises"
import ignore from "ignore"
import { tmpdir } from "os"
import path from "path"
import JSZip from "jszip"
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

function memoryStore() {
  let points: PointStruct[] = []
  const value = {
    ...store,
    upsertPoints: async (items: PointStruct[]) => {
      points.push(...items)
    },
    finalizeFileGenerations: async (files: readonly { filePath: string; generation: string; runId: string }[]) => {
      for (const file of files) {
        points = points.filter(
          (point) => point.payload.filePath !== file.filePath || point.payload.generation === file.generation,
        )
      }
    },
    deletePointsByFilePath: async (filePath: string) => {
      points = points.filter((point) => point.payload.filePath !== filePath)
    },
    search: async (): Promise<VectorStoreSearchResult[]> =>
      points.map((point) => ({ id: point.id, score: 0.9, payload: point.payload })),
    points: () => points.slice(),
  }
  return value
}

async function docx(text: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  return zip.generateAsync({ type: "uint8array" })
}

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 8_000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started >= timeout) throw new Error(`等待条件超时（${timeout}ms）`)
    await Bun.sleep(25)
  }
}

describe("DocumentIndexService", () => {
  test("completes an empty document scan with zero files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const completions: Array<{ allowEmpty?: boolean } | undefined> = []
    try {
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const emptyStore = {
        ...store,
        markIndexingComplete: async (options?: { allowEmpty?: boolean }) => {
          completions.push(options)
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, emptyStore, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({
        state: "Complete",
        processedFiles: 0,
        totalFiles: 0,
        percent: 100,
        validFileCount: 0,
      })
      expect(completions).toEqual([{ allowEmpty: true }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("starts an isolated candidate when a safe document index is force-rebuilt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    let clears = 0
    try {
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const safe = {
        ...store,
        abortCandidate: async () => {},
        clearCollection: async () => {
          clears += 1
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, safe, ignore())

      await service.start("manual", true)

      expect(clears).toBe(1)
      expect(service.getStatus().state).toBe("Complete")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("ignores Microsoft Office temporary owner files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    let embeddings = 0
    try {
      await writeFile(path.join(root, "~$L_CP_Module_Detail_xxx.docx"), "not an OOXML ZIP")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
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
        errorCount: 0,
        skippedCount: 0,
        validFileCount: 0,
      })
      expect(embeddings).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("treats an explicit empty path list as the current workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
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

  test("automatically refreshes when a document directory is moved, renamed, and removed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const staging = await mkdtemp(path.join(tmpdir(), "chipmate-doc-staging-"))
    const documentEmbeddings = new Map<string, number>()
    const memory = memoryStore()
    let service: DocumentIndexService | undefined
    try {
      await writeFile(path.join(root, "stable.md"), "STABLE_DOCUMENT_MARKER")
      const incoming = path.join(staging, "incoming")
      await mkdir(incoming)
      await writeFile(path.join(incoming, "one.md"), "MOVED_DIRECTORY_MARKER_ONE")
      await writeFile(path.join(incoming, "two.txt"), "MOVED_DIRECTORY_MARKER_TWO")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const tracked = {
        ...embedder,
        createEmbeddings: async (texts: string[], _dimensions?: number, purpose?: string) => {
          if (purpose === "document") {
            for (const text of texts) documentEmbeddings.set(text, (documentEmbeddings.get(text) ?? 0) + 1)
          }
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      service = new DocumentIndexService(
        root,
        path.join(staging, "cache"),
        cfg,
        tracked,
        memory,
        ignore(),
        undefined,
        undefined,
        {
          autoRefresh: true,
          debounceMs: 30,
          maxLatencyMs: 100,
          reconcileIntervalMs: 60_000,
        },
      )

      await service.start("manual")
      await rename(incoming, path.join(root, "incoming"))
      await waitFor(() => memory.points().some((point) => point.payload.codeChunk === "MOVED_DIRECTORY_MARKER_TWO"))

      expect(documentEmbeddings.get("STABLE_DOCUMENT_MARKER")).toBe(1)
      expect((await service.search("MOVED_DIRECTORY_MARKER_ONE", { maxResults: 1 }))[0]?.filePath).toBe(
        "incoming/one.md",
      )

      await rename(path.join(root, "incoming"), path.join(root, "renamed"))
      await waitFor(() => memory.points().some((point) => point.payload.filePath === path.join("renamed", "one.md")))
      expect(memory.points().some((point) => String(point.payload.filePath).startsWith("incoming"))).toBe(false)

      await rename(path.join(root, "renamed"), path.join(staging, "removed"))
      await waitFor(() => memory.points().every((point) => point.payload.filePath === "stable.md"))
      expect(documentEmbeddings.get("STABLE_DOCUMENT_MARKER")).toBe(1)
    } finally {
      await service?.dispose()
      await rm(root, { recursive: true, force: true })
      await rm(staging, { recursive: true, force: true })
    }
  })

  test("serially follows document events that arrive during an automatic refresh", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const cache = await mkdtemp(path.join(tmpdir(), "chipmate-doc-cache-"))
    const memory = memoryStore()
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    let delayed = false
    let active = 0
    let maximum = 0
    let service: DocumentIndexService | undefined
    try {
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const tracked = {
        ...embedder,
        createEmbeddings: async (texts: string[], _dimensions?: number, purpose?: string) => {
          if (purpose === "document") {
            active += 1
            maximum = Math.max(maximum, active)
            if (!delayed && texts.includes("FIRST_AUTOMATIC_MARKER")) {
              delayed = true
              entered.resolve()
              await gate.promise
            }
            active -= 1
          }
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      service = new DocumentIndexService(root, cache, cfg, tracked, memory, ignore(), undefined, undefined, {
        autoRefresh: true,
        debounceMs: 20,
        maxLatencyMs: 50,
        reconcileIntervalMs: 60_000,
      })
      await service.start("manual")

      await writeFile(path.join(root, "first.md"), "FIRST_AUTOMATIC_MARKER")
      await entered.promise
      await writeFile(path.join(root, "second.md"), "SECOND_AUTOMATIC_MARKER")
      gate.resolve()

      await waitFor(
        () =>
          memory.points().some((point) => point.payload.codeChunk === "SECOND_AUTOMATIC_MARKER") &&
          service?.getStatus().state === "Complete",
      )
      expect(maximum).toBe(1)
      expect(service.getStatus()).toMatchObject({ state: "Complete", validFileCount: 2 })
    } finally {
      gate.resolve()
      await service?.dispose()
      await rm(root, { recursive: true, force: true })
      await rm(cache, { recursive: true, force: true })
    }
  })

  test("uses reconciliation after watcher startup failure and stops after disposal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const cache = await mkdtemp(path.join(tmpdir(), "chipmate-doc-cache-"))
    const memory = memoryStore()
    let embeddings = 0
    let service: DocumentIndexService | undefined
    try {
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const tracked = {
        ...embedder,
        createEmbeddings: async (texts: string[], _dimensions?: number, purpose?: string) => {
          if (purpose === "document") embeddings += texts.length
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      service = new DocumentIndexService(root, cache, cfg, tracked, memory, ignore(), undefined, undefined, {
        autoRefresh: true,
        reconcileIntervalMs: 50,
        watcherFactory: () => {
          throw new Error("simulated watcher startup failure")
        },
      })

      await service.start("manual")
      expect(service.getStatus().recentErrors?.[0]?.location).toBe("documents:watcher")
      await writeFile(path.join(root, "reconciled.md"), "RECONCILIATION_MARKER")
      await waitFor(
        () =>
          memory.points().some((point) => point.payload.codeChunk === "RECONCILIATION_MARKER") &&
          service?.getStatus().state === "Complete",
      )
      expect(service.getStatus().state).toBe("Complete")

      await service.dispose()
      const count = embeddings
      await writeFile(path.join(root, "after-dispose.md"), "AFTER_DISPOSE_MARKER")
      await Bun.sleep(175)
      expect(embeddings).toBe(count)
      expect(memory.points().some((point) => point.payload.codeChunk === "AFTER_DISPOSE_MARKER")).toBe(false)
    } finally {
      await service?.dispose()
      await rm(root, { recursive: true, force: true })
      await rm(cache, { recursive: true, force: true })
    }
  })

  test("pauses before indexing when automatic discovery exceeds the document limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
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

  test("reduces only a rejected embedding batch when the service enforces a total token limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const requests: number[] = []
    const points: PointStruct[] = []
    try {
      await writeFile(
        path.join(root, "notes.md"),
        Array.from({ length: 20 }, (_, index) => `需要保留上下文的文档行 ${index}`).join("\n"),
      )
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        embeddingBatchSize: 8,
        documents: { enabled: true, chunkChars: 24, chunkOverlapChars: 0 },
      })
      const limited = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          requests.push(texts.length)
          if (texts.length > 2) {
            throw new Error("This model's maximum context length is 8192 tokens; the batch input exceeds the limit.")
          }
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const memory = {
        ...store,
        upsertPoints: async (items: PointStruct[]) => {
          points.push(...items)
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, limited, memory, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({ state: "Complete", validFileCount: 1 })
      expect(requests.some((count) => count > 2)).toBe(true)
      expect(requests.some((count) => count <= 2)).toBe(true)
      expect(points.length).toBeGreaterThan(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("semantically re-splits only the single chunk rejected by the embedding token limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const accepted: string[] = []
    const points: PointStruct[] = []
    try {
      await writeFile(path.join(root, "long.md"), `${"甲".repeat(430)}。${"乙".repeat(430)}。结束`)
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true, chunkChars: 1000, chunkOverlapChars: 100 },
      })
      const limited = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          if (texts.some((text) => text.length > 300)) {
            throw new Error("Input length exceeds the maximum sequence length of 8192 tokens")
          }
          accepted.push(...texts)
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const memory = {
        ...store,
        upsertPoints: async (items: PointStruct[]) => {
          points.push(...items)
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, limited, memory, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({ state: "Complete", validFileCount: 1 })
      expect(accepted.length).toBeGreaterThan(1)
      expect(accepted.every((text) => text.length <= 300)).toBe(true)
      expect(points).toHaveLength(accepted.length)
      expect(points.every((point) => point.payload.sourceRef === "long.md:1-1")).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("uses a fresh file generation when a forced rebuild may resolve to a different adaptive layout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const generations: string[] = []
    try {
      await writeFile(path.join(root, "notes.md"), "需要在强制重建之间保持原子切换的文档")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const memory = {
        ...store,
        upsertPoints: async (items: PointStruct[]) => {
          generations.push(...items.map((item) => String(item.payload.generation)))
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, memory, ignore())

      await service.start("manual", true)
      await service.start("manual", true)

      expect(generations).toHaveLength(2)
      expect(new Set(generations).size).toBe(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reports embedding failures as a document pipeline error", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
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

  test("commits readable documents while classifying corrupt Office files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    try {
      await writeFile(path.join(root, "notes.md"), "readable document")
      await writeFile(path.join(root, "broken.docx"), "")
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
        errorCount: 1,
        staleCount: 0,
        issueSummary: [expect.objectContaining({ category: "office-corrupt", count: 1 })],
      })
      const report = await service.getDiagnosticReport(service.getStatus().diagnosticRunId)
      expect(report?.diagnostics).toHaveLength(1)
      expect(report?.diagnostics[0]).toMatchObject({ category: "office-corrupt" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("keeps the previous vectors stale when an updated document becomes corrupt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const memory = memoryStore()
    try {
      const file = path.join(root, "guide.docx")
      await writeFile(file, await docx("previous searchable content"))
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, memory, ignore())
      await service.start("manual")
      const previous = memory.points().map((point) => point.id)

      await writeFile(file, "")
      await service.start("manual")

      expect(service.getStatus()).toMatchObject({
        state: "Complete",
        validFileCount: 0,
        errorCount: 1,
        staleCount: 1,
      })
      expect(memory.points().map((point) => point.id)).toEqual(previous)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("keeps recent errors bounded while the complete ledger retains every failed file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    try {
      await writeFile(path.join(root, "notes.md"), "readable document")
      await Promise.all(
        Array.from({ length: 7 }, (_, index) => writeFile(path.join(root, `broken-${index}.docx`), "")),
      )
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, store, ignore())

      await service.start("manual")

      expect(service.getStatus().recentErrors).toHaveLength(5)
      expect(service.getStatus().issueSummary).toEqual([
        expect.objectContaining({ category: "office-corrupt", count: 7 }),
      ])
      const report = await service.getDiagnosticReport(service.getStatus().diagnosticRunId)
      expect(report?.diagnostics).toHaveLength(7)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("fails an all-corrupt first index instead of publishing an empty generation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    let completed = 0
    try {
      await writeFile(path.join(root, "broken.docx"), "")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const tracked = {
        ...store,
        markIndexingComplete: async () => {
          completed += 1
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, tracked, ignore())

      await service.start("manual")

      expect(service.getStatus()).toMatchObject({ state: "Error", errorCount: 1 })
      expect(completed).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  if (process.platform !== "win32") {
    test("stops after one failed PDF runtime preflight and preserves an existing index", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
      const before = process.env.CHIPMATE_PDFTOTEXT_PATH
      try {
        const exe = path.join(root, "pdftotext")
        await writeFile(exe, "#!/bin/sh\nexit 53\n")
        await chmod(exe, 0o755)
        process.env.CHIPMATE_PDFTOTEXT_PATH = exe
        await writeFile(path.join(root, "one.pdf"), "%PDF-1.4")
        await writeFile(path.join(root, "two.pdf"), "%PDF-1.4")
        const cfg = new CodeIndexConfigManager({
          enabled: true,
          embedderProvider: "openai",
          openAiKey: "sk-test",
          documents: { enabled: true },
        })
        const safe = { ...store, hasIndexedData: async () => true } satisfies IVectorStore
        const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, safe, ignore())

        await service.start("manual")

        expect(service.getStatus()).toMatchObject({
          state: "Complete",
          message: "Document RAG 候选索引未应用，正在使用上一版有效索引。",
          issueSummary: [expect.objectContaining({ category: "extractor-runtime", count: 1 })],
        })
        const report = await service.getDiagnosticReport(service.getStatus().diagnosticRunId)
        expect(report?.diagnostics).toHaveLength(1)
        expect(report?.diagnostics[0]?.message).toContain("exitCode=53")
      } finally {
        if (before === undefined) delete process.env.CHIPMATE_PDFTOTEXT_PATH
        else process.env.CHIPMATE_PDFTOTEXT_PATH = before
        await rm(root, { recursive: true, force: true })
      }
    })
  }

  test("keeps a compatible document index available when a candidate fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    let aborted = 0
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
      const safe = {
        ...store,
        initialize: async () => true,
        abortCandidate: async () => {
          aborted += 1
        },
        getLastCompatibilityDecision: () => ({
          action: "rebuild" as const,
          reason: "profile changed",
          created: true,
        }),
        hasIndexedData: async () => true,
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, failed, safe, ignore())

      await service.start("manual")

      expect(aborted).toBe(1)
      expect(service.getStatus()).toMatchObject({
        state: "Complete",
        message: "Document RAG 候选索引未应用，正在使用上一版有效索引。",
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("restores document hashes when a failed candidate falls back to the active index", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const cache = path.join(root, ".cache")
    let embeddings = 0
    try {
      const file = path.join(root, "notes.md")
      await writeFile(file, "active document version")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const tracked = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          embeddings += texts.length
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const first = new DocumentIndexService(root, cache, cfg, tracked, store, ignore())
      await first.start("manual")
      const baseline = embeddings
      await writeFile(file, "candidate document version")
      const failed = {
        ...tracked,
        createEmbeddings: async () => {
          throw new Error("embedding service unavailable")
        },
      } satisfies IEmbedder
      const candidate = {
        ...store,
        initialize: async () => true,
        abortCandidate: async () => {},
        getLastCompatibilityDecision: () => ({
          action: "rebuild" as const,
          reason: "profile changed",
          created: true,
        }),
        hasIndexedData: async () => true,
      } satisfies IVectorStore
      const attempted = new DocumentIndexService(root, cache, cfg, failed, candidate, ignore())
      await attempted.start("manual")
      expect(attempted.getStatus().state).toBe("Complete")

      const resumed = new DocumentIndexService(root, cache, cfg, tracked, store, ignore())
      await resumed.start("manual")

      expect(embeddings).toBeGreaterThan(baseline)
      expect(resumed.getStatus()).toMatchObject({ state: "Complete", validFileCount: 1, errorCount: 0 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("dispose waits for an in-flight embedding and prevents later writes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "chipmate-doc-external-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    let embeddings = 0
    try {
      const external = path.join(tmpdir(), `chipmate-doc-unapproved-${randomUUID()}`)
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
    const parent = await mkdtemp(path.join(tmpdir(), "chipmate-doc-parent-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "chipmate-doc-external-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const left = await mkdtemp(path.join(tmpdir(), "chipmate-doc-external-left-"))
    const right = await mkdtemp(path.join(tmpdir(), "chipmate-doc-external-right-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "chipmate-doc-external-"))
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
      const firstDetail = service.getStatus().detail

      await service.start("manual")
      expect(embeddings).toBe(count)
      expect(service.getStatus().detail).toBe(firstDetail)

      await unlink(file)
      await service.start("manual")
      expect(removed).toHaveLength(1)
      expect(removed[0]).toMatch(/^@external\/[0-9a-f]{16}\/guide\.md$/)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test("finalizes each document generation atomically when the vector store supports it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const finalized: Array<readonly { filePath: string; generation: string; runId: string }[]> = []
    try {
      await writeFile(path.join(root, "notes.md"), "document generation finalization")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const tracked = {
        ...store,
        finalizeFileGenerations: async (files: readonly { filePath: string; generation: string; runId: string }[]) => {
          finalized.push(files)
        },
        activateFileGeneration: async () => {
          throw new Error("separate activation must not run")
        },
        deleteInactiveFilePoints: async () => {
          throw new Error("separate cleanup must not run")
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, tracked, ignore())

      await service.start("manual")

      expect(finalized).toHaveLength(1)
      expect(finalized[0]?.[0]).toMatchObject({ filePath: "notes.md", runId: "documents" })
      expect(finalized[0]?.[0]?.generation).toBeString()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reuses a legacy cache without treating its unknown chunk count as an empty index", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const cache = path.join(root, ".cache")
    const completions: Array<{ allowEmpty?: boolean } | undefined> = []
    let embeddings = 0
    try {
      await writeFile(path.join(root, "notes.md"), "legacy document cache")
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true },
      })
      const tracked = {
        ...embedder,
        createEmbeddings: async (texts: string[]) => {
          embeddings += texts.length
          return { embeddings: texts.map(() => [0.1]) }
        },
      } satisfies IEmbedder
      const first = new DocumentIndexService(root, cache, cfg, tracked, store, ignore())
      await first.start("manual")
      const count = embeddings
      const name = (await readdir(cache)).find((item) => item.startsWith("document-index-cache-"))
      const file = path.join(cache, name!)
      const data = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>
      delete data.chunks
      await writeFile(file, JSON.stringify(data))

      const legacyStore = {
        ...store,
        markIndexingComplete: async (options?: { allowEmpty?: boolean }) => {
          completions.push(options)
        },
      } satisfies IVectorStore
      const resumed = new DocumentIndexService(root, cache, cfg, tracked, legacyStore, ignore())
      await resumed.start("manual")

      expect(embeddings).toBe(count)
      expect(resumed.getStatus().detail).toContain("1 legacy cached document counts unavailable")
      expect(completions).toEqual([{ allowEmpty: false }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  if (process.platform !== "win32") {
    test("automatically indexes a PDF directory moved into an existing index", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
      const staging = await mkdtemp(path.join(tmpdir(), "chipmate-doc-staging-"))
      const memory = memoryStore()
      const before = process.env.CHIPMATE_PDFTOTEXT_PATH
      let service: DocumentIndexService | undefined
      try {
        const incoming = path.join(staging, "incoming")
        const exe = path.join(staging, "pdftotext")
        await mkdir(incoming)
        await writeFile(path.join(incoming, "guide.pdf"), "%PDF-1.4\n% moved PDF fixture\n")
        await writeFile(
          exe,
          "#!/bin/sh\ncase \"$2\" in *'中文 路径.pdf') printf 'CHIPMATE_PDF_PREFLIGHT_OK\\f'; exit 0;; esac\ngrep -q 'COPY_COMPLETE' \"$2\" || exit 9\nprintf 'AUTOMATIC_PDF_DIRECTORY_MARKER\\f'\n",
        )
        await chmod(exe, 0o755)
        process.env.CHIPMATE_PDFTOTEXT_PATH = exe
        const cfg = new CodeIndexConfigManager({
          enabled: true,
          embedderProvider: "openai",
          openAiKey: "sk-test",
          documents: { enabled: true },
        })
        service = new DocumentIndexService(
          root,
          path.join(staging, "cache"),
          cfg,
          embedder,
          memory,
          ignore(),
          undefined,
          undefined,
          {
            autoRefresh: true,
            debounceMs: 30,
            maxLatencyMs: 100,
            reconcileIntervalMs: 60_000,
          },
        )

        await service.start("manual")
        await rename(incoming, path.join(root, "incoming"))
        await Bun.sleep(250)
        await appendFile(path.join(root, "incoming", "guide.pdf"), "% COPY_COMPLETE\n")
        await waitFor(() =>
          memory.points().some((point) => point.payload.codeChunk === "AUTOMATIC_PDF_DIRECTORY_MARKER"),
        )

        const results = await service.search("AUTOMATIC_PDF_DIRECTORY_MARKER", { maxResults: 1 })
        expect(results[0]?.filePath).toBe("incoming/guide.pdf")
        expect(results[0]?.sourceRef).toBe("incoming/guide.pdf#page=1")
        expect(service.getStatus().recentErrors ?? []).toHaveLength(0)
      } finally {
        await service?.dispose()
        if (before === undefined) delete process.env.CHIPMATE_PDFTOTEXT_PATH
        else process.env.CHIPMATE_PDFTOTEXT_PATH = before
        await rm(root, { recursive: true, force: true })
        await rm(staging, { recursive: true, force: true })
      }
    })

    test("indexes an approved external PDF with an absolute page reference", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
      const external = await mkdtemp(path.join(tmpdir(), "chipmate-doc-external-"))
      const points: PointStruct[] = []
      const before = process.env.CHIPMATE_PDFTOTEXT_PATH
      try {
        const file = path.join(external, "guide.pdf")
        const exe = path.join(root, "pdftotext")
        await writeFile(file, "%PDF-1.4\n% external document fixture\n")
        await writeFile(
          exe,
          "#!/bin/sh\ncase \"$2\" in *'中文 路径.pdf') printf 'CHIPMATE_PDF_PREFLIGHT_OK\\f';; *) printf 'external PDF page\\f';; esac\n",
        )
        await chmod(exe, 0o755)
        process.env.CHIPMATE_PDFTOTEXT_PATH = exe
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
        if (before === undefined) delete process.env.CHIPMATE_PDFTOTEXT_PATH
        else process.env.CHIPMATE_PDFTOTEXT_PATH = before
        await rm(root, { recursive: true, force: true })
        await rm(external, { recursive: true, force: true })
      }
    })
  }

  test("returns an absolute sheet reference for an approved external spreadsheet", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "chipmate-doc-external-"))
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

  test("assigns distinct vector IDs to repeated spreadsheet chunks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const points: PointStruct[] = []
    try {
      const file = path.join(root, "repeated.xlsx")
      const book = utils.book_new()
      const rows = Array.from({ length: 180 }, () => ["same", "same"])
      utils.book_append_sheet(book, utils.aoa_to_sheet(rows), "Data")
      await writeFile(file, write(book, { type: "buffer", bookType: "xlsx" }))
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true, chunkChars: 20, chunkOverlapChars: 0 },
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
      expect(points.length).toBeGreaterThan(1)
      expect(new Set(points.map((point) => point.id)).size).toBe(points.length)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("applies external include, exclude, and ignore rules relative to the approved root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "chipmate-doc-external-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const external = await mkdtemp(path.join(tmpdir(), "chipmate-doc-external-"))
    const outside = await mkdtemp(path.join(tmpdir(), "chipmate-doc-outside-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
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
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    try {
      const external = path.join(tmpdir(), `chipmate-doc-approved-${randomUUID()}`)
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

  test("promotes an exact content match ahead of a higher vector score", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
    const call = { max: 0, min: 0 }
    try {
      const cfg = new CodeIndexConfigManager({
        enabled: true,
        embedderProvider: "openai",
        openAiKey: "sk-test",
        documents: { enabled: true, paths: ["."] },
      })
      const ranked = {
        ...store,
        search: async (_vector, _prefix, min, max): Promise<VectorStoreSearchResult[]> => {
          call.max = max ?? 0
          call.min = min ?? 0
          return [
            {
              id: "semantic",
              score: 0.95,
              payload: {
                filePath: "semantic.md",
                codeChunk: "相近但不包含精确标记",
                startLine: 1,
                endLine: 1,
              },
            },
            {
              id: "exact",
              score: 0.6,
              payload: {
                filePath: "exact.txt",
                codeChunk: "DOC_EXACT_MARKER_9001 文档内容",
                startLine: 1,
                endLine: 1,
              },
            },
          ]
        },
      } satisfies IVectorStore
      const service = new DocumentIndexService(root, path.join(root, ".cache"), cfg, embedder, ranked, ignore())

      const results = await service.search("DOC_EXACT_MARKER_9001", { maxResults: 1 })

      expect(results.map((item) => item.filePath)).toEqual(["exact.txt"])
      expect(results[0]?.score).toBe(0.6)
      expect(call.max).toBe(4)
      expect(call.min).toBeGreaterThanOrEqual(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("counts unsupported Office formats as skipped", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-doc-workspace-"))
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
