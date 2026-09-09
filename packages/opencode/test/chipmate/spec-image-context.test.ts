import { expect } from "bun:test"
import path from "node:path"
import { PhotonImage } from "@silvia-odwyer/photon-node"
import { Effect } from "effect"
import { SessionPrompt } from "../../src/session/prompt"
import { Session } from "../../src/session/session"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { specImageLayer, specOptions } from "./spec-fixture"

// 脚本只验证模型选择不同执行方式时的原生接入，不证明图片理解或模型决策质量。
const it = testEffect(specImageLayer)
const options = {
  ...specOptions,
  init: (directory: string) =>
    Effect.gen(function* () {
      yield* specOptions.init(directory)
      yield* Effect.promise(async () => {
        const file = path.join(directory, "opencode.json")
        const config = await Bun.file(file).json()
        config.provider.test.models["test-model"].modalities = { input: ["text", "image"], output: ["text"] }
        await Bun.write(file, JSON.stringify(config))
      })
    }),
}

function images(input: unknown): string[] {
  if (typeof input === "string") return input.startsWith("data:image/") ? [input] : []
  if (!input || typeof input !== "object") return []
  return Object.values(input).flatMap(images)
}

for (const delegated of [false, true])
  it.instance(
    `/spec 支持模型选择${delegated ? "委派子任务" : "主会话直接阅读"}，没有固定图页批次要求`,
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const { directory } = yield* TestInstance
        const chat = yield* sessions.create({ title: "自主图页阅读接入验收" })
        const expected: string[] = []
        const files: string[] = []
        // 三张已存在的本地图片用于验证原先的两页约定不再是 Spec 接入前提。
        for (let page = 1; page <= 3; page++) {
          const picture = new PhotonImage(new Uint8Array([page, 20, 30, 255]), 1, 1)
          const bytes = picture.get_bytes()
          picture.free()
          const file = path.join(directory, `已有页面-${page}.png`)
          yield* Effect.promise(() => Bun.write(file, bytes))
          expected.push(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`)
          files.push(file)
        }
        if (delegated)
          yield* llm.tool("task", {
            description: "核对已有页面",
            subagent_type: "general",
            prompt: `查看这些已存在的本地页面：${files.join("、")}。这里只验证图片传递。`,
          })
        for (const file of files) yield* llm.tool("read", { filePath: file })
        yield* llm.text("页面工具结果已收到；脚本不作设计结论。")
        if (delegated) yield* llm.text("子任务已返回；脚本接入验收结束。")
        yield* prompt.command({ sessionID: chat.id, command: "spec", arguments: "核对已经提供的页面资料" })
        expect(yield* llm.pending).toBe(0)
        const children = yield* sessions.children(chat.id)
        expect(children).toHaveLength(delegated ? 1 : 0)
        const reader = delegated ? children[0]!.id : chat.id
        const messages = yield* sessions.messages({ sessionID: reader })
        const reads = messages.flatMap((message) => message.parts).filter((part) => part.type === "tool")
        expect(reads.map((part) => part.tool)).toEqual(["read", "read", "read"])
        expect(reads.every((part) => part.state.status === "completed")).toBe(true)
        const requests = yield* llm.inputs
        const request = requests.find((item) => new Set(images(item.messages)).size === expected.length)
        expect(request).toBeDefined()
        expect(new Set(images(request?.messages))).toEqual(new Set(expected))
        const first = JSON.stringify(requests[0]!.messages)
        expect(first).toContain("<spec-skill>")
        expect(first).not.toContain("references/图页阅读.md")
        // 移除真实请求媒体后，图片传递断言应失败；不补造缺失工具消息。
        const missing = JSON.parse(JSON.stringify(request!.messages), (_key, value) =>
          typeof value === "string" && value.startsWith("data:image/") ? undefined : value,
        )
        expect(() => expect(new Set(images(missing))).toEqual(new Set(expected))).toThrow()
      }),
    options,
    40000,
  )
