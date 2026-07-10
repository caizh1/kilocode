import { describe, expect, it } from "bun:test"

import { marketplaceIdentityErrorMessage } from "../../src/services/marketplace/errors"

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
})
