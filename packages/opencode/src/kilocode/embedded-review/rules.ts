import type { RulePack } from "./types"

const TIMEOUT = 5_000
const MAX_BYTES = 5 * 1024 * 1024

export class RulePackUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RulePackUnavailableError"
  }
}

export async function latestRulePack(input: { endpoint?: string; abort?: AbortSignal }): Promise<RulePack> {
  const endpoint = input.endpoint?.trim() || process.env.KILO_REVIEW_RULES_ENDPOINT?.trim()
  if (!endpoint) throw new RulePackUnavailableError("未配置 ChipMate Server 规则端点。")
  const url = new URL(endpoint)
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new RulePackUnavailableError("ChipMate Server 规则端点必须使用 HTTP 或 HTTPS。")
  }
  const timeout = AbortSignal.timeout(TIMEOUT)
  const signal = input.abort ? AbortSignal.any([input.abort, timeout]) : timeout
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal,
  }).catch((err: unknown) => {
    throw new RulePackUnavailableError(err instanceof Error ? err.message : String(err))
  })
  if (!response.ok) throw new RulePackUnavailableError(`ChipMate Server 返回 HTTP ${response.status}。`)
  const value: unknown = parse(await bounded(response))
  if (!pack(value)) throw new RulePackUnavailableError("ChipMate Server 返回了无效的 RulePack。")
  if (value.status !== "PUBLISHED") throw new RulePackUnavailableError("ChipMate Server 未返回已发布的 RulePack。")
  return value
}

async function bounded(response: Response) {
  const length = Number(response.headers.get("content-length"))
  if (Number.isFinite(length) && length > MAX_BYTES) {
    throw new RulePackUnavailableError(`ChipMate Server RulePack 超过 ${MAX_BYTES} 字节。`)
  }
  if (!response.body) throw new RulePackUnavailableError("ChipMate Server 返回了空的 RulePack 响应。")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const item = await reader.read().catch((err: unknown) => {
      throw new RulePackUnavailableError(err instanceof Error ? err.message : String(err))
    })
    if (item.done) break
    size += item.value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new RulePackUnavailableError(`ChipMate Server RulePack 超过 ${MAX_BYTES} 字节。`)
    }
    chunks.push(item.value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch (err) {
    throw new RulePackUnavailableError(err instanceof Error ? err.message : String(err))
  }
}

function pack(value: unknown): value is RulePack {
  if (!record(value)) return false
  if (value.schemaVersion !== 1 || typeof value.version !== "string" || value.status !== "PUBLISHED") return false
  if (!hash(value.contentHash) || !hash(value.sourceHash) || !Array.isArray(value.rules)) return false
  const ids = new Set<string>()
  return value.rules.every((rule) => {
    if (!record(rule) || typeof rule.id !== "string" || ids.has(rule.id)) return false
    ids.add(rule.id)
    return (
      /^C-\d{3}$/.test(rule.id) &&
      Number.isSafeInteger(rule.revision) &&
      Number(rule.revision) >= 1 &&
      ["MUST", "SHOULD", "ADVICE"].includes(String(rule.level)) &&
      ["mechanical", "semantic"].includes(String(rule.check)) &&
      typeof rule.title === "string" &&
      typeof rule.description === "string" &&
      Array.isArray(rule.appliesTo) &&
      Array.isArray(rule.languages) &&
      rule.languages.every((lang) => lang === "c" || lang === "cpp") &&
      Array.isArray(rule.exceptions) &&
      hash(rule.contentHash)
    )
  })
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hash(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)
}
