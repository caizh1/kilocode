import { describe, expect, it } from "bun:test"
import { sanitize } from "../../src/shared/update-check"

describe("更新错误详情脱敏", () => {
  it("隐藏认证信息和 URL 查询参数，同时保留校验散列", () => {
    const hash = "a".repeat(64)
    const value = sanitize(
      `Bearer token-value sk-provider-secret apiKey=private-value https://server.test/packages/a.vsix?token=query ${hash}`,
    )

    expect(value).toContain("Bearer [已隐藏]")
    expect(value).toContain("apiKey=[已隐藏]")
    expect(value).toContain("https://server.test/packages/a.vsix")
    expect(value).toContain(hash)
    expect(value).not.toContain("token-value")
    expect(value).not.toContain("sk-provider-secret")
    expect(value).not.toContain("token=query")
    expect(value).not.toContain("private-value")
  })
})
