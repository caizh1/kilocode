import type { MarketplaceErrorReason, MarketplaceIssue } from "./types"

interface MarketplaceApiErrorOptions {
  status?: number
  reason?: MarketplaceErrorReason
  requestId?: string
  retryAfter?: string
  upstreamStatus?: number
}

export class MarketplaceApiError extends Error {
  readonly status?: number
  readonly code: string
  readonly reason?: MarketplaceErrorReason
  readonly requestId?: string
  readonly retryAfter?: string
  readonly upstreamStatus?: number

  constructor(code: string, opts: MarketplaceApiErrorOptions = {}) {
    super(code)
    this.name = "MarketplaceApiError"
    this.code = code
    this.status = opts.status
    this.reason = opts.reason
    this.requestId = opts.requestId
    this.retryAfter = opts.retryAfter
    this.upstreamStatus = opts.upstreamStatus
  }
}

export function marketplaceIdentityErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const reason = err instanceof MarketplaceApiError ? err.reason : undefined
  const mapped = reasonMessage(reason, message)
  if (mapped) return mapped
  if (/marketplace-login-required|session-expired/i.test(message)) return "市场登录已过期，请重新使用 LDAP 登录。"
  if (/client-upgrade-required/i.test(message)) return "当前插件版本不再受服务器支持，请升级 ChipMate 插件。"
  if (/^HTTP 404/i.test(message)) return "ChipMate Server 未找到市场身份接口，请检查服务端版本。"
  if ((err instanceof MarketplaceApiError && err.status && err.status >= 500) || /^HTTP 5\d\d/i.test(message)) {
    return "ChipMate Server 认证服务暂时不可用，请检查 LDAP 与服务端状态。"
  }
  return safeMarketplaceErrorText(message) || "未知错误。"
}

function reasonMessage(reason: MarketplaceErrorReason | undefined, message: string): string | undefined {
  if (reason === "invalid-url" || /invalid[ -]?url|err_invalid_url/i.test(message)) {
    return "ChipMate Server 地址格式无效，请检查市场 baseUrl 是否包含 http:// 或 https://，并移除多余引号、空格。"
  }
  if (reason === "rate-limited" || /rate-limited/i.test(message)) return "认证请求过于频繁，请稍后重试。"
  if (reason === "timeout" || /aborted|aborterror|operation was aborted|timed? ?out/i.test(message)) {
    return "连接 ChipMate Server 超时或被中止。"
  }
  if (reason === "network" || /failed to fetch|fetch failed|econnrefused|enotfound|network/i.test(message)) {
    return "无法连接 ChipMate Server，请确认 marketplace baseUrl 和服务状态。"
  }
  return undefined
}

export function marketplaceIssue(err: unknown, summary = marketplaceIdentityErrorMessage(err)): MarketplaceIssue {
  if (!(err instanceof MarketplaceApiError)) return { summary: safeMarketplaceErrorText(summary) }
  return {
    summary: safeMarketplaceErrorText(summary),
    status: err.status,
    code: safeField(err.code),
    reason: err.reason,
    requestId: safeField(err.requestId),
    retryAfter: safeField(err.retryAfter),
    upstreamStatus: err.upstreamStatus,
  }
}

export function safeMarketplaceErrorText(value: unknown): string {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/sk-[A-Za-z0-9._~+/=-]{6,}/gi, "sk-<redacted>")
    .replace(/https?:\/\/[^\s]+/gi, "<url>")
    .replace(/(?:admin|access)[-_ ]?token\s*[=:]\s*[^\s,;]+/gi, "admin-token=<redacted>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
}

function safeField(value: string | undefined): string | undefined {
  const safe = safeMarketplaceErrorText(value)
  return safe || undefined
}
