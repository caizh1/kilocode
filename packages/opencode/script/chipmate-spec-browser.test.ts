// 独立浏览器集成套件，先启动当前扩展的 Storybook；不通过环境变量跳过。
import { expect } from "bun:test"
import { Effect, Queue } from "effect"
import { createChipMateClient } from "@chipmate/sdk/v2/client"
import { EventV2Bridge } from "../src/event-v2-bridge"
import { Question } from "../src/question"
import { Server } from "../src/server/server"
import { TestLLMServer } from "../test/lib/llm-server"
import { testEffectShared } from "../test/lib/effect"
import { TestInstance } from "../test/fixture/fixture"
import { specLayer, specOptions } from "../test/chipmate/spec-fixture"
import { specBrowser } from "../../chipmate-vscode/tests/helpers/spec-browser"
import {
  fetchAndSendPendingQuestions,
  handleQuestionReply,
  type QuestionContext,
} from "../../chipmate-vscode/src/chipmate-provider/handlers/question"

const it = testEffectShared(specLayer)

const scenarios = [
  {
    name: "三次确认",
    titles: ["确认基线 v1", "批准计划 v1", "验收交付 v1"],
    answers: ["确认并继续", "确认并继续", "确认并继续"],
  },
  {
    name: "修改、面板恢复与暂停",
    titles: ["确认基线 v1", "确认基线 v2", "批准计划 v1"],
    answers: ["需要修改", "确认并继续", "暂停"],
  },
]
it.instance(
  "/spec → 原生 Agent → 实际卡片 → 扩展处理器 → HTTP：确认、修改、面板恢复与暂停",
  () =>
    Effect.gen(function* () {
      for (const scenario of scenarios)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const llm = yield* TestLLMServer
            yield* llm.reset
            const events = yield* EventV2Bridge.Service
            const { directory } = yield* TestInstance
            const client = createChipMateClient({
              baseUrl: "http://localhost",
              directory,
              fetch: Object.assign(
                async (request: RequestInfo | URL, init?: RequestInit) =>
                  Server.Default().app.fetch(new Request(request, init)),
                { preconnect: fetch.preconnect },
              ),
            })
            const created = yield* Effect.promise(() =>
              client.session.create({ title: "Spec 浏览器闭环" }, { throwOnError: true }),
            )
            const session = created.data!
            const posts: unknown[] = []
            const directories = new Map<string, string>()
            const context: QuestionContext = {
              client,
              currentSessionId: session.id,
              trackedSessionIds: new Set([session.id]),
              sessionDirectories: new Map([[session.id, directory]]),
              postMessage: (message) => {
                posts.push(message)
              },
              getWorkspaceDirectory: () => directory,
              recordQuestionDirectory: (id, value) => {
                directories.set(id, value)
              },
              getQuestionDirectory: (id) => directories.get(id),
              clearQuestionDirectory: (id) => {
                directories.delete(id)
              },
              getQuestionRevision: () => 0,
              pruneQuestionDirectories: (active) => {
                for (const id of directories.keys()) if (!active.has(id)) directories.delete(id)
              },
            }
            const browser = yield* Effect.promise(() =>
              specBrowser(session, async (id, answers) => {
                expect(await handleQuestionReply(context, id, answers, session.id)).toBe(true)
              }),
            )
            yield* Effect.addFinalizer(() => Effect.promise(() => browser.close()))
            const asked = yield* Queue.unbounded<Question.Request>()
            const off = yield* events.listen((event) => {
              if (event.type === Question.Event.Asked.type) Queue.offerUnsafe(asked, event.data as Question.Request)
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            for (const title of scenario.titles) {
              yield* llm.tool("question", {
                questions: [
                  {
                    header: title,
                    question: `${title}：请确认当前展示的材料。`,
                    options: ["确认并继续", "需要修改", "暂停"].map((label) => ({ label, description: label })),
                  },
                ],
              })
            }
            yield* llm.text("实际回答均已收到；协议夹具结束。")
            const running = yield* Effect.sync(() =>
              client.session.command(
                { sessionID: session.id, command: "spec", arguments: "按详设验收" },
                { throwOnError: true },
              ),
            )
            // 提前挂接拒绝分支，失败时不会形成未处理的 Promise。
            const completed = running.then(
              (result) => ({ result }),
              (error: unknown) => ({ error }),
            )
            const ids: string[] = []
            for (let index = 0; index < 3; index++) {
              const pending = yield* Queue.take(asked).pipe(Effect.timeout("20 seconds"))
              ids.push(pending.id)
              const loaded = yield* Effect.promise(() =>
                client.session.messages({ sessionID: session.id }, { throwOnError: true }),
              )
              const messages = loaded.data!.map((entry) => ({
                ...entry.info,
                createdAt: new Date(entry.info.time.created).toISOString(),
                parts: entry.parts,
              }))
              const card = messages
                .flatMap((message) => message.parts)
                .find(
                  (part) =>
                    part.type === "tool" &&
                    part.callID === pending.tool?.callID &&
                    part.messageID === pending.tool?.messageID,
                )
              expect(card).toBeDefined()
              yield* Effect.promise(async () => {
                await fetchAndSendPendingQuestions(context)
                const notifications = posts.splice(0)
                if (index === 1) await browser.open()
                if (index === 0) {
                  // 反例：保留真实 question 请求，移除关联工具消息，界面必须无法展示卡片。
                  await browser.replay([
                    {
                      type: "messagesLoaded",
                      mode: "reconcile",
                      sessionID: session.id,
                      messages: messages.map((message) => ({
                        ...message,
                        parts: message.parts.filter((part) => part.id !== card!.id),
                      })),
                    },
                    ...notifications,
                  ])
                  await browser.missing()
                }
                await browser.replay([
                  ...(index ? [{ type: "questionResolved", requestID: ids[index - 1] }] : []),
                  { type: "messagesLoaded", mode: "reconcile", sessionID: session.id, messages },
                  ...notifications,
                ])
                await browser.choose(scenario.answers[index])
              })
            }
            const terminal = yield* Effect.promise(() => completed)
            if ("error" in terminal) throw terminal.error
            expect(browser.submitted).toEqual(ids)
            expect(new Set(ids).size).toBe(3)
            expect(yield* llm.calls).toBe(4)
            const pending = yield* Effect.promise(() => client.question.list({ directory }, { throwOnError: true }))
            expect(pending.data).toHaveLength(0)
            yield* Effect.promise(async () => {
              await browser.replay([{ type: "questionResolved", requestID: ids[2] }])
              await browser.finished()
            })
          }),
        )
    }),
  specOptions,
  90000,
)
