// 需要本地真实 Server（6031）及源码 Storybook（6007）；脚本模型只验证协议。
import { expect } from "bun:test"
import path from "node:path"
import { Effect, Fiber, Queue } from "effect"
import { SessionPrompt } from "../src/session/prompt"
import { Session } from "../src/session/session"
import { Permission } from "../src/permission"
import { EventV2Bridge } from "../src/event-v2-bridge"
import { ProductProfile } from "../src/chipmate/product-profile"
import { createChipMateClient } from "@chipmate/sdk/v2/client"
import { Server } from "../src/server/server"
import {
  fetchAndSendPendingPermissions,
  handlePermissionResponse,
  type PermissionContext,
} from "../../chipmate-vscode/src/chipmate-provider/handlers/permission-handler"
import { TestLLMServer } from "../test/lib/llm-server"
import { testEffectShared } from "../test/lib/effect"
import { TestInstance } from "../test/fixture/fixture"
import { specImageLayer, specOptions } from "../test/chipmate/spec-fixture"
import { specBrowser } from "../../chipmate-vscode/tests/helpers/spec-browser"
const it = testEffectShared(specImageLayer)
it.instance(
  "/spec 真实转换、页面链接、原生读图子会话及证据写入授权回传",
  () =>
    Effect.gen(function* () {
      const previous = process.env.CHIPMATE_WORD_TO_IMAGES_ENDPOINT
      process.env.CHIPMATE_WORD_TO_IMAGES_ENDPOINT = "http://127.0.0.1:6031/convert/word-to-images"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.CHIPMATE_WORD_TO_IMAGES_ENDPOINT
          else process.env.CHIPMATE_WORD_TO_IMAGES_ENDPOINT = previous
        }),
      )
      const llm = yield* TestLLMServer
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const permissions = yield* Permission.Service
      const events = yield* EventV2Bridge.Service
      const asked = yield* Queue.unbounded<Permission.Request>()
      const off = yield* events.listen((event) => {
        if (event.type === Permission.Event.Asked.type) Queue.offerUnsafe(asked, event.data as Permission.Request)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => off)
      const { directory } = yield* TestInstance
      const session = yield* sessions.create({ title: "Word 图页接入验收" })
      const client = createChipMateClient({
        baseUrl: "http://localhost",
        directory,
        fetch: Object.assign(
          async (request: RequestInfo | URL, init?: RequestInit) =>
            Server.Default().app.fetch(new Request(request, init)),
          { preconnect: fetch.preconnect },
        ),
      })
      const posts: unknown[] = []
      const directories = new Map<string, string>()
      const context: PermissionContext = {
        client,
        currentSessionId: session.id,
        trackedSessionIds: new Set([session.id]),
        sessionDirectories: new Map([[session.id, directory]]),
        postMessage: (message) => {
          posts.push(message)
        },
        getWorkspaceDirectory: () => directory,
        recordPermissionDirectory: (id, value) => {
          directories.set(id, value)
        },
        getPermissionDirectory: (id) => directories.get(id),
        clearPermissionDirectory: (id) => {
          directories.delete(id)
        },
        prunePermissionDirectories: (active) => {
          for (const id of directories.keys()) if (!active.has(id)) directories.delete(id)
        },
      }
      const opened: string[] = []
      const replied: string[] = []
      const browser = yield* Effect.promise(() =>
        specBrowser(
          session,
          async () => {},
          async (file) => {
            expect(await Bun.file(path.join(directory, file)).exists()).toBe(true)
            opened.push(file)
          },
          async (id, response, childID) => {
            await handlePermissionResponse(context, id, childID, response, [], [])
            replied.push(id)
          },
        ),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => browser.close()))
      yield* llm.tool("word_to_images", { sourcePath: "设计.docx", startPage: 2, maxPages: 1 })
      yield* llm.text("转换完成，请逐页阅读。")
      yield* prompt.command({ sessionID: session.id, command: "spec", arguments: "查看设计.docx 第 2 页图表" })
      const history = yield* sessions.messages({ sessionID: session.id })
      const messages = history.map((m) => ({
        ...m.info,
        createdAt: new Date(m.info.time.created).toISOString(),
        parts: m.parts,
      }))
      const part = messages.flatMap((m) => m.parts).find((p) => p.type === "tool" && p.tool === "word_to_images")
      if (!part || part.type !== "tool" || part.state.status !== "completed")
        throw new Error("工具未完成：" + JSON.stringify(part))
      const output = JSON.parse(part.state.output)
      expect(output.pageNumbers).toEqual([2])
      expect(part.state.output).not.toContain("base64")
      const file = output.pagePngPaths[0]
      yield* Effect.promise(async () => {
        await browser.replay([
          {
            type: "messagesLoaded",
            sessionID: session.id,
            messages: messages.map((m) => ({ ...m, parts: m.parts.filter((p) => p.id !== part.id) })),
          },
        ])
        await browser.missingImages()
        await browser.replay([{ type: "messagesLoaded", mode: "reconcile", sessionID: session.id, messages }])
        await browser.openPage(2)
        for (let i = 0; i < 100 && !opened.length; i++) await new Promise((r) => setTimeout(r, 10))
        expect(opened).toEqual([file])
      })
      const record = ProductProfile.project(directory, "artifacts", "spec", "图页接入验收", "图页证据", "第二页.md")
      yield* llm.tool("task", {
        description: "第二页读图证据",
        subagent_type: "general",
        prompt: `读图协议子任务：补读 ${path.join(directory, "设计.docx")} 第 1 至 30 行，再读 ${path.join(directory, file)}，将协议验证结果写入 ${record}。不推断实际设计结论。`,
      })
      yield* llm.tool("read", { filePath: path.join(directory, "设计.docx"), offset: 1, limit: 30 })
      yield* llm.tool("read", { filePath: path.join(directory, file) })
      yield* llm.tool("write", {
        filePath: record,
        content: "# 第二页\n真实图片已读取；这是接入记录，设计理解尚未验证。",
      })
      yield* llm.text(`图页记录路径：${record}。`)
      yield* llm.tool("read", { filePath: record })
      yield* llm.text("主会话已回读文字记录，三次确认均尚未批准。")
      const running = yield* prompt
        .command({ sessionID: session.id, command: "spec", arguments: "继续核对第二页，使用独立读图子任务" })
        .pipe(Effect.forkScoped)
      const pending = yield* Queue.take(asked).pipe(
        Effect.raceFirst(
          Fiber.join(running).pipe(Effect.flatMap(() => Effect.die(new Error("预期写入权限出现前流程结束")))),
        ),
        Effect.timeout("30 seconds"),
      )
      expect(pending.permission).toBe("edit")
      const waiting = yield* sessions.messages({ sessionID: session.id })
      const realMessages = waiting.map((message) => ({
        ...message.info,
        createdAt: new Date(message.info.time.created).toISOString(),
        parts: message.parts,
      }))
      const task = realMessages
        .flatMap((message) => message.parts)
        .find((part) => part.type === "tool" && part.tool === "task")
      if (!task || task.type !== "tool" || task.state.status !== "running")
        throw new Error("缺少实际运行中的 task 消息")
      expect(task.state.metadata?.sessionId).toBe(pending.sessionID)
      context.trackedSessionIds.add(pending.sessionID)
      yield* Effect.promise(async () => {
        await fetchAndSendPendingPermissions(context)
        const notifications = posts.splice(0)
        expect(notifications).toHaveLength(1)
        // 移除真实 task 关联后子会话权限不可见；恢复实际消息后才可实际点击，不能补造任务记录。
        await browser.replay([
          {
            type: "messagesLoaded",
            sessionID: session.id,
            messages: realMessages.map((message) => ({
              ...message,
              parts: message.parts.filter((part) => part.id !== task.id),
            })),
          },
          ...notifications,
        ])
        await browser.missingPermission()
        await browser.replay([
          { type: "messagesLoaded", mode: "reconcile", sessionID: session.id, messages: realMessages },
        ])
        await browser.allowPermission()
      })
      yield* Fiber.join(running)
      expect(replied).toEqual([pending.id])
      expect(yield* permissions.list()).toHaveLength(0)
      yield* Effect.promise(() => browser.replay([{ type: "permissionResolved", permissionID: pending.id }]))
      const inputs = yield* llm.inputs
      const child = inputs.filter((input) =>
        (input.messages as Array<{ role: string; content: unknown }>).some(
          (message) => message.role === "user" && JSON.stringify(message.content).includes("读图协议子任务："),
        ),
      )
      expect(child.length).toBeGreaterThan(0)
      expect(JSON.stringify(child)).toContain("data:image/png;base64,")
      expect(JSON.stringify(inputs.filter((input) => !child.includes(input)))).not.toContain("data:image/png;base64,")
      expect(JSON.stringify(inputs.at(-1)?.messages)).toContain("设计理解尚未验证")
      expect(yield* Effect.promise(() => Bun.file(record).text())).toContain("真实图片已读取")
    }),
  {
    ...specOptions,
    init: (directory) =>
      Effect.gen(function* () {
        yield* specOptions.init(directory)
        yield* Effect.promise(async () => {
          const config = path.join(directory, "opencode.json")
          const data = await Bun.file(config).json()
          data.provider.test.models["test-model"].modalities = { input: ["text", "image"], output: ["text"] }
          await Bun.write(config, JSON.stringify(data))
          await Bun.write(
            path.join(directory, "设计.docx"),
            Bun.file(path.resolve("../../ufs-query-module-interface.docx")),
          )
        })
      }),
  },
  120000,
)
