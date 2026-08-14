import type { Config, ExtensionMessage, IndexingPipelineStatus, IndexingStatus } from "../types/messages"
import type { UiI18nParams } from "@chipmate/chipmate-ui/context"

export type IndexingTone = "muted" | "warning" | "success" | "error"
export type IndexingPipelines = NonNullable<IndexingStatus["pipelines"]>
const UNKNOWN = "Unknown indexing error"

type Params = UiI18nParams
type Translate = (key: string, params?: Params) => string

const states: Record<IndexingStatus["state"], string> = {
  Disabled: "settings.indexing.state.disabled",
  Standby: "settings.indexing.state.standby",
  "In Progress": "settings.indexing.state.inProgress",
  Complete: "settings.indexing.state.complete",
  Error: "settings.indexing.state.error",
}

const messages: Record<string, [string, Params?]> = {
  "Indexing disabled.": ["settings.indexing.message.disabled", { pipeline: "Indexing" }],
  "RAG indexing disabled.": ["settings.indexing.message.disabled", { pipeline: "RAG indexing" }],
  "RAG indexing not configured.": ["settings.indexing.message.notConfigured", { pipeline: "RAG indexing" }],
  "Code Graph indexing failed.": ["settings.indexing.message.failed", { pipeline: "Code Graph" }],
  "RAG indexing blocked by Code Graph.": [
    "settings.indexing.message.blockedBy",
    { pipeline: "RAG", dependency: "Code Graph" },
  ],
  "RAG indexing waiting for Code Graph.": [
    "settings.indexing.message.waitingFor",
    { pipeline: "RAG", dependency: "Code Graph" },
  ],
  "Code Graph must recover before RAG indexing can start.": [
    "settings.indexing.message.recoverBefore",
    { pipeline: "Code Graph", target: "RAG" },
  ],
  "Waiting for Code Graph indexing to finish.": ["settings.indexing.message.waitingFinish", { pipeline: "Code Graph" }],
  "The preceding indexing stage must recover before Document RAG can start.": [
    "settings.indexing.message.previousRecover",
  ],
  "Document RAG starts only after Code Graph and Code RAG complete.": ["settings.indexing.message.documentOrder"],
  "Indexing failed.": ["settings.indexing.message.failed", { pipeline: "Indexing" }],
  "Indexing in progress.": ["settings.indexing.message.inProgress", { pipeline: "Indexing" }],
  "Indexing paused.": ["settings.indexing.message.paused"],
  "Index up-to-date.": ["settings.indexing.message.upToDate", { pipeline: "Index" }],
  "Code Graph disabled.": ["settings.indexing.message.disabled", { pipeline: "Code Graph" }],
  "Code Graph indexing in progress.": ["settings.indexing.message.inProgress", { pipeline: "Code Graph indexing" }],
  "Code Graph waiting for C/C++ files.": ["settings.indexing.message.waitingFiles"],
  "Code Graph waiting for storage.": ["settings.indexing.message.waitingStorage"],
  "Code Graph needs rebuild.": ["settings.indexing.message.needsRebuild"],
  "Code Graph complete, 0 supported files.": ["settings.indexing.message.graphEmpty"],
  "The completed scan found no supported C/C++ files.": ["settings.indexing.message.noSupportedFiles"],
  "No graph records have been written yet.": ["settings.indexing.message.noGraphRecords"],
  "Code Graph indexed.": ["settings.indexing.message.upToDate", { pipeline: "Code Graph" }],
  "Document RAG disabled.": ["settings.indexing.message.disabled", { pipeline: "Document RAG" }],
  "Document RAG service is not active.": ["settings.indexing.message.documentInactive"],
  "Document RAG complete: 0 files.": ["settings.indexing.message.documentEmpty"],
  "Document RAG indexed with issues.": ["settings.indexing.message.documentIssues"],
  "Document RAG up-to-date.": ["settings.indexing.message.upToDate", { pipeline: "Document RAG" }],
  "Discovering document files...": ["settings.indexing.message.documentDiscovering"],
  "Starting Document RAG indexing...": ["settings.indexing.message.documentStarting"],
  "Indexing is initializing.": ["settings.indexing.message.initializing", { pipeline: "Indexing" }],
  "Code Graph unavailable.": ["settings.indexing.message.unavailable", { pipeline: "Code Graph" }],
  "RAG indexing unavailable.": ["settings.indexing.message.unavailable", { pipeline: "RAG" }],
  "Document RAG unavailable.": ["settings.indexing.message.unavailable", { pipeline: "Document RAG" }],
  "Code Graph initializing.": ["settings.indexing.message.initializing", { pipeline: "Code Graph" }],
  "RAG indexing initializing.": ["settings.indexing.message.initializing", { pipeline: "RAG indexing" }],
  "Document RAG initializing.": ["settings.indexing.message.initializing", { pipeline: "Document RAG" }],
  "Waiting for indexing worker.": ["settings.indexing.message.waitingWorker"],
  "Indexing worker is restarting in low-memory mode. Existing committed indexes remain available.": [
    "settings.indexing.message.lowMemoryRestart",
  ],
  "Open a file in the target workspace to view indexing status.": ["settings.indexing.message.openTarget"],
  "Loading indexing status for the current project.": ["settings.indexing.message.loadingProject"],
  "Open a file in a workspace to select a project.": ["settings.indexing.message.openWorkspace"],
  "No workspace folder open": ["settings.indexing.message.noWorkspace"],
  "RAG indexing is not configured. Code Graph is available.": ["settings.indexing.message.ragNotConfiguredGraph"],
  "RAG indexing is disabled. Code Graph is available.": ["settings.indexing.message.ragDisabledGraph"],
  "Waiting for the primary worktree index to become available.": ["settings.indexing.message.waitingBaseline"],
  "Document RAG is not initialized.": ["settings.indexing.message.documentNotInitialized"],
  "Document RAG disabled because Code RAG is disabled.": ["settings.indexing.message.documentDisabledByRag"],
  "No document folders configured.": ["settings.indexing.message.noDocumentFolders"],
  "Document RAG blocked: embeddings are not configured.": ["settings.indexing.message.documentEmbeddingsBlocked"],
  "Document RAG starting.": ["settings.indexing.message.documentStartingShort"],
  "Document RAG requires a configured embedding vector store.": ["settings.indexing.message.documentStoreRequired"],
  "Document RAG requires configured embeddings.": ["settings.indexing.message.documentEmbeddingsRequired"],
  "Document RAG ready.": ["settings.indexing.message.documentReady"],
  "Document RAG waiting for another document indexing run.": ["settings.indexing.message.documentWaitingRun"],
  "Document RAG waiting for Code Graph and Code RAG to finish.": ["settings.indexing.message.documentWaitingPipelines"],
  "Document RAG blocked because Code RAG did not run.": ["settings.indexing.message.documentRagDidNotRun"],
  "Processing file changes...": ["settings.indexing.message.processingChanges"],
  "File changes processed. Index up-to-date.": ["settings.indexing.message.changesProcessed"],
  "Index up-to-date. File queue empty.": ["settings.indexing.message.queueEmpty"],
  "File watcher started. Index up-to-date.": ["settings.indexing.message.watcherStarted"],
  "Code Graph watcher started. Code Graph up-to-date.": ["settings.indexing.message.graphWatcherStarted"],
  "Index up-to-date. File watcher unavailable; changes will be picked up next scan.": [
    "settings.indexing.message.watcherUnavailable",
  ],
  "Index up-to-date. File watcher starting.": ["settings.indexing.message.watcherStarting"],
  "Code Graph up-to-date. File watcher starting.": ["settings.indexing.message.graphWatcherStarting"],
  "Indexing requires a workspace folder.": ["settings.indexing.message.workspaceRequired"],
  "Missing configuration. Save your settings to start indexing.": ["settings.indexing.message.configRequired"],
  "Missing configuration. Save your settings to start RAG indexing.": ["settings.indexing.message.ragConfigRequired"],
  "Initializing services...": ["settings.indexing.message.initializingServices"],
  "Indexing cancelled.": ["settings.indexing.message.cancelled"],
  "Starting Code Graph indexing...": ["settings.indexing.message.startingCodeGraph"],
  "Starting Code Graph indexing before RAG...": ["settings.indexing.message.startingCodeGraphBeforeRag"],
  "Code Graph complete. Starting RAG indexing...": ["settings.indexing.message.codeGraphCompleteStartingRag"],
  "Code Graph complete. Validating embedding configuration...": [
    "settings.indexing.message.codeGraphCompleteValidating",
  ],
  "Checking for new or modified files...": ["settings.indexing.message.checkingFiles"],
  "Services ready. Starting workspace scan...": ["settings.indexing.message.servicesReady"],
  "Embedding settings changed. Starting RAG indexing...": ["settings.indexing.message.embeddingChanged"],
  "Validating embedding configuration before RAG indexing...": ["settings.indexing.message.validatingBeforeRag"],
  "Another indexing run is already active for this workspace.": ["settings.indexing.message.runActive"],
  "Another indexing run is already active for this workspace. Retrying automatically...": [
    "settings.indexing.message.runActiveRetrying",
  ],
  "Workspace changed too quickly; reconciling again shortly.": ["settings.indexing.message.reconciling"],
  "File watcher stopped.": ["settings.indexing.message.watcherStopped"],
  "Index data cleared successfully.": ["settings.indexing.message.cleared"],
  "Indexing files...": ["settings.indexing.message.indexingFiles"],
  "Ready.": ["settings.indexing.message.ready"],
  "An error occurred.": ["settings.indexing.message.errorOccurred"],
}

