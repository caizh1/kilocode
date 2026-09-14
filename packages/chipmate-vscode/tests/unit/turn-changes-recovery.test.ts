import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createChipMateClient } from "@chipmate/sdk/v2/client"
import { handleTurnChanges, resolveTurnChangesDirectory } from "../../src/chipmate-provider/turn-changes"
import { createTurnRecord } from "../../webview-ui/src/context/turn-changes-record"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

test("只读审阅按请求会话读取，不受活动会话或元数据加载影响", async () => {
  const urls: string[] = []
  const replies: unknown[] = []
  const client = createChipMateClient({
    baseUrl: "http://127.0.0.1:1234",
    fetch: async (request) => {
      urls.push((request as Request).url)
      return Response.json({ ok: true })
    },
  })
  for (const current of [undefined, "会话乙"])
    await handleTurnChanges(
      { type: "turnChangesRequest", sessionID: "会话甲", messageID: "第一轮", requestID: "读取", fileID: "文件" },
      {
        client,
        directory: "/甲工作树",
        current: () => current,
        authorize: () => false,
        post: (reply) => replies.push(reply),
      },
    )
  expect(urls).toHaveLength(2)
  expect(urls.every((url) => new URL(url).searchParams.get("directory") === "/甲工作树")).toBe(true)
  expect(replies).toEqual([
    expect.objectContaining({ sessionID: "会话甲", result: { ok: true } }),
    expect.objectContaining({ sessionID: "会话甲", result: { ok: true } }),
  ])
})

test("短暂读取失败后成功刷新自动清除错误，无需手动重新打开", () => {
  const sent: WebviewMessage[] = []
  const listeners = new Set<(message: ExtensionMessage) => void>()
  let dispose = () => {}
  const record = createRoot((cleanup) => {
    dispose = cleanup
    return createTurnRecord(
      {
        postMessage: (message) => sent.push(message),
        onMessage: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      },
      "会话甲",
      "第一轮",
    )
  })
  const reply = (result: { ok: boolean; message?: string }) => {
    const request = sent.at(-1) as { requestID: string }
    for (const listener of listeners)
      listener({
        type: "turnChangesResult",
        sessionID: "会话甲",
        messageID: "第一轮",
        requestID: request.requestID,
        result,
      })
  }
  try {
    reply({ ok: false, message: "会话已切换，请重新打开本轮修改" })
    expect(record.error()).toBeDefined()
    record.load()
    reply({ ok: true })
    expect(record.error()).toBeUndefined()
  } finally {
    dispose()
  }
})

test("异步预检期间操作权变化，即使会话未变也不能写入", async () => {
  let authorized = true
  const gate = Promise.withResolvers<void>()
  const methods: string[] = []
  const replies: unknown[] = []
  const client = createChipMateClient({
    baseUrl: "http://127.0.0.1:1234",
    fetch: async (request) => {
      methods.push((request as Request).method)
      await gate.promise
      return Response.json({
        ok: true,
        summary: {
          directory: "/工作区",
          sessionID: "会话甲",
          messageID: "第一轮",
          revision: 1,
          phase: "ready",
          outcome: "completed",
          files: [],
          canRevert: true,
          canRestore: false,
        },
      })
    },
  })
  const task = handleTurnChanges(
    {
      type: "turnChangesMutate",
      sessionID: "会话甲",
      messageID: "第一轮",
      requestID: "操作",
      revision: 1,
      action: "revert",
    },
    {
      client,
      directory: "/工作区",
      current: () => "会话甲",
      authorize: () => authorized,
      post: (reply) => replies.push(reply),
    },
  )
  authorized = false
  gate.resolve()
  await task
  expect(methods).toEqual(["GET"])
  expect(replies).toEqual([
    expect.objectContaining({ result: { ok: false, message: "会话或操作权已切换，操作未执行" } }),
  ])
})

test("等待权威会话目录后读取差异，并合并并发元数据查询", async () => {
  const gate = Promise.withResolvers<void>()
  const urls: URL[] = []
  const replies: unknown[] = []
  const client = createChipMateClient({
    baseUrl: "http://127.0.0.1:1234",
    fetch: async (request) => {
      const url = new URL((request as Request).url)
      urls.push(url)
      if (!url.pathname.includes("turn-changes")) {
        await gate.promise
        return Response.json({ id: "会话甲", directory: "/真实工作树" })
      }
      return Response.json({ ok: true })
    },
  })
  const directory = () => resolveTurnChangesDirectory(client, "会话甲", "/查询入口")
  const operations = ["第一轮", "第二轮"].map((messageID) =>
    handleTurnChanges(
      { type: "turnChangesRequest", sessionID: "会话甲", messageID, requestID: messageID },
      {
        client,
        directory,
        current: () => undefined,
        authorize: () => false,
        post: (reply) => replies.push(reply),
      },
    ),
  )
  await Promise.resolve()
  expect(urls.filter((url) => url.pathname.includes("turn-changes"))).toHaveLength(0)
  gate.resolve()
  await Promise.all(operations)
  expect(urls.filter((url) => !url.pathname.includes("turn-changes"))).toHaveLength(1)
  expect(
    urls.filter((url) => url.pathname.includes("turn-changes")).map((url) => url.searchParams.get("directory")),
  ).toEqual(["/真实工作树", "/真实工作树"])
  expect(replies).toHaveLength(2)
})

test("无法确定所属目录时不发差异读取，也不回退到活动工作树", async () => {
  const urls: string[] = []
  const replies: unknown[] = []
  const client = createChipMateClient({
    baseUrl: "http://127.0.0.1:1234",
    fetch: async (request) => {
      urls.push((request as Request).url)
      return Response.json({ id: "其他会话", directory: "/其他工作树" })
    },
  })
  await handleTurnChanges(
    { type: "turnChangesRequest", sessionID: "会话甲", messageID: "第一轮", requestID: "读取" },
    {
      client,
      directory: () => resolveTurnChangesDirectory(client, "会话甲", "/查询入口"),
      current: () => "会话甲",
      authorize: () => true,
      post: (reply) => replies.push(reply),
    },
  )
  expect(urls).toHaveLength(1)
  expect(replies).toEqual([
    expect.objectContaining({ result: { ok: false, message: "无法确定修改记录所属的工作目录" } }),
  ])
})
