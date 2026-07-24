import { describe, expect, it } from "bun:test"
import {
  ChipmateServerUrlError,
  deriveChipmateServerEndpoints,
  extractChipmateServerOrigin,
  normalizeChipmateServerBaseUrl,
} from "../../src/shared/chipmate-server"

describe("ChipMate Server URL", () => {
  it.each([
    ["server.test:6001", "http://server.test:6001"],
    [" http://example.test:6001/ ", "http://example.test:6001"],
    ["https://example.test:7443", "https://example.test:7443"],
    ["[2001:db8::1]:6001", "http://[2001:db8::1]:6001"],
    ["https://[2001:db8::2]:7443/", "https://[2001:db8::2]:7443"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeChipmateServerBaseUrl(input)).toBe(expected)
  })

  it.each([
    "",
    "example.test",
    "ftp://example.test:21",
    "http://user@example.test:6001",
    "http://example.test:6001/v1",
    "http://example.test:6001?mode=test",
    "http://example.test:6001#health",
  ])("rejects %s", (input) => {
    expect(() => normalizeChipmateServerBaseUrl(input)).toThrow(ChipmateServerUrlError)
  })

  it("derives every internal endpoint from one origin", () => {
    expect(deriveChipmateServerEndpoints("server.test:6001")).toEqual({
      marketplace: "http://server.test:6001/marketplace",
      word: "http://server.test:6001/render/word",
      mermaid: "http://server.test:6001/render/mermaid",
      plantuml: "http://server.test:6001/render/plantuml",
      health: "http://server.test:6001/health",
      updates: "http://server.test:6001/packages/manifest.json",
    })
  })

  it("extracts a legacy endpoint origin only for the expected route", () => {
    expect(extractChipmateServerOrigin("http://server.test:6001/render/word", "/render/word")).toBe(
      "http://server.test:6001",
    )
    expect(extractChipmateServerOrigin("http://server.test:6001/render/mermaid", "/render/word")).toBeUndefined()
  })
})
