import path from "node:path"
import { Cause, Context, Effect, Exit, Layer, Schema } from "effect"
import type { Tool } from "ai"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { Snapshot } from "@/snapshot"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/chipmate/instance"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionID, MessageID } from "@/session/schema"
import { Patch } from "@/patch"
import { TurnStore } from "./store"
import type { Mutation } from "./schema"

export const Updated = BusEvent.define(
  "session.turn.changes",
  Schema.Struct({ sessionID: Schema.String, messageID: Schema.String }),
)
type Run = {
  root: string
  sessionID: SessionID
  messageID: MessageID
  pending: Set<Promise<unknown>>
  closing: boolean
  deleted?: boolean
}
const stores = new Map<string, TurnStore>()
const runs = new Map<string, Run>()

const context = Effect.gen(function* () {
  const instance = yield* InstanceState.context
  const root = instance.project.vcs === "git" ? instance.worktree : instance.directory
  const key = `${instance.project.id}:${root}`
  const existing = stores.get(key)
  const store =
    existing ??
    new TurnStore(
      root,
      path.join(Global.Path.data, "turn-changes", instance.project.id, Hash.fast(root)),
      path.join(Global.Path.data, "snapshot", instance.project.id, Hash.fast(instance.worktree)),
    )
  stores.set(key, store)
  return { instance, store }
})

const locked = <A, E, R>(work: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { store } = yield* context
    const flock = yield* EffectFlock.Service
    return yield* flock.withLock(work, `turn-changes:${store.root}`).pipe(Effect.orDie)
  })
const emit = (run: Pick<Run, "sessionID" | "messageID">) =>
  EffectBridge.fromPromise(() =>
    Bus.publish(Instance.current, Updated, { sessionID: run.sessionID, messageID: run.messageID }),
  )

export const enter = (sessionID: SessionID, messageID: MessageID, parentID?: SessionID) =>
  Effect.gen(function* () {
    const current = runs.get(sessionID)
    if (current?.messageID === messageID || (current && current.sessionID !== sessionID)) return
    if (current) yield* finish(sessionID, "completed")
    const { store } = yield* context
    const parent = parentID ? runs.get(parentID) : undefined
    if (parent && parent.root === store.root) {
      if (parent.closing) return yield* Effect.die(new Error("父轮次正在停止，不再启动子任务"))
      runs.set(sessionID, parent)
      return
    }
    yield* locked(
      Effect.gen(function* () {
        const { instance, store } = yield* context
        const config = yield* Config.Service
        const snapshot = yield* Snapshot.Service
        const busy = yield* writers
        const enabled = instance.project.vcs === "git" && (yield* config.get()).snapshot !== false
        const before = enabled
          ? yield* snapshot.track({ sessionID, messageID, snapshotInitialization: "wait" })
          : undefined
        yield* Effect.promise(() =>
          store.begin(
            sessionID,
            messageID,
            before,
            busy
              ? "工作区存在仍运行的 Agent 终端或后台进程，无法确认修改归属"
              : enabled
                ? undefined
                : "需要 Git 工作区并开启快照，才能按轮撤销",
          ),
        )
        runs.set(sessionID, { root: store.root, sessionID, messageID, pending: new Set(), closing: false })
        yield* emit({ sessionID, messageID })
      }),
    ).pipe(Effect.uninterruptible)
  })

// 工具返回不代表其启动的持久进程退出；无法确认停止时不开放撤销。
const writers = EffectBridge.fromPromise(async () => {
  const [{ BackgroundProcess }, { InteractiveTerminal }] = await Promise.all([
    import("@/chipmate/background-process"),
    import("@/chipmate/interactive-terminal"),
  ])
  const [background, terminals] = await Promise.all([BackgroundProcess.list(), InteractiveTerminal.list()])
  return (
    background.some((item) => !["exited", "failed", "stopped"].includes(item.status)) ||
    terminals.some((item) => item.status === "running")
  )
})

const capture = (run: Run) =>
  locked(
    Effect.gen(function* () {
      const { store } = yield* context
      const snapshot = yield* Snapshot.Service
      const after = yield* snapshot.track({
        sessionID: run.sessionID,
        messageID: run.messageID,
        snapshotInitialization: "wait",
      })
      yield* Effect.promise(() => store.capture(run.sessionID, run.messageID, after))
      yield* emit(run)
    }),
  )

