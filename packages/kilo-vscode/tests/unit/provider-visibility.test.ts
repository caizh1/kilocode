import { describe, expect, it } from "bun:test"

import {
  disabledProviderOptions,
  providersWithKiloFallback,
  visibleConnectedIds,
} from "../../webview-ui/src/components/settings/provider-visibility"

describe("visibleConnectedIds", () => {
  it("hides Kilo from the connected list when auth is missing", () => {
    const ids = visibleConnectedIds(["kilo", "openrouter"], { openrouter: "api" })

    expect(ids).toEqual(["openrouter"])
  })

  it("keeps Kilo in the connected list when auth exists", () => {
    const ids = visibleConnectedIds(["kilo", "openrouter"], { kilo: "oauth", openrouter: "api" })

    expect(ids).toEqual(["kilo", "openrouter"])
  })

  it("leaves non-Kilo providers untouched", () => {
    const ids = visibleConnectedIds(["anthropic"], {})

    expect(ids).toEqual(["anthropic"])
  })

  it("always hides Kilo in internal offline mode", () => {
    const ids = visibleConnectedIds(["kilo", "openrouter"], { kilo: "oauth", openrouter: "api" }, true)

    expect(ids).toEqual(["openrouter"])
  })
})

describe("disabledProviderOptions", () => {
  it("includes Kilo and excludes already disabled providers", () => {
    const options = disabledProviderOptions(
      {
        kilo: { id: "kilo", name: "Kilo Gateway", env: [], models: {} },
        openai: { id: "openai", name: "OpenAI", env: [], models: {} },
        anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
      },
      ["openai"],
    )

    expect(options).toEqual([
      { value: "anthropic", label: "Anthropic" },
      { value: "kilo", label: "Kilo Gateway" },
    ])
  })

  it("sorts options by provider name", () => {
    const options = disabledProviderOptions(
      {
        zed: { id: "zed", name: "Zed", env: [], models: {} },
        alpha: { id: "alpha", name: "Alpha", env: [], models: {} },
      },
      [],
    )

    expect(options).toEqual([
      { value: "alpha", label: "Alpha" },
      { value: "zed", label: "Zed" },
    ])
  })

  it("omits Kilo from disabled options in internal offline mode", () => {
    const options = disabledProviderOptions(
      {
        kilo: { id: "kilo", name: "Kilo Gateway", env: [], models: {} },
        local: { id: "local", name: "Local Provider", env: [], models: {} },
      },
      [],
      true,
    )

    expect(options).toEqual([{ value: "local", label: "Local Provider" }])
  })
})

describe("providersWithKiloFallback", () => {
  it("adds Kilo when backend providers omit it", () => {
    const providers = providersWithKiloFallback({
      anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
    })

    expect(providers.kilo?.name).toBe("ChipMate Gateway")
    expect(providers.anthropic?.name).toBe("Anthropic")
  })

  it("keeps the backend Kilo provider when present", () => {
    const providers = providersWithKiloFallback({
      kilo: { id: "kilo", name: "Custom Kilo Name", env: [], models: {} },
    })

    expect(providers.kilo?.name).toBe("Custom Kilo Name")
  })

  it("does not add Kilo fallback in internal offline mode", () => {
    const providers = providersWithKiloFallback(
      {
        local: { id: "local", name: "Local Provider", env: [], models: {} },
      },
      true,
    )

    expect(providers.kilo).toBeUndefined()
    expect(providers.local?.name).toBe("Local Provider")
  })
})
