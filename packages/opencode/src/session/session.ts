import * as TurnChanges from "@/chipmate/turn-changes/runtime" // chipmate_change
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // chipmate_change
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Slug } from "@opencode-ai/core/util/slug"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import path from "path"
import { BackgroundJob } from "@/background/job"
import { Decimal } from "decimal.js"
import type { ProviderMetadata, Usage } from "@opencode-ai/llm"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Database } from "@opencode-ai/core/database/database"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"

import { NotFoundError } from "@/storage/storage"
import { eq, and, gte, isNull, desc, like, sql, inArray, lt, or } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import { PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { MessageV2 } from "./message-v2"
import type { InstanceContext } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { Snapshot } from "@/snapshot"
import { ProjectV2 } from "@opencode-ai/core/project"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionMessage } from "@opencode-ai/core/session/message" // chipmate_change - shared Revert.State brand

import type { Provider } from "@/provider/provider"
import { Permission } from "@/permission"
import { Global } from "@opencode-ai/core/global"
// chipmate_change start - ChipMate session behavior extensions
import { BackgroundProcess } from "@/chipmate/background-process"
import * as SandboxInheritance from "@/chipmate/sandbox/inheritance"
import { InteractiveTerminal } from "@/chipmate/interactive-terminal"
import { ChipMateSession } from "@/chipmate/session"
import { chipmateSessionFork } from "@/chipmate/session/fork-command"
import { ChipMateSessionEvent } from "@/chipmate/session/event"
import { SessionExport } from "@/chipmate/session-export"
import * as SandboxPolicy from "@/chipmate/sandbox/policy"
import {
  appendSessionDiffs,
  carryForkDiffAtBoundary,
  clearForkDiff,
  forkDiffFromSnapshots,
  type PortableDiff,
} from "@/chipmate/session-portability/cumulative-diff" // chipmate_change
import { BlockedError as AgentRequirementError } from "@/chipmate/agent-requirements"
import { ProductProfile } from "@/chipmate/product-profile"
import { DocumentAgentScope } from "@/chipmate/document-agent/scope"
// chipmate_change end
import { Deferred, Effect, Exit, Layer, Option, Context, Schema, Scope, Types } from "effect"
import { NonNegativeInt, optionalOmitUndefined } from "@opencode-ai/core/schema"
import { AbsolutePath } from "@opencode-ai/core/schema" // chipmate_change
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const runtime = makeRuntime(Database.Service, AppNodeBuilder.build(Database.node))

const parentTitlePrefix = "New session - "
const childTitlePrefix = "Child session - "

export function isDefaultTitle(title: string) {
  return new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(title)
}

type SessionRow = typeof SessionTable.$inferSelect

export function fromRow(row: SessionRow): Info {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? undefined,
        }
      : undefined
  const share = row.share_url ? { url: row.share_url } : undefined
  // chipmate_change start - the shared column stores the upstream Revert.State brand; project it to the v1 shape
  const revert = row.revert
    ? {
        messageID: MessageID.make(row.revert.messageID),
        partID: row.revert.partID ? PartID.make(row.revert.partID) : undefined,
        snapshot: row.revert.snapshot,
        diff: row.revert.diff,
        workspace: row.revert.workspace,
      }
    : undefined
  // chipmate_change end
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    path: row.path ?? undefined,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: ModelV2.ID.make(row.model.id),
          providerID: ProviderV2.ID.make(row.model.providerID),
          variant: row.model.variant,
        }
      : undefined,
    version: row.version,
    summary,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: {
        read: row.tokens_cache_read,
        write: row.tokens_cache_write,
      },
    },
    share,
    metadata: row.metadata ?? undefined,
    revert,
    permission: row.permission ? [...row.permission] : undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}

export function toRow(info: Info) {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID,
    parent_id: info.parentID,
    slug: info.slug,
    directory: info.directory,
    path: info.path,
    title: info.title,
    agent: info.agent,
    model: info.model,
    version: info.version,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs,
    metadata: info.metadata,
    cost: info.cost ?? 0,
    tokens_input: (info.tokens ?? EmptyTokens).input,
    tokens_output: (info.tokens ?? EmptyTokens).output,
    tokens_reasoning: (info.tokens ?? EmptyTokens).reasoning,
    tokens_cache_read: (info.tokens ?? EmptyTokens).cache.read,
    tokens_cache_write: (info.tokens ?? EmptyTokens).cache.write,
    // chipmate_change - re-brand the v1 messageID to the shared Revert.State brand for the column
    revert: info.revert
      ? { ...info.revert, messageID: SessionMessage.ID.make(info.revert.messageID) }
      : null,
    permission: info.permission,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function getForkedTitle(title: string): string {
  const match = title.match(/^(.+) \(fork #(\d+)\)$/)
  if (match) {
    const base = match[1]
    const num = parseInt(match[2], 10)
    return `${base} (fork #${num + 1})`
  }
  return `${title} (fork #1)`
}

function sessionPath(worktree: string, cwd: string) {
  return path.relative(path.resolve(worktree), cwd).replaceAll("\\", "/")
}

const Summary = Schema.Struct({
  additions: Schema.Finite,
  deletions: Schema.Finite,
  files: Schema.Finite,
  diffs: optionalOmitUndefined(Schema.Array(Snapshot.SummaryFileDiff)), // chipmate_change - lightweight diff without patch
})

const Tokens = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  reasoning: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
})

const EmptyTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const Share = Schema.Struct({
  url: Schema.String,
})

// Legacy HTTP accepted negative values here. Keep archive timestamps permissive
// while excluding non-finite values that cannot round-trip through JSON.
export const ArchivedTimestamp = Schema.Finite

const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  compacting: optionalOmitUndefined(NonNegativeInt),
  archived: optionalOmitUndefined(ArchivedTimestamp),
})

const Revert = Schema.Struct({
  messageID: MessageID,
  partID: optionalOmitUndefined(PartID),
  snapshot: optionalOmitUndefined(Schema.String),
  diff: optionalOmitUndefined(Schema.String),
  workspace: optionalOmitUndefined(Schema.Literals(["restored", "snapshots-disabled", "unavailable"])), // chipmate_change
})

