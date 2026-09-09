import { Agent } from "@/agent/agent"
import { UfsReviewAgent } from "@/chipmate/ufs-review/agent"
import { coordinatorPrompt, lanePrompt, lanes as selectLanes } from "@/chipmate/ufs-review/pipeline"
import { build, markdown, validate, type Draft } from "@/chipmate/ufs-review/report"
import { runReviewSession, type ReviewModel, type ReviewTelemetry } from "@/chipmate/ufs-review/session-runner"
import { prepare, refresh, ScopeError, type Snapshot } from "@/chipmate/ufs-review/snapshot"
import {
  Request,
  resolveRequest,
  type Lane,
  type LaneReport,
  type Report,
  type ValidationCommand,
  type ValidationResult,
} from "@/chipmate/ufs-review/types"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import type { TaskPromptOps } from "@/tool/task"
import * as Tool from "@/tool/tool"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Schema } from "effect"

type Metadata = {
  rejected: boolean
  stage?: "scope" | "review" | "validation" | "adjudication" | "complete"
  report?: Report
  lanes?: Lane[]
  reason?: string
}

const executables = new Set([
  "bun",
  "npm",
  "pnpm",
  "yarn",
  "make",
  "cmake",
  "ninja",
  "ctest",
  "cargo",
  "pytest",
  "python",
  "python3",
])

function commandText(argv: readonly string[]) {
  return argv.map((item) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(item) ? item : JSON.stringify(item))).join(" ")
}

