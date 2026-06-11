import { Schema } from "effect"
import { INDEXING_STATUS_STATES } from "@kilocode/kilo-indexing/status"
import { BusEvent } from "@/bus/bus-event"
import { NonNegativeInt } from "@opencode-ai/core/schema"

export const IndexingStatusState = Schema.Literals(INDEXING_STATUS_STATES).annotate({
  identifier: "IndexingStatusState",
})

export const IndexingStatusInfo = Schema.Struct({
  state: IndexingStatusState,
  message: Schema.String,
  processedFiles: NonNegativeInt,
  totalFiles: NonNegativeInt,
  percent: NonNegativeInt.check(Schema.isLessThanOrEqualTo(100)),
  pipelines: Schema.optional(
    Schema.Struct({
      codeGraph: Schema.Struct({
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
      }),
      rag: Schema.Struct({
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
      }),
    }),
  ),
}).annotate({ identifier: "IndexingStatus" })

export const Event = BusEvent.define(
  "indexing.status",
  Schema.Struct({
    status: IndexingStatusInfo,
  }),
)
