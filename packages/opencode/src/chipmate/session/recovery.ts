import { Flag } from "@opencode-ai/core/flag/flag"

/** 一次逻辑模型请求共用的预算，工具后的下一次请求拥有自己的预算。 */
export type RecoveryBudget = { limit: number; used: number }

export function recoveryBudget(input: { bytes?: number; summary?: boolean } = {}): RecoveryBudget {
  return {
    limit: Math.min(3, Flag.CHIPMATE_SESSION_RETRY_LIMIT ?? 3, input.summary || (input.bytes ?? 0) >= 128_000 ? 2 : 3),
    used: 0,
  }
}
