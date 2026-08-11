import { describe, expect, it } from "bun:test"

import {
  isPopularProvider,
  popularProviderIndex,
  providerNoteKey,
} from "../../webview-ui/src/components/settings/provider-catalog"

describe("provider catalog internal offline mode", () => {
  it("does not mark public providers as popular", () => {
    expect(isPopularProvider("openai", true)).toBe(false)
    expect(isPopularProvider("chipmate", true)).toBe(false)
  })

  it("pushes providers after the public priority list", () => {
    expect(popularProviderIndex("openai", true)).toBeGreaterThan(0)
  })

  it("hides public provider notes", () => {
    expect(providerNoteKey("chipmate", true)).toBeUndefined()
    expect(providerNoteKey("openai", true)).toBeUndefined()
  })
})
