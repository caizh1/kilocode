import { Schema } from "effect"
import { INDEXING_STATUS_STATES } from "@chipmate/chipmate-indexing/status"
import { BusEvent } from "@/bus/bus-event"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { INDEXING_WARNING_CODES } from "./indexing-warning"

export const DocumentIssueCategoryInfo = Schema.Literals([
  "extractor-runtime",
  "pdf-password",
  "pdf-invalid",
  "office-corrupt",
  "file-unavailable",
  "extraction-safety-limit",
  "extraction-unknown",
])

export const IndexingStatusState = Schema.Literals(INDEXING_STATUS_STATES).annotate({
  identifier: "IndexingStatusState",
})

export const IndexingDiagnosticInfo = Schema.Struct({
  time: Schema.String,
  source: Schema.String,
  location: Schema.String,
  message: Schema.String,
  file: Schema.optional(Schema.String),
  category: Schema.optional(DocumentIssueCategoryInfo),
}).annotate({ identifier: "IndexingDiagnostic" })

export const DocumentIssueSummaryInfo = Schema.Struct({
  category: DocumentIssueCategoryInfo,
  count: NonNegativeInt,
  samples: Schema.Array(
    Schema.Struct({
      file: Schema.optional(Schema.String),
      message: Schema.String,
    }),
  ),
}).annotate({ identifier: "DocumentIssueSummary" })

export const DocumentDiagnosticReportInfo = Schema.Struct({
  runId: Schema.String,
  startedAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
  issueSummary: Schema.Array(DocumentIssueSummaryInfo),
  diagnostics: Schema.Array(IndexingDiagnosticInfo),
}).annotate({ identifier: "DocumentDiagnosticReport" })

export const IndexingNoticeInfo = Schema.Struct({
  id: Schema.String,
  level: Schema.Literals(["info", "warning"]),
  message: Schema.String,
  action: Schema.optional(Schema.Literal("openIndexingOutput")),
}).annotate({ identifier: "IndexingNotice" })

const IndexingPipelineStatusInfo = Schema.Struct({
  state: IndexingStatusState,
  message: Schema.String,
  processedFiles: NonNegativeInt,
  totalFiles: NonNegativeInt,
  percent: NonNegativeInt.check(Schema.isLessThanOrEqualTo(100)),
  detail: Schema.optional(Schema.String),
  lastFullScanAt: Schema.optional(Schema.String),
  errorCount: NonNegativeInt,
  staleCount: NonNegativeInt,
  skippedCount: NonNegativeInt,
  validFileCount: Schema.optional(NonNegativeInt),
  issueSummary: Schema.optional(Schema.Array(DocumentIssueSummaryInfo)),
  diagnosticRunId: Schema.optional(Schema.String),
  recentErrors: Schema.optional(Schema.Array(IndexingDiagnosticInfo)),
})

export const IndexingStatusInfo = Schema.Struct({
  state: IndexingStatusState,
  message: Schema.String,
  processedFiles: NonNegativeInt,
  totalFiles: NonNegativeInt,
  percent: NonNegativeInt.check(Schema.isLessThanOrEqualTo(100)),
  pipelines: Schema.optional(
    Schema.Struct({
      codeGraph: IndexingPipelineStatusInfo,
      rag: IndexingPipelineStatusInfo,
      documents: IndexingPipelineStatusInfo,
    }),
  ),
  notices: Schema.optional(Schema.Array(IndexingNoticeInfo)),
}).annotate({ identifier: "IndexingStatus" })

export const Event = BusEvent.define(
  "indexing.status",
  Schema.Struct({
    status: IndexingStatusInfo,
  }),
)

export const IndexingWarningInfo = Schema.Struct({
  code: Schema.Literals(INDEXING_WARNING_CODES),
  message: Schema.String,
}).annotate({ identifier: "IndexingWarning" })

export const Warning = BusEvent.define("indexing.warning", IndexingWarningInfo)
