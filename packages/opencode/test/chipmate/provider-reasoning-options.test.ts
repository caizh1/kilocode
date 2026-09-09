import { describe, expect, test } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText } from "ai"
import { ProviderTransform } from "../../src/provider/transform"
import { Provider } from "../../src/provider/provider"
import { customProviderReasoning, customProviderVariants } from "../../src/chipmate/provider/provider"
import type * as ModelsDev from "@opencode-ai/core/models-dev"

function mockModel(overrides: Partial<any> = {}): any {
  return {
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 200_000, output: 64_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  }
}

function raw(options: ModelsDev.Model["reasoning_options"]): ModelsDev.Model {
  return { reasoning_options: options } as ModelsDev.Model
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

describe("ProviderTransform.reasoningVariants - models.dev reasoning_options", () => {
  test("effort tiers including 'max' and null 'none' on @ai-sdk/openai", () => {
    const target = mockModel({
      api: { id: "gpt-5.6", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
    })
    const result = ProviderTransform.reasoningVariants(
      raw([{ type: "effort", values: ["none", null, "low", "medium", "high", "xhigh", "max"] }]),
      target,
    )
    expect(Object.keys(result ?? {})).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
    expect(result?.none).toEqual({
      reasoningEffort: "none",
      reasoningSummary: "detailed",
      include: ["reasoning.encrypted_content"],
    })
    expect(result?.max).toEqual({
      reasoningEffort: "max",
      reasoningSummary: "detailed",
      include: ["reasoning.encrypted_content"],
    })
  })

  test("effort tiers on @openrouter/ai-sdk-provider use reasoning object shape", () => {
    const target = mockModel({
      providerID: "openrouter",
      api: { id: "openai/gpt-5.6", url: "https://openrouter.ai", npm: "@openrouter/ai-sdk-provider" },
    })
    const result = ProviderTransform.reasoningVariants(
      raw([{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }]),
      target,
    )
    expect(Object.keys(result ?? {})).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
    expect(result?.max).toEqual({ reasoning: { effort: "max" } })
  })

  test("budget_tokens produces high/max budget variants on bedrock", () => {
    const target = mockModel({
      api: { id: "anthropic.claude-sonnet-4-5", url: "https://bedrock.amazonaws.com", npm: "@ai-sdk/amazon-bedrock" },
    })
    const result = ProviderTransform.reasoningVariants(raw([{ type: "budget_tokens", min: 1024 }]), target)
    expect(Object.keys(result ?? {})).toEqual(["high", "max"])
    expect(result?.max).toEqual({ reasoningConfig: { type: "enabled", budgetTokens: 31_999 } })
  })

  test("explicitly empty reasoning_options means no variants", () => {
    const target = mockModel()
    expect(ProviderTransform.reasoningVariants(raw([]), target)).toEqual({})
  })

  test("missing reasoning_options falls back to heuristics (undefined)", () => {
    const target = mockModel()
    expect(ProviderTransform.reasoningVariants(raw(undefined), target)).toBeUndefined()
  })

  test("models.dev reasoning_options take precedence over heuristic variants in the provider pipeline", () => {
    const provider = {
      id: "openai",
      name: "OpenAI",
      env: [],
      npm: "@ai-sdk/openai",
      models: {
        "gpt-5.6": {
          id: "gpt-5.6",
          name: "GPT-5.6",
          family: "gpt",
          release_date: "2025-12-11",
          attachment: true,
          reasoning: true,
          temperature: false,
          tool_call: true,
          cost: { input: 1, output: 4, cache_read: 0.5, cache_write: 0 },
          limit: { context: 400_000, output: 128_000 },
          reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
        },
        "gpt-5": {
          id: "gpt-5",
          name: "GPT-5",
          family: "gpt",
          release_date: "2024-06-01",
          attachment: true,
          reasoning: true,
          temperature: false,
          tool_call: true,
          cost: { input: 1, output: 4, cache_read: 0.5, cache_write: 0 },
          limit: { context: 400_000, output: 128_000 },
        },
      },
    } as unknown as ModelsDev.Provider

    const info = Provider.fromModelsDevProvider(provider)
    const gpt56 = info.models["gpt-5.6"]
    expect(Object.keys(gpt56.variants ?? {})).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
    expect(gpt56.variants?.["max"]).toEqual({
      reasoningEffort: "max",
      reasoningSummary: "detailed",
      include: ["reasoning.encrypted_content"],
    })

    const gpt5 = info.models["gpt-5"]
    expect(Object.keys(gpt5.variants ?? {})).toEqual(["minimal", "low", "medium", "high"])
  })
})

describe("custom provider fallback reasoning efforts", () => {
  const efforts = ["none", "low", "medium", "high", "xhigh", "max"]

  const profiles: Array<{ ids: string[]; variants: Record<string, Record<string, unknown>> }> = [
    {
      ids: ["glm-5.2", "Zhipu/GLM-5.2"],
      variants: {
        max: { reasoningEffort: "max" },
        high: { reasoningEffort: "high" },
      },
    },
    {
      ids: ["deepseek-v4-flash", "DeepSeek/DeepSeek-V4-Flash"],
      variants: {
        max: { reasoningEffort: "max" },
        high: { reasoningEffort: "high" },
        thinking: { thinking: { type: "enabled" } },
        none: { thinking: { type: "disabled" } },
      },
    },
    {
      ids: ["deepseek-v4-pro", "DeepSeek/DeepSeek-V4-Pro"],
      variants: {
        max: { reasoningEffort: "max" },
        high: { reasoningEffort: "high" },
        thinking: { thinking: { type: "enabled" } },
        none: { thinking: { type: "disabled" } },
      },
    },
    {
      ids: ["doubao-seed-2.0-pro", "ByteDance/Doubao-Seed-2-0-Pro"],
      variants: {
        thinking: { thinking: { type: "enabled" } },
        none: { thinking: { type: "disabled" } },
      },
    },
  ]

  for (const profile of profiles) {
    for (const id of profile.ids) {
      test(`${id} exposes only its exact OpenAI-compatible capability profile`, () => {
        const npm = "@ai-sdk/openai-compatible"
        const model = mockModel({ id, api: { id, url: "https://api.test.com", npm } })

        expect(customProviderVariants(model, npm, ProviderTransform.variants)).toEqual(profile.variants)
      })
    }
  }

  for (const id of [
    "glm-5.2-air",
    "prefix-glm-5.2",
    "deepseek-v4-flash-lite",
    "deepseek-v4-pro-plus",
    "doubao-seed-2.0-pro-preview",
    "doubao-seed-2.1-pro",
  ]) {
    test(`${id} does not match an exact auto-discovered capability profile`, () => {
      const npm = "@ai-sdk/openai-compatible"
      const model = mockModel({ id, api: { id, url: "https://api.test.com", npm } })
      const generated = ProviderTransform.variants({ ...model, variants: {} })

      expect(customProviderVariants(model, npm, ProviderTransform.variants)).toEqual(generated)
      expect(
        customProviderReasoning({
          id,
          api: model.api,
          npm,
          configured: undefined,
          variants: undefined,
          existing: undefined,
        }),
      ).toBe(false)
    })
  }

  for (const id of ["qwen3.8-27b", "Qwen/Qwen3.8-27B", "qwen3.8-27b-fp8", "QWEN/QWEN3.8-27B-FP8"]) {
    test(`${id} exposes its supported per-request thinking controls`, () => {
      const npm = "@ai-sdk/openai-compatible"
      const model = mockModel({ id, api: { id, url: "https://api.test.com", npm } })

      const result = customProviderVariants(model, npm, ProviderTransform.variants)

      expect(Object.keys(result)).toEqual(["xhigh", "medium", "low", "none"])
      expect(result).toEqual({
        xhigh: { reasoningEffort: "xhigh", chat_template_kwargs: { enable_thinking: true } },
        medium: { reasoningEffort: "medium", chat_template_kwargs: { enable_thinking: true } },
        low: { reasoningEffort: "low", chat_template_kwargs: { enable_thinking: true } },
        none: { chat_template_kwargs: { enable_thinking: false } },
      })
      expect(result.none?.reasoningEffort).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain("chat_template_args")
      expect(JSON.stringify(result)).not.toContain("preserve_thinking")
      expect(result.high).toBeUndefined()
      expect(result.max).toBeUndefined()
    })
  }

  for (const id of ["qwen3.8-32b", "qwen3.8-27b-extra", "prefix-qwen3.8-27b", "qwen3.5-27b"]) {
    test(`${id} does not match the Qwen3.8 27B capability profile`, () => {
      const npm = "@ai-sdk/openai-compatible"
      const model = mockModel({ id, api: { id, url: "https://api.test.com", npm } })

      expect(Object.keys(customProviderVariants(model, npm, ProviderTransform.variants))).toEqual(efforts)
    })
  }

  test("serializes Qwen3.8 thinking controls into the OpenAI-compatible request body", async () => {
    const bodies: Array<Record<string, unknown>> = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body: unknown = await request.json()
        if (!isRecord(body)) throw new Error("请求体不是 JSON 对象")
        bodies.push(body)
        return Response.json({
          id: "fixture-completion",
          object: "chat.completion",
          created: 0,
          model: "qwen3.8-27b",
          choices: [{ index: 0, message: { role: "assistant", content: "ready" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      },
    })

    try {
      const port = server.port
      if (port === undefined) throw new Error("测试服务未绑定端口")
      const sdk = createOpenAICompatible({ name: "qwen-fixture", baseURL: `http://127.0.0.1:${port}/v1` })
      const npm = "@ai-sdk/openai-compatible"
      const model = mockModel({
        id: "qwen3.8-27b",
        providerID: "qwen-fixture",
        api: { id: "qwen3.8-27b", url: "https://api.test.com", npm },
      })
      const variants = customProviderVariants(model, npm, ProviderTransform.variants)

      for (const name of ["xhigh", "medium", "low", "none"]) {
        await generateText({
          model: sdk.languageModel("qwen3.8-27b"),
          prompt: "hello",
          providerOptions: ProviderTransform.providerOptions(model, variants[name]),
        })
      }

      expect(
        bodies.map((body) => ({
          chat_template_kwargs: body.chat_template_kwargs,
          reasoning_effort: body.reasoning_effort,
          chat_template_args: body.chat_template_args,
        })),
      ).toEqual([
        {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_effort: "xhigh",
          chat_template_args: undefined,
        },
        {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_effort: "medium",
          chat_template_args: undefined,
        },
        {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_effort: "low",
          chat_template_args: undefined,
        },
        {
          chat_template_kwargs: { enable_thinking: false },
          reasoning_effort: undefined,
          chat_template_args: undefined,
        },
      ])
    } finally {
      await server.stop(true)
    }
  })

  test("serializes exact discovered-model controls without generic efforts", async () => {
    const bodies: Array<Record<string, unknown>> = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body: unknown = await request.json()
        if (!isRecord(body)) throw new Error("请求体不是 JSON 对象")
        bodies.push(body)
        return Response.json({
          id: "fixture-completion",
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: "ready" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      },
    })

    try {
      const port = server.port
      if (port === undefined) throw new Error("测试服务未绑定端口")
      const providerID = "reasoning-fixture"
      const sdk = createOpenAICompatible({ name: providerID, baseURL: `http://127.0.0.1:${port}/v1` })
      const npm = "@ai-sdk/openai-compatible"
      const cases = [
        { id: "glm-5.2", names: ["max", "high"] },
        { id: "deepseek-v4-flash", names: ["max", "high", "thinking", "none"] },
        { id: "deepseek-v4-pro", names: ["max", "high", "thinking", "none"] },
        { id: "doubao-seed-2.0-pro", names: ["thinking", "none"] },
      ]

      for (const item of cases) {
        const model = mockModel({ id: item.id, providerID, api: { id: item.id, url: "https://api.test.com", npm } })
        const variants = customProviderVariants(model, npm, ProviderTransform.variants)
        expect(Object.keys(variants)).toEqual(item.names)
        for (const name of item.names) {
          await generateText({
            model: sdk.languageModel(item.id),
            prompt: "hello",
            providerOptions: ProviderTransform.providerOptions(model, variants[name]),
          })
        }
      }

      expect(
        bodies.map((body) => ({ model: body.model, reasoning_effort: body.reasoning_effort, thinking: body.thinking })),
      ).toEqual([
        { model: "glm-5.2", reasoning_effort: "max", thinking: undefined },
        { model: "glm-5.2", reasoning_effort: "high", thinking: undefined },
        { model: "deepseek-v4-flash", reasoning_effort: "max", thinking: undefined },
        { model: "deepseek-v4-flash", reasoning_effort: "high", thinking: undefined },
        { model: "deepseek-v4-flash", reasoning_effort: undefined, thinking: { type: "enabled" } },
        { model: "deepseek-v4-flash", reasoning_effort: undefined, thinking: { type: "disabled" } },
        { model: "deepseek-v4-pro", reasoning_effort: "max", thinking: undefined },
        { model: "deepseek-v4-pro", reasoning_effort: "high", thinking: undefined },
        { model: "deepseek-v4-pro", reasoning_effort: undefined, thinking: { type: "enabled" } },
        { model: "deepseek-v4-pro", reasoning_effort: undefined, thinking: { type: "disabled" } },
        { model: "doubao-seed-2.0-pro", reasoning_effort: undefined, thinking: { type: "enabled" } },
        { model: "doubao-seed-2.0-pro", reasoning_effort: undefined, thinking: { type: "disabled" } },
      ])
      for (const body of bodies) {
        expect(body.reasoning).toBeUndefined()
        expect(body.reasoningEffort).toBeUndefined()
      }
    } finally {
      await server.stop(true)
    }
  })

  for (const npm of ["@ai-sdk/openai-compatible", "@ai-sdk/openai", "@ai-sdk/anthropic"]) {
    test(`${npm} exposes broad efforts after heuristics fail`, () => {
      const model = mockModel({ id: "qwen-custom", api: { id: "qwen-custom", url: "https://api.test.com", npm } })
      const generated = ProviderTransform.variants({ ...model, variants: {} })
      expect(generated).toEqual({})

      const result = customProviderVariants(model, npm, ProviderTransform.variants)

      expect(Object.keys(result)).toEqual(efforts)
      if (npm === "@ai-sdk/anthropic") {
        expect(result.none).toEqual({ thinking: { type: "disabled" } })
        expect(result.max).toEqual({ effort: "max" })
        return
      }
      expect(result.none?.reasoningEffort).toBe("none")
      expect(result.max?.reasoningEffort).toBe("max")
    })
  }

  test("preserves successful heuristics", () => {
    const model = mockModel({ api: { id: "custom", url: "https://api.test.com", npm: "@ai-sdk/openai-compatible" } })
    const generated = { low: { reasoningEffort: "low" }, high: { reasoningEffort: "high" } }
    expect(customProviderVariants(model, model.api.npm, () => generated)).toBe(generated)
  })

  test("limits exact capability profiles to OpenAI-compatible providers", () => {
    const npm = "@ai-sdk/openai"
    for (const id of ["qwen3.8-27b", "glm-5.2", "deepseek-v4-flash", "deepseek-v4-pro", "doubao-seed-2.0-pro"]) {
      const model = mockModel({ id, api: { id, url: "https://api.test.com", npm } })
      expect(
        customProviderReasoning({
          id,
          api: model.api,
          npm,
          configured: undefined,
          variants: undefined,
          existing: undefined,
        }),
      ).toBe(false)
    }
  })

  test("prefers configured variants to inference", () => {
    const variants = { custom: { reasoningEffort: "custom" } }
    for (const npm of ["@ai-sdk/openai-compatible", "@ai-sdk/openai", "@ai-sdk/anthropic"]) {
      const model = mockModel({ api: { id: "custom", url: "https://api.test.com", npm }, variants })
      expect(
        customProviderVariants(model, npm, () => {
          throw new Error("inference should not run")
        }),
      ).toBe(variants)
    }
  })

  test("prefers explicit reasoning false over exact capability inference", () => {
    const npm = "@ai-sdk/openai-compatible"
    for (const id of ["glm-5.2", "deepseek-v4-flash", "deepseek-v4-pro", "doubao-seed-2.0-pro"]) {
      const model = mockModel({ id, api: { id, url: "https://api.test.com", npm } })
      expect(customProviderVariants(model, npm, ProviderTransform.variants, false)).toEqual({})
      expect(
        customProviderReasoning({
          id,
          api: model.api,
          npm,
          configured: false,
          variants: undefined,
          existing: true,
        }),
      ).toBe(false)
    }
  })

  test("requires a reasoning model with an explicitly configured supported package", () => {
    const npm = "@ai-sdk/openai-compatible"
    const plain = mockModel({
      api: { id: "custom", url: "https://api.test.com", npm },
      capabilities: { ...mockModel().capabilities, reasoning: false },
    })
    expect(customProviderVariants(plain, npm, () => ({}))).toEqual({})
    expect(
      customProviderVariants(
        mockModel({ api: { id: "custom", url: "https://api.test.com", npm } }),
        undefined,
        () => ({}),
      ),
    ).toEqual({})
    expect(
      customProviderVariants(
        mockModel({ api: { id: "custom", url: "https://api.test.com", npm: "unrelated-provider" } }),
        "unrelated-provider",
        () => ({}),
      ),
    ).toEqual({})
  })
})
