import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { customProviderCredentialGuard } from "@opencode-ai/core/chipmate/provider-auth"
import { expect } from "bun:test"
import { Effect } from "effect"
import { Provider } from "../../src/provider/provider"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Provider.node))
const id = ProviderV2.ID.make("qa-origin")

const options = { baseURL: "https://example.com/v1", apiKey: "qa-inline" }
const confirmed = { env: [], models: { "qa-model": { name: "验收模型" } } }
const guard = customProviderCredentialGuard(options, confirmed)
for (const scenario of [
  { name: "完整配置匹配时仍可使用提供商", changes: {}, allowed: true },
  {
    name: "模型级鉴权头被其他配置恢复时停止加载",
    changes: { models: { "qa-model": { name: "验收模型", headers: { "X-Api-Key": "qa-old" } } } },
    allowed: false,
  },
  { name: "环境变量被其他配置恢复时停止加载", changes: { env: ["QA_OLD_KEY"] }, allowed: false },
]) {
  it.instance(
    scenario.name,
    () =>
      Effect.gen(function* () {
        const service = yield* Provider.Service
        expect(Boolean((yield* service.list())[id])).toBe(scenario.allowed)
        if (scenario.allowed) {
          expect((yield* service.getModel(id, ModelV2.ID.make("qa-model"))).id).toBe(ModelV2.ID.make("qa-model"))
          return
        }
        const error = yield* service.getModel(id, ModelV2.ID.make("qa-model")).pipe(Effect.flip)
        expect(error._tag).toBe("ProviderModelNotFoundError")
      }),
    {
      config: {
        provider: {
          [id]: {
            npm: "@ai-sdk/openai-compatible",
            ...confirmed,
            ...scenario.changes,
            options: { ...options, chipmateCredentialGuard: guard },
          },
        },
      },
    },
  )
}

for (const scenario of [
  { name: "相同源可用", baseURL: "https://example.com/v1", origin: "https://example.com", allowed: true },
  { name: "相同源修改路径可用", baseURL: "https://example.com/v2", origin: "https://example.com", allowed: true },
  { name: "默认端口规范化可用", baseURL: "https://EXAMPLE.com:443/v1", origin: "https://example.com", allowed: true },
  { name: "不同主机停止加载", baseURL: "https://other.example/v1", origin: "https://example.com", allowed: false },
  { name: "不同端口停止加载", baseURL: "https://example.com:444/v1", origin: "https://example.com", allowed: false },
  { name: "协议降级停止加载", baseURL: "http://example.com/v1", origin: "https://example.com", allowed: false },
  {
    name: "新密钥遇到旧地址停止加载",
    baseURL: "https://example.com/v1",
    origin: "https://other.example",
    allowed: false,
  },
  { name: "未绑定的历史凭据保持兼容", baseURL: "https://example.com/v1", allowed: true },
]) {
  it.instance(
    scenario.name,
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const previous = process.env.CHIPMATE_AUTH_CONTENT
          process.env.CHIPMATE_AUTH_CONTENT = JSON.stringify({
            [id]: {
              type: "api",
              key: "qa-bound",
              ...(scenario.origin ? { metadata: { chipmateOrigin: scenario.origin } } : {}),
            },
          })
          return previous
        }),
        () =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const item = (yield* provider.list())[id]
            expect(Boolean(item)).toBe(scenario.allowed)
            if (scenario.allowed) {
              expect(item.key).toBe("qa-bound")
              return
            }
            const error = yield* provider.getModel(id, ModelV2.ID.make("qa-model")).pipe(Effect.flip)
            expect(error._tag).toBe("ProviderModelNotFoundError")
          }),
        (previous) =>
          Effect.sync(() => {
            if (previous === undefined) delete process.env.CHIPMATE_AUTH_CONTENT
            else process.env.CHIPMATE_AUTH_CONTENT = previous
          }),
      ),
    {
      config: {
        provider: {
          [id]: {
            npm: "@ai-sdk/openai-compatible",
            name: "源绑定验收",
            // 即使配置中有备用密钥，也不得绕过源绑定限制。
            options: { baseURL: scenario.baseURL, apiKey: "qa-inline-fallback" },
            models: { "qa-model": { name: "验收模型" } },
          },
        },
      },
    },
  )
}