const prepare = (run: Run, name: string, args: unknown) =>
  Effect.gen(function* () {
    if (!args || typeof args !== "object") return
    const params = args as Record<string, unknown>
    const paths =
      ["write", "edit"].includes(name) && typeof params.filePath === "string"
        ? [params.filePath]
        : name === "apply_patch" && typeof params.patchText === "string"
          ? Patch.parsePatch(params.patchText).hunks.flatMap((hunk) =>
              hunk.type === "update" && hunk.move_path ? [hunk.path, hunk.move_path] : [hunk.path],
            )
          : []
    if (!paths.length) return
    const { instance } = yield* context
    const files = paths
      .map((file) => path.relative(run.root, path.resolve(instance.directory, file)))
      .filter((file) => file && !file.startsWith("..") && !path.isAbsolute(file))
      .map((file) => file.split(path.sep).join("/"))
    if (!files.length) return
    yield* locked(
      Effect.gen(function* () {
        const { store } = yield* context
        yield* Effect.promise(() => store.prepare(run.sessionID, run.messageID, files))
      }),
    )
  })

export const wrapTools = (tools: Record<string, Tool>, sessionID: SessionID) =>
  Effect.gen(function* () {
    const bridge = yield* EffectBridge.make()
    for (const [name, tool] of Object.entries(tools)) {
      const execute = tool.execute
      if (!execute) continue
      tool.execute = (args, options) => {
        const run = runs.get(sessionID)
        if (!run) return execute(args, options)
        if (run.closing || options.abortSignal?.aborted) throw new Error("本轮已停止，未执行工具")
        const promise = Promise.resolve()
          .then(async () => {
            await bridge.promise(prepare(run, name, args))
            if (run.closing || options.abortSignal?.aborted) throw new Error("本轮已停止，未执行工具")
            return execute(args, options)
          })
          .finally(async () => {
            if (["read", "glob", "grep", "list", "question", "todowrite", "todoread"].includes(name)) return
            await bridge.promise(
              capture(run).pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* () {
                    const { store } = yield* context
                    yield* Effect.promise(() =>
                      store.phase(run.sessionID, run.messageID, "unavailable", "修改记录保存失败，暂不能撤销"),
                    )
                    yield* Effect.logError("保存本轮修改失败", { cause: Cause.pretty(cause) })
                  }),
                ),
              ),
            )
          })
        run.pending.add(promise)
        void promise.finally(() => run.pending.delete(promise)).catch(() => undefined)
        return promise
      }
    }
  })

export const stopping = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const run = runs.get(sessionID)
    if (!run || run.sessionID !== sessionID) return
    run.closing = true
    yield* locked(
      Effect.gen(function* () {
        const { store } = yield* context
        yield* Effect.promise(() => store.phase(run.sessionID, run.messageID, "stopping"))
        yield* emit(run)
      }),
    )
  })

export const finish = (sessionID: SessionID, outcome: "completed" | "interrupted" | "error") =>
  Effect.gen(function* () {
    const run = runs.get(sessionID)
    if (!run) return
    if (run.sessionID !== sessionID) {
      runs.delete(sessionID)
      return
    }
    run.closing = true
    yield* locked(
      Effect.gen(function* () {
        const { store } = yield* context
        yield* Effect.promise(() => store.phase(sessionID, run.messageID, "settling"))
        yield* emit(run)
      }),
    )
    // 工具的独立 Promise 包括实际执行和记录写入；不能用 UI 的停止 ACK 或 250ms 超时替代。
    while (run.pending.size) yield* Effect.promise(() => Promise.allSettled([...run.pending]))
    yield* locked(
      Effect.gen(function* () {
        const { store } = yield* context
        const snapshot = yield* Snapshot.Service
        const after = yield* snapshot.track({ sessionID, messageID: run.messageID, snapshotInitialization: "wait" })
        if (yield* writers)
          yield* Effect.promise(() =>
            store.phase(sessionID, run.messageID, "unavailable", "Agent 终端或后台进程仍在运行，无法确认写入已停止"),
          )
        yield* Effect.promise(() => store.capture(sessionID, run.messageID, after, outcome))
        if (run.deleted) yield* Effect.promise(() => store.remove(sessionID))
        yield* emit(run)
      }),
    )
    for (const [id, value] of runs) if (value === run) runs.delete(id)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        yield* Effect.logError("本轮修改收尾失败，保留执行记录并禁止撤销", { cause: Cause.pretty(cause) })
        const run = runs.get(sessionID)
        if (!run) return
        yield* locked(
          Effect.gen(function* () {
            const { store } = yield* context
            yield* Effect.promise(() =>
              store.phase(run.sessionID, run.messageID, "unavailable", "修改收尾未能完成，已保留记录，暂不能安全撤销"),
            )
            yield* emit(run)
          }),
        ).pipe(Effect.catchCause((error) => Effect.logError("无法保存收尾异常状态", { cause: Cause.pretty(error) })))
      }),
    ),
    Effect.uninterruptible,
  )

