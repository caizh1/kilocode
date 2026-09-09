import { initializeDiagnostics } from "./services/diagnostics/record"
import { initializeDiagnosticService } from "./services/diagnostics/service"
import { disposeAppearance } from "./appearance"
import { openAppearanceSidebar } from "./appearance-navigation"
import { registerTurnChangesEdits } from "./chipmate-provider/turn-changes"
import * as vscode from "vscode"
import { randomUUID } from "node:crypto"
import { ChipMateProvider } from "./ChipMateProvider"
import { AgentManagerProvider } from "./agent-manager/AgentManagerProvider"
import { VscodeHost } from "./agent-manager/vscode-host"
import { ChipMateClawProvider } from "./chipmateclaw/ChipMateClawProvider"
import { DiffViewerProvider } from "./diff/DiffViewerProvider"
import { DiffSourceCatalog } from "./diff/sources/catalog"
import { DiffVirtualProvider } from "./DiffVirtualProvider"
import { SettingsEditorProvider } from "./SettingsEditorProvider"
import { restoreMainEditorAfterSettings, type SettingsReturnTarget } from "./settings-panel-return"
import { MarketplacePanelProvider } from "./MarketplacePanelProvider"
import { DesignDocPanelProvider } from "./design-doc/DesignDocPanelProvider"
import { MarketplaceNotifier } from "./services/marketplace/notifier"
import { SubAgentViewerProvider } from "./SubAgentViewerProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { ChipMateConnectionService } from "./services/cli-backend"
import { registerAutocompleteProvider } from "./services/autocomplete"
import { ensureBackendForAutocomplete } from "./services/autocomplete/ensure-backend"
import { AutocompleteServiceManager } from "./services/autocomplete/AutocompleteServiceManager"
import { AttentionService } from "./services/attention"
import { BrowserAutomationService } from "./services/browser-automation"
import { TelemetryEventName, TelemetryProxy } from "./services/telemetry"
import { registerCommitMessageService } from "./services/commit-message"
import { registerCodeActions, registerTerminalActions, ChipMateActionProvider } from "./services/code-actions"
import { registerHighConfidenceCodeComments } from "./services/code-comments"
import { registerToggleAutoApprove } from "./commands/toggle-auto-approve"
import { registerHeapSnapshot } from "./commands/heap-snapshot"
import { registerMemoryDebug } from "./commands/memory-debug"
import { RemoteStatusService } from "./services/RemoteStatusService"
import { markWorkspace } from "./util/spotlight"
import { createUpdateLog, registerUpdateCheck } from "./services/update-check"
import {
  confirmPendingUpdateActivation,
} from "./services/update-check/activation"
import { registerDocumentArtifactCommands } from "./services/document-artifacts"
import { createNotebookBridge } from "./services/notebook"
import { createSkillMarketBridge } from "./services/skill-market"
import { registerCoexistence } from "./chipmate/coexistence"
import { isolate } from "./chipmate/storage"
import { INTERNAL_OFFLINE_CONTEXT, isInternalOfflineBuild } from "./shared/internal-offline"
import { migrateLegacyProductState } from "./migration/legacy-product-state"
import { disposeDeepSeekHarnessService, getDeepSeekHarnessService } from "./services/deepseek-harness/service"
import { registerChatHistoryMigration } from "./commands/chat-history-migration"
import { SessionSurfaceCoordinator } from "./services/session-surface/coordinator"
import { SessionForkCoordinator } from "./services/session-fork/coordinator"
import {
  sameSessionSurfaceKey,
  sessionSurfaceKey,
  type MainEditorPanelStateV1,
  type SessionSurfaceKey,
} from "./shared/session-surface"
import { registerPatentRadar } from "./patent-radar/register"

let agentManager: AgentManagerProvider | undefined
let shuttingDown = false

const RESTORE_KEY = "chipmate.v2.workbench.restore"
const UPDATE_LOG = "View Update Log"

type RestoreState = {
  agentManager?: boolean
}

const panelTitleHandler =
  (panel: vscode.WebviewPanel, prefix = "") =>
  (title: string) => {
    panel.title = title ? `${prefix}${title}` : EXTENSION_DISPLAY_NAME
  }

