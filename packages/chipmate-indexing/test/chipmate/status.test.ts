import { describe, expect, test } from "bun:test"
import {
  disabledIndexingStatus,
  normalizeIndexingStatus,
  type IndexingNotice,
  type IndexingPipelineRecentErrors,
} from "../../src/status"
import type { CodeGraphSidecarStatus } from "../../src/indexing/codegraph"
import type { DocumentIndexStatus } from "../../src/indexing/documents"

function graph(input: Partial<NonNullable<CodeGraphSidecarStatus["storage"]>> = {}): CodeGraphSidecarStatus {
  return {
    state: "container_ready",
    enabled: true,
    evidenceAvailable: false,
    detail: "container ready",
    workspacePath: "/tmp/ws",
    cacheDirectory: "/tmp/cache",
    transitions: [],
    snippetLimit: 240,
    storage: {
      workspacePath: "/tmp/ws",
      graphSchemaVersion: 1,
      parserVersion: 1,
      recordCount: 4,
      validFileCount: 3,
      parseErrorCount: 1,
      unsupportedCount: 2,
      staleCount: 1,
      schemaMismatch: false,
      parserMismatch: false,
      needsRebuild: false,
      evidenceAvailable: false,
      lastFullScanAt: "2026-06-11T00:00:00.000Z",
      ...input,
    },
  }
}

function status(input: {
  systemStatus: "Standby" | "Indexing" | "Indexed" | "Error"
  isFeatureEnabled?: boolean
  isFeatureConfigured?: boolean
  processedItems?: number
  totalItems?: number
  graph?: CodeGraphSidecarStatus
  recentErrors?: IndexingPipelineRecentErrors
  notices?: IndexingNotice[]
  activePipeline?: "codeGraph" | "rag" | "documents"
  document?: DocumentIndexStatus
  graphProgress?: {
    state: "Standby" | "Indexing" | "Indexed" | "Error"
    message?: string
    processedFiles: number
    totalFiles: number
    percent: number
  }
}) {
  return normalizeIndexingStatus({
    isFeatureEnabled: input.isFeatureEnabled ?? true,
    isFeatureConfigured: input.isFeatureConfigured ?? true,
    getCodeGraphStatus: () => input.graph ?? graph(),
    getCodeGraphProgress: () => input.graphProgress,
    getRecentErrors: () => input.recentErrors ?? {},
    getDocumentStatus: () => input.document,
    getCurrentStatus: () => ({
      systemStatus: input.systemStatus,
      message: "indexing",
      processedItems: input.processedItems ?? 0,
      totalItems: input.totalItems ?? 0,
      currentItemUnit: "files",
      activePipeline: input.activePipeline,
      notices: input.notices,
    }),
  })
}

