import { describe, expect, it } from "bun:test"
import {
  buildActionContext,
  connectProvider,
  disconnectProvider,
  fetchProviderData,
  resolveStoredKey,
  saveCustomProvider,
} from "../../src/provider-actions"

type ExistingGlobal = { disabled_providers?: string[]; provider?: Record<string, unknown> }
type Options = { headers?: Record<string, string> }

function createCtx(
  existing: ExistingGlobal = { disabled_providers: [] },
  merged: ExistingGlobal = existing,
  error?: Error,
) {
  const calls = {
    set: [] as Array<{ providerID: string; auth: { type: string; key: string; metadata?: Record<string, string> } }>,
    remove: [] as Array<{ providerID: string }>,
    posts: [] as unknown[],
    config: [] as Array<{ config: Record<string, unknown> }>,
    project: [] as Array<{ config: Record<string, unknown> }>,
    configOptions: [] as Options[],
    setOptions: [] as Options[],
    removeOptions: [] as Options[],
    cached: [] as unknown[],
    refresh: 0,
    dispose: 0,
    order: [] as string[],
  }

  const ctx = {
    client: {
      auth: {
        set: async (
          input: {
            providerID: string
            auth: { type: string; key: string; metadata?: Record<string, string> }
          },
          opts?: Options,
        ) => {
          calls.order.push("auth.set")
          if (error) throw error
          calls.set.push(input)
          calls.setOptions.push(opts ?? {})
          return { data: true }
        },
        remove: async (input: { providerID: string }, opts?: Options) => {
          calls.order.push("auth.remove")
          if (error) throw error
          calls.remove.push(input)
          calls.removeOptions.push(opts ?? {})
          return { data: true }
        },
      },
      provider: {
        list: async () => ({
          data: {
            all: [
              {
                id: "openai",
                name: "OpenAI",
                source: "custom",
                env: [],
                models: {},
              },
            ],
            connected: ["openai"],
            default: {},
          },
        }),
        auth: async () => ({ data: {} }),
      },
      global: {
        config: {
          get: async () => {
            calls.order.push("global.get")
            return { data: existing }
          },
          update: async (input: { config: Record<string, unknown> }, opts?: Options) => {
            calls.order.push("global.update")
            calls.config.push(input)
            calls.configOptions.push(opts ?? {})
            return { data: input }
          },
        },
      },
      config: {
        get: async () => {
          calls.order.push("config.get")
          return { data: merged }
        },
        update: async (input: { config: Record<string, unknown> }) => {
          calls.project.push(input)
          return { data: input }
        },
      },
    },
    postMessage: (message: unknown) => calls.posts.push(message),
    getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    workspaceDir: "/tmp",
    disposeGlobal: async () => {
      calls.order.push("dispose")
      calls.dispose += 1
    },
    fetchAndSendProviders: async () => {
      calls.order.push("providers")
      calls.refresh += 1
    },
  } as unknown as Parameters<typeof saveCustomProvider>[0]

  return {
    calls,
    ctx,
    setCachedConfig: (message: unknown) => calls.cached.push(message),
  }
}

function createProvider() {
  return {
    name: "My Provider",
    options: { baseURL: "https://example.com/v1" },
    models: {
      "model-1": { name: "Model One" },
    },
  }
}

function createSavedProvider() {
  return {
    npm: "@ai-sdk/openai-compatible",
    ...createProvider(),
  }
}

