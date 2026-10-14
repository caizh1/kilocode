import { afterEach, expect } from "bun:test"
import { streamText } from "ai"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { testProviderConfig } from "../lib/test-provider"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"

const keys = ["CHIPMATE_INTERNAL_OFFLINE", "CHIPMATE_INTERNAL_PROVIDER_MODEL_REPLACEMENTS"]
const previous = keys.map((key) => process.env[key])
afterEach(async () => {
  await disposeAllInstances()
  keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key]
    else process.env[key] = previous[index]
  })
})
const it = testEffect(
  LayerNode.compile(LayerNode.group([Provider.node, Config.node, Env.node, Plugin.node, CrossSpawnSpawner.node])),
)

it.live("旧配置和会话模型经过真实提供商解析及 HTTP 请求后使用新 ID，其他来源保持原样", () =>
  Effect.gen(function* () {
    process.env.CHIPMATE_INTERNAL_OFFLINE = "1"
    process.env.CHIPMATE_INTERNAL_PROVIDER_MODEL_REPLACEMENTS = JSON.stringify({
      providerID: "test",
      models: { "retired-chat": "current-chat" },
    })
    const received: string[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            const body = (await request.json()) as { model: string }
            received.push(body.model)
            return new Response('data: {"choices":[{"delta":{"content":"已收到"}}]}\n\ndata: [DONE]\n\n', {
              headers: { "content-type": "text/event-stream" },
            })
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    const fixture = testProviderConfig(server.url.origin)
    const model = fixture.provider.test.models["test-model"]
    const config = {
      ...fixture,
      model: "test/retired-chat",
      agent: { code: { model: "test/retired-chat" } },
      provider: {
        test: { ...fixture.provider.test, models: { "retired-chat": { ...model, id: "retired-chat" } } },
        another: {
          ...fixture.provider.test,
          id: "another",
          models: { "retired-chat": { ...model, id: "retired-chat" } },
        },
      },
    }
    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const resolved = yield* (yield* Config.Service).get()
          expect(resolved.model).toBe("test/current-chat")
          expect(resolved.agent?.code?.model).toBe("test/current-chat")
          const catalog = yield* provider.getProvider(ProviderV2.ID.make("test"))
          expect(Object.keys(catalog.models)).toEqual(["current-chat"])
          for (const providerID of ["test", "another"]) {
            const info = yield* provider.getModel(ProviderV2.ID.make(providerID), ModelV2.ID.make("retired-chat"))
            expect(String(info.id)).toBe(providerID === "test" ? "current-chat" : "retired-chat")
            const response = streamText({
              model: yield* provider.getLanguage(info),
              messages: [{ role: "user", content: "验证模型" }],
              maxRetries: 0,
            })
            expect(yield* Effect.promise(() => response.text)).toBe("已收到")
          }
          expect(received).toEqual(["current-chat", "retired-chat"])
          expect(config.model).toBe("test/retired-chat")
        }),
      { config },
    )
  }),
)
