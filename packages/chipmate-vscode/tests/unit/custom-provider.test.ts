import { describe, expect, it } from "bun:test"
import {
  MASKED_CUSTOM_PROVIDER_KEY,
  parseCustomProviderSecret,
  providerOriginsDiffer,
  resolveCustomProviderKey,
  resolveCustomProviderAuth,
  sanitizeCustomProviderConfig,
  validateProviderID,
  withCustomProviderDeletions,
} from "../../src/shared/custom-provider"
import { isCustomProviderPackage } from "../../src/shared/provider-model"

describe("isCustomProviderPackage", () => {
  it("recognizes supported custom provider packages", () => {
    expect(isCustomProviderPackage("@ai-sdk/openai-compatible")).toBe(true)
    expect(isCustomProviderPackage("@ai-sdk/openai")).toBe(true)
    expect(isCustomProviderPackage("@ai-sdk/anthropic")).toBe(true)
    expect(isCustomProviderPackage("malicious-package")).toBe(false)
  })
})

describe("validateProviderID", () => {
  it("accepts valid provider ids", () => {
    expect(validateProviderID(" my-provider_1 ")).toEqual({ value: "my-provider_1" })
  })

  it("rejects invalid provider ids", () => {
    const result = validateProviderID("bad/id")
    expect("error" in result ? result.error : "").toBe("Invalid provider ID")
  })
})

describe("parseCustomProviderSecret", () => {
  it("treats plain values as api keys", () => {
    expect(parseCustomProviderSecret(" sk-test ")).toEqual({ value: { apiKey: "sk-test" } })
  })

  it("parses env references", () => {
    expect(parseCustomProviderSecret(" {env:MY_PROVIDER_KEY} ")).toEqual({ value: { env: "MY_PROVIDER_KEY" } })
  })

  it("rejects invalid env references", () => {
    const result = parseCustomProviderSecret("{env:bad-name}")
    expect("error" in result ? result.error : "").toBe("Invalid environment variable name")
  })
})

describe("resolveCustomProviderAuth", () => {
  it("preserves auth when the api key field is unchanged", () => {
    expect(resolveCustomProviderAuth(undefined, false)).toEqual({ mode: "preserve" })
  })

  it("stores a changed api key", () => {
    expect(resolveCustomProviderAuth(" sk-test ", true)).toEqual({ mode: "set", key: "sk-test" })
  })

  it("clears auth when the field was changed to empty", () => {
    expect(resolveCustomProviderAuth(undefined, true)).toEqual({ mode: "clear" })
  })
})

describe("resolveCustomProviderKey", () => {
  it("returns a masked value for api-backed providers", () => {
    expect(resolveCustomProviderKey("api")).toBe(MASKED_CUSTOM_PROVIDER_KEY)
  })

  it("hides non-api auth from the edit form", () => {
    expect(resolveCustomProviderKey("oauth")).toBe("")
  })

  it("returns empty when there is no saved key", () => {
    expect(resolveCustomProviderKey(undefined)).toBe("")
  })
})