const Model = Schema.Struct({
  id: ModelV2.ID,
  providerID: ProviderV2.ID,
  variant: optionalOmitUndefined(Schema.String),
})

export const Metadata = Schema.Record(Schema.String, Schema.Any)

export const Info = Schema.Struct({
  id: SessionID,
  slug: Schema.String,
  projectID: ProjectV2.ID,
  workspaceID: optionalOmitUndefined(WorkspaceV2.ID),
  directory: Schema.String,
  path: optionalOmitUndefined(Schema.String),
  parentID: optionalOmitUndefined(SessionID),
  summary: optionalOmitUndefined(Summary),
  cost: optionalOmitUndefined(Schema.Finite),
  tokens: optionalOmitUndefined(Tokens),
  share: optionalOmitUndefined(Share),
  title: Schema.String,
  agent: optionalOmitUndefined(Schema.String),
  model: optionalOmitUndefined(Model),
  version: Schema.String,
  metadata: optionalOmitUndefined(Metadata),
  time: Time,
  permission: optionalOmitUndefined(PermissionV1.Ruleset),
  revert: optionalOmitUndefined(Revert),
}).annotate({ identifier: "Session" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const ProjectInfo = Schema.Struct({
  id: ProjectV2.ID,
  name: optionalOmitUndefined(Schema.String),
  worktree: Schema.String,
}).annotate({ identifier: "ProjectSummary" })
export type ProjectInfo = Types.DeepMutable<Schema.Schema.Type<typeof ProjectInfo>>

export const GlobalInfo = Schema.Struct({
  ...Info.fields,
  project: Schema.NullOr(ProjectInfo),
  worktreeName: Schema.optional(Schema.String), // chipmate_change - basename of the specific worktree directory
}).annotate({ identifier: "GlobalSession" })
export type GlobalInfo = Types.DeepMutable<Schema.Schema.Type<typeof GlobalInfo>>

export const CreateInput = Schema.optional(
  Schema.Struct({
    parentID: Schema.optional(SessionID),
    title: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
    model: Schema.optional(Model),
    metadata: Schema.optional(Metadata),
    permission: Schema.optional(PermissionV1.Ruleset),
    platform: Schema.optional(Schema.String), // chipmate_change - per-session platform override for telemetry attribution
    // chipmate_change start - server-issued sandbox inheritance grant
    workspaceID: Schema.optional(WorkspaceV2.ID),
    sandboxInheritanceToken: Schema.optional(Schema.String),
    // chipmate_change end
  }),
)
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>

export const ForkInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  afterMessageID: Schema.optional(MessageID),
  operationID: Schema.optional(Schema.String.check(Schema.isUUID())),
})
export type ForkInput = Types.DeepMutable<Schema.Schema.Type<typeof ForkInput>>

export class ForkError extends Schema.TaggedErrorClass<ForkError>()("SessionForkError", {
  sessionID: SessionID,
  kind: Schema.Literals(["invalid-boundary", "in-progress", "operation-conflict", "recovery-conflict"]),
  message: Schema.String,
}) {}

type ForkMetadata = {
  version: 1
  operationID: string
  sourceSessionID: string
  boundary: { mode: "full" | "before" | "after"; messageID?: string }
  state: "copying" | "complete"
  expectedMessages: number
}

const forkMetadataKey = "chipmate.sessionFork"

function readForkMetadata(metadata: Info["metadata"]): ForkMetadata | undefined {
  const value = metadata?.[forkMetadataKey]
  if (!value || typeof value !== "object") return
  const record = value as Partial<ForkMetadata>
  if (record.version !== 1 || typeof record.operationID !== "string") return
  if (typeof record.sourceSessionID !== "string" || !record.boundary || typeof record.boundary !== "object") return
  if (record.state !== "copying" && record.state !== "complete") return
  if (typeof record.expectedMessages !== "number") return
  return record as ForkMetadata
}

function forkBoundary(input: ForkInput): ForkMetadata["boundary"] {
  return input.afterMessageID
    ? { mode: "after", messageID: input.afterMessageID }
    : input.messageID
      ? { mode: "before", messageID: input.messageID }
      : { mode: "full" }
}

function forkBoundaryKey(input: ForkInput) {
  const boundary = forkBoundary(input)
  return boundary.messageID ? `${boundary.mode}:${boundary.messageID}` : boundary.mode
}

/** Resolve a completed durable fork before applying current source busy-state checks. */
export function findCompletedFork(input: ForkInput): Effect.Effect<Info | undefined, ForkError, Database.Service> {
  if (!input.operationID) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    if (input.messageID && input.afterMessageID) {
      return yield* Effect.fail(
        new ForkError({
          sessionID: input.sessionID,
          kind: "invalid-boundary",
          message: "messageID and afterMessageID are mutually exclusive",
        }),
      )
    }
    const { db } = yield* Database.Service
    const rows = yield* db.select().from(SessionTable).all().pipe(Effect.orDie)
    const match = rows.map(fromRow).find((item) => readForkMetadata(item.metadata)?.operationID === input.operationID)
    if (!match) return undefined
    const metadata = readForkMetadata(match.metadata)!
    const boundary = forkBoundary(input)
    const same =
      metadata.sourceSessionID === input.sessionID &&
      metadata.boundary.mode === boundary.mode &&
      metadata.boundary.messageID === boundary.messageID
    if (!same) {
      return yield* Effect.fail(
        new ForkError({
          sessionID: input.sessionID,
          kind: "operation-conflict",
          message: "operationID belongs to another fork request",
        }),
      )
    }
    return metadata.state === "complete" ? match : undefined
  })
}
export const GetInput = SessionID
export const ChildrenInput = SessionID
export const RemoveInput = SessionID
export const SetTitleInput = Schema.Struct({ sessionID: SessionID, title: Schema.String })
export const SetArchivedInput = Schema.Struct({
  sessionID: SessionID,
  time: Schema.optional(ArchivedTimestamp),
})
export const SetMetadataInput = Schema.Struct({
  sessionID: SessionID,
  metadata: Metadata,
})
export const SetPermissionInput = Schema.Struct({
  sessionID: SessionID,
  permission: PermissionV1.Ruleset,
})
export const SetRevertInput = Schema.Struct({
  sessionID: SessionID,
  revert: Schema.optional(Revert),
  summary: Schema.optional(Summary),
})
export const MessagesInput = Schema.Struct({
  sessionID: SessionID,
  limit: Schema.optional(NonNegativeInt),
})
export type ListInput = {
  directory?: string
  scope?: "project"
  path?: string
  workspaceID?: WorkspaceV2.ID
  roots?: boolean
  start?: number
  search?: string
  limit?: number
}

