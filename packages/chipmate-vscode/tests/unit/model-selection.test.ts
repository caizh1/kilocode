import { describe, expect, it } from "bun:test"
import { resolveModelSelection } from "../../webview-ui/src/context/model-selection"
import { modelSelection, parseModelString } from "../../src/shared/provider-model"
import type { Provider } from "../../webview-ui/src/types/messages"

function makeProvider(id: string, name: string, modelIds: string[]): Provider {
  const models: Provider["models"] = {}
  for (const modelID of modelIds) {
    models[modelID] = { id: modelID, name: modelID }
  }
  return { id, name, models }
}

const providers = {
  chipmate: makeProvider("chipmate", "ChipMate Gateway", ["chipmate-auto/free"]),
  anthropic: makeProvider("anthropic", "Anthropic", ["claude-sonnet-4"]),
  openai: makeProvider("openai", "OpenAI", ["gpt-4.1"]),
}

describe("parseModelString", () => {
  it("parses provider/model pairs", () => {
    expect(parseModelString("anthropic/claude-sonnet-4")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("keeps slashes inside chipmate model ids", () => {
    expect(parseModelString("chipmate/chipmate-auto/free")).toEqual({
      providerID: "chipmate",
      modelID: "chipmate-auto/free",
    })
  })

  it("returns null for invalid values", () => {
    expect(parseModelString(undefined)).toBeNull()
    expect(parseModelString("claude-sonnet-4")).toBeNull()
  })
})

describe("modelSelection", () => {
  it("requires both provider and model ids", () => {
    expect(modelSelection("openai", "gpt-4.1")).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
    expect(modelSelection("openai", undefined)).toBeNull()
    expect(modelSelection(undefined, "gpt-4.1")).toBeNull()
  })
})

describe("resolveModelSelection", () => {
  it("prefers a valid override", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["anthropic", "openai"],
      override: { providerID: "openai", modelID: "gpt-4.1" },
      mode: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      fallback: null,
    })
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })

  it("falls back from an invalid override to the mode model", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["anthropic"],
      override: { providerID: "openai", modelID: "gpt-4.1" },
      mode: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      fallback: null,
    })
    expect(result).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
  })

  it("falls back from invalid config to the first valid recent model", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["openai"],
      mode: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      recent: [
        { providerID: "anthropic", modelID: "claude-sonnet-4" },
        { providerID: "openai", modelID: "gpt-4.1" },
      ],
      fallback: null,
    })
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })

  it("returns null when no valid preference exists", () => {
    const result = resolveModelSelection({
      providers,
      connected: [],
      fallback: null,
    })
    expect(result).toBeNull()
  })

  it("returns null when no preference exists and chipmate is missing", () => {
    const result = resolveModelSelection({
      providers: { openai: providers.openai },
      connected: [],
      fallback: null,
    })
    expect(result).toBeNull()
  })

  it("keeps the raw preference order before providers load", () => {
    const result = resolveModelSelection({
      providers: {},
      connected: [],
      override: { providerID: "openai", modelID: "gpt-4.1" },
      mode: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      fallback: null,
    })
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })

  it("prefers an explicit global model over recent models", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["anthropic", "openai"],
      global: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      recent: [{ providerID: "openai", modelID: "gpt-4.1" }],
      fallback: null,
    })
    expect(result).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
  })

  it("falls back from a prohibited internal override to an allowed mode model", () => {
    const internal = makeProvider("internal", "Internal", ["glm-5.2", "qwen3.8-27b"])
    const result = resolveModelSelection({
      providers: { internal },
      connected: ["internal"],
      override: { providerID: "internal", modelID: "glm-5.2" },
      mode: { providerID: "internal", modelID: "qwen3.8-27b" },
      fallback: null,
      internal: true,
    })
    expect(result).toEqual({ providerID: "internal", modelID: "qwen3.8-27b" })
  })

  it("skips prohibited global and recent selections", () => {
    const internal = makeProvider("internal", "Internal", ["doubao-seed-2.0-pro", "deepseek-v4-flash"])
    const result = resolveModelSelection({
      providers: { internal },
      connected: ["internal"],
      global: { providerID: "internal", modelID: "doubao-seed-2.0-pro" },
      recent: [
        { providerID: "internal", modelID: "glm-5.2" },
        { providerID: "internal", modelID: "deepseek-v4-flash" },
      ],
      fallback: null,
      internal: true,
    })
    expect(result).toEqual({ providerID: "internal", modelID: "deepseek-v4-flash" })
  })

  it("returns null when every internal candidate is prohibited", () => {
    const internal = makeProvider("internal", "Internal", ["glm-5.2", "doubao-seed-2.0-pro"])
    const result = resolveModelSelection({
      providers: { internal },
      connected: ["internal"],
      global: { providerID: "internal", modelID: "glm-5.2" },
      recent: [{ providerID: "internal", modelID: "doubao-seed-2.0-pro" }],
      fallback: { providerID: "internal", modelID: "glm-5.2" },
      internal: true,
    })
    expect(result).toBeNull()
  })

  it("does not restore an explicit prohibited id before providers load", () => {
    const result = resolveModelSelection({
      providers: {},
      connected: [],
      override: { providerID: "internal", modelID: "glm-5.2" },
      fallback: null,
      internal: true,
    })
    expect(result).toBeNull()
  })

  it("falls back after provider metadata identifies an opaque endpoint as Doubao", () => {
    const internal = makeProvider("internal", "Internal", ["endpoint", "qwen3.8-27b"])
    internal.models.endpoint!.name = "Doubao Seed 2.0 Pro"
    const result = resolveModelSelection({
      providers: { internal },
      connected: ["internal"],
      override: { providerID: "internal", modelID: "endpoint" },
      global: { providerID: "internal", modelID: "qwen3.8-27b" },
      fallback: null,
      internal: true,
    })
    expect(result).toEqual({ providerID: "internal", modelID: "qwen3.8-27b" })
  })
})