// Activated via "onStartupFinished" (package.json) so that commands, code actions, keybindings,
// autocomplete, commit-message generation, and URI deep links all work immediately — without
// requiring the user to open a ChipMate sidebar or panel first. The CLI backend normally starts lazily;
// configured autocomplete may prewarm the shared connection so ghost text works before a webview opens.
// Activated via "onStartupFinished" and "onUri" (package.json) so that commands, code actions,
// keybindings, autocomplete, commit-message generation, and URI deep links all work immediately —
// without requiring the user to open a ChipMate sidebar or panel first. The CLI backend is NOT spawned here;
// it starts lazily when a webview connects or when ensureBackendForAutocomplete() triggers it.
export async function activate(source: vscode.ExtensionContext) {
  const context = isolate(source)
  initializeDiagnostics(context)
  context.subscriptions.push({ dispose: disposeAppearance })
  const updateLog = createUpdateLog()
  context.subscriptions.push({ dispose: () => updateLog.dispose?.() })
  await migrateLegacyProductState(context)
  void confirmPendingUpdateActivation(context)
    .then(async (result) => {
      if (result.status === "none") return
      if (result.status === "invalid") {
        updateLog.warn("[ChipMate New] 已清除无效的更新激活收据。")
        return
      }
      if (result.status === "host-active") {
        updateLog.log(
          `[ChipMate New] 更新首次重载已激活：${result.record.extensionId} ${result.record.expectedVersion} ${result.record.target}。`,
        )
        return
      }
      if (result.status === "superseded") {
        updateLog.log(`[ChipMate New] 旧更新事务已被新版替代：目标 ${result.pending.expectedVersion}，当前 ${result.actual.version}。`)
        return
      }
      if (!result.pending.reloadRequestedAt) {
        updateLog.log(
          `[ChipMate New] 更新已安装但尚未请求重载：${result.pending.expectedVersion}/${result.pending.target}。`,
        )
        return
      }
      updateLog.warn(
        `[ChipMate New] 更新首次重载未切换目标版本：期望 ${result.pending.expectedVersion}/${result.pending.target}，实际 ${result.actual.version}/${result.actual.target ?? "unknown"}。`,
      )
      const choice = await vscode.window.showWarningMessage(
        `ChipMate 更新尚未在当前窗口激活：期望 ${result.pending.expectedVersion}/${result.pending.target}，实际 ${result.actual.version || "未知版本"}/${result.actual.target ?? "未知平台"}。请查看更新日志，确认当前配置文件的安装结果。`,
        UPDATE_LOG,
      )
      if (choice === UPDATE_LOG) updateLog.show?.()
    })
    .catch((err) =>
      updateLog.warn(`[ChipMate New] 更新激活收据确认失败：${err instanceof Error ? err.message : String(err)}`),
    )
  const internal = isInternalOfflineBuild()
  void vscode.commands.executeCommand("setContext", INTERNAL_OFFLINE_CONTEXT, internal)
  console.log("ChipMate extension is now active")
  shuttingDown = false

  const coexistence = registerCoexistence()
  context.subscriptions.push(coexistence)

  const telemetry = TelemetryProxy.getInstance()

  // Create shared connection service (one server for all webviews)
  const connectionService = new ChipMateConnectionService(context)
  initializeDiagnosticService(context, connectionService)
  context.subscriptions.push(registerTurnChangesEdits(connectionService))
  const sessionSurfaces = new SessionSurfaceCoordinator(context)
  const sessionForks = new SessionForkCoordinator(context, connectionService)
  context.subscriptions.push(sessionSurfaces, sessionForks)
  const notebookBridge = createNotebookBridge(connectionService)
  const skillMarketBridge = createSkillMarketBridge(connectionService, context)
  let restore = context.workspaceState.get<RestoreState>(RESTORE_KEY) ?? {}
  const remember = (patch: RestoreState) => {
    const next = { ...restore, ...patch }
    if (shuttingDown && patch.agentManager === false) next.agentManager = restore.agentManager
    restore = next
    void context.workspaceState.update(RESTORE_KEY, restore)
  }

  // Create browser automation service (manages Playwright MCP registration)
  const browserAutomationService = new BrowserAutomationService(connectionService)
  browserAutomationService.syncWithSettings()

  // Create remote status service (one status bar item for all webviews)
  const remoteService = new RemoteStatusService()
  context.subscriptions.push(remoteService)
  connectionService.setRemoteService(remoteService)

  // Re-register browser automation MCP server on CLI backend reconnect, configure telemetry,
  // and set remote service client.
  const unsubscribeStateChange = connectionService.onStateChange((state) => {
    if (state === "connected") {
      void sessionForks.recover()
      browserAutomationService.reregisterIfEnabled()
      const config = connectionService.getServerConfig()
      if (config) {
        telemetry.configure(config.baseUrl, config.password)
        // Sync the CLI's PostHog client with the current consent state. The
        // CLI reads CHIPMATE_TELEMETRY_LEVEL once at spawn, so without this call
        // a fresh CLI started while VS Code telemetry was off would stay
        // opted out for the rest of the session.
        telemetry.setEnabled(vscode.env.isTelemetryEnabled)
      }
      try {
        remoteService.setClient(connectionService.getClient())
        console.log("[ChipMate New] CLI connected, calling remoteService.refresh()")
        remoteService.refresh().catch((err) => console.warn("[ChipMate New] initial remote refresh failed:", err))
      } catch {
        remoteService.setClient(null)
      }
    } else {
      remoteService.clearState()
      remoteService.setClient(null)
    }
  })

  // Propagate runtime telemetry consent changes to the CLI subprocess so its
  // PostHog client stays in sync with the user's VS Code telemetry setting.
  context.subscriptions.push(
    vscode.env.onDidChangeTelemetryEnabled((enabled) => {
      telemetry.setEnabled(enabled)
    }),
  )

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    void markWorkspace(folder.uri.fsPath, (msg) => console.warn(`[ChipMate New] ${msg}`))
  }

  // Track all open tab panel providers so toolbar button commands can target them.
  // NOTE: The editor/title toolbar for tab panels intentionally omits Agent Manager
  // and Marketplace buttons (unlike the sidebar). Too many icons causes VS Code to
  // collapse them into a "..." overflow menu, hiding important buttons like Settings.
  const tabPanels = new Map<vscode.WebviewPanel, ChipMateProvider>()
  const activeTabProvider = () => {
    for (const [panel, p] of tabPanels) {
      if (panel.active) return p
    }
    return undefined
  }

  // Create the provider with shared service
  const provider = new ChipMateProvider(context.extensionUri, connectionService, context, {
    surface: {
      id: "sidebar",
      kind: "sidebar",
      coordinator: sessionSurfaces,
    },
    sessionForks,
    forkOwnerID: "sidebar",
  })
  provider.setRemoteService(remoteService)

  // Register the webview view provider for the sidebar.
  // retainContextWhenHidden keeps the webview alive when switching to other sidebar panels.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChipMateProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  // Ensure Agent Manager navigation keybindings work when a VS Code terminal has focus.
  // The terminal intercepts all keystrokes unless the command is listed in
  // terminal.integrated.commandsToSkipShell, which only contains built-in
  // commands by default.
  const skip = ["chipmate.v2.agentManagerOpen", "chipmate.v2.agentManager.showTerminal"]
  if (process.platform === "darwin") skip.push("chipmate.v2.agentManager.runScript")
  ensureCommandsSkipShell(skip)

  // Create ChipMateClaw chat provider for editor panel
  const chipmateClawProvider = new ChipMateClawProvider(context.extensionUri, connectionService)
  context.subscriptions.push(chipmateClawProvider)

  const designDocProvider = new DesignDocPanelProvider(context.extensionUri, connectionService)
  context.subscriptions.push(designDocProvider)

  // Create Agent Manager provider for editor panel
  const agentManagerHost = new VscodeHost(
    context.extensionUri,
    connectionService,
    context,
    remoteService,
    sessionForks,
  )
  const agentManagerProvider = new AgentManagerProvider(agentManagerHost, connectionService, sessionForks)
  agentManagerProvider.onPanelVisibilityChange((visible) => remember({ agentManager: visible }))
  agentManager = agentManagerProvider
  context.subscriptions.push(agentManagerProvider)

  // Wire "Continue in Worktree" from sidebar → Agent Manager
  provider.setContinueInWorktreeHandler((sessionId, progress) =>
    agentManagerProvider.continueFromSidebar(sessionId, progress),
  )
  provider.setCreateWorktreeHandler((baseBranch, branchName) =>
    agentManagerProvider.createFromSidebar(baseBranch, branchName),
  )

  // Register toggle auto-approve shortcut (Ctrl+Alt+A / Cmd+Alt+A)
  const defaultDir = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
  const autoApprove = registerToggleAutoApprove(
    context,
    connectionService,
    (sessionId) => {
      if (sessionId) {
        const dir =
          provider.getSessionDirectories().get(sessionId) ?? agentManagerProvider.getSessionDirectories().get(sessionId)
        if (dir) return dir
      }
      return defaultDir()
    },
    () => {
      const dirs = new Set([defaultDir()])
      for (const dir of provider.getSessionDirectories().values()) dirs.add(dir)
      for (const dir of agentManagerProvider.getSessionDirectories().values()) dirs.add(dir)
      return [...dirs]
    },
  )
  const attention = new AttentionService(connectionService, {
    approve: (event, directory) => autoApprove.approve(event, directory),
  })

  // Prewarm only after all global event consumers are ready.
  if (coexistence.autocomplete()) ensureBackendForAutocomplete(connectionService)
  context.subscriptions.push(
    coexistence.onDidChangeAutocomplete((enabled) => {
      if (enabled) ensureBackendForAutocomplete(connectionService)
    }),
  )

  provider.setAutoApproveController(autoApprove)
  agentManagerHost.setAutoApproveController(autoApprove)

  // Register serializer so Agent Manager restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(AgentManagerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        if (restore.agentManager === false) {
          panel.dispose()
          return Promise.resolve()
        }
        const ctx = agentManagerHost.wrapExistingPanel(panel, {
          onBeforeMessage: (msg) => agentManagerProvider.handleMessage(msg),
          worktreeDirectories: () => agentManagerProvider.getWorktreeDirectories(),
        })
        agentManagerProvider.deserializePanel(ctx)
        return Promise.resolve()
      },
    }),
  )

  // Register serializer so ChipMateClaw panel restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(ChipMateClawProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        if (internal) {
          panel.dispose()
          return Promise.resolve()
        }
        chipmateClawProvider.restorePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DesignDocPanelProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        designDocProvider.restorePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  const diffSourceCatalog = new DiffSourceCatalog(connectionService)
  context.subscriptions.push(diffSourceCatalog)
  const diffViewerProvider = new DiffViewerProvider(context.extensionUri, connectionService, diffSourceCatalog, {
    sessionIdProvider: () => provider.getCurrentSessionId(),
  })
  diffViewerProvider.setCommentHandler((comments, autoSend) => {
    void provider.appendReviewComments(comments, autoSend)
  })
  context.subscriptions.push(diffViewerProvider)

  // Create diff virtual provider (lightweight single-file diff for permission approval)
  const diffVirtualProvider = new DiffVirtualProvider(context.extensionUri)
  provider.setDiffVirtualProvider(diffVirtualProvider)
  agentManagerHost.setDiffVirtualProvider(diffVirtualProvider)
  context.subscriptions.push(diffVirtualProvider)

  // Register after all dependencies exist so serializer restoration cannot observe
  // a partially initialized extension host.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("chipmate.v2.TabPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
        const saved = resolveMainEditorPanelState(state)
        return attachMainEditorPanel({
          panel,
          key: saved.key,
          saved,
          context,
          connectionService,
          agentManagerProvider,
          tabPanels,
          diffVirtualProvider,
          remoteService,
          autoApprove,
          sessionSurfaces,
          sessionForks,
          sourceProvider: provider,
          restored: true,
        })
      },
    }),
  )

  const openMainEditor = (key: SessionSurfaceKey) =>
    openChipMateInMainEditor({
      key,
      context,
      connectionService,
      agentManagerProvider,
      tabPanels,
      diffVirtualProvider,
      remoteService,
      autoApprove,
      sessionSurfaces,
      sessionForks,
      sourceProvider: provider,
    })
  const returnToSidebar = (key: SessionSurfaceKey) =>
    returnChipMateToSidebar({ key, provider, sessionSurfaces, tabPanels })
  sessionSurfaces.setHandlers({
    openMain: openMainEditor,
    returnToSidebar,
    focusOwner: async (key, ownerSurfaceId) => {
      const panel = sessionSurfaces.panel(key)
      if (ownerSurfaceId !== "sidebar" && panel) {
        panel.reveal(panel.viewColumn, false)
        return
      }
      await vscode.commands.executeCommand("chipmate.v2.SidebarProvider.focus")
      provider.postMessage({ type: "sessionSurface.select", key })
    },
  })

  // Create standalone editor providers (open in editor area, not sidebar)
  const settingsEditorProvider = new SettingsEditorProvider(context.extensionUri, connectionService, context)
  settingsEditorProvider.setRemoteService(remoteService)
  const marketplacePanelProvider = new MarketplacePanelProvider(context.extensionUri, connectionService, context)
  context.subscriptions.push(settingsEditorProvider, marketplacePanelProvider)

  const settingsReturnTarget = (): SettingsReturnTarget | undefined => {
    const sidebar = sessionSurfaces.stateForSurface("sidebar")
    const ownerSurfaceId = sidebar?.ownerSurfaceId
    if (!sidebar || !ownerSurfaceId || ownerSurfaceId === "sidebar") return
    for (const [panel, tabProvider] of tabPanels) {
      if (tabProvider.getSurfaceId() !== ownerSurfaceId) continue
      const key = tabProvider.getPinnedSurfaceKey()
      if (!key || !sameSessionSurfaceKey(key, sidebar.key)) return
      return {
        id: `${ownerSurfaceId}:${sessionSurfaceKey(key)}`,
        restore: () =>
          restoreMainEditorAfterSettings({
            panel,
            provider: tabProvider,
            key,
            ownerSurfaceId,
            tabPanels,
            sessionSurfaces,
          }),
      }
    }
  }

  // Surface a discardable notification when a marketplace item matches the workspace.
  const marketplaceNotifier = new MarketplaceNotifier(connectionService, context, (item) =>
    marketplacePanelProvider.openInstall(item),
  )
  context.subscriptions.push(marketplaceNotifier)
  marketplaceNotifier.start()

  // Create sub-agent viewer provider (read-only editor panel for sub-agent sessions)
  const subAgentViewerProvider = new SubAgentViewerProvider(context.extensionUri, connectionService, context)
  context.subscriptions.push(subAgentViewerProvider)

  // Register serializers so standalone panels restore on restart
  const settingsViews = ["settingsPanel", "profilePanel"] as const
  for (const suffix of settingsViews) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(`chipmate.v2.${suffix}`, {
        deserializeWebviewPanel(panel: vscode.WebviewPanel) {
          if (internal && suffix === "profilePanel") {
            panel.dispose()
            return Promise.resolve()
          }
          settingsEditorProvider.deserializePanel(panel)
          return Promise.resolve()
        },
      }),
    )
  }

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(MarketplacePanelProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        marketplacePanelProvider.deserializePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DiffViewerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        diffViewerProvider.deserializePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("chipmate.v2.SubAgentViewerPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        // Sub-agent viewer requires a session ID that can't be recovered
        // after restart, so dispose the stale panel cleanly.
        panel.dispose()
        return Promise.resolve()
      },
    }),
  )

  // Sidebar menus use wrapper commands so this event measures real title button presses,
  // not programmatic opens, shortcuts, or editor title commands.
  const track = (button: string, command: string) => {
    TelemetryProxy.capture(TelemetryEventName.TITLE_BUTTON_CLICKED, {
      button,
      surface: "sidebar_title",
    })
    void vscode.commands.executeCommand(command)
  }

  // Register toolbar button command handlers
  context.subscriptions.push(
    vscode.commands.registerCommand("chipmate.v2.sidebarTitle.plusButtonClicked", () => {
      track("new_task", "chipmate.v2.plusButtonClicked")
    }),
    vscode.commands.registerCommand("chipmate.v2.sidebarTitle.historyButtonClicked", () => {
      track("history", "chipmate.v2.historyButtonClicked")
    }),
    vscode.commands.registerCommand("chipmate.v2.sidebarTitle.agentManagerOpen", () => {
      track("agent_manager", "chipmate.v2.agentManagerOpen")
    }),
    vscode.commands.registerCommand("chipmate.v2.sidebarTitle.chipmateClawOpen", () => {
      track("chipmateclaw", "chipmate.v2.chipmateClawOpen")
    }),
    vscode.commands.registerCommand("chipmate.v2.sidebarTitle.marketplaceButtonClicked", () => {
      track("marketplace", "chipmate.v2.marketplaceButtonClicked")
    }),
    vscode.commands.registerCommand("chipmate.v2.sidebarTitle.profileButtonClicked", () => {
      track("profile", "chipmate.v2.profileButtonClicked")
    }),
    vscode.commands.registerCommand("chipmate.v2.sidebarTitle.settingsButtonClicked", () => {
      track("settings", "chipmate.v2.settingsButtonClicked")
    }),
    vscode.commands.registerCommand("chipmate.v2.appearance.new", async (view?: string) => {
      if (view === "chipmate.v2.AgentManagerPanel") {
        await vscode.commands.executeCommand("chipmate.v2.agentManager.newTab")
        return
      }
      const tab = activeTabProvider()
      if (tab) {
        tab.postMessage({ type: "action", action: "plusButtonClicked" })
        return
      }
      await openAppearanceSidebar(provider, "plusButtonClicked")
    }),
    vscode.commands.registerCommand("chipmate.v2.appearance.history", async () => {
      const tab = activeTabProvider()
      if (tab) {
        tab.postMessage({ type: "action", action: "historyButtonClicked" })
        return
      }
      await openAppearanceSidebar(provider, "historyButtonClicked")
    }),
    vscode.commands.registerCommand("chipmate.v2.plusButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "plusButtonClicked" })
      else provider.postMessage({ type: "action", action: "plusButtonClicked" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManagerOpen", () => {
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("chipmate.v2.designDocOpen", () => {
      designDocProvider.openPanel()
    }),
    vscode.commands.registerCommand("chipmate.v2.marketplaceButtonClicked", (directory?: string | null) => {
      marketplacePanelProvider.openPanel(directory)
    }),
    vscode.commands.registerCommand("chipmate.v2.chipmateClawOpen", () => {
      if (internal) return
      chipmateClawProvider.openPanel()
    }),
    vscode.commands.registerCommand("chipmate.v2.historyButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "historyButtonClicked" })
      else provider.postMessage({ type: "action", action: "historyButtonClicked" })
    }),
    vscode.commands.registerCommand("chipmate.v2.cycleAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cycleAgentMode" })
      else provider.postMessage({ type: "action", action: "cycleAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cycleAgentMode" })
    }),
    vscode.commands.registerCommand("chipmate.v2.cyclePreviousAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      else provider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
    }),
    vscode.commands.registerCommand("chipmate.v2.profileButtonClicked", () => {
      if (internal) {
        settingsEditorProvider.openPanel("settings", "providers", settingsReturnTarget())
        return
      }
      settingsEditorProvider.openPanel("profile")
    }),
    vscode.commands.registerCommand("chipmate.v2.settingsButtonClicked", (tab?: string) => {
      settingsEditorProvider.openPanel("settings", tab, settingsReturnTarget())
    }),
    vscode.commands.registerCommand("chipmate.v2.openIndexingSettings", () => {
      settingsEditorProvider.openPanel("settings", "indexing", settingsReturnTarget())
    }),
    vscode.commands.registerCommand("chipmate.v2.showMemory", async () => {
      if (agentManagerProvider.isActive()) {
        await agentManagerProvider.showMemory()
        return
      }
      const target = activeTabProvider() ?? provider
      if (target === provider) await vscode.commands.executeCommand("chipmate.v2.SidebarProvider.focus")
      await target.waitForReady()
      await target.showMemory()
    }),
    vscode.commands.registerCommand("chipmate.v2.toggleMemory", async () => {
      if (agentManagerProvider.isActive()) {
        await agentManagerProvider.toggleMemory()
        return
      }
      const target = activeTabProvider() ?? provider
      if (target === provider) await vscode.commands.executeCommand("chipmate.v2.SidebarProvider.focus")
      await target.waitForReady()
      await target.toggleMemory()
    }),
    vscode.commands.registerCommand("chipmate.v2.generateTerminalCommand", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Describe the terminal command you want to generate",
        placeHolder: "e.g., find all .ts files modified in the last 24 hours",
      })
      if (!input) return
      await vscode.commands.executeCommand("chipmate.v2.SidebarProvider.focus")
      await provider.waitForReady()
      provider.postMessage({ type: "triggerTask", text: `Generate a terminal command: ${input}` })
    }),
    vscode.commands.registerCommand("chipmate.v2.toggleRemote", () => {
      remoteService.toggle().catch((err) => console.error("[ChipMate New] toggleRemote command failed:", err))
    }),
    vscode.commands.registerCommand("chipmate.v2.openInTab", (arg?: { sessionID?: string; draftID?: string }) => {
      const active = activeTabProvider()?.getPinnedSurfaceKey()
      const key = arg?.sessionID
        ? ({ kind: "session", id: arg.sessionID } as const)
        : arg?.draftID
          ? ({ kind: "draft", id: arg.draftID } as const)
          : (active ??
            sessionSurfaces.keyForSurface("sidebar") ??
            (provider.getCurrentSessionId()
              ? ({ kind: "session", id: provider.getCurrentSessionId()! } as const)
              : ({ kind: "draft", id: `main-pending:${randomUUID()}` } as const)))
      return openMainEditor(key)
    }),
    vscode.commands.registerCommand("chipmate.v2.returnToSidebar", () => {
      const key = activeTabProvider()?.getPinnedSurfaceKey() ?? sessionSurfaces.keyForSurface("sidebar")
      return key ? returnToSidebar(key) : undefined
    }),
    vscode.commands.registerCommand(
      "chipmate.v2.showChanges",
      (arg?: { sessionId?: string; turnId?: string; initialSourceId?: string }) => {
        diffViewerProvider.openFromCommand(arg)
      },
    ),
    vscode.commands.registerCommand("chipmate.v2.openSubAgentViewer", (sessionID: string, title?: string) => {
      subAgentViewerProvider.openPanel(sessionID, title)
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.previousSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionPrevious" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.nextSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionNext" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.previousTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabPrevious" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.nextTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabNext" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.search", () => {
      agentManagerProvider.postMessage({ type: "action", action: "search" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.showTerminal", () => {
      // Route through the webview so it can reach into the active session
      // state and open the VS Code integrated terminal for it.
      agentManagerProvider.postMessage({ type: "action", action: "showTerminal" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.runScript", () => {
      agentManagerProvider.postMessage({ type: "action", action: "runScript" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.toggleDiff", () => {
      agentManagerProvider.postMessage({ type: "action", action: "toggleDiff" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.showShortcuts", () => {
      agentManagerProvider.postMessage({ type: "action", action: "showShortcuts" })
    }),

    vscode.commands.registerCommand("chipmate.v2.agentManager.newTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTab" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.newTerminal", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTerminal" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.closeTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeTab" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.newWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newWorktree" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.quickWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "quickWorktree" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.openWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "openWorktree" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.openPR", () => {
      agentManagerProvider.postMessage({ type: "action", action: "openPR" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.closeWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeWorktree" })
    }),
    vscode.commands.registerCommand("chipmate.v2.agentManager.advancedWorktree", () =>
      agentManagerProvider.openAdvancedWorktree(),
    ),
    ...Array.from({ length: 9 }, (_, i) =>
      vscode.commands.registerCommand(`chipmate.v2.agentManager.jumpTo${i + 1}`, () => {
        agentManagerProvider.postMessage({ type: "action", action: `jumpTo${i + 1}` })
      }),
    ),
  )

  // Register URI handler for session imports and one-time Marketplace install intents.
  // Register URI handler for extension deep links (vscode://chipmate.chipmate/chipmate/...)
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        if (uri.path === "/marketplace/install") {
          await marketplacePanelProvider.handleInstallUri(uri)
          return
        }
        if (uri.path === "/marketplace/repair") {
          await marketplacePanelProvider.handleRepairUri(uri)
          return
        }
        const sessionMatch = uri.path.match(/^\/chipmate\/s\/([a-zA-Z0-9_-]+)$/)
        const sessionId = sessionMatch?.[1]
        if (sessionId) {
          console.log("[ChipMate New] URI handler: opening cloud session:", sessionId)
          await vscode.commands.executeCommand(`${ChipMateProvider.viewType}.focus`)
          provider.openCloudSession(sessionId)
          return
        }

        if (uri.path !== "/chipmate/switch" && uri.path !== "/chipmate/model") return
        const params = new URLSearchParams(uri.query)
        const modelID = params.get("model") || undefined
        const agent = params.get("agent") || undefined
        if (!modelID && !agent) return
        console.log("[ChipMate New] URI handler: applying linked ChipMate selection:", { modelID, agent })
        await vscode.commands.executeCommand(`${ChipMateProvider.viewType}.focus`)
        provider.selectChipMateModel(modelID, agent)
      },
    }),
  )

  // Register the unified builtin and configured-Qwen autocomplete coordinator.
  registerAutocompleteProvider(context, connectionService, coexistence)
  registerMemoryDebug(context)
  registerDocumentArtifactCommands(context)

  // Register commit message generation
  registerCommitMessageService(context, connectionService)

  registerHeapSnapshot(context, connectionService)
  registerChatHistoryMigration(context, connectionService)
  registerPatentRadar(context, connectionService)

  context.subscriptions.push(
    vscode.commands.registerCommand("chipmate.v2.reload", () => {
      provider.reload().catch((e) => console.error("[ChipMate New] reload command failed:", e))
    }),
  )

  // Register code actions (editor context menus, terminal context menus, keyboard shortcuts)
  registerCodeActions(context, provider, agentManagerProvider, activeTabProvider)
  registerHighConfidenceCodeComments(context, connectionService)
  registerTerminalActions(context, provider, agentManagerProvider)

  // Register CodeActionProvider (lightbulb quick fixes)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new ChipMateActionProvider(),
      ChipMateActionProvider.metadata,
    ),
  )

  const updateCheckService = registerUpdateCheck(context, updateLog)
  void updateCheckService.checkOnStartup()

  const deepSeekHarness = getDeepSeekHarnessService(context)
  if (deepSeekHarness.runtimeAvailable()) {
    void deepSeekHarness
      .prefetchRuntime()
      .catch((error) =>
        updateLog.warn(
          `[DeepSeek Harness] 后台运行时预取失败：${error instanceof Error ? error.message : String(error)}`,
        ),
      )
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("chipmate.v2.retryDeepSeekHarnessRuntime", () => deepSeekHarness.retryRuntime()),
  )

  // Dispose services when extension deactivates (kills the server)
  context.subscriptions.push({
    dispose: () => {
      shuttingDown = true
      unsubscribeStateChange()
      attention.dispose()
      browserAutomationService.dispose()
      provider.dispose()
      notebookBridge.dispose()
      skillMarketBridge.dispose()
      connectionService.dispose()
    },
  })

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return {
      __sessionSurfaceTest: {
        connectionService,
        provider,
        sessionSurfaces,
      },
    }
  }
}

