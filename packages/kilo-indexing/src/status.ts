import z from "zod"
import type { CodeGraphSidecarStatus } from "./indexing/codegraph"
import type { IndexingState } from "./indexing/interfaces/manager"

type StatusSource = {
  readonly isFeatureEnabled: boolean
  readonly isFeatureConfigured: boolean
  getCodeGraphStatus?(): CodeGraphSidecarStatus
  getCodeGraphProgress?(): ActivePipelineProgress | undefined
  getCurrentStatus(): {
    systemStatus: IndexingState
    message?: string
    processedItems: number
    totalItems: number
    currentItemUnit: string
  }
}

type ActivePipelineProgress = {
  state: IndexingState
  message?: string
  processedFiles: number
  totalFiles: number
  percent: number
}

export const INDEXING_STATUS_STATES = ["Disabled", "In Progress", "Complete", "Error", "Standby"] as const

export const IndexingStatusState = z.enum(INDEXING_STATUS_STATES).meta({ ref: "IndexingStatusState" })

export type IndexingStatusState = z.infer<typeof IndexingStatusState>

export const IndexingPipelineStatus = z
  .object({
    state: IndexingStatusState,
    message: z.string(),
    processedFiles: z.number().int().nonnegative(),
    totalFiles: z.number().int().nonnegative(),
    percent: z.number().int().min(0).max(100),
    detail: z.string().optional(),
    lastFullScanAt: z.string().optional(),
    errorCount: z.number().int().nonnegative(),
    staleCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    validFileCount: z.number().int().nonnegative().optional(),
  })
  .meta({ ref: "IndexingPipelineStatus" })

export type IndexingPipelineStatus = z.infer<typeof IndexingPipelineStatus>

export const IndexingStatusPipelines = z
  .object({
    codeGraph: IndexingPipelineStatus,
    rag: IndexingPipelineStatus,
  })
  .meta({ ref: "IndexingStatusPipelines" })

export type IndexingStatusPipelines = z.infer<typeof IndexingStatusPipelines>

export const IndexingStatus = z
  .object({
    state: IndexingStatusState,
    message: z.string(),
    processedFiles: z.number().int().nonnegative(),
    totalFiles: z.number().int().nonnegative(),
    percent: z.number().int().min(0).max(100),
    pipelines: IndexingStatusPipelines.optional(),
  })
  .meta({ ref: "IndexingStatus" })

export type IndexingStatus = z.infer<typeof IndexingStatus>

export function disabledIndexingStatus(message = "Indexing disabled."): IndexingStatus {
  return {
    state: "Disabled",
    message,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    pipelines: disabledPipelines(message),
  }
}

export function normalizeIndexingStatus(manager: StatusSource): IndexingStatus {
  const cfg = manager.getCurrentStatus()
  const files = cfg.currentItemUnit === "files"
  const processedFiles = files ? cfg.processedItems : 0
  const totalFiles = files ? cfg.totalItems : 0
  const percent = totalFiles > 0 ? Math.min(100, Math.max(0, Math.round((processedFiles / totalFiles) * 100))) : 0

  if (!manager.isFeatureEnabled || !manager.isFeatureConfigured) return disabledIndexingStatus(cfg.message || "Indexing disabled.")

  const finish = (status: Omit<IndexingStatus, "pipelines">): IndexingStatus => ({
    ...status,
    pipelines: {
      codeGraph: codeGraphPipeline(
        manager.getCodeGraphStatus?.(),
        cfg.systemStatus === "Indexing" ? manager.getCodeGraphProgress?.() : undefined,
      ),
      rag: ragPipeline(status),
    },
  })

  if (cfg.systemStatus === "Error") {
    return finish({
      state: "Error",
      message: cfg.message || "Indexing failed.",
      processedFiles,
      totalFiles,
      percent,
    })
  }

  if (cfg.systemStatus === "Indexing") {
    return finish({
      state: "In Progress",
      message: cfg.message || "Indexing in progress.",
      processedFiles,
      totalFiles,
      percent,
    })
  }

  if (cfg.systemStatus === "Standby") {
    return finish({
      state: "Standby",
      message: cfg.message || "Indexing paused.",
      processedFiles,
      totalFiles,
      percent,
    })
  }

  return finish({
    state: "Complete",
    message: cfg.message || "Index up-to-date.",
    processedFiles,
    totalFiles,
    percent: totalFiles > 0 ? percent : 100,
  })
}

