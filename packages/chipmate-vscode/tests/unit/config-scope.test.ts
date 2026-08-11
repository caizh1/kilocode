import { describe, expect, it } from "bun:test"
import { splitConfigByScope } from "../../webview-ui/src/utils/config-scope"

describe("splitConfigByScope", () => {
  it("writes indexing enablement to project config only", () => {
    const split = splitConfigByScope({
      indexing: {
        enabled: true,
        provider: "ollama",
      },
    })

    expect(split.global).toEqual({ indexing: { provider: "ollama" } })
    expect(split.project).toEqual({ indexing: { enabled: true } })
  })

  it("writes indexing provider settings to global config", () => {
    const split = splitConfigByScope({
      indexing: {
        provider: "ollama",
      },
    })

    expect(split.global).toEqual({ indexing: { provider: "ollama" } })
    expect(split.project).toEqual({})
  })

  it("splits project indexing enablement from global provider defaults", () => {
    const split = splitConfigByScope({
      indexing: {
        enabled: true,
        provider: "chipmate",
        model: "chipmate/bge-m3",
        dimension: null,
      },
    })

    expect(split.global).toEqual({ indexing: { provider: "chipmate", model: "chipmate/bge-m3", dimension: null } })
    expect(split.project).toEqual({ indexing: { enabled: true } })
  })

  it("writes document indexing settings to project config", () => {
    const split = splitConfigByScope({
      indexing: {
        provider: "openai-compatible",
        documents: {
          enabled: true,
          paths: ["docs"],
          include: ["**/*.pdf"],
          exclude: ["**/archive/**"],
          maxFileBytes: 52428800,
          chunkChars: 1200,
          chunkOverlapChars: 200,
          searchMaxResults: 8,
        },
      },
    })

    expect(split.global).toEqual({ indexing: { provider: "openai-compatible" } })
    expect(split.project).toEqual({
      indexing: {
        documents: {
          enabled: true,
          paths: ["docs"],
          include: ["**/*.pdf"],
          exclude: ["**/archive/**"],
          maxFileBytes: 52428800,
          chunkChars: 1200,
          chunkOverlapChars: 200,
          searchMaxResults: 8,
        },
      },
    })
  })

  it("writes indexing provider and model to global config", () => {
    const split = splitConfigByScope({
      indexing: {
        enabled: true,
        provider: "openai-compatible",
        model: "custom-embedding",
        dimension: 2048,
        vectorStore: "lancedb",
      },
    })

    expect(split.global).toEqual({
      indexing: {
        provider: "openai-compatible",
        model: "custom-embedding",
        dimension: 2048,
        vectorStore: "lancedb",
      },
    })
    expect(split.project).toEqual({ indexing: { enabled: true } })
  })

  it("can write indexing enablement to global config through a global draft", () => {
    const split = splitConfigByScope({ username: "marius" })
    const draft = { indexing: { enabled: true } }

    expect({ ...split.global, ...draft }).toEqual({ username: "marius", indexing: { enabled: true } })
    expect(split.project).toEqual({})
  })

  it("writes the speech-to-text model setting to global config", () => {
    const split = splitConfigByScope({
      experimental: {
        speech_to_text_model: "openai/gpt-4o-mini-transcribe",
      },
    })

    expect(split.global).toEqual({
      experimental: {
        speech_to_text_model: "openai/gpt-4o-mini-transcribe",
      },
    })
    expect(split.project).toEqual({})
  })
})
