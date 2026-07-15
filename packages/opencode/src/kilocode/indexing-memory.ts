import { totalmem } from "node:os"

const gib = 1024 * 1024 * 1024

export type IndexingPressure = "normal" | "constrained" | "forced-low"

export type IndexingBudget = {
  soft: number
  critical: number
  hard: number
  recovery: number
}

export type IndexingResource = {
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  pressure: IndexingPressure
  budget: IndexingBudget
}

export function indexingBudget(
  env: Record<string, string | undefined> = process.env,
  memory = totalmem(),
): IndexingBudget {
  const adaptive = clamp(Math.floor(memory * 0.25), 2 * gib, 4 * gib)
  const hard = limit(env.KILO_INDEXING_HARD_RSS_BYTES, adaptive)
  const soft = Math.min(hard, limit(env.KILO_INDEXING_SOFT_RSS_BYTES, Math.floor(hard * 0.75)))
  const critical = Math.max(soft, Math.min(hard, limit(env.KILO_INDEXING_CRITICAL_RSS_BYTES, Math.floor(hard * 0.875))))
  const recovery = Math.min(soft, limit(env.KILO_INDEXING_RECOVERY_RSS_BYTES, Math.floor(soft * 0.85)))
  return { soft, critical, hard, recovery }
}

export function pressureFor(
  rss: number,
  budget: IndexingBudget,
  current: IndexingPressure,
  recovered: number,
): { pressure: IndexingPressure; recovered: number } {
  if (current === "forced-low") return { pressure: current, recovered: 0 }
  if (rss >= budget.soft) return { pressure: "constrained", recovered: 0 }
  if (current === "normal") return { pressure: current, recovered: 0 }
  if (rss > budget.recovery) return { pressure: current, recovered: 0 }
  const next = recovered + 1
  if (next < 3) return { pressure: current, recovered: next }
  return { pressure: "normal", recovered: 0 }
}

export function memoryExit(code: number | null, message: string): boolean {
  if (code === 86 || code === 87) return true
  return /RSS limit|memory pressure|memory rollover/i.test(message)
}

function limit(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
