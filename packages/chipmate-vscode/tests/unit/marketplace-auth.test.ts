import { afterEach, describe, expect, it, mock } from "bun:test"
import { createHash } from "node:crypto"
import type * as vscode from "vscode"
import { MarketplaceAuth } from "../../src/services/marketplace/auth"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("MarketplaceAuth", () => {
  it("按 Server Origin 隔离凭据，并在切换时撤销旧会话", async () => {
    const oldOrigin = "https://old.example.com"
    const nextOrigin = "https://new.example.com"
    const oldKey = key(oldOrigin)
    const values = new Map<string, string>([
      ["chipmate.v2.marketplace.ldap.active-origin", oldOrigin],
      [oldKey, JSON.stringify({
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token",
        accessExpiresAt: Date.now() + 60_000,
        refreshExpiresAt: Date.now() + 60_000,
        user: { name: "Alice" },
      })],
    ])
    const requests: Array<{ url: string; authorization?: string }> = []
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        ...(typeof init?.headers === "object" && !Array.isArray(init.headers)
          ? { authorization: (init.headers as Record<string, string>).authorization }
          : {}),
      })
      return new Response(null, { status: 204 })
    }) as typeof fetch
    const secrets = {
      get: async (name: string) => values.get(name),
      store: async (name: string, value: string) => void values.set(name, value),
      delete: async (name: string) => void values.delete(name),
    } as unknown as vscode.SecretStorage
    const auth = new MarketplaceAuth(secrets, () => nextOrigin)

    expect(await auth.access(false)).toBeUndefined()
    expect(requests).toEqual([
      { url: `${oldOrigin}/api/v1/auth/token/revoke`, authorization: "Bearer old-access-token" },
    ])
    expect(values.has(oldKey)).toBeFalse()
    expect(values.get("chipmate.v2.marketplace.ldap.active-origin")).toBe(nextOrigin)
  })

  it("受保护请求遇到 401 时只轮换一次并重试一次", async () => {
    const origin = "https://market.example.com"
    const values = new Map<string, string>([
      ["chipmate.v2.marketplace.ldap.active-origin", origin],
      [key(origin), JSON.stringify({
        accessToken: "expired-access",
        refreshToken: "refresh-once",
        accessExpiresAt: Date.now() + 60_000,
        refreshExpiresAt: Date.now() + 60_000,
        user: { name: "Alice" },
      })],
    ])
    let refreshes = 0
    globalThis.fetch = mock(async () => {
      refreshes += 1
      return new Response(JSON.stringify({
        accessToken: "fresh-access",
        refreshToken: "fresh-refresh",
        expiresIn: 900,
        refreshExpiresIn: 2_592_000,
        user: { displayName: "Alice" },
      }), { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch
    const secrets = {
      get: async (name: string) => values.get(name),
      store: async (name: string, value: string) => void values.set(name, value),
      delete: async (name: string) => void values.delete(name),
    } as unknown as vscode.SecretStorage
    const auth = new MarketplaceAuth(secrets, () => origin)
    const attempts: string[] = []
    const result = await auth.authorized(async (token) => {
      attempts.push(token)
      if (token === "expired-access") throw Object.assign(new Error("过期"), { status: 401 })
      return "完成"
    })

    expect(result).toBe("完成")
    expect(attempts).toEqual(["expired-access", "fresh-access"])
    expect(refreshes).toBe(1)
  })
})

function key(origin: string) {
  return `chipmate.v2.marketplace.ldap.${createHash("sha256").update(origin).digest("hex")}`
}
