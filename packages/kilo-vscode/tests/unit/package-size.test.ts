import { describe, expect, it } from "bun:test"
import { LEGACY_UPDATE_MAX_BYTES, verifyLegacyUpdatePackageSize } from "../../script/package-size"

describe("internal VSIX package size", () => {
  it("accepts Windows packages at the legacy auto-update limit", () => {
    expect(() => verifyLegacyUpdatePackageSize("win32-x64-baseline", LEGACY_UPDATE_MAX_BYTES)).not.toThrow()
  })

  it("rejects Windows packages that old clients cannot download", () => {
    expect(() => verifyLegacyUpdatePackageSize("win32-x64-baseline", LEGACY_UPDATE_MAX_BYTES + 1)).toThrow(
      "exceeds the legacy auto-update limit",
    )
  })

  it("does not apply the Windows bootstrap limit to other targets", () => {
    expect(() => verifyLegacyUpdatePackageSize("linux-x64-baseline", LEGACY_UPDATE_MAX_BYTES + 1)).not.toThrow()
  })
})
