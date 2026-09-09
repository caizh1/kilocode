import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { isRecord } from "@/util/record"

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export namespace NewAPIBilling {
  export type Billing = NonNullable<SessionV1.StepFinishPart["billing"]>
  export type UnavailableReason = Extract<Billing, { status: "unavailable" }>["reason"]

  export type Target = {
    origin: string
    apiKey: string
  }

  export type Input = {
    target: Target
    requestID: string
    modelNames: string[]
    startedAt: number
    completedAt: number
  }

  export type Dependencies = {
    fetch?: Fetcher
    sleep?: (milliseconds: number) => Promise<void>
    delays?: number[]
    now?: () => number
  }

  type Status = {
    quotaPerUnit: number
    exchangeRate: number
  }

  type Log = {
    requestID: string
    modelName: string
    quota: number
    group: string
    createdAt: number
  }

  const BODY_LIMIT = 1024 * 1024
  const REQUEST_TIMEOUT = 5_000
  const DEFAULT_DELAYS = [0, 250, 1_000, 3_000]
  const active = new Map<string, Promise<Billing>>()

  function loopback(hostname: string) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1"
  }

  export function target(input: { baseURL: unknown; apiKey: unknown }): Target | UnavailableReason {
    if (typeof input.apiKey !== "string" || input.apiKey.trim().length === 0) return "credentials"
    if (typeof input.baseURL !== "string" || input.baseURL.trim().length === 0) return "unsupported-url"
    try {
      const url = new URL(input.baseURL)
      if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname))) return "unsupported-url"
      return { origin: url.origin, apiKey: input.apiKey }
    } catch {
      return "unsupported-url"
    }
  }

  function finite(value: unknown): number | undefined {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
    if (!Number.isFinite(number)) return undefined
    return number
  }

  async function json(response: Response) {
    const length = finite(response.headers.get("content-length"))
    if (length !== undefined && length > BODY_LIMIT) throw new Error("响应过大")
    if (!response.body) return undefined
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    let text = ""
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > BODY_LIMIT) {
        await reader.cancel()
        throw new Error("响应过大")
      }
      text += decoder.decode(part.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  }

  async function request(target: Target, path: string, fetcher: Fetcher) {
    const response = await fetcher(new URL(path, target.origin), {
      headers: { authorization: `Bearer ${target.apiKey}` },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    })
    if (response.status === 401 || response.status === 403) throw new Error("credentials")
    if (response.status >= 300 && response.status < 400) throw new Error("redirect")
    if (!response.ok) throw new Error(`status:${response.status}`)
    return json(response)
  }

  function status(value: unknown): Status | undefined {
    if (!isRecord(value) || !isRecord(value.data)) return undefined
    const quotaPerUnit = finite(value.data.quota_per_unit)
    const exchangeRate = finite(value.data.usd_exchange_rate)
    if (quotaPerUnit === undefined || quotaPerUnit <= 0) return undefined
    if (exchangeRate === undefined || exchangeRate <= 0) return undefined
    return { quotaPerUnit, exchangeRate }
  }

  function items(value: unknown) {
    if (!isRecord(value)) return []
    const candidates = Array.isArray(value.data)
      ? value.data
      : isRecord(value.data) && Array.isArray(value.data.items)
        ? value.data.items
        : []
    return candidates.filter(isRecord)
  }

  function log(value: unknown, requestID: string): Log | null | undefined {
    const match = items(value).find((item) => item.request_id === requestID)
    if (!match) return undefined
    const quota = finite(match.quota)
    const createdAt = finite(match.created_at)
    if (quota === undefined || quota < 0 || createdAt === undefined || createdAt < 0) return null
    if (typeof match.model_name !== "string" || typeof match.group !== "string") return null
    return {
      requestID,
      modelName: match.model_name,
      quota,
      group: match.group,
      createdAt,
    }
  }

  function unavailable(input: Input, reason: UnavailableReason): Billing {
    return { status: "unavailable", source: "new-api-log", requestID: input.requestID, reason }
  }

  function reason(error: unknown): UnavailableReason {
    if (error instanceof Error && error.message === "credentials") return "credentials"
    if (error instanceof Error && error.message === "redirect") return "invalid-response"
    return "network"
  }

  export async function settle(input: Input, dependencies: Dependencies = {}): Promise<Billing> {
    const fetcher: Fetcher = dependencies.fetch ?? globalThis.fetch
    const sleep = dependencies.sleep ?? ((milliseconds) => Bun.sleep(milliseconds))
    const delays = dependencies.delays ?? DEFAULT_DELAYS
    const now = dependencies.now ?? Date.now
    let rates: Status
    try {
      const value = await request(input.target, "/api/status", fetcher)
      const parsed = status(value)
      if (!parsed) return unavailable(input, "invalid-response")
      rates = parsed
    } catch (error) {
      return unavailable(input, reason(error))
    }

    let lastReason: UnavailableReason = "request-log-missing"
    for (const delay of delays) {
      if (delay > 0) await sleep(delay)
      let record: Log | null | undefined
      try {
        record = log(await request(input.target, "/api/log/token", fetcher), input.requestID)
      } catch (error) {
        lastReason = reason(error)
        continue
      }
      if (record === null) return unavailable(input, "invalid-response")
      if (!record) continue
      const names = new Set(input.modelNames.map((name) => name.trim()).filter(Boolean))
      if (!names.has(record.modelName)) return unavailable(input, "model-mismatch")
      const createdAt = record.createdAt * 1_000
      if (createdAt < input.startedAt - 60_000 || createdAt > input.completedAt + 300_000)
        return unavailable(input, "invalid-response")
      const amount = (record.quota / rates.quotaPerUnit) * rates.exchangeRate
      if (!Number.isFinite(amount) || amount < 0) return unavailable(input, "invalid-response")
      return {
        status: "settled",
        source: "new-api-log",
        requestID: input.requestID,
        currency: "CNY",
        amount,
        quota: record.quota,
        quotaPerUnit: rates.quotaPerUnit,
        exchangeRate: rates.exchangeRate,
        group: record.group,
        modelName: record.modelName,
        settledAt: now(),
      }
    }
    return unavailable(input, lastReason)
  }

  export function settleOnce(input: Input, dependencies: Dependencies = {}) {
    const key = `${input.target.origin}\u0000${input.target.apiKey}\u0000${input.requestID}`
    const current = active.get(key)
    if (current) return current
    const task = settle(input, dependencies).finally(() => active.delete(key))
    active.set(key, task)
    return task
  }
}
