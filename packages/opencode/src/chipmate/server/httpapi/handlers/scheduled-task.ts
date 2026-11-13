import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpServerRequest } from "effect/unstable/http"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Instance } from "@/chipmate/instance"
import { registerClient, clientFor, removeClient } from "@/chipmate/scheduler/context"
import { makeRuntime, TaskChanged } from "@/chipmate/scheduler/runtime"
import { preview } from "@/chipmate/scheduler/time"
import { Bus } from "@/bus"
import type { SchedulerCommand } from "@opencode-ai/core/chipmate/scheduler/types"

export const scheduledTaskHandlers = HttpApiBuilder.group(InstanceHttpApi, "scheduled-task", (handlers) =>
  Effect.gen(function* () {
    const runtime = yield* makeRuntime
    const check = (id: string) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const actual = request.headers["x-chipmate-client-id"]
        if (actual && actual !== id) throw new Error("执行窗口身份不匹配")
      })
    return handlers
      .handle("register", ({ payload }) =>
        Effect.gen(function* () {
          const input = payload as { clientID: string; profile: string; active: boolean }
          yield* check(input.clientID)
          const client = registerClient(input.clientID, input.profile, Instance.directory)
          if (!input.active) {
            yield* runtime.store.release(client.scope, client.id)
            removeClient(client)
          }
          return { state: yield* runtime.store.state(client.scope) }
        }).pipe(Effect.orDie),
      )
      .handle("tick", ({ payload }) =>
        Effect.gen(function* () {
          const input = payload as { clientID: string }
          yield* check(input.clientID)
          const client = clientFor(input.clientID, Instance.directory)
          // 活跃窗口通过每次检查延长自身的内存登记。
          client.expires = Date.now() + 30_000
          const claimed = yield* runtime.store.tick(client.scope, client.id)
          for (const value of claimed) yield* runtime.launch(client.scope, value)
          return { state: yield* runtime.store.state(client.scope) }
        }).pipe(Effect.orDie),
      )
      .handle("command", ({ payload }) =>
        Effect.gen(function* () {
          const input = payload as { clientID: string; command: SchedulerCommand }
          yield* check(input.clientID)
          const client = clientFor(input.clientID, Instance.directory)
          const command = input.command
          const result = yield* Effect.gen(function* () {
            if (command.action === "preview") return { result: preview(command.definition!) }
            if (command.action === "list" || command.action === "runs") return {}
            return { result: yield* runtime.store.command(client.scope, command) }
          }).pipe(Effect.catchCause((cause) => Effect.succeed({ error: String(cause) })))
          if (command.taskID)
            yield* Effect.promise(() => Bus.publish(Instance.current, TaskChanged, { taskID: command.taskID! }))
          return { state: yield* runtime.store.state(client.scope), ...result }
        }).pipe(Effect.orDie),
      )
  }),
)
