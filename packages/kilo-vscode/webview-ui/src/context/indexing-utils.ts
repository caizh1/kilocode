import type { ExtensionMessage, IndexingPipelineStatus, IndexingStatus } from "../types/messages"

export type IndexingTone = "muted" | "warning" | "success" | "error"
export type IndexingPipelines = NonNullable<IndexingStatus["pipelines"]>

export function formatIndexingLabel(status: IndexingStatus): string {
  if (status.state === "In Progress") {
    if (status.totalFiles <= 0) return "IDX In Progress"
    return `IDX ${status.percent}% ${status.processedFiles}/${status.totalFiles}`
  }

  if (status.state === "Error") {
    return `IDX ${status.message}`
  }

  if (status.state === "Standby") {
    return "IDX Standby"
  }

  return `IDX ${status.state}`
}

export function indexingTone(status: IndexingStatus): IndexingTone {
  if (status.state === "Complete") return "success"
  if (status.state === "Error") return "error"
  if (status.state === "In Progress") return "warning"
  if (status.state === "Standby") return "muted"
  return "muted"
}

export function indexingPipelineTone(status: IndexingPipelineStatus): IndexingTone {
  if (status.state === "Error") return "error"
  if (status.state === "In Progress") return "warning"
  if (status.state === "Complete" && (status.errorCount > 0 || status.staleCount > 0 || status.percent < 100)) {
    return "warning"
  }
  if (status.state === "Complete") return "success"
  return "muted"
}

export function ensureIndexingPipelines(status: IndexingStatus): IndexingPipelines {
  if (status.pipelines) return status.pipelines
  return {
    codeGraph: fallbackPipeline(status, "Code Graph status unavailable."),
    rag: fallbackPipeline(status, status.message || "RAG indexing status unavailable."),
  }
}

export function formatIndexingPipelineLabel(label: string, status: IndexingPipelineStatus): string {
  if (status.state === "In Progress") {
    if (status.totalFiles <= 0) return `${label} In Progress`
    return `${label} ${status.percent}% ${status.processedFiles}/${status.totalFiles}`
  }
  if (status.state === "Complete") return `${label} ${status.percent}%`
  return `${label} ${status.state}`
}

export function applyIndexingStatusMessage(
  message: ExtensionMessage,
  setStatus: (status: IndexingStatus) => void,
  setLoading: (value: boolean) => void,
): boolean {
  if (message.type !== "indexingStatusLoaded") return false
  setStatus(message.status)
  setLoading(false)
  return true
}

function fallbackPipeline(status: IndexingStatus, message: string): IndexingPipelineStatus {
  return {
    state: status.state,
    message,
    processedFiles: status.processedFiles,
    totalFiles: status.totalFiles,
    percent: status.percent,
    detail: status.message,
    errorCount: status.state === "Error" ? 1 : 0,
    staleCount: 0,
    skippedCount: 0,
  }
}
