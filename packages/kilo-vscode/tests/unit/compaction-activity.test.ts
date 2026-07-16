import { describe, expect, it } from "bun:test"
import { compactionActive, compactionBoundary } from "../../webview-ui/src/context/compaction-activity"
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
})
