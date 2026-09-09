import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { MessageID, PartID, SessionID } from "@/session/schema"

export namespace ChipMateCompactionStatus {
  export const key = "chipmate.compaction"

  export type State = "running" | "succeeded" | "failed" | "interrupted"
  export type Source = "manual" | "auto"
  export type AttemptMode = "selected" | "none"
  export type Phase = "preparing" | "generating" | "chunk" | "reduce" | "replay" | "retrying" | "committing"
  export type Activity = "splitting"

  export interface Progress {
    attempt: 1 | 2
    attemptMode: AttemptMode
    phase: Phase
    completedUnits?: number
    totalUnits?: number
    reduceDepth?: number
    activity?: Activity
  }

  export interface Value extends Progress {
    state: State
    source: Source
    startedAt: number
    completedAt?: number
  }

  export type Part = SessionV1.TextPart

  type Store = {
    getPart(input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
    }): Effect.Effect<SessionV1.Part | undefined>
    updatePart<T extends SessionV1.Part>(part: T): Effect.Effect<T>
  }

  const terminal = (state: State) => state !== "running"

  function optional(progress: Progress) {
    return {
      attempt: progress.attempt,
      attemptMode: progress.attemptMode,
      phase: progress.phase,
      ...(progress.completedUnits === undefined ? {} : { completedUnits: progress.completedUnits }),
      ...(progress.totalUnits === undefined ? {} : { totalUnits: progress.totalUnits }),
      ...(progress.reduceDepth === undefined ? {} : { reduceDepth: progress.reduceDepth }),
      ...(progress.activity === undefined ? {} : { activity: progress.activity }),
    } satisfies Progress
  }

  function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  export function value(part: SessionV1.Part | undefined): Value | undefined {
    if (part?.type !== "text" || part.synthetic !== true || part.ignored !== true) return
    const metadata = part.metadata?.[key]
    if (!record(metadata)) return
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
    if (!(["running", "succeeded", "failed", "interrupted"] as const).includes(state as State)) return
    if (source !== "manual" && source !== "auto") return
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt) || startedAt < 0) return
    if (completedAt !== undefined && (typeof completedAt !== "number" || !Number.isFinite(completedAt))) return
    if (attempt !== undefined && attempt !== 1 && attempt !== 2) return
    if (attemptMode !== undefined && attemptMode !== "selected" && attemptMode !== "none") return
    if (
      phase !== undefined &&
      !(["preparing", "generating", "chunk", "reduce", "replay", "retrying", "committing"] as const).includes(
        phase as Phase,
      )
    )
      return
    if (
      completedUnits !== undefined &&
      (typeof completedUnits !== "number" || !Number.isInteger(completedUnits) || completedUnits < 0)
    )
      return
    if (totalUnits !== undefined && (typeof totalUnits !== "number" || !Number.isInteger(totalUnits) || totalUnits < 1))
      return
    if (typeof completedUnits === "number" && typeof totalUnits === "number" && completedUnits > totalUnits) return
    if (
      reduceDepth !== undefined &&
      (typeof reduceDepth !== "number" || !Number.isInteger(reduceDepth) || reduceDepth < 0)
    )
      return
    if (activity !== undefined && activity !== "splitting") return
    return {
      state: state as State,
      source,
      startedAt,
      attempt: (attempt as 1 | 2 | undefined) ?? 1,
      attemptMode: (attemptMode as AttemptMode | undefined) ?? "selected",
      phase: (phase as Phase | undefined) ?? "preparing",
      ...(completedAt === undefined ? {} : { completedAt: completedAt as number }),
      ...(completedUnits === undefined ? {} : { completedUnits: completedUnits as number }),
      ...(totalUnits === undefined ? {} : { totalUnits: totalUnits as number }),
      ...(reduceDepth === undefined ? {} : { reduceDepth: reduceDepth as number }),
      ...(activity === undefined ? {} : { activity: activity as Activity }),
    }
  }

  export function find(parts: readonly SessionV1.Part[]) {
    return parts.find((part): part is Part => value(part) !== undefined)
  }

  export function create(input: { sessionID: SessionID; messageID: MessageID; source: Source; now?: number }): Part {
    const startedAt = input.now ?? Date.now()
    return {
      id: PartID.ascending(),
      messageID: input.messageID,
      sessionID: input.sessionID,
      type: "text",
      text: "",
      synthetic: true,
      ignored: true,
      metadata: {
        [key]: {
          state: "running",
          source: input.source,
          startedAt,
          attempt: 1,
          attemptMode: "selected",
          phase: "preparing",
        } satisfies Value,
      },
    }
  }

  export const progress = Effect.fn("ChipMateCompactionStatus.progress")(function* (input: {
    part: Part | undefined
    value: Progress
    store: Store
  }) {
    if (!input.part) return undefined
    const current = yield* input.store.getPart({
      sessionID: input.part.sessionID,
      messageID: input.part.messageID,
      partID: input.part.id,
    })
    if (current?.type !== "text") return undefined
    const previous = value(current)
    if (!previous || terminal(previous.state)) return current
    return yield* input.store.updatePart({
      ...current,
      metadata: {
        ...current.metadata,
        [key]: {
          state: previous.state,
          source: previous.source,
          startedAt: previous.startedAt,
          ...optional(input.value),
        } satisfies Value,
      },
    })
  })

  export const transition = Effect.fn("ChipMateCompactionStatus.transition")(function* (input: {
    part: Part | undefined
    state: Exclude<State, "running">
    store: Store
    now?: number
  }) {
    if (!input.part) return undefined
    const current = yield* input.store.getPart({
      sessionID: input.part.sessionID,
      messageID: input.part.messageID,
      partID: input.part.id,
    })
    if (current?.type !== "text") return undefined
    const previous = value(current)
    if (!previous || terminal(previous.state)) return current
    return yield* input.store.updatePart({
      ...current,
      metadata: {
        ...current.metadata,
        [key]: {
          ...previous,
          state: input.state,
          completedAt: input.now ?? Date.now(),
        } satisfies Value,
      },
    })
  })
}
