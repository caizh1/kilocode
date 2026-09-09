import { describe, expect, it } from "bun:test"
import {
  compactionActive,
  compactionBoundary,
  compactionDisplayState,
  compactionStatus,
} from "../../webview-ui/src/context/compaction-activity"
import type { Message, Part, SessionStatusInfo } from "../../webview-ui/src/types/messages"

const base = {
  sessionID: "session",
  createdAt: "2026-01-01T00:00:00.000Z",
}

const message = (id: string, role: Message["role"], opts: Partial<Message> = {}): Message => ({
  ...base,
  id,
  role,
  ...opts,
})

const compact = (id: string): Part => ({
  id: `part-${id}`,
  messageID: id,
  type: "compaction",
  auto: true,
})

const tracked = (id: string, state: "running" | "succeeded" | "failed" | "interrupted", auto = true): Part => ({
  id: `status-${id}`,
  messageID: id,
  type: "text",
  text: "",
  synthetic: true,
  metadata: {
    "chipmate.compaction": {
      state,
      source: auto ? "auto" : "manual",
      startedAt: 1_000,
      ...(state === "running" ? {} : { completedAt: 2_000 }),
    },
  },
})

const parts = (ids: string[]) => (id: string) => (ids.includes(id) ? [compact(id)] : [])
const status = (type: SessionStatusInfo["type"]): SessionStatusInfo => {
  if (type === "retry") return { type, attempt: 1, message: "retry", next: Date.now() + 1000 }
  if (type === "offline") return { type, message: "offline" }
  return { type }
}

describe("compactionActive", () => {
  it("activates only for a busy compaction turn", () => {
    const messages = [message("u1", "user")]
    expect(compactionActive(messages, parts(["u1"]), status("busy"))).toBe(true)
    expect(compactionActive(messages, parts([]), status("busy"))).toBe(false)
  })

  it("stays active while multiple summary workers are present", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", { parentID: "u1", summary: true }),
      message("a2", "assistant", { parentID: "u1", summary: true }),
    ]
    expect(compactionActive(messages, parts(["u1"]), status("busy"))).toBe(true)
  })

  it("does not treat a successful summary finish as proof that chunking ended", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", {
        parentID: "u1",
        summary: true,
        finish: "stop",
        time: { created: 1, completed: 2 },
      }),
    ]
    expect(compactionActive(messages, parts(["u1"]), status("busy"))).toBe(true)
  })

  it("yields to idle, retry, and offline states", () => {
    const messages = [message("u1", "user")]
    expect(compactionActive(messages, parts(["u1"]), status("idle"))).toBe(false)
    expect(compactionActive(messages, parts(["u1"]), status("retry"))).toBe(false)
    expect(compactionActive(messages, parts(["u1"]), status("offline"))).toBe(false)
  })

  it("retains compaction identity during retry and offline states when lifecycle metadata is running", () => {
    const messages = [message("u1", "user")]
    const lookup = (id: string) => (id === "u1" ? [compact(id), tracked(id, "running")] : [])
    expect(compactionActive(messages, lookup, status("busy"))).toBe(true)
    expect(compactionActive(messages, lookup, status("retry"))).toBe(true)
    expect(compactionActive(messages, lookup, status("offline"))).toBe(true)
    expect(compactionActive(messages, lookup, status("idle"))).toBe(false)
  })

  it("ends on an explicit summary failure", () => {
    const failed = [
      message("u1", "user"),
      message("a1", "assistant", { parentID: "u1", summary: true, error: { name: "ProviderError" } }),
    ]
    const ended = [
      message("u1", "user"),
      message("a1", "assistant", { parentID: "u1", summary: true, finish: "error" }),
    ]
    expect(compactionActive(failed, parts(["u1"]), status("busy"))).toBe(false)
    expect(compactionActive(ended, parts(["u1"]), status("busy"))).toBe(false)
  })

  it("ends when a newer normal user or assistant takes over", () => {
    const user = [message("u1", "user"), message("u2", "user")]
    const assistant = [message("u1", "user"), message("a1", "assistant", { parentID: "u1" })]
    expect(compactionActive(user, parts(["u1"]), status("busy"))).toBe(false)
    expect(compactionActive(assistant, parts(["u1"]), status("busy"))).toBe(false)
  })
})

