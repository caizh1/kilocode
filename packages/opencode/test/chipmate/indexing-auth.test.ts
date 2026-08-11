import { describe, expect, test } from "bun:test"
import {
  hasChipMateIndexingAuth,
  resolveChipMateIndexingAuth,
  shouldDefaultIndexingToChipMate,
} from "../../src/chipmate/indexing-auth"

describe("ChipMate indexing auth resolution", () => {
  test("detects auth from explicit indexing ChipMate config", () => {
    const auth = resolveChipMateIndexingAuth({
      config: { indexing: { chipmate: { apiKey: "idx-token", baseUrl: "https://idx.test", organizationId: "org_idx" } } },
    })

    expect(auth).toEqual({ apiKey: "idx-token", baseUrl: "https://idx.test", organizationId: "org_idx" })
    expect(hasChipMateIndexingAuth({ config: { indexing: { chipmate: { apiKey: "idx-token" } } } })).toBe(true)
  })

  test("detects auth from provider config, provider state, auth storage, and env", () => {
    expect(
      resolveChipMateIndexingAuth({ config: { provider: { chipmate: { options: { apiKey: "cfg-token" } } } } }).apiKey,
    ).toBe("cfg-token")
    expect(resolveChipMateIndexingAuth({ provider: { options: { chipmateToken: "provider-token" } } }).apiKey).toBe(
      "provider-token",
    )
    expect(resolveChipMateIndexingAuth({ auth: { type: "oauth", access: "oauth-token", accountId: "org_oauth" } })).toEqual(
      {
        apiKey: "oauth-token",
        organizationId: "org_oauth",
      },
    )
    expect(resolveChipMateIndexingAuth({ env: { CHIPMATE_API_KEY: "env-token", CHIPMATE_ORG_ID: "org_env" } })).toEqual({
      apiKey: "env-token",
      organizationId: "org_env",
    })
  })

  test("defaults to ChipMate only when no provider or other embedder config is present", () => {
    const auth = { apiKey: "chipmate-token" }

    expect(shouldDefaultIndexingToChipMate({}, auth)).toBe(true)
    expect(shouldDefaultIndexingToChipMate({ provider: "openai" }, auth)).toBe(false)
    expect(shouldDefaultIndexingToChipMate({ openai: { apiKey: "openai-key" } }, auth)).toBe(false)
    expect(shouldDefaultIndexingToChipMate({ ollama: { baseUrl: "http://localhost:11434" } }, auth)).toBe(false)
  })
})
