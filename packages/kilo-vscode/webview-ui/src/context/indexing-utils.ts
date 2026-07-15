import type { Config, ExtensionMessage, IndexingPipelineStatus, IndexingStatus } from "../types/messages"

export type IndexingTone = "muted" | "warning" | "success" | "error"
export type IndexingPipelines = NonNullable<IndexingStatus["pipelines"]>
const UNKNOWN = "Unknown indexing error"

export function indexingButtonVisible(feature: boolean, show: boolean, config: Config, global: Config) {
  if (!feature) return false
  if (show) return true
  if (global.indexing?.enabled === true) return true
  return config.indexing?.enabled === true
}

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
    documents: fallbackPipeline(status, status.message || "Document RAG status unavailable."),
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

export function indexingPipelineDescription(status: IndexingPipelineStatus): string {
  return fallback(
    status.detail,
    status.recentErrors?.[0] ? indexingDiagnosticMessage(status.recentErrors[0], status) : undefined,
    status.message,
    UNKNOWN,
  )
}

export function indexingDiagnosticMessage(
  error: NonNullable<IndexingPipelineStatus["recentErrors"]>[number],
  status?: IndexingPipelineStatus,
): string {
  return fallback(error.message, status?.detail, status?.message, UNKNOWN)
}

export function formatIndexingDiagnostic(
  error: NonNullable<IndexingPipelineStatus["recentErrors"]>[number],
  status?: IndexingPipelineStatus,
): string {
  const file = error.file ? ` file=${error.file}` : ""
  return `${error.time} ${error.source}:${error.location}${file} - ${indexingDiagnosticMessage(error, status)}`
}

export function formatIndexingDiagnostics(label: string, status: IndexingPipelineStatus): string {
  const lines = [
    `${label}: ${status.state}`,
    `message: ${status.message}`,
    `detail: ${indexingPipelineDescription(status)}`,
    `progress: ${status.percent}% (${status.processedFiles}/${status.totalFiles})`,
    `issues: ${status.errorCount} errors, ${status.staleCount} stale, ${status.skippedCount} skipped`,
  ]
  const errors = status.recentErrors ?? []
  if (errors.length > 0) {
    lines.push("recentErrors:")
    lines.push(...errors.map((error) => `- ${formatIndexingDiagnostic(error, status)}`))
  } else if (hasIndexingDiagnostics(status)) {
    lines.push("recentErrors:")
    lines.push(`- ${indexingPipelineDescription(status)}`)
  }
  return lines.join("\n")
}

export function hasIndexingDiagnostics(status: IndexingPipelineStatus): boolean {
  return (
    status.state === "Error" || status.errorCount > 0 || status.staleCount > 0 || (status.recentErrors?.length ?? 0) > 0
  )
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

function fallback(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? ""
}