function disabledPipelines(message: string): IndexingStatusPipelines {
  const status = pipeline({
    state: "Disabled",
    message,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    detail: message,
  })
  return {
    codeGraph: { ...status, message: "Code Graph disabled." },
    rag: { ...status, message: "RAG indexing disabled." },
  }
}

function ragPipeline(status: Omit<IndexingStatus, "pipelines">): IndexingPipelineStatus {
  return pipeline({
    state: status.state,
    message: status.message,
    processedFiles: status.processedFiles,
    totalFiles: status.totalFiles,
    percent: status.percent,
    detail: status.message,
  })
}

function codeGraphPipeline(status?: CodeGraphSidecarStatus, active?: ActivePipelineProgress): IndexingPipelineStatus {
  if (!status || !status.enabled || status.state === "disabled") {
    return pipeline({
      state: "Disabled",
      message: "Code Graph disabled.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      detail: status?.detail ?? "indexing-not-active",
    })
  }

  const storage = status.storage
  if (active && active.state === "Indexing") {
    return pipeline({
      state: "In Progress",
      message: active.message || "Code Graph indexing in progress.",
      processedFiles: active.processedFiles,
      totalFiles: active.totalFiles,
      percent: active.percent,
      detail: active.message,
      lastFullScanAt: storage?.lastFullScanAt,
      errorCount: storage?.parseErrorCount ?? 0,
      staleCount: storage?.staleCount ?? 0,
      skippedCount: storage?.unsupportedCount ?? 0,
      validFileCount: storage?.validFileCount,
    })
  }

  if (active && active.totalFiles <= 0) {
    return pipeline({
      state: "Standby",
      message: active.message || "Code Graph waiting for C/C++ files.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      detail: active.message,
      lastFullScanAt: storage?.lastFullScanAt,
      errorCount: storage?.parseErrorCount ?? 0,
      staleCount: storage?.staleCount ?? 0,
      skippedCount: storage?.unsupportedCount ?? 0,
      validFileCount: storage?.validFileCount,
    })
  }

  if (!storage) {
    return pipeline({
      state: status.state === "container_ready" ? "Standby" : "Disabled",
      message: status.detail || "Code Graph waiting for storage.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      detail: status.detail,
    })
  }

  const total = storage.recordCount
  const valid = storage.validFileCount
  const error = storage.parseErrorCount
  const stale = storage.staleCount
  const skipped = storage.unsupportedCount

  if (storage.schemaMismatch || storage.parserMismatch || storage.needsRebuild) {
    return pipeline({
      state: "Error",
      message: "Code Graph needs rebuild.",
      processedFiles: 0,
      totalFiles: total,
      percent: 0,
      detail: [
        storage.schemaMismatch ? "schema mismatch" : undefined,
        storage.parserMismatch ? "parser mismatch" : undefined,
        storage.needsRebuild ? "needs rebuild" : undefined,
      ]
        .filter(Boolean)
        .join(", "),
      lastFullScanAt: storage.lastFullScanAt,
      errorCount: error,
      staleCount: stale,
      skippedCount: skipped,
      validFileCount: valid,
    })
  }

  if (total <= 0) {
    return pipeline({
      state: "Standby",
      message: "Code Graph waiting for C/C++ files.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      detail: "No graph records have been written yet.",
      lastFullScanAt: storage.lastFullScanAt,
      errorCount: error,
      staleCount: stale,
      skippedCount: skipped,
      validFileCount: valid,
    })
  }

  return pipeline({
    state: "Complete",
    message: "Code Graph indexed.",
    processedFiles: valid,
    totalFiles: total,
    percent: pct(valid, total),
    detail: `${valid}/${total} graph records valid.`,
    lastFullScanAt: storage.lastFullScanAt,
    errorCount: error,
    staleCount: stale,
    skippedCount: skipped,
    validFileCount: valid,
  })
}

function pipeline(input: Partial<IndexingPipelineStatus> & Pick<IndexingPipelineStatus, "state" | "message">): IndexingPipelineStatus {
  return {
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    errorCount: 0,
    staleCount: 0,
    skippedCount: 0,
    ...input,
  }
}

function pct(processed: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((processed / total) * 100)))
}
