import { afterAll, afterEach, expect, test } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { streamText, wrapLanguageModel, APICallError } from "ai"
import { LLMEvent } from "@opencode-ai/llm"
import * as Log from "@opencode-ai/core/util/log"
import { diagnosticErrors } from "@opencode-ai/core/chipmate/diagnostics/redact"
import { errorCategory } from "@opencode-ai/core/chipmate/diagnostics/errors"
import { RequestTrace, observeFetch, requestErrorMetadata } from "../../src/chipmate/provider/request-diagnostics"
import { ChipMateSessionProcessor } from "../../src/chipmate/session/processor"
import { SessionRetry } from "../../src/session/retry"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Schema } from "effect"

await Log.init({ print: false })

const records: { event: unknown; data: Record<string, unknown> }[] = []
const detach = Log.onDiagnostic((_level, event, data) => {
  if (data.service === "provider.chat") records.push({ event, data })
})
afterAll(detach)
const servers: Bun.Server<unknown>[] = []
afterEach(() => {
  records.length = 0
  for (const server of servers.splice(0)) server.stop(true)
})
const context = {
  sessionID: "会话甲",
  parentSessionID: "父会话",
  rootSessionID: "主会话",
  operationId: "逻辑请求甲",
  providerID: "测试提供商",
  modelID: "测试模型",
  directory: "/workspace/测试目录",
  attempt: 1,
  limit: 3,
}

function serve(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler })
  servers.push(server)
  return `${server.url.origin}/v1`
}

function response(text = "回答正文哨兵") {
  const chunks = [{ delta: { role: "assistant", content: text } }, { delta: {}, finish_reason: "stop" }].map(
    (choice) =>
      `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", choices: [{ index: 0, ...choice }] })}\n\n`,
  )
  return new Response(chunks.join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream", "x-request-id": "gateway-test-123" },
  })
}

test("真实兼容 SDK 共用客户端时，每次请求的异步关联和日志阶段相互隔离", async () => {
  const baseURL = serve(async () => {
    await Bun.sleep(10)
    return response()
  })
  const shared = createOpenAICompatible({
    name: "测试",
    baseURL,
    apiKey: "qa-arbitrary-credential-sentinel",
    fetch: Object.assign(observeFetch(fetch, [{ stage: "连接与首字节", budget: 1000, enabled: true }]), {
      preconnect: fetch.preconnect,
    }),
  }).chatModel("测试模型")
  await Promise.all(
    ["甲", "乙"].map(async (id) => {
      const trace = new RequestTrace({ ...context, sessionID: `会话${id}`, operationId: `逻辑请求${id}` })
      const result = streamText({
        model: wrapLanguageModel({ model: shared, middleware: trace.middleware() }),
        prompt: "请求正文哨兵",
        maxRetries: 0,
        onError: ({ error }) => {
          trace.failure(error)
        },
      })
      expect(await result.text).toBe("回答正文哨兵")
      trace.observe(LLMEvent.finish({ reason: "stop" }))
      trace.close()
    }),
  )
  for (const id of ["甲", "乙"]) {
    const local = records.filter((record) => record.data.sessionID === `会话${id}`)
    expect(new Set(local.map((record) => record.data.requestId)).size).toBe(1)
    expect(new Set(local.map((record) => record.data.operationId))).toEqual(new Set([`逻辑请求${id}`]))
    expect(local.map((record) => record.event)).toEqual(
      expect.arrayContaining([
        "模型请求开始",
        "模型请求收到响应头",
        "模型请求收到首个响应字节",
        "模型事件流开始",
        "模型请求流结束",
      ]),
    )
    expect(local.find((record) => record.event === "模型请求收到响应头")?.data).toMatchObject({
      httpStatus: 200,
      gatewayRequestId: "gateway-test-123",
    })
    expect(local[0]?.data).toMatchObject({
      parentSessionID: "父会话",
      rootSessionID: "主会话",
      diagnostics: [{ stage: "连接与首字节", budget: 1000, enabled: true }],
    })
  }
  expect(
    new Set(records.filter((record) => record.event === "模型请求开始").map((record) => record.data.requestId)).size,
  ).toBe(2)
  for (const secret of [
    "qa-arbitrary-credential-sentinel",
    "回答正文哨兵",
    "请求正文哨兵",
    "/workspace/测试目录",
    "127.0.0.1",
  ])
    expect(JSON.stringify(records)).not.toContain(secret)
})

