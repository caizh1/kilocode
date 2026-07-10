import * as os from "os"
import * as path from "path"
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
import { isListedUploadableSkill, normalizeSkillKey } from "./services/marketplace/skills"
import { buildMarketplaceBuiltinSkillUploadPayload, buildMarketplaceSkillUploadPayload } from "./services/marketplace/upload"
import {
  fetchMarketplaceData,
  installMarketplaceItem,
  removeMarketplaceItem,
  type MarketplaceActionContext,
} from "./services/marketplace/actions"
import type {
  InstallMarketplaceItemOptions,
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
  private statuses = new Map<string, SessionStatus["type"]>()
  private disposables: vscode.Disposable[] = []
  private subscriptions: Array<() => void> = []
  private readonly marketplace = new MarketplaceService()
  private uploadableSkillIds = new Set<string>()
  private marketplaceUser: MarketplaceUser | undefined
  private readonly extensionVersion =
    vscode.extensions.getExtension("chipmate.chipmate")?.packageJSON?.version ?? "unknown"

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {}

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

  dispose(): void {
    this.panel?.dispose()
    this.cleanup()
    this.marketplace.dispose()
  }

  private attach(panel: vscode.WebviewPanel, project: string | null): void {
    this.cleanup()
    this.panel = panel
    this.project = project
    this.ready = false
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
    switch (msg.type) {
      case "webviewReady":
        this.ready = true
        if (this.connection.getConnectionState() === "connected") await this.sync(true)
        else await this.connect()
        await this.refreshMarketplaceUser()
        await this.fetchData()
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
      case "uploadMarketplaceSkill":
        console.info("[Kilo New] Marketplace upload skill requested.")
        if (msg.mpSkillId) await this.uploadMarketplaceSkill(msg.mpSkillId)
        return
      case "starMarketplaceSkill":
        console.info("[Kilo New] Marketplace star skill requested.")
        if (msg.mpSkillId) await this.starMarketplaceSkill(msg.mpSkillId)
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

  private async fetchData(): Promise<void> {
    try {
      const project = this.project ?? undefined
      const data = await fetchMarketplaceData(this.marketplaceCtx, project, this.directory())
      this.uploadableSkillIds = new Set(
        data.marketplaceItems
          .filter((item): item is SkillMarketplaceItem => item.type === "skill" && Boolean(item.localOnly && item.uploadable))
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
          await this.marketplace.uploadSkill(payload, apiKey)
          vscode.window.showInformationMessage(`Skill 上传成功：${payload.name}`)
          await this.fetchData()
        } catch (err) {
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
          await this.fetchData()
        } catch (err) {
          vscode.window.showErrorMessage(`Skill 点赞失败：${marketplaceIdentityErrorMessage(err)}`)
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
    this.post({ type: "marketplaceRemoveResult", ...result })
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
  if (/aborted|aborterror|operation was aborted/i.test(message)) return "获取技能市场失败：连接 ChipMate Server 超时或被中止"
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
