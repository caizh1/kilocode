import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import * as WorkflowGuard from "@/chipmate/skill/workflow-guard"

const Parameters = Schema.Struct({
  action: Schema.Union([
    Schema.Literal("start"),
    Schema.Literal("resume"),
    Schema.Literal("submit"),
    Schema.Literal("status"),
  ]).annotate({ description: "任务操作。" }),
  jobId: Schema.optional(Schema.String).annotate({ description: "任务 ID；存在多个任务或提交结果时必填。" }),
  targetPath: Schema.optional(Schema.String).annotate({ description: "start 时必填的工作区内目标源码目录。" }),
  request: Schema.optional(Schema.String).annotate({ description: "start 时必填的用户原始详细设计请求。" }),
  workItemId: Schema.optional(Schema.String).annotate({ description: "submit 时必填的当前工作项 ID。" }),
  expectedRevision: Schema.optional(Schema.Number).annotate({ description: "submit 时必填的任务 revision。" }),
  resultPath: Schema.optional(Schema.String).annotate({ description: "submit 时必填，由控制器指定的工作项结果路径。" }),
})

type Input = Schema.Schema.Type<typeof Parameters>
type Metadata = {
  failed: boolean
  error?: string
  status?: string
  jobId?: string
  artifactDir?: string
  phase?: string
  revision?: number
  finalDocxPath?: string
  absoluteFinalDocxPath?: string
}

export const SourceBackedDesignJobTool = Tool.define(
  "source_backed_design_job",
  Effect.succeed({
    description:
      "Advance one bounded work item in an active source-backed-detail-design full-Word job. This tool is session-scoped and hidden from ordinary QA, ordinary Mermaid, and ordinary Word requests. Use start once, submit only the exact controller-provided result path, resume after continuation, and status for bounded diagnostics.",
    parameters: Parameters,
    execute: (input: Input, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
      Effect.gen(function* () {
        if (!WorkflowGuard.sourceBacked(ctx.sessionID, ctx.messages))
          return failure(
            "Source-backed Design Job Unavailable",
            "当前会话没有活动的 source-backed-detail-design Skill。",
          )
        yield* ctx.ask({
          permission: "source_backed_design_job",
          patterns: [input.jobId ?? input.targetPath ?? input.action],
          always: ["*"],
          metadata: { action: input.action, jobId: input.jobId },
        })
        const turnId = sourceBackedTurnId(ctx.messages, ctx.messageID)
        const response = yield* Effect.tryPromise({
          try: async () => {
            const Job = await import("@/chipmate/source-backed-design/job")
            if (input.action === "start") {
              const bound = WorkflowGuard.job(ctx.sessionID, ctx.messages)
              if (bound) throw new Error(`当前会话已绑定任务 ${bound}，请使用 resume/status，不要重复 start。`)
              if (!input.targetPath?.trim() || !input.request?.trim())
                throw new Error("start 必须提供 targetPath 和 request")
              return Job.start({
                targetPath: input.targetPath,
                request: input.request,
                sessionId: ctx.sessionID,
                messageId: turnId,
              })
            }
            const bound = WorkflowGuard.job(ctx.sessionID, ctx.messages)
            if (input.action === "resume") {
              if (bound && input.jobId && input.jobId !== bound)
                throw new Error(`当前会话绑定任务为 ${bound}，不能切换恢复 ${input.jobId}`)
              if (!bound && WorkflowGuard.activation(ctx.sessionID, ctx.messages) !== "skill-command")
                throw new Error(
                  "跨会话恢复必须通过现有 /source-backed-detail-design Skill 命令显式进入；普通“继续”不会扫描任务。",
                )
              return Job.resume({
                jobId: input.jobId ?? bound,
                sessionId: ctx.sessionID,
                messageId: turnId,
                takeover: !bound && WorkflowGuard.activation(ctx.sessionID, ctx.messages) === "skill-command",
              })
            }
            if (input.action === "status") return Job.status(input.jobId ?? bound)
            if (!input.jobId || !input.workItemId || input.expectedRevision === undefined || !input.resultPath)
              throw new Error("submit 必须提供 jobId、workItemId、expectedRevision 和 resultPath")
            if (bound && input.jobId !== bound)
              throw new Error(`当前会话绑定任务为 ${bound}，不能提交到 ${input.jobId}`)
            return Job.submit({
              jobId: input.jobId,
              workItemId: input.workItemId,
              expectedRevision: input.expectedRevision,
              resultPath: input.resultPath,
              sessionId: ctx.sessionID,
              messageId: turnId,
            })
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ error: error.message }) as const,
            onSuccess: (result) => ({ result }) as const,
          }),
        )
        if ("error" in response) return failure("Source-backed Design Job Failed", response.error)
        const result = response.result
        if (result.jobId && result.artifactDir)
          WorkflowGuard.bind(ctx.sessionID, ctx.messages, { root: result.artifactDir, jobId: result.jobId })
        return {
          title:
            result.status === "complete"
              ? "Source-backed Design Job Complete"
              : result.status === "blocked"
                ? "Source-backed Design Job Blocked"
                : result.status === "awaiting-continuation"
                  ? "Source-backed Design Job Awaiting Continuation"
                  : "Source-backed Design Job Ready",
          metadata: {
            status: result.status,
            jobId: result.jobId,
            artifactDir: result.artifactDir,
            phase: result.phase,
            revision: result.revision,
            finalDocxPath: result.finalDocxPath,
            absoluteFinalDocxPath: result.absoluteFinalDocxPath,
            failed: result.status === "blocked",
          },
          output: JSON.stringify(result, null, 2),
        }
      }).pipe(Effect.orDie),
  }),
)

export function sourceBackedTurnId(
  messages: Array<{ info: { id: string; role: string }; parts: Array<{ type: string }> }>,
  fallback: string,
) {
  return (
    messages.findLast(
      (message) => message.info.role === "user" && message.parts.some((part) => part.type !== "compaction"),
    )?.info.id ?? fallback
  )
}

function failure(title: string, message: string): Tool.ExecuteResult<Metadata> {
  return { title, metadata: { failed: true, error: message }, output: message }
}
