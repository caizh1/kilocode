import * as os from "os"
import * as path from "path"
import { createHash, randomUUID } from "crypto"
import * as vscode from "vscode"
import type { GlobalEvent, SessionStatus } from "@kilocode/sdk/v2/client"
import { buildWebviewHtml, getWebviewFontSize } from "./utils"
import { watchFontSizeConfig } from "./kilo-provider/font-size"
import { mapSSEEventToWebviewMessage } from "./kilo-provider-utils"
import { resolvePanelProjectDirectory } from "./project-directory"
import { seedSessionStatuses } from "./session-status"
import type { KiloConnectionService } from "./services/cli-backend"
import { MarketplaceService } from "./services/marketplace"
import type { CliSkill } from "./services/marketplace/detection"
import { marketplaceIdentityErrorMessage, marketplaceIssue } from "./services/marketplace/errors"
import { pickInstallScope } from "./services/marketplace/install-ui"
import { applyLocalRepairs } from "./services/marketplace/local-repair"
import { MarketplaceAnalytics } from "./services/marketplace/analytics"
import { InstallRegistry } from "./services/marketplace/registry"
import { LocalImportRegistry } from "./services/marketplace/local-import-registry"
import { LocalSkillImporter } from "./services/marketplace/local-import"
import { identityState, serverFailure, serverState as resolvedServerState } from "./services/marketplace/runtime"
import {
  LocalSkillRemoval,
  type IssuedSkillRemoveTarget,
  type SkillRemovePhase,
} from "./services/marketplace/local-skill-removal"
import { confirmRepairDiff, generateAiRepair } from "./services/marketplace/repair"
import { publish, type PublicationOutcome, type PublicationPhase } from "./services/marketplace/publication"
import { publishBatch } from "./services/marketplace/publication-batch"
import { isListedUploadableSkill, normalizeSkillKey } from "./services/marketplace/skills"
import { archiveUrl, installLink, repairLink, type InstallLink } from "./services/marketplace/uri"
import {
  buildMarketplaceBuiltinSkillUploadPayload,
  buildMarketplaceSkillUploadPayload,
} from "./services/marketplace/upload"
import {
  activatableSkillIds,
  activateMarketplaceSkills,
  fetchMarketplaceData,
  fetchMarketplaceSkills,
  invalidateMarketplaceSkills,
  installMarketplaceItem,
  removeMarketplaceItem,
  type MarketplaceActionContext,
} from "./services/marketplace/actions"
import type {
  BatchPublicationItem,
  InstallMarketplaceItemOptions,
  SkillImportSelection,
  MarketplaceItem,
  MarketplaceIdentityState,
  MarketplaceServerState,
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
  mpSkillInstanceId?: string
  mpSkillIds?: string[]
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
  instanceId?: string
  name: string
  description?: string
  root?: string
  content?: string
  sha256?: string
}

function phaseLabel(phase: PublicationPhase, status?: string) {
  if (phase === "preparing") return "正在准备规范快照..."
  if (phase === "submitting") return "正在上传并等待服务端权威复验..."
  return `已收到服务端结果：${status ?? "SUCCESS"}`
}

export class MarketplacePanelProvider implements vscode.Disposable {
  public static readonly viewType = "chipmate.v2.marketplacePanel"