describe("sanitizeCustomProviderConfig", () => {
  it("normalizes config and preserves an approved package", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "@ai-sdk/anthropic",
      name: " My Provider ",
      env: [" MY_PROVIDER_KEY "],
      options: {
        baseURL: "https://example.com/v1 ",
        headers: {
          Authorization: " Bearer test ",
          " X-Test ": " 123 ",
        },
      },
      models: {
        " model-1 ": { name: " Model One " },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/anthropic",
        name: "My Provider",
        env: ["MY_PROVIDER_KEY"],
        options: {
          baseURL: "https://example.com/v1",
          headers: {
            Authorization: "Bearer test",
            "X-Test": "123",
          },
        },
        models: {
          "model-1": { name: "Model One" },
        },
      },
    })
  })

  it("rejects unapproved packages", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "malicious-package",
      name: "Bad Provider",
      options: { baseURL: "https://example.com/v1" },
      models: { "model-1": { name: "Model One" } },
    })

    expect("error" in result ? result.error : "").toContain("Invalid enum value")
  })

  it("accepts supported thinking variant options", () => {
    const result = sanitizeCustomProviderConfig({
      name: "Thinking Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          variants: {
            thinking: {
              thinking: { type: "adaptive" },
              reasoning_split: true,
              effort: "max",
              chat_template_args: { enable_thinking: true },
            },
          },
        },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/openai-compatible",
        name: "Thinking Provider",
        options: { baseURL: "https://example.com/v1" },
        models: {
          "model-1": {
            name: "Model One",
            variants: {
              thinking: {
                thinking: { type: "adaptive" },
                reasoning_split: true,
                effort: "max",
                chat_template_args: { enable_thinking: true },
              },
            },
          },
        },
      },
    })
  })

  it("preserves core custom model modalities", () => {
    const result = sanitizeCustomProviderConfig({
      name: "Media Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          modalities: {
            input: ["text", "audio", "image", "video", "pdf"],
            output: ["text", "audio"],
          },
        },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/openai-compatible",
        name: "Media Provider",
        options: { baseURL: "https://example.com/v1" },
        models: {
          "model-1": {
            name: "Model One",
            modalities: {
              input: ["text", "audio", "image", "video", "pdf"],
              output: ["text", "audio"],
            },
          },
        },
      },
    })
  })

  it("rejects unknown fields", () => {
    const result = sanitizeCustomProviderConfig({
      name: "Bad Provider",
      options: {
        baseURL: "https://example.com/v1",
        mcpServer: "https://malicious.example",
      },
      models: { "model-1": { name: "Model One" } },
    })

    expect("error" in result ? result.error : "").toContain("mcpServer")
  })
})

describe("提供商来源比较", () => {
  for (const address of [undefined, null, 42, "", "http://", "https//old.example/v1"]) {
    it(`未知旧来源不能视为同源：${String(address)}`, () => {
      expect(providerOriginsDiffer(address, "https://example.com/v1")).toBe(true)
      expect(providerOriginsDiffer("https://example.com/v1", address)).toBe(true)
    })
  }

  it("同源路径修改、域名大小写和默认端口仍可保留凭据", () => {
    expect(providerOriginsDiffer("https://EXAMPLE.com:443/v1", "https://example.com/v2")).toBe(false)
    expect(providerOriginsDiffer("https://example.com/v1", "http://example.com/v1")).toBe(true)
    expect(providerOriginsDiffer("https://example.com/v1", "https://example.com:8443/v1")).toBe(true)
  })
})

