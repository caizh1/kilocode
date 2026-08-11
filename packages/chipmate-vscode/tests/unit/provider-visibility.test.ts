import { describe, expect, it } from "bun:test"

import {
  disabledProviderOptions,
  providersWithChipMateFallback,
  visibleConnectedIds,
} from "../../webview-ui/src/components/settings/provider-visibility"

describe("visibleConnectedIds", () => {
  it("hides ChipMate from the connected list when auth is missing", () => {
    const ids = visibleConnectedIds(["chipmate", "openrouter"], { openrouter: "api" })

    expect(ids).toEqual(["openrouter"])
  })

  it("keeps ChipMate in the connected list when auth exists", () => {
    const ids = visibleConnectedIds(["chipmate", "openrouter"], { chipmate: "oauth", openrouter: "api" })

    expect(ids).toEqual(["chipmate", "openrouter"])
  })

  it("leaves non-ChipMate providers untouched", () => {
    const ids = visibleConnectedIds(["anthropic"], {})

    expect(ids).toEqual(["anthropic"])
  })

  it("always hides ChipMate in internal offline mode", () => {
    const ids = visibleConnectedIds(["chipmate", "openrouter"], { chipmate: "oauth", openrouter: "api" }, true)

    expect(ids).toEqual(["openrouter"])
  })
})

describe("disabledProviderOptions", () => {
  it("includes ChipMate and excludes already disabled providers", () => {
    const options = disabledProviderOptions(
      {
        chipmate: { id: "chipmate", name: "ChipMate Gateway", env: [], models: {} },
        openai: { id: "openai", name: "OpenAI", env: [], models: {} },
        anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
      },
      ["openai"],
    )

    expect(options).toEqual([
      { value: "anthropic", label: "Anthropic" },
      { value: "chipmate", label: "ChipMate Gateway" },
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

  it("omits ChipMate from disabled options in internal offline mode", () => {
    const options = disabledProviderOptions(
      {
        chipmate: { id: "chipmate", name: "ChipMate Gateway", env: [], models: {} },
        local: { id: "local", name: "Local Provider", env: [], models: {} },
      },
      [],
      true,
    )

    expect(options).toEqual([{ value: "local", label: "Local Provider" }])
  })
})

describe("providersWithChipMateFallback", () => {
  it("adds ChipMate when backend providers omit it", () => {
    const providers = providersWithChipMateFallback({
      anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
    })

    expect(providers.chipmate?.name).toBe("ChipMate Gateway")
    expect(providers.anthropic?.name).toBe("Anthropic")
  })

  it("keeps the backend ChipMate provider when present", () => {
    const providers = providersWithChipMateFallback({
      chipmate: { id: "chipmate", name: "Custom ChipMate Name", env: [], models: {} },
    })

    expect(providers.chipmate?.name).toBe("Custom ChipMate Name")
  })

  it("does not add ChipMate fallback in internal offline mode", () => {
    const providers = providersWithChipMateFallback(
      {
        local: { id: "local", name: "Local Provider", env: [], models: {} },
      },
      true,
    )

    expect(providers.chipmate).toBeUndefined()
    expect(providers.local?.name).toBe("Local Provider")
  })
})
