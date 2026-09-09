import { describe, expect, it } from "bun:test"
import {
  createAutocompleteModel,
  createReasoningModel,
  hasExtendedModelConfiguration,
  mergeDiscoveredModels,
  resolveQuickModels,
  validateCustomProvider,
} from "../../webview-ui/src/components/settings/CustomProviderValidation"
import type { FormState } from "../../webview-ui/src/components/settings/CustomProviderValidation"

// Simple translator that returns the key so tests can assert on key names
const t = (key: string) => key

function base(): FormState {
  return {
    providerID: "my-provider",
    name: "My Provider",
    npm: "@ai-sdk/openai-compatible",
    baseURL: "https://example.com/v1",
    apiKey: "",
    models: [
      { id: "model-1", name: "Model One", reasoning: false, supportsImages: false, modalities: {}, variants: [] },
    ],
    headers: [],
    saving: false,
  }
}

function args(form: FormState) {
  return {
    form,
    t,
    editing: false,
    disabledProviders: [],
    existingProviderIDs: new Set<string>(),
  }
}

describe("validateCustomProvider – variant name validation", () => {
  it("creates one editable model row for every selected discovered model", () => {
    const current = [
      { id: "", name: "", reasoning: false, supportsImages: false, modalities: {}, variants: [] },
    ]
    const discovered = [
      { id: "glm-5.2", name: "GLM 5.2" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      { id: "doubao-seed-2.0-pro", name: "Doubao Seed 2.0 Pro" },
    ]

    const result = mergeDiscoveredModels(current, discovered)

    expect(result.models.map((model) => model.id)).toEqual(discovered.map((model) => model.id))
    expect(result.models.every((model) => model.reasoning === false && model.supportsImages === false)).toBe(true)
    expect(result.models[0]).not.toBe(result.models[1])
  })

  it("deduplicates discovered model rows without hiding new models", () => {
    const form = base()
    const result = mergeDiscoveredModels(form.models, [
      { id: "MODEL-1", name: "Duplicate" },
      { id: "model-2", name: "Model Two" },
      { id: "model-2", name: "Duplicate Two" },
    ])

    expect(result.added.map((model) => model.id)).toEqual(["model-2"])
    expect(result.models.map((model) => model.id)).toEqual(["model-1", "model-2"])
  })

  it("opens the full model editor when an existing quick provider contains additional models", () => {
    const defaults = { modelID: "deepseek-v4-flash", autocompleteModelID: "qwen-coder-30b0" }
    expect(
      hasExtendedModelConfiguration(
        { config: { models: { "deepseek-v4-flash": {}, "qwen-coder-30b0": {} } } },
        defaults,
      ),
    ).toBe(false)
    expect(
      hasExtendedModelConfiguration(
        { config: { models: { "deepseek-v4-flash": {}, "glm-5.2": {}, "deepseek-v4-pro": {} } } },
        defaults,
      ),
    ).toBe(true)
  })

  it("creates a reasoning model without overriding runtime variants", () => {
    const model = createReasoningModel("deepseek-v4-flash")
    expect(model.reasoning).toBe(true)
    expect(model.variants).toEqual([])

    const form = base()
    form.models = [model]
    const config = validateCustomProvider(args(form)).result?.config.models["deepseek-v4-flash"]
    expect(config).toEqual({ name: "deepseek-v4-flash", reasoning: true })
  })

  it("serializes the managed QA and autocomplete models without custom variants", () => {
    const form = base()
    form.providerID = "chipmate"
    form.models = [
      createReasoningModel("deepseek-v4-flash", "DeepSeek V4 Flash"),
      createAutocompleteModel("qwen-coder-30b0", "Qwen Coder 30B"),
    ]

    expect(validateCustomProvider(args(form)).result?.config.models).toEqual({
      "deepseek-v4-flash": { name: "DeepSeek V4 Flash", reasoning: true },
      "qwen-coder-30b0": { name: "Qwen Coder 30B" },
    })
  })

  it("requires an exact configured model match before falling back to DeepSeek candidates", () => {
    const models = [
      { id: "vendor/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "deepseek-r1", name: "DeepSeek R1" },
    ]
    expect(resolveQuickModels(models, "vendor/deepseek-v4-flash", "qwen-coder-30b0")).toEqual({
      exact: models[0],
      autocomplete: undefined,
      candidates: [],
    })
    expect(resolveQuickModels(models, "missing", "qwen-coder-30b0")).toEqual({
      exact: undefined,
      autocomplete: undefined,
      candidates: models,
    })
    expect(resolveQuickModels([{ id: "qwen", name: "Qwen" }], "missing", "qwen-coder-30b0")).toEqual({
      exact: undefined,
      autocomplete: undefined,
      candidates: [],
    })
  })

  it("selects DeepSeek when Qwen and DeepSeek are separate model IDs", () => {
    const models = [
      { id: "qwen-chat", name: "Qwen Chat" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    ]

    expect(resolveQuickModels(models, "deepseek-v4-flash", "qwen-coder-30b0")).toEqual({
      exact: models[1],
      autocomplete: undefined,
      candidates: [],
    })
    expect(resolveQuickModels(models, "qwen-chat/deepseek-v4-flash", "qwen-coder-30b0")).toEqual({
      exact: undefined,
      autocomplete: undefined,
      candidates: [models[1]],
    })
  })

  it("selects only the exact configured autocomplete model", () => {
    const models = [
      { id: "qwen-coder-30b0-preview", name: "Qwen Preview" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "qwen-coder-30b0", name: "Qwen Coder 30B" },
      { id: "vendor/qwen-coder-30b0", name: "Vendor Qwen" },
    ]

    expect(resolveQuickModels(models, "deepseek-v4-flash", "qwen-coder-30b0")).toEqual({
      exact: models[1],
      autocomplete: models[2],
      candidates: [],
    })
  })

  it("persists the selected provider package", () => {
    const form = base()
    form.npm = "@ai-sdk/openai"

    expect(validateCustomProvider(args(form)).result?.config.npm).toBe("@ai-sdk/openai")
  })

  it("allows reconnecting a disabled provider id", () => {
    const form = base()
    const out = validateCustomProvider({
      ...args(form),
      disabledProviders: ["my-provider"],
      existingProviderIDs: new Set(["my-provider"]),
    })

    expect(out.result?.providerID).toBe("my-provider")
    expect(out.errors.providerID).toBeUndefined()
  })

  it("allows editing the fixed internal ChipMate provider without a duplicate-id error", () => {
    const form = base()
    form.providerID = "chipmate"
    const out = validateCustomProvider({
      ...args(form),
      editing: true,
      existingProviderIDs: new Set(["chipmate"]),
    })

    expect(out.result?.providerID).toBe("chipmate")
    expect(out.errors.providerID).toBeUndefined()
  })

  it("requires a replacement credential when an existing provider changes URL origin", () => {
    for (const baseURL of ["http://example.com/v1", "https://example.com:8443/v1", "https://other.example/v1"]) {
      const form = base()
      form.baseURL = baseURL
      const out = validateCustomProvider({
        ...args(form),
        editing: true,
        existingBaseURL: "https://example.com/v1",
        existingHasCredential: true,
        apiKeyChanged: false,
      })

      expect(out.result).toBeUndefined()
      expect(out.errors.apiKey).toBe("provider.custom.error.apiKey.originChanged")
    }
  })

  it("preserves credentials for same-origin URL changes", () => {
    const form = base()
    form.baseURL = "https://example.com/v2/"
    const out = validateCustomProvider({
      ...args(form),
      editing: true,
      existingBaseURL: "https://example.com/v1",
      existingHasCredential: true,
      apiKeyChanged: false,
    })

    expect(out.result).toBeDefined()
    expect(out.errors.apiKey).toBeUndefined()
  })

  it("accepts a new API key or environment credential for a different origin", () => {
    for (const credential of ["sk-new", "{env:NEW_PROVIDER_KEY}"]) {
      const form = base()
      form.baseURL = "https://other.example/v1"
      form.apiKey = credential
      const out = validateCustomProvider({
        ...args(form),
        editing: true,
        existingBaseURL: "https://example.com/v1",
        existingHasCredential: true,
        apiKeyChanged: true,
      })

      expect(out.result).toBeDefined()
      expect(out.errors.apiKey).toBeUndefined()
    }
  })

  it("allows submit when reasoning is enabled with no variants", () => {
    const form = base()
    form.models[0].reasoning = true
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    expect(out.errors.models[0].variants).toEqual([])
  })

  it("allows submit when reasoning is enabled with a named variant", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "fast",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    expect(out.errors.models[0].variants?.[0]?.name).toBeUndefined()
  })

  it("blocks submit and reports error when reasoning is enabled with an empty variant name", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].variants?.[0]?.name).toBe("provider.custom.error.required")
  })

  it("blocks submit and reports error when reasoning is enabled with a whitespace-only variant name", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "   ",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].variants?.[0]?.name).toBe("provider.custom.error.required")
  })

  it("blocks submit and reports duplicate error for two variants with the same name", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "fast",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
      {
        name: "fast",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].variants?.[1]?.name).toBe("provider.custom.error.duplicate")
  })

  it("ignores variants entirely when reasoning is disabled, even if they have empty names", () => {
    const form = base()
    form.models[0].reasoning = false
    form.models[0].variants = [
      {
        name: "",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    // No variant errors produced; form is allowed to submit
    expect(out.errors.models[0].variants).toEqual([])
    // Variant is not included in the saved config
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.variants).toBeUndefined()
  })

  it("treats model IDs differing only in case as duplicates", () => {
    const form = base()
    form.models = [
      { id: "qwen2.5-coder:14b", name: "Qwen", reasoning: false, variants: [] },
      { id: "QWEN2.5-CODER:14B", name: "Qwen Upper", reasoning: false, variants: [] },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].id).toBeUndefined()
    expect(out.errors.models[1].id).toBe("provider.custom.error.duplicate")
  })

  it("persists named variants in the saved config when reasoning is enabled", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "eco",
        enableThinking: true,
        thinking: "adaptive",
        splitReasoning: false,
        outputEffort: "max",
        reasoningEffort: "low",
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.variants).toEqual({
      eco: {
        enable_thinking: true,
        thinking: { type: "adaptive" },
        reasoning_split: false,
        effort: "max",
        reasoningEffort: "low",
      },
    })
  })

  it("serializes image modality when supportsImages is set", () => {
    const form = base()
    form.models[0].supportsImages = true
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["text", "image"] })
  })

  it("omits modalities when supportsImages is not set on a text-only model", () => {
    const form = base()
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toBeUndefined()
  })

  it("preserves an existing image-only input when saving", () => {
    const form = base()
    form.models[0].modalities = { input: ["image"] }
    form.models[0].supportsImages = true
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["image"] })
  })

  it("omits an empty input when image support is removed from an image-only model", () => {
    const form = base()
    form.models[0].modalities = { input: ["image"] }
    form.models[0].supportsImages = false
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toBeUndefined()
  })

  it("preserves output-only modalities when saving", () => {
    const form = base()
    form.models[0].modalities = { output: ["audio"] }
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ output: ["audio"] })
  })

  it("preserves unsupported UI modalities when toggling image support", () => {
    const form = base()
    form.models[0].modalities = {
      input: ["text", "audio", "image", "video", "pdf"],
      output: ["text", "audio"],
    }
    form.models[0].supportsImages = false
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["text", "audio", "video", "pdf"], output: ["text", "audio"] })
  })
})
