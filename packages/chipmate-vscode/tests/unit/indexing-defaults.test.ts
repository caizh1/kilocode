import { describe, expect, it } from "bun:test"

import {
  applyInternalIndexingDefaults,
  materializeInternalIndexingDefaultsForSave,
  mergeIndexingConfigForDisplay,
} from "../../webview-ui/src/utils/indexing-defaults"

describe("applyInternalIndexingDefaults", () => {
  it("keeps public builds unchanged", () => {
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

  it("does not override explicit internal model and dimension", () => {
    expect(
      applyInternalIndexingDefaults(
        {
          provider: "openai-compatible",
          model: "custom-embedding",
          dimension: 3072,
          vectorStore: "qdrant",
        },
        true,
      ),
    ).toEqual({
      enabled: true,
      documents: { enabled: true, paths: ["."] },
      provider: "openai-compatible",
      model: "custom-embedding",
      dimension: 3072,
      dimensionMode: "fixed",
      vectorStore: "qdrant",
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

  it("does not force qwen defaults onto other explicit providers", () => {
    expect(applyInternalIndexingDefaults({ provider: "openai" }, true)).toEqual({
      enabled: true,
      documents: { enabled: true, paths: ["."] },
      provider: "openai",
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

  it("preserves explicit openai-compatible provider options while applying internal defaults", () => {
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
        apiKey: "user-key",
      },
    })
  })

  it("materializes internal defaults when saving a custom model over inferred defaults", () => {
    expect(materializeInternalIndexingDefaultsForSave({}, { model: "custom-embedding" }, true)).toEqual({
      provider: "openai-compatible",
      model: "custom-embedding",
      dimensionMode: "auto",
      vectorStore: "lancedb",
    })
  })

  it("persists blank and numeric dimensions with explicit auto and fixed modes", () => {
    expect(
      materializeInternalIndexingDefaultsForSave(
        {},
        { dimension: null, dimensionMode: "auto" },
        true,
      ),
    ).toMatchObject({
      dimension: null,
      dimensionMode: "auto",
    })
    expect(
      materializeInternalIndexingDefaultsForSave(
        {},
        { dimension: 1024, dimensionMode: "fixed" },
        true,
      ),
    ).toMatchObject({
      dimension: 1024,
      dimensionMode: "fixed",
    })
  })

  it("keeps an explicit empty model as a default-model delete sentinel", () => {
    expect(materializeInternalIndexingDefaultsForSave({}, { model: null }, true)).toEqual({
      provider: "openai-compatible",
      model: null,
      dimensionMode: "auto",
      vectorStore: "lancedb",
    })
  })

  it("does not materialize internal defaults for project-only indexing changes", () => {
    expect(materializeInternalIndexingDefaultsForSave({}, { enabled: true }, true)).toEqual({ enabled: true })
  })

  it("uses global provider settings and project enablement as the display config", () => {
    expect(
      mergeIndexingConfigForDisplay(
        { provider: "openai-compatible", model: "custom-embedding", dimension: 1024 },
        { enabled: true },
      ),
    ).toEqual({
      provider: "openai-compatible",
      model: "custom-embedding",
      dimension: 1024,
      enabled: true,
    })
  })

  it("preserves an existing custom model when materializing another indexing field", () => {
    expect(
      materializeInternalIndexingDefaultsForSave(
        { provider: "openai-compatible", model: "custom-embedding", dimension: 1024 },
        { vectorStore: "qdrant" },
        true,
      ),
    ).toEqual({
      provider: "openai-compatible",
      model: "custom-embedding",
      dimension: 1024,
      dimensionMode: "fixed",
      vectorStore: "qdrant",
    })
  })

  it("preserves provider options when materializing another indexing field", () => {
    expect(
      materializeInternalIndexingDefaultsForSave(
        {
          provider: "openai-compatible",
          "openai-compatible": {
            apiKey: "user-key",
          },
        },
        { model: "custom-embedding" },
        true,
      ),
    ).toEqual({
      provider: "openai-compatible",
      model: "custom-embedding",
      dimensionMode: "auto",
      vectorStore: "lancedb",
      "openai-compatible": {
        apiKey: "user-key",
      },
    })
  })
})
