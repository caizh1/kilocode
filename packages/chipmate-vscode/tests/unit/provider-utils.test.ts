import { describe, it, expect } from "bun:test"
import { flattenModels, findModel, isModelValid } from "../../webview-ui/src/context/provider-utils"
import type { Provider } from "../../webview-ui/src/types/messages"

function makeProvider(id: string, name: string, modelIds: string[]): Provider {
  const models: Provider["models"] = {}
  for (const mid of modelIds) {
    models[mid] = { id: mid, name: mid.toUpperCase() }
  }
  return { id, name, models }
}

describe("flattenModels", () => {
  it("returns empty array for empty providers", () => {
    expect(flattenModels({})).toEqual([])
  })

  it("enriches each model with providerID and providerName", () => {
    const providers = { openai: makeProvider("openai", "OpenAI", ["gpt-4"]) }
    const models = flattenModels(providers)
    expect(models).toHaveLength(1)
    expect(models[0]!.providerID).toBe("openai")
    expect(models[0]!.providerName).toBe("OpenAI")
    expect(models[0]!.id).toBe("gpt-4")
  })

  it("flattens multiple providers", () => {
    const providers = {
      openai: makeProvider("openai", "OpenAI", ["gpt-4", "gpt-3.5"]),
      anthropic: makeProvider("anthropic", "Anthropic", ["claude-3"]),
    }
    const models = flattenModels(providers)
    expect(models).toHaveLength(3)
    const ids = models.map((m) => m.id)
    expect(ids).toContain("gpt-4")
    expect(ids).toContain("gpt-3.5")
    expect(ids).toContain("claude-3")
  })

  it("handles provider with no models", () => {
    const providers = { empty: makeProvider("empty", "Empty", []) }
    expect(flattenModels(providers)).toEqual([])
  })

  it("maps the ChipMate Auto Free catalog name to ChipMate without changing its id", () => {
    const providers = { chipmate: makeProvider("chipmate", "ChipMate Gateway", ["chipmate-auto/free"]) }
    const model = flattenModels(providers)[0]
    expect(model?.id).toBe("chipmate-auto/free")
    expect(model?.name).toBe("ChipMate Auto Free")
    expect(model?.providerName).toBe("ChipMate Gateway")
  })

  it("filters prohibited models only from the internal catalog", () => {
    const providers = {
      internal: makeProvider("internal", "Internal", [
        "qwen3.8-27b",
        "glm-5.2",
        "zai-org-glm-5-2",
        "doubao-seed-2.0-pro",
      ]),
    }
    expect(flattenModels(providers, true).map((model) => model.id)).toEqual(["qwen3.8-27b"])
    expect(flattenModels(providers, false)).toHaveLength(4)
  })

  it("filters prohibited models identified by display name or provider name", () => {
    const named = makeProvider("internal", "Internal", ["endpoint", "allowed"])
    named.models.endpoint!.name = "GLM 5.2"
    const doubao = makeProvider("opaque", "Doubao", ["ep-20260828"])
    expect(flattenModels({ internal: named, opaque: doubao }, true).map((model) => model.id)).toEqual(["allowed"])
  })
})

describe("findModel", () => {
  const providers = {
    openai: makeProvider("openai", "OpenAI", ["gpt-4", "gpt-3.5"]),
    anthropic: makeProvider("anthropic", "Anthropic", ["claude-3"]),
  }
  const models = flattenModels(providers)

  it("returns undefined for null selection", () => {
    expect(findModel(models, null)).toBeUndefined()
  })

  it("finds model by providerID and modelID", () => {
    const result = findModel(models, { providerID: "openai", modelID: "gpt-4" })
    expect(result).not.toBeUndefined()
    expect(result?.id).toBe("gpt-4")
    expect(result?.providerID).toBe("openai")
  })

  it("returns undefined when providerID does not match", () => {
    expect(findModel(models, { providerID: "unknown", modelID: "gpt-4" })).toBeUndefined()
  })

  it("returns undefined when modelID does not match", () => {
    expect(findModel(models, { providerID: "openai", modelID: "unknown-model" })).toBeUndefined()
  })

  it("finds model from second provider", () => {
    const result = findModel(models, { providerID: "anthropic", modelID: "claude-3" })
    expect(result?.providerName).toBe("Anthropic")
  })

  it("returns undefined for empty model list", () => {
    expect(findModel([], { providerID: "openai", modelID: "gpt-4" })).toBeUndefined()
  })
})

describe("isModelValid", () => {
  const providers = {
    chipmate: makeProvider("chipmate", "ChipMate Gateway", ["chipmate-auto/free"]),
    openai: makeProvider("openai", "OpenAI", ["gpt-4o"]),
  }

  it("accepts a connected provider model", () => {
    expect(isModelValid(providers, ["openai"], { providerID: "openai", modelID: "gpt-4o" })).toBe(true)
  })

  it("rejects a disconnected non-chipmate provider", () => {
    expect(isModelValid(providers, [], { providerID: "openai", modelID: "gpt-4o" })).toBe(false)
  })

  it("accepts chipmate models when present in the catalog", () => {
    expect(isModelValid(providers, [], { providerID: "chipmate", modelID: "chipmate-auto/free" })).toBe(true)
  })

  it("rejects unknown models", () => {
    expect(isModelValid(providers, ["openai"], { providerID: "openai", modelID: "missing" })).toBe(false)
  })

  it("rejects prohibited internal models without affecting normal builds", () => {
    const internal = makeProvider("internal", "Internal", ["glm-5.2", "doubao-seed-2.0-pro", "qwen3.8-27b"])
    const catalog = { internal }
    expect(isModelValid(catalog, ["internal"], { providerID: "internal", modelID: "glm-5.2" }, true)).toBe(false)
    expect(
      isModelValid(catalog, ["internal"], { providerID: "internal", modelID: "doubao-seed-2.0-pro" }, true),
    ).toBe(false)
    expect(isModelValid(catalog, ["internal"], { providerID: "internal", modelID: "qwen3.8-27b" }, true)).toBe(
      true,
    )
    expect(isModelValid(catalog, ["internal"], { providerID: "internal", modelID: "glm-5.2" }, false)).toBe(true)
  })

  it("rejects a prohibited model identified only after provider metadata loads", () => {
    const internal = makeProvider("internal", "Internal", ["endpoint"])
    internal.models.endpoint!.name = "Doubao Seed 2.0 Pro"
    expect(isModelValid({ internal }, ["internal"], { providerID: "internal", modelID: "endpoint" }, true)).toBe(
      false,
    )
  })
})
