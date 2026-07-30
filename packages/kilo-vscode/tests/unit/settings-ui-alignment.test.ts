import { describe, expect, it } from "bun:test"

const settings = await Bun.file(
  new URL("../../webview-ui/src/components/settings/Settings.tsx", import.meta.url),
).text()
const server = await Bun.file(
  new URL("../../webview-ui/src/components/settings/ChipmateServerTab.tsx", import.meta.url),
).text()
const styles = await Bun.file(new URL("../../webview-ui/src/styles/settings.css", import.meta.url)).text()
const chat = await Bun.file(new URL("../../webview-ui/src/styles/chat.css", import.meta.url)).text()
const titanium = await Bun.file(new URL("../../webview-ui/src/styles/titanium-studio.css", import.meta.url)).text()
const rows = await Bun.file(new URL("../../webview-ui/src/components/settings/SettingsRow.tsx", import.meta.url)).text()
const stories = await Bun.file(new URL("../../webview-ui/src/stories/settings.stories.tsx", import.meta.url)).text()
const app = await Bun.file(new URL("../../webview-ui/src/App.tsx", import.meta.url)).text()
const messages = await Bun.file(
  new URL("../../webview-ui/src/types/messages/webview-messages.ts", import.meta.url),
).text()
const editor = await Bun.file(new URL("../../src/SettingsEditorProvider.ts", import.meta.url)).text()
const zh = await Bun.file(new URL("../../webview-ui/src/i18n/zh.ts", import.meta.url)).text()

describe("Settings UI alignment", () => {
  it("keeps all settings pages in the locked grouped navigation", () => {
    const actual = Array.from(settings.matchAll(/\{ id: "([^"]+)", key: "settings\.[^"]+"/g), (item) => item[1])
    expect(actual).toEqual([
      "models",
      "providers",
      "chipmateServer",
      "autocomplete",
      "context",
      "indexing",
      "checkpoints",
      "agentBehaviour",
      "autoApprove",
      "browser",
      "sandboxing",
      "commitMessage",
      "experimental",
      "display",
      "notifications",
      "language",
      "aboutKiloCode",
    ])
    expect(settings).toContain('id: "connection"')
    expect(settings).toContain('id: "knowledge"')
    expect(settings).toContain('id: "automation"')
    expect(settings).toContain('id: "experience"')
    expect(settings).not.toContain("settings-nav-icon")
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
      "settings-search",
      "settings-nav-item",
      "settings-mobile-navigation",
      "settings-mobile-search",
      "settings-mobile-option",
      "settings-content",
      "settings-page-title",
      "settings-groups",
      "settings-save-bar",
    ]) {
      expect(settings).toContain(`data-ui="${id}"`)
    }
    expect(settings).toContain('"data-ui": "settings-mobile-trigger"')
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
    expect(editor).toContain("/^chipmate\\.v2\\.(\\w+)Panel$/")
    expect(editor).not.toContain("/^kilo-code\\.new\\.")
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
    expect(titanium).toContain("--titanium-accent-strong: #52acde")
    expect(titanium).toContain("--titanium-deep: #fbfcfe")
    expect(titanium).toContain("--titanium-panel: #f8fafc")
    expect(titanium).toContain("--titanium-accent: #007aff")
    expect(titanium).toContain("@container settings (max-width: 1199px)")
    expect(titanium).toContain("@container settings (max-width: 719px)")
    expect(titanium).toContain("@container settings (max-width: 559px)")
    expect(titanium).toContain("@media (prefers-reduced-motion: reduce)")
    expect(titanium).toContain("body.vscode-high-contrast:has(.settings-shell)")
    expect(titanium).not.toMatch(/position:\s*absolute/)
    expect(chat.indexOf('@import "./titanium-studio.css"')).toBeLessThan(chat.indexOf('@import "./high-contrast.css"'))
    expect(rows).not.toContain("style={{")
    expect(rows).toContain('data-last={props.last ? "true" : undefined}')

    const selectors = styles.split("\n").filter((line) => line.startsWith(".") && line.endsWith("{"))
    expect(selectors.every((line) => line.startsWith(".settings-shell"))).toBeTrue()
  })

  it("uses static group headings and a single narrow page picker", () => {
    expect(titanium).toContain(".settings-shell .settings-nav-heading")
    expect(titanium).toContain(".settings-shell .settings-mobile-navigation")
    expect(titanium).toContain("body:has(.settings-shell) .settings-nav-popup")
    expect(titanium).toMatch(
      /@container settings \(max-width: 719px\)[\s\S]*?\.settings-shell \.settings-navigation \{[\s\S]*?display: none/,
    )
    expect(titanium).toMatch(
      /@container settings \(max-width: 719px\)[\s\S]*?\.settings-shell \.settings-mobile-navigation \{[\s\S]*?display: flex/,
    )
  })

  it("renders semantic server states with Codicons in a stable control row", () => {
    expect(server).not.toContain("@kilocode/kilo-ui/icon")
    expect(server).toContain('data-ui="chipmate-server-form"')
    expect(server).toContain('data-ui="chipmate-server-input"')
    expect(server).toContain('data-ui="chipmate-server-test"')
    expect(server).toContain('data-ui="chipmate-server-status"')
    expect(server).toContain("statusIcon(item().kind)")
    expect(server).toContain('if (kind === "success") return "check"')
    expect(server).toContain('if (kind === "testing") return "sync"')
    expect(server).toContain('if (kind === "error") return "error"')
    expect(server).toContain('return "warning"')
    expect(titanium).toContain("grid-template-columns: minmax(240px, 1fr) 112px")
    expect(titanium).toContain(".settings-shell .chipmate-server-status-slot")
    expect(titanium).toContain("grid-column: 1 / -1")
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
      "TitaniumStudioLightReview",
    ]) {
      expect(stories).toContain(`export const ${name}`)
    }
    expect(stories).toContain('width="900px" height="800px"')
    expect(stories).toContain('width="480px" height="900px"')
    expect(stories).toContain('vscodeTheme: "light-modern"')
    expect(stories).toContain('vscodeTheme: "hc-black"')
  })
})