describe("withCustomProviderDeletions", () => {
  const baseNext = {
    npm: "@ai-sdk/openai-compatible" as const,
    name: "My Provider",
    options: { baseURL: "https://example.com/v1" },
    models: { keep: { name: "Keep" } },
  }

  it("删除全部请求头时显式清除旧值", () => {
    const existing = { options: { ...baseNext.options, headers: { "X-Api-Key": "旧凭据" } } }
    expect(withCustomProviderDeletions(existing, baseNext).options).toEqual({
      ...baseNext.options,
      headers: { "X-Api-Key": null },
    })
  })

  it("旧地址未知时清理内联密钥、环境变量和隐藏模型头", () => {
    for (const baseURL of [undefined, "", "http://", "https//old.example/v1"]) {
      const existing = {
        ...baseNext,
        env: ["QA_OLD_KEY"],
        options: { baseURL, apiKey: "qa-old" },
        models: { keep: { name: "旧模型", headers: { "X-Api-Key": "qa-old" } } },
      }
      const next = withCustomProviderDeletions(existing, baseNext)
      expect(next.options).toEqual({ ...baseNext.options, apiKey: null })
      expect(next.env).toEqual([])
      expect(next.models.keep).toMatchObject({ headers: null })
    }
  })

  it("删除单个请求头和改变大小写时不遗留旧键", () => {
    const existing = { options: { headers: { Authorization: "旧凭据", "X-Keep": "保留", "X-Delete": "删除" } } }
    const next = {
      ...baseNext,
      options: { ...baseNext.options, headers: { authorization: "新凭据", "X-Keep": "保留" } },
    }
    expect(withCustomProviderDeletions(existing, next).options.headers).toEqual({
      authorization: "新凭据",
      "X-Keep": "保留",
      Authorization: null,
      "X-Delete": null,
    })
  })

  it("换源或替换凭据时清除优先级更高的旧内联密钥", () => {
    const existing = { options: { baseURL: "https://old.example/v1", apiKey: "旧内联密钥", timeout: 3000 } }
    expect(withCustomProviderDeletions(existing, baseNext).options).toEqual({ ...baseNext.options, apiKey: null })
    expect(
      withCustomProviderDeletions({ options: { ...baseNext.options, apiKey: "旧内联密钥" } }, baseNext, true).options,
    ).toEqual({ ...baseNext.options, apiKey: null })
    expect(withCustomProviderDeletions({ options: { ...baseNext.options, apiKey: "保留" } }, baseNext).options).toEqual(
      baseNext.options,
    )
  })

  it("不存在旧配置时直接保存，空配置明确不继承环境凭据", () => {
    expect(withCustomProviderDeletions(undefined, baseNext)).toEqual(baseNext)
    expect(withCustomProviderDeletions({}, baseNext)).toEqual({ ...baseNext, env: [] })
  })

  it("换源或替换密钥时清理隐藏模型头，同源普通编辑保留", () => {
    const existing = { ...baseNext, models: { keep: { name: "保留模型", headers: { "X-Api-Key": "旧凭据" } } } }
    expect(withCustomProviderDeletions(existing, baseNext).models.keep).toEqual({ name: "Keep" })
    expect(withCustomProviderDeletions(existing, baseNext, true).models.keep).toMatchObject({ headers: null })
    const next = { ...baseNext, options: { baseURL: "https://other.example/v1" } }
    expect(withCustomProviderDeletions(existing, next).models.keep).toMatchObject({ headers: null })
  })

  it("替换或清空密钥时显式清除旧环境变量，普通编辑保留", () => {
    const existing = { ...baseNext, env: ["QA_OLD_KEY"] }
    expect(withCustomProviderDeletions(existing, baseNext, true).env).toEqual([])
    expect(withCustomProviderDeletions(existing, baseNext).env).toBeUndefined()
    expect(withCustomProviderDeletions(existing, { ...baseNext, env: ["QA_NEW_KEY"] }, true).env).toEqual([
      "QA_NEW_KEY",
    ])
  })

  it("emits null for models present in existing but absent in next", () => {
    const existing = { models: { keep: { name: "Keep" }, gone: { name: "Gone" } } }
    const result = withCustomProviderDeletions(existing, baseNext)
    const models = result.models as Record<string, unknown>
    expect(models.keep).toEqual({ name: "Keep" })
    expect(models.gone).toBeNull()
  })

  it("emits null for reasoning and variants removed from a surviving model", () => {
    const existing = {
      models: {
        keep: {
          name: "Keep",
          reasoning: true,
          variants: { high: { reasoningEffort: "high" }, low: { reasoningEffort: "low" } },
        },
      },
    }
    const next = {
      ...baseNext,
      models: {
        keep: { name: "Keep", variants: { high: { reasoningEffort: "high" } } },
      },
    } as typeof baseNext
    const result = withCustomProviderDeletions(existing, next)
    const model = (result.models as Record<string, { reasoning?: boolean | null; variants?: Record<string, unknown> }>)
      .keep
    expect(model.reasoning).toBeNull()
    expect(model.variants?.high).toEqual({ reasoningEffort: "high" })
    expect(model.variants?.low).toBeNull()
  })

  it("emits null when reasoning is disabled on a surviving model", () => {
    const existing = { models: { keep: { name: "Keep", reasoning: true } } }
    const result = withCustomProviderDeletions(existing, baseNext)
    expect(result.models.keep).toEqual({ name: "Keep", reasoning: null })
  })

  it("emits null for options removed from a surviving variant", () => {
    const existing = {
      models: {
        keep: {
          name: "Keep",
          variants: {
            thinking: { thinking: { type: "adaptive" }, reasoning_split: true, reasoningEffort: "high" },
          },
        },
      },
    }
    const next = {
      ...baseNext,
      models: {
        keep: { name: "Keep", variants: { thinking: { reasoningEffort: "high" } } },
      },
    } as typeof baseNext
    const result = withCustomProviderDeletions(existing, next)
    const model = (result.models as Record<string, { variants: Record<string, unknown> }>).keep
    expect(model.variants.thinking).toEqual({ reasoningEffort: "high", thinking: null, reasoning_split: null })
  })

  it("does not touch variants on a model that is being deleted", () => {
    const existing = { models: { gone: { name: "Gone", variants: { a: {} } } } }
    const result = withCustomProviderDeletions(existing, baseNext)
    const models = result.models as Record<string, unknown>
    expect(models.gone).toBeNull()
  })
})
