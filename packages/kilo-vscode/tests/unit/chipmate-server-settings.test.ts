import { describe, expect, it } from "bun:test"
import { isCurrentChipmateServerTest } from "../../src/shared/chipmate-server"

const source = await Bun.file(new URL("../../webview-ui/src/context/config.tsx", import.meta.url)).text()

describe("ChipMate Server settings flow", () => {
  it("requests settings independently of the CLI configuration response", () => {
    expect(source).toContain('vscode.postMessage({ type: "requestChipmateServerSettings" })')
    expect(source).toContain('message.type === "chipmateServerSettingsLoaded"')
  })

  it("keeps setting drafts until a matching save confirmation arrives", () => {
    expect(source).toContain('message.type === "settingUpdated"')
    expect(source).toContain("message.requestId !== request()")
    expect(source).toContain("delete next[message.key]")
    expect(source).toContain('message.type !== "settingUpdateFailed"')
    expect(source).toContain("setPendingSettings(new Set<string>())")
    expect(source).toContain("setSaveError({ message: message.message })")
  })

  it("accepts only the latest connection-test response", () => {
    expect(isCurrentChipmateServerTest("latest", "stale")).toBeFalse()
    expect(isCurrentChipmateServerTest("latest", "latest")).toBeTrue()
    expect(isCurrentChipmateServerTest(undefined, "latest")).toBeFalse()
  })
})