test("诊断观察不预读响应、不缓冲整段流，取消传递到底层且不改变响应头", async () => {
  let reads = 0
  let cancelled: unknown
  const trace = new RequestTrace(context)
  const source = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads++
          controller.enqueue(new Uint8Array([65]))
        },
        cancel(reason) {
          cancelled = reason
        },
      },
      { highWaterMark: 0 },
    ),
    { headers: { "x-request-id": "gateway-read-test" } },
  )
  const result = await trace.transport(async () => source, "https://test.invalid/v1")
  await Bun.sleep(10)
  expect(reads).toBe(0)
  expect(result.headers.get("x-request-id")).toBe("gateway-read-test")
  const reader = result.body!.getReader()
  expect((await reader.read()).value).toEqual(new Uint8Array([65]))
  expect(reads).toBe(1)
  await reader.cancel("用户停止")
  trace.close()
  expect(cancelled).toBe("用户停止")
  expect(records.at(-1)?.event).toBe("模型请求已取消")
})

test("会话关闭后迟到的响应被取消，不能重新记录成功或向消费方返回数据", async () => {
  const trace = new RequestTrace(context)
  const delayed = Promise.withResolvers<Response>()
  let cancelled = false
  const pending = trace.transport(() => delayed.promise, "https://test.invalid/v1")
  trace.close()
  delayed.resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
    ),
  )
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  trace.observe(LLMEvent.finish({ reason: "stop" }))
  expect(cancelled).toBe(true)
  expect(records.map((record) => record.event)).toEqual(["模型请求开始", "模型请求已取消"])
})

test("SDK 包装之前采集聚合错误，包装之后仍用同一诊断编号且凭据不落盘", async () => {
  const secret = "qa-custom-secret-sentinel"
  const original = new AggregateError(
    [
      Object.assign(new Error(`连接失败 ${secret}`), {
        code: "ECONNREFUSED",
        errno: -61,
        syscall: "connect",
        address: "192.0.2.1",
        port: 443,
      }),
      Object.assign(new Error("第二地址失败"), { code: "ENETUNREACH" }),
    ],
    "网络连接失败",
  )
  const trace = new RequestTrace(context)
  await expect(
    trace.transport(
      async () => {
        throw original
      },
      "https://service.invalid/v1",
      { headers: { authorization: `Bearer ${secret}` } },
    ),
  ).rejects.toBe(original)
  const wrapped = new APICallError({
    message: "Cannot connect to API",
    url: "https://service.invalid/v1",
    requestBodyValues: { prompt: "请求正文哨兵" },
    cause: original,
    isRetryable: true,
  })
  trace.failure(wrapped)
  expect(requestErrorMetadata(wrapped)?.requestId).toBe(requestErrorMetadata(original)?.requestId)
  expect(requestErrorMetadata(wrapped)?.category).toBe("连接失败")
  const text = JSON.stringify(records)
  for (const field of ["ECONNREFUSED", "ENETUNREACH", "connect", '"errno":-61', '"port":443'])
    expect(text).toContain(field)
  for (const privateText of [secret, "192.0.2.1", "请求正文哨兵"]) expect(text).not.toContain(privateText)
  expect(records.filter((record) => record.event === "模型请求失败")).toHaveLength(1)
})

for (const [status, retry] of [
  [400, false],
  [401, false],
  [403, false],
  [408, true],
  [429, true],
  [500, true],
  [503, true],
  [501, false],
  [505, false],
] as const) {
  test(`真实 HTTP ${status} 保留状态，重试决策为 ${retry}`, async () => {
    const baseURL = serve(() =>
      Response.json(
        { error: { message: "Cannot connect to API；响应正文哨兵" } },
        { status, headers: { "x-request-id": `gateway-${status}` } },
      ),
    )
    const trace = new RequestTrace(context)
    const model = createOpenAICompatible({
      name: "测试",
      baseURL,
      fetch: Object.assign(observeFetch(fetch), { preconnect: fetch.preconnect }),
    }).chatModel("测试模型")
    let failure: unknown
    const result = streamText({
      model: wrapLanguageModel({ model, middleware: trace.middleware() }),
      prompt: "问题",
      maxRetries: 0,
      onError: ({ error }) => {
        failure = trace.failure(error)
      },
    })
    await result.consumeStream()
    const parsed = ChipMateSessionProcessor.parseError(failure, {
      providerID: ProviderV2.ID.make("test"),
      aborted: false,
    })
    expect(parsed).toMatchObject({
      name: "APIError",
      data: { statusCode: status, metadata: { gatewayRequestId: `gateway-${status}` } },
    })
    expect(Boolean(SessionRetry.retryable(parsed))).toBe(retry)
    expect(JSON.stringify(records)).not.toContain("响应正文哨兵")
  })
}

