import { describe, expect, it } from "bun:test"
import { sameReconcileShape } from "../../webview-ui/src/context/session-reconcile"
import type { Message, Part } from "../../webview-ui/src/types/messages"

function text(messageID: string): Part {
  return { id: `${messageID}-text`, messageID, type: "text", text: "已完成", time: { start: 1, end: 2 } }
}

function assistant(finish: string, completed: number, error?: Message["error"]): Message {
  const id = "assistant-1"
  return {
    id,
    sessionID: "session-1",
    role: "assistant",
    createdAt: "2026-07-31T00:00:00.000Z",
    parentID: "user-1",
    time: { created: 1_000, completed },
    finish,
    error,
    parts: [text(id)],
  }
}

describe("sameReconcileShape", () => {
  it("reconciles a missed terminal update even when the streamed parts already match", () => {
    const current = [assistant("tool-calls", 12_000)]
    const incoming = [assistant("stop", 61_000)]

    expect(sameReconcileShape(current, incoming, (message) => message.parts)).toBe(false)
  })

  it("reconciles an error update even when the streamed parts already match", () => {
    const current = [assistant("stop", 61_000)]
    const incoming = [assistant("stop", 61_000, { name: "UnknownError" })]

    expect(sameReconcileShape(current, incoming, (message) => message.parts)).toBe(false)
  })

  it("keeps the fast path when messages and hydrated parts are unchanged", () => {
    const current = [assistant("stop", 61_000)]
    const incoming = [assistant("stop", 61_000)]

    expect(sameReconcileShape(current, incoming, (message) => message.parts)).toBe(true)
  })
})
