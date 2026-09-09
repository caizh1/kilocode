import type { Message, Part, SessionStatusInfo } from "../types/messages"

export const COMPACTION_STATUS_KEY = "chipmate.compaction"
export const COMPACTION_STALE_MS = 10_000

export type CompactionState = "running" | "succeeded" | "failed" | "interrupted"
export type CompactionSource = "manual" | "auto"
export type CompactionAttemptMode = "selected" | "none"
export type CompactionPhase = "preparing" | "generating" | "chunk" | "reduce" | "replay" | "retrying" | "committing"
export type CompactionActivity = "splitting"

export interface CompactionStatus {
  state: CompactionState
  source: CompactionSource
  startedAt: number
  completedAt?: number
  attempt: 1 | 2
  attemptMode: CompactionAttemptMode
  phase: CompactionPhase
  completedUnits?: number
  totalUnits?: number
  reduceDepth?: number
  activity?: CompactionActivity
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function oneOf<const Value extends string>(value: unknown, values: readonly Value[]): value is Value {
  return typeof value === "string" && values.includes(value as Value)
}

function optionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value))
}

function optionalInteger(value: unknown, minimum: number): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= minimum)
}

function validAttempt(value: unknown): value is 1 | 2 | undefined {
  return value === undefined || value === 1 || value === 2
}

function validUnits(completed: unknown, total: unknown) {
  if (!optionalInteger(completed, 0) || !optionalInteger(total, 1)) return false
  return completed === undefined || total === undefined || completed <= total
}

function parseCompactionStatus(metadata: Record<string, unknown>): CompactionStatus | undefined {
  const state = metadata.state
  const source = metadata.source
  const startedAt = metadata.startedAt
  const completedAt = metadata.completedAt
  const attempt = metadata.attempt
  const attemptMode = metadata.attemptMode
  const phase = metadata.phase
  const completedUnits = metadata.completedUnits
  const totalUnits = metadata.totalUnits
  const reduceDepth = metadata.reduceDepth
  const activity = metadata.activity
  if (!oneOf(state, ["running", "succeeded", "failed", "interrupted"])) return
  if (!oneOf(source, ["manual", "auto"])) return
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt) || startedAt < 0) return
  if (!optionalFiniteNumber(completedAt)) return
  if (!validAttempt(attempt)) return
  if (attemptMode !== undefined && !oneOf(attemptMode, ["selected", "none"])) return
  if (
    phase !== undefined &&
    !oneOf(phase, ["preparing", "generating", "chunk", "reduce", "replay", "retrying", "committing"])
  )
    return
  if (!validUnits(completedUnits, totalUnits)) return
  if (!optionalInteger(reduceDepth, 0)) return
  if (activity !== undefined && activity !== "splitting") return
  return {
    state,
    source,
    startedAt,
    completedAt,
    attempt: attempt ?? 1,
    attemptMode: attemptMode ?? "selected",
    phase: phase ?? "preparing",
    completedUnits: completedUnits as number | undefined,
    totalUnits: totalUnits as number | undefined,
    reduceDepth,
    activity,
  }
}

export function compactionStatus(parts: readonly Part[]): CompactionStatus | undefined {
  for (const part of parts) {
    if (part.type !== "text" || part.synthetic !== true) continue
    const metadata = part.metadata?.[COMPACTION_STATUS_KEY]
    if (!record(metadata)) continue
    const status = parseCompactionStatus(metadata)
    if (status) return status
  }
  return undefined
}

export function compactionDisplayState(
  value: CompactionStatus,
  status: SessionStatusInfo,
  now = Date.now(),
): CompactionState {
  if (value.state !== "running" || status.type !== "idle") return value.state
  return now - value.startedAt >= COMPACTION_STALE_MS ? "failed" : "running"
}

function compact(msg: Message | undefined, parts: (id: string) => Part[]) {
  return msg?.role === "user" && parts(msg.id).some((part) => part.type === "compaction")
}

export function compactionBoundary(messages: Message[], parts: (id: string) => Part[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const user = messages[i]
    if (!user || !compact(user, parts)) continue
    const status = compactionStatus(parts(user.id))
    if (status) {
      if (status.state === "succeeded") return i
      continue
    }

    for (let j = i + 1; j < messages.length; j += 1) {
      const msg = messages[j]
      if (!msg || msg.role === "user") break
      if (msg.role !== "assistant" || msg.summary !== true || msg.parentID !== user.id) continue
      if (msg.finish && msg.finish !== "error" && !msg.error) return i
      break
    }
  }
  return -1
}

export function compactionActive(messages: Message[], parts: (id: string) => Part[], status: SessionStatusInfo) {
  const index = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]
      if (compact(msg, parts)) return i
    }
    return -1
  })()
  if (index < 0) return false

  const marker = messages[index]
  const tracked = marker ? compactionStatus(parts(marker.id)) : undefined
  if (tracked) return tracked.state === "running" && status.type !== "idle"

  if (status.type !== "busy") return false

  const tail = messages.slice(index + 1)
  if (tail.some((msg) => msg.role === "user")) return false
  if (tail.some((msg) => msg.role === "assistant" && msg.summary !== true)) return false

  const summary = tail.find((msg) => msg.role === "assistant" && msg.summary === true)
  return !summary?.error && summary?.finish !== "error"
}
