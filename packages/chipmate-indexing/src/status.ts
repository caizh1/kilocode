import z from "zod"
import type { CodeGraphSidecarStatus } from "./indexing/codegraph"
import type { DocumentIndexStatus } from "./indexing/documents"
import { DOCUMENT_ISSUE_CATEGORIES } from "./indexing/documents/types"
import type { IndexingNotice as StateIndexingNotice, IndexingState } from "./indexing/interfaces/manager"

type StatusSource = {
  readonly isFeatureEnabled: boolean
  readonly isFeatureConfigured: boolean
  getCodeGraphStatus?(): CodeGraphSidecarStatus
  getCodeGraphProgress?(): ActivePipelineProgress | undefined
  getDocumentStatus?(): DocumentIndexStatus
  getRecentErrors?(): IndexingPipelineRecentErrors
  getCurrentStatus(): {
    systemStatus: IndexingState
    message?: string
    processedItems: number
    totalItems: number
    currentItemUnit: string
    percent?: number
    activePipeline?: "codeGraph" | "rag" | "documents"
    codePending?: boolean
    notices?: StateIndexingNotice[]
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

export const IndexingDiagnostic = z
  .object({
    time: z.string(),
    source: z.string(),
    location: z.string(),
    message: z.string(),
    file: z.string().optional(),
    category: z.enum(DOCUMENT_ISSUE_CATEGORIES).optional(),
  })
  .meta({ ref: "IndexingDiagnostic" })

export type IndexingDiagnostic = z.infer<typeof IndexingDiagnostic>

export const DocumentIssueSummary = z
  .object({
    category: z.enum(DOCUMENT_ISSUE_CATEGORIES),
    count: z.number().int().nonnegative(),
    samples: z
      .array(
        z.object({
          file: z.string().optional(),
          message: z.string(),
        }),
      )
      .max(3),
  })
  .meta({ ref: "DocumentIssueSummary" })

export type IndexingPipelineRecentErrors = {
  codeGraph?: IndexingDiagnostic[]
  rag?: IndexingDiagnostic[]
  documents?: IndexingDiagnostic[]
}

export const IndexingNotice = z
  .object({
    id: z.string(),
    level: z.enum(["info", "warning"]),
    message: z.string(),
    action: z.enum(["openIndexingOutput"]).optional(),
  })
  .meta({ ref: "IndexingNotice" })

export type IndexingNotice = z.infer<typeof IndexingNotice>

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
    issueSummary: z.array(DocumentIssueSummary).optional(),
    diagnosticRunId: z.string().optional(),
    recentErrors: z.array(IndexingDiagnostic).max(5).optional(),
  })
  .meta({ ref: "IndexingPipelineStatus" })

export type IndexingPipelineStatus = z.infer<typeof IndexingPipelineStatus>

export const IndexingStatusPipelines = z
  .object({
    codeGraph: IndexingPipelineStatus,
    rag: IndexingPipelineStatus,
    documents: IndexingPipelineStatus,
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
    notices: z.array(IndexingNotice).max(5).optional(),
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
  const status = normalizeState(manager)
  const cfg = manager.getCurrentStatus()
  if (cfg.activePipeline !== "documents") return status
  const documents = status.pipelines?.documents
  if (!documents) return status
  if (cfg.codePending && status.pipelines) {
    status.pipelines.codeGraph = standbyPipeline(
      "等待文档阶段结束",
      "文档阶段结束后自动建立 Code Graph。",
      manager.getRecentErrors?.()?.codeGraph,
    )
    if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
      status.pipelines.rag = standbyPipeline(
        "等待文档阶段结束",
        "文档阶段和 Code Graph 结束后自动建立 Code RAG。",
        manager.getRecentErrors?.()?.rag,
      )
    }
  }
  return {
    ...status,
    state: "In Progress",
    message: documents.message,
    processedFiles: documents.processedFiles,
    totalFiles: documents.totalFiles,
    percent: Math.min(99, documents.percent),
  }
}

