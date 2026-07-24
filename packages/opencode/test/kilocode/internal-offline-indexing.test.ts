import { afterEach, describe, expect, it } from "bun:test"

import { applyInternalIndexingDefaults } from "../../src/kilocode/internal-offline"

describe("applyInternalIndexingDefaults", () => {
  const originalBaseUrl = process.env.KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL
    } else {
      process.env.KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL = originalBaseUrl
    }
  })

  it("keeps public indexing config unchanged", () => {
    expect(applyInternalIndexingDefaults(undefined, false)).toBeUndefined()
    expect(applyInternalIndexingDefaults({}, false)).toEqual({})
  })

  it("defaults internal indexing to qwen3 embedding over openai-compatible", () => {
    expect(applyInternalIndexingDefaults({}, true)).toEqual({
      enabled: true,
      documents: { enabled: true, paths: ["."] },
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
      enabled: true,
      documents: { enabled: true, paths: ["."] },
      provider: "openai-compatible",
      model: "qwen3-embedding-8b",
      dimension: 4096,
      vectorStore: "lancedb",
    })
  })

  it("does not override other explicit providers", () => {
    expect(applyInternalIndexingDefaults({ provider: "ollama" }, true)).toEqual({
      enabled: true,
      documents: { enabled: true, paths: ["."] },
      provider: "ollama",
    })
  })

  it("preserves explicit internal RAG opt-outs and adds the workspace root to document paths", () => {
    expect(
      applyInternalIndexingDefaults({ enabled: false, documents: { enabled: false, paths: ["manuals"] } }, true),
    ).toEqual({
      enabled: false,
      documents: { enabled: false, paths: [".", "manuals"] },
      provider: "openai-compatible",
      model: "qwen3-embedding-8b",
      dimension: 2048,
      vectorStore: "lancedb",
    })
  })

  it("normalizes an explicit empty document path list to the workspace root", () => {
    expect(applyInternalIndexingDefaults({ documents: { paths: [] } }, true)).toEqual({
      enabled: true,
      documents: { enabled: true, paths: ["."] },
      provider: "openai-compatible",
      model: "qwen3-embedding-8b",
      dimension: 2048,
      vectorStore: "lancedb",
    })
  })

  it("injects only the internal openai-compatible baseUrl when provided by runtime env", () => {
    process.env.KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL = "https://example.test/v1/embeddings"

    expect(applyInternalIndexingDefaults({}, true)).toEqual({
      enabled: true,
      documents: { enabled: true, paths: ["."] },
      provider: "openai-compatible",
      model: "qwen3-embedding-8b",
      dimension: 2048,
      vectorStore: "lancedb",
      "openai-compatible": {
        baseUrl: "https://example.test/v1/embeddings",
      },
    })
  })

  it("preserves user apiKey and does not default one", () => {
    process.env.KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL = "https://example.test/v1/embeddings"

    expect(
      applyInternalIndexingDefaults(
        {
          "openai-compatible": {
            apiKey: "user-key",
          },
        },
        true,
      ),
    ).toEqual({
      enabled: true,
      documents: { enabled: true, paths: ["."] },
      provider: "openai-compatible",
      model: "qwen3-embedding-8b",
      dimension: 2048,
      vectorStore: "lancedb",
      "openai-compatible": {
        baseUrl: "https://example.test/v1/embeddings",
        apiKey: "user-key",
      },
    })
  })
})
