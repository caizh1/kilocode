import { describe, expect, it } from "bun:test"
import { isCurrentChipmateServerTest } from "../../src/shared/chipmate-server"

const source = await Bun.file(new URL("../../webview-ui/src/context/config.tsx", import.meta.url)).text()
const server = await Bun.file(
  new URL("../../webview-ui/src/components/settings/ChipmateServerTab.tsx", import.meta.url),
).text()
const provider = await Bun.file(new URL("../../src/KiloProvider.ts", import.meta.url)).text()

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

  it("keeps manual update checks and installation as separate request-correlated actions", () => {
    expect(server).toContain('type: "checkChipmateUpdate"')
    expect(server).toContain('type: "installChipmateUpdate"')
    expect(server).toContain('message.requestId !== updateRequest()')
    expect(server).toContain('data-ui="chipmate-update-notes"')
    expect(server).toContain('aria-live="assertive"')
    expect(server).toContain('data-ui="chipmate-update-error-message"')
    expect(server).toContain('data-ui="chipmate-update-copy-error"')
    expect(server).toContain('type: "showChipmateUpdateLog"')
    expect(server).toContain("safeError(result.message)")
    expect(provider).toContain('message.type === "checkChipmateUpdate"')
    expect(provider).toContain('message.type === "showChipmateUpdateLog"')
    expect(provider).toContain("getUpdateCheckService()?.showLog()")
    expect(provider).toContain("service.probeManual()")
    expect(provider).toContain('message.type !== "checkChipmateUpdate" && message.type !== "installChipmateUpdate"')
    expect(provider).toContain("service.installManual(message.candidateId)")
  })
})
