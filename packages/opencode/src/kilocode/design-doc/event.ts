import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"
import { JobProgress, JobStatus } from "./domain"

export const DesignDocJobUpdated = BusEvent.define(
  "design_doc.job.updated",
  Schema.Struct({
    jobID: Schema.String,
    revision: Schema.Int,
    status: JobStatus,
    progress: JobProgress,
    changedWorkItemID: Schema.optional(Schema.String),
    updatedAt: Schema.Int,
  }),
)
