import { describe, expect, it } from "bun:test"
import { createServer } from "http"

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

    expect(urls).toEqual(["http://market.test/api/v1/capabilities", "http://market.test/marketplace/skills"])
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
      "http://market.test/api/v1/capabilities",
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

  it("uses the aligned revision-pinned catalog when capabilities advertise aligned-v1", async () => {
    const urls: string[] = []
    const client = new MarketplaceApiClient({
      baseUrl: "http://market.test/marketplace",
      skillsOnly: true,
      fetchText: async (url) => {
        urls.push(url)
        if (url.endsWith("/api/v1/capabilities")) return JSON.stringify(capabilities())
        return JSON.stringify({
          items: [
            {
              id: "documents",
              name: "Documents",
              description: "Document skill",
              category: "documents",
              author: { displayName: "Alice" },
              latestRevision: 4,
              sha256: "a".repeat(64),
              downloads: 12,
              favorites: 3,
              tags: ["docs"],
              risk: { level: "medium", issueCount: 2, policyVersion: "skill-risk-v2" },
            },
          ],
          catalogVersion: "v1",
        })
      },
    })

    const result = await client.fetchAll()

    expect(urls).toEqual(["http://market.test/api/v1/capabilities", "http://market.test/api/v1/skills?limit=100"])
    expect(result.items[0]).toMatchObject({
      id: "documents",
      revision: 4,
      sha256: "a".repeat(64),
      content: "http://market.test/api/v1/skills/documents/releases/4/archive",
      risk: { level: "medium", issueCount: 2, policyVersion: "skill-risk-v2" },
    })
  })

  it("publishes binary archives with Bearer identity and idempotency", async () => {
    const seen: { authorization?: string; idempotency?: string; body?: Buffer } = {}
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      req.on("end", () => {
        seen.authorization = req.headers.authorization
        seen.idempotency = req.headers["idempotency-key"] as string | undefined
        seen.body = Buffer.concat(chunks)
        res.setHeader("content-type", "application/json")
        res.end(
          JSON.stringify({
            id: "publication-1",
            ownerId: "market-user",
            status: "PUBLISHED",
            stage: "complete",
            patches: [],
            createdAt: "2026-07-12T00:00:00.000Z",
            updatedAt: "2026-07-12T00:00:00.000Z",
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server did not start")
    try {
      const origin = `http://127.0.0.1:${address.port}`
      const client = new MarketplaceApiClient({
        baseUrl: `${origin}/marketplace`,
        fetchText: async () => JSON.stringify(capabilities()),
      })
      const run = await client.publishArchive(Buffer.from("archive-bytes"), "secret-key", "idempotency-key-1")
      expect(run.status).toBe("PUBLISHED")
      expect(seen.authorization).toBe("Bearer secret-key")
      expect(seen.idempotency).toBe("idempotency-key-1")
      expect(seen.body?.toString()).toBe("archive-bytes")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("loads aligned detail, synchronized installations, publications, status, and capabilities", async () => {
    const seen: string[] = []
    const server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`)
      res.setHeader("content-type", "application/json")
      if (req.url === "/api/v1/skills/documents") {
        res.end(
          JSON.stringify({
            id: "documents",
            name: "Documents",
            description: "Docs",
            category: "documents",
            tags: [],
            author: { id: "user-1", displayName: "Alice" },
            latestRevision: 1,
            sha256: "a".repeat(64),
            updatedAt: "2026-07-12T00:00:00.000Z",
            downloads: 1,
            favorites: 1,
            risk: { level: "unknown", issueCount: 0 },
            markdown: "# Docs",
            releases: [],
            files: [],
          }),
        )
        return
      }
      if (req.url === "/api/v1/me/installations") {
        res.end(
          JSON.stringify([
            {
              skillId: "documents",
              revision: 1,
              sha256: "a".repeat(64),
              scope: "global",
              status: "installed",
              clientId: "client-1",
              changedAt: "2026-07-12T00:00:00.000Z",
            },
          ]),
        )
        return
      }
      if (req.url === "/api/v1/me/publications") {
        res.end(
          JSON.stringify([
            {
              id: "run-1",
              ownerId: "user-1",
              status: "PUBLISHED",
              stage: "complete",
              patches: [],
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ]),
        )
        return
      }
      if (req.method === "POST" && req.url === "/api/v1/skills/documents/unpublish") {
        res.end(
          JSON.stringify({
            id: "run-2",
            skillId: "documents",
            ownerId: "user-1",
            status: "UNPUBLISHED",
            stage: "complete",
            patches: [],
            createdAt: "2026-07-12T01:00:00.000Z",
            updatedAt: "2026-07-12T01:00:00.000Z",
          }),
        )
        return
      }
      if (req.url === "/api/v1/analytics/overview") {
        res.end(JSON.stringify([{ metric: "skill_open", scope: "global", points: [{ date: "2026-07-12", value: 2 }] }]))
        return
      }
      res.end(
        JSON.stringify({
          ok: true,
          transport: "trusted-http",
          render: "ready",
          market: "ready",
          packages: "ready",
          warnings: [],
        }),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server did not start")
    try {
      const origin = `http://127.0.0.1:${address.port}`
      const client = new MarketplaceApiClient({
        baseUrl: `${origin}/marketplace`,
        fetchText: async () => JSON.stringify(capabilities()),
      })
      expect((await client.capabilities())?.features.versions).toBe(true)
      expect((await client.capabilities())?.skillSpecVersion).toBe("agent-skills-1")
      expect((await client.skill("documents")).markdown).toBe("# Docs")
      expect((await client.installations("key"))[0]?.status).toBe("installed")
      expect((await client.publications("key"))[0]?.status).toBe("PUBLISHED")
      expect((await client.unpublishSkill("documents", "key")).status).toBe("UNPUBLISHED")
      expect((await client.analytics("key"))[0]?.points[0]?.value).toBe(2)
      expect((await client.status()).market).toBe("ready")
      expect(seen.filter((entry) => entry.endsWith("Bearer key")).length).toBe(4)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("reconnects SSE with Last-Event-ID and catalogVersion compensation", async () => {
    const seen: Array<{ url: string; id?: string }> = []
    const server = createServer((req, res) => {
      seen.push({
        url: req.url ?? "",
        ...(typeof req.headers["last-event-id"] === "string" ? { id: req.headers["last-event-id"] } : {}),
      })
      res.writeHead(200, { "content-type": "text/event-stream" })
      if (seen.length === 1) {
        res.end('id: event-1\nevent: catalog.invalidated\ndata: {"catalogVersion":"v2"}\n\n')
        return
      }
      res.end('id: event-2\nevent: analytics.updated\ndata: {"accepted":1}\n\n')
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server did not start")
    const client = new MarketplaceApiClient({ baseUrl: `http://127.0.0.1:${address.port}/marketplace` })
    const names: string[] = []
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("SSE reconnect timed out")), 3_000)
        const unsubscribe = client.subscribe((name) => {
          names.push(name)
          if (names.length < 2) return
          clearTimeout(timer)
          unsubscribe()
          resolve()
        })
      })
      expect(names).toEqual(["catalog.invalidated", "analytics.updated"])
      expect(seen[1]).toEqual({ url: "/api/v1/market/stream?catalogVersion=v2", id: "event-1" })
    } finally {
      client.dispose()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

function capabilities() {
  return {
    mode: "aligned-v1",
    apiVersion: "1.0.0",
    catalogVersion: "v1",
    skillSpecVersion: "agent-skills-1",
    features: {
      versions: true,
      favorites: true,
      installations: true,
      publications: true,
      repairs: true,
      analytics: true,
      events: true,
    },
  }
}
