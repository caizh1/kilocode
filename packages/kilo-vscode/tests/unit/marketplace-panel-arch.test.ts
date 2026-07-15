import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const kilo = fs.readFileSync(path.join(root, "src/KiloProvider.ts"), "utf-8")
const panel = fs.readFileSync(path.join(root, "src/MarketplacePanelProvider.ts"), "utf-8")
const remove = fs.readFileSync(path.join(root, "src/kilo-provider/remove-config-item.ts"), "utf-8")
const card = fs.readFileSync(path.join(root, "webview-ui/src/components/marketplace/ItemCard.tsx"), "utf-8")
const list = fs.readFileSync(path.join(root, "webview-ui/src/components/marketplace/MarketplaceListView.tsx"), "utf-8")
const view = fs.readFileSync(path.join(root, "webview-ui/src/components/marketplace/MarketplaceView.tsx"), "utf-8")
const importer = fs.readFileSync(
  path.join(root, "webview-ui/src/components/marketplace/LocalSkillImportDialog.tsx"),
  "utf-8",
)
const aligned = fs.readFileSync(
  path.join(root, "webview-ui/src/components/marketplace/AlignedSkillMarket.tsx"),
  "utf-8",
)
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")) as {
  contributes: { commands: Array<{ command: string; title: string }> }
}

const commandTitle = (id: string) => manifest.contributes.commands.find((item) => item.command === id)?.title

describe("standalone Marketplace architecture", () => {
  it("keeps Marketplace webview cases out of KiloProvider", () => {
    for (const type of [
      "fetchMarketplaceData",
      "installMarketplaceItem",
      "removeInstalledMarketplaceItem",
      "uploadMarketplaceSkill",
      "starMarketplaceSkill",
      "unpublishMarketplaceSkill",
      "pickLocalSkills",
      "installLocalSkills",
      "cancelLocalSkillImport",
      "dismissAgentMigrationBanner",
    ]) {
      expect(kilo).not.toContain(`case \"${type}\"`)
      expect(panel).toContain(`case \"${type}\"`)
    }
  })

  it("resolves the Marketplace user from the current provider without a manual verification flow", () => {
    expect(panel).toContain("await this.refreshMarketplaceUser()")
    expect(panel).toContain("this.getCurrentProviderApiKey()")
    expect(panel).not.toContain('case "verifyMarketplaceUser"')
    expect(panel).not.toContain("showInputBox")
    expect(panel).not.toContain("MARKETPLACE_API_KEY_SECRET")
    expect(list).not.toContain("验证用户")
  })

  it("uses Chinese Market labels in the panel, identity bar, and QA toolbar", () => {
    expect(panel).toContain('"ChipMate 市场"')
    expect(panel).toContain("正在验证市场用户...")
    expect(panel).toContain("市场用户验证失败：")
    expect(list).toContain('t("marketplace.aligned.user")')
    expect(commandTitle("kilo-code.new.marketplaceButtonClicked")).toBe("市场")
    expect(commandTitle("kilo-code.new.sidebarTitle.marketplaceButtonClicked")).toBe("市场")
  })

  it("uses icon actions for Skill stars and confirmed removal", () => {
    expect(card).toContain('icon="star"')
    expect(card).toContain('icon="trash"')
    expect(card).not.toContain("🌟")
    expect(view).toContain("<RemoveDialog")
  })

  it("publishes installed Skill snapshots from their cards and uses native local source pickers", () => {
    expect(panel).toContain("client.app.skills")
    expect(panel).toContain("uploadableSkillIds")
    expect(panel).toContain("isListedUploadableSkill")
    expect(panel).toContain('location === "builtin"')
    expect(panel).toContain("buildMarketplaceBuiltinSkillUploadPayload")
    expect(panel).not.toContain("showQuickPick")
    expect(panel).toContain("showOpenDialog")
    expect(view).toContain("LocalSkillImportDialog")
    expect(importer).toContain('type: "pickLocalSkills"')
    expect(importer).toContain('type: "installLocalSkills"')
    expect(list).not.toContain("marketplace-primary-action")
    expect(card).toContain('icon="cloud-upload"')
    expect(card).toContain('t("marketplace.aligned.localSkill")')
  })

  it("uses a dedicated Marketplace webview bundle", () => {
    expect(panel).toContain('"dist", "marketplace.js"')
    expect(panel).not.toContain('"dist", "webview.js"')
  })

  it("gates aligned Skill views by capabilities while retaining legacy and Agent/MCP surfaces", () => {
    expect(view).toContain('protocol() === "aligned-v1"')
    expect(view).toContain("marketplaceSkillsOnly() === false")
    expect(view).toContain("<AlignedSkillMarket")
    expect(view).toContain('<Tabs.Trigger value="agent"')
    expect(view).toContain('<Tabs.Trigger value="mcp"')
    expect(aligned).toContain('"home" | "favorites" | "installed" | "publications" | "analytics" | "diagnostics"')
    expect(aligned).toContain("@kilocode/kilo-ui/markdown")
    expect(aligned).not.toContain("react")
    expect(aligned).not.toContain("position: absolute")
    expect(aligned).toContain("codicon codicon-archive")
    expect(aligned).toContain("props.onUnpublish")
    expect(panel).toContain("showWarningMessage(")
    expect(panel).toContain('confirm !== "确认下架"')
  })

  it("keeps sidebar removal behind a narrow adapter", () => {
    expect(kilo).toContain("removeMcp(this.removeConfigItemCtx, name)")
    expect(remove).toContain("createMarketplaceRemover")
    expect(remove).not.toContain("new MarketplaceService()")
    expect(remove).not.toContain("AgentMarketplaceItem")
    expect(remove).not.toContain("McpMarketplaceItem")
  })
})