test("证书、超时、流内错误和原因未明保持不同类别", () => {
  const timeout = ChipMateSessionProcessor.parseError(new DOMException("超时", "TimeoutError"), {
    providerID: ProviderV2.ID.make("test"),
    aborted: false,
  })
  expect(() => Schema.decodeUnknownSync(SessionV1.APIError.Schema)(timeout)).not.toThrow()
  expect(timeout).toMatchObject({ data: { metadata: { code: "TimeoutError" } } })
  for (const [code, category, retry] of [
    ["CERT_HAS_EXPIRED", "证书错误", false],
    ["ECONNRESET", "连接中断", true],
    ["ETIMEDOUT", "请求超时", true],
  ] as const) {
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error("底层连接异常"), { code }) })
    expect(errorCategory(error)).toBe(category)
    const parsed = ChipMateSessionProcessor.parseError(error, {
      providerID: ProviderV2.ID.make("test"),
      aborted: false,
    })
    expect(Boolean(SessionRetry.retryable(parsed))).toBe(retry)
  }
  expect(errorCategory(new Error("EngineCore encountered an issue"))).toBe("推理服务错误")
  expect(errorCategory(new Error("未知故障"))).toBe("原因未明")
  const unsafe = Object.assign(new Error("完整响应正文哨兵"), { name: "AI_TypeValidationError" })
  expect(JSON.stringify(diagnosticErrors(unsafe))).not.toContain("完整响应正文哨兵")
})

test("HTTP 200 内的 EngineCore 错误保留为流内故障，不能报告为网络断开或请求成功", async () => {
  const baseURL = serve(() => new Response(`data: ${JSON.stringify({ error: { message: "EngineCore encountered an issue. See stack trace (above) for the root cause.", type: "server_error", code: "engine_failure" } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }))
  const trace = new RequestTrace(context)
  const model = createOpenAICompatible({ name: "测试", baseURL, fetch: Object.assign(observeFetch(fetch), { preconnect: fetch.preconnect }) }).chatModel("测试模型")
  let failure: unknown
  const result = streamText({ model: wrapLanguageModel({ model, middleware: trace.middleware() }), prompt: "问题", maxRetries: 0, onError: ({ error }) => { failure = trace.failure(error) } })
  await result.consumeStream()
  const parsed = ChipMateSessionProcessor.parseError(failure, { providerID: ProviderV2.ID.make("test"), aborted: false })
  expect(parsed).toMatchObject({ data: { metadata: { category: "推理服务错误", stage: "响应流" } } })
  expect(records.find((record) => record.event === "模型请求失败")?.data).toMatchObject({ httpStatus: 200, category: "推理服务错误" })
  expect(records.some((record) => record.data.result === "完成")).toBe(false)
})

test("有效 Retry-After 超过 60 秒时停止；无效值不能变成零等待", () => {
  const error = new APICallError({
    message: "限流",
    url: "https://test.invalid",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: { "retry-after": "61" },
    isRetryable: true,
  })
  const parsed = ChipMateSessionProcessor.parseError(error, { providerID: ProviderV2.ID.make("test"), aborted: false })
  expect(SessionRetry.retryable(parsed)).toBeUndefined()
  if (!MessageV2.APIError.isInstance(parsed)) throw new Error("预期返回带 HTTP 状态的 API 错误")
  expect(parsed.data.message).toContain("61 秒")
  expect(
    SessionRetry.delay(1, {
      ...parsed,
      data: { ...parsed.data, responseHeaders: { "retry-after-ms": "3bad" } },
    } as Parameters<typeof SessionRetry.delay>[1]),
  ).toBe(2000)
})

test("真实本地端口拒绝和自签名证书失败保留底层证据，证书失败不能自动恢复", async () => {
  // Bun 在启动时读取代理；使用隔离子进程，防止代理将端口拒绝替换成 HTTP 503。
  const env = { ...process.env }
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"])
    delete env[key]
  const child = Bun.spawn(
    [process.execPath, "run", new URL("./fixtures/transport-failures.ts", import.meta.url).pathname],
    { env, stdout: "pipe", stderr: "pipe" },
  )
  const output = await new Response(child.stdout).text()
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(0)
  const results = JSON.parse(output)
  expect(results.拒绝.诊断).toMatchObject({ category: "连接失败", stage: "连接与响应头" })
  expect(results.拒绝.可重试).toBe(true)
  expect(results.证书.诊断).toMatchObject({ category: "证书错误", stage: "连接与响应头" })
  expect(results.证书.可重试).toBe(false)
  expect(results.证书.错误).toMatchObject({ data: { metadata: { category: "证书错误", retryBlocked: "证书错误" } } })
})
