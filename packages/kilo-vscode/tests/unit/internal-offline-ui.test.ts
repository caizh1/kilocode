import { describe, expect, it } from "bun:test"

import { canUseGatewayUi, gatewayTarget } from "../../webview-ui/src/utils/internal-offline-ui"

describe("internal offline webview gateway UI", () => {
  it("keeps Gateway UI available in public builds", () => {
    expect(canUseGatewayUi(false)).toBe(true)
    expect(gatewayTarget(false)).toEqual({ view: "profile" })
  })

  it("redirects Gateway login entry points to Providers in internal offline builds", () => {
    expect(canUseGatewayUi(true)).toBe(false)
    expect(gatewayTarget(true)).toEqual({ view: "settings", tab: "providers" })
  })
})
