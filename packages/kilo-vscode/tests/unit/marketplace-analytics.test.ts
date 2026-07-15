import { describe, expect, it } from "bun:test"
import { MarketplaceAnalytics, type MarketEvent } from "../../src/services/marketplace/analytics"

describe("Marketplace analytics batching", () => {
  it("batches pseudonymous interaction metadata without credentials or workspace paths", async () => {
    const batches: MarketEvent[][] = []
    const analytics = new MarketplaceAnalytics(
      async (items, key) => {
        expect(key).toBe("transient-key")
        batches.push(items)
      },
      async () => "client-0000000001",
      async () => "transient-key",
    )

    await analytics.track("skill_install", {
      skillId: "documents",
      revision: 2,
      context: { source: "marketplace-panel" },
    })
    await analytics.track("market_search", { context: { hasQuery: true, queryLength: 8 } })
    await analytics.flush()

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    expect(batches[0]?.[0]).toMatchObject({
      name: "skill_install",
      surface: "vscode",
      userId: "server-derived-user",
      clientId: "client-0000000001",
      skillId: "documents",
      revision: 2,
    })
    expect(JSON.stringify(batches)).not.toContain("transient-key")
    expect(JSON.stringify(batches)).not.toContain("workspace")
    analytics.dispose()
  })
})