export type GlobalListInput = {
  // chipmate_change start - worktree-family filters for the Agent Manager
  projectID?: string
  directory?: string
  directories?: string[]
  currentDirectory?: string
  // chipmate_change end
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}

const CreatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: Info,
})

const UpdatedShare = Schema.Struct({
  url: Schema.optional(Schema.NullOr(Schema.String)),
})

const UpdatedTime = Schema.Struct({
  created: Schema.optional(Schema.NullOr(NonNegativeInt)),
  updated: Schema.optional(Schema.NullOr(NonNegativeInt)),
  compacting: Schema.optional(Schema.NullOr(NonNegativeInt)),
  archived: Schema.optional(Schema.NullOr(ArchivedTimestamp)),
})

const UpdatedInfo = Schema.Struct({
  id: Schema.optional(Schema.NullOr(SessionID)),
  slug: Schema.optional(Schema.NullOr(Schema.String)),
  projectID: Schema.optional(Schema.NullOr(ProjectV2.ID)),
  workspaceID: Schema.optional(Schema.NullOr(WorkspaceV2.ID)),
  directory: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  parentID: Schema.optional(Schema.NullOr(SessionID)),
  summary: Schema.optional(Schema.NullOr(Summary)),
  cost: Schema.optional(Schema.Finite),
  tokens: Schema.optional(Tokens),
  share: Schema.optional(UpdatedShare),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  agent: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Model)),
  version: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(Schema.NullOr(Metadata)),
  time: Schema.optional(UpdatedTime),
  permission: Schema.optional(Schema.NullOr(PermissionV1.Ruleset)),
  revert: Schema.optional(Schema.NullOr(Revert)),
})

const UpdatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: UpdatedInfo,
})

export const Event = {
  Created: SessionV1.Event.Created,
  Updated: SessionV1.Event.Updated,
  Deleted: SessionV1.Event.Deleted,
  Diff: EventV2.define({
    type: "session.diff",
    schema: {
      sessionID: SessionID,
      diff: Schema.Array(Snapshot.FileDiff),
    },
  }),
  Error: EventV2.define({
    type: "session.error",
    schema: {
      sessionID: Schema.optional(SessionID),
      // Reuses SessionV1.Assistant.fields.error (already Schema.optional) so
      // the derived schema keeps the same discriminated-union shape on the event stream.
      // chipmate_change - carry pre-message requirement failures over session.error
      error: Schema.optional(Schema.Union([SessionV1.Assistant.fields.error, AgentRequirementError.EffectSchema])),
    },
  }),
  // chipmate_change start
  TurnOpen: ChipMateSessionEvent.TurnOpen,
  TurnClose: ChipMateSessionEvent.TurnClose,
  // chipmate_change end
}

export function plan(input: { slug: string; time: { created: number } }, instance: InstanceContext) {
  const base = instance.project.vcs
    ? ProductProfile.project(instance.worktree, "plans") // chipmate_change
    : path.join(Global.Path.data, "plans")
  return path.join(base, [input.time.created, input.slug].join("-") + ".md")
}

export const getUsage = (input: {
  model: Provider.Model
  usage: Usage
  metadata?: ProviderMetadata
  provider?: Provider.Info // chipmate_change
}) => {
  const safe = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, value)
  }
  const inputTokens = safe(input.usage.inputTokens ?? 0)
  const outputTokens = safe(input.usage.outputTokens ?? 0)
  const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

  const cacheReadInputTokens = safe(input.usage.cacheReadInputTokens ?? 0)
  const cacheWriteInputTokens = safe(
    Number(
      input.usage.cacheWriteInputTokens ??
        input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
        // google-vertex-anthropic returns metadata under "vertex" key
        // (AnthropicMessagesLanguageModel custom provider key from 'vertex.anthropic.messages')
        input.metadata?.["vertex"]?.["cacheCreationInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
        0,
    ),
  )

  // AI SDK v6 normalized inputTokens to include cached tokens across all providers
  // (including Anthropic/Bedrock which previously excluded them). Always subtract cache
  // tokens to get the non-cached input count for separate cost calculation.
  const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)

  const total = input.usage.totalTokens

  const tokens = {
    total,
    input: adjustedInputTokens,
    output: safe(outputTokens - reasoningTokens),
    reasoning: reasoningTokens,
    cache: {
      write: cacheWriteInputTokens,
      read: cacheReadInputTokens,
    },
  }

  // chipmate_change start - Use provider-reported cost when available for OpenRouter/ChipMate
  const reported = ChipMateSession.providerCost({
    metadata: input.metadata,
    usage: input.usage,
    provider: input.provider,
    providerID: input.model.providerID,
  })
  if (reported !== undefined) return { cost: safe(reported), tokens }
  // chipmate_change end

  const contextTokens = inputTokens
  const costInfo =
    input.model.cost?.tiers
      ?.filter((item) => item.tier.type === "context" && contextTokens > item.tier.size)
      .sort((a, b) => b.tier.size - a.tier.size)[0] ??
    (input.model.cost?.experimentalOver200K && contextTokens > 200_000
      ? input.model.cost.experimentalOver200K
      : input.model.cost)
  const totalNanoAiu = input.metadata?.["copilot"]?.["totalNanoAiu"]
  return {
    cost:
      typeof totalNanoAiu === "number" && Number.isFinite(totalNanoAiu) && totalNanoAiu >= 0
        ? new Decimal(totalNanoAiu).div(100_000_000_000).toNumber()
        : safe(
            new Decimal(0)
              .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
              .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
              .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
              .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
              // TODO: update models.dev to have better pricing model, for now:
              // charge reasoning tokens at the same rate as output tokens
              .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
              .toNumber(),
          ),
    tokens,
  }
}

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("SessionBusyError", {
  sessionID: SessionID,
}) {}

