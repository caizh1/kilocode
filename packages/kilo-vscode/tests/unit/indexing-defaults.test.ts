import { describe, expect, it } from "bun:test"

import { applyInternalIndexingDefaults } from "../../webview-ui/src/utils/indexing-defaults"

describe("applyInternalIndexingDefaults", () => {
  it("keeps public builds unchanged", () => {
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

  it("does not override explicit internal model and dimension", () => {
    expect(
      applyInternalIndexingDefaults(
        {
          provider: "openai-compatible",
          model: "custom-embedding",
          dimension: 4096,
          vectorStore: "qdrant",
        },
        true,
      ),
    ).toEqual({
      provider: "openai-compatible",
      model: "custom-embedding",
      dimension: 4096,
      vectorStore: "qdrant",
    })
  })

  it("does not force qwen defaults onto other explicit providers", () => {
    expect(applyInternalIndexingDefaults({ provider: "openai" }, true)).toEqual({ provider: "openai" })
  })
})