export async function deactivate() {
  shuttingDown = true
  await agentManager?.shutdown()
  await disposeDeepSeekHarnessService()
  TelemetryProxy.getInstance().shutdown()
}

type MainEditorDependencies = {
  key: SessionSurfaceKey
  context: vscode.ExtensionContext
  connectionService: ChipMateConnectionService
  agentManagerProvider: AgentManagerProvider
  tabPanels: Map<vscode.WebviewPanel, ChipMateProvider>
  diffVirtualProvider: DiffVirtualProvider
  remoteService: RemoteStatusService
  autoApprove: ReturnType<typeof registerToggleAutoApprove>
  sessionSurfaces: SessionSurfaceCoordinator
  sessionForks: SessionForkCoordinator
  sourceProvider: ChipMateProvider
}

type AttachMainEditorDependencies = MainEditorDependencies & {
  panel: vscode.WebviewPanel
  saved: MainEditorPanelStateV1
  restored: boolean
}

async function openChipMateInMainEditor(input: MainEditorDependencies): Promise<void> {
  const existing = input.sessionSurfaces.panel(input.key)
  if (existing) {
    existing.reveal(existing.viewColumn, false)
    return
  }
  if (!(await flushSessionSurfaceOwner(input.sessionSurfaces, input.key, "无法在主编辑区打开该会话"))) return
  const panel = vscode.window.createWebviewPanel(
    "chipmate.v2.TabPanel",
    EXTENSION_DISPLAY_NAME,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [input.context.extensionUri],
    },
  )
  await attachMainEditorPanel({
    ...input,
    panel,
    saved: input.sessionSurfaces.panelState(input.key),
    restored: false,
  })
}

