import { describe, expect, it } from "bun:test"

const settings = await Bun.file(
  new URL("../../webview-ui/src/components/settings/Settings.tsx", import.meta.url),
).text()
const server = await Bun.file(
  new URL("../../webview-ui/src/components/settings/ChipmateServerTab.tsx", import.meta.url),
).text()
const styles = await Bun.file(new URL("../../webview-ui/src/styles/settings.css", import.meta.url)).text()
const titanium = await Bun.file(new URL("../../webview-ui/src/styles/titanium-studio.css", import.meta.url)).text()
const stories = await Bun.file(new URL("../../webview-ui/src/stories/settings.stories.tsx", import.meta.url)).text()
const app = await Bun.file(new URL("../../webview-ui/src/App.tsx", import.meta.url)).text()
const messages = await Bun.file(
  new URL("../../webview-ui/src/types/messages/webview-messages.ts", import.meta.url),
).text()
const editor = await Bun.file(new URL("../../src/SettingsEditorProvider.ts", import.meta.url)).text()
const zh = await Bun.file(new URL("../../webview-ui/src/i18n/zh.ts", import.meta.url)).text()

describe("Settings UI alignment", () => {
  it("keeps the locked navigation order and Codicon mapping", () => {
    const actual = Array.from(settings.matchAll(/\{ id: "([^"]+)", key: "[^"]+", icon: "([^"]+)"/g), (item) => [
      item[1],
      item[2],
    ])
    expect(actual).toEqual([
      ["models", "package"],
      ["providers", "plug"],
      ["chipmateServer", "server"],
      ["agentBehaviour", "hubot"],
      ["autoApprove", "shield"],
      ["browser", "globe"],
      ["checkpoints", "bookmark"],
      ["display", "device-desktop"],
      ["autocomplete", "code"],
      ["notifications", "bell"],
      ["context", "notebook"],
      ["commitMessage", "comment"],
      ["indexing", "database"],
      ["experimental", "beaker"],
      ["language", "symbol-text"],
      ["aboutKiloCode", "info"],
    ])
    expect(settings).not.toContain("@kilocode/kilo-ui/icon")
  })

  it("preserves navigation conditions and exposes stable UI regions", () => {
    expect(settings).toContain('show: "public"')
    expect(settings).toContain('show: "indexing"')
    expect(settings).toContain('item.show === "public"')
    expect(settings).toContain('item.show === "indexing"')
    for (const id of [
      "settings-frame",
      "settings-shell",
      "settings-header",
      "settings-main",
      "settings-layout",
      "settings-navigation",
      "settings-nav-item",
      "settings-content",
      "settings-page-title",
      "settings-groups",
      "settings-save-bar",
    ]) {
      expect(settings).toContain(`data-ui="${id}"`)
    }
  })

  it("keeps close, project config, global config and tab actions wired", () => {
    expect(settings).toContain("onClose?: () => void")
    expect(settings).toContain("onClick={() => props.onClose?.()}")
    expect(settings).toContain('onClick={() => open("local")}')
    expect(settings).toContain('onClick={() => open("global")}')
    expect(settings).toContain('orientation="vertical"')
    expect(settings).toContain("onChange={onTabChange}")
    expect(app).toContain('onClose={() => vscode.postMessage({ type: "closePanel" })}')
    expect(app).not.toContain('onClose={() => setCurrentView("newTask")}')
    expect(messages).toContain("export interface ClosePanelRequest")
    expect(messages).toContain("| ClosePanelRequest")
    expect(editor).toContain('if (msg.type === "closePanel")')
    expect(editor).toContain("panel.dispose()")
    expect(zh).toContain('"settings.openLocalConfig": "打开项目配置"')
    expect(zh).toContain('"settings.openGlobalConfig": "打开全局配置"')
  })

  it("scopes Titanium Studio tokens and container response to QA and Settings", () => {
    expect(styles).toContain("--settings-shell-bg")
    expect(styles).toContain("--settings-glass-fill")
    expect(styles).toContain("--settings-glass-fill-strong")
    expect(styles).toContain("--settings-glass-border")
    expect(styles).toContain("--settings-glass-highlight")
    expect(styles).toContain("--settings-glass-shadow")
    expect(styles).toContain("--settings-active-fill")
    expect(styles).toContain("--settings-active-border")
    expect(titanium).toContain("--titanium-deep: #0d141b")
    expect(titanium).toContain("--titanium-panel: #171e25")
    expect(titanium).toContain("--titanium-text: #dadbdc")
    expect(titanium).toContain("--titanium-success: #68d899")
    expect(titanium).toContain("@container settings (max-width: 1199px)")
    expect(titanium).toContain("@container settings (max-width: 719px)")
    expect(titanium).toContain("@container settings (max-width: 559px)")
    expect(titanium).toContain("@media (prefers-reduced-motion: reduce)")
    expect(titanium).toContain("body.vscode-high-contrast:has(.settings-shell)")
    expect(titanium).not.toMatch(/position:\s*absolute/)

    const selectors = styles.split("\n").filter((line) => line.startsWith(".") && line.endsWith("{"))
    expect(selectors.every((line) => line.startsWith(".settings-shell"))).toBeTrue()
  })

  it("uses the Titanium navigation density from the visual truth", () => {
    expect(titanium).toMatch(
      /\.settings-shell \.settings-tabs\[data-variant="settings"\] \[data-slot="tabs-trigger"\] \{[\s\S]*?font-size: var\(--kilo-font-size-16\)/,
    )
    expect(titanium).toMatch(
      /\.settings-shell \.settings-nav-icon \{[\s\S]*?flex-basis: 20px;[\s\S]*?font-size: var\(--kilo-font-size-20\)/,
    )
  })

  it("renders semantic server states with Codicons in a stable control row", () => {
    expect(server).not.toContain("@kilocode/kilo-ui/icon")
    expect(server).toContain('data-ui="chipmate-server-form"')
    expect(server).toContain('data-ui="chipmate-server-input"')
    expect(server).toContain('data-ui="chipmate-server-test"')
    expect(server).toContain('data-ui="chipmate-server-status"')
    expect(server).toContain('item().kind === "success"')
    expect(server).toContain('? "check"')
    expect(server).toContain('? "sync"')
    expect(server).toContain('? "error"')
    expect(server).toContain(': "warning"')
    expect(titanium).toContain("grid-template-columns: minmax(240px, 1fr) 112px minmax(150px, 210px)")
    expect(titanium).toContain("flex-direction: column")
  })

  it("covers desktop, interaction, responsive, semantic and theme stories", () => {
    for (const name of [
      "SettingsAlignedDesktop",
      "SettingsAlignedHover",
      "SettingsAlignedFocus",
      "SettingsAlignedTesting",
      "SettingsAlignedWarning",
      "SettingsAlignedError",
      "SettingsAlignedSaveFailed",
      "SettingsAlignedSaving",
      "SettingsAlignedMid",
      "SettingsAlignedNarrow",
      "SettingsAlignedLight",
      "SettingsAlignedContrast",
      "SettingsAlignedZoom80",
      "SettingsAlignedZoom125",
      "SettingsAlignedZoom150",
      "SettingsTitaniumModels",
      "SettingsTitaniumResponsive",
      "SettingsCloseInteraction",
      "TitaniumStudioReview",
    ]) {
      expect(stories).toContain(`export const ${name}`)
    }
    expect(stories).toContain('width="900px" height="800px"')
    expect(stories).toContain('width="480px" height="900px"')
    expect(stories).toContain('vscodeTheme: "light-modern"')
    expect(stories).toContain('vscodeTheme: "hc-black"')
  })
})