describe("indexing status pipelines", () => {
  test("disabled status includes disabled code graph and rag pipelines", () => {
    const result = disabledIndexingStatus("off")

    expect(result.pipelines?.codeGraph).toMatchObject({
      state: "Disabled",
      percent: 0,
      errorCount: 0,
      staleCount: 0,
      skippedCount: 0,
    })
    expect(result.pipelines?.rag).toMatchObject({
      state: "Disabled",
      percent: 0,
    })
  })

  test("normalizes rag progress and code graph storage counts", () => {
    const result = status({ systemStatus: "Indexing", processedItems: 2, totalItems: 5 })

    expect(result.pipelines?.rag).toMatchObject({
      state: "In Progress",
      processedFiles: 2,
      totalFiles: 5,
      percent: 40,
    })
    expect(result.pipelines?.codeGraph).toMatchObject({
      state: "Complete",
      processedFiles: 3,
      totalFiles: 4,
      percent: 75,
      errorCount: 1,
      staleCount: 1,
      skippedCount: 2,
      lastFullScanAt: "2026-06-11T00:00:00.000Z",
    })
  })

  test("includes indexing notices from the status source", () => {
    const notices: IndexingNotice[] = [
      {
        id: "rag-lancedb-schema-mismatch-test",
        level: "warning",
        message: "ChipMate is rebuilding the local RAG index.",
        action: "openIndexingOutput",
      },
    ]
    const result = status({ systemStatus: "Indexing", processedItems: 1, totalItems: 3, notices })

    expect(result.notices).toEqual(notices)
  })

  test("keeps code graph visible when RAG indexing is disabled", () => {
    const result = status({
      systemStatus: "Standby",
      isFeatureEnabled: false,
      graph: graph({ validFileCount: 2, recordCount: 3 }),
    })

    expect(result).toMatchObject({
      state: "Disabled",
      pipelines: {
        codeGraph: {
          state: "Complete",
          processedFiles: 2,
          totalFiles: 3,
          percent: 67,
        },
        rag: {
          state: "Disabled",
        },
      },
    })
  })

  test("uses active code graph progress while a scan is running", () => {
    const result = status({
      systemStatus: "Indexing",
      activePipeline: "codeGraph",
      processedItems: 3,
      totalItems: 10,
      graphProgress: {
        state: "Indexing",
        message: "Built 3 / 10 code graph files (30%).",
        processedFiles: 3,
        totalFiles: 10,
        percent: 30,
      },
    })

    expect(result.pipelines?.codeGraph).toMatchObject({
      state: "In Progress",
      processedFiles: 3,
      totalFiles: 10,
      percent: 30,
      errorCount: 1,
      staleCount: 1,
      skippedCount: 2,
    })
  })

  test("marks RAG as waiting during active Code Graph phase without masking Document RAG", () => {
    const result = status({
      systemStatus: "Indexing",
      activePipeline: "codeGraph",
      processedItems: 0,
      totalItems: 5,
      graphProgress: {
        state: "Indexing",
        message: "Built 2 / 5 code graph files (40%).",
        processedFiles: 2,
        totalFiles: 5,
        percent: 40,
      },
      document: {
        state: "In Progress",
        message: "Document RAG indexing...",
        processedFiles: 1,
        totalFiles: 2,
        percent: 50,
        errorCount: 0,
        staleCount: 0,
        skippedCount: 0,
      },
    })

    expect(result.pipelines?.codeGraph).toMatchObject({
      state: "In Progress",
      processedFiles: 2,
      totalFiles: 5,
      percent: 40,
    })
    expect(result.pipelines?.rag).toMatchObject({
      state: "Standby",
      message: "RAG indexing waiting for Code Graph.",
      detail: "Waiting for Code Graph indexing to finish.",
    })
    expect(result.pipelines?.documents).toMatchObject({
      state: "In Progress",
      message: "Document RAG indexing...",
      percent: 50,
    })
  })

  test("keeps Document RAG independent when Code Graph fails", () => {
    const result = status({
      systemStatus: "Error",
      activePipeline: "codeGraph",
      document: {
        state: "Complete",
        message: "Document RAG up-to-date.",
        processedFiles: 2,
        totalFiles: 2,
        percent: 100,
        errorCount: 0,
        staleCount: 0,
        skippedCount: 0,
      },
    })

    expect(result.pipelines?.codeGraph).toMatchObject({ state: "Error", message: "Code Graph indexing failed." })
    expect(result.pipelines?.rag).toMatchObject({ state: "Standby", message: "RAG indexing blocked by Code Graph." })
    expect(result.pipelines?.documents).toMatchObject({
      state: "Complete",
      message: "Document RAG up-to-date.",
    })
  })

  test("keeps Code Graph and Document RAG independent when Code RAG fails", () => {
    const result = status({
      systemStatus: "Error",
      activePipeline: "rag",
      document: {
        state: "Complete",
        message: "Document RAG up-to-date.",
        processedFiles: 2,
        totalFiles: 2,
        percent: 100,
        errorCount: 0,
        staleCount: 0,
        skippedCount: 0,
      },
    })

    expect(result.pipelines?.codeGraph.state).toBe("Complete")
    expect(result.pipelines?.rag.state).toBe("Error")
    expect(result.pipelines?.documents).toMatchObject({
      state: "Complete",
      message: "Document RAG up-to-date.",
    })
  })

  test("reports a Document RAG failure without changing completed code pipelines", () => {
    const result = status({
      systemStatus: "Indexed",
      document: {
        state: "Error",
        message: "Document store failed.",
        processedFiles: 0,
        totalFiles: 0,
        percent: 0,
        errorCount: 1,
        staleCount: 0,
        skippedCount: 0,
      },
    })

    expect(result.pipelines?.codeGraph.state).toBe("Complete")
    expect(result.pipelines?.rag.state).toBe("Complete")
    expect(result.pipelines?.documents).toMatchObject({ state: "Error", message: "Document store failed." })
  })

  test("reports a completed empty Code Graph scan instead of standby", () => {
    const result = status({
      systemStatus: "Indexed",
      graph: graph({ recordCount: 0, validFileCount: 0 }),
    })

    expect(result.pipelines?.codeGraph).toMatchObject({
      state: "Complete",
      message: "Code Graph complete, 0 supported files.",
      percent: 100,
      totalFiles: 0,
    })
  })

  test("ignores stale Code Graph progress during active RAG phase", () => {
    const result = status({
      systemStatus: "Indexing",
      activePipeline: "rag",
      processedItems: 2,
      totalItems: 4,
      graphProgress: {
        state: "Indexing",
        message: "stale graph progress",
        processedFiles: 1,
        totalFiles: 10,
        percent: 10,
      },
    })

    expect(result.pipelines?.codeGraph).toMatchObject({
      state: "Complete",
      processedFiles: 3,
      totalFiles: 4,
      percent: 75,
    })
    expect(result.pipelines?.rag).toMatchObject({
      state: "In Progress",
      processedFiles: 2,
      totalFiles: 4,
      percent: 50,
    })
  })

  test("marks code graph mismatch as an error pipeline without throwing", () => {
    const result = status({
      systemStatus: "Indexed",
      processedItems: 5,
      totalItems: 5,
      graph: graph({ schemaMismatch: true, needsRebuild: true }),
    })

    expect(result.state).toBe("Complete")
    expect(result.pipelines?.rag.state).toBe("Complete")
    expect(result.pipelines?.codeGraph).toMatchObject({
      state: "Error",
      message: "Code Graph needs rebuild.",
      percent: 0,
      totalFiles: 4,
    })
  })

  test("includes recent pipeline errors from the status source", () => {
    const result = status({
      systemStatus: "Error",
      recentErrors: {
        codeGraph: [
          {
            time: "2026-06-15T00:00:00.000Z",
            source: "scan",
            location: "orchestrator:startIndexing",
            message: "tree-sitter parser failed",
            file: "src/main.c",
          },
        ],
        rag: [
          {
            time: "2026-06-15T00:00:01.000Z",
            source: "scan",
            location: "orchestrator:startIndexing",
            message: "LanceDB failed",
          },
        ],
      },
    })

    expect(result.pipelines?.codeGraph.recentErrors?.[0]).toMatchObject({
      source: "scan",
      location: "orchestrator:startIndexing",
      message: "tree-sitter parser failed",
      file: "src/main.c",
    })
    expect(result.pipelines?.rag.recentErrors?.[0]).toMatchObject({
      message: "LanceDB failed",
    })
  })

  test("limits recent errors to five entries", () => {
    const errors = Array.from({ length: 6 }, (_, index) => ({
      time: `2026-06-15T00:00:0${index}.000Z`,
      source: "scan",
      location: "orchestrator:startIndexing",
      message: `error ${index}`,
    }))
    const result = status({
      systemStatus: "Error",
      recentErrors: {
        rag: errors,
      },
    })

    expect(result.pipelines?.rag.recentErrors?.length).toBe(5)
    expect(result.pipelines?.rag.recentErrors?.at(-1)?.message).toBe("error 4")
  })
})