async function attachMainEditorPanel(input: AttachMainEditorDependencies): Promise<void> {
  const prior = input.sessionSurfaces.panel(input.key)
  if (prior && prior !== input.panel) {
    prior.reveal(prior.viewColumn, false)
    input.panel.dispose()
    return
  }
  if (input.restored) input.sessionSurfaces.prepareRestore(input.key)
  const panel = input.panel
  panel.iconPath = {
    light: vscode.Uri.joinPath(input.context.extensionUri, "assets", "icons", "chipmate-light.svg"),
    dark: vscode.Uri.joinPath(input.context.extensionUri, "assets", "icons", "chipmate-dark.svg"),
  }
  const surfaceId = `main:${randomUUID()}`
  const tabProvider = new ChipMateProvider(input.context.extensionUri, input.connectionService, input.context, {
    tabTitle: panelTitleHandler(panel, "ChipMate · "),
    projectDirectory: input.saved.directory,
    surface: {
      id: surfaceId,
      kind: "main-editor",
      coordinator: input.sessionSurfaces,
      pinnedKey: input.key,
    },
    sessionForks: input.sessionForks,
    forkOwnerID: `main-editor:${sessionSurfaceKey(input.key)}`,
  })
  tabProvider.setRemoteService(input.remoteService)
  tabProvider.setAutoApproveController(input.autoApprove)
  tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
    input.agentManagerProvider.continueFromSidebar(sessionId, progress),
  )
  tabProvider.setCreateWorktreeHandler((baseBranch, branchName) =>
    input.agentManagerProvider.createFromSidebar(baseBranch, branchName),
  )
  tabProvider.setDiffVirtualProvider(input.diffVirtualProvider)
  const registered = input.sessionSurfaces.registerPanel(input.key, panel, surfaceId, {
    directory: input.saved.directory,
    mode: input.saved.mode,
    taskId: input.saved.taskId,
    title: input.saved.title,
  })
  if (!registered) {
    tabProvider.dispose()
    panel.dispose()
    return
  }
  let session: Awaited<ReturnType<ChipMateProvider["getSessionInfo"]>>
  if (input.key.kind === "session") {
    const directory = input.saved.directory ?? input.sourceProvider.getSessionDirectories().get(input.key.id)
    if (directory) tabProvider.setSessionDirectory(input.key.id, directory)
    session = await input.sourceProvider.getSessionInfo(input.key.id)
    if (!session) {
      input.sessionSurfaces.releasePanel(input.key, panel)
      input.sessionSurfaces.claimSidebar(input.key)
      tabProvider.dispose()
      panel.dispose()
      void vscode.window.showErrorMessage("无法在主编辑区打开该会话：会话不存在或当前不可访问。")
      return
    }
    tabProvider.registerSession(session, true)
    panel.title = `ChipMate · ${session.title || "新会话"}`
  }
  tabProvider.resolveWebviewPanel(panel)
  input.tabPanels.set(panel, tabProvider)
  panel.onDidDispose(
    () => {
      input.sessionSurfaces.releasePanelFor(panel)
      input.tabPanels.delete(panel)
      tabProvider.dispose()
    },
    null,
    input.context.subscriptions,
  )
  let key = input.sessionSurfaces.resolveKey(input.key)
  try {
    const draftRevision = await input.sessionSurfaces.loadDraftRevision(key)
    await tabProvider.waitForReady()
    key = input.sessionSurfaces.resolveKey(key)
    await input.sessionSurfaces.waitForSurfaceReady(surfaceId, key, draftRevision)
    if (session) {
      tabProvider.registerSession(session, true)
      await tabProvider.loadMessages(session.id)
    }
    key = input.sessionSurfaces.resolveKey(key)
    input.sessionSurfaces.prepareMain(key)
    await input.sessionSurfaces.flushOwner(key)
    key = input.sessionSurfaces.resolveKey(key)
    const latestDraftRevision = await input.sessionSurfaces.loadDraftRevision(key)
    await input.sessionSurfaces.waitForSurfaceReady(surfaceId, key, latestDraftRevision)
    if (input.saved.mode === "deepseek-harness") await input.sessionSurfaces.detachDshOwner(key)
    const projection =
      input.saved.mode === "deepseek-harness"
        ? input.sessionSurfaces.waitForDshProjection(surfaceId, key)
        : undefined
    const claimed = input.sessionSurfaces.claimMain(key, surfaceId)
    await Promise.all([
      projection,
      input.sessionSurfaces.waitForSurfaceReady(surfaceId, key, latestDraftRevision, claimed.token?.epoch),
    ])
    panel.reveal(panel.viewColumn, false)
  } catch (error) {
    console.error("[ChipMate New] 会话打开主编辑区失败", error)
    if (
      !(await detachDshOwnerSafely(
        input.sessionSurfaces,
        key,
        input.saved.mode === "deepseek-harness" && input.sessionSurfaces.canUseDshTransport(surfaceId),
        "主编辑区打开失败且官方 DSH 客户端未安全释放",
      ))
    )
      return
    const projection =
      input.saved.mode === "deepseek-harness"
        ? input.sessionSurfaces.waitForDshProjection("sidebar", key)
        : undefined
    input.sessionSurfaces.claimSidebar(key)
    await projection?.catch(() => undefined)
    input.sessionSurfaces.releasePanelFor(panel)
    panel.dispose()
    const detail = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(`无法在主编辑区打开该会话：${detail}`)
  }
}

