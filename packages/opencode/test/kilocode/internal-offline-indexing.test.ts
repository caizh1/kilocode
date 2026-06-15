import { describe, expect, it } from "bun:test"

import { applyInternalIndexingDefaults } from "../../src/kilocode/internal-offline"

describe("applyInternalIndexingDefaults", () => {
  it("keeps public indexing config unchanged", () => {
    expect(applyInternalIndexingDefaults(undefined, false)).toBeUndefined()
    expect(applyInternalIndexingDefaults({}, false)).toEqual({})
  })

  it("defaults internal indexing to qwen3 embedding over openai-compatible", () => {
    expect(applyInternalIndexingDefaults({}, true)).toEqual({
      provider: "openai-compatible",
      model: "qwen3-embedding-8b",
      dimension: 2048,
      vectorStore: "lancedb",
    })
  })

  it("keeps explicit internal dimension and model", () => {
    expect(
      applyInternalIndexingDefaults(
        {
          provider: "openai-compatible",
          model: "qwen3-embedding-8b",
          dimension: 4096,
          vectorStore: "lancedb",
        },
        true,
      ),
    ).toEqual({
      provider: "openai-compatible",
      model: "qwen3-embedding-8b",
      dimension: 4096,
      vectorStore: "lancedb",
    })
  })

  it("does not override other explicit providers", () => {
    expect(applyInternalIndexingDefaults({ provider: "ollama" }, true)).toEqual({ provider: "ollama" })
  })
})