export type NotFound = NotFoundError

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<Info[]>
  // chipmate_change start - session create metadata and sandbox inheritance extensions
  readonly listGlobal: (input?: GlobalListInput) => Effect.Effect<GlobalInfo[]>
  readonly create: (input?: {
    parentID?: SessionID
    title?: string
    agent?: string
    model?: Schema.Schema.Type<typeof Model>
    metadata?: typeof Metadata.Type
    permission?: PermissionV1.Ruleset
    platform?: string // chipmate_change - per-session platform override for telemetry attribution
    workspaceID?: WorkspaceV2.ID
    sandboxInheritanceToken?: string
  }) => Effect.Effect<Info>
  // chipmate_change end
  readonly fork: (input: ForkInput) => Effect.Effect<Info, NotFound | ForkError>
  readonly touch: (sessionID: SessionID) => Effect.Effect<void>
  readonly get: (id: SessionID) => Effect.Effect<Info, NotFound>
  readonly setTitle: (input: { sessionID: SessionID; title: string }) => Effect.Effect<void>
  readonly setArchived: (input: { sessionID: SessionID; time?: number }) => Effect.Effect<void>
  readonly setMetadata: (input: typeof SetMetadataInput.Type) => Effect.Effect<void>
  readonly setAgentModel: (input: {
    sessionID: SessionID
    agent: string
    model: NonNullable<Info["model"]>
    time: number
  }) => Effect.Effect<void>
  readonly setPermission: (input: { sessionID: SessionID; permission: PermissionV1.Ruleset }) => Effect.Effect<void>
  readonly setRevert: (input: {
    sessionID: SessionID
    revert: Info["revert"]
    summary: Info["summary"]
  }) => Effect.Effect<void>
  readonly clearRevert: (sessionID: SessionID) => Effect.Effect<void>
  readonly setSummary: (input: { sessionID: SessionID; summary: Info["summary"] }) => Effect.Effect<void>
  readonly setShare: (input: { sessionID: SessionID; share: Info["share"] }) => Effect.Effect<void>
  readonly setWorkspace: (input: { sessionID: SessionID; workspaceID: Info["workspaceID"] }) => Effect.Effect<void>
  readonly diff: (sessionID: SessionID) => Effect.Effect<Snapshot.FileDiff[]>
  readonly messages: (input: { sessionID: SessionID; limit?: number }) => Effect.Effect<SessionV1.WithParts[], NotFound>
  readonly children: (parentID: SessionID) => Effect.Effect<Info[]>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void, NotFound>
  readonly updateMessage: <T extends SessionV1.Info>(msg: T) => Effect.Effect<T>
  readonly removeMessage: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<MessageID>
  readonly removePart: (input: { sessionID: SessionID; messageID: MessageID; partID: PartID }) => Effect.Effect<PartID>
  readonly getPart: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
  }) => Effect.Effect<SessionV1.Part | undefined>
  readonly updatePart: <T extends SessionV1.Part>(part: T) => Effect.Effect<T>
  readonly updatePartDelta: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
    field: string
    delta: string
  }) => Effect.Effect<void>
  /** Finds the first message matching the predicate, searching newest-first. */
  readonly findMessage: (
    sessionID: SessionID,
    predicate: (msg: SessionV1.WithParts) => boolean,
  ) => Effect.Effect<Option.Option<SessionV1.WithParts>, NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Session") {}

export const use = serviceUse(Service)

export type Patch = Omit<Partial<Info>, "time" | "share" | "summary" | "revert" | "permission"> & {
  time?: Partial<Info["time"]>
  share?: Partial<NonNullable<Info["share"]>> | null
  summary?: Info["summary"] | null
  revert?: Info["revert"] | null
  permission?: Info["permission"] | null
}

