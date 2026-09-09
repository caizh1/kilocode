import type { Message, Part } from "../types/messages"
import { compactionStatus, type CompactionStatus } from "./compaction-activity"
import { messagePerformance, type ResponsePerformance } from "./session-utils"
import { completedTurnElapsed, visibleParts, type MessageTurn, type RevertBoundary } from "./session-queue"

interface TranscriptMeta {
  turn: string
  partial: boolean
  queued: boolean
  live: boolean
}

export interface TranscriptUserRow extends TranscriptMeta {
  type: "user"
  key: string
  message: Message
  parts: Part[]
  interrupted: boolean
  answered: boolean
}

export interface TranscriptAssistantRow extends TranscriptMeta {
  type: "assistant"
  key: string
  message: Message
  parts: Part[]
  copy?: string
  forkAfterMessageID?: string
  completionElapsed?: number
  /** Response performance is shown only on the latest successful ordinary turn. */
  performance?: ResponsePerformance
  /** Agent that produced the final successful reply for this completed turn. */
  completionAgent?: string
}

export interface TranscriptDiffRow extends TranscriptMeta {
  type: "diff"
  key: string
  message: Message
  diffs: unknown[]
}

export interface TranscriptErrorRow extends TranscriptMeta {
  type: "error"
  key: string
  message: Message
  error: NonNullable<Message["error"]>
}

export interface TranscriptCompactionRow extends TranscriptMeta {
  type: "compaction"
  key: string
  message: Message
  parts: Part[]
  status: CompactionStatus
}

export type TranscriptRow =
  | TranscriptUserRow
  | TranscriptAssistantRow
  | TranscriptDiffRow
  | TranscriptErrorRow
  | TranscriptCompactionRow

export interface TranscriptOptions {
  turnChanges?: boolean
  size?: number
  queued?: ReadonlySet<string>
  live?: ReadonlySet<string>
  hidden?: (id: string) => boolean
  revert?: RevertBoundary
  messages?: readonly Message[]
}

export interface TranscriptPartition {
  virtual: TranscriptRow[]
  direct: TranscriptRow[]
  queued: TranscriptRow[]
}

export interface TranscriptHold {
  sid: string
  turn: string
}

export function retainTurn(
  prev: TranscriptHold | undefined,
  sid: string | undefined,
  turn: string | undefined,
  paused: boolean,
) {
  if (!sid) return undefined
  if (!turn || paused) return prev?.sid === sid ? prev : turn ? { sid, turn } : undefined
  if (prev?.sid === sid && prev.turn === turn) return prev
  return { sid, turn }
}

function same<T>(a: T[], b: T[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function stabilize<T>(next: T[], prev?: T[]) {
  if (!prev || !same(next, prev)) return next
  return prev
}

function meta(a: TranscriptRow, b: TranscriptRow) {
  return a.turn === b.turn && a.partial === b.partial && a.queued === b.queued && a.live === b.live
}

function equalAssistant(a: TranscriptAssistantRow, b: TranscriptAssistantRow) {
  return (
    a.message === b.message &&
    same(a.parts, b.parts) &&
    a.copy === b.copy &&
    a.forkAfterMessageID === b.forkAfterMessageID &&
    a.completionElapsed === b.completionElapsed &&
    a.performance?.generation === b.performance?.generation &&
    a.performance?.ttftMs === b.performance?.ttftMs &&
    a.completionAgent === b.completionAgent
  )
}

function equalCompaction(a: TranscriptCompactionRow, b: TranscriptCompactionRow) {
  return (
    a.message === b.message &&
    same(a.parts, b.parts) &&
    a.status.state === b.status.state &&
    a.status.source === b.status.source &&
    a.status.startedAt === b.status.startedAt &&
    a.status.completedAt === b.status.completedAt &&
    a.status.attempt === b.status.attempt &&
    a.status.attemptMode === b.status.attemptMode &&
    a.status.phase === b.status.phase &&
    a.status.completedUnits === b.status.completedUnits &&
    a.status.totalUnits === b.status.totalUnits &&
    a.status.reduceDepth === b.status.reduceDepth &&
    a.status.activity === b.status.activity
  )
}

function equalStandard(
  a: Exclude<TranscriptRow, TranscriptCompactionRow>,
  b: Exclude<TranscriptRow, TranscriptCompactionRow>,
) {
  if (a.type !== b.type || !meta(a, b)) return false
  if (a.type === "user" && b.type === "user") {
    return (
      a.message === b.message && same(a.parts, b.parts) && a.interrupted === b.interrupted && a.answered === b.answered
    )
  }
  if (a.type === "assistant" && b.type === "assistant") {
    return equalAssistant(a, b)
  }
  if (a.type === "diff" && b.type === "diff") {
    return a.message === b.message && same(a.diffs, b.diffs)
  }
  if (a.type === "error" && b.type === "error") {
    return a.message === b.message && a.error === b.error
  }
  return false
}

function equal(a: TranscriptRow, b: TranscriptRow) {
  if (a.type === "compaction") return b.type === "compaction" && meta(a, b) && equalCompaction(a, b)
  if (b.type === "compaction") return false
  return equalStandard(a, b)
}

function diffs(msg: Message) {
  if (!msg.summary || typeof msg.summary === "boolean") return []
  return msg.summary.diffs ?? []
}

function copy(messages: Message[], getParts: (id: string) => Part[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parts = getParts(messages[i]!.id)
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j]
      if (part?.type !== "text" || part.synthetic || !part.text.trim()) continue
      return part.id
    }
  }
  return undefined
}