  private panel: vscode.WebviewPanel | undefined
  private project: string | null = null
  private ready = false
  private restored = false
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private statuses = new Map<string, SessionStatus["type"]>()
  private pendingInstall: MarketplaceItem | undefined
  private disposables: vscode.Disposable[] = []
  private subscriptions: Array<() => void> = []
  private readonly marketplace: MarketplaceService
  private readonly registry: InstallRegistry
  private readonly localRegistry: LocalImportRegistry
  private readonly importer: LocalSkillImporter
  private readonly removal: LocalSkillRemoval
  private readonly analytics: MarketplaceAnalytics
  private uploadableSkillIds = new Set<string>()
  private uploadableSkillHashes = new Map<string, string | undefined>()
  private readonly blockedSkillIds = new Set<string>()
  private marketplaceUser: MarketplaceUser | undefined
  private serverState: MarketplaceServerState = { status: "connecting", checkedAt: new Date().toISOString() }
  private identityState: MarketplaceIdentityState = { status: "verifying", checkedAt: new Date().toISOString() }
  private identityRun: Promise<string | undefined> | undefined
  private identityNotify = false
  private readonly extensionVersion =
    vscode.extensions.getExtension("chipmate.chipmate")?.packageJSON?.version ?? "unknown"

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.marketplace = new MarketplaceService(path.join(context.globalStorageUri.fsPath, "config"))
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
      os.homedir(),
      path.join(context.globalStorageUri.fsPath, "config"),
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
      this.scheduleRefresh()
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
    await invalidateMarketplaceSkills(this.marketplaceCtx, selected.scope, dir)
    vscode.window.showInformationMessage(`${intent.skillId} r${intent.revision} 已安全安装并同步。`)
    this.openPanel(workspace ?? null)
    await this.fetchData()
  }

  /** Open the panel and surface the install dialog for a specific item, project scope preselected. */
  openInstall(item: MarketplaceItem): void {
    this.openPanel()
    this.pendingInstall = item
    this.flushPendingInstall()
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
    this.marketplaceUser = undefined
    this.serverState = { status: "connecting", checkedAt: new Date().toISOString() }
    this.identityState = { status: "verifying", checkedAt: new Date().toISOString() }
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
      vscode.extensions.onDidChange(() => this.scheduleRefresh()),
      vscode.workspace.onDidCreateFiles(() => this.scheduleRefresh()),
      vscode.workspace.onDidDeleteFiles(() => this.scheduleRefresh()),
      vscode.workspace.onDidRenameFiles(() => this.scheduleRefresh()),
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
        (event) => {
          if (event.type === "session.status") this.handleStatus(event)
        },
      ),
    )
    void this.connect()
  }

  private cleanup(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    for (const disposable of this.disposables) disposable.dispose()
    for (const unsubscribe of this.subscriptions) unsubscribe()
    this.disposables = []
    this.subscriptions = []
    this.panel = undefined
    this.ready = false
    this.generation++
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
      const cfg = vscode.workspace.getConfiguration("chipmate.v2")
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
    if (await this.handleBatchMessage(msg)) return
    if (await this.handleSkillMessage(msg)) return
    switch (msg.type) {
      case "webviewReady":
        this.ready = true
        this.postRuntime()
        if (this.connection.getConnectionState() === "connected") await this.sync(true)
        else await this.connect()
        await this.refreshMarketplaceUser()
        await this.restoreManaged()
        await this.fetchData()
        void this.analytics.track("market_impression", { context: { source: "marketplace-panel" } })
        this.flushPendingInstall()
        return
      case "retryConnection":
        this.serverState = { status: "connecting", checkedAt: new Date().toISOString() }
        this.postRuntime()
        await this.connect()
        await this.refreshMarketplaceUser()
        await this.fetchData()
        return
      case "fetchMarketplaceData":
        await this.fetchData()
        return
      case "verifyMarketplaceUser":
        if (await this.refreshMarketplaceUser(true)) await this.fetchData()
        return
      case "installMarketplaceItem":
        if (msg.mpItem && msg.mpInstallOptions) await this.install(msg.mpItem, msg.mpInstallOptions)
        return
      case "removeInstalledMarketplaceItem":
        if (msg.mpItem) await this.remove(msg.mpItem, msg.mpInstallOptions?.target ?? "project")
        return
      case "dismissAgentMigrationBanner":
        await this.context.globalState.update("chipmate.v2.agentMigrationBannerDismissed", true)
        return
      case "openExternal":
        this.openExternal(msg.url)
        return
      case "telemetry":
        if (msg.event) TelemetryProxy.capture(msg.event as TelemetryEventName, msg.properties)
        return
    }
  }

  private async handleBatchMessage(msg: MarketplaceMessage): Promise<boolean> {
    if (msg.type !== "uploadMarketplaceSkills") return false
    console.info("[Kilo New] Marketplace batch upload requested.")
    if (msg.mpSkillIds) await this.uploadMarketplaceSkills(msg.mpSkillIds)
    return true
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
        await this.removeLocalSkillMessage(msg)
        return true
      case "fetchMarketplaceSkillDetail":
        if (msg.mpSkillId) await this.fetchSkillDetail(msg.mpSkillId)
        return true
      case "uploadMarketplaceSkill":
        console.info("[Kilo New] Marketplace upload skill requested.")
        await this.uploadSkillMessage(msg)
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

  private async removeLocalSkillMessage(msg: MarketplaceMessage): Promise<void> {
    if (!msg.requestId || !msg.targetToken || !msg.skillId || !msg.scope) return
    await this.removeLocalSkill(msg.requestId, msg.targetToken, msg.skillId, msg.scope)
  }

  private async uploadSkillMessage(msg: MarketplaceMessage): Promise<void> {
    const id = msg.mpSkillInstanceId ?? msg.mpSkillId
    if (!id) return
    await this.uploadMarketplaceSkill(id)
  }

  /** Ask the webview to open the install dialog for a queued suggestion, once it can receive it. */
  private flushPendingInstall(): void {
    if (!this.pendingInstall || !this.ready) return
    const item = this.pendingInstall
    this.pendingInstall = undefined
    this.post({ type: "openInstallModal", mpItem: item })
  }

  private scheduleRefresh(): void {
    if (!this.ready) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.fetchData()
    }, 250)
  }

  private async fetchData(): Promise<void> {
    const generation = ++this.generation
    try {
      const project = this.project ?? undefined
      const apiKey = await this.getCurrentProviderApiKey()
      const data = await fetchMarketplaceData(
        this.marketplaceCtx,
        project,
        this.directory(),
        apiKey,
        true,
        this.relevanceRoots(),
      )
      const skills = (await fetchMarketplaceSkills(this.marketplaceCtx, this.directory())) ?? []
      const targets = this.removal.issue(skills, project)
      await this.removal.reconcile(project)
      await this.decorateLocalSkills(data.marketplaceItems, project, targets)
      this.rememberUploadable(data.marketplaceItems)
      if (generation !== this.generation) return
      const dismissed = this.context.globalState.get<boolean>("chipmate.v2.agentMigrationBannerDismissed") ?? false
      this.serverState = resolvedServerState(data.marketplaceStatus, data.errors)
      this.post({
        type: "marketplaceData",
        ...data,
        marketplaceUser: this.marketplaceUser,
        marketplaceBaseUrl: this.marketplace.marketplaceBaseUrl(),
        marketplaceSkillsOnly: this.marketplace.marketplaceSkillsOnly(),
        marketplaceMode: this.marketplace.marketplaceMode(),
        marketplaceServerState: this.serverState,
        marketplaceIdentityState: this.identityState,
        showAgentMigrationBanner: !dismissed,
      })
    } catch (err) {
      this.uploadableSkillIds.clear()
      this.uploadableSkillHashes.clear()
      const error = marketplaceDataErrorMessage(err)
      if (generation !== this.generation) return
      this.serverState = serverFailure(err)
      console.warn("[Kilo New] Marketplace data fetch failed:", err)
      this.post({
        type: "marketplaceData",
        marketplaceItems: [],
        marketplaceInstalledMetadata: { project: {}, global: {} },
        marketplaceUser: this.marketplaceUser,
        marketplaceBaseUrl: this.marketplace.marketplaceBaseUrl(),
        marketplaceSkillsOnly: this.marketplace.marketplaceSkillsOnly(),
        marketplaceMode: this.marketplace.marketplaceMode(),
        marketplaceServerState: this.serverState,
        marketplaceIdentityState: this.identityState,
        marketplaceRelevance: {},
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
      this.rememberUploadable(data.marketplaceItems)
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
          const ids = activatableSkillIds(result.items)
          const activation = await (async () => {
            if (ids.length === 0) return undefined
            const dir = selection.scope === "project" ? this.project! : this.directory()
            return activateMarketplaceSkills(this.marketplaceCtx, selection.scope, dir, ids)
          })()
          const output = activation ? { ...result, activation } : result
          if (activation?.status === "ready") await this.fetchData()
          this.post({ type: "localSkillImportResult", result: output })
          if (activation?.status === "failed") {
            const detail =
              activation.phase === "refresh-request"
                ? activation.message
                : `刷新后仍缺少 ${activation.missingIds?.length ?? 0} 个 Skill`
            void vscode.window.showWarningMessage(`Skill 已写入磁盘，但当前会话未激活：${detail ?? "未知原因"}`)
          }
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
    const origin = new URL(this.marketplace.serverBaseUrl()).origin
    const managed = (await this.registry.list(origin)).filter(
      (item) => item.scope === "global" || (item.scope === "project" && item.workspaceId === workspaceId),
    )
    const available = new Map(targets.map((target) => [target.skillId, target]))
    for (const item of items) {
      if (item.type !== "skill") continue
      const keys = [item.id, item.name, item.displayName].map(normalizeSkillKey).filter(Boolean)
      const target = keys.map((key) => available.get(key)).find((entry) => entry !== undefined)
      if (target && item.origin === "local" && !item.instanceId) {
        item.removeToken = target.targetToken
        item.removeSkillId = target.skillId
        item.localScope = target.scope
      }
      const record = records.find(
        (entry) =>
          keys.includes(normalizeSkillKey(entry.skillId)) &&
          item.localScope !== undefined &&
          entry.scope === item.localScope,
      )
      const installed = managed.find(
        (entry) =>
          keys.includes(normalizeSkillKey(entry.skillId)) &&
          item.localScope !== undefined &&
          entry.scope === item.localScope,
      )
      if (record) item.origin = "local-import"
      else if (installed) item.origin = "market"
      else if (item.instanceId) item.origin = "local"
      if (!record) continue
      if (target && !item.instanceId) {
        item.removeToken = target.targetToken
        item.removeSkillId = target.skillId
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

  private rememberUploadable(items: MarketplaceItem[]): void {
    const skills = items.filter(
      (item): item is SkillMarketplaceItem => item.type === "skill" && Boolean(item.uploadable),
    )
    this.uploadableSkillIds = new Set(skills.map((item) => item.instanceId ?? item.id))
    this.uploadableSkillHashes = new Map(skills.map((item) => [item.instanceId ?? item.id, item.localSha256]))
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

  private async uploadMarketplaceSkill(key: string): Promise<void> {
    if (!isListedUploadableSkill(key, this.uploadableSkillIds)) {
      vscode.window.showWarningMessage("该 Skill 当前不满足上传条件，请刷新市场后重试。")
      return
    }

    const selected = await this.installedSkillForUpload(key)
    if (!selected) {
      vscode.window.showWarningMessage("该 Skill 已不在当前已安装列表，请刷新市场后重试。")
      await this.fetchData()
      return
    }
    const expected = this.uploadableSkillHashes.get(key)
    if (expected && selected.sha256 !== expected) {
      vscode.window.showWarningMessage("该 Skill 内容已变化，请刷新市场后重新选择上传。")
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

    await publish({
      progress: (task) =>
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "正在发布 Skill 到市场...",
            cancellable: false,
          },
          async (progress) =>
            task((phase, status) => {
              progress.report({ message: phaseLabel(phase, status) })
            }),
        ),
      build: async () =>
        selected.root
          ? await buildMarketplaceSkillUploadPayload(selected.root)
          : buildMarketplaceBuiltinSkillUploadPayload({
              name: selected.name,
              description: selected.description,
              content: selected.content ?? "",
            }),
      submit: (payload) => this.marketplace.uploadSkill(payload, apiKey),
      finish: (outcome) => this.finishPublication(selected.id, selected, outcome),
    }).catch((err: unknown) => {
      void this.analytics.track("publication_validation_failed", { context: { reason: "request-failed" } })
      void vscode.window.showErrorMessage(`Skill 上传失败：${marketplaceIdentityErrorMessage(err)}`)
    })
  }

  private async uploadMarketplaceSkills(ids: string[]): Promise<void> {
    const requested = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
    if (requested.length === 0) {
      this.post({ type: "marketplaceBatchPublicationResult", result: { items: [] } })
      return
    }

    const apiKey = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在验证市场用户...",
        cancellable: false,
      },
      async () => await this.marketplaceApiKey("批量上传 Skill 到市场"),
    )
    if (!apiKey) {
      this.postBatchFailure(requested, "市场身份验证失败，批量上传未启动。")
      return
    }

    const installed = await this.installedSkillsForUpload().catch((err: unknown) => {
      console.warn("[Kilo New] Marketplace failed to list installed Skills for batch upload:", err)
      return undefined
    })
    if (!installed) {
      this.postBatchFailure(requested, "读取本地已安装 Skill 失败，请确认 ChipMate CLI 已正常启动。")
      return
    }

    const skills = new Map(installed.map((skill) => [skill.instanceId ?? skill.id, skill]))
    const skipped = new Map<string, BatchPublicationItem>()
    const targets = requested.flatMap((id) => {
      if (!isListedUploadableSkill(id, this.uploadableSkillIds)) {
        skipped.set(id, {
          id: skills.get(id)?.id ?? id,
          name: skills.get(id)?.name ?? id,
          state: "skipped",
          error: "该 Skill 已不满足上传条件。",
        })
        return []
      }
      const skill = skills.get(id)
      const expected = this.uploadableSkillHashes.get(id)
      if (skill && (!expected || skill.sha256 === expected)) return [{ id, name: skill.name, skill }]
      if (skill) {
        skipped.set(id, {
          id: skill.id,
          name: skill.name,
          state: "skipped",
          error: "该 Skill 内容已变化，请刷新后重新选择。",
        })
        return []
      }
      skipped.set(id, { id, name: id, state: "skipped", error: "该 Skill 已不在当前已安装列表。" })
      return []
    })

    const completed = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在批量发布 Skill 到市场...",
        cancellable: false,
      },
      async (progress) =>
        publishBatch(
          targets,
          async (target) => {
            void this.analytics.track("publication_start", {
              skillId: target.skill.id,
              context: { source: "vscode-batch" },
            })
            const payload = target.skill.root
              ? await buildMarketplaceSkillUploadPayload(target.skill.root)
              : buildMarketplaceBuiltinSkillUploadPayload({
                  name: target.skill.name,
                  description: target.skill.description,
                  content: target.skill.content ?? "",
                })
            return this.marketplace.uploadSkill(payload, apiKey)
          },
          (target, current, total) => {
            progress.report({ message: `${current}/${total} · ${target.name}` })
          },
        ),
    )

    const results = new Map(completed.map((item) => [item.id, item]))
    for (const item of completed) {
      if (item.run) this.recordPublication(item.run.skillId ?? skills.get(item.id)?.id ?? item.id, item.run)
      if (item.state === "failed") {
        void this.analytics.track("publication_validation_failed", {
          skillId: skills.get(item.id)?.id ?? item.id,
          context: { reason: "request-failed", source: "vscode-batch" },
        })
      }
    }
    const items = requested.flatMap((id) => {
      const item = results.get(id) ?? skipped.get(id)
      return item ? [item] : []
    })
    this.post({ type: "marketplaceBatchPublicationResult", result: { items } })
    await this.fetchData()
  }

  private postBatchFailure(ids: string[], error: string): void {
    this.post({
      type: "marketplaceBatchPublicationResult",
      result: {
        items: ids.map((id) => ({ id, name: id, state: "failed" as const, error })),
      },
    })
  }

  private async finishPublication(id: string, selected: UploadableSkill, outcome: PublicationOutcome) {
    const run = outcome.run
    if (!run) {
      void vscode.window.showInformationMessage(`Skill 上传成功：${outcome.payload.name}`)
      void this.fetchData()
      return
    }

    this.recordPublication(id, run)
    void this.fetchData()

    const label = run.status === "PUBLISHED" || run.status === "UNCHANGED" ? "发布完成" : "校验完成"
    const files = run.patches.filter((patch) => patch.kind === "deterministic").flatMap((patch) => patch.files)
    if (!selected.root || !run.report?.changed || files.length === 0) {
      void vscode.window.showInformationMessage(`${label}：${outcome.payload.name} · ${run.status}`)
      return
    }

    const choice = await vscode.window.showInformationMessage(
      `${label}：${outcome.payload.name} · ${run.status}。服务端仅修复了上传快照，本地文件未修改。`,
      "查看 diff",
    )
    if (choice !== "查看 diff") return
    const applied = await applyLocalRepairs(selected.root, files).catch((err: unknown) => {
      void vscode.window.showErrorMessage(`应用 Skill 本地修复失败：${marketplaceIdentityErrorMessage(err)}`)
      return false
    })
    if (applied) void this.fetchData()
  }

  private recordPublication(id: string, run: NonNullable<PublicationOutcome["run"]>): void {
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
  }

  private async installedSkillForUpload(id: string): Promise<UploadableSkill | undefined> {
    try {
      const skills = await this.installedSkillsForUpload()
      return skills.find((skill) => (skill.instanceId ?? skill.id) === id)
    } catch (err) {
      console.warn("[Kilo New] Marketplace failed to list installed skills for upload:", err)
      vscode.window.showWarningMessage("读取本地已安装 Skill 失败，请确认 ChipMate CLI 已正常启动。")
      return undefined
    }
  }

  private async installedSkillsForUpload(): Promise<UploadableSkill[]> {
    const client = await this.connection.getClientAsync(this.directory())
    const { data } = await client.app.skills({ directory: this.directory() }, { throwOnError: true })
    const builtin = (data ?? []).flatMap((skill) => {
      const item = normalizeLocalSkill(skill as CliSkill)
      return item && !item.root ? [item] : []
    })
    const found = await this.marketplace.skillInstances(this.project ?? undefined)
    const physical = found.items.map((item) => ({
      id: item.id,
      instanceId: item.instanceId,
      name: item.name,
      description: item.description,
      root: item.root,
      sha256: item.sha256,
    }))
    return [...physical, ...builtin]
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

  private refreshMarketplaceUser(notify = false): Promise<string | undefined> {
    if (notify) this.identityNotify = true
    if (this.identityRun) return this.identityRun
    const run = this.authenticateMarketplaceUser().finally(() => {
      if (this.identityRun === run) this.identityRun = undefined
      this.identityNotify = false
    })
    this.identityRun = run
    return run
  }

  private async marketplaceApiKey(action: string): Promise<string | undefined> {
    const apiKey = await this.refreshMarketplaceUser(true)
    if (!apiKey) {
      if (this.identityState.status === "unverified") {
        vscode.window.showWarningMessage(`当前提供商未配置 API Key，无法${action}。`)
      }
      return undefined
    }
    return apiKey
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
      const { data: config } = await client.config.get({ directory }, { throwOnError: true })
      const selectedProvider = providerIdFromModel(config?.model)

      if (selectedProvider) {
        const saved = await client.auth
          .get({ providerID: selectedProvider }, { throwOnError: true })
          .then((result) => authApiKey(result.data))
          .catch((err: unknown) => {
            console.warn("[Kilo New] Marketplace failed to read current provider auth:", err)
            return undefined
          })
        if (saved) return saved
      }

      const providers = await client.provider
        .list({ directory }, { throwOnError: true })
        .then((result) => result.data)
        .catch((err: unknown) => {
          console.warn("[Kilo New] Marketplace failed to read provider fallbacks:", err)
          return undefined
        })
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

  private async authenticateMarketplaceUser(): Promise<string | undefined> {
    this.identityState = identityState("verifying", { user: this.marketplaceUser })
    this.postRuntime()
    const apiKey = await this.getCurrentProviderApiKey()
    if (!apiKey) {
      this.marketplaceUser = undefined
      this.identityState = identityState("unverified", {
        issue: { summary: "当前提供商未配置 API Key。", code: "provider-api-key-missing" },
      })
      this.postRuntime()
      if (this.identityNotify) vscode.window.showWarningMessage("当前提供商未配置 API Key，无法验证市场身份。")
      return undefined
    }
    try {
      this.marketplaceUser = await this.marketplace.resolveUser(apiKey)
      this.identityState = identityState("verified", { user: this.marketplaceUser })
      this.postRuntime()
      if (this.identityNotify) vscode.window.showInformationMessage(`市场用户：${this.marketplaceUser.name}`)
      return apiKey
    } catch (err) {
      this.marketplaceUser = undefined
      const message = marketplaceIdentityErrorMessage(err)
      this.identityState = identityState("failed", { issue: marketplaceIssue(err, message) })
      this.postRuntime()
      if (this.identityNotify) vscode.window.showWarningMessage(`市场用户验证失败：${message}`)
      else console.warn("[Kilo New] Marketplace provider API key did not resolve to a user:", err)
      return undefined
    }
  }

  private postRuntime(): void {
    if (!this.ready) return
    this.post({
      type: "marketplaceRuntimeState",
      marketplaceServerState: this.serverState,
      marketplaceIdentityState: this.identityState,
    })
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
      const workspaceId = this.localRegistry.workspaceId(scope === "project" ? (this.project ?? undefined) : undefined)
      await this.localRegistry.remove(item.id, scope, workspaceId)
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

  private handleStatus(event: Extract<GlobalEvent["payload"], { type: "session.status" }>): void {
    const sid = event.properties.sessionID
    this.statuses.set(sid, event.properties.status.type)
    const msg = mapSSEEventToWebviewMessage(event, sid)
    if (msg) this.post(msg)
  }

  private setProjectDirectory(project: string | null): void {
    if (this.project === project) return
    this.generation++
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
    return this.project ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.context.globalStorageUri.fsPath
  }

  private relevanceRoots(): vscode.Uri[] {
    if (!this.project) return vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []
    const folder = vscode.workspace.workspaceFolders?.find((item) => item.uri.fsPath === this.project)
    return [folder?.uri ?? vscode.Uri.file(this.project)]
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
      motionBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "loading-motion")),
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

function authApiKey(auth: unknown): string | undefined {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return undefined
  const record = auth as Record<string, unknown>
  if (record.type !== "api") return undefined
  const key = typeof record.key === "string" ? record.key.trim() : ""
  return key || undefined
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
