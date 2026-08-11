import { marketplaceIssue, safeMarketplaceErrorText } from "./errors"
import type {
  MarketStatus,
  MarketplaceIdentityState,
  MarketplaceIssue,
  MarketplaceServerState,
  MarketplaceUser,
} from "./types"

export function serverState(
  status?: MarketStatus,
  errors: readonly string[] = [],
  now = new Date().toISOString(),
): MarketplaceServerState {
  const warnings = [...errors, ...(status?.warnings ?? [])].map(safeMarketplaceErrorText).filter(Boolean)
  const degraded =
    warnings.length > 0 ||
    status?.ok === false ||
    [status?.render, status?.market, status?.packages].some((value) => value === "degraded" || value === "unavailable")
  if (!degraded) return { status: "connected", checkedAt: now }
  const issue: MarketplaceIssue = {
    summary: warnings.join("；") || "ChipMate Server 已连接，但部分功能不可用。",
    code: "marketplace-degraded",
  }
  return { status: "degraded", checkedAt: now, issue }
}

export function serverFailure(err: unknown, now = new Date().toISOString()): MarketplaceServerState {
  return {
    status: "failed",
    checkedAt: now,
    issue: marketplaceIssue(err, serverMessage(err)),
  }
}

export function identityState(
  status: MarketplaceIdentityState["status"],
  opts: { user?: MarketplaceUser; issue?: MarketplaceIssue; now?: string } = {},
): MarketplaceIdentityState {
  return {
    status,
    checkedAt: opts.now ?? new Date().toISOString(),
    user: opts.user,
    issue: opts.issue,
  }
}

function serverMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/aborted|aborterror|operation was aborted|timed? ?out/i.test(message)) {
    return "连接 ChipMate Server 超时或被中止。"
  }
  if (/invalid[ -]?url|err_invalid_url/i.test(message)) return "ChipMate Server 地址无效。"
  return `连接 ChipMate Server 失败：${safeMarketplaceErrorText(message) || "未知错误"}`
}