function safe(command: ValidationCommand) {
  if (command.argv.length === 0 || command.argv.length > 64) return false
  if (!executables.has(command.argv[0])) return false
  return command.argv.every(
    (item) => item.length <= 1000 && !/[\r\n\0;&|`<>]/.test(item) && !item.includes("$(") && !item.includes("${"),
  )
}

function uniqueCommands(reports: LaneReport[]) {
  const seen = new Set<string>()
  return reports
    .flatMap((report) => report.validationCommands)
    .filter(safe)
    .filter((command) => {
      const key = JSON.stringify(command.argv)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function output(result: Awaited<ReturnType<typeof Process.text>>) {
  return `${result.text}\n${result.stderr.toString()}`.trim().slice(0, 12_000)
}

function selectedModel(ctx: Tool.Context): ReviewModel | undefined {
  const value = ctx.extra?.model
  if (!value || typeof value !== "object") return undefined
  const providerID = (value as { providerID?: unknown }).providerID
  const modelID = (value as { id?: unknown }).id
  const user = ctx.messages.findLast((message) => message.info.role === "user")
  const variant = user?.info.role === "user" ? user.info.model.variant : undefined
  if (typeof providerID !== "string" || typeof modelID !== "string") return undefined
  return {
    providerID,
    modelID,
    variant: typeof variant === "string" ? variant : undefined,
  }
}

function reviewTelemetry(items: Array<ReviewTelemetry | undefined>) {
  const usage: Report["usage"] = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  const files = new Set<string>()
  for (const item of items) {
    if (item?.usage) {
      usage.input += item.usage.input
      usage.output += item.usage.output
      usage.reasoning += item.usage.reasoning
      usage.cacheRead += item.usage.cacheRead
      usage.cacheWrite += item.usage.cacheWrite
    }
    for (const file of item?.filesRead ?? []) files.add(file)
  }
  return { usage, filesRead: [...files].toSorted() }
}

function promptOps(ctx: Tool.Context): TaskPromptOps | undefined {
  const value = ctx.extra?.promptOps
  if (!value || typeof value !== "object") return undefined
  const candidate = value as Partial<TaskPromptOps>
  if (typeof candidate.prompt !== "function" || typeof candidate.cancel !== "function") return undefined
  return candidate as TaskPromptOps
}

function validation(
  commands: ValidationCommand[],
  ctx: Tool.Context,
  snapshot: Snapshot,
): Effect.Effect<{ results: ValidationResult[]; mutated: boolean }> {
  if (commands.length === 0) return Effect.succeed({ results: [], mutated: false })
  return Effect.gen(function* () {
    const patterns = commands.map((command) => commandText(command.argv))
    const permission = yield* Effect.exit(
      ctx.ask({
        permission: "ufs_review_validation",
        patterns,
        always: [],
        forceAsk: true,
        metadata: {
          description: "Reviewer 批量验证",
          commands: commands.map((command) => ({ command: commandText(command.argv), reason: command.reason })),
        },
      }),
    )
    if (Exit.isFailure(permission))
      return {
        results: commands.map((command) => ({ ...command, status: "rejected" as const })),
        mutated: false,
      }
    const results: ValidationResult[] = []
    for (const [index, command] of commands.entries()) {
      const before = yield* Effect.tryPromise(() => refresh(snapshot, ctx.abort)).pipe(Effect.orDie)
      if (
        before.fingerprint !== snapshot.fingerprint ||
        before.workspaceFingerprint !== snapshot.workspaceFingerprint
      ) {
        results.push(...commands.slice(index).map((pending) => ({ ...pending, status: "skipped" as const })))
        return { results, mutated: true }
      }
      const result = yield* Effect.promise(() =>
        Process.text([...command.argv], { cwd: snapshot.root, abort: ctx.abort, nothrow: true }),
      )
      results.push({
        argv: command.argv,
        reason: command.reason,
        status: result.code === 0 ? "passed" : "failed",
        exitCode: result.code,
        output: output(result),
      })
      const after = yield* Effect.tryPromise(() => refresh(snapshot, ctx.abort)).pipe(Effect.orDie)
      if (after.fingerprint !== snapshot.fingerprint || after.workspaceFingerprint !== snapshot.workspaceFingerprint) {
        results.push(...commands.slice(index + 1).map((pending) => ({ ...pending, status: "skipped" as const })))
        return { results, mutated: true }
      }
    }
    return { results, mutated: false }
  })
}

export function UfsReviewTool(sessions: Session.Interface) {
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    return yield* Tool.define(
      "ufs_review",
      Effect.succeed({
        description:
          "启动一次权威的 UFS 固件只读代码审核：冻结范围和源码指纹，自适应创建 2–4 个独立专项 Session，执行反证、证据校验和双门禁报告。新审核请求必须使用本工具，不能用普通文本模拟。",
        parameters: Request,
        execute: (
          request: Schema.Schema.Type<typeof Request>,
          ctx: Tool.Context,
        ): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
          Effect.gen(function* () {
            const agent = yield* agents.get(ctx.agent)
            if (!agent || !UfsReviewAgent.active(agent))
              return {
                title: "Reviewer 不可用",
                metadata: { rejected: true, reason: "本工具仅对原生 Reviewer Agent 可见。" },
                output: "本工具仅对原生 Reviewer Agent 可见。",
              }
            const model = selectedModel(ctx)
            const prompts = promptOps(ctx)
            if (!model || !prompts)
              return {
                title: "Reviewer 运行时不可用",
                metadata: { rejected: true, reason: "缺少父 Session 的模型或私有 Session 运行能力。" },
                output: "缺少父 Session 的模型或私有 Session 运行能力，未启动审核。",
              }
            const resolved = resolveRequest(request)
            const instance = yield* InstanceState.context
            const runId = crypto.randomUUID()
            const startedAt = Date.now()
            yield* ctx.metadata({ title: "UFS 固件审核 · 固定范围", metadata: { rejected: false, stage: "scope" } })
            const snapshotResult = yield* Effect.tryPromise({
              try: () => prepare(instance.directory, resolved, ctx.abort),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            }).pipe(Effect.exit)
            if (Exit.isFailure(snapshotResult)) {
              const error = Cause.squash(snapshotResult.cause)
              const reason = error instanceof ScopeError ? error.message : `无法固定审核范围：${String(error)}`
              return {
                title: "Reviewer 范围无效",
                metadata: { rejected: true, stage: "complete", reason },
                output: reason,
              }
            }
            const snapshot = snapshotResult.value
            if (snapshot.files.length === 0) {
              const report = build({
                runId,
                startedAt,
                scope: resolved.scope,
                scopeLabel: snapshot.scopeLabel,
                effort: resolved.effort,
                guidance: resolved.guidance,
                snapshot,
                finalFingerprint: snapshot.fingerprint,
                lanes: [],
                validation: [],
                runStatus: resolved.effort === "quick" ? "LIMITED" : "COMPLETE",
                findings: [],
                unverifiedRisks: [],
                notes: ["范围内没有可审核文件，未启动专项 Session。"],
              })
              return {
                title: "Reviewer · 没有可审核变更",
                metadata: { rejected: false, stage: "complete", report },
                output: markdown(report),
              }
            }

            const lanes = selectLanes(snapshot, resolved.effort)
            yield* ctx.metadata({
              title: `UFS 固件审核 · ${lanes.length} 路并行`,
              metadata: { rejected: false, stage: "review", lanes },
            })
            const laneResults = yield* Effect.forEach(
              lanes,
              (lane) =>
                Effect.gen(function* () {
                  lane.status = "running"
                  let reason: string | undefined
                  for (let attempt = 1; attempt <= 2; attempt++) {
                    lane.attempts = attempt
                    const result = yield* runReviewSession({
                      sessions,
                      prompts,
                      parentID: ctx.sessionID,
                      role: lane.id,
                      title: `${lane.title}${attempt === 2 ? "格式重试" : "审核"}`,
                      prompt: lanePrompt({ snapshot, request: resolved, lane, retry: reason }),
                      model,
                      runID: runId,
                      attempt,
                    }).pipe(
                      Effect.map((value) => ({ value })),
                      Effect.catchCause((cause) => Effect.succeed({ error: Cause.pretty(cause) })),
                    )
                    if ("error" in result) {
                      reason = result.error
                      continue
                    }
                    lane.sessionID = result.value.sessionID
                    lane.status = "complete"
                    lane.reason = undefined
                    return { lane, report: result.value.report, telemetry: result.value.telemetry }
                  }
                  lane.status = "failed"
                  lane.reason = reason ?? "专项审核失败。"
                  return { lane, error: lane.reason }
                }),
              { concurrency: "unbounded" },
            )
            const successful = laneResults.flatMap((item) =>
              item.report && item.telemetry
                ? [{ lane: item.lane, report: item.report, telemetry: item.telemetry }]
                : [],
            )
            const failed = laneResults.flatMap((item) => (item.error ? [{ lane: item.lane, error: item.error }] : []))

            const commands = uniqueCommands(successful.map((item) => item.report))
            yield* ctx.metadata({
              title: commands.length ? "UFS 固件审核 · 等待批量验证" : "UFS 固件审核 · 对抗复核",
              metadata: { rejected: false, stage: commands.length ? "validation" : "adjudication", lanes },
            })
            const checked = yield* validation(commands, ctx, snapshot)
            yield* ctx.metadata({
              title: "UFS 固件审核 · 对抗复核",
              metadata: { rejected: false, stage: "adjudication", lanes },
            })

            let draft: Draft = {
              summary: "专项报告确定性合并结果",
              findings: successful.flatMap((item) => item.report.findings),
              unverifiedRisks: successful.flatMap((item) => item.report.unverifiedRisks),
              validationCommands: [],
            }
            let coordinatorFailed = successful.length === 0
            let coordinatorReason: string | undefined = successful.length === 0 ? "没有成功完成的专项审核。" : undefined
            let coordinatorTelemetry: ReviewTelemetry | undefined
            if (successful.length) {
              for (let attempt = 1; attempt <= 2; attempt++) {
                const result = yield* runReviewSession({
                  sessions,
                  prompts,
                  parentID: ctx.sessionID,
                  role: "coordinator",
                  title: attempt === 1 ? "UFS 审核对抗复核" : "UFS 复核格式重试",
                  prompt: coordinatorPrompt({
                    snapshot,
                    request: resolved,
                    reports: successful,
                    validation: checked.results,
                    retry: coordinatorReason,
                  }),
                  model,
                  runID: runId,
                  attempt,
                }).pipe(
                  Effect.map((value) => ({ value })),
                  Effect.catchCause((cause) => Effect.succeed({ error: Cause.pretty(cause) })),
                )
                if ("error" in result) {
                  coordinatorReason = result.error
                  continue
                }
                draft = result.value.report
                coordinatorTelemetry = result.value.telemetry
                coordinatorFailed = false
                coordinatorReason = undefined
                break
              }
            }

            const verified = yield* Effect.tryPromise(() => validate(snapshot, draft)).pipe(Effect.orDie)
            const final = yield* Effect.tryPromise(() => refresh(snapshot, ctx.abort)).pipe(Effect.orDie)
            const telemetry = reviewTelemetry([...successful.map((item) => item.telemetry), coordinatorTelemetry])
            const runStatus = checked.mutated
              ? "INCOMPLETE"
              : final.fingerprint !== snapshot.fingerprint
                ? "STALE"
                : failed.length > 0 || coordinatorFailed
                  ? "INCOMPLETE"
                  : resolved.effort === "quick"
                    ? "LIMITED"
                    : "COMPLETE"
            const risks = [
              ...verified.unverifiedRisks,
              ...failed.map((item) => `${item.lane.title} 未完成：${item.error}`),
              ...(coordinatorReason ? [`最终对抗复核未完成：${coordinatorReason}`] : []),
              ...checked.results
                .filter((item) => item.status === "rejected" || item.status === "skipped")
                .map((item) => `验证未执行：${commandText(item.argv)}（${item.reason}）`),
              ...checked.results
                .filter((item) => item.status === "failed")
                .map((item) => `验证失败：${commandText(item.argv)}（退出码 ${item.exitCode ?? "未知"}）`),
              ...(checked.mutated ? ["批量验证期间审核范围源码发生变化，结果不能批准。"] : []),
              ...(final.fingerprint !== snapshot.fingerprint ? ["审核期间源码指纹发生漂移，必须重新审核。"] : []),
            ]
            const report = build({
              runId,
              startedAt,
              scope: resolved.scope,
              scopeLabel: snapshot.scopeLabel,
              effort: resolved.effort,
              guidance: resolved.guidance,
              snapshot,
              finalFingerprint: final.fingerprint,
              lanes,
              validation: checked.results,
              model,
              usage: telemetry.usage,
              filesRead: telemetry.filesRead,
              runStatus,
              findings: verified.findings,
              unverifiedRisks: [...new Set(risks)],
              notes: ["当前为技术预览；未完成内部真实 UFS 固件盲测前，不代表生产验收。"],
            })
            yield* ctx.metadata({
              title: `Reviewer · ${report.verdict} · ${report.runStatus}`,
              metadata: { rejected: false, stage: "complete", lanes, report },
            })
            return {
              title: `Reviewer · ${report.verdict} · ${report.runStatus}`,
              metadata: { rejected: false, stage: "complete", lanes, report },
              output: markdown(report),
            }
          }),
      }),
    )
  })
}