describe("disconnectProvider", () => {
  it("keeps configured provider enabled after disconnecting oauth override", async () => {
    const existing = {
      disabled_providers: ["openai", "groq"],
      provider: {
        openai: {
          options: { apiKey: "sk-test" },
        },
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx(existing)

    await disconnectProvider(ctx, "req", "openai", null, setCachedConfig)

    expect(calls.remove).toEqual([{ providerID: "openai" }])
    expect(calls.config).toEqual([{ config: { disabled_providers: ["groq"] } }])
    expect(calls.refresh).toBe(1)
  })
})

describe("connectProvider", () => {
  it("stores api auth metadata from provider prompts", async () => {
    const { ctx, calls } = createCtx()

    await connectProvider(ctx, "req", "azure", "sk-test", {
      resourceName: " my-resource ",
      empty: "   ",
    })

    expect(calls.set).toEqual([
      {
        providerID: "azure",
        auth: {
          type: "api",
          key: "sk-test",
          metadata: { resourceName: "my-resource" },
        },
      },
    ])
    expect(calls.refresh).toBe(1)
    expect(calls.posts).toContainEqual({ type: "providerConnected", requestId: "req", providerID: "azure" })
  })

  it("stores azure endpoint URL metadata from provider prompts", async () => {
    const { ctx, calls } = createCtx()

    await connectProvider(ctx, "req", "azure", "sk-test", {
      endpointType: "baseURL",
      baseURL: " https://my-resource.openai.azure.com/openai ",
      resourceName: "   ",
    })

    expect(calls.set).toEqual([
      {
        providerID: "azure",
        auth: {
          type: "api",
          key: "sk-test",
          metadata: {
            endpointType: "baseURL",
            baseURL: "https://my-resource.openai.azure.com/openai",
          },
        },
      },
    ])
  })
})

describe("saveCustomProvider", () => {
  it("uses a normal final disposal request after deferred writes", async () => {
    const calls: Options[] = []
    const ctx = buildActionContext(
      { global: { dispose: async (opts?: Options) => calls.push(opts ?? {}) } } as never,
      () => {},
      String,
      "/tmp",
      async () => {},
      "custom-provider:abc",
    )

    await ctx.disposeGlobal("custom provider save")

    expect(calls).toEqual([{ headers: { "x-kilo-memory-operation": "custom-provider:abc" } }])
  })

  it("defers config disposal until the single final refresh", async () => {
    const { ctx, calls, setCachedConfig } = createCtx()

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), undefined, false, null, setCachedConfig)

    expect(calls.configOptions[0]?.headers?.["x-kilo-defer-instance-dispose"]).toBe("1")
    expect(calls.configOptions[0]?.headers?.["x-kilo-memory-operation"]).toMatch(/^custom-provider:/)
    expect(calls.dispose).toBe(1)
    expect(calls.order).toEqual(["global.get", "global.update", "dispose", "config.get", "providers"])
  })

  it("preserves auth when the api key field is unchanged", async () => {
    const { ctx, calls, setCachedConfig } = createCtx()

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), undefined, false, null, setCachedConfig)

    expect(calls.set).toHaveLength(0)
    expect(calls.remove).toHaveLength(0)
    expect(calls.refresh).toBe(1)
  })

  it("clears auth when the api key field was intentionally cleared", async () => {
    const { ctx, calls, setCachedConfig } = createCtx()

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), undefined, true, null, setCachedConfig)

    expect(calls.set).toHaveLength(0)
    expect(calls.remove).toEqual([{ providerID: "myprovider" }])
  })

  it("stores a changed api key", async () => {
    const { ctx, calls, setCachedConfig } = createCtx()

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), " sk-test ", true, null, setCachedConfig)

    expect(calls.remove).toHaveLength(0)
    expect(calls.set).toEqual([{ providerID: "myprovider", auth: { type: "api", key: "sk-test" } }])
    expect(calls.setOptions[0]?.headers?.["x-kilo-defer-instance-dispose"]).toBe("1")
    expect(calls.order).toEqual(["global.get", "global.update", "auth.set", "dispose", "config.get", "providers"])
  })

  it("finalizes the saved config once when auth persistence fails", async () => {
    const { ctx, calls, setCachedConfig } = createCtx(undefined, undefined, new Error("auth failed"))

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), "sk-test", true, null, setCachedConfig)

    expect(calls.dispose).toBe(1)
    expect(calls.refresh).toBe(1)
    expect(calls.order).toEqual(["global.get", "global.update", "auth.set", "dispose", "config.get", "providers"])
  })

  // Regression tests for https://github.com/Kilo-Org/kilocode/issues/9186
  //
  // The CLI's config.update endpoint deep-merges its payload with the existing
  // global config. When the user removes a model or variant from a custom
  // provider and saves, the removed entry stays on disk because the save
  // payload only lists the surviving entries. stripNulls in the merge layer
  // will remove keys explicitly set to null — the save path must emit these
  // sentinels for removed model ids and variant names.
  it("emits null sentinels for models removed since last save", async () => {
    const existing = {
      disabled_providers: [],
      provider: {
        myprovider: {
          npm: "@ai-sdk/openai-compatible",
          name: "My Provider",
          options: { baseURL: "https://example.com/v1" },
          models: {
            "model-keep": { name: "Keep" },
            "model-gone": { name: "Gone" },
          },
        },
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx(existing)

    const next = {
      name: "My Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-keep": { name: "Keep" },
      },
    }
    await saveCustomProvider(ctx, "req", "myprovider", next, undefined, false, null, setCachedConfig)

    expect(calls.config).toHaveLength(1)
    const payload = calls.config[0].config.provider as Record<string, { models: Record<string, unknown> }>
    expect(payload.myprovider.models["model-keep"]).toBeDefined()
    expect(payload.myprovider.models["model-gone"]).toBeNull()
  })

  it("emits null sentinels for variants removed from a model that still exists", async () => {
    const existing = {
      disabled_providers: [],
      provider: {
        myprovider: {
          npm: "@ai-sdk/openai-compatible",
          name: "My Provider",
          options: { baseURL: "https://example.com/v1" },
          models: {
            "model-1": {
              name: "Model One",
              reasoning: true,
              variants: {
                high: { reasoningEffort: "high" },
                low: { reasoningEffort: "low" },
              },
            },
          },
        },
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx(existing)

    const next = {
      name: "My Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          reasoning: true,
          variants: { high: { reasoningEffort: "high" } },
        },
      },
    }
    await saveCustomProvider(ctx, "req", "myprovider", next, undefined, false, null, setCachedConfig)

    expect(calls.config).toHaveLength(1)
    const model = (
      calls.config[0].config.provider as Record<
        string,
        { models: Record<string, { variants?: Record<string, unknown> }> }
      >
    ).myprovider.models["model-1"]
    expect(model.variants).toBeDefined()
    expect(model.variants?.high).toBeDefined()
    expect(model.variants?.low).toBeNull()
  })

  it("does not emit sentinels when the provider is new", async () => {
    const { ctx, calls, setCachedConfig } = createCtx()

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), undefined, false, null, setCachedConfig)

    expect(calls.config).toHaveLength(1)
    const models = (calls.config[0].config.provider as Record<string, { models: Record<string, unknown> }>).myprovider
      .models
    expect(Object.values(models).every((v) => v !== null)).toBe(true)
  })

  it("removes saved custom providers from disabled_providers when reconnecting", async () => {
    const { ctx, calls, setCachedConfig } = createCtx({ disabled_providers: ["myprovider", "openai"] })

    await saveCustomProvider(ctx, "req", "myprovider", createProvider(), undefined, false, null, setCachedConfig)

    expect(calls.config).toHaveLength(1)
    expect(calls.config[0].config.disabled_providers).toEqual(["openai"])
  })
})

