import * as os from "os"
import * as path from "path"
import { createHash, randomUUID } from "crypto"
import * as vscode from "vscode"
import type { Event, SessionStatus } from "@kilocode/sdk/v2/client"
import { buildWebviewHtml, getWebviewFontSize } from "./utils"
import { watchFontSizeConfig } from "./kilo-provider/font-size"
import { mapSSEEventToWebviewMessage } from "./kilo-provider-utils"
import { resolvePanelProjectDirectory } from "./project-directory"
import { seedSessionStatuses } from "./session-status"
import type { KiloConnectionService } from "./services/cli-backend"
import { MarketplaceService } from "./services/marketplace"
import type { CliSkill } from "./services/marketplace/detection"
import { marketplaceIdentityErrorMessage } from "./services/marketplace/errors"
import { pickInstallScope } from "./services/marketplace/install-ui"
import { applyLocalRepairs } from "./services/marketplace/local-repair"
import { MarketplaceAnalytics } from "./services/marketplace/analytics"
import { InstallRegistry } from "./services/marketplace/registry"
import { LocalImportRegistry } from "./services/marketplace/local-import-registry"
import { LocalSkillImporter } from "./services/marketplace/local-import"
import {
  LocalSkillRemoval,
  type IssuedSkillRemoveTarget,
  type SkillRemovePhase,
} from "./services/marketplace/local-skill-removal"
import { confirmRepairDiff, generateAiRepair } from "./services/marketplace/repair"
import { isListedUploadableSkill, normalizeSkillKey } from "./services/marketplace/skills"
import { archiveUrl, installLink, repairLink, type InstallLink } from "./services/marketplace/uri"
import {
  buildMarketplaceBuiltinSkillUploadPayload,
  buildMarketplaceSkillUploadPayload,
} from "./services/marketplace/upload"
import {
  fetchMarketplaceData,
  fetchMarketplaceSkills,
  invalidateMarketplaceSkills,
  installMarketplaceItem,
  removeMarketplaceItem,
  type MarketplaceActionContext,
} from "./services/marketplace/actions"
import type {
  InstallMarketplaceItemOptions,
  SkillImportSelection,
  MarketplaceItem,
  MarketplaceUser,
  SkillMarketplaceItem,
} from "./services/marketplace/types"
import { TelemetryProxy } from "./services/telemetry"
import { TelemetryEventName } from "./services/telemetry/types"

const MARKETPLACE_PROVIDER_KEY_TIMEOUT_MS = 3000

interface MarketplaceMessage {
  type?: string
  mpItem?: MarketplaceItem
  mpInstallOptions?: InstallMarketplaceItemOptions
  mpSkillId?: string
  url?: unknown
  event?: string
  properties?: Record<string, unknown>
  localSkillSourceKind?: "file" | "folder"
  localSkillSelection?: SkillImportSelection
  importToken?: string
  requestId?: string
  targetToken?: string
  skillId?: string
  scope?: "global" | "project"
}

interface UploadableSkill {
  id: string
  name: string
  description?: string
  root?: string
  content?: string
}

