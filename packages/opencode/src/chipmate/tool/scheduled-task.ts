import type { Provider } from "@/provider/provider"
import { TaskChanged } from "@/chipmate/scheduler/events"
import { Bus } from "@/bus"
import { Effect, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Tool } from "@/tool/tool"
import { Instance } from "@/chipmate/instance"
import { sessionClient } from "@/chipmate/scheduler/context"
import { makeStore } from "@/chipmate/scheduler/store"
import { Command, Definition } from "@/chipmate/scheduler/schema"
import { isScheduledTurn } from "@/chipmate/scheduler/execution"
import { preview } from "@/chipmate/scheduler/time"
import type { SchedulerCommand } from "@opencode-ai/core/chipmate/scheduler/types"

const Parameters = Schema.Struct({
  ...Command.fields,
  definition: Schema.optional(
    Schema.Struct({
      ...Definition.fields,
      agent: Schema.optional(Schema.String),
      model: Schema.optional(Definition.fields.model),
      timeoutMinutes: Schema.optional(Schema.Int),
    }),
  ),
})

export const ScheduledTaskTool = Tool.define(
  "scheduled_task",
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return {
      description:
        "在 QA 对话中管理当前打开项目的定时任务。支持 create/list/get/update/pause/resume/delete/run_now/runs/get_run/cancel_run/preview。先查询真实 ID 和版本，再修改任务。时间使用明确时区。创建需完整 definition，默认继承当前 Agent 与模型；仅在用户要求时改变。间隔至少一分钟。规则 weekly 的星期一是1，星期日是7。不得把轮询进程当作定时任务。结果包含真实任务记录，禁止伪造成功。",
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (isScheduledTurn(ctx.sessionID, ctx.messages.findLast((item) => item.info.role === "user")?.info.id))
            throw new Error("定时执行不能管理定时任务")
          const model = ctx.extra?.model as Provider.Model | undefined
          const client = sessionClient(ctx.sessionID, Instance.directory)
          const store = makeStore(db)
          const command = structuredClone(input) as SchedulerCommand
          command.key = `${ctx.messageID}:${ctx.callID ?? "scheduled"}`
          if (command.definition && input.action === "create") {
            command.definition.agent ||= ctx.agent
            command.definition.timeoutMinutes ??= 60
            if (model) command.definition.model ??= { providerID: model.providerID, modelID: model.id }
          }
          if (
            command.definition &&
            command.definition.agent !==
              (command.action === "update"
                ? (yield* store.tasks(client.scope)).find((task) => task.id === command.taskID)?.agent
                : ctx.agent) &&
            ["create", "update"].includes(command.action)
          ) {
            yield* ctx.ask({
              permission: "scheduled_task",
              patterns: ["change_agent"],
              always: [],
              forceAsk: true,
              metadata: {
                message: `将定时任务执行模式从 ${ctx.agent} 改为 ${command.definition.agent}`,
                targetAgent: command.definition.agent,
              },
            })
          }
          yield* ctx.ask({
            permission: "scheduled_task",
            patterns: [input.action],
            always: ["*"],
            metadata: { action: input.action },
          })
          const result =
            command.action === "list"
              ? yield* store.tasks(client.scope)
              : command.action === "runs"
                ? (yield* store.runs(client.scope)).filter((item) => !command.taskID || item.taskID === command.taskID)
                : command.action === "preview"
                  ? preview(command.definition!)
                  : yield* store.command(client.scope, command)
          if (["create", "update", "pause", "resume", "delete"].includes(command.action)) {
            const id =
              result && typeof result === "object" && "id" in result ? String(result.id) : (command.taskID ?? "")
            yield* Effect.promise(() => Bus.publish(Instance.current, TaskChanged, { taskID: id }))
          }
          return { title: "定时任务", metadata: { action: command.action, result }, output: JSON.stringify(result) }
        }).pipe(Effect.orDie),
    }
  }),
)
