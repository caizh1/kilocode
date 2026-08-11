import { afterEach, describe, expect, it } from "bun:test"

import { applyInternalIndexingDefaults } from "../../src/chipmate/internal-offline"

describe("applyInternalIndexingDefaults", () => {
  const originalBaseUrl = process.env.CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL
    } else {
      process.env.CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL = originalBaseUrl
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
      dimensionMode: "auto",
      vectorStore: "lancedb",
    })
  })

  it("migrates the previous qwen3 internal dimension to auto mode", () => {
    expect(
      applyInternalIndexingDefaults(
        {
          provider: "openai-compatible",
          model: "qwen3-embedding-8b",
          dimension: 2048,
        },
        true,
      ),
    ).toMatchObject({
      model: "qwen3-embedding-8b",
      dimensionMode: "auto",
    })
    expect(
      applyInternalIndexingDefaults(
        { provider: "openai-compatible", model: "qwen3-embedding-8b", dimension: 2048 },
        true,
      ),
    ).not.toHaveProperty("dimension")
  })

  it("preserves 2048 for a custom OpenAI-compatible model", () => {
    expect(
      applyInternalIndexingDefaults(
        {
          provider: "openai-compatible",
          model: "custom-embedding",
          dimension: 2048,
        },
        true,
      ),
    ).toMatchObject({
      model: "custom-embedding",
      dimension: 2048,
      dimensionMode: "fixed",
    })
  })

  it("does not apply the qwen dimension to a custom OpenAI-compatible model", () => {
    expect(
      applyInternalIndexingDefaults(
        {
          provider: "openai-compatible",
          model: "bge-m3",
        },
        true,
      ),
    ).not.toHaveProperty("dimension")
  })

  it("migrates an unmarked old internal 4096 dimension to auto mode", () => {
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
      dimensionMode: "auto",
      vectorStore: "lancedb",
    })
  })

  it("preserves an explicitly fixed qwen3 dimension", () => {
    expect(
      applyInternalIndexingDefaults(
        {
          provider: "openai-compatible",
          model: "qwen3-embedding-8b",
          dimension: 1024,
          dimensionMode: "fixed",
        },
        true,
      ),
    ).toMatchObject({
      dimension: 1024,
      dimensionMode: "fixed",
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
      dimensionMode: "auto",
      vectorStore: "lancedb",
    })
  })

  it("normalizes an explicit empty document path list to the workspace root", () => {
    expect(applyInternalIndexingDefaults({ documents: { paths: [] } }, true)).toEqual({
      enabled: true,
      documents: { enabled: true, paths: ["."] },
      provider: "openai-compatible",
      model: "qwen3-embedding-8b",
      dimensionMode: "auto",
      vectorStore: "lancedb",
    })
  })

  it("injects only the internal openai-compatible baseUrl when provided by runtime env", () => {
    process.env.CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL = "https://example.test/v1/embeddings"

    expect(applyInternalIndexingDefaults({}, true)).toEqual({
      enabled: true,
      documents: { enabled: true, paths: ["."] },
      provider: "openai-compatible",
      model: "qwen3-embedding-8b",
      dimensionMode: "auto",
      vectorStore: "lancedb",
      "openai-compatible": {
        baseUrl: "https://example.test/v1/embeddings",
      },
    })
  })

  it("preserves user apiKey and does not default one", () => {
    process.env.CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL = "https://example.test/v1/embeddings"

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
      dimensionMode: "auto",
      vectorStore: "lancedb",
      "openai-compatible": {
        baseUrl: "https://example.test/v1/embeddings",
        apiKey: "user-key",
      },
    })
  })
})
