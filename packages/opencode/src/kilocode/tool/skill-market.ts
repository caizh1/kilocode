// kilocode_change - new file
import { createHash } from "node:crypto"
import { Effect, Schema } from "effect"
import { SkillMarket } from "@/kilocode/skill-market/service"
import { SkillMarketIntent } from "@/kilocode/skill-market/intent"
import { TransactionID } from "@/kilocode/skill-market/protocol"
import { ToolJsonSchema } from "@/tool/json-schema"
import { Tool } from "@/tool/tool"

const Scope = Schema.Literals(["global", "project"])
const ID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const Transaction = Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)))

function key(tool: string, args: unknown, ctx: Tool.Context) {
  return createHash("sha256")
    .update(`${ctx.sessionID}\0${ctx.messageID}\0${ctx.callID ?? ""}\0${tool}\0${JSON.stringify(args)}`)
    .digest("hex")
}

function denied(tool: SkillMarketIntent.ToolID) {
  return {
    title: "Skill Market intent required",
    output: JSON.stringify({ success: false, errorCode: "intent_required", tool }),
    metadata: { success: false, errorCode: "intent_required" },
  }
}

function output(title: string, result: unknown) {
  return { title, output: JSON.stringify(result, null, 2), metadata: { success: true } }
}

function transaction(value: string | undefined) {
  return value ? TransactionID.make(value) : undefined
}

function approve(ctx: Tool.Context, operation: string, id: string, preview: unknown) {
  return ctx.ask({
    permission: operation,
    patterns: [`${id}:*`],
    always: [],
    metadata: { disableAlways: true, skillId: id, preview },
  })
}

const SearchParams = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  category: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  author: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  sort: Schema.optional(Schema.Literals(["updated", "downloads", "favorites", "name"])),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 20 }))),
})

const InstallParams = Schema.Struct({
  id: ID,
  revision: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  scope: Scope,
  replace: Schema.optional(Schema.Boolean),
  transactionId: Transaction,
})

const File = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  encoding: Schema.Literals(["utf8", "base64"]),
  content: Schema.String.check(Schema.isMaxLength(14_000_000)),
})

const CreateParams = Schema.Struct({
  id: ID,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  description: Schema.String.check(Schema.isMaxLength(5_000)),
  category: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  tags: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(Schema.isMaxLength(50))),
  scope: Scope,
  files: Schema.Array(File).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  replace: Schema.optional(Schema.Boolean),
  transactionId: Transaction,
})

const PublishParams = Schema.Struct({
  id: ID,
  scope: Scope,
  notes: Schema.optional(Schema.String.check(Schema.isMaxLength(5_000))),
  expectedSha256: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  transactionId: Transaction,
})

const BeginParams = Schema.Struct({
  action: Schema.Literal("begin"),
  skillId: ID,
  scope: Scope,
  intents: Schema.Array(Schema.Literals(["create", "install", "publish"])).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(3),
  ),
})
const ActionParams = Schema.Struct({
  action: Schema.Literals(["commit", "abort", "status", "undo", "purge"]),
  transactionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
})
const ListParams = Schema.Struct({
  action: Schema.Literal("list"),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 20 }))),
})
const TransactionParams = Schema.Union([BeginParams, ActionParams, ListParams])
const TransactionSchema = { ...ToolJsonSchema.fromSchema(TransactionParams), type: "object" as const }

export const SkillMarketSearchTool = Tool.define(
  "skill_market_search",
  Effect.gen(function* () {
    const host = yield* SkillMarket.Service
    return {
      description:
        "Search the configured Skill Market only when the user explicitly asks to find or search for Skills. Never use this for ordinary QA, conceptual Skill questions, or automatic recommendations.",
      parameters: SearchParams,
      execute: (args: Schema.Schema.Type<typeof SearchParams>, ctx: Tool.Context) => {
        if (!SkillMarketIntent.allows("skill_market_search", ctx.messages)) return Effect.succeed(denied("skill_market_search"))
        return host
          .request({
            operation: "search",
            sessionID: ctx.sessionID,
            key: key("skill_market_search", args, ctx),
            query: args.query,
            category: args.category,
            author: args.author,
            sort: args.sort,
            cursor: args.cursor,
            limit: args.limit ?? 10,
          })
          .pipe(Effect.map((result) => output("Skill Market search", result)), Effect.orDie)
      },
    }
  }),
)

export const SkillMarketInstallTool = Tool.define(
  "skill_market_install",
  Effect.gen(function* () {
    const host = yield* SkillMarket.Service
    return {
      description:
        "Prepare and atomically install one Skill only after an explicit user request. Never install a Skill merely because it may help answer ordinary QA.",
      parameters: InstallParams,
      execute: (args: Schema.Schema.Type<typeof InstallParams>, ctx: Tool.Context) => {
        if (!SkillMarketIntent.allows("skill_market_install", ctx.messages)) return Effect.succeed(denied("skill_market_install"))
        return Effect.gen(function* () {
          const prepared = yield* host.request({
            operation: "prepare_install",
            sessionID: ctx.sessionID,
            key: key("skill_market_install", args, ctx),
            transactionId: transaction(args.transactionId),
            skillId: args.id,
            revision: args.revision,
            scope: args.scope,
            replace: args.replace ?? false,
          })
          if (!prepared.transactionId || prepared.state === "COMMITTED") return output("Skill install", prepared)
          yield* approve(ctx, "skill_market_install", args.id, prepared.preview)
          yield* host.request({
            operation: "approve",
            sessionID: ctx.sessionID,
            key: `${key("skill_market_install", args, ctx)}-approve`,
            transactionId: prepared.transactionId,
          })
          if (args.transactionId) return output("Skill install prepared", prepared)
          const result = yield* host.request({
            operation: "commit",
            sessionID: ctx.sessionID,
            key: `${key("skill_market_install", args, ctx)}-commit`,
            transactionId: prepared.transactionId,
          })
          return output("Skill installed", result)
        }).pipe(Effect.orDie)
      },
    }
  }),
)

