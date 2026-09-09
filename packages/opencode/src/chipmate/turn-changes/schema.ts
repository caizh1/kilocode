import { Schema } from "effect"

export const File = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  oldFile: Schema.optional(Schema.String),
  status: Schema.Literals(["added", "deleted", "modified", "renamed"]),
  additions: Schema.Int,
  deletions: Schema.Int,
  binary: Schema.Boolean,
  undone: Schema.Array(Schema.String),
  state: Schema.Literals(["kept", "partial", "reverted"]),
})
export const Summary = Schema.Struct({
  directory: Schema.String,
  sessionID: Schema.String,
  messageID: Schema.String,
  revision: Schema.Int,
  phase: Schema.Literals(["running", "stopping", "settling", "ready", "unavailable"]),
  outcome: Schema.Literals(["completed", "interrupted", "error"]),
  reason: Schema.optional(Schema.String),
  files: Schema.Array(File),
  canRevert: Schema.Boolean,
  canRestore: Schema.Boolean,
})
export type Summary = typeof Summary.Type
export const Hunk = Schema.Struct({
  id: Schema.String,
  patch: Schema.String,
  line: Schema.Int,
  undone: Schema.Boolean,
})
export const Detail = Schema.Struct({
  fileID: Schema.String,
  revision: Schema.Int,
  patch: Schema.String,
  hunks: Schema.Array(Hunk),
  reason: Schema.optional(Schema.String),
})
export type Detail = typeof Detail.Type
export const Mutation = Schema.Struct({
  revision: Schema.Int,
  requestID: Schema.String,
  action: Schema.Literals(["revert", "restore"]),
  fileID: Schema.optional(Schema.String),
  hunkID: Schema.optional(Schema.String),
})
export type Mutation = typeof Mutation.Type
export const Result = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
  summary: Schema.optional(Summary),
  detail: Schema.optional(Detail),
})
export type Result = typeof Result.Type
