import { describe, expect, it } from "bun:test"

import { MarketplaceApiClient } from "../../src/services/marketplace/api"

describe("MarketplaceApiClient", () => {
  it("uses a configured skill market baseUrl in skills-only mode", async () => {
    const urls: string[] = []
    const client = new MarketplaceApiClient({
      baseUrl: "http://market.test/marketplace/",
      skillsOnly: true,
      fetchText: async (url) => {
        urls.push(url)
        return JSON.stringify({
          items: [
            {
              id: "documents",
              description: "Document skill",
              category: "documents",
              githubUrl: "",
              content: "http://market.test/marketplace/skills/documents.tar.gz",
              uploadedBy: "caizh",
              downloadCount: 12,
              stars: 3,
            },
          ],
        })
      },
    })

    const result = await client.fetchAll()

    expect(urls).toEqual(["http://market.test/marketplace/skills"])
    expect(result.errors).toEqual([])
    expect(result.skillsFetched).toBe(true)
    expect(result.items).toEqual([
      {
        type: "skill",
        id: "documents",
        name: "Documents",
        displayName: "Documents",
        description: "Document skill",
        category: "documents",
        displayCategory: "Documents",
        githubUrl: "",
        content: "http://market.test/marketplace/skills/documents.tar.gz",
        author: "caizh",
        uploadedBy: "caizh",
        downloadCount: 12,
        stars: 3,
      },
    ])
  })

  it("keeps normal marketplace mode fetching agents, mcps, and skills", async () => {
    const urls: string[] = []
    const client = new MarketplaceApiClient({
      baseUrl: "http://market.test/marketplace",
      fetchText: async (url) => {
        urls.push(url)
        return JSON.stringify({ items: [] })
      },
    })

    await client.fetchAll()

    expect(urls.toSorted()).toEqual([
      "http://market.test/marketplace/agents",
      "http://market.test/marketplace/mcps",
      "http://market.test/marketplace/skills",
    ])
  })

  it("reports skills-only fetch failures in Chinese", async () => {
    const client = new MarketplaceApiClient({
      baseUrl: "http://market.test/marketplace",
      skillsOnly: true,
      fetchText: async () => {
        throw new Error("This operation was aborted")
      },
    })

    const result = await client.fetchAll()

    expect(result.items).toEqual([])
    expect(result.errors).toEqual(["获取技能市场失败：连接 ChipMate Server 超时或被中止"])
    expect(result.skillsFetched).toBe(false)
  })

  it("derives server baseUrl for ChipMate marketplace user resolver", () => {
    const client = new MarketplaceApiClient({ baseUrl: "http://market.test/marketplace/" })

    expect(client.marketplaceBaseUrl()).toBe("http://market.test/marketplace")
    expect(client.serverBaseUrl()).toBe("http://market.test")
  })
})
