import { describe, expect, test } from "bun:test"
import { disabledIndexingStatus, normalizeIndexingStatus } from "../../src/status"
import type { CodeGraphSidecarStatus } from "../../src/indexing/codegraph"

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
  processedItems?: number
  totalItems?: number
  graph?: CodeGraphSidecarStatus
  graphProgress?: {
    state: "Standby" | "Indexing" | "Indexed" | "Error"
    message?: string
    processedFiles: number
    totalFiles: number
    percent: number
  }
}) {
  return normalizeIndexingStatus({
    isFeatureEnabled: true,
    isFeatureConfigured: true,
    getCodeGraphStatus: () => input.graph ?? graph(),
    getCodeGraphProgress: () => input.graphProgress,
    getCurrentStatus: () => ({
      systemStatus: input.systemStatus,
      message: "indexing",
      processedItems: input.processedItems ?? 0,
      totalItems: input.totalItems ?? 0,
      currentItemUnit: "files",
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

  test("uses active code graph progress while a scan is running", () => {
    const result = status({
      systemStatus: "Indexing",
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
})