describe("compactionBoundary", () => {
  it("finds the latest completed compaction turn", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", { parentID: "u1", summary: true, finish: "stop" }),
    ]
    expect(compactionBoundary(messages, parts(["u1"]))).toBe(0)
  })

  it("ignores incomplete and failed compaction turns", () => {
    const incomplete = [message("u1", "user"), message("a1", "assistant", { parentID: "u1", summary: true })]
    const failed = [
      message("u1", "user"),
      message("a1", "assistant", { parentID: "u1", summary: true, finish: "error" }),
    ]
    expect(compactionBoundary(incomplete, parts(["u1"]))).toBe(-1)
    expect(compactionBoundary(failed, parts(["u1"]))).toBe(-1)
  })

  it("falls back to the previous completed compaction when the latest one fails", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", { parentID: "u1", summary: true, finish: "stop" }),
      message("u2", "user"),
      message("a2", "assistant", { parentID: "u2", summary: true, finish: "error" }),
    ]
    expect(compactionBoundary(messages, parts(["u1", "u2"]))).toBe(0)
  })

  it("keeps the completed boundary while an automatic continuation starts", () => {
    const messages = [
      message("a0", "assistant", { tokens: { input: 90, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } }),
      message("u1", "user"),
      message("a1", "assistant", { parentID: "u1", summary: true, finish: "stop" }),
      message("u2", "user"),
    ]
    expect(compactionBoundary(messages, parts(["u1"]))).toBe(1)
  })

  it("uses committed lifecycle state instead of a prematurely finished summary", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", { parentID: "u1", summary: true, finish: "stop" }),
    ]
    const failed = (id: string) => (id === "u1" ? [compact(id), tracked(id, "failed")] : [])
    const succeeded = (id: string) => (id === "u1" ? [compact(id), tracked(id, "succeeded")] : [])
    expect(compactionBoundary(messages, failed)).toBe(-1)
    expect(compactionBoundary(messages, succeeded)).toBe(0)
  })
})

describe("compactionStatus", () => {
  it("parses durable lifecycle metadata and rejects unrelated synthetic parts", () => {
    expect(compactionStatus([tracked("u1", "interrupted", false)])).toEqual({
      state: "interrupted",
      source: "manual",
      startedAt: 1_000,
      completedAt: 2_000,
      attempt: 1,
      attemptMode: "selected",
      phase: "preparing",
      completedUnits: undefined,
      totalUnits: undefined,
      reduceDepth: undefined,
      activity: undefined,
    })
    expect(compactionStatus([{ id: "other", type: "text", text: "", synthetic: true }])).toBeUndefined()
  })

  it("treats an old running marker in an idle session as failed without guessing success", () => {
    const value = compactionStatus([tracked("u1", "running")])!
    expect(compactionDisplayState(value, status("busy"), 20_000)).toBe("running")
    expect(compactionDisplayState(value, status("idle"), 10_999)).toBe("running")
    expect(compactionDisplayState(value, status("idle"), 11_000)).toBe("failed")
  })

  it("parses determinate progress and rejects impossible counts", () => {
    const value = tracked("u1", "running")
    const metadata = value.type === "text" ? value.metadata?.["chipmate.compaction"] : undefined
    expect(
      compactionStatus([
        {
          ...value,
          metadata: {
            "chipmate.compaction": {
              ...(metadata as Record<string, unknown>),
              attempt: 2,
              attemptMode: "none",
              phase: "reduce",
              completedUnits: 2,
              totalUnits: 5,
              reduceDepth: 1,
            },
          },
        },
      ]),
    ).toMatchObject({
      attempt: 2,
      attemptMode: "none",
      phase: "reduce",
      completedUnits: 2,
      totalUnits: 5,
      reduceDepth: 1,
    })
    expect(
      compactionStatus([
        {
          ...value,
          metadata: {
            "chipmate.compaction": {
              ...(metadata as Record<string, unknown>),
              completedUnits: 6,
              totalUnits: 5,
            },
          },
        },
      ]),
    ).toBeUndefined()
  })
})
