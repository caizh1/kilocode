// chipmate_change - new file
import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"

export const RequestID = Schema.String.pipe(Schema.brand("SkillMarketRequestID"))
export type RequestID = Schema.Schema.Type<typeof RequestID>

export const TransactionID = Schema.String.pipe(Schema.brand("SkillMarketTransactionID"))
export type TransactionID = Schema.Schema.Type<typeof TransactionID>

export const Scope = Schema.Literals(["global", "project"])
export type Scope = Schema.Schema.Type<typeof Scope>

export const State = Schema.Literals([
  "OPEN",
  "PREPARING",
  "PREPARED",
  "COMMITTING",
  "COMMITTED",
  "REMOTE_UNCERTAIN",
  "ABORTED",
  "ROLLING_BACK",
  "ROLLED_BACK",
  "UNDOING",
  "UNDONE",
  "EXPIRED",
  "MANUAL_INTERVENTION",
])
export type State = Schema.Schema.Type<typeof State>

const ID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const Key = Schema.String.check(Schema.isMinLength(16), Schema.isMaxLength(256))
const OptionalTransaction = Schema.optional(TransactionID)
const Base = { id: RequestID, sessionID: SessionID, key: Key }

export const SearchRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("search"),
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  category: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  author: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  sort: Schema.optional(Schema.Literals(["updated", "downloads", "favorites", "name"])),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  limit: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 20 })),
})

export const BeginRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("begin"),
  skillId: ID,
  scope: Scope,
  intents: Schema.Array(Schema.Literals(["create", "install", "publish"])).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(3),
  ),
})

export const File = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  encoding: Schema.Literals(["utf8", "base64"]),
  content: Schema.String.check(Schema.isMaxLength(14_000_000)),
})

export const PrepareCreateRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("prepare_create"),
  transactionId: OptionalTransaction,
  skillId: ID,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  description: Schema.String.check(Schema.isMaxLength(5_000)),
  category: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  tags: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(Schema.isMaxLength(50))),
  scope: Scope,
  files: Schema.Array(File).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  replace: Schema.Boolean,
})

export const PrepareInstallRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("prepare_install"),
  transactionId: OptionalTransaction,
  skillId: ID,
  revision: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  scope: Scope,
  replace: Schema.Boolean,
})

export const PreparePublishRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("prepare_publish"),
  transactionId: OptionalTransaction,
  skillId: ID,
  scope: Scope,
  notes: Schema.optional(Schema.String.check(Schema.isMaxLength(5_000))),
  expectedSha256: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
})

const TransactionRequest = (operation: "approve" | "commit" | "abort" | "status" | "undo" | "purge") =>
  Schema.Struct({ ...Base, operation: Schema.Literal(operation), transactionId: TransactionID })

export const ListRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("list"),
  limit: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 20 })),
})

export const Request = Schema.Union([
  SearchRequest,
  BeginRequest,
  PrepareCreateRequest,
  PrepareInstallRequest,
  PreparePublishRequest,
  TransactionRequest("approve"),
  TransactionRequest("commit"),
  TransactionRequest("abort"),
  TransactionRequest("status"),
  ListRequest,
  TransactionRequest("undo"),
  TransactionRequest("purge"),
]).annotate({ identifier: "SkillMarketRequest" })
export type Request = Schema.Schema.Type<typeof Request>

export const Result = Schema.Struct({
  operation: Schema.String,
  transactionId: Schema.optional(TransactionID),
  state: Schema.optional(State),
  skillId: Schema.optional(ID),
  scope: Schema.optional(Scope),
  preview: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  result: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  undoUntil: Schema.optional(Schema.String),
}).annotate({ identifier: "SkillMarketResult" })
export type Result = Schema.Schema.Type<typeof Result>

export const ErrorCode = Schema.Literals([
  "intent_required",
  "host_unavailable",
  "auth_required",
  "validation_failed",
  "security_rejected",
  "conflict",
  "stale_target",
  "locked",
  "cancelled",
  "timeout",
  "remote_uncertain",
  "rollback_failed",
  "undo_expired",
  "undo_conflict",
  "manual_intervention",
  "not_found",
  "host_error",
])
export type ErrorCode = Schema.Schema.Type<typeof ErrorCode>

export const Failure = Schema.Struct({
  code: ErrorCode,
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10_000)),
  transactionId: Schema.optional(TransactionID),
}).annotate({ identifier: "SkillMarketFailure" })
export type Failure = Schema.Schema.Type<typeof Failure>

export const Event = {
  Requested: BusEvent.define("chipmate.skill_market.requested", Request),
  Cancelled: BusEvent.define(
    "chipmate.skill_market.cancelled",
    Schema.Struct({
      requestID: RequestID,
      sessionID: SessionID,
      reason: Schema.Literals(["cancelled", "disposed", "timeout"]),
    }),
  ),
}
