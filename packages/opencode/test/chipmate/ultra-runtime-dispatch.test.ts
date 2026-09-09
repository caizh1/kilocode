import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { jsonSchema, tool } from "ai"
import { Effect, Stream } from "effect"
import { runtimeToolStream } from "@/session/llm"

describe("Ultra local runtime dispatch", () => {
  test("executes exactly once and persists the canonical tool lifecycle", async () => {
    let calls = 0
    const events = await Effect.runPromise(
      Stream.runCollect(
        runtimeToolStream({
          call: { id: "call_ultra_verify_test", name: "ultra_verify", input: {} },
          tools: {
            ultra_verify: tool({
              description: "test",
              inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
              execute: async () => {
                calls++
                return {
                  title: "Ultra verification complete",
                  metadata: { ultraVerify: { phase: "complete" } },
                  output: "ULTRA_VERIFY_RESULT",
                }
              },
            }),
          },
          messages: [],
          abort: new AbortController().signal,
        }),
      ),
    )

    expect(calls).toBe(1)
    expect(Array.from(events).map((event) => event.type)).toEqual([
      "step-start",
      "tool-call",
      "tool-result",
      "step-finish",
      "finish",
    ])
    expect(Array.from(events).find((event) => event.type === "tool-result")).toMatchObject({
      result: { value: { output: "ULTRA_VERIFY_RESULT" } },
    })
    expect(Array.from(events).at(-1)).toMatchObject({ type: "finish", reason: "tool-calls" })
  })

  test("unknown tools fail locally without a provider fallback", async () => {
    const events = await Effect.runPromise(
      Stream.runCollect(
        runtimeToolStream({
          call: { id: "call_unknown", name: "unknown", input: {} },
          tools: {},
          messages: [],
          abort: new AbortController().signal,
        }),
      ),
    )
    expect(Array.from(events).map((event) => event.type)).toEqual([
      "step-start",
      "tool-call",
      "tool-error",
      "tool-result",
      "step-finish",
      "finish",
    ])
    expect(Array.from(events).at(-1)).toMatchObject({ type: "finish", reason: "stop" })
  })

  test("the local branch precedes provider, DSML, and export setup", async () => {
    const source = await fs.readFile(path.join(import.meta.dir, "../../src/session/llm.ts"), "utf8")
    const dispatch = source.indexOf("if (input.runtimeToolCall)")
    expect(dispatch).toBeGreaterThan(-1)
    expect(dispatch).toBeLessThan(source.indexOf("provider.getLanguage(input.model)"))
    expect(dispatch).toBeLessThan(source.indexOf("DSML.enabled"))
    expect(dispatch).toBeLessThan(source.indexOf("SessionExport.beforeRequest"))
  })
})