export function indexingButtonVisible(feature: boolean, show: boolean, config: Config, global: Config) {
  if (!feature) return false
  if (show) return true
  if (global.indexing?.enabled === true) return true
  return config.indexing?.enabled === true
}

export function formatIndexingLabel(status: IndexingStatus, t?: Translate): string {
  const prefix = t?.("settings.indexing.status.badge") ?? "IDX"
  if (status.state === "In Progress") {
    if (status.totalFiles <= 0) return `${prefix} ${stateLabel(status.state, t)}`
    return `${prefix} ${status.percent}% ${status.processedFiles}/${status.totalFiles}`
  }

  if (status.state === "Error") {
    return `${prefix} ${localizeIndexingText(status.message, t)}`
  }

  if (status.state === "Standby") {
    return `${prefix} ${stateLabel(status.state, t)}`
  }

  return `${prefix} ${stateLabel(status.state, t)}`
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

export function formatIndexingPipelineLabel(label: string, status: IndexingPipelineStatus, t?: Translate): string {
  if (status.state === "In Progress") {
    if (status.totalFiles <= 0) return `${label} ${stateLabel(status.state, t)}`
    return `${label} ${status.percent}% ${status.processedFiles}/${status.totalFiles}`
  }
  if (status.state === "Complete") return `${label} ${status.percent}%`
  return `${label} ${stateLabel(status.state, t)}`
}

export function indexingPipelineDescription(status: IndexingPipelineStatus, t?: Translate): string {
  if (status.detail?.trim()) return localizeIndexingText(status.detail, t)
  if (status.recentErrors?.[0]) return indexingDiagnosticMessage(status.recentErrors[0], status)
  if (status.message.trim()) return localizeIndexingText(status.message, t)
  return t?.("settings.indexing.message.unknownError") ?? UNKNOWN
}

export function localizeIndexingText(value: string, t?: Translate): string {
  const text = value.trim()
  if (!t || !text) return text
  const known = messages[text]
  if (known) return t(known[0], localizeParams(known[1], t))

  const blocked = text.match(/^Document RAG blocked by (Code Graph|Code RAG)\.$/)
  if (blocked) {
    return t("settings.indexing.message.blockedBy", {
      pipeline: term("Document RAG", t),
      dependency: term(blocked[1], t),
    })
  }
  const waiting = text.match(/^Document RAG waiting for (Code Graph|Code RAG)\.$/)
  if (waiting) {
    return t("settings.indexing.message.waitingFor", {
      pipeline: term("Document RAG", t),
      dependency: term(waiting[1], t),
    })
  }
  const graph = text.match(/^(\d+)\/(\d+) graph records valid\.$/)
  if (graph) return t("settings.indexing.message.graphRecords", { valid: graph[1], total: graph[2] })
  const limit = text.match(
    /^Document RAG paused after finding more than (\d+) documents\. Narrow document paths or excludes before rebuilding\.$/,
  )
  if (limit) return t("settings.indexing.message.documentLimit", { max: limit[1] })
  const activity = text.match(
    /^(Document extraction issue|Skipped large document|Document unchanged|Indexed document): (.+)$/,
  )
  if (activity) {
    const keys = {
      "Document extraction issue": "settings.indexing.message.documentExtraction",
      "Skipped large document": "settings.indexing.message.documentLarge",
      "Document unchanged": "settings.indexing.message.documentUnchanged",
      "Indexed document": "settings.indexing.message.documentIndexed",
    }
    const key = keys[activity[1] as keyof typeof keys]
    return t(key, { file: activity[2] })
  }
  const stats = text.match(/^(\d+) indexed, (\d+) skipped, (\d+) errors, (\d+) chunks\.$/)
  if (stats) {
    return t("settings.indexing.message.documentStats", {
      indexed: stats[1],
      skipped: stats[2],
      errors: stats[3],
      chunks: stats[4],
    })
  }
  const files = text.match(/^Processed (\d+) \/ (\d+) files \((\d+)%\)\.(?: Current: (.+))?$/)
  if (files) {
    return t("settings.indexing.message.filesProcessed", {
      processed: files[1],
      total: files[2],
      percent: files[3],
      current: files[4] ? t("settings.indexing.message.currentFile", { file: files[4] }) : "",
    })
  }
  const built = text.match(/^Built (\d+) \/ (\d+) code graph files \((\d+)%\)\.(?: Current: (.+))?$/)
  if (built) {
    return t("settings.indexing.message.graphFilesBuilt", {
      processed: built[1],
      total: built[2],
      percent: built[3],
      current: built[4] ? t("settings.indexing.message.currentFile", { file: built[4] }) : "",
    })
  }
  const blockedBecause = text.match(/^Document RAG blocked because (Code Graph|Code RAG) (failed|was cancelled)\.$/)
  if (blockedBecause) {
    return t("settings.indexing.message.documentBlockedBecause", {
      pipeline: term(blockedBecause[1], t),
      reason: t(
        blockedBecause[2] === "failed"
          ? "settings.indexing.message.reasonFailed"
          : "settings.indexing.message.reasonCancelled",
      ),
    })
  }
  const failures = [
    [/^Failed to initialize: (.+)$/, "settings.indexing.message.failedInitialize"],
    [/^Failed to process file changes: (.+)$/, "settings.indexing.message.failedChanges"],
    [/^Failed during initial scan: (.+)$/, "settings.indexing.message.failedInitialScan"],
    [/^Failed during RAG scan: (.+)$/, "settings.indexing.message.failedRagScan"],
    [/^Failed during recovery: (.+)$/, "settings.indexing.message.failedRecovery"],
    [/^Failed to clear vector collection: (.+)$/, "settings.indexing.message.failedClear"],
  ] as const
  for (const [pattern, key] of failures) {
    const match = text.match(pattern)
    if (match) return t(key, { error: match[1] })
  }
  return text
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
  if (status.issueSummary?.length) {
    lines.push("issueSummary:")
    lines.push(...status.issueSummary.map((item) => `- ${item.category}: ${item.count}`))
  }
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

function stateLabel(state: IndexingStatus["state"], t?: Translate): string {
  return t?.(states[state]) ?? state
}

function localizeParams(params: Params | undefined, t: Translate): Params | undefined {
  if (!params) return undefined
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, typeof value === "string" ? term(value, t) : value]),
  )
}

function term(value: string, t: Translate): string {
  const keys: Record<string, string> = {
    Indexing: "settings.indexing.term.indexing",
    Index: "settings.indexing.term.index",
    "RAG indexing": "settings.indexing.term.ragIndexing",
    "Code Graph": "settings.indexing.pipeline.codeGraph",
    "Code Graph indexing": "settings.indexing.term.codeGraphIndexing",
    RAG: "settings.indexing.pipeline.rag",
    "Code RAG": "settings.indexing.pipeline.rag",
    "Document RAG": "settings.indexing.pipeline.documents",
  }
  return keys[value] ? t(keys[value]) : value
}
