// chipmate_change - new file
import { ProductProfile } from "@/chipmate/product-profile"
import type { Agent } from "@/agent/agent"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

export namespace UltraVerify {
  export const TOOL = "ultra_verify"

  export type Kind = "analysis" | "review" | "implementation"
  export type Phase = "pending" | "running" | "ready" | "complete" | "failed"
  export type State = {
    sessionID: string
    messageID: string
    phase: Phase
    kind?: Kind
    attempts: number
    premature: number
    baseline?: string
    answer?: string
    hash?: string
    sessions: string[]
    reason?: string
  }
  export type Snapshot = {
    version: 1
    messageID: string
    phase: Phase
    kind?: Kind
    attempts: number
    hash?: string
    sessions: string[]
    reason?: string
  }

  const states = new Map<string, State>()

  function key(sessionID: string, messageID: string) {
    return `${sessionID}\u0000${messageID}`
  }

  function digest(input: string) {
    return new Bun.CryptoHasher("sha256").update(input).digest("hex")
  }

  function saved(part: SessionV1.ToolPart) {
    if (part.tool !== TOOL || !("output" in part.state) || typeof part.state.output !== "string") return undefined
    const marker = "ULTRA_VERIFY_RESULT\n"
    const offset = part.state.output.indexOf(marker)
    if (offset < 0) return undefined
    try {
      const data = JSON.parse(part.state.output.slice(offset + marker.length)) as {
        baseline?: unknown
        answer?: unknown
        sessions?: unknown
      }
      if (typeof data.baseline !== "string" || !data.baseline.trim()) return undefined
      if (typeof data.answer !== "string" || !data.answer.trim()) return undefined
      return {
        baseline: data.baseline,
        answer: data.answer,
        sessions: Array.isArray(data.sessions)
          ? data.sessions.filter((item): item is string => typeof item === "string")
          : [],
      }
    } catch {
      return undefined
    }
  }

  export function active(agent: Pick<Agent.Info, "native" | "options">) {
    return ProductProfile.chipmate && agent.native === true && agent.options?.id === "ultra"
  }

