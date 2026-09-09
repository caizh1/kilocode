import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node])))

const exactProfiles = {
  "glm-5.2": ["max", "high"],
  "deepseek-v4-flash": ["max", "high", "thinking", "none"],
  "deepseek-v4-pro": ["max", "high", "thinking", "none"],
  "doubao-seed-2.0-pro": ["thinking", "none"],
}

it.instance(
  "infers exact reasoning profiles for auto-discovered models without reasoning metadata",
  () =>
    Effect.gen(function* () {
      const providers = yield* Provider.use.list()
      const models = providers[ProviderV2.ID.make("custom")]?.models ?? {}

      for (const [id, variants] of Object.entries(exactProfiles)) {
        expect(models[id]?.capabilities.reasoning).toBe(true)
        expect(Object.keys(models[id]?.variants ?? {})).toEqual(variants)
      }
      expect(models["ordinary-model"]?.capabilities.reasoning).toBe(false)
      expect(models["ordinary-model"]?.variants).toEqual({})
    }),
  {
    config: {
      disabled_providers: ["chipmate", "apertis"],
      provider: {
        custom: {
          name: "Custom",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test" },
          models: Object.fromEntries(
            [...Object.keys(exactProfiles), "ordinary-model"].map((id) => [id, { name: id }]),
          ),
        },
      },
    },
  },
)

it.instance(
  "keeps explicit reasoning false and custom variants ahead of exact inference",
  () =>
    Effect.gen(function* () {
      const providers = yield* Provider.use.list()
      const models = providers[ProviderV2.ID.make("custom")]?.models ?? {}

      expect(models["glm-5.2"]?.capabilities.reasoning).toBe(false)
      expect(models["glm-5.2"]?.variants).toEqual({})
      expect(models["deepseek-v4-pro"]?.capabilities.reasoning).toBe(true)
      expect(models["deepseek-v4-pro"]?.variants).toEqual({ custom: { reasoningEffort: "custom" } })
    }),
  {
    config: {
      disabled_providers: ["chipmate", "apertis"],
      provider: {
        custom: {
          name: "Custom",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test" },
          models: {
            "glm-5.2": { name: "GLM 5.2", reasoning: false },
            "deepseek-v4-pro": {
              name: "DeepSeek V4 Pro",
              reasoning: false,
              variants: { custom: { reasoningEffort: "custom" } },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "uses configured variants instead of inferred reasoning efforts",
  () =>
    Effect.gen(function* () {
      const providers = yield* Provider.use.list()
      const model = providers[ProviderV2.ID.make("custom")]?.models["qwen-custom"]

      expect(Object.keys(model?.variants ?? {})).toEqual(["custom"])
      expect(model?.variants?.high).toBeUndefined()
      expect(model?.variants?.custom).toEqual({ reasoningEffort: "custom" })
    }),
  {
    config: {
      disabled_providers: ["chipmate", "apertis"],
      provider: {
        custom: {
          name: "Custom",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test" },
          models: {
            "qwen-custom": {
              name: "Qwen Custom",
              reasoning: true,
              limit: { context: 128_000, output: 16_000 },
              variants: {
                high: { disabled: true },
                custom: { reasoningEffort: "custom" },
              },
            },
          },
        },
      },
    },
  },
)
