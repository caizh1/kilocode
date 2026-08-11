import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLMAISDK } from "@/session/llm/ai-sdk"
import { ChipMateResponseMetadata } from "@/chipmate/session/response-metadata"

describe("session response metadata", () => {
  test("carries x-vercel-id from an AI SDK response", async () => {
    const events = await Effect.runPromise(
      LLMAISDK.toLLMEvents(LLMAISDK.adapterState(), {
        type: "finish-step",
        response: {
          id: "response-1",
          timestamp: new Date(0),
          modelId: "gpt-test",
          headers: { "X-Vercel-Id": "fra1::abc" },
        },
        finishReason: "other",
        rawFinishReason: undefined,
        providerMetadata: undefined,
        usage: {
          inputTokens: 1,
          outputTokens: 0,
          totalTokens: 1,
          inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
        },
      }),
    )

    expect(events).toHaveLength(1)
    const event = events[0]
    if (event?.type !== "step-finish") throw new Error("expected step-finish")
    expect(ChipMateResponseMetadata.read(event.providerMetadata)).toBe("fra1::abc")
  })

  test("does not add metadata when the header is absent", () => {
    expect(ChipMateResponseMetadata.write(undefined, { server: "vercel" })).toBeUndefined()
  })

  test("normalizes valid Vercel IDs", () => {
    const metadata = ChipMateResponseMetadata.write(undefined, { "x-vercel-id": "  fra1::abc-123_test  " })
    expect(ChipMateResponseMetadata.read(metadata)).toBe("fra1::abc-123_test")
  })

  test("rejects unsafe or oversized Vercel IDs", () => {
    expect(ChipMateResponseMetadata.write(undefined, { "x-vercel-id": "fra1::<script>" })).toBeUndefined()
    expect(ChipMateResponseMetadata.write(undefined, { "x-vercel-id": "x".repeat(201) })).toBeUndefined()
    expect(ChipMateResponseMetadata.read({ chipmate: { vercelID: "fra1::abc\nsecret" } })).toBeUndefined()
  })
})
