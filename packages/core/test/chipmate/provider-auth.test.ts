import { describe, expect, it } from "bun:test"
import {
  customProviderCredentialGuard,
  mismatchedProviderCredentials,
  providerCredentialGuardMatches,
} from "../../src/chipmate/provider-auth"

describe("提供商鉴权配置保护", () => {
  const base = { baseURL: "https://example.com/v1", headers: { "X-Keep": "保留" } }
  const options = { ...base, chipmateCredentialGuard: customProviderCredentialGuard(base) }

  it("未保存摘要的历史配置保持兼容", () => {
    expect(providerCredentialGuardMatches(base)).toBe(true)
  })

  it("摘要允许相同源的路径变更和请求头键顺序变化", () => {
    expect(providerCredentialGuardMatches({ ...options, baseURL: "https://example.com:443/v2" })).toBe(true)
    expect(customProviderCredentialGuard({ ...base, headers: { B: "b", A: "a" } })).toBe(
      customProviderCredentialGuard({ ...base, headers: { A: "a", B: "b" } }),
    )
  })

  for (const [name, changes] of [
    ["换源", { baseURL: "https://other.example/v1" }],
    ["项目复活旧鉴权头", { headers: { ...base.headers, "X-Api-Key": "旧凭据" } }],
    ["项目替换同名鉴权头", { headers: { "X-Keep": "旧凭据" } }],
    ["项目内联密钥覆盖", { apiKey: "旧凭据" }],
  ] as const) {
    it(`${name}时停止加载，且不能回退到其他凭据来源`, () => {
      const changed = { ...options, ...changes }
      expect(providerCredentialGuardMatches(changed)).toBe(false)
      expect(mismatchedProviderCredentials({ custom: { options: changed } }, {})).toEqual(["custom"])
    })
  }

  it("地址缺失或无效时不能使用已绑定密钥", () => {
    const auth = { custom: { type: "api", metadata: { chipmateOrigin: "https://example.com" } } }
    expect(mismatchedProviderCredentials({}, auth)).toEqual(["custom"])
    expect(mismatchedProviderCredentials({ custom: { options: { baseURL: "无效地址" } } }, auth)).toEqual(["custom"])
  })

  const provider = {
    options: base,
    env: ["QA_CONFIRMED_KEY"],
    models: { chat: { headers: { "X-Api-Key": "确认的模型凭据" } } },
  }

  for (const [name, changes] of [
    ["项目恢复旧模型头", { models: { chat: { headers: { "X-Api-Key": "旧凭据" } } } }],
    ["新增模型带入旧头", { models: { ...provider.models, extra: { headers: { Authorization: "旧凭据" } } } }],
    ["项目恢复旧环境变量", { env: ["QA_OLD_KEY"] }],
    ["项目增加环境变量后备", { env: ["QA_CONFIRMED_KEY", "QA_OLD_KEY"] }],
  ] as const) {
    it(`${name}时停止加载所有凭据来源`, () => {
      const guarded = {
        ...provider,
        options: { ...base, chipmateCredentialGuard: customProviderCredentialGuard(base, provider) },
      }
      expect(mismatchedProviderCredentials({ custom: guarded }, {})).toEqual([])
      expect(mismatchedProviderCredentials({ custom: { ...guarded, ...changes } }, {})).toEqual(["custom"])
    })
  }

  it("完整摘要不受模型名称、空请求头和键顺序影响", () => {
    const guard = customProviderCredentialGuard(base, provider)
    const changed = {
      ...provider,
      models: { empty: { headers: {} }, chat: { name: "重命名", headers: provider.models.chat.headers } },
    }
    expect(customProviderCredentialGuard(base, changed)).toBe(guard)
    expect(customProviderCredentialGuard(base, { ...provider, env: [] })).not.toBe(guard)
  })
})
