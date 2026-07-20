import { describe, expect, it } from "bun:test"

import { identityState, serverFailure, serverState } from "../../src/services/marketplace/runtime"

const now = "2026-07-20T00:00:00.000Z"

describe("Marketplace runtime state", () => {
  it("supports all four server states", () => {
    expect({ status: "connecting", checkedAt: now }).toEqual({ status: "connecting", checkedAt: now })
    expect(serverState(undefined, [], now).status).toBe("connected")
    expect(serverState(undefined, ["packages unavailable"], now).status).toBe("degraded")
    expect(serverFailure(new Error("fetch failed"), now).status).toBe("failed")
  })

  it("maps a healthy status to connected", () => {
    expect(
      serverState(
        {
          ok: true,
          transport: "https",
          render: "ready",
          market: "ready",
          packages: "ready",
          warnings: [],
        },
        [],
        now,
      ),
    ).toEqual({ status: "connected", checkedAt: now })
  })

  it("keeps partial failures distinct from a total connection failure", () => {
    expect(serverState(undefined, ["packages unavailable"], now)).toMatchObject({
      status: "degraded",
      issue: { code: "marketplace-degraded" },
    })
    expect(serverFailure(new Error("fetch failed"), now)).toMatchObject({
      status: "failed",
      checkedAt: now,
    })
  })

  it("allows a connected server and an unverified identity at the same time", () => {
    const server = serverState(undefined, [], now)
    const identity = identityState("unverified", {
      now,
      issue: { summary: "当前提供商未配置 API Key。", code: "provider-api-key-missing" },
    })

    expect(server.status).toBe("connected")
    expect(identity.status).toBe("unverified")
  })

  it("supports all four identity states", () => {
    expect(
      [
        identityState("verifying", { now }),
        identityState("verified", { now }),
        identityState("unverified", { now }),
        identityState("failed", { now }),
      ].map((state) => state.status),
    ).toEqual(["verifying", "verified", "unverified", "failed"])
  })
})
