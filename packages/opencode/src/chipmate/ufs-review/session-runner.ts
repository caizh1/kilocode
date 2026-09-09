import path from "node:path"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Schema } from "effect"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import type { TaskPromptOps } from "@/tool/task"
import { ToolJsonSchema } from "@/tool/json-schema"
import { UfsReviewAgent } from "./agent"
import { LaneReport, type LaneReport as LaneReportValue, type Report } from "./types"

export type ReviewTelemetry = {
  usage: Report["usage"]
  filesRead: string[]
}

export type ReviewModel = NonNullable<Report["model"]>

function filesRead(messages: SessionV1.WithParts[], root: string) {
  const files = new Set<string>()
  for (const part of messages.flatMap((message) => message.parts)) {
    if (part.type !== "tool" || part.tool !== "read" || !("input" in part.state)) continue
    const input = part.state.input
    if (!input || typeof input !== "object") continue
    const value = (input as { filePath?: unknown; path?: unknown }).filePath ?? (input as { path?: unknown }).path
    if (typeof value !== "string") continue
    const absolute = path.resolve(root, value)
    const relative = path.relative(root, absolute)
    files.add((relative.startsWith("..") || path.isAbsolute(relative) ? absolute : relative).replaceAll("\\", "/"))
  }
  return [...files].toSorted()
}

function telemetry(result: SessionV1.Assistant, messages: SessionV1.WithParts[], root: string): ReviewTelemetry {
  return {
    usage: {
      input: result.tokens.input,
      output: result.tokens.output,
      reasoning: result.tokens.reasoning,
      cacheRead: result.tokens.cache.read,
      cacheWrite: result.tokens.cache.write,
    },
    filesRead: filesRead(messages, root),
  }
}

export function runReviewSession(input: {
  sessions: Pick<Session.Interface, "create" | "messages">
  prompts: TaskPromptOps
  parentID: SessionID
  role: UfsReviewAgent.Role
  title: string
  prompt: string
  model: ReviewModel
  runID: string
  attempt: number
}) {
  return Effect.gen(function* () {
    const session = yield* input.sessions.create({
      parentID: input.parentID,
      title: input.title,
      agent: UfsReviewAgent.ROOT,
      model: {
        providerID: ProviderV2.ID.make(input.model.providerID),
        id: ModelV2.ID.make(input.model.modelID),
        variant: input.model.variant,
      },
      metadata: {
        ufsReviewRunID: input.runID,
        ufsReviewRole: input.role,
        ufsReviewAttempt: input.attempt,
      },
      permission: UfsReviewAgent.roleRules(input.role),
    })
    const result = yield* input.prompts
      .prompt({
        sessionID: session.id,
        agent: UfsReviewAgent.ROOT,
        model: {
          providerID: ProviderV2.ID.make(input.model.providerID),
          modelID: ModelV2.ID.make(input.model.modelID),
        },
        variant: input.model.variant,
        tools: UfsReviewAgent.roleTools(input.role),
        format: new SessionV1.OutputFormatJsonSchema({
          type: "json_schema",
          schema: structuredClone(ToolJsonSchema.fromSchema(LaneReport)),
          retryCount: 0,
        }),
        system: UfsReviewAgent.rolePrompt(input.role),
        snapshotInitialization: "wait",
        parts: [{ type: "text", text: input.prompt }],
      })
      .pipe(Effect.onInterrupt(() => input.prompts.cancel(session.id)))
    if (result.info.role !== "assistant")
      return yield* Effect.fail(new Error("Reviewer 子 Session 未返回 Assistant 消息。"))
    if (result.info.error) {
      const data = result.info.error.data
      const message = "message" in data && typeof data.message === "string" ? data.message : result.info.error.name
      return yield* Effect.fail(new Error(`Reviewer 子 Session 失败：${message}`))
    }
    if (result.info.structured === undefined)
      return yield* Effect.fail(new Error("Reviewer 子 Session 未返回结构化结果。"))
    const report = Schema.decodeUnknownSync(LaneReport)(result.info.structured, { errors: "all" })
    const messages = yield* input.sessions.messages({ sessionID: session.id })
    return {
      sessionID: session.id,
      report: report as LaneReportValue,
      telemetry: telemetry(result.info, messages, session.directory),
    }
  })
}
