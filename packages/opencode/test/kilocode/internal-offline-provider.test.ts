import { afterEach, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"

import { Env } from "../../src/env"
import { AppRuntime } from "../../src/effect/app-runtime"
import { makeRuntime } from "../../src/effect/run-service"
import { Provider } from "../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const runtime = makeRuntime(Env.Service, Env.defaultLayer)
const set = (key: string, value: string) => runtime.runSync((env) => env.set(key, value))
const original = {
  chipmate: process.env.CHIPMATE_INTERNAL_OFFLINE,
  kilo: process.env.KILO_INTERNAL_OFFLINE,
}

async function list() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.list()
    }),
  )
}

afterEach(() => {
  restore("CHIPMATE_INTERNAL_OFFLINE", original.chipmate)
  restore("KILO_INTERNAL_OFFLINE", original.kilo)
})

test("internal offline mode keeps only configured custom providers", async () => {
  process.env.CHIPMATE_INTERNAL_OFFLINE = "1"

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
          provider: {
            openai: {
              options: {
                apiKey: "public-openai-key",
              },
            },
            "custom-provider": {
              name: "Custom Provider",
              npm: "@ai-sdk/openai-compatible",
              api: "https://intranet.example/v1",
              env: ["CUSTOM_API_KEY"],
              models: {
                "custom-model": {
                  name: "Custom Model",
                  tool_call: true,
                  limit: {
                    context: 128000,
                    output: 4096,
                  },
                },
              },
            },
          },
        }),
      )
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      set("OPENAI_API_KEY", "test-openai-key")
      set("KILO_API_KEY", "test-kilo-key")
      set("CUSTOM_API_KEY", "test-custom-key")

      const providers = await list()
      const keys = Object.keys(providers)

      expect(keys).toEqual(["custom-provider"])
      expect(providers[ProviderV2.ID.make("custom-provider")].models["custom-model"]).toBeDefined()
      expect(providers[ProviderV2.ID.make("openai")]).toBeUndefined()
      expect(providers[ProviderV2.ID.make("kilo")]).toBeUndefined()
      expect(providers[ProviderV2.ID.make("apertis")]).toBeUndefined()
    },
  })
})

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