  export function load(input: { sessionID: string; messageID: string; messages: SessionV1.WithParts[] }) {
    const id = key(input.sessionID, input.messageID)
    const cached = states.get(id)
    if (cached) return cached
    const parts = input.messages
      .filter(
        (message) =>
          message.info.role === "assistant" &&
          message.info.parentID === input.messageID &&
          message.info.sessionID === input.sessionID,
      )
      .flatMap((message) => message.parts)
      .filter((part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === TOOL)
    const result = parts
      .map(saved)
      .filter((item): item is NonNullable<ReturnType<typeof saved>> => Boolean(item))
      .at(-1)
    const snapshots = parts
      .map((part) => ("metadata" in part.state ? part.state.metadata?.ultraVerify : undefined))
      .filter((item): item is Snapshot => {
        if (!item || typeof item !== "object") return false
        return (item as Snapshot).version === 1 && (item as Snapshot).messageID === input.messageID
      })
    const last = snapshots.at(-1)
    const state: State = {
      sessionID: input.sessionID,
      messageID: input.messageID,
      phase: result
        ? last?.kind === "implementation"
          ? "ready"
          : "complete"
        : last?.phase === "running"
          ? "failed"
          : (last?.phase ?? "pending"),
      kind: last?.kind,
      attempts: last?.attempts ?? 0,
      premature: 0,
      baseline: result?.baseline,
      answer: result?.answer,
      hash: result ? digest(result.answer) : last?.hash,
      sessions: result?.sessions ?? last?.sessions ?? [],
      reason:
        !result && last?.phase === "running"
          ? "The verification pipeline was interrupted before producing a complete answer."
          : last?.reason,
    }
    states.set(id, state)
    if (states.size > 512) {
      const oldest = states.keys().next().value
      if (oldest) states.delete(oldest)
    }
    return state
  }

  export function snapshot(state: State): Snapshot {
    return {
      version: 1,
      messageID: state.messageID,
      phase: state.phase,
      kind: state.kind,
      attempts: state.attempts,
      hash: state.hash,
      sessions: state.sessions,
      reason: state.reason,
    }
  }

  export function begin(state: State, kind: Kind) {
    if (state.phase !== "pending") return "The Ultra verification pipeline has already started."
    state.phase = "running"
    state.kind = kind
    state.attempts++
    state.premature = 0
    state.reason = "The Ultra verification pipeline was interrupted before producing a complete answer."
    return undefined
  }

  export function complete(state: State, input: { baseline: string; answer: string; sessions: string[] }) {
    const baseline = input.baseline.trim()
    const answer = input.answer.trim()
    if (!baseline || !answer) return fail(state, "The Code baseline or synthesized answer was empty.")
    state.phase = state.kind === "implementation" ? "ready" : "complete"
    state.baseline = baseline
    state.answer = answer
    state.hash = digest(answer)
    state.sessions = [...new Set(input.sessions)]
    state.reason = undefined
    return true
  }

  export function fail(state: State, reason: string) {
    state.phase = "failed"
    state.reason = reason
    return false
  }

  export function filter<T>(state: State, tools: Record<string, T>) {
    if (state.phase === "pending" || state.phase === "running") {
      return Object.fromEntries(Object.entries(tools).filter(([id]) => id === TOOL))
    }
    return Object.fromEntries(Object.entries(tools).filter(([id]) => id !== TOOL && id !== "task"))
  }

  export function required(state: State) {
    return state.phase === "pending" || state.phase === "running"
  }

  export function reminder(state: State) {
    if (state.phase === "pending") {
      return [
        "Ultra verification runtime contract:",
        `- Call ${TOOL} exactly once before answering or changing files.`,
        "- The runtime freezes one normal read-only Code answer, launches three independent read-only Explore verifiers in parallel, then launches one independent Ask synthesizer.",
        "- Do not call ordinary task, write a competing draft, or expose hidden benchmark material.",
      ].join("\n")
    }
    if (state.phase === "running") {
      return "The Ultra verification pipeline is still running. Do not answer or invoke another tool."
    }
    if (state.phase === "complete") {
      return "The independently synthesized Ultra answer is frozen for exact delivery."
    }
    if (state.phase === "ready") {
      return [
        "The read-only Code baseline and three-way verification are complete.",
        "Use the synthesized result in the completed ultra_verify tool output as the implementation plan.",
        "Now perform the requested edits and tests yourself. Do not delegate another task.",
      ].join("\n")
    }
    return `The Ultra verification pipeline failed: ${state.reason ?? "unknown failure"}`
  }

  export function delivery(state: State) {
    const text =
      state.phase === "complete" && state.answer && state.hash === digest(state.answer)
        ? state.answer
        : state.phase === "failed"
          ? result(state)
          : undefined
    if (!text) return undefined
    return {
      text,
      hash: digest(text),
      partID: `prt_ultra_verify_${digest(`${state.sessionID}\u0000${state.messageID}\u0000${text}`).slice(0, 32)}`,
    }
  }

  export function result(state: State) {
    return [
      "ULTRA_VERIFY_RUNTIME_DISCLOSURE",
      "三路独立证据验证未能形成完整答案。",
      `原因：${state.reason ?? "未知错误"}`,
      "本轮没有输出未经验证的技术结论。",
    ].join("\n")
  }

  export function outputID(state: State) {
    return `prt_ultra_verify_failed_${digest(`${state.sessionID}\u0000${state.messageID}`).slice(0, 24)}`
  }

  export function stopping(outcome: "break" | "continue", finish?: string) {
    return outcome === "break" || Boolean(finish && !["tool-calls", "unknown"].includes(finish))
  }

  export function gate(state: State, outcome: "break" | "continue", failed: boolean, finish?: string) {
    if (!stopping(outcome, finish)) return outcome
    if (failed || !required(state)) return "break" as const
    state.premature++
    if (state.premature < 4) return "continue" as const
    fail(state, "The provider repeatedly ended the turn without calling the mandatory verification tool.")
    return "continue" as const
  }

  export function reset() {
    states.clear()
  }
}