function normalizeState(manager: StatusSource): IndexingStatus {
  const cfg = manager.getCurrentStatus()
  const files = cfg.currentItemUnit === "files"
  const processedFiles = files ? cfg.processedItems : 0
  const totalFiles = files ? cfg.totalItems : 0
  const calculated = totalFiles > 0 ? Math.min(100, Math.max(0, Math.round((processedFiles / totalFiles) * 100))) : 0
  const percent =
    cfg.systemStatus === "Indexing"
      ? Math.min(99, calculated)
      : cfg.systemStatus === "Indexed"
        ? 100
        : Math.min(100, Math.max(0, cfg.percent ?? calculated))
  const graphStatus = manager.getCodeGraphStatus?.()
  const graphProgress =
    cfg.systemStatus === "Indexing" && cfg.activePipeline !== "rag" ? manager.getCodeGraphProgress?.() : undefined
  const errors = manager.getRecentErrors?.()
  const graphErrors = errors?.codeGraph
  const ragErrors = errors?.rag
  const docErrors = errors?.documents
  const docStatus = manager.getDocumentStatus?.()
  const notices = cfg.notices?.slice(0, 5)
  const notice = notices && notices.length > 0 ? { notices } : {}

  if (!manager.isFeatureEnabled || !manager.isFeatureConfigured) {
    const message =
      cfg.message || (!manager.isFeatureEnabled ? "RAG indexing disabled." : "RAG indexing not configured.")
    return {
      state: cfg.systemStatus === "Indexing" ? "In Progress" : cfg.systemStatus === "Error" ? "Error" : "Disabled",
      message,
      processedFiles,
      totalFiles,
      percent,
      ...notice,
      pipelines: {
        codeGraph: codeGraphPipeline(graphStatus, graphProgress, graphErrors),
        rag: disabledPipeline(message, ragErrors),
        documents: documentPipeline(docStatus, docErrors),
      },
    }
  }

  const finish = (status: Omit<IndexingStatus, "pipelines">): IndexingStatus => ({
    ...status,
    ...notice,
    pipelines: {
      codeGraph:
        cfg.activePipeline === "codeGraph" && cfg.systemStatus === "Error"
          ? {
              ...codeGraphPipeline(graphStatus, graphProgress, graphErrors),
              state: "Error",
              message: "Code Graph indexing failed.",
              detail: cfg.message || "Code Graph indexing failed.",
            }
          : codeGraphPipeline(graphStatus, graphProgress, graphErrors),
      rag:
        cfg.activePipeline === "codeGraph"
          ? standbyPipeline(
              cfg.systemStatus === "Error"
                ? "RAG indexing blocked by Code Graph."
                : "RAG indexing waiting for Code Graph.",
              cfg.systemStatus === "Error"
                ? "Code Graph must recover before RAG indexing can start."
                : "Waiting for Code Graph indexing to finish.",
              ragErrors,
            )
          : ragPipeline(status, ragErrors),
      documents: documentPipeline(docStatus, docErrors),
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

function disabledPipelines(message: string, errors?: IndexingPipelineRecentErrors): IndexingStatusPipelines {
  return {
    codeGraph: { ...disabledPipeline(message, errors?.codeGraph), message: "Code Graph disabled." },
    rag: disabledPipeline(message, errors?.rag),
    documents: documentPipeline(undefined, errors?.documents),
  }
}

function disabledPipeline(message: string, recentErrors?: IndexingDiagnostic[]): IndexingPipelineStatus {
  return pipeline({
    state: "Disabled",
    message: "RAG indexing disabled.",
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    detail: message,
    recentErrors,
  })
}

function standbyPipeline(message: string, detail: string, recentErrors?: IndexingDiagnostic[]): IndexingPipelineStatus {
  return pipeline({
    state: "Standby",
    message,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    detail,
    recentErrors,
  })
}

function ragPipeline(
  status: Omit<IndexingStatus, "pipelines">,
  recentErrors?: IndexingDiagnostic[],
): IndexingPipelineStatus {
  return pipeline({
    state: status.state,
    message: status.message,
    processedFiles: status.processedFiles,
    totalFiles: status.totalFiles,
    percent: status.percent,
    detail: status.message,
    recentErrors,
  })
}

function codeGraphPipeline(
  status?: CodeGraphSidecarStatus,
  active?: ActivePipelineProgress,
  recentErrors?: IndexingDiagnostic[],
): IndexingPipelineStatus {
  if (!status || !status.enabled || status.state === "disabled") {
    return pipeline({
      state: "Disabled",
      message: "Code Graph disabled.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      detail: status?.detail ?? "indexing-not-active",
      recentErrors,
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
      recentErrors,
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
      recentErrors,
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
      recentErrors,
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
      recentErrors,
    })
  }

  if (total <= 0) {
    if (storage.lastFullScanAt) {
      return pipeline({
        state: "Complete",
        message: "Code Graph complete, 0 supported files.",
        processedFiles: 0,
        totalFiles: 0,
        percent: 100,
        detail: "The completed scan found no supported C/C++ files.",
        lastFullScanAt: storage.lastFullScanAt,
        errorCount: error,
        staleCount: stale,
        skippedCount: skipped,
        validFileCount: valid,
        recentErrors,
      })
    }
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
      recentErrors,
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
    recentErrors,
  })
}

function documentPipeline(status?: DocumentIndexStatus, recentErrors?: IndexingDiagnostic[]): IndexingPipelineStatus {
  if (!status) {
    return pipeline({
      state: "Disabled",
      message: "Document RAG disabled.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      detail: "Document RAG service is not active.",
      recentErrors,
    })
  }

  return pipeline({
    state: status.state,
    message: status.message,
    processedFiles: status.processedFiles,
    totalFiles: status.totalFiles,
    percent: status.percent,
    detail: status.detail,
    lastFullScanAt: status.lastFullScanAt,
    errorCount: status.errorCount,
    staleCount: status.staleCount,
    skippedCount: status.skippedCount,
    validFileCount: status.validFileCount,
    issueSummary: status.issueSummary,
    diagnosticRunId: status.diagnosticRunId,
    recentErrors: status.recentErrors ?? recentErrors,
  })
}

function pipeline(
  input: Partial<IndexingPipelineStatus> & Pick<IndexingPipelineStatus, "state" | "message">,
): IndexingPipelineStatus {
  const recentErrors = input.recentErrors?.slice(0, 5)
  return {
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    errorCount: 0,
    staleCount: 0,
    skippedCount: 0,
    ...input,
    ...(recentErrors && recentErrors.length > 0 ? { recentErrors } : { recentErrors: undefined }),
  }
}

function pct(processed: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((processed / total) * 100)))
}
