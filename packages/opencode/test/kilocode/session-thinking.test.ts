import { describe, expect, test } from "bun:test"
import { LLMEvent, type LLMEvent as Event } from "@opencode-ai/llm"
import { KiloSessionThinking } from "../../src/kilocode/session/thinking"

const model = {
  api: {
    id: "deepseek-v4-flash",
    npm: "@ai-sdk/openai-compatible",
  },
  capabilities: {
    reasoning: true,
  },
}

function start(): Event {
  return LLMEvent.textStart({ id: "text" })
}

function delta(text: string): Event {
  return LLMEvent.textDelta({ id: "text", text })
}

function end(): Event {
  return LLMEvent.textEnd({ id: "text" })
}

function parts(events: Event[]) {
  return events.map((event) => {
    if (event.type === "text-delta" || event.type === "reasoning-delta") {
      return { type: event.type, text: event.text }
    }
    return { type: event.type }
  })
}

describe("KiloSessionThinking", () => {
  test("moves a leading think block before the visible answer", () => {
    const out = KiloSessionThinking.events(
      [
        LLMEvent.stepStart({ index: 0 }),
        start(),
        delta("<think>checking</think>323"),
        end(),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
      ],
      model,
    )

    expect(parts(out)).toEqual([
      { type: "step-start" },
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "checking" },
      { type: "reasoning-end" },
      { type: "text-start" },
      { type: "text-delta", text: "323" },
      { type: "text-end" },
      { type: "step-finish" },
    ])
  })

  test("handles whitespace, case-insensitive tags, and tags split across chunks", () => {
    const out = KiloSessionThinking.events(
      [start(), delta(" \n<THI"), delta("NK>\nchecking</TH"), delta("INK>\nanswer"), end()],
      model,
    )

    expect(parts(out)).toEqual([
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "\nchecking" },
      { type: "reasoning-end" },
      { type: "text-start" },
      { type: "text-delta", text: "answer" },
      { type: "text-end" },
    ])
  })

  test("closes an unfinished think block at text end", () => {
    const out = KiloSessionThinking.events([start(), delta("<think>checking local context"), end()], model)

    expect(parts(out)).toEqual([
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "checking local context" },
      { type: "reasoning-end" },
    ])
  })

  test("closes an unfinished think block at a terminal stream event", () => {
    const out = KiloSessionThinking.events(
      [start(), delta("<think>checking"), LLMEvent.stepFinish({ index: 0, reason: "stop" })],
      model,
    )

    expect(parts(out)).toEqual([
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "checking" },
      { type: "reasoning-end" },
      { type: "step-finish" },
    ])
  })

  test("leaves ordinary text and inline think examples unchanged", () => {
    const input = [
      start(),
      delta("Before <think>this is a literal example</think> after"),
      end(),
    ] satisfies Event[]

    expect(KiloSessionThinking.events(input, model)).toEqual(input)
  })

  test("leaves a fenced code example unchanged", () => {
    const input = [start(), delta("```xml\n<think>example</think>\n```"), end()] satisfies Event[]

    expect(KiloSessionThinking.events(input, model)).toEqual(input)
  })

  test("passes provider-native reasoning through and disables tag fallback for the step", () => {
    const input = [
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.reasoningStart({ id: "native", providerMetadata: { openaiCompatible: { source: "native" } } }),
      LLMEvent.reasoningDelta({
        id: "native",
        text: "structured reasoning",
        providerMetadata: { openaiCompatible: { chunk: 1 } },
      }),
      LLMEvent.reasoningEnd({ id: "native", providerMetadata: { openaiCompatible: { done: true } } }),
      start(),
      delta("<think>literal answer content</think>"),
      end(),
    ] satisfies Event[]

    expect(KiloSessionThinking.events(input, model)).toEqual(input)
  })

  test("does not run for other models, providers, or non-reasoning models", () => {
    const input = [start(), delta("<think>checking</think>answer"), end()] satisfies Event[]
    const cases = [
      { ...model, api: { ...model.api, id: "deepseek-v3" } },
      { ...model, api: { ...model.api, npm: "@ai-sdk/openai" } },
      { ...model, capabilities: { reasoning: false } },
    ]

    for (const candidate of cases) {
      expect(KiloSessionThinking.events(input, candidate)).toBe(input)
    }
  })

  test("resets fallback state for a new model step", () => {
    const out = KiloSessionThinking.events(
      [
        LLMEvent.stepStart({ index: 0 }),
        start(),
        delta("<think>first</think>answer one"),
        end(),
        LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
        LLMEvent.stepStart({ index: 1 }),
        LLMEvent.textStart({ id: "text-2" }),
        LLMEvent.textDelta({ id: "text-2", text: "<think>second</think>answer two" }),
        LLMEvent.textEnd({ id: "text-2" }),
      ],
      model,
    )

    expect(out.filter((event) => event.type === "reasoning-start")).toHaveLength(2)
    expect(
      out.filter((event) => event.type === "text-delta").map((event) => (event.type === "text-delta" ? event.text : "")),
    ).toEqual(["answer one", "answer two"])
  })
})