function rowCompletionElapsed(
  completionElapsed: number | undefined,
  copied: string | undefined,
  parts: readonly Part[],
) {
  if (completionElapsed === undefined || !copied || !parts.some((part) => part.id === copied)) return undefined
  return completionElapsed
}

function rowPerformance(
  performance: ResponsePerformance | undefined,
  copied: string | undefined,
  parts: readonly Part[],
) {
  if (!performance || !copied || !parts.some((part) => part.id === copied)) return undefined
  return performance
}

function turnForkBoundary(turn: MessageTurn, copied: string | undefined, live: boolean) {
  if (!copied || live) return undefined
  return turn.assistant.at(-1)?.id
}

function chunkForkBoundary(parts: Part[], copied: string | undefined, boundary: string | undefined) {
  if (!boundary || !copied) return undefined
  return parts.some((part) => part.id === copied) ? boundary : undefined
}

function compactionRows(turn: MessageTurn, user: Part[], value: TranscriptMeta): TranscriptCompactionRow[] {
  if (turn.partial) return []
  if (!user.some((part) => part.type === "compaction")) return []
  const status = compactionStatus(user)
  if (!status) return []
  return [
    {
      ...value,
      type: "compaction",
      key: `${turn.id}:compaction`,
      message: turn.user,
      parts: user,
      status,
    },
  ]
}

function latestTurnPerformance(
  turns: MessageTurn[],
  parts: (id: string) => Part[],
  messages: readonly Message[] | undefined,
  getParts: (id: string) => Part[],
) {
  let latest: { turn: string; value: ResponsePerformance } | undefined
  for (const turn of turns) {
    const assistants = turn.assistant.filter((msg) => msg.summary !== true)
    if (!copy(assistants, parts)) continue
    if (completedTurnElapsed(turn, messages, getParts) === undefined) continue
    const performance = messagePerformance(assistants.flatMap((msg) => parts(msg.id)))
    if (performance) latest = { turn: turn.id, value: performance }
  }
  return latest
}

function performanceForTurn(
  latest: { turn: string; value: ResponsePerformance } | undefined,
  turn: string,
): ResponsePerformance | undefined {
  if (latest?.turn !== turn) return undefined
  return latest.value
}

function reviewRow(changes: number, enabled: boolean | undefined, hidden: boolean, active: boolean) {
  return changes > 0 || (!!enabled && !hidden && active)
}

