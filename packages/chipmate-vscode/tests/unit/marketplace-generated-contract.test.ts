import { describe, expect, it } from "bun:test"
import { MARKET_ENDPOINTS, MarketClient } from "../../src/services/marketplace/generated/market-client"

describe("Marketplace generated aligned-v1 contract", () => {
  it("uses the generated capabilities endpoint", async () => {
    expect(MARKET_ENDPOINTS).toContain("/api/v1/capabilities")
    const client = new MarketClient({
      baseUrl: "http://market.test",
      fetch: async () =>
        new Response(JSON.stringify({ mode: "aligned-v1" }), { headers: { "content-type": "application/json" } }),
    })
    const value = await client.request<{ mode: string }>("/api/v1/capabilities")
    expect(value.mode).toBe("aligned-v1")
  })
})