export const complete = (sessionID: SessionID, exit: Exit.Exit<unknown, unknown>, reason?: string) =>
  finish(
    sessionID,
    Exit.isFailure(exit)
      ? Cause.hasInterrupts(exit.cause)
        ? "interrupted"
        : "error"
      : reason === "interrupted"
        ? "interrupted"
        : reason === "error"
          ? "error"
          : "completed",
  )

export const get = (sessionID: string, messageID: string) =>
  locked(
    Effect.gen(function* () {
      const { store } = yield* context
      const summary = yield* Effect.tryPromise(() => store.get(sessionID, messageID))
      if (yield* Effect.promise(() => store.needsReconcile(sessionID, messageID))) {
        const snapshot = yield* Snapshot.Service
        const after = yield* snapshot.track({ snapshotInitialization: "wait" })
        yield* Effect.tryPromise(() => store.capture(sessionID, messageID, after, "interrupted"))
        return yield* Effect.tryPromise(() => store.get(sessionID, messageID))
      }
      if (summary?.canRevert || summary?.canRestore) {
        if (yield* writers)
          return {
            ...summary,
            canRevert: false,
            canRestore: false,
            reason: "工作区仍有 Agent 终端或后台进程运行，结束后才能撤销",
          }
      }
      return summary
    }),
  )
export const detail = (sessionID: string, messageID: string, fileID: string) =>
  locked(
    Effect.gen(function* () {
      const { store } = yield* context
      return yield* Effect.tryPromise(() => store.detail(sessionID, messageID, fileID))
    }),
  )
export const mutate = (sessionID: SessionID, messageID: MessageID, input: Mutation) =>
  locked(
    Effect.gen(function* () {
      const { store } = yield* context
      if (yield* writers) return yield* Effect.fail(new Error("工作区仍有 Agent 终端或后台进程运行，结束后才能撤销"))
      const result = yield* Effect.tryPromise(() => store.mutate(sessionID, messageID, input))
      yield* emit({ sessionID, messageID })
      return result
    }),
  ).pipe(Effect.uninterruptible)
export const external = (file: string) =>
  locked(
    Effect.gen(function* () {
      const { store } = yield* context
      yield* Effect.tryPromise(() => store.external(file))
    }),
  )
export const remove = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const run = runs.get(sessionID)
    if (run?.sessionID === sessionID) {
      run.deleted = true
      return
    }
    if (run) runs.delete(sessionID)
    yield* locked(
      Effect.gen(function* () {
        const { store } = yield* context
        yield* Effect.promise(() => store.remove(sessionID))
      }),
    )
  })

const make = Effect.gen(function* () {
  const config = yield* Config.Service
  const snapshot = yield* Snapshot.Service
  const flock = yield* EffectFlock.Service
  const provide = Effect.provide(
    Context.make(Config.Service, config).pipe(
      Context.add(Snapshot.Service, snapshot),
      Context.add(EffectFlock.Service, flock),
    ),
  )
  return {
    wrapTools: (...args: Parameters<typeof wrapTools>) => wrapTools(...args).pipe(provide),
    enter: (...args: Parameters<typeof enter>) => enter(...args).pipe(provide),
    complete: (...args: Parameters<typeof complete>) => complete(...args).pipe(provide),
    stopping: (...args: Parameters<typeof stopping>) => stopping(...args).pipe(provide),
    remove: (...args: Parameters<typeof remove>) => remove(...args).pipe(provide),
    get: (...args: Parameters<typeof get>) => get(...args).pipe(provide),
    detail: (...args: Parameters<typeof detail>) => detail(...args).pipe(provide),
    mutate: (...args: Parameters<typeof mutate>) => mutate(...args).pipe(provide),
    external: (...args: Parameters<typeof external>) => external(...args).pipe(provide),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@chipmate/TurnChanges") {}
export const layer = Layer.effect(Service, make)
export const node = LayerNode.make({ service: Service, layer, deps: [Config.node, Snapshot.node, EffectFlock.node] })