async function returnChipMateToSidebar(input: {
  key: SessionSurfaceKey
  provider: ChipMateProvider
  sessionSurfaces: SessionSurfaceCoordinator
  tabPanels: Map<vscode.WebviewPanel, ChipMateProvider>
}): Promise<void> {
  const panel = input.sessionSurfaces.panel(input.key)
  if (!panel) {
    input.sessionSurfaces.claimSidebar(input.key)
    return
  }
  if (!(await flushSessionSurfaceOwner(input.sessionSurfaces, input.key, "收回侧栏失败，主编辑区仍保持打开")))
    return
  let key = input.sessionSurfaces.resolveKey(input.key)
  input.sessionSurfaces.beginReturn(key)
  try {
    await vscode.commands.executeCommand("chipmate.v2.SidebarProvider.focus")
    await input.provider.waitForReady()
    key = input.sessionSurfaces.resolveKey(key)
    if (key.kind === "session") {
      const session = await input.provider.getSessionInfo(key.id)
      if (!session) throw new Error("会话不存在或当前不可访问")
      input.provider.registerSession(session, true)
      await input.provider.loadMessages(session.id)
    }
    key = input.sessionSurfaces.resolveKey(key)
    input.provider.postMessage({ type: "sessionSurface.select", key })
    input.sessionSurfaces.bindSurface("sidebar", key)
    const draftRevision = await input.sessionSurfaces.loadDraftRevision(key)
    await input.sessionSurfaces.waitForSurfaceReady("sidebar", key, draftRevision)
    const state = input.sessionSurfaces.stateForSurface(input.tabPanels.get(panel)?.getSurfaceId() ?? "")
    if (state?.mode === "deepseek-harness") await input.sessionSurfaces.detachDshOwner(key)
    const projection =
      state?.mode === "deepseek-harness" ? input.sessionSurfaces.waitForDshProjection("sidebar", key) : undefined
    const claimed = input.sessionSurfaces.claimSidebar(key)
    await Promise.all([
      projection,
      input.sessionSurfaces.waitForSurfaceReady("sidebar", key, draftRevision, claimed.token?.epoch),
    ])
    input.sessionSurfaces.releasePanelFor(panel)
    panel.dispose()
  } catch (error) {
    console.error("[ChipMate New] 主编辑区会话收回侧栏失败", error)
    await restoreMainEditorAfterReturnFailure(input, panel, error)
  }
}

