import { describe, expect, it } from "bun:test"

import {
  MarketplaceApiError,
  marketplaceIdentityErrorMessage,
  marketplaceIssue,
  safeMarketplaceErrorText,
} from "../../src/services/marketplace/errors"

describe("marketplaceIdentityErrorMessage", () => {
  it("提示旧客户端必须升级", () => {
    expect(marketplaceIdentityErrorMessage(new Error("client-upgrade-required"))).toContain(
      "升级 ChipMate 插件",
    )
  })

  it("explains timeout or aborted requests in Chinese", () => {
    expect(marketplaceIdentityErrorMessage(new Error("This operation was aborted"))).toBe(
      "连接 ChipMate Server 超时或被中止。",
    )
  })

  it("提示 LDAP 市场会话已过期", () => {
    expect(marketplaceIdentityErrorMessage(new Error("marketplace-session-expired"))).toBe(
      "市场登录已过期，请重新使用 LDAP 登录。",
    )
  })

  it("保留 ChipMate Server 地址错误的结构化诊断", () => {
    const err = new MarketplaceApiError("server-url-invalid", {
      status: 502,
      reason: "invalid-url",
      requestId: "a1b2c3d4",
    })

    expect(marketplaceIdentityErrorMessage(err)).toContain("市场 baseUrl")
    expect(marketplaceIssue(err)).toEqual({
      summary: expect.stringContaining("市场 baseUrl"),
      status: 502,
      code: "server-url-invalid",
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
