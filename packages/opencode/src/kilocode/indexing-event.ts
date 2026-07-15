import { Schema } from "effect"
import { INDEXING_STATUS_STATES } from "@kilocode/kilo-indexing/status"
import { BusEvent } from "@/bus/bus-event"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { INDEXING_WARNING_CODES } from "./indexing-warning"

export const IndexingStatusState = Schema.Literals(INDEXING_STATUS_STATES).annotate({
  identifier: "IndexingStatusState",
})

export const IndexingDiagnosticInfo = Schema.Struct({
  time: Schema.String,
  source: Schema.String,
  location: Schema.String,
  message: Schema.String,
  file: Schema.optional(Schema.String),
}).annotate({ identifier: "IndexingDiagnostic" })

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
