import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fetchOpenAIModels } from "../../src/shared/fetch-models"
import { modelFetchErrors, type ModelFetchDiagnostic } from "../../src/shared/fetch-models-diagnostics"
import { DiagnosticStore, snapshot } from "@opencode-ai/core/chipmate/diagnostics/store"
import { buildBundle, verifyBundle } from "../../src/services/diagnostics/bundle"

const original = globalThis.fetch
const servers: Bun.Server<unknown>[] = []
afterEach(() => {
  globalThis.fetch = original
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return `http://127.0.0.1:${server.port}/v1`
}

for (const code of [
  "UND_ERR_CONNECT_TIMEOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ECONNRESET",
]) {
  test(`保留网络错误 ${code} 的非枚举字段和原始异常`, async () => {
    const cause = Object.assign(new Error("连接失败"), {
      code,
      errno: -1,
      syscall: "connect",
      hostname: "private.example.test",
      address: "192.0.2.10",
      port: 443,
    })
    const failure = new TypeError("fetch failed", { cause })
    Object.defineProperty(cause, "code", { value: code, enumerable: false })
    globalThis.fetch = (async () => {
      throw failure
    }) as typeof fetch
    const events: ModelFetchDiagnostic[] = []
    await expect(
      fetchOpenAIModels({ baseURL: "https://private.example.test/v1", diagnostic: (event) => events.push(event) }),
    ).rejects.toBe(failure)
    expect(events.map((event) => event.phase)).toEqual(["开始", "失败"])
    const end = events.at(-1)!
    expect(end.budget).toBe(15000)
    expect(end.elapsed).toBeGreaterThanOrEqual(0)
    expect(end.stage).toBe("连接与响应头")
    const text = JSON.stringify(end)
    expect(text).toContain(code)
    expect(text).toContain('"syscall":"connect"')
    expect(text).toContain('"port":443')
    expect(text).not.toContain("private.example.test")
    expect(text).not.toContain("192.0.2.10")
  })
}

test("聚合异常、循环引用、超深异常和任意格式凭据均有界且脱敏", () => {
  const secret = "不带固定前缀的真实格式凭据"
  const left = Object.assign(new Error(`握手失败 ${secret}`), { code: "ETIMEDOUT", syscall: "connect" })
  const right = Object.assign(new Error("另一地址连接失败"), { code: "ECONNREFUSED" })
  const failure = new AggregateError([left, right], "多个地址连接失败")
  left.cause = failure
  const text = JSON.stringify(modelFetchErrors(new TypeError("fetch failed", { cause: failure }), [secret]))
  expect(text).toContain("ETIMEDOUT")
  expect(text).toContain("ECONNREFUSED")
  expect(text).toContain("循环或重复异常引用")
  expect(text).not.toContain(secret)
  let deep = new Error("末尾")
  for (let index = 0; index < 30; index++) deep = new Error("嵌套", { cause: deep })
  expect(JSON.stringify(modelFetchErrors(deep))).toContain("已截断")
})

for (const status of [401, 403, 429, 500, 503]) {
  test(`HTTP ${status} 日志记录状态且排除响应正文`, async () => {
    const baseURL = serve(() => new Response("服务端私人响应正文", { status }))
    const events: ModelFetchDiagnostic[] = []
    await expect(fetchOpenAIModels({ baseURL, diagnostic: (event) => events.push(event) })).rejects.toThrow(
      `HTTP ${status}`,
    )
    expect(events.map((event) => event.phase)).toEqual(["开始", "收到响应", "失败"])
    expect(events.at(-1)?.httpStatus).toBe(status)
    expect(JSON.stringify(events)).not.toContain("服务端私人响应正文")
  })
}

test("正文解析失败不把解析器引用的响应片段带入日志", async () => {
  const baseURL = serve(() => new Response("服务端私人响应正文"))
  const events: ModelFetchDiagnostic[] = []
  await expect(fetchOpenAIModels({ baseURL, diagnostic: (event) => events.push(event) })).rejects.toThrow()
  expect(events.at(-1)?.stage).toBe("响应正文")
  expect(JSON.stringify(events)).toContain("模型列表响应不是有效 JSON")
  expect(JSON.stringify(events)).not.toContain("服务端私人响应正文")
})

test("主动超时记录失败而不增加尝试次数，诊断回调失败不影响成功请求", async () => {
  let count = 0
  const baseURL = serve(async () => {
    count++
    await Bun.sleep(60)
    return Response.json({ data: [{ id: "模型甲" }] })
  })
  const events: ModelFetchDiagnostic[] = []
  await expect(fetchOpenAIModels({ baseURL, timeout: 10, diagnostic: (event) => events.push(event) })).rejects.toThrow()
  expect(count).toBe(1)
  expect(events.at(-1)?.phase).toBe("失败")
  expect(events.at(-1)?.budget).toBe(10)
  await expect(
    fetchOpenAIModels({
      baseURL,
      diagnostic: () => {
        throw new Error("日志写入失败")
      },
    }),
  ).resolves.toEqual([{ id: "模型甲", name: "模型甲" }])
})

test("异常中的恶意访问器不能覆盖原请求失败", async () => {
  const errors = new Proxy([], { get() { throw new Error("诊断读取异常") } })
  const failure = Object.assign(new TypeError("原始请求失败"), { errors })
  globalThis.fetch = (async () => { throw failure }) as typeof fetch
  const events: ModelFetchDiagnostic[] = []
  await expect(fetchOpenAIModels({ baseURL: "https://provider.example.test/v1", diagnostic: (event) => events.push(event) })).rejects.toBe(failure)
  expect(events.at(-1)?.phase).toBe("失败")
})

test("失败经过真实诊断存储和归档后仍包含请求编号、耗时与全部底层错误码", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-models-diagnostics-"))
  try {
    const store = new DiagnosticStore({
      root: join(root, "records"),
      source: "provider.models",
      workspace: "/workspace/测试",
      salt: "测试档案",
    })
    const cause = new AggregateError(
      [
        Object.assign(new Error("IPv4 连接失败"), {
          code: "ETIMEDOUT",
          syscall: "connect",
          address: "192.0.2.1",
          port: 443,
        }),
        Object.assign(new Error("IPv6 连接失败"), {
          code: "ENETUNREACH",
          syscall: "connect",
          address: "2001:db8::1",
          port: 443,
        }),
      ],
      "多个地址不可达",
    )
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed", { cause })
    }) as typeof fetch
    await expect(
      fetchOpenAIModels({
        baseURL: "https://service.example.test/v1",
        apiKey: "不可记录的凭据",
        salt: "测试档案",
        diagnostic: (event) =>
          store.append(
            `提供商模型列表${event.phase}`,
            { requestId: "请求甲", ...event },
            event.phase === "失败" ? "ERROR" : "INFO",
          ),
      }),
    ).rejects.toThrow("fetch failed")
    await store.flush()
    const captured = await snapshot(
      store.context.root,
      store.workspaceId,
      0,
      Date.now() + 1000,
      new AbortController().signal,
    )
    const bundle = await buildBundle(
      {
        root: join(root, "bundles"),
        salt: "测试档案",
        version: "测试版本",
        platform: "linux-x64",
        from: new Date(0).toISOString(),
        to: new Date().toISOString(),
        description: "模型列表失败",
        environment: {},
        records: captured.records,
        sources: [],
      },
      new AbortController().signal,
    )
    await verifyBundle(bundle)
    const result = Bun.spawnSync(["unzip", "-p", bundle.path, "日志/provider.models.jsonl"])
    expect(result.exitCode).toBe(0)
    const text = result.stdout.toString()
    for (const value of ["请求甲", "ETIMEDOUT", "ENETUNREACH", '"budget":15000', '"elapsed":'])
      expect(text).toContain(value)
    for (const value of ["不可记录的凭据", "192.0.2.1", "2001:db8::1"]) expect(text).not.toContain(value)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
