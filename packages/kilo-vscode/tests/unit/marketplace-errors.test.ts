import { describe, expect, it } from "bun:test"

import {
  MarketplaceApiError,
  marketplaceIdentityErrorMessage,
  marketplaceIssue,
  safeMarketplaceErrorText,
} from "../../src/services/marketplace/errors"

describe("marketplaceIdentityErrorMessage", () => {
  it("explains disabled token resolver in Chinese", () => {
    expect(marketplaceIdentityErrorMessage(new Error("token-resolver-disabled"))).toContain(
      "未启用 New API token resolver",
    )
  })

  it("explains timeout or aborted requests in Chinese", () => {
    expect(marketplaceIdentityErrorMessage(new Error("This operation was aborted"))).toBe(
      "连接 ChipMate Server 超时或被中止。",
    )
  })

  it("explains missing token identity in Chinese", () => {
    expect(marketplaceIdentityErrorMessage(new Error("token-not-found"))).toBe(
      "当前 API Key 没有匹配到 @chipmate 用户。",
    )
  })

  it("preserves structured 502 diagnostics for an invalid New API URL", () => {
    const err = new MarketplaceApiError("new-api-error", {
      status: 502,
      reason: "invalid-url",
      requestId: "a1b2c3d4",
    })

    expect(marketplaceIdentityErrorMessage(err)).toContain("NEW_API_BASE_URL")
    expect(marketplaceIssue(err)).toEqual({
      summary: expect.stringContaining("NEW_API_BASE_URL"),
      status: 502,
      code: "new-api-error",
      reason: "invalid-url",
      requestId: "a1b2c3d4",
      retryAfter: undefined,
      upstreamStatus: undefined,
    })
  })

  it("redacts credentials and URLs before messages reach the webview", () => {
    const text = safeMarketplaceErrorText(
      "Bearer secret-value sk-sensitive123 https://new-api.example/v1?token=secret admin_token=plain-secret",
    )

    expect(text).not.toContain("secret-value")
    expect(text).not.toContain("sk-sensitive123")
    expect(text).not.toContain("new-api.example")
    expect(text).not.toContain("plain-secret")
  })
})
