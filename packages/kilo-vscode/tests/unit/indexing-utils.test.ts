import { describe, expect, it } from "bun:test"
import {
  applyIndexingStatusMessage,
  ensureIndexingPipelines,
  formatIndexingDiagnostic,
  formatIndexingDiagnostics,
  formatIndexingLabel,
  formatIndexingPipelineLabel,
  hasIndexingDiagnostics,
  indexingDiagnosticMessage,
  indexingPipelineDescription,
  indexingPipelineTone,
  indexingButtonVisible,
  indexingTone,
} from "../../webview-ui/src/context/indexing-utils"
import { mapSSEEventToWebviewMessage } from "../../src/kilo-provider-utils"
import { configFeatures } from "../../src/features"
import type { EventIndexingStatus, IndexingStatus } from "@kilocode/sdk/v2/client"

function makeStatus(overrides: Partial<IndexingStatus> = {}): IndexingStatus {
  return {
    state: "Disabled",
    message: "Indexing disabled.",
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    ...overrides,
  }
}

describe("indexing button visibility", () => {
  it("hides the button when the indexing feature is unavailable", () => {
    expect(indexingButtonVisible(false, true, { indexing: { enabled: true } }, { indexing: { enabled: true } })).toBe(
      false,
    )
  })

  it("shows the button while indexing is off by default", () => {
    expect(indexingButtonVisible(true, true, {}, {})).toBe(true)
  })

  it("hides the button when indexing is off and the preference is disabled", () => {
    expect(indexingButtonVisible(true, false, {}, {})).toBe(false)
  })

  it("shows the button when project indexing is enabled", () => {
    expect(indexingButtonVisible(true, false, { indexing: { enabled: true } }, {})).toBe(true)
    expect(indexingButtonVisible(true, false, { indexing: { enabled: true } }, { indexing: { enabled: false } })).toBe(
      true,
    )
  })

  it("stays hidden when global and project indexing are off", () => {
    expect(indexingButtonVisible(true, false, { indexing: { enabled: false } }, { indexing: { enabled: false } })).toBe(
      false,
    )
  })

  it("shows the button whenever global indexing is enabled", () => {
    expect(indexingButtonVisible(true, false, { indexing: { enabled: false } }, { indexing: { enabled: true } })).toBe(
      true,
    )
  })
})

describe("indexing formatting", () => {
  it("formats in-progress status like the TUI", () => {
    const status = makeStatus({ state: "In Progress", percent: 42, processedFiles: 21, totalFiles: 50 })
    expect(formatIndexingLabel(status)).toBe("IDX 42% 21/50")
  })

  it("formats indeterminate in-progress status without 0/0 counts", () => {
    const status = makeStatus({ state: "In Progress", percent: 0, processedFiles: 0, totalFiles: 0 })
    expect(formatIndexingLabel(status)).toBe("IDX In Progress")
  })

  it("formats error status with the backend message", () => {
    const status = makeStatus({ state: "Error", message: "Indexing failed." })
    expect(formatIndexingLabel(status)).toBe("IDX Indexing failed.")
  })

  it("formats complete and disabled states with the public state label", () => {
    expect(formatIndexingLabel(makeStatus({ state: "Complete" }))).toBe("IDX Complete")
    expect(formatIndexingLabel(makeStatus({ state: "Disabled" }))).toBe("IDX Disabled")
    expect(formatIndexingLabel(makeStatus({ state: "Standby" }))).toBe("IDX Standby")
  })

  it("maps tones by status", () => {
    expect(indexingTone(makeStatus({ state: "Disabled" }))).toBe("muted")
    expect(indexingTone(makeStatus({ state: "Standby" }))).toBe("muted")
    expect(indexingTone(makeStatus({ state: "In Progress" }))).toBe("warning")
    expect(indexingTone(makeStatus({ state: "Complete" }))).toBe("success")
    expect(indexingTone(makeStatus({ state: "Error" }))).toBe("error")
  })

  it("normalizes missing pipelines for older status payloads", () => {
    const pipelines = ensureIndexingPipelines(
      makeStatus({ state: "In Progress", processedFiles: 3, totalFiles: 10, percent: 30 }),
    )

    expect(pipelines.codeGraph).toMatchObject({
      state: "In Progress",
      percent: 30,
      errorCount: 0,
      staleCount: 0,
      skippedCount: 0,
    })
    expect(pipelines.rag.processedFiles).toBe(3)
    expect(pipelines.documents.processedFiles).toBe(3)
  })

  it("formats and tones individual pipeline statuses", () => {
    const status = {
      state: "Complete" as const,
      message: "Code Graph indexed.",
      processedFiles: 8,
      totalFiles: 10,
      percent: 80,
      errorCount: 1,
      staleCount: 0,
      skippedCount: 1,
    }

    expect(formatIndexingPipelineLabel("CG", status)).toBe("CG 80%")
    expect(indexingPipelineTone(status)).toBe("warning")
  })

  it("formats indeterminate pipeline progress without 0/0 counts", () => {
    const status = {
      state: "In Progress" as const,
      message: "Discovering files.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      errorCount: 0,
      staleCount: 0,
      skippedCount: 0,
    }

    expect(formatIndexingPipelineLabel("RAG", status)).toBe("RAG In Progress")
  })

  it("uses recent errors as pipeline detail fallback and copy text", () => {
    const status = {
      state: "Error" as const,
      message: "RAG indexing unavailable.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      errorCount: 1,
      staleCount: 0,
      skippedCount: 0,
      recentErrors: [
        {
          time: "2026-06-15T00:00:00.000Z",
          source: "scan",
          location: "orchestrator:startIndexing",
          message: "LanceDB failed to initialize",
          file: "src/main.c",
        },
      ],
    }

    expect(indexingPipelineDescription(status)).toBe("LanceDB failed to initialize")
    expect(formatIndexingDiagnostics("RAG", status)).toContain(
      "scan:orchestrator:startIndexing file=src/main.c - LanceDB failed to initialize",
    )
  })

  it("falls back when recent error message is empty", () => {
    const status = {
      state: "Error" as const,
      message: "RAG indexing unavailable.",
      detail: "Failed to initialize: LanceDB unavailable",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      errorCount: 1,
      staleCount: 0,
      skippedCount: 0,
      recentErrors: [
        {
          time: "2026-06-15T00:00:00.000Z",
          source: "indexing",
          location: "indexing:initialize",
          message: "",
        },
      ],
    }

    expect(indexingDiagnosticMessage(status.recentErrors[0], status)).toBe("Failed to initialize: LanceDB unavailable")
    expect(formatIndexingDiagnostic(status.recentErrors[0], status)).toContain(
      "indexing:indexing:initialize - Failed to initialize: LanceDB unavailable",
    )
  })

  it("copies pipeline diagnostics even when recentErrors is missing", () => {
    const status = {
      state: "Error" as const,
      message: "Code Graph unavailable.",
      detail: "Code Graph needs rebuild.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      errorCount: 1,
      staleCount: 0,
      skippedCount: 0,
    }

    expect(hasIndexingDiagnostics(status)).toBe(true)
    expect(formatIndexingDiagnostics("Code Graph", status)).toContain("- Code Graph needs rebuild.")
  })
})

