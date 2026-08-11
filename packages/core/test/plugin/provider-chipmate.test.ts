import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AISDK } from "@opencode-ai/core/aisdk" // chipmate_change
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model" // chipmate_change
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { ChipMatePlugin } from "@opencode-ai/core/plugin/provider/chipmate"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* ChipMatePlugin.effect(host)
})

// chipmate_change start
function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(vars)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )
}
// chipmate_change end

describe("ChipMatePlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("chipmate"))),
  )

  it.effect("applies legacy referer headers only to chipmate", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("chipmate"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.chipmate.ai/api/gateway",
          }
          provider.request = { headers: { Existing: "value" }, body: {} }
        })
        catalog.provider.update(ProviderV2.ID.openrouter, () => {})
      })
      yield* addPlugin()
      expect((yield* catalog.provider.get(ProviderV2.ID.make("chipmate")))?.request.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://chipmate.ai/",
        "X-Title": "ChipMate", // chipmate_change
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter))?.request.headers).toEqual({})
    }),
  )

  it.effect("uses the exact legacy ChipMate header casing and set", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("chipmate"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.chipmate.ai/api/gateway",
          }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.chipmate))?.request.headers).toEqual({
        "HTTP-Referer": "https://chipmate.ai/",
        "X-Title": "ChipMate", // chipmate_change
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("chipmate")))?.request.headers).not.toHaveProperty(
        "http-referer",
      )
      expect((yield* catalog.provider.get(ProviderV2.ID.make("chipmate")))?.request.headers).not.toHaveProperty("x-title")
      expect((yield* catalog.provider.get(ProviderV2.ID.make("chipmate")))?.request.headers).not.toHaveProperty("X-Source")
    }),
  )

  it.effect("uses the legacy provider-id guard instead of endpoint package matching", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("chipmate"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.chipmate.ai/api/gateway",
          }
        })
        catalog.provider.update(ProviderV2.ID.make("custom-chipmate"), (provider) => {
          provider.api = { type: "aisdk", package: "chipmate" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.chipmate))?.request.headers).toEqual({
        "HTTP-Referer": "https://chipmate.ai/",
        "X-Title": "ChipMate", // chipmate_change
      })
      expect((yield* catalog.provider.get(ProviderV2.ID.make("custom-chipmate")))?.request.headers).toEqual({})
    }),
  )

  // chipmate_change start
  it.effect("routes the ChipMate catalog through the ChipMate Gateway SDK", () =>
    withEnv({ CHIPMATE_API_KEY: undefined, CHIPMATE_ORG_ID: undefined }, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(ProviderV2.ID.chipmate, (provider) => {
            provider.api = {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: "https://api.chipmate.ai/api/gateway",
            }
            provider.request = { headers: {}, body: { apiKey: "stored-token" } }
          })
        })
        yield* addPlugin()
        const updated = yield* catalog.provider.get(ProviderV2.ID.chipmate)

        expect(updated?.api).toEqual({
          type: "aisdk",
          package: "@chipmate/chipmate-gateway",
          url: "https://api.chipmate.ai/api/openrouter",
        })
        expect(updated?.request.body.chipmateToken).toBe("stored-token")

        const result = yield* aisdk.runSDK({
          model: ModelV2.Info.make({
            ...ModelV2.Info.empty(ProviderV2.ID.chipmate, ModelV2.ID.make("chipmate-auto/free")),
            api: {
              id: ModelV2.ID.make("chipmate-auto/free"),
              type: "aisdk",
              package: "@chipmate/chipmate-gateway",
            },
          }),
          package: "@chipmate/chipmate-gateway",
          options: updated?.request.body ?? {},
        })
        expect(result.sdk).toBeDefined()
        expect(typeof result.sdk.languageModel).toBe("function")
        expect(typeof result.sdk.anthropic).toBe("function")
      }),
    ),
  )

  it.effect("keeps authenticated credentials ahead of inherited environment keys", () =>
    withEnv({ CHIPMATE_API_KEY: "environment-token", CHIPMATE_ORG_ID: "environment-org" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(ProviderV2.ID.chipmate, (provider) => {
            provider.request = {
              headers: {},
              body: { apiKey: "authenticated-token", chipmateOrganizationId: "authenticated-org" },
            }
          })
        })
        yield* addPlugin()
        const result = yield* catalog.provider.get(ProviderV2.ID.chipmate)

        expect(result?.request.body.apiKey).toBe("authenticated-token")
        expect(result?.request.body.chipmateToken).toBe("authenticated-token")
        expect(result?.request.body.chipmateOrganizationId).toBe("environment-org")
      }),
    ),
  )

  it.effect("keeps anonymous ChipMate models available without credentials", () =>
    withEnv({ CHIPMATE_API_KEY: undefined, CHIPMATE_ORG_ID: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => catalog.provider.update(ProviderV2.ID.chipmate, () => {}))
        yield* addPlugin()
        const result = yield* catalog.provider.get(ProviderV2.ID.chipmate)

        expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(ProviderV2.ID.chipmate)
        expect(result?.request.body.apiKey).toBe("anonymous")
        expect(result?.request.body.chipmateToken).toBe("anonymous")
      }),
    ),
  )
  // chipmate_change end
})
