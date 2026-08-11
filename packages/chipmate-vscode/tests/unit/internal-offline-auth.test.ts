import { describe, expect, it } from "bun:test"

import { handleInternalOfflineAuth } from "../../src/chipmate-provider/internal-offline-auth"

describe("internal offline auth guard", () => {
  it("does not intercept Gateway auth messages in public builds", () => {
    const sent: unknown[] = []

    expect(handleInternalOfflineAuth({ type: "login" }, (msg) => sent.push(msg), false)).toBe(false)
    expect(sent).toEqual([])
  })

  it("intercepts Gateway auth and profile messages in internal offline builds", () => {
    const sent: unknown[] = []

    expect(handleInternalOfflineAuth({ type: "login" }, (msg) => sent.push(msg), true)).toBe(true)
    expect(handleInternalOfflineAuth({ type: "refreshProfile" }, (msg) => sent.push(msg), true)).toBe(true)
    expect(handleInternalOfflineAuth({ type: "logout" }, (msg) => sent.push(msg), true)).toBe(true)
    expect(handleInternalOfflineAuth({ type: "setOrganization" }, (msg) => sent.push(msg), true)).toBe(true)

    expect(sent).toEqual([
      { type: "profileData", data: null },
      { type: "profileData", data: null },
      { type: "profileData", data: null },
      { type: "profileData", data: null },
    ])
  })

  it("clears pending device auth when cancel is received in internal offline builds", () => {
    const sent: unknown[] = []

    expect(handleInternalOfflineAuth({ type: "cancelLogin" }, (msg) => sent.push(msg), true)).toBe(true)

    expect(sent).toEqual([{ type: "deviceAuthCancelled" }])
  })

  it("lets unrelated messages continue", () => {
    const sent: unknown[] = []

    expect(handleInternalOfflineAuth({ type: "sendMessage" }, (msg) => sent.push(msg), true)).toBe(false)
    expect(sent).toEqual([])
  })
})