export class MarketplacePanelProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.marketplacePanel"

  private panel: vscode.WebviewPanel | undefined
  private project: string | null = null
  private ready = false
  private restored = false
  private statuses = new Map<string, SessionStatus["type"]>()
  private disposables: vscode.Disposable[] = []
  private subscriptions: Array<() => void> = []
  private readonly marketplace = new MarketplaceService()
  private readonly registry: InstallRegistry
  private readonly localRegistry: LocalImportRegistry
  private readonly importer: LocalSkillImporter
  private readonly removal: LocalSkillRemoval
  private readonly analytics: MarketplaceAnalytics
  private uploadableSkillIds = new Set<string>()
  private readonly blockedSkillIds = new Set<string>()
  private marketplaceUser: MarketplaceUser | undefined
  private readonly extensionVersion =
    vscode.extensions.getExtension("chipmate.chipmate")?.packageJSON?.version ?? "unknown"

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.registry = new InstallRegistry(context)
    this.localRegistry = new LocalImportRegistry(context)
    this.removal = new LocalSkillRemoval(connection, context)
    this.importer = new LocalSkillImporter(
      this.localRegistry,
      async (id, scope, project) => {
        const origin = new URL(this.marketplace.serverBaseUrl()).origin
        const workspaceId = this.registry.workspaceId(scope === "project" ? project : undefined)
        return Boolean(await this.registry.get(origin, id, scope, workspaceId))
      },
      (progress) => this.post({ type: "localSkillImportProgress", progress }),
    )
    this.analytics = new MarketplaceAnalytics(
      (items, key) => this.marketplace.events(items, key),
      () => this.registry.clientId(),
      () => this.getCurrentProviderApiKey(),
    )
  }

  private get marketplaceCtx(): MarketplaceActionContext {
    return { connection: this.connection, marketplace: this.marketplace, storage: this.context.globalStorageUri }
  }

  /**
   * `undefined` infers the project from the active editor or workspace,
   * while `null` intentionally disables project-scoped operations when no directory can be
   * selected safely, such as in an ambiguous multi-root workspace.
   */
  openPanel(directory?: string | null): void {
    const project = directory === undefined ? this.resolveProject() : directory
    if (this.panel) {
      this.setProjectDirectory(project)
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      MarketplacePanelProvider.viewType,
      "ChipMate 市场",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )
    this.attach(panel, project)
  }

  deserializePanel(panel: vscode.WebviewPanel): void {
    this.attach(panel, this.resolveProject())
  }

  async handleInstallUri(uri: vscode.Uri): Promise<void> {
    const link = installLink(uri, this.marketplace.serverBaseUrl())
    if (!link) {
      vscode.window.showErrorMessage("安装链接无效：来源、路径或一次性 token 未通过校验。")
      return
    }
    const apiKey = await this.marketplaceApiKey("安装市场 Skill")
    if (!apiKey) return

    try {
      await this.installFromLink(link, apiKey)
    } catch (err) {
      vscode.window.showErrorMessage(`市场安装失败：${marketplaceIdentityErrorMessage(err)}`)
    }
  }

  async handleRepairUri(uri: vscode.Uri): Promise<void> {
    const link = repairLink(uri, this.marketplace.serverBaseUrl())
    if (!link) {
      vscode.window.showErrorMessage("AI 修复链接无效：来源或 publicationRunId 未通过校验。")
      return
    }
    const apiKey = await this.marketplaceApiKey("使用 AI 修复发布快照")
    if (!apiKey) return
    try {
      const run = await this.marketplace.getPublication(link.runId, apiKey)
      if (run.status !== "NEEDS_AI_CONFIRMATION") throw new Error(`发布任务当前状态不接受 AI 修复：${run.status}`)
      const source = run.patches.find(
        (patch) => patch.kind === "deterministic" && Date.parse(patch.expiresAt) > Date.now(),
      )
      const file = source?.files.find((item) => item.path === "SKILL.md" && item.patch.startsWith("replace-base64:"))
      if (!file) throw new Error("发布任务未提供可修复的 SKILL.md 快照。")
      const before = Buffer.from(file.patch.slice("replace-base64:".length), "base64").toString("utf8")
      const consent = await vscode.window.showInformationMessage(
        "仅在确认后，SKILL.md 必要内容才会发送给当前 Provider。Render Service 不持有模型配置或凭据。",
        { modal: true },
        "使用当前 Provider",
      )
      if (consent !== "使用当前 Provider") return
      const dir = this.directory()
      const after = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "正在使用当前 Provider 生成 AI 修复…",
          cancellable: false,
        },
        () => generateAiRepair(this.connection, dir, run.id, before),
      )
      if (!(await confirmRepairDiff(before, after, run.skillId ?? "Skill"))) return
      const patch = {
        id: `ai-${randomUUID()}`,
        runId: run.id,
        kind: "ai" as const,
        files: [
          {
            path: "SKILL.md",
            beforeSha256: createHash("sha256").update(before).digest("hex"),
            afterSha256: createHash("sha256").update(after).digest("hex"),
            patch: `replace-base64:${Buffer.from(after).toString("base64")}`,
          },
        ],
        requiresConfirmation: true,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      }
      await this.marketplace.putPublicationPatches(run.id, [patch], apiKey)
      const applied = await this.marketplace.applyPublicationPatches(run.id, [patch.id], apiKey)
      void this.analytics.track("publication_ai_repair", {
        ...(run.skillId ? { skillId: run.skillId } : {}),
        context: { status: applied.status },
      })
      this.post({ type: "marketplacePublicationResult", run: applied })
      vscode.window.showInformationMessage(`AI 修复已确认并完成权威复验：${applied.status}`)
      this.openPanel(this.resolveProject())
    } catch (err) {
      vscode.window.showErrorMessage(`AI 修复失败：${marketplaceIdentityErrorMessage(err)}`)
    }
  }

  private async installFromLink(link: InstallLink, apiKey: string): Promise<void> {
    const intent = await this.marketplace.consumeInstallIntent(link.token, apiKey)
    const url = archiveUrl(link.origin, intent.downloadUrl)
    if (!url) throw new Error("安装包下载地址与市场来源不一致。")
    const project = this.resolveProject() ?? undefined
    const selected = await pickInstallScope(project, `安装 ${intent.skillId} r${intent.revision}`)
    if (!selected) return
    const workspace = selected.scope === "project" ? project : undefined
    const workspaceId = this.registry.workspaceId(workspace)
    const saved = await this.registry.get(link.origin, intent.skillId, selected.scope, workspaceId)
    const exists = await this.marketplace.isSkillInstalled(intent.skillId, selected.scope, workspace)
    if (exists && saved?.revision === intent.revision && saved.sha256 === intent.sha256) {
      vscode.window.showInformationMessage(`${intent.skillId} r${intent.revision} 已安装且哈希一致，无需更新。`)
      return
    }
    if (exists) {
      const confirm = await vscode.window.showWarningMessage(
        saved
          ? `${intent.skillId} 已安装 r${saved.revision}。是否校验并原子替换为 r${intent.revision}？`
          : `${intent.skillId} 是未托管的本地 Skill。是否校验并重新安装以纳入市场管理？`,
        { modal: true },
        "更新",
      )
      if (confirm !== "更新") return
    }

    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `正在安全安装 ${intent.skillId}…`, cancellable: false },
      () =>
        this.marketplace.installVerifiedSkill(
          { id: intent.skillId, revision: intent.revision, sha256: intent.sha256, url },
          selected.scope,
          workspace,
        ),
    )
    if (!result.success) throw new Error(result.error ?? "安装失败")

    const clientId = saved?.clientId ?? (await this.registry.clientId())
    const state = {
      skillId: intent.skillId,
      revision: intent.revision,
      sha256: intent.sha256,
      scope: selected.scope,
      status: "installed" as const,
      clientId,
      ...(workspaceId ? { workspaceId } : {}),
    }
    const synced = await this.marketplace.syncInstallation(intent.skillId, state, apiKey)
    void this.analytics.track(exists ? "skill_update" : "skill_install", {
      skillId: intent.skillId,
      revision: intent.revision,
    })
    await this.registry.put({ origin: link.origin, ...state, changedAt: synced.changedAt })
    const dir = workspace ?? this.directory()
    const client = await this.connection.getClientAsync(dir)
    await client.instance.dispose({ directory: dir }).catch((err: unknown) => {
      console.warn("[Kilo New] CLI skill invalidation after deep-link install failed:", err)
    })
    vscode.window.showInformationMessage(`${intent.skillId} r${intent.revision} 已安全安装并同步。`)
    this.openPanel(workspace ?? null)
    await this.fetchData()
  }

  dispose(): void {
    this.panel?.dispose()
    this.cleanup()
    this.marketplace.dispose()
    this.analytics.dispose()
    this.importer.dispose()
    this.removal.dispose()
  }

  private attach(panel: vscode.WebviewPanel, project: string | null): void {
    this.cleanup()
    this.panel = panel
    this.project = project
    this.ready = false
    this.restored = false
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }
    panel.webview.html = this.getHtml(panel.webview)

    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg) => void this.handle(msg as MarketplaceMessage)),
      panel.onDidDispose(() => this.cleanup()),
      watchFontSizeConfig((msg) => this.post(msg)),
    )
    this.subscriptions.push(
      this.marketplace.subscribe((name) => {
        if (this.ready) void this.refresh(name)
      }),
      this.connection.onStateChange((state, err) => {
        this.post({ type: "connectionState", state, ...(err ? { error: err.message } : {}) })
        if (state === "connected") void this.sync(false)
      }),
      this.connection.onLanguageChanged((locale) => this.post({ type: "languageChanged", locale })),
      this.connection.onEventFiltered(
        (event) => event.type === "session.status",
        (event) => this.handleStatus(event),
      ),
    )
    void this.connect()
  }

  private cleanup(): void {
    for (const disposable of this.disposables) disposable.dispose()
    for (const unsubscribe of this.subscriptions) unsubscribe()
    this.disposables = []
    this.subscriptions = []
    this.panel = undefined
    this.ready = false
    this.statuses.clear()
    this.importer.dispose()
    this.removal.dispose()
  }

  private async connect(): Promise<void> {
    try {
      await this.connection.connect(this.directory())
      await this.sync(this.statuses.size === 0)
    } catch (err) {
      this.post({ type: "connectionState", state: "error", error: err instanceof Error ? err.message : String(err) })
    }
  }

  private async sync(reconcile: boolean): Promise<void> {
    if (!this.ready) return
    const info = this.connection.getServerInfo()
    if (info) {
      const cfg = vscode.workspace.getConfiguration("kilo-code.new")
      this.post({
        type: "ready",
        serverInfo: info,
        extensionVersion: this.extensionVersion,
        vscodeLanguage: vscode.env.language,
        languageOverride: cfg.get<string>("language"),
        fontSize: getWebviewFontSize(),
        workspaceDirectory: this.project ?? "",
      })
    }
    this.post({ type: "connectionState", state: this.connection.getConnectionState() })

    try {
      const client = this.connection.getClient()
      await seedSessionStatuses(client, this.directory(), this.statuses, (msg) => this.post(msg), reconcile)
    } catch (err) {
      console.warn("[Kilo New] Marketplace session status sync failed:", err)
    }
  }

  private async handle(msg: MarketplaceMessage): Promise<void> {
    if (await this.handleSkillMessage(msg)) return
    switch (msg.type) {
      case "webviewReady":
        this.ready = true
        if (this.connection.getConnectionState() === "connected") await this.sync(true)
        else await this.connect()
        await this.refreshMarketplaceUser()
        await this.restoreManaged()
        await this.fetchData()
        void this.analytics.track("market_impression", { context: { source: "marketplace-panel" } })
        return
      case "retryConnection":
        await this.connect()
        await this.refreshMarketplaceUser()
        await this.fetchData()
        return
      case "fetchMarketplaceData":
        await this.fetchData()
        return
      case "installMarketplaceItem":
        if (msg.mpItem && msg.mpInstallOptions) await this.install(msg.mpItem, msg.mpInstallOptions)
        return
      case "removeInstalledMarketplaceItem":
        if (msg.mpItem) await this.remove(msg.mpItem, msg.mpInstallOptions?.target ?? "project")
        return
      case "dismissAgentMigrationBanner":
        await this.context.globalState.update("kilo.agentMigrationBannerDismissed", true)
        return
      case "openExternal":
        this.openExternal(msg.url)
        return
      case "telemetry":
        if (msg.event) TelemetryProxy.capture(msg.event as TelemetryEventName, msg.properties)
        return
    }
  }

  private async handleSkillMessage(msg: MarketplaceMessage): Promise<boolean> {
    switch (msg.type) {
      case "pickLocalSkills":
        if (msg.localSkillSourceKind) await this.pickLocalSkills(msg.localSkillSourceKind)
        return true
      case "installLocalSkills":
        if (msg.localSkillSelection) await this.installLocalSkills(msg.localSkillSelection)
        return true
      case "cancelLocalSkillImport":
        if (msg.importToken) this.importer.cancel(msg.importToken)
        return true
      case "removeLocalSkill":
        if (msg.requestId && msg.targetToken && msg.skillId && msg.scope) {
          await this.removeLocalSkill(msg.requestId, msg.targetToken, msg.skillId, msg.scope)
        }
        return true
      case "fetchMarketplaceSkillDetail":
        if (msg.mpSkillId) await this.fetchSkillDetail(msg.mpSkillId)
        return true
      case "uploadMarketplaceSkill":
        console.info("[Kilo New] Marketplace upload skill requested.")
        if (msg.mpSkillId) await this.uploadMarketplaceSkill(msg.mpSkillId)
        return true
      case "starMarketplaceSkill":
        console.info("[Kilo New] Marketplace star skill requested.")
        if (msg.mpSkillId) await this.starMarketplaceSkill(msg.mpSkillId)
        return true
      case "unpublishMarketplaceSkill":
        console.info("[Kilo New] Marketplace unpublish skill requested.")
        if (msg.mpSkillId) await this.unpublishMarketplaceSkill(msg.mpSkillId)
        return true
      default:
        return false
    }
  }

  private async fetchData(): Promise<void> {
    try {
      const project = this.project ?? undefined
      const apiKey = await this.getCurrentProviderApiKey()
      const data = await fetchMarketplaceData(this.marketplaceCtx, project, this.directory(), apiKey)
      const skills = (await fetchMarketplaceSkills(this.marketplaceCtx, this.directory())) ?? []
      const targets = this.removal.issue(skills, project)
      await this.removal.reconcile(project)
      await this.decorateLocalSkills(data.marketplaceItems, project, targets)
      this.uploadableSkillIds = new Set(
        data.marketplaceItems
          .filter((item): item is SkillMarketplaceItem => item.type === "skill" && Boolean(item.uploadable))
          .map((item) => item.id),
      )
      const dismissed = this.context.globalState.get<boolean>("kilo.agentMigrationBannerDismissed") ?? false
      this.post({
        type: "marketplaceData",
        ...data,
        marketplaceUser: this.marketplaceUser,
        marketplaceBaseUrl: this.marketplace.marketplaceBaseUrl(),
        marketplaceSkillsOnly: this.marketplace.marketplaceSkillsOnly(),
        marketplaceMode: this.marketplace.marketplaceMode(),
        showAgentMigrationBanner: !dismissed,
      })
    } catch (err) {
      this.uploadableSkillIds.clear()
      const error = marketplaceDataErrorMessage(err)
      console.warn("[Kilo New] Marketplace data fetch failed:", err)
      this.post({
        type: "marketplaceData",
        marketplaceItems: [],
        marketplaceInstalledMetadata: { project: {}, global: {} },
        marketplaceUser: this.marketplaceUser,
        marketplaceBaseUrl: this.marketplace.marketplaceBaseUrl(),
        marketplaceSkillsOnly: this.marketplace.marketplaceSkillsOnly(),
        marketplaceMode: this.marketplace.marketplaceMode(),
        errors: [error],
      })
    }
  }

  private async refresh(name: string): Promise<void> {
    if (name === "catalog.invalidated" || name.startsWith("skill.") || name === "favorite.changed") {
      const project = this.project ?? undefined
      const apiKey = await this.getCurrentProviderApiKey()
      const data = await fetchMarketplaceData(this.marketplaceCtx, project, this.directory(), apiKey, false)
      const skills = (await fetchMarketplaceSkills(this.marketplaceCtx, this.directory())) ?? []
      const targets = this.removal.issue(skills, project)
      await this.removal.reconcile(project)
      await this.decorateLocalSkills(data.marketplaceItems, project, targets)
      this.post({
        type: "marketplaceCatalog",
        marketplaceItems: data.marketplaceItems,
        marketplaceInstalledMetadata: data.marketplaceInstalledMetadata,
        ...(data.errors ? { errors: data.errors } : {}),
      })
      return
    }
    const apiKey = await this.getCurrentProviderApiKey()
    if (!apiKey) return
    if (name === "installation.changed") {
      this.post({ type: "marketplaceSync", marketplaceInstallations: await this.marketplace.installations(apiKey) })
      return
    }
    if (name === "publication.changed") {
      this.post({ type: "marketplaceSync", marketplacePublications: await this.marketplace.publications(apiKey) })
      return
    }
    if (name === "analytics.updated") {
      this.post({ type: "marketplaceSync", marketplaceAnalytics: await this.marketplace.analytics(apiKey) })
    }
  }

  private async fetchSkillDetail(id: string): Promise<void> {
    try {
      const detail = await this.marketplace.skill(id)
      void this.analytics.track("skill_open", { skillId: id, revision: detail.latestRevision })
      this.post({ type: "marketplaceSkillDetail", id, detail })
    } catch (err) {
      const error = marketplaceDataErrorMessage(err)
      console.warn("[Kilo New] Marketplace Skill detail fetch failed:", err)
      this.post({ type: "marketplaceSkillDetail", id, error })
    }
  }

  private async pickLocalSkills(kind: "file" | "folder"): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: kind === "file",
      canSelectFolders: kind === "folder",
      openLabel: kind === "folder" ? "选择 Skill 文件夹" : "选择 Skill 文件",
      ...(kind === "file" ? { filters: { "Skill sources": ["md", "zip", "gz"] } } : {}),
    })
    const source = selected?.[0]
    if (!source) return
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在检查本地 Skill…",
        cancellable: false,
      },
      async () => {
        try {
          const preview = await this.importer.preview(source.fsPath, this.project ?? undefined)
          this.post({ type: "localSkillImportPreview", preview })
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          this.post({ type: "localSkillImportError", error })
          vscode.window.showErrorMessage(`本地 Skill 预检失败：${error}`)
        }
      },
    )
  }

  private async installLocalSkills(selection: SkillImportSelection): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在导入本地 Skill…",
        cancellable: false,
      },
      async () => {
        try {
          const result = await this.importer.install(selection, this.project ?? undefined)
          const installed = result.items.filter((item) => item.status === "installed")
          for (const item of installed) await this.detachManagedSkill(item.id, selection.scope)
          if (installed.length > 0) {
            const dir = selection.scope === "project" ? this.project! : this.directory()
            await invalidateMarketplaceSkills(this.marketplaceCtx, selection.scope, dir)
          }
          this.post({ type: "localSkillImportResult", result })
          await this.fetchData()
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          this.post({ type: "localSkillImportError", error })
          vscode.window.showErrorMessage(`本地 Skill 导入失败：${error}`)
        }
      },
    )
  }

  private async detachManagedSkill(id: string, scope: "global" | "project") {
    const workspace = scope === "project" ? (this.project ?? undefined) : undefined
    const workspaceId = this.registry.workspaceId(workspace)
    const origin = new URL(this.marketplace.serverBaseUrl()).origin
    const saved = await this.registry.get(origin, id, scope, workspaceId)
    if (!saved) return
    const apiKey = await this.getCurrentProviderApiKey()
    if (apiKey) {
      await this.marketplace
        .syncInstallation(
          id,
          {
            skillId: id,
            revision: saved.revision,
            sha256: saved.sha256,
            scope,
            status: "local-unmanaged",
            clientId: saved.clientId,
            ...(workspaceId ? { workspaceId } : {}),
          },
          apiKey,
        )
        .catch((err) => console.warn("[Kilo New] Local Skill override sync failed:", err))
    }
    await this.registry.remove(origin, id, scope, workspaceId)
  }

  private async decorateLocalSkills(
    items: MarketplaceItem[],
    project: string | undefined,
    targets: IssuedSkillRemoveTarget[],
  ) {
    const workspaceId = this.localRegistry.workspaceId(project)
    const records = (await this.localRegistry.list()).filter(
      (item) => item.scope === "global" || (item.scope === "project" && item.workspaceId === workspaceId),
    )
    const available = new Map(targets.map((target) => [target.skillId, target]))
    for (const item of items) {
      if (item.type !== "skill") continue
      const target = available.get(normalizeSkillKey(item.id))
      if (target && item.localOnly) {
        item.removeToken = target.targetToken
        item.localScope = target.scope
      }
      const record = records.find((entry) => entry.skillId === item.id && (!target || entry.scope === target.scope))
      if (!record) continue
      item.origin = "local-import"
      if (target) {
        item.removeToken = target.targetToken
        item.localScope = target.scope
      }
      item.localState = item.localOnly || item.sha256 === record.installedSha256 ? "unmanaged" : "modified"
      item.publishState = this.blockedSkillIds.has(item.id)
        ? "blocked"
        : item.localOnly
          ? "unpublished"
          : item.sha256 === record.installedSha256
            ? "matched"
            : "local-changes"
    }
  }

  private async removeLocalSkill(requestId: string, targetToken: string, skillId: string, scope: "global" | "project") {
    const progress = (phase: SkillRemovePhase) => this.post({ type: "skillRemoveProgress", requestId, phase })
    const result = await this.removal.remove({ requestId, targetToken, skillId, scope }, this.directory(), progress)
    if (result.success) await this.fetchData()
    this.post({ type: "skillRemoveResult", ...result })
    if (result.success) {
      void vscode.window.showInformationMessage("Skill 已删除，无需重启。")
      return
    }
    void vscode.window.showErrorMessage(`Skill 删除失败：${result.error ?? "未知错误"}`)
  }

  private async uploadMarketplaceSkill(id: string): Promise<void> {
    if (!isListedUploadableSkill(id, this.uploadableSkillIds)) {
      vscode.window.showWarningMessage("该 Skill 当前不满足上传条件，请刷新市场后重试。")
      return
    }

    const selected = await this.installedSkillForUpload(id)
    if (!selected) {
      vscode.window.showWarningMessage("该 Skill 已不在当前已安装列表，请刷新市场后重试。")
      await this.fetchData()
      return
    }

    const apiKey = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在验证市场用户...",
        cancellable: false,
      },
      async () => await this.marketplaceApiKey("上传 Skill 到市场"),
    )
    if (!apiKey) return
    void this.analytics.track("publication_start", { context: { source: "vscode" } })

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在上传 Skill 到市场...",
        cancellable: false,
      },
      async () => {
        try {
          const payload = selected.root
            ? await buildMarketplaceSkillUploadPayload(selected.root)
            : buildMarketplaceBuiltinSkillUploadPayload({
                name: selected.name,
                description: selected.description,
                content: selected.content ?? "",
              })
          const run = await this.marketplace.uploadSkill(payload, apiKey)
          if (run) {
            if (run.status === "PUBLISHED" || run.status === "UNCHANGED") this.blockedSkillIds.delete(id)
            else this.blockedSkillIds.add(id)
            void this.analytics.track(
              run.status === "PUBLISHED" || run.status === "UNCHANGED"
                ? "publication_success"
                : "publication_validation_failed",
              {
                ...(run.skillId ? { skillId: run.skillId } : {}),
                ...(run.release ? { revision: run.release.revision } : {}),
                context: { status: run.status },
              },
            )
            this.post({ type: "marketplacePublicationResult", run })
            const label = run.status === "PUBLISHED" || run.status === "UNCHANGED" ? "发布完成" : "校验完成"
            vscode.window.showInformationMessage(`${label}：${payload.name} · ${run.status}`)
            const files = run.patches.filter((patch) => patch.kind === "deterministic").flatMap((patch) => patch.files)
            if (selected.root && run.report?.changed && files.length > 0) {
              const choice = await vscode.window.showInformationMessage(
                "服务端仅修复了上传快照。是否查看逐文件 diff，并选择是否应用到本地？",
                "查看 diff",
              )
              if (choice === "查看 diff") await applyLocalRepairs(selected.root, files)
            }
          } else {
            vscode.window.showInformationMessage(`Skill 上传成功：${payload.name}`)
          }
          await this.fetchData()
        } catch (err) {
          void this.analytics.track("publication_validation_failed", { context: { reason: "request-failed" } })
          vscode.window.showErrorMessage(`Skill 上传失败：${marketplaceIdentityErrorMessage(err)}`)
        }
      },
    )
  }

  private async installedSkillForUpload(id: string): Promise<UploadableSkill | undefined> {
    try {
      const client = await this.connection.getClientAsync(this.directory())
      const { data } = await client.app.skills({ directory: this.directory() }, { throwOnError: true })
      const skills = (data ?? []).map((skill) => normalizeLocalSkill(skill as CliSkill))
      return skills.find((skill) => skill?.id === normalizeSkillKey(id))
    } catch (err) {
      console.warn("[Kilo New] Marketplace failed to list installed skills for upload:", err)
      vscode.window.showWarningMessage("读取本地已安装 Skill 失败，请确认 Kilo CLI 已正常启动。")
      return undefined
    }
  }

  private async starMarketplaceSkill(skillId: string): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在为 Skill 点赞...",
        cancellable: false,
      },
      async () => {
        const apiKey = await this.marketplaceApiKey("为 Skill 点赞")
        if (!apiKey) return

        try {
          await this.marketplace.starSkill(skillId, apiKey)
          void this.analytics.track("skill_favorite", { skillId, context: { action: "toggle" } })
          await this.fetchData()
        } catch (err) {
          vscode.window.showErrorMessage(`Skill 点赞失败：${marketplaceIdentityErrorMessage(err)}`)
        }
      },
    )
  }

  private async unpublishMarketplaceSkill(skillId: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `确认下架 ${skillId}？下架后公开目录将不再显示，但历史版本和审计记录仍会保留。`,
      { modal: true },
      "确认下架",
    )
    if (confirm !== "确认下架") return

    const apiKey = await this.marketplaceApiKey("下架市场 Skill")
    if (!apiKey) return

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `正在下架 ${skillId}...`,
        cancellable: false,
      },
      async () => {
        try {
          const run = await this.marketplace.unpublishSkill(skillId, apiKey)
          this.post({ type: "marketplacePublicationResult", run })
          vscode.window.showInformationMessage(`Skill 已下架：${skillId}`)
          await this.fetchData()
        } catch (err) {
          vscode.window.showErrorMessage(`Skill 下架失败：${marketplaceIdentityErrorMessage(err)}`)
        }
      },
    )
  }

  private async refreshMarketplaceUser(): Promise<void> {
    const apiKey = await this.getCurrentProviderApiKey()
    if (!apiKey) {
      this.marketplaceUser = undefined
      return
    }
    await this.resolveMarketplaceUser(apiKey, false)
  }

  private async marketplaceApiKey(action: string): Promise<string | undefined> {
    const apiKey = await this.getCurrentProviderApiKey()
    if (!apiKey) {
      vscode.window.showWarningMessage(`当前提供商未配置 API Key，无法${action}。`)
      return undefined
    }
    if (await this.resolveMarketplaceUser(apiKey, true)) return apiKey
    return undefined
  }

  private async getCurrentProviderApiKey(): Promise<string | undefined> {
    try {
      const key = await withTimeout(
        this.readCurrentProviderApiKey(),
        MARKETPLACE_PROVIDER_KEY_TIMEOUT_MS,
        () => undefined,
      )
      if (!key) console.info("[Kilo New] Marketplace did not find a current provider API key.")
      return key
    } catch (err) {
      console.warn("[Kilo New] Marketplace current provider API key lookup failed:", err)
      return undefined
    }
  }

  private async readCurrentProviderApiKey(): Promise<string | undefined> {
    try {
      const client = this.connection.getClient()
      if (!client) return undefined
      const directory = this.directory()
      const [{ data: config }, { data: providers }] = await Promise.all([
        client.config.get({ directory }, { throwOnError: true }),
        client.provider.list({ directory }, { throwOnError: true }),
      ])
      const selectedProvider = providerIdFromModel(config?.model)
      const keyed = (providers?.all ?? [])
        .map((provider) => {
          const raw = provider as Record<string, unknown>
          return {
            id: typeof raw.id === "string" ? raw.id : "",
            key: typeof raw.key === "string" && raw.key.trim() ? raw.key.trim() : undefined,
          }
        })
        .filter((provider): provider is { id: string; key: string } => Boolean(provider.id && provider.key))

      if (selectedProvider) {
        const selectedAuthKey = await this.providerAuthApiKey(selectedProvider)
        if (selectedAuthKey) return selectedAuthKey
        const selected = keyed.find((provider) => provider.id === selectedProvider)
        if (selected) return selected.key
        const selectedConfigKey = configApiKey(config?.provider?.[selectedProvider])
        if (selectedConfigKey) return selectedConfigKey
      }

      if (keyed.length === 1) return keyed[0].key
    } catch (err) {
      console.warn("[Kilo New] Marketplace failed to read current provider API key:", err)
    }
    return undefined
  }

  private async providerAuthApiKey(providerID: string): Promise<string | undefined> {
    try {
      const client = this.connection.getClient()
      if (!client) return undefined
      const { data } = await client.auth.get({ providerID }, { throwOnError: true })
      if (!data || typeof data !== "object") return undefined
      const record = data as Record<string, unknown>
      if (record.type !== "api") return undefined
      const key = typeof record.key === "string" ? record.key.trim() : ""
      return key || undefined
    } catch (err) {
      console.warn(`[Kilo New] Marketplace failed to read auth key for provider "${providerID}":`, err)
      return undefined
    }
  }

  private async resolveMarketplaceUser(apiKey: string, notify: boolean): Promise<boolean> {
    try {
      this.marketplaceUser = await this.marketplace.resolveUser(apiKey)
      if (notify) vscode.window.showInformationMessage(`市场用户：${this.marketplaceUser.name}`)
      return true
    } catch (err) {
      this.marketplaceUser = undefined
      if (notify) vscode.window.showWarningMessage(`市场用户验证失败：${marketplaceIdentityErrorMessage(err)}`)
      else console.warn("[Kilo New] Marketplace provider API key did not resolve to a user:", err)
      return false
    }
  }

  private async install(item: MarketplaceItem, opts: InstallMarketplaceItemOptions): Promise<void> {
    const result = await installMarketplaceItem(
      this.marketplaceCtx,
      item,
      opts,
      this.project ?? undefined,
      this.directory(),
    )
    if (result.success && item.type === "skill" && item.revision && item.sha256) {
      await this.syncManaged(item, opts.target ?? "project", "installed")
      void this.analytics.track("skill_install", { skillId: item.id, revision: item.revision })
    }
    this.post({ type: "marketplaceInstallResult", ...result })
  }

  private async remove(item: MarketplaceItem, scope: "project" | "global"): Promise<void> {
    const result = await removeMarketplaceItem(
      this.marketplaceCtx,
      item,
      scope,
      this.project ?? undefined,
      this.directory(),
    )
    if (result.success && item.type === "skill") {
      await this.syncManaged(item, scope, "removed")
      void this.analytics.track("skill_remove", {
        skillId: item.id,
        ...(item.revision ? { revision: item.revision } : {}),
      })
    }
    this.post({ type: "marketplaceRemoveResult", ...result })
  }

  private async syncManaged(
    item: SkillMarketplaceItem,
    scope: "project" | "global",
    status: "installed" | "removed",
  ): Promise<void> {
    const apiKey = await this.getCurrentProviderApiKey()
    if (!apiKey) return
    const workspace = scope === "project" ? (this.project ?? undefined) : undefined
    const workspaceId = this.registry.workspaceId(workspace)
    const origin = new URL(this.marketplace.serverBaseUrl()).origin
    const saved = await this.registry.get(origin, item.id, scope, workspaceId)
    const revision = item.revision ?? saved?.revision
    const sha256 = item.sha256 ?? saved?.sha256
    if (!revision || !sha256) return
    const clientId = saved?.clientId ?? (await this.registry.clientId())
    try {
      const state = {
        skillId: item.id,
        revision,
        sha256,
        scope,
        status,
        clientId,
        ...(workspaceId ? { workspaceId } : {}),
      }
      const synced = await this.marketplace.syncInstallation(item.id, state, apiKey)
      if (status === "removed") await this.registry.remove(origin, item.id, scope, workspaceId)
      else await this.registry.put({ origin, ...state, changedAt: synced.changedAt })
    } catch (err) {
      console.warn("[Kilo New] Marketplace installation state sync failed:", err)
      vscode.window.showWarningMessage("Skill 已在本地变更，但市场安装状态同步失败；请稍后刷新重试。")
    }
  }

  private async restoreManaged(): Promise<void> {
    if (this.restored) return
    this.restored = true
    const apiKey = await this.getCurrentProviderApiKey()
    if (!apiKey) return
    const origin = new URL(this.marketplace.serverBaseUrl()).origin
    const project = this.project ?? undefined
    const workspaceId = this.registry.workspaceId(project)
    for (const item of await this.registry.list(origin)) {
      if (item.scope === "project" && item.workspaceId !== workspaceId) continue
      const workspace = item.scope === "project" ? project : undefined
      const exists = await this.marketplace.isSkillInstalled(item.skillId, item.scope, workspace)
      const status = exists ? ("installed" as const) : ("removed" as const)
      try {
        await this.marketplace.syncInstallation(
          item.skillId,
          {
            skillId: item.skillId,
            revision: item.revision,
            sha256: item.sha256,
            scope: item.scope,
            status,
            clientId: item.clientId,
            ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
          },
          apiKey,
        )
        if (!exists) await this.registry.remove(origin, item.skillId, item.scope, item.workspaceId)
      } catch (err) {
        console.warn("[Kilo New] Marketplace installation metadata recovery failed:", err)
      }
    }
  }

  private handleStatus(event: Event): void {
    if (event.type !== "session.status") return
    const sid = event.properties.sessionID
    this.statuses.set(sid, event.properties.status.type)
    const msg = mapSSEEventToWebviewMessage(event, sid)
    if (msg) this.post(msg)
  }

  private setProjectDirectory(project: string | null): void {
    if (this.project === project) return
    this.project = project
    this.post({ type: "workspaceDirectoryChanged", directory: project ?? "" })
  }

  private resolveProject(): string | null {
    const editor = vscode.window.activeTextEditor
    const active =
      editor?.document.uri.scheme === "file"
        ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
        : undefined
    return resolvePanelProjectDirectory(active, vscode.workspace.workspaceFolders)
  }

  private directory(): string {
    return this.project ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
  }

  private openExternal(raw: unknown): void {
    if (typeof raw !== "string") return
    const uri = vscode.Uri.parse(raw)
    if (uri.scheme !== "http" && uri.scheme !== "https") return
    void vscode.env.openExternal(uri)
  }

  private post(msg: unknown): void {
    if (!this.panel || !this.ready) return
    void this.panel.webview.postMessage(msg).then(undefined, (err) => {
      console.warn("[Kilo New] Marketplace panel postMessage failed:", err)
    })
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "marketplace.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "marketplace.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "ChipMate 市场",
      port: this.connection.getServerInfo()?.port,
    })
  }
}

function marketplaceDataErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/aborted|aborterror|operation was aborted/i.test(message))
    return "获取技能市场失败：连接 ChipMate Server 超时或被中止"
  return message.startsWith("获取") ? message : `获取技能市场失败：${message}`
}

function providerIdFromModel(model: unknown): string | undefined {
  if (model && typeof model === "object" && !Array.isArray(model)) {
    const providerID = (model as Record<string, unknown>).providerID
    return typeof providerID === "string" && providerID.trim() ? providerID.trim() : undefined
  }
  if (typeof model !== "string") return undefined
  const slash = model.indexOf("/")
  const provider = slash > 0 ? model.slice(0, slash).trim() : ""
  return provider || undefined
}

function normalizeLocalSkill(skill: CliSkill): UploadableSkill | undefined {
  const name = skill.name.trim()
  const location = skill.location.trim()
  if (!name || !location) return undefined
  const content = typeof skill.content === "string" ? skill.content : ""
  if (location === "builtin") {
    if (!content.trim()) return undefined
    return {
      id: normalizeSkillKey(name),
      name,
      description: skill.description?.trim() || undefined,
      content,
    }
  }
  if (path.basename(location) !== "SKILL.md") return undefined
  const root = path.dirname(location)
  return {
    id: normalizeSkillKey(name),
    name,
    description: skill.description?.trim() || undefined,
    root,
  }
}

function configApiKey(config: unknown): string | undefined {
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined
  const record = config as Record<string, unknown>
  const direct = typeof record.apiKey === "string" ? record.apiKey.trim() : ""
  if (direct) return direct
  const options = record.options
  if (!options || typeof options !== "object" || Array.isArray(options)) return undefined
  const key = (options as Record<string, unknown>).apiKey
  return typeof key === "string" && key.trim() ? key.trim() : undefined
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback()), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