export const layer: Layer.Layer<
  Service,
  never,
  BackgroundJob.Service | RuntimeFlags.Service | Database.Service | EventV2Bridge.Service | TurnChanges.Service // chipmate_change
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const changes = yield* TurnChanges.Service // chipmate_change
    const { db } = yield* Database.Service
    const database = yield* Database.Service
    const background = yield* BackgroundJob.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const scope = yield* Scope.Scope
    type ForkFlight = {
      readonly operationID?: string
      readonly boundary: string
      readonly done: Deferred.Deferred<Info, NotFound | ForkError>
    }
    const forkFlights = new Map<string, ForkFlight>()

    // chipmate_change start - inherited sandbox policy source
    const createNext = Effect.fn("Session.createNext")(function* (input: {
      id?: SessionID
      title?: string
      agent?: string
      model?: Schema.Schema.Type<typeof Model>
      parentID?: SessionID
      workspaceID?: WorkspaceV2.ID
      directory: string
      path?: string
      metadata?: typeof Metadata.Type
      permission?: PermissionV1.Ruleset
      platform?: string // chipmate_change - per-session platform override for telemetry attribution
      sourceID?: SessionID // chipmate_change - inherited sandbox policy source
      sourceDirectory?: string
      sandboxFallback?: SandboxPolicy.Snapshot // chipmate_change - confinement to seed when source state lives in another directory
    }) {
      const ctx = yield* InstanceState.context
      const result: Info = {
        id: SessionID.descending(input.id),
        slug: Slug.create(),
        version: InstallationVersion,
        projectID: ctx.project.id,
        directory: input.directory,
        path: input.path,
        workspaceID: input.workspaceID,
        parentID: input.parentID,
        title: input.title ?? (input.parentID ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString(),
        agent: input.agent,
        model: input.model,
        metadata: input.metadata,
        permission: input.permission ? [...input.permission] : undefined,
        cost: 0,
        tokens: EmptyTokens,
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      yield* Effect.logInfo("created", result)
      // chipmate_change end

      // chipmate_change start - legacy sessions must satisfy the upstream project foreign key
      yield* db
        .insert(ProjectTable)
        .values({
          id: ctx.project.id,
          worktree: AbsolutePath.make(ctx.project.worktree),
          vcs: ctx.project.vcs ?? null,
          time_created: ctx.project.time.created,
          time_updated: ctx.project.time.updated,
          sandboxes: ctx.project.sandboxes.map((sandbox) => AbsolutePath.make(sandbox)),
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      // chipmate_change end

      // chipmate_change start - initialize inherited state before session.created subscribers run
      ChipMateSession.register({ id: result.id, parentID: result.parentID, platform: input.platform })
      const source = input.sourceID ?? result.parentID
      if (source) yield* SandboxPolicy.inherit(source, result.id, input.sandboxFallback, input.sourceDirectory)
      // chipmate_change end

      yield* events.publish(SessionV1.Event.Created, { sessionID: result.id, info: result })

      return result
    })

    const get = Effect.fn("Session.get")(function* (id: SessionID) {
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, id)).get().pipe(Effect.orDie)
      if (!row) return yield* Effect.fail(new NotFoundError({ message: `Session not found: ${id}` }))
      return fromRow(row)
    })

    const list = Effect.fn("Session.list")(function* (input?: ListInput) {
      const ctx = yield* InstanceState.context
      return yield* listByProject(db, {
        projectID: ctx.project.id,
        experimentalWorkspaces: flags.experimentalWorkspaces,
        ...input,
      })
    })

    // chipmate_change start - preserve ChipMate's cross-project worktree-family filtering
    const listGlobal = Effect.fn("Session.listGlobal")((input?: GlobalListInput) =>
      ChipMateSession.listGlobal<GlobalInfo>({ ...input, fromRow }).pipe(Effect.provideService(Database.Service, database)),
    )
    // chipmate_change end

    // chipmate_change start - scope children by persisted parent project_id
    const children = Effect.fn("Session.children")(function* (parentID: SessionID) {
      const parent = yield* db
        .select({ projectID: SessionTable.project_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, parentID))
        .get()
        .pipe(Effect.orDie)
      const conditions = [eq(SessionTable.parent_id, parentID)]
      if (parent) conditions.push(eq(SessionTable.project_id, parent.projectID))
      const rows = yield* db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })
    // chipmate_change end

    const remove: Interface["remove"] = Effect.fnUntraced(function* (sessionID: SessionID) {
      const session = yield* get(sessionID)
      try {
        // `remove` needs to work in all cases, such as broken sessions that
        // run cleanup without instance state.
        const hasInstance = yield* InstanceState.directory.pipe(
          Effect.as(true),
          Effect.catchCause(() => Effect.succeed(false)),
        )

        if (hasInstance) yield* cancelBackgroundJobs(background, sessionID)
        if (hasInstance) yield* changes.remove(sessionID) // chipmate_change
        const kids = yield* children(sessionID)
        for (const child of kids) {
          yield* remove(child.id)
        }

        // chipmate_change start
        yield* SandboxPolicy.dispose(
          sessionID,
          Effect.gen(function* () {
            yield* Effect.promise(() => ChipMateSession.removeSession(sessionID)).pipe(Effect.ignore)
            ChipMateSession.clearPlatformOverride(sessionID)
            if (hasInstance) {
              yield* Effect.promise(() => BackgroundProcess.stopSession(sessionID)).pipe(Effect.ignore)
              yield* Effect.promise(() => InteractiveTerminal.stopSession(sessionID)).pipe(Effect.ignore)
              void Promise.all([import("@/effect/app-runtime"), import("./run-state")]).then(([app, run]) =>
                app.AppRuntime.runPromise(run.SessionRunState.Service.use((svc) => svc.cancel(sessionID))).catch(
                  () => {},
                ),
              )
            }
            // chipmate_change - migrated from legacy sync.run/sync.remove to EventV2 (events.publish/remove)
            yield* events.publish(SessionV1.Event.Deleted, { sessionID, info: session })
            // chipmate_change - capture final session-export workspace delta on close/delete
            const workspaceKey = hasInstance ? yield* InstanceState.directory : undefined // chipmate_change
            yield* Effect.promise(() => SessionExport.onSessionClose(sessionID, workspaceKey)) // chipmate_change
            yield* events.remove(sessionID)
          }),
        )
        // chipmate_change end
      } catch (error) {
        yield* Effect.logError("failed to remove session", { sessionID, error })
      }
    })

    const updateMessage = <T extends SessionV1.Info>(msg: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        // chipmate_change start - ignore FK errors when session was deleted while processor was still running
        yield* ChipMateSession.runSyncSafe(
          events.publish(SessionV1.Event.MessageUpdated, { sessionID: msg.sessionID, info: msg }),
          { type: "message update", id: msg.id, sessionID: msg.sessionID },
        )
        // chipmate_change end
        return msg
      }).pipe(Effect.withSpan("Session.updateMessage"))

    const updatePart = <T extends SessionV1.Part>(part: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        // chipmate_change start - ignore FK errors when session was deleted while processor was still running
        yield* ChipMateSession.runSyncSafe(
          events.publish(SessionV1.Event.PartUpdated, {
            sessionID: part.sessionID,
            part: structuredClone(part),
            time: Date.now(),
          }),
          { type: "part update", id: part.id, sessionID: part.sessionID },
        )
        // chipmate_change end
        return part
      }).pipe(Effect.withSpan("Session.updatePart"))

    const getPart: Interface["getPart"] = Effect.fn("Session.getPart")(function* (input) {
      const row = yield* db
        .select()
        .from(PartTable)
        .where(
          and(
            eq(PartTable.session_id, input.sessionID),
            eq(PartTable.message_id, input.messageID),
            eq(PartTable.id, input.partID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (!row) return
      return {
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
      } as SessionV1.Part
    })

    // chipmate_change start - session create metadata and sandbox inheritance extensions
    const create = Effect.fn("Session.create")(function* (input?: {
      parentID?: SessionID
      title?: string
      agent?: string
      model?: Schema.Schema.Type<typeof Model>
      metadata?: typeof Metadata.Type
      permission?: PermissionV1.Ruleset
      platform?: string // chipmate_change - per-session platform override for telemetry attribution
      workspaceID?: WorkspaceV2.ID
      sandboxInheritanceToken?: string
    }) {
      const ctx = yield* InstanceState.context
      const workspace = yield* InstanceState.workspaceID
      const grant = SandboxInheritance.consume(input?.sandboxInheritanceToken)
      if (input?.sandboxInheritanceToken && !grant) yield* Effect.die(new Error("Invalid sandbox inheritance token"))
      // chipmate_change end
      // chipmate_change start - propagate trusted sandbox inheritance grant
      const session = yield* createNext({
        parentID: input?.parentID,
        directory: ctx.directory,
        path: sessionPath(ctx.worktree, ctx.directory),
        title: input?.title,
        agent: input?.agent,
        model: input?.model,
        metadata: input?.metadata,
        permission: input?.permission,
        platform: input?.platform, // chipmate_change
        sourceID: grant?.sessionID, // chipmate_change
        sourceDirectory: grant?.directory, // chipmate_change
        workspaceID: input?.workspaceID ?? workspace,
      })
      // chipmate_change end
      return session
    })

    // chipmate_change start - durable, inclusive and single-flight session forks
    const failFork = (input: ForkInput, kind: ForkError["kind"], message: string) =>
      Effect.fail(new ForkError({ sessionID: input.sessionID, kind, message }))

    const hasForkUserOutput = Effect.fn("Session.hasForkUserOutput")(function* (target: Info) {
      const queue = [target]
      while (queue.length > 0) {
        const current = queue.shift()!
        const output = yield* messages({ sessionID: current.id })
        if (output.some((item) => item.info.role === "user" && item.info.time.created >= current.time.created)) {
          return true
        }
        queue.push(...(yield* children(current.id)))
      }
      return false
    })

    const copyFork = Effect.fn("Session.copyFork")(function* (input: ForkInput) {
      const started = performance.now()
      const ctx = yield* InstanceState.context
      const original = yield* get(input.sessionID)
      if (input.messageID && input.afterMessageID) {
        return yield* failFork(input, "invalid-boundary", "messageID and afterMessageID are mutually exclusive")
      }

      const all = yield* messages({ sessionID: input.sessionID })
      const point = input.afterMessageID ?? input.messageID
      const index = point ? all.findIndex((item) => item.info.id === point) : -1
      if (point && index < 0) return yield* failFork(input, "invalid-boundary", `Fork boundary not found: ${point}`)
      if (input.afterMessageID && all[index]?.info.role !== "assistant") {
        return yield* failFork(input, "invalid-boundary", "afterMessageID must identify an assistant message")
      }
      const retained = input.afterMessageID ? all.slice(0, index + 1) : input.messageID ? all.slice(0, index) : all
      const boundary = forkBoundary(input)

      if (input.operationID) {
        const rows = yield* db
          .select()
          .from(SessionTable)
          .all()
          .pipe(Effect.orDie)
        const match = rows.map(fromRow).find((item) => readForkMetadata(item.metadata)?.operationID === input.operationID)
        if (match) {
          const previous = readForkMetadata(match.metadata)!
          const sameBoundary =
            previous.sourceSessionID === input.sessionID &&
            previous.boundary.mode === boundary.mode &&
            previous.boundary.messageID === boundary.messageID
          if (!sameBoundary) {
            return yield* failFork(input, "operation-conflict", "operationID belongs to another fork request")
          }
          if (previous.state === "complete") return match
          if (yield* hasForkUserOutput(match)) {
            return yield* failFork(
              input,
              "recovery-conflict",
              "The incomplete fork contains user output and cannot be removed automatically",
            )
          }
          yield* remove(match.id)
          const stale = yield* db
            .select({ id: SessionTable.id })
            .from(SessionTable)
            .where(eq(SessionTable.id, match.id))
            .get()
            .pipe(Effect.orDie)
          if (stale) {
            return yield* failFork(input, "recovery-conflict", "The incomplete fork could not be cleaned safely")
          }
          yield* clearForkDiff(match.id)
        }
      }

      const lastUser = retained.findLast((item) => item.info.role === "user")
      const model =
        lastUser?.info.role === "user"
          ? {
              id: lastUser.info.model.modelID,
              providerID: lastUser.info.model.providerID,
              variant: lastUser.info.model.variant,
            }
          : point
            ? undefined
            : original.model
              ? { ...original.model }
              : undefined
      const sandboxFallback = yield* SandboxPolicy.peek(original.directory, input.sessionID)
      const operation = input.operationID
        ? ({
            version: 1,
            operationID: input.operationID,
            sourceSessionID: input.sessionID,
            boundary,
            state: "copying",
            expectedMessages: retained.length,
          } satisfies ForkMetadata)
        : undefined
      const baseMetadata = DocumentAgentScope.forkMetadata(original.metadata)
      const session = yield* createNext({
        directory: ctx.directory,
        path: sessionPath(ctx.worktree, ctx.directory),
        workspaceID: original.workspaceID,
        title: getForkedTitle(original.title),
        metadata: operation ? { ...baseMetadata, [forkMetadataKey]: operation } : baseMetadata,
        model,
        sourceID: input.sessionID,
        sandboxFallback,
      })

      const rollback = Effect.gen(function* () {
        yield* remove(session.id).pipe(Effect.ignore)
        yield* clearForkDiff(session.id)
      })
      return yield* Effect.gen(function* () {
        const idMap = new Map(retained.map((item) => [item.info.id, MessageID.ascending()] as const))
        const graph = retained.map((item) => ({
          item,
          parts: item.parts
            .map((part) => ChipMateSession.prepareForkedPart(part))
            .filter((part): part is SessionV1.Part => part !== undefined),
        }))
        const frozenChildren = yield* ChipMateSession.freezeChildren({
          messages: graph.map((entry) => ({ info: entry.item.info, parts: entry.parts })),
          ops: { get, messages },
        })
        for (const entry of graph) {
          const newID = idMap.get(entry.item.info.id)!
          const parentID =
            entry.item.info.role === "assistant" && entry.item.info.parentID
              ? idMap.get(entry.item.info.parentID)
              : undefined
          const cloned = yield* updateMessage({
            ...entry.item.info,
            sessionID: session.id,
            id: newID,
            ...(entry.item.info.role === "assistant" && { cost: 0 }),
            ...(parentID && { parentID }),
          })
          for (const prepared of entry.parts) {
            const part: SessionV1.Part = {
              ...prepared,
              id: PartID.ascending(),
              messageID: cloned.id,
              sessionID: session.id,
              ...(prepared.type === "step-finish" && { cost: 0 }),
            }
            if (part.type === "compaction" && part.tail_start_id) part.tail_start_id = idMap.get(part.tail_start_id)
            yield* updatePart(part)
          }
        }

        const historical = Boolean(input.messageID || input.afterMessageID)
        let local: PortableDiff[] | undefined
        if (historical) {
          const parts = retained.flatMap((item) => item.parts)
          const from = parts.find(
            (part): part is SessionV1.StepStartPart => part.type === "step-start" && Boolean(part.snapshot),
          )?.snapshot
          const to = parts.findLast(
            (part): part is SessionV1.StepFinishPart => part.type === "step-finish" && Boolean(part.snapshot),
          )?.snapshot
          local =
            from && to
              ? yield* forkDiffFromSnapshots({ from, to })
              : retained
                  .filter((item) => item.info.role === "user")
                  .flatMap((item) => (item.info.role === "user" ? (item.info.summary?.diffs ?? []) : []))
                  .reduce<PortableDiff[]>((result, diff) => appendSessionDiffs({ existing: result, next: [diff] }), [])
        }
        yield* carryForkDiffAtBoundary(input.sessionID, session.id, local)
        yield* ChipMateSession.remapChildren({
          sessionID: session.id,
          remapped: new Map([[input.sessionID, session.id]]),
          ops: { get, messages, create, updateMessage, updatePart },
          frozen: frozenChildren,
        })
        if (operation) {
          yield* patch(session.id, {
            metadata: { ...session.metadata, [forkMetadataKey]: { ...operation, state: "complete" } },
            time: { updated: Date.now() },
          })
        }
        const result = yield* get(session.id)
        yield* Effect.logInfo("session fork complete", {
          operationID: input.operationID,
          sourceSessionID: input.sessionID,
          targetSessionID: session.id,
          boundary: forkBoundaryKey(input),
          messages: retained.length,
          parts: graph.reduce((total, item) => total + item.parts.length, 0),
          children: frozenChildren.size,
          elapsedMs: Math.round(performance.now() - started),
        })
        return result
      }).pipe(Effect.onError(() => rollback))
    })

    const fork = Effect.fn("Session.fork")((input: ForkInput) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const key = `${ctx.directory}\0${input.sessionID}`
          const boundary = forkBoundaryKey(input)
          const existing = forkFlights.get(key)
          if (existing) {
            const same = input.operationID
              ? existing.operationID === input.operationID && existing.boundary === boundary
              : !existing.operationID && existing.boundary === boundary
            if (same) return yield* restore(Deferred.await(existing.done))
            return yield* failFork(input, "in-progress", "Another fork is already running for this session")
          }

          const done = yield* Deferred.make<Info, NotFound | ForkError>()
          const flight = { operationID: input.operationID, boundary, done } satisfies ForkFlight
          forkFlights.set(key, flight)
          yield* Effect.gen(function* () {
            const exit = yield* restore(copyFork(input)).pipe(Effect.exit)
            if (forkFlights.get(key) === flight) forkFlights.delete(key)
            yield* Deferred.done(done, exit)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return yield* restore(Deferred.await(done))
        }),
      ),
    )
    // chipmate_change end

    const patch = (sessionID: SessionID, info: Patch) =>
      Effect.gen(function* () {
        const current = yield* get(sessionID)
        const next = {
          ...current,
          ...info,
          time: info.time ? { ...current.time, ...info.time } : current.time,
          share: info.share === null ? undefined : info.share ? { ...current.share, ...info.share } : current.share,
          summary: info.summary === null ? undefined : (info.summary ?? current.summary),
          revert: info.revert === null ? undefined : (info.revert ?? current.revert),
          permission: info.permission === null ? undefined : (info.permission ?? current.permission),
        } as Info
        yield* events.publish(SessionV1.Event.Updated, { sessionID, info: next })
      })

    const touch = Effect.fn("Session.touch")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() } }).pipe(Effect.orDie)
    })

    const setTitle = Effect.fn("Session.setTitle")(function* (input: { sessionID: SessionID; title: string }) {
      yield* patch(input.sessionID, { title: input.title }).pipe(Effect.orDie)
    })

    const setArchived = Effect.fn("Session.setArchived")(function* (input: { sessionID: SessionID; time?: number }) {
      yield* patch(input.sessionID, { time: { archived: input.time } }).pipe(Effect.orDie)
    })

    const setMetadata = Effect.fn("Session.setMetadata")(function* (input: typeof SetMetadataInput.Type) {
      yield* patch(input.sessionID, { metadata: input.metadata, time: { updated: Date.now() } }).pipe(Effect.orDie)
    })

    const setAgentModel = Effect.fn("Session.setAgentModel")(function* (input: {
      sessionID: SessionID
      agent: string
      model: NonNullable<Info["model"]>
      time: number
    }) {
      yield* patch(input.sessionID, {
        agent: input.agent,
        model: input.model,
        time: { updated: input.time },
      }).pipe(Effect.orDie)
    })

    const setPermission = Effect.fn("Session.setPermission")(function* (input: {
      sessionID: SessionID
      permission: PermissionV1.Ruleset
    }) {
      yield* patch(input.sessionID, { permission: [...input.permission], time: { updated: Date.now() } }).pipe(
        Effect.orDie,
      )
    })

    const setRevert = Effect.fn("Session.setRevert")(function* (input: {
      sessionID: SessionID
      revert: Info["revert"]
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, {
        summary: input.summary,
        time: { updated: Date.now() },
        revert: input.revert,
      }).pipe(Effect.orDie)
    })

    const clearRevert = Effect.fn("Session.clearRevert")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() }, revert: null }).pipe(Effect.orDie)
    })

    const setSummary = Effect.fn("Session.setSummary")(function* (input: {
      sessionID: SessionID
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, { time: { updated: Date.now() }, summary: input.summary }).pipe(Effect.orDie)
    })

    const setShare = Effect.fn("Session.setShare")(function* (input: { sessionID: SessionID; share: Info["share"] }) {
      yield* patch(input.sessionID, { share: input.share ?? null, time: { updated: Date.now() } }).pipe(Effect.orDie)
    })

    const setWorkspace = Effect.fn("Session.setWorkspace")(function* (input: {
      sessionID: SessionID
      workspaceID: Info["workspaceID"]
    }) {
      yield* patch(input.sessionID, { workspaceID: input.workspaceID, time: { updated: Date.now() } }).pipe(
        Effect.orDie,
      )
    })

    const diff = Effect.fn("Session.diff")(function* (sessionID: SessionID) {
      void sessionID
      return [] as Snapshot.FileDiff[]
    })

    const messages: Interface["messages"] = Effect.fn("Session.messages")(function* (input) {
      if (input.limit) {
        return (yield* MessageV2.page({ sessionID: input.sessionID, limit: input.limit }).pipe(
          Effect.provideService(Database.Service, database),
        )).items
      }

      const size = 50
      const result = [] as SessionV1.WithParts[]
      let before: string | undefined
      while (true) {
        const page = yield* MessageV2.page({ sessionID: input.sessionID, limit: size, before }).pipe(
          Effect.provideService(Database.Service, database),
        )
        if (page.items.length === 0) break
        for (let i = page.items.length - 1; i >= 0; i--) {
          const item = page.items[i]
          if (item) result.push(item)
        }
        if (!page.more || !page.cursor) break
        before = page.cursor
      }
      return result.reverse()
    })

    const removeMessage = Effect.fn("Session.removeMessage")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      yield* events.publish(SessionV1.Event.MessageRemoved, {
        sessionID: input.sessionID,
        messageID: input.messageID,
      })
      return input.messageID
    })

    const removePart = Effect.fn("Session.removePart")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
    }) {
      yield* events.publish(SessionV1.Event.PartRemoved, {
        sessionID: input.sessionID,
        messageID: input.messageID,
        partID: input.partID,
      })
      return input.partID
    })

    const updatePartDelta = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
      field: string
      delta: string
    }) {
      yield* events.publish(MessageV2.Event.PartDelta, input)
    })

    /** Finds the first message matching the predicate, searching newest-first. */
    const findMessage: Interface["findMessage"] = Effect.fn("Session.findMessage")(function* (sessionID, predicate) {
      const size = 50
      let before: string | undefined
      while (true) {
        const page = yield* MessageV2.page({ sessionID, limit: size, before }).pipe(
          Effect.provideService(Database.Service, database),
        )
        if (page.items.length === 0) break
        for (let i = page.items.length - 1; i >= 0; i--) {
          const item = page.items[i]
          if (item && predicate(item)) return Option.some(item)
        }
        if (!page.more || !page.cursor) break
        before = page.cursor
      }
      return Option.none<SessionV1.WithParts>()
    })

    return Service.of({
      list,
      listGlobal,
      create,
      fork,
      touch,
      get,
      setTitle,
      setArchived,
      setMetadata,
      setAgentModel,
      setPermission,
      setRevert,
      clearRevert,
      setSummary,
      setShare,
      setWorkspace,
      diff,
      messages,
      children,
      remove,
      updateMessage,
      removeMessage,
      removePart,
      updatePart,
      getPart,
      updatePartDelta,
      findMessage,
    })
  }),
)

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() => AppNodeBuilder.build(node)) // chipmate_change - build from the LayerNode graph

