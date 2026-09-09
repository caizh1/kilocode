import { afterAll, expect, test } from "bun:test"
import path from "node:path"
import { Exit } from "effect"
import { jsonSchema, type Tool } from "ai"
import { MessageID, SessionID } from "../../../src/session/schema"
import { makeRuntime } from "../../../src/effect/run-service"
import { AppNodeBuilderV1 } from "../../../src/effect/app-node-builder-v1"
import * as Changes from "../../../src/chipmate/turn-changes/runtime"
import { BackgroundProcess } from "../../../src/chipmate/background-process"
import { tmpdir, provideTestInstance, disposeTestRuntime } from "../../fixture/fixture"

const runtime = makeRuntime(Changes.Service, AppNodeBuilderV1.build(Changes.node))

test("同一会话按用户消息分别结算，后一轮报错也不丢失已写入内容", async () => {
  await using temporary = await tmpdir({ git: true })
  await provideTestInstance({
    directory: temporary.path,
    fn: async () => {
      const session = SessionID.make("ses_" + crypto.randomUUID())
      const first = MessageID.ascending()
      const second = MessageID.ascending()
      const file = path.join(temporary.path, "分轮.txt")
      const source = Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 行\n`).join("")
      await Bun.write(file, source)
      await runtime.runPromise((service) => service.enter(session, first))
      await Bun.write(file, source.replace("第 2 行", "第一轮修改"))
      await runtime.runPromise((service) => service.enter(session, second))
      const previous = await runtime.runPromise((service) => service.get(session, first))
      expect(previous?.phase).toBe("ready")
      expect(previous?.canRevert).toBe(false)
      await Bun.write(file, source.replace("第 2 行", "第一轮修改").replace("第 38 行", "第二轮修改"))
      await runtime.runPromise((service) => service.complete(session, Exit.fail(new Error("摘要前失败"))))
      const latest = await runtime.runPromise((service) => service.get(session, second))
      expect(latest?.outcome).toBe("error")
      expect(latest?.files).toHaveLength(1)
      expect(latest?.canRevert).toBe(true)
      const ready = await runtime.runPromise((service) => service.get(session, first))
      await runtime.runPromise((service) =>
        service.mutate(session, first, { revision: ready!.revision, requestID: "历史轮次", action: "revert" }),
      )
      expect(await Bun.file(file).text()).toBe(source.replace("第 38 行", "第二轮修改"))
      await runtime.runPromise((service) => service.remove(session))
    },
  })
}, 30_000)

afterAll(async () => {
  await runtime.dispose()
  await disposeTestRuntime()
})

test("写入中停止会等待实际工具收尾，期间拒绝新工具和撤销", async () => {
  await using temporary = await tmpdir({ git: true })
  await provideTestInstance({
    directory: temporary.path,
    fn: async () => {
      const session = { id: SessionID.make("ses_" + crypto.randomUUID()) }
      const message = MessageID.ascending()
      await runtime.runPromise((service) => service.enter(session.id, message))
      const first = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      const tools: Record<string, Tool> = {
        write: {
          inputSchema: jsonSchema({ type: "object" }),
          execute: async () => {
            await Bun.write(path.join(temporary.path, "第一处.txt"), "停止前已落盘")
            first.resolve()
            await resume.promise
            await Bun.write(path.join(temporary.path, "第二处.txt"), "受控写入收尾")
            return "完成"
          },
        },
      }
      await runtime.runPromise((service) => service.wrapTools(tools, session.id))
      const options = { toolCallId: "写入", messages: [] }
      const pending = tools.write!.execute!({}, options)
      await first.promise
      await runtime.runPromise((service) => service.stopping(session.id))
      const finish = runtime.runPromise((service) =>
        service.complete(session.id, Exit.succeed(undefined), "interrupted"),
      )
      try {
        const summary = await runtime.runPromise((service) => service.get(session.id, message))
        expect(["stopping", "settling"]).toContain(summary!.phase)
        expect(summary?.canRevert).toBe(false)
        expect(() => tools.write!.execute!({}, options)).toThrow("已停止")
        const denied = await runtime.runPromiseExit((service) =>
          service.mutate(session.id, message, { action: "revert", revision: summary!.revision, requestID: "正在停止" }),
        )
        expect(Exit.isFailure(denied)).toBe(true)
      } finally {
        resume.resolve()
      }
      await pending
      await finish
      const summary = await runtime.runPromise((service) => service.get(session.id, message))
      expect(summary?.phase).toBe("ready")
      expect(summary?.outcome).toBe("interrupted")
      expect(summary?.files.map((file) => file.file)).toEqual(["第一处.txt", "第二处.txt"])
      expect(summary?.canRevert).toBe(true)
      await runtime.runPromise((service) => service.remove(session.id))
    },
  })
}, 30_000)

test("仍运行的受控后台终端阻止历史撤销，退出后重新开放", async () => {
  await using temporary = await tmpdir({ git: true })
  await provideTestInstance({
    directory: temporary.path,
    fn: async () => {
      const session = SessionID.make("ses_" + crypto.randomUUID())
      const message = MessageID.ascending()
      await runtime.runPromise((service) => service.enter(session, message))
      await Bun.write(path.join(temporary.path, "历史.txt"), "历史轮次的实际修改")
      await runtime.runPromise((service) => service.complete(session, Exit.succeed(undefined)))
      expect((await runtime.runPromise((service) => service.get(session, message)))?.canRevert).toBe(true)
      const background = await BackgroundProcess.start({
        sessionID: session,
        command: `"${process.execPath}" -e "setInterval(() => {}, 1000)"`,
        description: "验收后台写入门禁",
      })
      try {
        const summary = await runtime.runPromise((service) => service.get(session, message))
        expect(summary?.canRevert).toBe(false)
        expect(summary?.reason).toContain("后台进程")
        const result = await runtime.runPromiseExit((service) =>
          service.mutate(session, message, {
            revision: summary!.revision,
            requestID: "后台尚未结束",
            action: "revert",
          }),
        )
        expect(Exit.isFailure(result)).toBe(true)
        expect(await Bun.file(path.join(temporary.path, "历史.txt")).text()).toBe("历史轮次的实际修改")
      } finally {
        await BackgroundProcess.stop(background.id)
      }
      expect((await runtime.runPromise((service) => service.get(session, message)))?.canRevert).toBe(true)
      await runtime.runPromise((service) => service.remove(session))
    },
  })
}, 30_000)

test("子任务改动归入父轮，删除子任务不会释放父轮原始内容", async () => {
  await using temporary = await tmpdir({ git: true })
  await provideTestInstance({
    directory: temporary.path,
    fn: async () => {
      const parent = SessionID.make("ses_" + crypto.randomUUID())
      const child = SessionID.make("ses_" + crypto.randomUUID())
      const message = MessageID.ascending()
      await runtime.runPromise((service) => service.enter(parent, message))
      await runtime.runPromise((service) => service.enter(child, MessageID.ascending(), parent))
      const tools: Record<string, Tool> = {
        write: {
          inputSchema: jsonSchema({ type: "object" }),
          execute: async () => {
            await Bun.write(path.join(temporary.path, "子任务.txt"), "子任务修改")
            return "完成"
          },
        },
      }
      await runtime.runPromise((service) => service.wrapTools(tools, child))
      await tools.write!.execute!({}, { toolCallId: "子任务写入", messages: [] })
      await runtime.runPromise((service) => service.remove(child))
      await runtime.runPromise((service) => service.complete(parent, Exit.succeed(undefined)))
      const summary = await runtime.runPromise((service) => service.get(parent, message))
      expect(summary?.files.map((file) => file.file)).toEqual(["子任务.txt"])
      expect(summary?.canRevert).toBe(true)
      await runtime.runPromise((service) =>
        service.mutate(parent, message, { revision: summary!.revision, requestID: "撤销子任务改动", action: "revert" }),
      )
      expect(await Bun.file(path.join(temporary.path, "子任务.txt")).exists()).toBe(false)
      await runtime.runPromise((service) => service.remove(parent))
    },
  })
}, 30_000)
