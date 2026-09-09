import { describe, expect, test } from "bun:test"
import { NewAPIBilling } from "@/chipmate/session/new-api-billing"

const completedAt = 1_800_000
const startedAt = 1_700_000

function response(value: unknown, status = 200, headers?: HeadersInit) {
  const resultHeaders = new Headers(headers)
  resultHeaders.set("content-type", "application/json")
  return new Response(JSON.stringify(value), {
    status,
    headers: resultHeaders,
  })
}

function href(value: string | URL | Request) {
  if (typeof value === "string") return value
  return value instanceof URL ? value.href : value.url
}

function input(requestID = "req-1") {
  return {
    target: { origin: "https://new-api.example", apiKey: "sk-sensitive" },
    requestID,
    modelNames: ["model-a"],
    startedAt,
    completedAt,
  }
}

function log(requestID: string, quota = 25, group = "vip") {
  return {
    request_id: requestID,
    model_name: "model-a",
    quota,
    group,
    created_at: 1_750,
  }
}

describe("New API 人民币计费", () => {
  test("只允许 HTTPS 同源地址与回环开发地址", () => {
    expect(NewAPIBilling.target({ baseURL: "https://api.example/v1", apiKey: "key" })).toEqual({
      origin: "https://api.example",
      apiKey: "key",
    })
    expect(NewAPIBilling.target({ baseURL: "http://127.0.0.1:3000/v1", apiKey: "key" })).toEqual({
      origin: "http://127.0.0.1:3000",
      apiKey: "key",
    })
    expect(NewAPIBilling.target({ baseURL: "http://api.example/v1", apiKey: "key" })).toBe("unsupported-url")
    expect(NewAPIBilling.target({ baseURL: "https://api.example/v1", apiKey: "" })).toBe("credentials")
  })

  test("按请求 ID 精确匹配并使用只读认证计算人民币", async () => {
    const calls: Array<{ url: string; authorization: string | null; redirect: RequestRedirect | undefined }> = []
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      const urlValue = href(url)
      calls.push({
        url: urlValue,
        authorization: new Headers(init?.headers).get("authorization"),
        redirect: init?.redirect,
      })
      if (urlValue.endsWith("/api/status"))
        return response({ data: { quota_per_unit: 500_000, usd_exchange_rate: 7.2 } })
      return response({ data: [log("other", 999), log("req-1", 25, "actual-group")] })
    }
    const result = await NewAPIBilling.settle(input(), { fetch: fetcher, delays: [0], now: () => 2_000_000 })
    expect(result).toEqual({
      status: "settled",
      source: "new-api-log",
      requestID: "req-1",
      currency: "CNY",
      amount: 0.00036,
      quota: 25,
      quotaPerUnit: 500_000,
      exchangeRate: 7.2,
      group: "actual-group",
      modelName: "model-a",
      settledAt: 2_000_000,
    })
    expect(calls.map((call) => call.url)).toEqual([
      "https://new-api.example/api/status",
      "https://new-api.example/api/log/token",
    ])
    expect(calls.every((call) => call.authorization === "Bearer sk-sensitive")).toBe(true)
    expect(calls.every((call) => call.redirect === "manual")).toBe(true)
  })

  test("日志延迟时按计划重试且不使用其他请求", async () => {
    let attempts = 0
    const waits: number[] = []
    const fetcher = async (url: string | URL | Request) => {
      if (href(url).endsWith("/api/status"))
        return response({ data: { quota_per_unit: 500_000, usd_exchange_rate: 7 } })
      attempts += 1
      if (attempts === 1) throw new DOMException("请求超时", "TimeoutError")
      return response({ data: attempts < 3 ? [log("other")] : [log("req-1")] })
    }
    const result = await NewAPIBilling.settle(input(), {
      fetch: fetcher,
      delays: [0, 250, 1_000],
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
      },
    })
    expect(result.status).toBe("settled")
    expect(attempts).toBe(3)
    expect(waits).toEqual([250, 1_000])
  })

  test("拒绝跨域重定向、模型不匹配和负 quota", async () => {
    const status = () => response({ data: { quota_per_unit: 500_000, usd_exchange_rate: 7 } })
    const redirected = await NewAPIBilling.settle(input(), {
      delays: [0],
      fetch: async (url) =>
        href(url).endsWith("/api/status")
          ? status()
          : response({}, 302, { location: "https://other.example/api/log/token" }),
    })
    expect(redirected).toMatchObject({ status: "unavailable", reason: "invalid-response" })

    const mismatched = await NewAPIBilling.settle(input(), {
      delays: [0],
      fetch: async (url) =>
        href(url).endsWith("/api/status")
          ? status()
          : response({ data: [{ ...log("req-1"), model_name: "model-b" }] }),
    })
    expect(mismatched).toMatchObject({ status: "unavailable", reason: "model-mismatch" })

    const negative = await NewAPIBilling.settle(input(), {
      delays: [0],
      fetch: async (url) =>
        href(url).endsWith("/api/status") ? status() : response({ data: [log("req-1", -1)] }),
    })
    expect(negative).toMatchObject({ status: "unavailable", reason: "invalid-response" })
  })

  test("每次结算冻结当次汇率", async () => {
    let statusCalls = 0
    const fetcher = async (url: string | URL | Request) => {
      if (href(url).endsWith("/api/status")) {
        statusCalls += 1
        return response({ data: { quota_per_unit: 100, usd_exchange_rate: statusCalls === 1 ? 7 : 8 } })
      }
      return response({ data: [log("req-1", 10, "group-a"), log("req-2", 20, "group-b")] })
    }
    const first = await NewAPIBilling.settle(input("req-1"), { fetch: fetcher, delays: [0] })
    const second = await NewAPIBilling.settle(input("req-2"), { fetch: fetcher, delays: [0] })
    expect(first).toMatchObject({ status: "settled", group: "group-a", exchangeRate: 7 })
    expect(second).toMatchObject({ status: "settled", group: "group-b", exchangeRate: 8 })
    if (first.status !== "settled" || second.status !== "settled") throw new Error("预期两笔账单均已结算")
    expect(first.amount).toBeCloseTo(0.7)
    expect(second.amount).toBeCloseTo(1.6)
    expect(JSON.stringify([first, second])).not.toContain("sk-sensitive")
  })

  test("并发对账按请求 ID 隔离", async () => {
    const fetcher = async (url: string | URL | Request) => {
      if (href(url).endsWith("/api/status"))
        return response({ data: { quota_per_unit: 100, usd_exchange_rate: 7 } })
      return response({ data: [log("req-concurrent-1", 10, "group-1"), log("req-concurrent-2", 20, "group-2")] })
    }
    const [first, second] = await Promise.all([
      NewAPIBilling.settle(input("req-concurrent-1"), { fetch: fetcher, delays: [0] }),
      NewAPIBilling.settle(input("req-concurrent-2"), { fetch: fetcher, delays: [0] }),
    ])
    expect(first).toMatchObject({ status: "settled", requestID: "req-concurrent-1", group: "group-1" })
    expect(second).toMatchObject({ status: "settled", requestID: "req-concurrent-2", group: "group-2" })
  })

  test("重复入队同一请求时复用对账任务", async () => {
    let logCalls = 0
    const dependencies = {
      delays: [0],
      fetch: async (url: string | URL | Request) => {
        if (href(url).endsWith("/api/status"))
          return response({ data: { quota_per_unit: 100, usd_exchange_rate: 7 } })
        logCalls += 1
        return response({ data: [log("req-dedup", 10)] })
      },
    }
    const request = input("req-dedup")
    const [first, second] = await Promise.all([
      NewAPIBilling.settleOnce(request, dependencies),
      NewAPIBilling.settleOnce(request, dependencies),
    ])
    expect(first).toEqual(second)
    expect(logCalls).toBe(1)
  })
})