async function restoreMainEditorAfterReturnFailure(
  input: {
    key: SessionSurfaceKey
    sessionSurfaces: SessionSurfaceCoordinator
    tabPanels: Map<vscode.WebviewPanel, ChipMateProvider>
  },
  panel: vscode.WebviewPanel,
  error: unknown,
): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error)
  void vscode.window.showErrorMessage(`收回侧栏失败，主编辑区仍保持打开：${detail}`)
  const surfaceId = input.tabPanels.get(panel)?.getSurfaceId()
  if (!surfaceId) return
  const state = input.sessionSurfaces.stateForSurface("sidebar")
  if (
    !(await detachDshOwnerSafely(
      input.sessionSurfaces,
      input.key,
      state?.mode === "deepseek-harness" && !input.sessionSurfaces.canUseDshTransport(surfaceId),
      "收回失败且官方 DSH 客户端未安全释放",
    ))
  )
    return
  const projection =
    state?.mode === "deepseek-harness" ? input.sessionSurfaces.waitForDshProjection(surfaceId, input.key) : undefined
  input.sessionSurfaces.claimMain(input.key, surfaceId)
  await projection?.catch(() => undefined)
}

async function flushSessionSurfaceOwner(
  sessionSurfaces: SessionSurfaceCoordinator,
  key: SessionSurfaceKey,
  errorPrefix: string,
): Promise<boolean> {
  try {
    await sessionSurfaces.flushOwner(key)
    return true
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(`${errorPrefix}：${detail}`)
    return false
  }
}

