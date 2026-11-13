import { expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { nextTime, preview, validate } from "../../src/chipmate/scheduler/time"
import { makeStore } from "../../src/chipmate/scheduler/store"
import type { TaskDefinition } from "@opencode-ai/core/chipmate/scheduler/types"
import { tmpdir } from "../fixture/fixture"

const definition: TaskDefinition = {
  name: "提交摘要",
  prompt: "汇总提交",
  timezone: "Asia/Shanghai",
  agent: "ask",
  model: { providerID: "fixture", modelID: "fixture" },
  timeoutMinutes: 60,
  schedule: { kind: "interval", minutes: 1, anchor: "2026-11-13T00:01:00Z" },
}
test("间隔规则跨重启保持锚点且支持未来五次预览", () => {
  expect(nextTime(definition.schedule, definition.timezone, Date.parse("2026-11-13T00:02:05Z"))).toBe(
    Date.parse("2026-11-13T00:03:00Z"),
  )
  expect(preview(definition, Date.parse("2026-11-13T00:00:00Z"))).toHaveLength(5)
  expect(() =>
    validate({ ...definition, schedule: { kind: "interval", minutes: 0, anchor: "2026-11-13T00:01:00Z" } }),
  ).toThrow()
})
test("日历规则跳过月末缺失日期、夏令时缺失时间，重复时间仅取较早一次", () => {
  expect(
    nextTime({ kind: "monthly", day: 31, time: "09:00" }, "Asia/Shanghai", Date.parse("2026-02-01T00:00:00Z")),
  ).toBe(Date.parse("2026-03-31T01:00:00Z"))
  expect(
    nextTime({ kind: "weekly", days: [7], time: "02:30" }, "America/New_York", Date.parse("2026-03-07T00:00:00Z")),
  ).toBe(Date.parse("2026-03-15T06:30:00Z"))
  expect(
    nextTime({ kind: "weekly", days: [7], time: "01:30" }, "America/New_York", Date.parse("2026-11-01T05:40:00Z")),
  ).toBe(Date.parse("2026-11-08T06:30:00Z"))
})
test("日期带明确偏移，非法时区与过期一次性规则得到确定结果", () => {
  expect(() => validate({ ...definition, timezone: "missing/zone" })).toThrow()
  expect(() => validate({ ...definition, schedule: { kind: "once", at: "2026-11-13T09:00:00" } })).toThrow()
  expect(
    nextTime({ kind: "once", at: "2026-11-13T00:00:00Z" }, "Asia/Shanghai", Date.parse("2026-11-13T00:00:01Z")),
  ).toBeNull()
})
test("真实 SQLite 事务隔离窗口领取，支持幂等、版本冲突和错过合并", async () => {
  await using directory = await tmpdir()
  const start = Date.parse("2026-11-13T00:00:00Z")
  await Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const store = makeStore(db)
      const scope = { key: "账号配置", directory: directory.path }
      const created = yield* store.command(scope, { action: "create", definition, key: "请求一" }, start)
      expect(created.id).toBe((yield* store.command(scope, { action: "create", definition, key: "请求一" }, start)).id)
      yield* store.tick(scope, "窗口一", start)
      yield* store.tick(scope, "窗口二", start)
      yield* store.tick(scope, "窗口一", start + 50_000)
      yield* store.tick(scope, "窗口二", start + 50_000)
      const claimed = yield* Effect.all(
        [store.tick(scope, "窗口一", start + 60_000), store.tick(scope, "窗口二", start + 60_000)],
        { concurrency: 2 },
      )
      expect(claimed.flat()).toHaveLength(1)
      const execution = claimed.flat()[0]
      execution.status = "completed"
      yield* store.writeRun(scope, execution)
      const stale = yield* Effect.exit(
        store.command(scope, { action: "pause", taskID: created.id, version: 0 }, start + 60_001),
      )
      expect(stale._tag).toBe("Failure")
      const paused = yield* store.command(scope, { action: "pause", taskID: created.id, version: 1 }, start + 60_001)
      expect("status" in paused && paused.status).toBe("paused")
      yield* store.command(scope, { action: "resume", taskID: created.id, version: 2 }, start + 60_002)
      expect(yield* store.tick(scope, "窗口三", start + 3_600_000)).toHaveLength(0)
      const history = yield* store.runs(scope)
      expect(history.find((run) => run.status === "skipped")?.missedCount).toBeGreaterThan(1)
      expect(yield* store.tasks({ ...scope, key: "其他账号" })).toEqual([])
      const manual = yield* store.command(
        scope,
        { action: "run_now", taskID: created.id, key: "手动一次" },
        start + 3_600_001,
      )
      expect(
        (yield* store.command(scope, { action: "run_now", taskID: created.id, key: "手动一次" }, start + 3_600_001)).id,
      ).toBe(manual.id)
      yield* store.command(scope, { action: "cancel_run", runID: manual.id }, start + 3_600_002)
      expect((yield* store.runs(scope)).find((run) => run.id === manual.id)?.status).toBe("cancelled")
      yield* store.command(scope, { action: "run_now", taskID: created.id, key: "租约测试" }, start + 3_600_003)
      const leased = yield* store.tick(scope, "窗口三", start + 3_600_004)
      expect(leased).toHaveLength(1)
      yield* store.tick(scope, "窗口三", start + 3_640_005)
      expect((yield* store.runs(scope)).find((item) => item.id === leased[0].id)?.status).toBe("interrupted")
      leased[0].status = "completed"
      yield* store.writeRun(scope, leased[0])
      expect((yield* store.runs(scope)).find((item) => item.id === leased[0].id)?.status).toBe("interrupted")

    }).pipe(Effect.provide(Database.layerFromPath(path.join(directory.path, "scheduler.db")))),
  )
})
