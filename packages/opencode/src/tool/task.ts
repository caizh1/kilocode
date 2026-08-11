import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider" // chipmate_change
import { ChipMateTask } from "../chipmate/tool/task" // chipmate_change
import { ChipMateTaskBackgroundProcess } from "../chipmate/tool/task-background-process" // chipmate_change
import { ChipMateCostPropagation } from "../chipmate/session/cost-propagation" // chipmate_change
import { ChipMateSessionProcessor } from "../chipmate/session/processor" // chipmate_change
import { ChipMateSession } from "../chipmate/session" // chipmate_change
import { resumeHint } from "../chipmate/task-resume" // chipmate_change
import { errorMessage } from "@/util/error" // chipmate_change
import { Effect, Exit, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as SandboxPolicy from "@/chipmate/sandbox/policy" // chipmate_change
import { Database } from "@opencode-ai/core/database/database"
import * as WorkflowGuard from "@/chipmate/skill/workflow-guard" // chipmate_change

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  // chipmate_change start - surface the resumable task_id when a background subagent fails (#11620)
  const hint = resumeHint(input.sessionID)
  const body = input.state === "error" && !input.text.includes(hint) ? `${input.text}\n${hint}` : input.text
  // chipmate_change end
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    body, // chipmate_change - was input.text
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const provider = yield* Provider.Service // chipmate_change
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      // chipmate_change start - isolate controller-owned source-backed work items in fresh child contexts
      if (WorkflowGuard.sourceBacked(ctx.sessionID, ctx.messages)) {
        const boundJobId = WorkflowGuard.job(ctx.sessionID, ctx.messages)
        const allowed =
          boundJobId && params.command
            ? yield* Effect.tryPromise({
            try: async () => {
              const Job = await import("@/chipmate/source-backed-design/job")
              return Job.authorizeWorker({
                command: params.command!,
                sessionId: ctx.sessionID,
                boundJobId: boundJobId!,
              })
            },
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              }).pipe(Effect.catch(() => Effect.succeed(false)))
            : false
        if (!allowed || params.background === true || params.task_id)
          return yield* Effect.fail(
            new Error(
              "Task is restricted to the current controller-issued source-backed work item. Use the exact workItem.worker command and prompt in foreground mode; do not resume or create unrelated subagents.",
            ),
          )
      }
      // chipmate_change end
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(new Error("Background subagents require CHIPMATE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"))
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }
      // chipmate_change start — reject primary agents; only subagent/all modes allowed
      ChipMateTask.validate(
        next,
        params.subagent_type,
        ctx.extra?.ultraCouncilBaseline === true || ctx.extra?.ultraVerificationInternal === true,
      )
      // chipmate_change end

      const canTask = ChipMateTask.nestedTask(next) // chipmate_change - only the internal Ultra Code author may delegate one level
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      if (session && session.parentID !== ctx.sessionID) {
        return yield* Effect.fail(
          new Error(`Cannot resume session ${params.task_id}: not a child of the current session`),
        ) // chipmate_change - prevent cross-session task resume
      }
      const parent = yield* sessions.get(ctx.sessionID)
      // chipmate_change start — inherit edit/bash/MCP restrictions from calling agent
      const caller = yield* agent.get(ctx.agent)
      const rules = ChipMateTask.inherited({ caller, session: parent, mcp: cfg.mcp })
      const childPermission = ChipMateTask.merge(
        deriveSubagentSessionPermission({
          parentSessionPermission: parent.permission ?? [],
          subagent: next,
        }),
        cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*",
          action: "deny" as const,
        })) ?? [],
        ChipMateTask.permissions(rules, ctx.extra?.ultraCouncilReadOnly === true, canTask, cfg.mcp),
      )
      // chipmate_change end
      // chipmate_change start - refresh current parent restrictions when resuming an existing task session
      const fallback = SandboxPolicy.fallback(cfg)
      if (session) {
        yield* SandboxPolicy.inherit(ctx.sessionID, session.id, fallback)
        const permission = ChipMateTask.merge(session.permission ?? [], childPermission)
        session.permission = permission
        yield* sessions.setPermission({ sessionID: session.id, permission })
      }
      // chipmate_change end
      const platform = ChipMateSession.resolvePlatform(ctx.sessionID) // chipmate_change - preserve parent attribution across task creation/resume
      // chipmate_change start - create a child session with inherited ChipMate restrictions
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          platform, // chipmate_change
          permission: childPermission,
        }))
      // chipmate_change end
      // chipmate_change start - rebuild in-memory ancestry and inherit confinement after creation/resume
      ChipMateSession.register({ id: nextSession.id, parentID: ctx.sessionID, platform })
      yield* SandboxPolicy.inherit(ctx.sessionID, nextSession.id, fallback).pipe(
        Effect.provideService(Config.Service, config),
      )
      // chipmate_change end

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      // chipmate_change start — prefer valid subagent overrides, safely inheriting when overrides go stale
      const selected = yield* ChipMateTask.resolveModel({
        name: next.name,
        agent: next,
        config: cfg,
        parent: {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        },
        variant: msg.info.variant,
        workflow: ChipMateTask.workflow(ctx.extra), // chipmate_change
        provider,
      })
      const model = selected.model
      const variant = selected.variant
      // chipmate_change end
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        variant, // chipmate_change
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runTask = Effect.fn("TaskTool.runTask")(
        function* () {
          const parts = yield* ops.resolvePromptParts(params.prompt)
          ChipMateSessionProcessor.markReviewTelemetry(parts, params.command) // chipmate_change - carry review command into child session telemetry
          const result = yield* ops.prompt({
            messageID: MessageID.ascending(),
            sessionID: nextSession.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            variant, // chipmate_change
            agent: next.name,
            tools: {
              question: false, // chipmate_change - subagents cannot prompt the user directly
              interactive_terminal: false, // chipmate_change - subagents cannot take over the user's terminal
              ...(ctx.extra?.ultraCouncilReadOnly === true
                ? ChipMateTask.disabled()
                : {}), // chipmate_change - runtime-managed Ultra descendants cannot use mutating or human-driven tools
              ...(canTodo ? {} : { todowrite: false }),
              ...(canTask ? {} : { task: false }),
              ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
            },
            parts,
          })
          // chipmate_change start - expose terminal child assistant errors through the task tool boundary,
          // including the resumable task_id so the parent agent can continue the subagent (#11620)
          if (result.info.role === "assistant" && result.info.error) {
            return yield* Effect.fail(new Error(`${errorMessage(result.info.error)}\n${resumeHint(nextSession.id)}`))
          }
          // chipmate_change end
          return result.parts.findLast((item) => item.type === "text")?.text ?? ""
        },
        Effect.ensuring(ChipMateTaskBackgroundProcess.finish(nextSession.id)),
      ) // chipmate_change - transfer inherited processes when the child run ends

      // chipmate_change start - inject completed background task results into the parent session
      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderOutput({
                  sessionID: nextSession.id,
                  state,
                  summary:
                    state === "completed"
                      ? `Background task completed: ${params.description}`
                      : `Background task failed: ${params.description}`,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })
      // chipmate_change end

      // chipmate_change start - background tasks propagate only cost accrued by this invocation
      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (jobID: string) {
        yield* background.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      const withCostPropagation = <A, E, R>(task: Effect.Effect<A, E, R>) =>
        Effect.acquireUseRelease(
          ChipMateCostPropagation.childCost(sessions, nextSession.id),
          () => task,
          (costBefore) =>
            Effect.gen(function* () {
              const costAfter = yield* ChipMateCostPropagation.childCost(sessions, nextSession.id)
              yield* ChipMateCostPropagation.propagate(sessions, ctx.sessionID, ctx.messageID, costAfter - costBefore).pipe(
                Effect.provideService(Database.Service, database),
              )
            }),
        )

      const backgroundRun = withCostPropagation(runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))))
      // chipmate_change end

      if (
        yield* background.extend({
          id: nextSession.id,
          // chipmate_change - extended background work also propagates its cost
          run: withCostPropagation(runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id)))),
        })
      ) {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: nextSession.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task updated",
            text: BACKGROUND_UPDATED,
          }),
        }
      }

      const foregroundCost = runInBackground
        ? undefined
        : yield* ChipMateCostPropagation.childCost(sessions, nextSession.id) // chipmate_change - snapshot before the foreground job starts
      const info = yield* background.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
          notify(nextSession.id),
        ]),
        // chipmate_change - only the initial-background start needs its own cost bracket; the
        // foreground/promoted path below is already wrapped by the acquireUseRelease at the bottom of run()
        run: runInBackground ? backgroundRun : runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))),
      })

      function backgroundResult() {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: info.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task started",
            text: BACKGROUND_STARTED,
          }),
        }
      }

      if (runInBackground) {
        yield* notify(info.id)
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        // chipmate_change start - snapshot child cost so we propagate only the delta on resume (#6321)
        Effect.gen(function* () {
          ctx.abort.addEventListener("abort", onAbort)
          return foregroundCost ?? (yield* ChipMateCostPropagation.childCost(sessions, nextSession.id))
        }),
        // chipmate_change end
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(nextSession.id),
            )
            if (result?.metadata?.background === true) return backgroundResult()
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            // chipmate_change start - expose a bounded tool trace only to the internal Ultra Code baseline
            const trace =
              ctx.extra?.ultraCouncilBaseline === true
                ? ChipMateTask.trace(yield* sessions.messages({ sessionID: nextSession.id }))
                : undefined
            // chipmate_change end
            return {
              title: params.description,
              metadata,
              output: [
                renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
                ...(trace ? [`<ultra_baseline_trace>${JSON.stringify(trace)}</ultra_baseline_trace>`] : []),
              ].join("\n"),
            }
          }),
        // chipmate_change start - propagate subagent cost delta to parent on every exit path (#6321)
        (costBefore, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit))
              yield* Effect.all([cancel, background.cancel(nextSession.id)], { discard: true })
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                ctx.abort.removeEventListener("abort", onAbort)
                const costAfter = yield* ChipMateCostPropagation.childCost(sessions, nextSession.id).pipe(
                  Effect.catchTag("NotFoundError", () => Effect.succeed(costBefore)),
                )
                yield* ChipMateCostPropagation.propagate(
                  sessions,
                  ctx.sessionID,
                  ctx.messageID,
                  costAfter - costBefore,
                ).pipe(
                  Effect.provideService(Database.Service, database),
                  Effect.catchTag("NotFoundError", () => Effect.void),
                )
              }),
            ),
          ),
        // chipmate_change end
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