describe("indexing SSE mapping", () => {
  it("maps indexing.status to indexingStatusLoaded", () => {
    const event: EventIndexingStatus = {
      type: "indexing.status",
      properties: {
        status: makeStatus({ state: "Complete", percent: 100 }),
      },
    }

    const msg = mapSSEEventToWebviewMessage(event, undefined)
    expect(msg?.type).toBe("indexingStatusLoaded")
    if (msg?.type === "indexingStatusLoaded") {
      expect(msg.status.state).toBe("Complete")
      expect(msg.status.percent).toBe(100)
    }
  })

  it("maps indexing.status regardless of sessionID (filtering is caller responsibility)", () => {
    const event: EventIndexingStatus = {
      type: "indexing.status",
      properties: {
        status: makeStatus({ state: "Disabled", message: "Indexing is disabled in worktree sessions." }),
      },
    }

    const msg = mapSSEEventToWebviewMessage(event, undefined)
    expect(msg?.type).toBe("indexingStatusLoaded")
    if (msg?.type === "indexingStatusLoaded") {
      expect(msg.status.state).toBe("Disabled")
      expect(msg.status.message).toBe("Indexing is disabled in worktree sessions.")
    }
  })
})

describe("indexing feature detection", () => {
  it("enables indexing settings when the indexing plugin is present", () => {
    expect(configFeatures({ plugin: ["kilo-indexing"] }).indexing).toBe(true)
  })

  it("detects supported indexing plugin specifiers", () => {
    expect(configFeatures({ plugin: ["kilo-indexing"] }).indexing).toBe(true)
    expect(configFeatures({ plugin: ["kilo-indexing@1.2.3"] }).indexing).toBe(true)
    expect(configFeatures({ plugin: ["@kilocode/kilo-indexing"] }).indexing).toBe(true)
    expect(configFeatures({ plugin: ["@kilocode/kilo-indexing@1.2.3"] }).indexing).toBe(true)
    expect(configFeatures({ plugin: ["file:///tmp/.opencode/plugin/kilo-indexing.js"] }).indexing).toBe(true)
    expect(configFeatures({ plugin: ["file:///tmp/node_modules/@kilocode/kilo-indexing/index.js"] }).indexing).toBe(
      true,
    )
  })

  it("ignores unrelated plugin lists", () => {
    expect(configFeatures({ plugin: ["@kilocode/kilo-gateway"] }).indexing).toBe(false)
    expect(configFeatures({ plugin: ["file:///tmp/.opencode/plugin/index.js"] }).indexing).toBe(false)
    expect(configFeatures({}).indexing).toBe(false)
  })
})

describe("indexing status message handling", () => {
  it("applies indexing status regardless of feature-toggle race", () => {
    let status = makeStatus()
    let loading = true
    const applied = applyIndexingStatusMessage(
      {
        type: "indexingStatusLoaded",
        status: makeStatus({
          state: "In Progress",
          message: "Indexing",
          processedFiles: 5,
          totalFiles: 20,
          percent: 25,
        }),
      },
      (next) => {
        status = next
      },
      (next) => {
        loading = next
      },
    )

    expect(applied).toBe(true)
    expect(status.state).toBe("In Progress")
    expect(status.percent).toBe(25)
    expect(loading).toBe(false)
  })

  it("ignores unrelated extension messages", () => {
    let status = makeStatus()
    let loading = true
    const applied = applyIndexingStatusMessage(
      {
        type: "connectionState",
        state: "connected",
      },
      (next) => {
        status = next
      },
      (next) => {
        loading = next
      },
    )

    expect(applied).toBe(false)
    expect(status.state).toBe("Disabled")
    expect(loading).toBe(true)
  })
})
