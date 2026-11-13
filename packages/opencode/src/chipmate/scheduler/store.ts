import { MessageID } from "@/session/schema"
import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { Database } from "@opencode-ai/core/database/database"
import type {
  ScheduledTask,
  ScheduledRun,
  TaskDefinition,
  SchedulerCommand,
} from "@opencode-ai/core/chipmate/scheduler/types"
import { nextTime, validate } from "./time"

export type Scope = { key: string; directory: string }
type TaskRow = {
  id: string
  directory: string
  version: number
  status: ScheduledTask["status"]
  definition: string
  next_at: number | null
  created_at: number
}
type RunRow = { data: string; cancel_requested: number }
const task = (row: TaskRow): ScheduledTask => ({
  ...JSON.parse(row.definition),
  id: row.id,
  directory: row.directory,
  version: row.version,
  status: row.status,
  nextAt: row.next_at,
  createdAt: row.created_at,
})
const run = (row: RunRow): ScheduledRun => JSON.parse(row.data)
const active = ["queued", "running", "waiting"]

export function makeStore(db: Database.Interface["db"]) {
  const tasks = (scope: Scope) =>
    db
      .all<TaskRow>(
        sql`SELECT * FROM chipmate_scheduled_task WHERE scope=${scope.key} AND directory=${scope.directory} AND status!='deleted' ORDER BY created_at DESC`,
      )
      .pipe(Effect.map((rows) => rows.map(task)))
  const runs = (scope: Scope) =>
    db
      .all<RunRow>(
        sql`SELECT data,cancel_requested FROM chipmate_scheduled_run WHERE scope=${scope.key} AND directory=${scope.directory} ORDER BY rowid DESC LIMIT 200`,
      )
      .pipe(Effect.map((rows) => rows.map(run)))
  const state = (scope: Scope) =>
    Effect.gen(function* () {
      return { tasks: yield* tasks(scope), runs: yield* runs(scope), serverTime: Date.now() }
    })
  const writeRun = (scope: Scope, value: ScheduledRun) =>
    db.run(
      sql`UPDATE chipmate_scheduled_run SET data=${JSON.stringify(value)},status=${value.status} WHERE id=${value.id} AND scope=${scope.key} AND directory=${scope.directory} AND status IN ('running','waiting')`,
    )
  const insertRun = (tx: Pick<typeof db, "run">, scope: Scope, value: ScheduledRun, occurrence: string) =>
    tx.run(
      sql`INSERT INTO chipmate_scheduled_run(id,scope,directory,task_id,occurrence,data,status,owner,lease_until,cancel_requested) VALUES(${value.id},${scope.key},${scope.directory},${value.taskID},${occurrence},${JSON.stringify(value)},${value.status},${value.owner},0,0)`,
    )
  const newRun = (value: ScheduledTask, at: number, now: number): ScheduledRun => ({
    id: `run_${randomUUID()}`,
    directory: value.directory,
    taskID: value.id,
    taskVersion: value.version,
    scheduledAt: at,
    createdAt: now,
    status: "queued",
    messageID: MessageID.ascending(),
    owner: "",
    snapshot: value,
  })

  const command = (scope: Scope, input: SchedulerCommand, now = Date.now()) =>
    db.transaction(
      (tx) =>
        Effect.gen(function* () {
          if (input.action === "create") {
            if (!input.definition || !input.key) throw new Error("缺少任务配置或请求标识")
            validate(input.definition)
            const previous = yield* tx.get<TaskRow>(
              sql`SELECT * FROM chipmate_scheduled_task WHERE scope=${scope.key} AND request_key=${input.key}`,
            )
            if (previous) return task(previous)
            const next = nextTime(input.definition.schedule, input.definition.timezone, now)
            if (next === null) throw new Error("执行时间必须晚于当前时间")
            const id = `schedule_${randomUUID()}`
            yield* tx.run(
              sql`INSERT INTO chipmate_scheduled_task(id,scope,directory,version,status,definition,next_at,created_at,request_key) VALUES(${id},${scope.key},${scope.directory},1,'enabled',${JSON.stringify(input.definition)},${next},${now},${input.key})`,
            )
            return {
              ...input.definition,
              id,
              directory: scope.directory,
              version: 1,
              status: "enabled" as const,
              nextAt: next,
              createdAt: now,
            }
          }
          if (input.action === "get_run" || input.action === "cancel_run") {
            const row = yield* tx.get<RunRow>(
              sql`SELECT data,cancel_requested FROM chipmate_scheduled_run WHERE id=${input.runID ?? ""} AND scope=${scope.key} AND directory=${scope.directory}`,
            )
            if (!row) throw new Error("运行不存在或不属于当前项目")
            const value = run(row)
            if (input.action === "cancel_run" && active.includes(value.status)) {
              yield* tx.run(sql`UPDATE chipmate_scheduled_run SET cancel_requested=1 WHERE id=${value.id}`)
              if (value.status === "queued") {
                value.status = "cancelled"
                value.endedAt = now
                value.reason = "用户取消"
                yield* tx.run(
                  sql`UPDATE chipmate_scheduled_run SET status='cancelled',data=${JSON.stringify(value)} WHERE id=${value.id}`,
                )
              }
            }
            return value
          }
          const row = yield* tx.get<TaskRow>(
            sql`SELECT * FROM chipmate_scheduled_task WHERE id=${input.taskID ?? ""} AND scope=${scope.key} AND directory=${scope.directory} AND status!='deleted'`,
          )
          if (!row) throw new Error("任务不存在或不属于当前项目")
          const value = task(row)
          if (input.action === "get") return value
          if (input.action === "run_now") {
            if (!input.key) throw new Error("缺少请求标识")
            const occurrence = `manual:${input.key}`
            const previous = yield* tx.get<RunRow>(
              sql`SELECT data,cancel_requested FROM chipmate_scheduled_run WHERE task_id=${value.id} AND occurrence=${occurrence}`,
            )
            if (previous) return run(previous)
            const pending = yield* tx.get(
              sql`SELECT id FROM chipmate_scheduled_run WHERE task_id=${value.id} AND status IN ('queued','running','waiting')`,
            )
            if (pending) throw new Error("该任务已有未结束运行")
            const execution = newRun(value, now, now)
            yield* insertRun(tx, scope, execution, occurrence)
            return execution
          }
          if (input.version !== value.version) throw new Error("任务已修改，请刷新后重试")
          if (input.action === "update") {
            if (!input.definition) throw new Error("缺少任务配置")
            validate(input.definition)
            Object.assign(value, input.definition)
          }
          if (input.action === "pause") value.status = "paused"
          if (input.action === "resume") value.status = "enabled"
          if (input.action === "delete") value.status = "deleted"
          value.version++
          value.nextAt = value.status === "enabled" ? nextTime(value.schedule, value.timezone, now) : null
          if (value.status === "enabled" && value.nextAt === null) value.status = "finished"
          yield* tx.run(
            sql`UPDATE chipmate_scheduled_task SET version=${value.version},status=${value.status},definition=${JSON.stringify(value)},next_at=${value.nextAt} WHERE id=${value.id}`,
          )
          const pending = yield* tx.all<RunRow>(
            sql`SELECT data,cancel_requested FROM chipmate_scheduled_run WHERE task_id=${value.id} AND status IN ('queued','running','waiting')`,
          )
          for (const item of pending) {
            const execution = run(item)
            if (execution.status === "queued") {
              execution.status = "cancelled"
              execution.reason = "任务配置已更新"
              execution.endedAt = now
              yield* tx.run(
                sql`UPDATE chipmate_scheduled_run SET status='cancelled',data=${JSON.stringify(execution)},cancel_requested=1 WHERE id=${execution.id}`,
              )
            } else if (value.status === "deleted")
              yield* tx.run(sql`UPDATE chipmate_scheduled_run SET cancel_requested=1 WHERE id=${execution.id}`)
          }
          return value
        }),
      { behavior: "immediate" },
    )

  const tick = (scope: Scope, owner: string, now = Date.now()) =>
    db.transaction(
      (tx) =>
        Effect.gen(function* () {
          const previous = yield* tx.get<{ lease_until: number }>(
            sql`SELECT lease_until FROM chipmate_scheduler_client WHERE id=${owner}`,
          )
          const resumed = !previous || previous.lease_until < now
          yield* tx.run(
            sql`INSERT INTO chipmate_scheduler_client(id,scope,directory,lease_until) VALUES(${owner},${scope.key},${scope.directory},${now + 30_000}) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until`,
          )
          yield* tx.run(
            sql`UPDATE chipmate_scheduled_run SET lease_until=${now + 30_000} WHERE owner=${owner} AND status IN ('running','waiting') AND lease_until>=${now} AND cancel_requested=0`,
          )
          const abandoned = yield* tx.all<RunRow>(
            sql`SELECT data,cancel_requested FROM chipmate_scheduled_run WHERE scope=${scope.key} AND status IN ('running','waiting') AND lease_until<${now}`,
          )
          for (const item of abandoned) {
            const value = run(item)
            value.status = "interrupted"
            value.endedAt = now
            value.reason = "执行窗口断开，需手动确认后重试"
            yield* tx.run(
              sql`UPDATE chipmate_scheduled_run SET status='interrupted',data=${JSON.stringify(value)},cancel_requested=1 WHERE id=${value.id}`,
            )
          }
          const due = yield* tx.all<TaskRow>(
            sql`SELECT * FROM chipmate_scheduled_task WHERE scope=${scope.key} AND directory=${scope.directory} AND status='enabled' AND next_at<=${now}`,
          )
          for (const row of due) {
            const value = task(row)
            const at = value.nextAt!
            const execution = newRun(value, at, now)
            const pending = yield* tx.get(
              sql`SELECT id FROM chipmate_scheduled_run WHERE task_id=${value.id} AND status IN ('queued','running','waiting')`,
            )
            if (now - at > 30_000 || resumed || pending) {
              execution.status = "skipped"
              execution.endedAt = now
              execution.reason = pending ? "上次运行尚未结束" : "执行时间已错过"
              execution.missedThrough = now
              if (value.schedule.kind === "interval")
                execution.missedCount = Math.floor((now - at) / (value.schedule.minutes * 60_000)) + 1
            }
            yield* insertRun(tx, scope, execution, String(at))
            const next = nextTime(value.schedule, value.timezone, now)
            yield* tx.run(
              sql`UPDATE chipmate_scheduled_task SET next_at=${next},status=${next === null ? "finished" : "enabled"} WHERE id=${value.id}`,
            )
          }
          const pending = yield* tx.all<RunRow>(
            sql`SELECT data,cancel_requested FROM chipmate_scheduled_run WHERE scope=${scope.key} AND directory=${scope.directory} AND status='queued' ORDER BY rowid`,
          )
          const claimed: ScheduledRun[] = []
          for (const item of pending) {
            const value = run(item)
            if (now - value.createdAt > 30 * 60_000) {
              value.status = "skipped"
              value.endedAt = now
              value.reason = "排队超过 30 分钟"
              yield* tx.run(
                sql`UPDATE chipmate_scheduled_run SET status='skipped',data=${JSON.stringify(value)} WHERE id=${value.id}`,
              )
              continue
            }
            const busy = yield* tx.get(
              sql`SELECT id FROM chipmate_scheduled_run WHERE scope=${scope.key} AND directory=${scope.directory} AND status IN ('running','waiting')`,
            )
            const total = yield* tx.get<{ count: number }>(
              sql`SELECT count(*) AS count FROM chipmate_scheduled_run WHERE scope=${scope.key} AND status IN ('running','waiting')`,
            )
            if (busy || (total?.count ?? 0) >= 2) break
            value.status = "running"
            value.owner = owner
            yield* tx.run(
              sql`UPDATE chipmate_scheduled_run SET status='running',owner=${owner},lease_until=${now + 30_000},data=${JSON.stringify(value)} WHERE id=${value.id}`,
            )
            claimed.push(value)
          }
          return claimed
        }),
      { behavior: "immediate" },
    )

  const alive = (id: string, owner: string, now = Date.now()) =>
    db
      .get<{
        cancel_requested: number
        lease_until: number
        status: string
      }>(sql`SELECT cancel_requested,lease_until,status FROM chipmate_scheduled_run WHERE id=${id} AND owner=${owner}`)
      .pipe(
        Effect.map(
          (row) =>
            !!row && !row.cancel_requested && row.lease_until > now && ["running", "waiting"].includes(row.status),
        ),
      )
  const release = (scope: Scope, owner: string) =>
    Effect.gen(function* () {
      yield* db.run(sql`DELETE FROM chipmate_scheduler_client WHERE id=${owner} AND scope=${scope.key}`)
      yield* db.run(
        sql`UPDATE chipmate_scheduled_run SET cancel_requested=1,lease_until=0 WHERE owner=${owner} AND scope=${scope.key}`,
      )
    })
  return { tasks, runs, state, command, tick, writeRun, alive, release }
}
