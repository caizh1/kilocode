import { Schema } from "effect"

export const Rule = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("once"), at: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("interval"), minutes: Schema.Int, anchor: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("weekly"), days: Schema.Array(Schema.Int), time: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("monthly"), day: Schema.Int, time: Schema.String }),
])
export const Definition = Schema.Struct({
  name: Schema.String,
  prompt: Schema.String,
  timezone: Schema.String,
  schedule: Rule,
  agent: Schema.String,
  model: Schema.Struct({ providerID: Schema.String, modelID: Schema.String }),
  variant: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  timeoutMinutes: Schema.Int,
})
export const Command = Schema.Struct({
  action: Schema.Literals([
    "create",
    "list",
    "get",
    "update",
    "pause",
    "resume",
    "delete",
    "run_now",
    "runs",
    "get_run",
    "cancel_run",
    "preview",
  ]),
  taskID: Schema.optional(Schema.String),
  runID: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Int),
  key: Schema.optional(Schema.String),
  definition: Schema.optional(Definition),
})
export const Task = Schema.Struct({
  ...Definition.fields,
  id: Schema.String,
  directory: Schema.String,
  version: Schema.Int,
  status: Schema.Literals(["enabled", "paused", "finished", "deleted"]),
  nextAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
})
export const Run = Schema.Struct({
  directory: Schema.String,
  id: Schema.String,
  taskID: Schema.String,
  taskVersion: Schema.Int,
  scheduledAt: Schema.Number,
  createdAt: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
  status: Schema.Literals([
    "queued",
    "running",
    "waiting",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
    "skipped",
  ]),
  reason: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  messageID: Schema.String,
  owner: Schema.String,
  snapshot: Definition,
  missedCount: Schema.optional(Schema.Number),
  missedThrough: Schema.optional(Schema.Number),
})
export const State = Schema.Struct({ tasks: Schema.Array(Task), runs: Schema.Array(Run), serverTime: Schema.Number })
export const Response = Schema.Struct({
  state: State,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
})
