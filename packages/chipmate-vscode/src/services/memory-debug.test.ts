import { describe, expect, test } from "bun:test"
import { deferredHeader, parseCrash, redact, redactText } from "./memory-debug"

describe("memory debug diagnostics", () => {
  test("extracts Bun crash memory counters from stderr", () => {
    const data = parseCrash([
      "Elapsed: 76156162ms | User: 27880739ms | Sys: 14806010ms",
      "RSS: 5.24GB | Peak: 23.10GB | Commit: 5.24GB | Faults: 0",
    ])
    expect(data).toEqual({
      elapsed: "76156162ms",
      user: "27880739ms",
      sys: "14806010ms",
      rss: "5.24GB",
      peak: "23.10GB",
      commit: "5.24GB",
    })
  })

  test("redacts credentials and never records raw provider config fields", () => {
    expect(
      redact({ apiKey: "secret", config: { model: "private" }, configKeys: ["provider"], provider: "abc" }),
    ).toEqual({
      configKeys: ["provider"],
      provider: "abc",
    })
    expect(redactText("Bearer abcdefghijklmnopqrstuvwxyz0123456789")).toContain("[redacted]")
  })

  test("marks only custom provider writes as deferred instance disposal", () => {
    expect(deferredHeader("custom-provider:abc")).toEqual({
      "x-chipmate-memory-operation": "custom-provider:abc",
      "x-chipmate-defer-instance-dispose": "1",
    })
  })
})
