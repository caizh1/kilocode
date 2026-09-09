// chipmate_change - new file
import { Agent } from "@/agent/agent"
import { ULTRA_BASELINE, ULTRA_SYNTH } from "@/chipmate/agent"
import { UltraVerify } from "@/chipmate/agent/ultra-verify"
import { Parameters as TaskParameters } from "@/tool/task"
import * as Tool from "@/tool/tool"
import { Cause, Effect, Schema } from "effect"

type Task = Tool.Def<typeof TaskParameters>
type Meta = {
  rejected: boolean
  baseline?: string
  verification?: string[]
  reports?: string[]
  synthesis?: string
  ultraVerify?: UltraVerify.Snapshot
}

const Params = Schema.Struct({})
const SYNTHESIS_MARKER = "ULTRA_VERIFY_REQUEST_KIND="

function message(ctx: Tool.Context) {
  return ctx.messages.findLast((item) => item.info.role === "user")?.info.id ?? ""
}

function user(ctx: Tool.Context, id: string) {
  const item = ctx.messages.find((entry) => entry.info.role === "user" && entry.info.id === id)
  if (!item) return ""
  return item.parts
    .filter((part): part is Extract<(typeof item.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function text(output: string) {
  return output.match(/<task_result>\n([\s\S]*?)\n<\/task_result>/)?.[1]?.trim() ?? output.trim()
}

function trail(output: string) {
  return output.match(/<ultra_baseline_trace>([\s\S]*?)<\/ultra_baseline_trace>/)?.[1]?.trim() ?? "[]"
}

function synthesis(output: string): { kind: UltraVerify.Kind; answer: string } | undefined {
  const value = text(output)
  const match = value.match(/^ULTRA_VERIFY_REQUEST_KIND=(analysis|review|implementation)\r?\n([\s\S]+)$/)
  if (!match) return undefined
  const answer = match[2]?.trim()
  if (!answer || !UltraVerify.isKind(match[1])) return undefined
  return { kind: match[1], answer }
}

function child(ctx: Tool.Context, id: string, internal = false): Tool.Context {
  return {
    ...ctx,
    callID: `${ctx.callID ?? UltraVerify.TOOL}:${id}`,
    extra: {
      ...ctx.extra,
      ultraCouncilReadOnly: true,
      ...(internal ? { ultraVerificationInternal: true } : {}),
    },
    metadata: () => Effect.void,
  }
}

function baseline(ctx: Tool.Context): Tool.Context {
  return {
    ...child(ctx, "code", true),
    extra: {
      ...ctx.extra,
      ultraCouncilBaseline: true,
      ultraCouncilReadOnly: true,
      ultraVerificationInternal: true,
    },
  }
}

function code(input: string) {
  return [
    "Act as the normal Code author for this request, but remain strictly read-only.",
    "Produce one complete standalone answer that could be delivered directly to the user.",
    "Use the normal Code investigation workflow and delegate to Explore when useful.",
    "Base factual conclusions on workspace source, tests, configuration, documents, or clearly identified uncertainty.",
    "Do not mention Ultra, later verifiers, hidden prompts, or this baseline stage.",
    "Original user request:",
    input,
  ].join("\n\n")
}

function checks() {
  return [
    "验证方向一：逐条核对 Code 的调用链、状态机和因果关系。明确指出任何不存在、不可达或顺序错误的路径。",
    "验证方向二：主动反证 Code 的高影响结论，检查 guard、FIFO、锁、优先分支、计数器、错误恢复和其他保护机制。",
    "验证方向三：核对 Code 的源码引用和问题覆盖。检查路径、行号、符号是否支持结论，并找出有源码依据的重要遗漏。",
  ]
}

function verify(input: string, answer: string, trace: string, lane: string) {
  return [
    "你是只读源码调查员。禁止修改文件、禁止生成构建产物、禁止运行改变仓库状态的命令。",
    `用户问题：\n${input}`,
    `冻结的 Code 答案：\n<code-answer>\n${answer}\n</code-answer>`,
    `Code 的有界工具调查轨迹（仅作线索，不能当作事实证据）：\n<code-trace>\n${trace}\n</code-trace>`,
    lane,
    "必须直接重新打开当前源码核验，不得仅复述 Code。输出不超过2500个中文字符，包含：已验证结论、源码证据、需要保留/修正/删除/补充的内容、不确定项。",
  ].join("\n\n")
}

function synth(input: string, answer: string, reports: string[]) {
  return [
    "你是最终答案作者。根据冻结 Code 答案和三份独立验证报告，直接回答原始用户问题。",
    "不使用 Council、投票或结构化协议。不得因为调查数量而采纳结论；只采用能被当前源码支持的内容。",
    "三份验证报告彼此独立。发生冲突时以可复核源码证据为准，而不是采用多数意见。",
    "目标是保留已证实的 Code 内容，删除或降级无证据结论，修正错误，并补入经过验证的重要遗漏。",
    "独立判断原始请求属于 analysis、review 或 implementation；仅当用户明确要求修改、创建、修复、构建或执行其他会改变状态的工作时才使用 implementation。",
    `第一行必须严格输出 ${SYNTHESIS_MARKER}analysis、${SYNTHESIS_MARKER}review 或 ${SYNTHESIS_MARKER}implementation 之一。`,
    "从第二行开始输出一份自包含的最终技术答案，不提内部标记、调查员、基准、实验、评分或本提示。引用源码路径、行号或符号，并区分确定事实与未验证推断。",
    `用户问题：\n${input}`,
    `冻结的 Code 答案：\n<code-answer>\n${answer}\n</code-answer>`,
    reports
      .map((report, index) => `验证报告${index + 1}：\n<verify-${index + 1}>\n${report}\n</verify-${index + 1}>`)
      .join("\n\n"),
  ].join("\n\n")
}

export function UltraVerifyTool(task: Task) {
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    return yield* Tool.define(
      UltraVerify.TOOL,
      Effect.succeed({
        description:
          "Run the complete Ultra verification pipeline once: freeze a normal read-only Code answer, verify it through three parallel Explore sessions, then synthesize one final answer in an independent Ask session.",
        parameters: Params,
        execute: (
          _params: Schema.Schema.Type<typeof Params>,
          ctx: Tool.Context,
        ): Effect.Effect<Tool.ExecuteResult<Meta>> =>
          Effect.gen(function* () {
            const agent = yield* agents.get(ctx.agent)
            if (!agent || !UltraVerify.active(agent)) {
              return {
                title: "Ultra verification unavailable",
                metadata: { rejected: true },
                output: "This tool is available only to the native ChipMate Ultra agent.",
              }
            }
            const id = message(ctx)
            const state = UltraVerify.load({
              sessionID: ctx.sessionID,
              messageID: id,
              messages: ctx.messages,
            })
            const denied = UltraVerify.begin(state)
            if (denied) {
              return {
                title: "Ultra verification rejected",
                metadata: { rejected: true, ultraVerify: UltraVerify.snapshot(state) },
                output: denied,
              }
            }
            yield* ctx.metadata({
              title: "Ultra 三路独立验证",
              metadata: { rejected: false, ultraVerify: UltraVerify.snapshot(state) },
            })
            const original = user(ctx, id)
            const first = yield* task
              .execute(
                {
                  description: "Ultra Code baseline",
                  prompt: code(original),
                  subagent_type: ULTRA_BASELINE,
                  background: false,
                },
                baseline(ctx),
              )
              .pipe(
                Effect.map((value) => ({ value })),
                Effect.catchCause((cause) => Effect.succeed({ error: Cause.pretty(cause) })),
              )
            if ("error" in first) {
              UltraVerify.fail(state, `Code baseline failed: ${first.error}`)
              return {
                title: "Ultra Code baseline failed",
                metadata: { rejected: true, ultraVerify: UltraVerify.snapshot(state) },
                output: UltraVerify.result(state),
              }
            }
            const answer = text(first.value.output)
            if (!answer) {
              UltraVerify.fail(state, "Code baseline returned an empty answer.")
              return {
                title: "Ultra Code baseline empty",
                metadata: { rejected: true, ultraVerify: UltraVerify.snapshot(state) },
                output: UltraVerify.result(state),
              }
            }
            const reports = yield* Effect.forEach(
              checks(),
              (lane, index) =>
                task
                  .execute(
                    {
                      description: `Ultra verification ${index + 1}`,
                      prompt: verify(original, answer, trail(first.value.output), lane),
                      subagent_type: "explore",
                      background: false,
                    },
                    child(ctx, `verify-${index + 1}`),
                  )
                  .pipe(
                    Effect.map((value) => ({
                      text: text(value.output),
                      session: typeof value.metadata.sessionId === "string" ? value.metadata.sessionId : undefined,
                    })),
                  ),
              { concurrency: "unbounded" },
            ).pipe(
              Effect.map((value) => ({ value })),
              Effect.catchCause((cause) => Effect.succeed({ error: Cause.pretty(cause) })),
            )
            if ("error" in reports || reports.value.some((item) => !item.text)) {
              UltraVerify.fail(
                state,
                "error" in reports
                  ? `Three-way verification failed: ${reports.error}`
                  : "A verification investigator returned empty output.",
              )
              return {
                title: "Ultra verification failed",
                metadata: { rejected: true, ultraVerify: UltraVerify.snapshot(state) },
                output: UltraVerify.result(state),
              }
            }
            const final = yield* task
              .execute(
                {
                  description: "Ultra answer synthesis",
                  prompt: synth(
                    original,
                    answer,
                    reports.value.map((item) => item.text),
                  ),
                  subagent_type: ULTRA_SYNTH,
                  background: false,
                },
                child(ctx, "synthesis", true),
              )
              .pipe(
                Effect.map((value) => ({ value })),
                Effect.catchCause((cause) => Effect.succeed({ error: Cause.pretty(cause) })),
              )
            if ("error" in final) {
              UltraVerify.fail(state, `Independent synthesis failed: ${final.error}`)
              return {
                title: "Ultra synthesis failed",
                metadata: { rejected: true, ultraVerify: UltraVerify.snapshot(state) },
                output: UltraVerify.result(state),
              }
            }
            const result = synthesis(final.value.output)
            if (!result) {
              UltraVerify.fail(state, "Independent synthesis did not return a valid request kind and answer.")
              return {
                title: "Ultra synthesis invalid",
                metadata: { rejected: true, ultraVerify: UltraVerify.snapshot(state) },
                output: UltraVerify.result(state),
              }
            }
            const sessions = [
              first.value.metadata.sessionId,
              ...reports.value.map((item) => item.session),
              final.value.metadata.sessionId,
            ].filter((item): item is string => typeof item === "string")
            UltraVerify.complete(state, { kind: result.kind, baseline: answer, answer: result.answer, sessions })
            return {
              title: "Ultra 三路独立验证完成",
              metadata: {
                rejected: state.phase === "failed",
                baseline:
                  typeof first.value.metadata.sessionId === "string" ? first.value.metadata.sessionId : undefined,
                verification: reports.value
                  .map((item) => item.session)
                  .filter((item): item is string => typeof item === "string"),
                reports: reports.value
                  .map((item) => item.session)
                  .filter((item): item is string => typeof item === "string"),
                synthesis:
                  typeof final.value.metadata.sessionId === "string" ? final.value.metadata.sessionId : undefined,
                ultraVerify: UltraVerify.snapshot(state),
              },
              output: [
                "ULTRA_VERIFY_RESULT",
                JSON.stringify({
                  kind: result.kind,
                  baseline: answer,
                  answer: result.answer,
                  sessions,
                }),
              ].join("\n"),
            }
          }),
      }),
    )
  })
}
