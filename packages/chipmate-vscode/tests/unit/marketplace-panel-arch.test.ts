import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const chipmate = fs.readFileSync(path.join(root, "src/ChipMateProvider.ts"), "utf-8")
const panel = fs.readFileSync(path.join(root, "src/MarketplacePanelProvider.ts"), "utf-8")
const auth = fs.readFileSync(path.join(root, "src/services/marketplace/auth.ts"), "utf-8")
const remove = fs.readFileSync(path.join(root, "src/chipmate-provider/remove-config-item.ts"), "utf-8")
const card = fs.readFileSync(path.join(root, "webview-ui/src/components/marketplace/ItemCard.tsx"), "utf-8")
const list = fs.readFileSync(path.join(root, "webview-ui/src/components/marketplace/MarketplaceListView.tsx"), "utf-8")
const view = fs.readFileSync(path.join(root, "webview-ui/src/components/marketplace/MarketplaceView.tsx"), "utf-8")
const runtime = fs.readFileSync(
  path.join(root, "webview-ui/src/components/marketplace/MarketplaceRuntimeCard.tsx"),
  "utf-8",
)
const importer = fs.readFileSync(
  path.join(root, "webview-ui/src/components/marketplace/LocalSkillImportDialog.tsx"),
  "utf-8",
)
const aligned = fs.readFileSync(
  path.join(root, "webview-ui/src/components/marketplace/AlignedSkillMarket.tsx"),
  "utf-8",
)
const actions = fs.readFileSync(path.join(root, "src/services/marketplace/actions.ts"), "utf-8")
const bridge = fs.readFileSync(path.join(root, "src/services/skill-market/bridge.ts"), "utf-8")
const localRemoval = fs.readFileSync(path.join(root, "src/services/marketplace/local-skill-removal.ts"), "utf-8")
const install = fs.readFileSync(path.join(root, "webview-ui/src/components/marketplace/InstallModal.tsx"), "utf-8")
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")) as {
  contributes: { commands: Array<{ command: string; title: string }> }
}

const commandTitle = (id: string) => manifest.contributes.commands.find((item) => item.command === id)?.title

describe("standalone Marketplace architecture", () => {
  it("keeps Marketplace webview cases out of ChipMateProvider", () => {
    for (const type of [
      "fetchMarketplaceData",
      "verifyMarketplaceUser",
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
      expect(chipmate).not.toContain(`case \"${type}\"`)
      expect(panel).toContain(`case \"${type}\"`)
    }
  })

  it("使用独立设备码身份自动恢复市场用户并保留手动登录入口", () => {
    expect(panel).toContain("await this.refreshMarketplaceUser()")
    expect(panel).toContain("this.auth.access(")
    expect(panel).toContain('case "verifyMarketplaceUser"')
    expect(panel).toContain("context.secrets")
    expect(panel).not.toContain("getCurrentProviderApiKey")
    expect(auth).toContain("/api/v1/auth/device/code")
    expect(auth).toContain("vscode.env.openExternal")
    expect(panel).not.toContain("showInputBox")
    expect(panel).not.toContain("MARKETPLACE_API_KEY_SECRET")
    expect(runtime).toContain('t("marketplace.runtime.reverify")')
    expect(runtime).toContain("disabled={verifying()}")
  })

  it("uses Chinese Market labels in the panel, identity bar, and QA toolbar", () => {
    expect(panel).toContain('"ChipMate 市场"')
    expect(panel).toContain("正在验证市场用户...")
    expect(panel).toContain("市场用户验证失败：")
    expect(view).toContain("<MarketplaceRuntimeCard")
    expect(commandTitle("chipmate.v2.marketplaceButtonClicked")).toBe("市场")
    expect(commandTitle("chipmate.v2.sidebarTitle.marketplaceButtonClicked")).toBe("市场")
  })

  it("uses icon actions for Skill stars and confirmed removal", () => {
    expect(card).toContain('icon="star"')
    expect(card).toContain('icon="trash"')
    expect(card).not.toContain("🌟")
    expect(view).toContain("<RemoveDialog")
    expect(card).toContain('skill()?.origin === "market"')
    expect(view).toContain('item.origin !== "market"')
  })

  it("shows aligned Skill risk badges and requires confirmation before risky installation", () => {
    expect(card).toContain("marketplace-risk-badge")
    expect(card).toContain('risk().level === "none"')
    expect(aligned).toContain("<SkillRiskPanel")
    expect(aligned).toContain('item.riskLevel !== "none"')
    expect(install).toContain("riskAccepted")
    expect(install).toContain('props.item.risk?.level !== "none"')
    expect(install).toContain('type="checkbox"')
    expect(install).not.toContain("position: absolute")
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
    expect(card).toContain("batchSelected")
    expect(card).toContain('data-selected={props.batchSelected || undefined}')
    expect(card).not.toContain('"marketplace-card marketplace-card-selected"')
    expect(card).toContain("<Show when={props.active && props.uploadable && props.change}>")
    expect(list).toContain('t("marketplace.batch.open")')
    expect(list).toContain("marketplace-batch-toolbar")
    expect(panel).toContain("publishBatch")
    expect(panel).toContain("mpSkillIds")
    expect(panel).toContain('msg.type !== "uploadMarketplaceSkills"')
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
    expect(aligned).toContain("@chipmate/chipmate-ui/markdown")
    expect(aligned).not.toContain("react")
    expect(aligned).not.toContain("position: absolute")
    expect(aligned).toContain("codicon codicon-archive")
    expect(aligned).toContain("props.onUnpublish")
    expect(panel).toContain("showWarningMessage(")
    expect(panel).toContain('confirm !== "确认下架"')
  })

  it("keeps protocol details in diagnostics and exposes safe abnormal-state tooltips", () => {
    expect(aligned).not.toContain("marketplace-identity-url")
    expect(runtime).toContain("@chipmate/chipmate-ui/tooltip")
    expect(runtime).toContain("props.issue?.requestId")
    expect(runtime).toContain("tabIndex={props.issue ? 0 : undefined}")
    expect(runtime).not.toContain("position: absolute")
    expect(view).toContain('protocol="legacy"')
  })

  it("keeps sidebar removal behind a narrow adapter", () => {
    expect(chipmate).toContain("removeMcp(this.removeConfigItemCtx, name)")
    expect(remove).toContain("createMarketplaceRemover")
    expect(remove).not.toContain("new MarketplaceService()")
    expect(remove).not.toContain("AgentMarketplaceItem")
    expect(remove).not.toContain("McpMarketplaceItem")
  })

  it("refreshes Skill caches without disposing active workspace sessions", () => {
    expect(actions).toContain("client.chipmate.refreshSkills")
    expect(panel).toContain("invalidateMarketplaceSkills(this.marketplaceCtx, selected.scope, dir)")
    expect(panel).not.toContain("CLI skill invalidation after deep-link install failed")
    expect(bridge).toContain(".chipmate.refreshSkills")
    expect(bridge.indexOf(".chipmate.refreshSkills")).toBeLessThan(bridge.indexOf("await this.reply"))
    expect(localRemoval).not.toContain("client.instance.dispose")
  })
})