export const SkillCreateTool = Tool.define(
  "skill_create",
  Effect.gen(function* () {
    const host = yield* SkillMarket.Service
    return {
      description:
        "Create one local Skill transactionally only when the user explicitly asks to create or write a Skill. Never use for ordinary file generation or QA.",
      parameters: CreateParams,
      execute: (args: Schema.Schema.Type<typeof CreateParams>, ctx: Tool.Context) => {
        if (!SkillMarketIntent.allows("skill_create", ctx.messages)) return Effect.succeed(denied("skill_create"))
        return Effect.gen(function* () {
          const prepared = yield* host.request({
            operation: "prepare_create",
            sessionID: ctx.sessionID,
            key: key("skill_create", args, ctx),
            transactionId: transaction(args.transactionId),
            skillId: args.id,
            name: args.name,
            description: args.description,
            category: args.category,
            tags: args.tags,
            scope: args.scope,
            files: args.files,
            replace: args.replace ?? false,
          })
          if (!prepared.transactionId) return output("Skill create", prepared)
          yield* approve(ctx, "skill_create", args.id, prepared.preview)
          yield* host.request({
            operation: "approve",
            sessionID: ctx.sessionID,
            key: `${key("skill_create", args, ctx)}-approve`,
            transactionId: prepared.transactionId,
          })
          if (args.transactionId) return output("Skill create prepared", prepared)
          const result = yield* host.request({
            operation: "commit",
            sessionID: ctx.sessionID,
            key: `${key("skill_create", args, ctx)}-commit`,
            transactionId: prepared.transactionId,
          })
          return output("Skill created", result)
        }).pipe(Effect.orDie)
      },
    }
  }),
)

export const SkillMarketPublishTool = Tool.define(
  "skill_market_publish",
  Effect.gen(function* () {
    const host = yield* SkillMarket.Service
    return {
      description:
        "Publish one explicitly selected local Skill to the configured market. Never publish during ordinary QA or without a per-operation user approval.",
      parameters: PublishParams,
      execute: (args: Schema.Schema.Type<typeof PublishParams>, ctx: Tool.Context) => {
        if (!SkillMarketIntent.allows("skill_market_publish", ctx.messages)) return Effect.succeed(denied("skill_market_publish"))
        return Effect.gen(function* () {
          const prepared = yield* host.request({
            operation: "prepare_publish",
            sessionID: ctx.sessionID,
            key: key("skill_market_publish", args, ctx),
            transactionId: transaction(args.transactionId),
            skillId: args.id,
            scope: args.scope,
            notes: args.notes,
            expectedSha256: args.expectedSha256,
          })
          if (!prepared.transactionId) return output("Skill publish", prepared)
          yield* approve(ctx, "skill_market_publish", args.id, prepared.preview)
          yield* host.request({
            operation: "approve",
            sessionID: ctx.sessionID,
            key: `${key("skill_market_publish", args, ctx)}-approve`,
            transactionId: prepared.transactionId,
          })
          if (args.transactionId) return output("Skill publish prepared", prepared)
          const result = yield* host.request({
            operation: "commit",
            sessionID: ctx.sessionID,
            key: `${key("skill_market_publish", args, ctx)}-commit`,
            transactionId: prepared.transactionId,
          })
          return output("Skill published", result)
        }).pipe(Effect.orDie)
      },
    }
  }),
)

export const SkillTransactionTool = Tool.define(
  "skill_transaction",
  Effect.gen(function* () {
    const host = yield* SkillMarket.Service
    return {
      description:
        "Manage an explicit Skill operation transaction. Use begin for multi-step create/publish work and undo only when the user explicitly requests rollback.",
      parameters: TransactionParams,
      jsonSchema: TransactionSchema,
      execute: (args: Schema.Schema.Type<typeof TransactionParams>, ctx: Tool.Context) => {
        if (!SkillMarketIntent.allows("skill_transaction", ctx.messages)) return Effect.succeed(denied("skill_transaction"))
        return Effect.gen(function* () {
          const base = { sessionID: ctx.sessionID, key: key("skill_transaction", args, ctx) }
          if (args.action === "begin") {
            return output(
              "Skill transaction started",
              yield* host.request({
                ...base,
                operation: "begin",
                skillId: args.skillId,
                scope: args.scope,
                intents: args.intents,
              }),
            )
          }
          if (args.action === "list") {
            return output(
              "Skill transactions",
              yield* host.request({ ...base, operation: "list", limit: args.limit ?? 20 }),
            )
          }
          const id = TransactionID.make(args.transactionId)
          if (args.action === "undo" || args.action === "purge") {
            yield* approve(ctx, `skill_transaction_${args.action}`, args.transactionId, { transactionId: args.transactionId })
          }
          return output(
            `Skill transaction ${args.action}`,
            yield* host.request({ ...base, operation: args.action, transactionId: id }),
          )
        }).pipe(Effect.orDie)
      },
    }
  }),
)

export const SkillMarketTools = Effect.all({
  search: SkillMarketSearchTool,
  install: SkillMarketInstallTool,
  create: SkillCreateTool,
  publish: SkillMarketPublishTool,
  transaction: SkillTransactionTool,
})
