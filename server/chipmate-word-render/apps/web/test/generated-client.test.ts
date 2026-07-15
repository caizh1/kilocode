import assert from "node:assert/strict"
import test from "node:test"
import { MARKET_ENDPOINTS, MarketClient } from "../src/generated/market-client.ts"

test("generated Web client exposes aligned-v1 capabilities", async () => {
  assert.ok(MARKET_ENDPOINTS.includes("/api/v1/capabilities"))
  const client = new MarketClient({
    baseUrl: "http://market.test",
    fetch: async () =>
      new Response(JSON.stringify({ mode: "legacy" }), { headers: { "content-type": "application/json" } }),
  })
  const value = await client.request<{ mode: string }>("/api/v1/capabilities")
  assert.equal(value.mode, "legacy")
})