describe("disconnectProvider", () => {
  it("adds configured providers to disabled_providers without deleting their config", async () => {
    const existing = {
      disabled_providers: ["openai"],
      provider: {
        myprovider: createProvider(),
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx(existing)

    await disconnectProvider(ctx, "req", "myprovider", null, setCachedConfig)

    expect(calls.config).toHaveLength(1)
    expect(calls.config[0].config).toEqual({ disabled_providers: ["openai", "myprovider"] })
    expect(calls.remove).toEqual([{ providerID: "myprovider" }])
    expect(calls.refresh).toBe(1)
    expect(calls.posts).toContainEqual({ type: "providerDisconnected", requestId: "req", providerID: "myprovider" })
  })

  it("does not duplicate configured providers already disabled", async () => {
    const existing = {
      disabled_providers: ["myprovider"],
      provider: {
        myprovider: createProvider(),
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx(existing)

    await disconnectProvider(ctx, "req", "myprovider", null, setCachedConfig)

    expect(calls.config).toHaveLength(0)
    expect(calls.refresh).toBe(1)
  })

  it("deletes saved custom provider config when disconnecting", async () => {
    const existing = {
      disabled_providers: ["myprovider", "openai"],
      provider: {
        myprovider: createSavedProvider(),
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx(existing)

    await disconnectProvider(ctx, "req", "myprovider", null, setCachedConfig)

    expect(calls.config).toHaveLength(1)
    expect(calls.config[0].config).toEqual({
      provider: { myprovider: null },
      disabled_providers: ["openai"],
    })
    expect(calls.project).toEqual([{ config: { provider: { myprovider: null } }, directory: "/tmp" }])
    expect(calls.remove).toEqual([{ providerID: "myprovider" }])
    expect(calls.refresh).toBe(1)
  })

  it("deletes project custom provider config when it is not in global config", async () => {
    const merged = {
      provider: {
        myprovider: createSavedProvider(),
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx({ disabled_providers: [] }, merged)

    await disconnectProvider(ctx, "req", "myprovider", null, setCachedConfig)

    expect(calls.config).toHaveLength(0)
    expect(calls.project).toEqual([{ config: { provider: { myprovider: null } }, directory: "/tmp" }])
    expect(calls.remove).toEqual([{ providerID: "myprovider" }])
    expect(calls.refresh).toBe(1)
  })

  it("deletes both global and project custom provider config when project overrides global", async () => {
    const global = {
      disabled_providers: ["myprovider", "openai"],
      provider: {
        myprovider: createSavedProvider(),
      },
    }
    const merged = {
      ...global,
      provider: {
        myprovider: {
          ...createSavedProvider(),
          name: "Project Provider",
        },
      },
    }
    const { ctx, calls, setCachedConfig } = createCtx(global, merged)

    await disconnectProvider(ctx, "req", "myprovider", null, setCachedConfig)

    expect(calls.config).toEqual([
      {
        config: {
          provider: { myprovider: null },
          disabled_providers: ["openai"],
        },
      },
    ])
    expect(calls.project).toEqual([{ config: { provider: { myprovider: null } }, directory: "/tmp" }])
    expect(calls.remove).toEqual([{ providerID: "myprovider" }])
    expect(calls.refresh).toBe(1)
  })
})

describe("fetchProviderData", () => {
  it("derives api auth state and strips keys from provider payloads", async () => {
    const client = {
      provider: {
        list: async () => ({
          data: {
            all: [
              {
                id: "groq-test",
                name: "Groq Test",
                source: "config",
                key: "sk-test",
                env: [],
                models: {},
              },
            ],
            connected: ["groq-test"],
            default: { "groq-test": "llama-3.1-8b-instant" },
          },
        }),
        auth: async () => ({ data: {} }),
      },
    } as unknown as Parameters<typeof fetchProviderData>[0]

    const result = await fetchProviderData(client, "/tmp")
    const item = result.response.all[0] as Record<string, unknown>

    expect(result.authStates).toEqual({ "groq-test": "api" })
    expect("key" in item).toBe(false)
  })

  it("retains stripped keys for providers with a configured baseURL", async () => {
    const client = {
      provider: {
        list: async () => ({
          data: {
            all: [
              {
                id: "myprovider",
                name: "My Provider",
                source: "config",
                key: "sk-stored",
                env: [],
                options: { baseURL: "https://example.com/v1" },
                models: {},
              },
              {
                id: "no-url",
                name: "No URL",
                source: "config",
                key: "sk-other",
                env: [],
                models: {},
              },
            ],
            connected: [],
            default: {},
          },
        }),
        auth: async () => ({ data: {} }),
      },
    } as unknown as Parameters<typeof fetchProviderData>[0]

    const result = await fetchProviderData(client, "/tmp")

    expect(result.storedKeys).toEqual({
      myprovider: { key: "sk-stored", baseURL: "https://example.com/v1" },
    })
    expect(result.response.all.every((item) => !("key" in (item as Record<string, unknown>)))).toBe(true)
  })
})

describe("resolveStoredKey", () => {
  const storedKeys = {
    myprovider: { key: "sk-stored", baseURL: "https://example.com/v1" },
  }

  it("returns the stored key when the fetch URL matches the configured baseURL", () => {
    expect(resolveStoredKey(storedKeys, "myprovider", "https://example.com/v1")).toBe("sk-stored")
  })

  it("tolerates trailing-slash differences", () => {
    expect(resolveStoredKey(storedKeys, "myprovider", "https://example.com/v1/")).toBe("sk-stored")
  })

  it("refuses to apply the stored key to a different host or path", () => {
    expect(resolveStoredKey(storedKeys, "myprovider", "https://evil.example.net/v1")).toBeUndefined()
    expect(resolveStoredKey(storedKeys, "myprovider", "https://example.com/v2")).toBeUndefined()
  })

  it("returns undefined for unknown or missing provider ids", () => {
    expect(resolveStoredKey(storedKeys, "other", "https://example.com/v1")).toBeUndefined()
    expect(resolveStoredKey(storedKeys, undefined, "https://example.com/v1")).toBeUndefined()
    expect(resolveStoredKey(storedKeys, "", "https://example.com/v1")).toBeUndefined()
  })
})