const cancelBackgroundJobs = Effect.fn("Session.cancelBackgroundJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  const jobs = yield* background.list()
  yield* Effect.forEach(
    jobs.filter((job) => {
      if (job.status !== "running") return false
      if (job.id === sessionID) return true
      if (job.metadata?.sessionId === sessionID) return true
      return job.metadata?.parentSessionId === sessionID
    }),
    (job) => background.cancel(job.id),
    { concurrency: "unbounded", discard: true },
  )
})

function listByProject(
  db: Database.Interface["db"],
  input: ListInput & {
    projectID: ProjectV2.ID
    experimentalWorkspaces: boolean
  },
) {
  // chipmate_change start - ChipMateSession.filters keeps sessions visible across project_id changes
  // (see PR #8875). That directory-anchored filter conflicts with upstream's path-prefix filter,
  // so bypass it when input.path is provided and fall back to the plain project_id base.
  const conditions =
    input.path !== undefined
      ? [eq(SessionTable.project_id, input.projectID)]
      : ChipMateSession.filters({ projectID: input.projectID, directory: input.directory })
  // chipmate_change end

  if (input.workspaceID) {
    conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
  }
  if (input.path !== undefined) {
    if (input.path) {
      const conds = [
        eq(SessionTable.path, input.path),
        like(SessionTable.path, sql.param(`${input.path}/%`, SessionTable.path)),
      ]

      conditions.push(
        input.directory
          ? or(...conds, and(isNull(SessionTable.path), eq(SessionTable.directory, input.directory))!)!
          : or(...conds)!,
      )
    }
  } else if (input.scope !== "project") {
    // chipmate_change start - directory filtering handled by ChipMateSession.filters above
    // if (input.directory) {
    //   conditions.push(eq(SessionTable.directory, input.directory))
    // }
    // chipmate_change end
  }
  if (input.roots) {
    conditions.push(isNull(SessionTable.parent_id))
  }
  if (input.start) {
    conditions.push(gte(SessionTable.time_updated, input.start))
  }
  if (input.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }

  const limit = input.limit ?? 100

  return db
    .select()
    .from(SessionTable)
    .where(and(...conditions))
    .orderBy(desc(SessionTable.time_updated))
    .limit(limit)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.map(fromRow)),
    )
}

// chipmate_change start - delegate to ChipMateSession.listGlobal (adds projectID worktree family + directories[])
export function listGlobal(input?: {
  projectID?: string
  directory?: string
  directories?: string[]
  currentDirectory?: string
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}) {
  return ChipMateSession.listGlobal<GlobalInfo>({ ...input, fromRow })
}
// chipmate_change end

// chipmate_change - delegate the exported Promise facade to the ChipMate session runtime
export const fork = chipmateSessionFork

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [TurnChanges.node, BackgroundJob.node, RuntimeFlags.node, Database.node, EventV2Bridge.node], // chipmate_change
})

export * as Session from "./session"
