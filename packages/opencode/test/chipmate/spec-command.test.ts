import { expect } from "bun:test"
import path from "node:path"
import { stat } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Effect, Fiber, Queue } from "effect"
import { SessionPrompt } from "../../src/session/prompt"
import { Session } from "../../src/session/session"
import { Question } from "../../src/question"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect, pollWithTimeout } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

import { specLayer, specOptions } from "./spec-fixture"

const it = testEffect(specLayer)

for (const action of ["确认并继续", "需要修改", "暂停", "关闭", "空答", "中断", "普通QA中断"] as const) {
  it.instance(
    `实际 /spec 经普通 Agent 调用 question：${action}`,
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const questions = yield* Question.Service
        const events = yield* EventV2Bridge.Service
        const { directory } = yield* TestInstance
        const chat = yield* sessions.create({ title: "Spec 接入验收" })
        const asked = yield* Queue.unbounded<Question.Request>()
        const off = yield* events.listen((event) => {
          if (event.type === Question.Event.Asked.type) Queue.offerUnsafe(asked, event.data as Question.Request)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => off)
        yield* llm.tool("question", {
          questions: [
            {
              header: "基线确认",
              question: "执行基线 v1 已展示，是否确认并生成计划？",
              options: ["确认并继续", "需要修改", "暂停"].map((label) => ({ label, description: label })),
            },
          ],
        })
        yield* llm.text("已收到工具结果；脚本化响应只验证接入。")
        const native = action === "普通QA中断"
        const interrupted = action.endsWith("中断")
        const start = native
          ? prompt.prompt({ sessionID: chat.id, parts: [{ type: "text", text: "核对已评审详设" }] })
          : prompt.command({ sessionID: chat.id, command: "spec", arguments: "核对已评审详设" })
        const fiber = yield* start.pipe(Effect.forkScoped)
        const pending = yield* Queue.take(asked).pipe(
          Effect.raceFirst(
            Fiber.join(fiber).pipe(
              Effect.flatMap((result) => Effect.die(new Error("提问前已结束：" + JSON.stringify(result)))),
            ),
          ),
          Effect.timeout("20 seconds"),
        )
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const part = messages
          .flatMap((m) => m.parts)
          .find((part) => part.type === "tool" && part.callID === pending.tool?.callID)
        expect(part?.type).toBe("tool")
        if (part?.type !== "tool") throw new Error("缺少真实 question 工具消息")
        expect(pending.tool).toBeDefined()
        expect(String(part.messageID)).toBe(String(pending.tool?.messageID))
        expect(part.tool).toBe("question")
        expect(part.state.status).toBe("running")
        const input = (yield* llm.inputs)[0]
        expect(input.model).toBe("test-model")
        expect(JSON.stringify(input.messages).includes("<spec-skill>")).toBe(!native)
        expect(JSON.stringify(input.messages)).toContain("核对已评审详设")
        expect(yield* Effect.promise(() => awaitExists(path.join(directory, ".chipmate", "artifacts", "spec")))).toBe(
          false,
        )
        if (interrupted) {
          yield* prompt.cancel(chat.id)
        } else if (action === "关闭") {
          yield* questions.reject(pending.id)
        } else {
          yield* questions.reply({ requestID: pending.id, answers: action === "空答" ? [[]] : [[action]] })
        }
        yield* Fiber.join(fiber).pipe(Effect.exit)
        if (interrupted) {
          expect(yield* llm.calls).toBe(1)
          // 原生取消可能晚于会话终态清理工具等待；实际新消息会撤销旧问题。
          yield* prompt.prompt({ sessionID: chat.id, parts: [{ type: "text", text: "停止 Spec，回答普通 QA" }] })
          expect(yield* llm.calls).toBe(2)
          expect(JSON.stringify((yield* llm.inputs)[1].messages)).toContain("停止 Spec，回答普通 QA")
        }
        yield* pollWithTimeout(
          questions.list().pipe(Effect.map((items) => (items.length === 0 ? true : undefined))),
          "中断后问题未清理",
          "5 seconds",
        )
        const history = yield* sessions.messages({ sessionID: chat.id })
        const final = history.flatMap((m) => m.parts).find((p) => p.id === part.id)
        expect(final?.type === "tool" && final.state.status).not.toBe("running")
        if (!interrupted && action !== "关闭") {
          expect(yield* llm.calls).toBe(2)
          const continuation = JSON.stringify((yield* llm.inputs)[1].messages)
          if (["确认并继续", "需要修改", "暂停"].includes(action)) expect(continuation).toContain(action)
        }
      }),
    specOptions,
    40000,
  )
}

async function awaitExists(file: string) {
  return stat(file).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false
      throw error
    },
  )
}

it.instance(
  "普通 QA 和命令文字引用不加载 Spec，模型和工具目录保持原生配置",
  () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const tools: unknown[] = []
      for (const text of ["你好", "请解释 /spec 命令", "这份 Word 详设是否可以用 RAG 检索？"]) {
        const session = yield* sessions.create({ title: "普通 QA 隔离" })
        yield* llm.text("普通 QA 回答")
        yield* prompt.prompt({ sessionID: session.id, parts: [{ type: "text", text }] })
        const request = (yield* llm.inputs).at(-1)!
        expect(request.model).toBe("test-model")
        expect(JSON.stringify(request.messages)).not.toContain("<spec-skill>")
        expect(JSON.stringify(request.tools)).not.toContain("<spec-skill>")
        tools.push(request.tools)
      }
      expect(tools[0]).toEqual(tools[1])
      expect(tools[0]).toEqual(tools[2])
    }),
  specOptions,
  30000,
)

it.instance(
  "模型仅选择正文阅读也能处理 Word 附件，不自动追加结构检查或图页流程",
  () =>
    Effect.gen(function* () {
      const { specDocument } = yield* Effect.promise(() => import("./spec-document-fixture"))
      const llm = yield* TestLLMServer
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const questions = yield* Question.Service
      const { directory } = yield* TestInstance
      const file = path.join(directory, "已评审详设.docx")
      yield* Effect.promise(async () => Bun.write(file, await specDocument()))
      const session = yield* sessions.create({ title: "Word 读取接入" })
      yield* llm.tool("read", { filePath: file })
      yield* llm.text("读取链路验收结束；未验证实际模型的设计判断。")
      const result = yield* prompt.command({
        sessionID: session.id,
        command: "spec",
        arguments: "理解 @已评审详设.docx 中的请求回收设计",
        // 现有前端 buildFileAttachments 使用 text/plain 表示文件引用；扩展侧另有契约测试。
        parts: [{ type: "file", filename: "已评审详设.docx", mime: "text/plain", url: pathToFileURL(file).href }],
      })
      expect(result.info.role).toBe("assistant")
      if (result.info.role === "assistant" && result.info.error) throw new Error(JSON.stringify(result.info.error))
      const messages = yield* sessions.messages({ sessionID: session.id })
      const reads = messages.flatMap((message) => message.parts).filter((part) => part.type === "tool")
      expect(reads.map((part) => part.tool)).toEqual(["read"])
      expect(reads.every((part) => part.state.status === "completed")).toBe(true)
      const evidence = JSON.stringify(reads)
      expect(evidence).toContain("目录：请求处理 1")
      expect(evidence).toContain("请求回收章节")
      expect(evidence).toContain("请求资源表")
      expect(evidence).toContain("DMA 停止条件")
      expect(yield* questions.list()).toHaveLength(0)
      expect(yield* llm.calls).toBe(2)
    }),
  specOptions,
  30000,
)
