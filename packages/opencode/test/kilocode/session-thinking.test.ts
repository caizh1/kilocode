import { describe, expect, test } from "bun:test"
import type { LLMEvent } from "@opencode-ai/llm"
import { KiloSessionThinking } from "../../src/kilocode/session/thinking"

function delta(text: string): LLMEvent {
  return { type: "text-delta", id: "text", text, delta: text } as LLMEvent
}

function end(): LLMEvent {
  return { type: "text-end", id: "text", providerMetadata: undefined } as LLMEvent
}

function parts(events: LLMEvent[]) {
  return events.map((event) => {
    if (event.type === "text-delta") return { type: event.type, text: event.text }
    if (event.type === "reasoning-delta") return { type: event.type, text: event.text }
    return { type: event.type }
  })
}

describe("KiloSessionThinking", () => {
  test("moves closed think blocks out of visible text", () => {
    const out = KiloSessionThinking.events([delta("before<think>hidden</think>after")])

    expect(parts(out)).toEqual([
      { type: "text-delta", text: "before" },
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "hidden" },
      { type: "reasoning-end" },
      { type: "text-delta", text: "after" },
    ])
  })

  test("matches think tags case-insensitively", () => {
    const out = KiloSessionThinking.events([delta("a<THINK>\nstep 1\nstep 2\n</think>b")])

    expect(parts(out)).toEqual([
      { type: "text-delta", text: "a" },
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "\nstep 1\nstep 2\n" },
      { type: "reasoning-end" },
      { type: "text-delta", text: "b" },
    ])
  })

  test("keeps unfinished think blocks hidden until text end", () => {
    const out = KiloSessionThinking.events([delta("<think>checking local context"), end()])

    expect(parts(out)).toEqual([
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "checking local context" },
      { type: "reasoning-end" },
      { type: "text-end" },
    ])
  })

  test("handles open and close tags split across chunks", () => {
    const out = KiloSessionThinking.events([delta("before<thi"), delta("nk>hidden</thi"), delta("nk>after")])

    expect(parts(out)).toEqual([
      { type: "text-delta", text: "before" },
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "hidden" },
      { type: "reasoning-end" },
      { type: "text-delta", text: "after" },
    ])
  })

  test("supports multiple think blocks in one visible text stream", () => {
    const out = KiloSessionThinking.events([delta("a<think>x</think>b<think>y</think>c")])

    expect(parts(out)).toEqual([
      { type: "text-delta", text: "a" },
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "x" },
      { type: "reasoning-end" },
      { type: "text-delta", text: "b" },
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "y" },
      { type: "reasoning-end" },
      { type: "text-delta", text: "c" },
    ])
  })

  test("does not parse provider-native reasoning events", () => {
    const native = [
      { type: "reasoning-start", id: "reasoning", providerMetadata: undefined },
      { type: "reasoning-delta", id: "reasoning", text: "<think>native</think>", providerMetadata: undefined },
      { type: "reasoning-end", id: "reasoning", providerMetadata: undefined },
    ] as LLMEvent[]

    expect(KiloSessionThinking.events(native)).toEqual(native)
  })
})
