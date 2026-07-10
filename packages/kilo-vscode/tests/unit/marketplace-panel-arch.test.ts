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
    expect(list).toContain("市场用户：")
    expect(commandTitle("kilo-code.new.marketplaceButtonClicked")).toBe("市场")
    expect(commandTitle("kilo-code.new.sidebarTitle.marketplaceButtonClicked")).toBe("市场")
  })

  it("uses icon actions for Skill stars and confirmed removal", () => {
    expect(card).toContain('icon="star"')
    expect(card).toContain('icon="trash"')
    expect(card).not.toContain("🌟")
    expect(view).toContain("<RemoveDialog")
  })

  it("uploads only current local-only Skill cards that are absent from the Marketplace", () => {
    expect(panel).toContain("client.app.skills")
    expect(panel).toContain("uploadableSkillIds")
    expect(panel).toContain("isListedUploadableSkill")
    expect(panel).toContain('location === "builtin"')
    expect(panel).toContain("buildMarketplaceBuiltinSkillUploadPayload")
    expect(panel).not.toContain("showQuickPick")
    expect(panel).not.toContain("showOpenDialog")
    expect(list).not.toContain("marketplace-primary-action")
    expect(card).toContain('icon="cloud-upload"')
    expect(card).toContain("本地 Skill")
  })

  it("uses a dedicated Marketplace webview bundle", () => {
    expect(panel).toContain('"dist", "marketplace.js"')
    expect(panel).not.toContain('"dist", "webview.js"')
  })

  it("keeps sidebar removal behind a narrow adapter", () => {
    expect(kilo).toContain("removeAgent(this.removeConfigItemCtx, name)")
    expect(kilo).toContain("removeMcp(this.removeConfigItemCtx, name)")
    expect(remove).toContain("createMarketplaceRemover")
    expect(remove).not.toContain("new MarketplaceService()")
    expect(remove).not.toContain("AgentMarketplaceItem")
    expect(remove).not.toContain("McpMarketplaceItem")
  })
})
