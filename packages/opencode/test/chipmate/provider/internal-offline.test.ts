import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect, Layer } from "effect"
import { Env } from "@/env"
import { Provider } from "@/provider/provider"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(Provider.node),
    AppNodeBuilder.build(Env.node),
    AppNodeBuilder.build(CrossSpawnSpawner.node),
  ),
)

function withProcessEnv<A, E, R>(entries: Record<string, string | undefined>, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const originals: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(entries)) {
        originals[key] = process.env[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return originals
    }),
    () => effect,
    (originals) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(originals)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )
}

it.instance("loads the configured chipmate provider in internal offline mode", () =>
  provideTmpdirInstance(() =>
    withProcessEnv(
      {
        CHIPMATE_INTERNAL_OFFLINE: "1",
        CHIPMATE_CONFIG_CONTENT: JSON.stringify({
          model: "chipmate/vendor/deepseek",
          provider: {
            chipmate: {
              name: "ChipMate",
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: "http://127.0.0.1:7777/v1" },
              models: { "vendor/deepseek": { name: "vendor/deepseek", reasoning: true } },
            },
          },
        }),
      },
      Provider.Service.use((provider) =>
        Effect.gen(function* () {
          const model = yield* provider.getModel(ProviderV2.ID.make("chipmate"), ModelV2.ID.make("vendor/deepseek"))
          expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
          expect(model.providerID).toBe(ProviderV2.ID.make("chipmate"))
        }),
      ),
    ),
  ),
)

it.instance("ignores retained auth when its provider catalog entry is unavailable", () =>
  provideTmpdirInstance(() =>
    withProcessEnv(
      {
        CHIPMATE_INTERNAL_OFFLINE: "1",
        CHIPMATE_CONFIG_CONTENT: undefined,
        CHIPMATE_AUTH_CONTENT: JSON.stringify({ chipmate: { type: "api", key: "retained-key" } }),
      },
      Provider.Service.use((provider) =>
        Effect.gen(function* () {
          const providers = yield* provider.list()
          expect(providers[ProviderV2.ID.make("chipmate")]).toBeUndefined()
          const error = yield* provider
            .getModel(ProviderV2.ID.make("chipmate"), ModelV2.ID.make("vendor/deepseek"))
            .pipe(Effect.flip)
          expect(Provider.ModelNotFoundError.isInstance(error)).toBe(true)
          expect(error.message).toContain("Model not found: chipmate/vendor/deepseek")
        }),
      ),
    ),
  ),
)
