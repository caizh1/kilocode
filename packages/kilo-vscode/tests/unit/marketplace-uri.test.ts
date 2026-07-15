import { describe, expect, it } from "bun:test"
import { archiveUrl, installLink, repairLink } from "../../src/services/marketplace/uri"

describe("Marketplace install URI security", () => {
  it("accepts only the configured origin and one-time token shape", () => {
    const token = "a".repeat(43)
    expect(
      installLink(
        {
          scheme: "vscode",
          authority: "chipmate.chipmate",
          path: "/marketplace/install",
          query: `origin=http%3A%2F%2Fmarket.test&token=${token}`,
        },
        "http://market.test",
      ),
    ).toEqual({ origin: "http://market.test", token })
    expect(
      installLink(
        {
          scheme: "vscode",
          authority: "chipmate.chipmate",
          path: "/marketplace/install",
          query: `origin=http%3A%2F%2Fevil.test&token=${token}`,
        },
        "http://market.test",
      ),
    ).toBeUndefined()
    expect(
      installLink(
        {
          scheme: "vscode",
          authority: "chipmate.chipmate",
          path: "/marketplace/install",
          query: "origin=http%3A%2F%2Fmarket.test&token=short",
        },
        "http://market.test",
      ),
    ).toBeUndefined()
  })

  it("rejects cross-origin and non-release archive download URLs", () => {
    expect(archiveUrl("http://market.test", "/api/v1/skills/docs/releases/2/archive")).toBe(
      "http://market.test/api/v1/skills/docs/releases/2/archive",
    )
    expect(archiveUrl("http://market.test", "http://evil.test/api/v1/skills/docs/releases/2/archive")).toBeUndefined()
    expect(archiveUrl("http://market.test", "/marketplace/skills/docs.tar.gz")).toBeUndefined()
  })

  it("accepts repair links only for the configured origin and publication run shape", () => {
    const runId = "publication-12345678-1234-1234-1234-123456789012"
    expect(
      repairLink(
        {
          scheme: "vscode",
          authority: "chipmate.chipmate",
          path: "/marketplace/repair",
          query: `origin=http%3A%2F%2Fmarket.test&runId=${runId}`,
        },
        "http://market.test",
      ),
    ).toEqual({ origin: "http://market.test", runId })
    expect(
      repairLink(
        {
          scheme: "vscode",
          authority: "chipmate.chipmate",
          path: "/marketplace/repair",
          query: `origin=http%3A%2F%2Fevil.test&runId=${runId}`,
        },
        "http://market.test",
      ),
    ).toBeUndefined()
  })
})
