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
  kilo: makeProvider("kilo", "Kilo Gateway", ["kilo-auto/free"]),
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

  it("keeps slashes inside kilo model ids", () => {
    expect(parseModelString("kilo/kilo-auto/free")).toEqual({
      providerID: "kilo",
      modelID: "kilo-auto/free",
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

  it("returns null when no preference exists and kilo is missing", () => {
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
})