export function transcriptRows(
  turns: MessageTurn[],
  getParts: (id: string) => Part[],
  opts: TranscriptOptions = {},
  prev: TranscriptRow[] = [],
): TranscriptRow[] {
  const size = Math.max(1, Math.floor(opts.size ?? 8))
  const rows: TranscriptRow[] = []
  const parts = (id: string) => visibleParts(id, getParts(id), opts.revert)
  const terminal = (msg: Message) => !(opts.revert?.partID && msg.id === opts.revert.messageID)
  const latestPerformance = latestTurnPerformance(turns, parts, opts.messages, getParts)

  for (const turn of turns) {
    const assistants = turn.assistant.filter((msg) => msg.summary !== true)
    const user = parts(turn.user.id)
    const compact = user.some((part) => part.type === "compaction")
    const meta = {
      turn: turn.id,
      partial: turn.partial === true,
      queued: opts.queued?.has(turn.id) === true,
      live: opts.live?.has(turn.id) === true,
    }
    const copied = copy(assistants, parts)
    const completionElapsed = completedTurnElapsed(turn, opts.messages, getParts)
    const completionAgent = completionElapsed === undefined ? undefined : turn.assistant.at(-1)?.agent
    const forkAfterMessageID = turnForkBoundary(turn, copied, meta.live)
    const performance = performanceForTurn(latestPerformance, turn.id)

    if (!turn.partial && !compact) {
      rows.push({
        ...meta,
        type: "user",
        key: `${turn.id}:user`,
        message: turn.user,
        parts: user,
        interrupted: turn.assistant.some((msg) => terminal(msg) && msg.error?.name === "MessageAbortedError"),
        answered: turn.assistant.length > 0,
      })
    }

    for (const msg of assistants) {
      const visible = parts(msg.id)
      if (visible.length === 0) {
        rows.push({
          ...meta,
          type: "assistant",
          key: `${turn.id}:assistant:${msg.id}:empty`,
          message: msg,
          parts: visible,
          copy: copied,
          forkAfterMessageID: undefined,
          completionElapsed: rowCompletionElapsed(completionElapsed, copied, visible),
          performance: rowPerformance(performance, copied, visible),
        })
        continue
      }
      for (let start = 0; start < visible.length; start += size) {
        const chunk = visible.slice(start, start + size)
        const elapsed = rowCompletionElapsed(completionElapsed, copied, chunk)
        rows.push({
          ...meta,
          type: "assistant",
          key: `${turn.id}:assistant:${msg.id}:${chunk[0]!.id}`,
          message: msg,
          parts: chunk,
          copy: copied,
          forkAfterMessageID: chunkForkBoundary(chunk, copied, forkAfterMessageID),
          completionElapsed: elapsed,
          performance: rowPerformance(performance, copied, chunk),
          completionAgent: elapsed === undefined ? undefined : completionAgent,
        })
      }
    }

    const changes = diffs(turn.user)
    if (reviewRow(changes.length, opts.turnChanges, [compact, meta.partial, meta.queued].some(Boolean), [assistants.length > 0, meta.live].some(Boolean))) {
      rows.push({ ...meta, type: "diff", key: `${turn.id}:diff`, message: turn.user, diffs: changes })
    }

    const failed = turn.assistant.find(
      (msg) => terminal(msg) && msg.error && msg.error.name !== "MessageAbortedError" && opts.hidden?.(msg.id) !== true,
    )
    if (failed?.error) {
      rows.push({ ...meta, type: "error", key: `${turn.id}:error:${failed.id}`, message: failed, error: failed.error })
    }

    rows.push(...compactionRows(turn, user, meta))
  }

  if (prev.length === 0) return rows
  const prior = new Map(prev.map((row) => [row.key, row]))
  return rows.map((row) => {
    const old = prior.get(row.key)
    return old && equal(old, row) ? old : row
  })
}

export function partitionRows(rows: TranscriptRow[], direct: ReadonlySet<string> = new Set()): TranscriptPartition {
  const queued = rows.filter((row) => row.queued)
  const visible = rows.filter((row) => !row.queued)
  const turn = visible.at(-1)?.turn
  // Only the latest visible turn can render directly.
  if (!turn || !direct.has(turn)) return { virtual: visible, direct: [], queued }

  let boundary = -1
  for (let i = 0; i < visible.length; i += 1) {
    const row = visible[i]!
    if (row.turn === turn && row.type === "assistant") boundary = i
  }

  // The selected turn has no renderable assistant row.
  if (boundary === -1) return { virtual: visible, direct: [], queued }

  // Boundary starts the direct suffix, preserving rows after the streaming assistant.
  return {
    virtual: visible.slice(0, boundary),
    direct: visible.slice(boundary),
    queued,
  }
}
