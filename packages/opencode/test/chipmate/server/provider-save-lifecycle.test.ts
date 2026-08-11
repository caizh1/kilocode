import { describe, expect, test } from "bun:test"
import * as ProviderSave from "../../../src/chipmate/server/provider-save-lifecycle"

describe("custom provider save lifecycle", () => {
  test("uses the internal header only when the extension asks to defer disposal", () => {
    expect(ProviderSave.deferred(new Headers())).toBe(false)
    expect(ProviderSave.deferred(new Headers({ [ProviderSave.DEFER_HEADER]: "1" }))).toBe(true)
    expect(ProviderSave.deferred(new Headers({ [ProviderSave.DEFER_HEADER]: "true" }))).toBe(false)
  })

  test("keeps default config updates on their existing disposal path", () => {
    expect(ProviderSave.options(false, false)).toBeUndefined()
    expect(ProviderSave.options(true, false)).toEqual({ dispose: false, deferred: false })
    expect(ProviderSave.options(false, true)).toEqual({ dispose: false, deferred: true })
  })
})