async function detachDshOwnerSafely(
  sessionSurfaces: SessionSurfaceCoordinator,
  key: SessionSurfaceKey,
  enabled: boolean,
  errorPrefix: string,
): Promise<boolean> {
  if (!enabled) return true
  try {
    await sessionSurfaces.detachDshOwner(key)
    return true
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(`${errorPrefix}：${detail}`)
    return false
  }
}

function resolveMainEditorPanelState(value: unknown): MainEditorPanelStateV1 {
  if (value && typeof value === "object") {
    const state = value as Partial<MainEditorPanelStateV1> & { sidebarActiveSessionTabID?: unknown }
    if (
      state.sessionSurfaceVersion === 1 &&
      state.key?.id &&
      (state.key.kind === "session" || state.key.kind === "draft")
    ) {
      return {
        sessionSurfaceVersion: 1,
        key: state.key,
        directory: typeof state.directory === "string" ? state.directory : undefined,
        mode: state.mode === "deepseek-harness" ? "deepseek-harness" : "qa",
        taskId: typeof state.taskId === "string" ? state.taskId : undefined,
        title: typeof state.title === "string" ? state.title : undefined,
        draftRevision: typeof state.draftRevision === "number" ? state.draftRevision : 0,
      }
    }
    if (typeof state.sidebarActiveSessionTabID === "string") {
      return {
        sessionSurfaceVersion: 1,
        key: { kind: "session", id: state.sidebarActiveSessionTabID },
        mode: "qa",
        draftRevision: 0,
      }
    }
  }
  return {
    sessionSurfaceVersion: 1,
    key: { kind: "draft", id: `main-pending:${randomUUID()}` },
    mode: "qa",
    draftRevision: 0,
  }
}

/**
 * Add extension commands to terminal.integrated.commandsToSkipShell so they
 * work when a VS Code terminal has focus. The setting only ships with built-in
 * commands; extension commands must be added explicitly.
 */
function ensureCommandsSkipShell(commands: string[]): void {
  const config = vscode.workspace.getConfiguration("terminal.integrated")
  const info = config.inspect<string[]>("commandsToSkipShell")
  // Update whichever scope already carries an override so we don't
  // shadow workspace settings or leak workspace values into global.
  const [existing, target] = info?.workspaceFolderValue
    ? [info.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder]
    : info?.workspaceValue
      ? [info.workspaceValue, vscode.ConfigurationTarget.Workspace]
      : [info?.globalValue ?? [], vscode.ConfigurationTarget.Global]
  const missing = commands.filter((cmd) => !existing.includes(cmd))
  if (missing.length === 0) return
  config.update("commandsToSkipShell", [...existing, ...missing], target)
}
