import { Effect, Scope, Exit, Cause } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionRunState } from "@/session/run-state"
import { SessionID, MessageID } from "@/session/schema"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { EffectBridge } from "@/effect/bridge"
import { runInEditor, editorOwner } from "../editor-ownership"
import { ChipMateSessionPromptQueue } from "../session/prompt-queue"
import { GlobalBus } from "@/bus/global"
import { RunChanged } from "./events"
export { TaskChanged } from "./events"
import { Bus } from "@/bus"
import { Instance } from "../instance"
import type { ScheduledRun } from "@opencode-ai/core/chipmate/scheduler/types"
import { markTurn, releaseTurn, guardTurn } from "./execution"
import { makeStore, type Scope as TaskScope } from "./store"

export const makeRuntime = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const store = makeStore(db)
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const runners = yield* SessionRunState.Service
  const permissions = yield* Permission.Service
  const questions = yield* Question.Service
  const provider = yield* Provider.Service
  const agents = yield* Agent.Service
  const lifetime = yield* Scope.Scope

  const launch = (scope: TaskScope, value: ScheduledRun) =>
    Effect.gen(function* () {
      const owner = value.snapshot.sessionID ? editorOwner(value.snapshot.sessionID) : undefined
      if (owner && !value.owner.startsWith(`${owner}:`)) {
        value.status = "queued"
        value.reason = "等待目标会话的执行窗口"
        yield* store.writeRun(scope, value)
        return
      }
      const bridge = yield* EffectBridge.make()
      const context = Instance.current
      const work = Effect.gen(function* () {
        const members = new Set<string>()
        const guard = () =>
          store.alive(value.id, value.owner).pipe(
            Effect.flatMap((alive) => (alive ? Effect.void : Effect.die(new Error("定时任务执行租约已失效")))),
            Effect.orDie,
          )
        let last = Date.now()
        let spent = 0
        let waited = 0
        const listener = (event: { payload: unknown }) => {
          const payload = event.payload as { type?: string; properties?: { info?: { id: string; parentID?: string } } }
          const info = payload.properties?.info
          if (payload.type === "session.created" && info?.parentID && members.has(info.parentID)) {
            members.add(info.id)
            markTurn(info.id)
            guardTurn(info.id, guard)
          }
        }
        const save = () =>
          store
            .writeRun(scope, value)
            .pipe(Effect.andThen(Effect.promise(() => Bus.publish(context, RunChanged, { runID: value.id }))))
        const cancel = () =>
          Effect.gen(function* () {
            if (!value.sessionID) return
            const id = SessionID.make(value.sessionID)
            if (ChipMateSessionPromptQueue.active(id) === value.messageID) {
              for (const member of members) yield* runners.cancel(SessionID.make(member))
            } else yield* ChipMateSessionPromptQueue.drop(id, MessageID.make(value.messageID))
          })
        const model = {
          providerID: ProviderV2.ID.make(value.snapshot.model.providerID),
          modelID: ModelV2.ID.make(value.snapshot.model.modelID),
        }
        const execute = Effect.gen(function* () {
          yield* provider.getModel(model.providerID, model.modelID)
          yield* agents.get(value.snapshot.agent)
          const session = value.snapshot.sessionID
            ? yield* sessions.get(SessionID.make(value.snapshot.sessionID))
            : yield* sessions.create({
                title: `${value.snapshot.name} · ${new Date(value.scheduledAt).toLocaleString("zh-CN", { timeZone: value.snapshot.timezone })}`,
                metadata: { scheduledTaskID: value.taskID, scheduledRunID: value.id },
              })
          if (session.directory !== scope.directory || session.parentID || session.metadata?.ephemeral)
            throw new Error("目标会话不属于当前项目或不可用于定时执行")
          value.sessionID = session.id
          members.add(session.id)
          markTurn(session.id, value.messageID)
          guardTurn(session.id, guard)
          yield* save()
          GlobalBus.on("event", listener)
          const monitor = Effect.gen(function* () {
            for (;;) {
              yield* Effect.sleep("500 millis")
              if (!(yield* store.alive(value.id, value.owner))) {
                yield* cancel()
                throw new Error("运行已取消或执行窗口失去连接")
              }
              const now = Date.now()
              const waiting =
                (yield* permissions.list()).some((item) => members.has(item.sessionID)) ||
                (yield* questions.list()).some((item) => members.has(item.sessionID))
              if (waiting) waited += now - last
              else if (ChipMateSessionPromptQueue.active(session.id) === value.messageID) spent += now - last
              last = now
              const status = waiting ? "waiting" : "running"
              if (status !== value.status) {
                value.status = status
                yield* save()
              }
              if (
                spent > value.snapshot.timeoutMinutes * 60_000 ||
                waited > 24 * 60 * 60_000 ||
                (!value.startedAt && now - value.createdAt > 30 * 60_000)
              ) {
                yield* cancel()
                throw new Error("定时任务等待或执行超时")
              }
              if (!value.startedAt && ChipMateSessionPromptQueue.active(session.id) === value.messageID) {
                value.startedAt = now
                yield* save()
              }
            }
          })
          const response = yield* Effect.raceFirst(
            prompt
              .prompt({
                sessionID: session.id,
                messageID: MessageID.make(value.messageID),
                agent: value.snapshot.agent,
                model,
                variant: value.snapshot.variant,
                parts: [{ type: "text", text: value.snapshot.prompt }],
              })
              .pipe(runInEditor(session.id, cancel())),
            monitor,
          )
          if (
            response.info.role !== "assistant" ||
            response.info.parentID !== value.messageID ||
            response.info.error ||
            !response.info.finish
          )
            throw new Error("本轮未产生有效完成结果")
        })
        const exit = yield* Effect.exit(
          execute.pipe(
            Effect.onInterrupt(() => cancel()),
            Effect.ensuring(
              Effect.sync(() => {
                GlobalBus.off("event", listener)
                for (const member of members) releaseTurn(member)
              }),
            ),
          ),
        )
        value.endedAt = Date.now()
        if (Exit.isSuccess(exit) && (yield* store.alive(value.id, value.owner))) value.status = "completed"
        else {
          const alive = yield* store.alive(value.id, value.owner)
          value.status = alive ? "failed" : "cancelled"
          value.reason = Exit.isFailure(exit) ? Cause.pretty(exit.cause).slice(0, 1000) : "运行已取消"
        }
        yield* save()
      })
      yield* bridge.run(work).pipe(Effect.forkIn(lifetime))
    })
  return { store, launch }
})
