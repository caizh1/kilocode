import * as vscode from "vscode"
import { ChipMateProvider } from "./ChipMateProvider"
import { AgentManagerProvider } from "./agent-manager/AgentManagerProvider"
import { VscodeHost } from "./agent-manager/vscode-host"
import { ChipMateClawProvider } from "./chipmateclaw/ChipMateClawProvider"
import { DiffViewerProvider } from "./diff/DiffViewerProvider"
import { DiffSourceCatalog } from "./diff/sources/catalog"
import { DiffVirtualProvider } from "./DiffVirtualProvider"
import { SettingsEditorProvider } from "./SettingsEditorProvider"
import { MarketplacePanelProvider } from "./MarketplacePanelProvider"
import { AgentConsoleProvider } from "./agent-console/AgentConsoleProvider"
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
  markPendingUpdateReloadRequested,
  shouldRetryFirstReload,
} from "./services/update-check/activation"
import { registerDocumentArtifactCommands } from "./services/document-artifacts"
import { registerAgentTerminal } from "./services/agent-terminal"
import { createNotebookBridge } from "./services/notebook"
import { createSkillMarketBridge } from "./services/skill-market"
import { registerCoexistence } from "./chipmate/coexistence"
import { isolate } from "./chipmate/storage"
import { INTERNAL_OFFLINE_CONTEXT, isInternalOfflineBuild } from "./shared/internal-offline"
import { migrateLegacyProductState } from "./migration/legacy-product-state"

let agentManager: AgentManagerProvider | undefined
let shuttingDown = false

const RESTORE_KEY = "chipmate.v2.workbench.restore"
const RELOAD_WINDOW = "Reload Window"

type RestoreState = {
  agentManager?: boolean
}

const panelTitleHandler = (panel: vscode.WebviewPanel) => (title: string) => {
  panel.title = title || EXTENSION_DISPLAY_NAME
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
      if (!result.pending.reloadRequestedAt) {
        updateLog.log(
          `[ChipMate New] 更新已安装但尚未请求重载：${result.pending.expectedVersion}/${result.pending.target}。`,
        )
        return
      }
      updateLog.warn(
        `[ChipMate New] 更新首次重载未切换目标版本：期望 ${result.pending.expectedVersion}/${result.pending.target}，实际 ${result.actual.version}/${result.actual.target ?? "unknown"}。`,
      )
      if (shouldRetryFirstReload(result)) {
        const retry = await markPendingUpdateReloadRequested(context)
        if (!retry) {
          updateLog.warn("[ChipMate New] 更新首次重载回执在自动重试前丢失。")
          return
        }
        updateLog.warn(`[ChipMate New] 目标扩展仍在注册，自动执行一次受限的第二次重载（尝试 ${retry.reloadAttempts}）。`)
        await vscode.commands.executeCommand("workbench.action.reloadWindow")
        return
      }
      const choice = await vscode.window.showWarningMessage(
        `ChipMate ${result.pending.expectedVersion} was installed, but this window is still running ${result.actual.version || "an unknown version"}. Reload Window again to activate the installed version.`,
        RELOAD_WINDOW,
      )
      if (choice === RELOAD_WINDOW) {
        try {
          await markPendingUpdateReloadRequested(context)
        } catch (err) {
          updateLog.warn(`[ChipMate New] 未能记录手动更新重载请求：${err instanceof Error ? err.message : String(err)}`)
        }
        await vscode.commands.executeCommand("workbench.action.reloadWindow")
      }
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
  const provider = new ChipMateProvider(context.extensionUri, connectionService, context)
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
  const agentManagerHost = new VscodeHost(context.extensionUri, connectionService, context, remoteService)
  const agentManagerProvider = new AgentManagerProvider(agentManagerHost, connectionService)
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

  // Register serializer so "Open in Tab" restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("chipmate.v2.TabPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        const tabProvider = new ChipMateProvider(context.extensionUri, connectionService, context, {
          tabTitle: panelTitleHandler(panel),
        })
        tabProvider.setRemoteService(remoteService)
        tabProvider.setAutoApproveController(autoApprove)
        tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
          agentManagerProvider.continueFromSidebar(sessionId, progress),
        )
        tabProvider.setCreateWorktreeHandler((baseBranch, branchName) =>
          agentManagerProvider.createFromSidebar(baseBranch, branchName),
        )
        tabProvider.setDiffVirtualProvider(diffVirtualProvider)
        tabProvider.resolveWebviewPanel(panel)
        tabPanels.set(panel, tabProvider)
        panel.onDidDispose(
          () => {
            console.log("[ChipMate New] Tab panel restored from restart disposed")
            tabPanels.delete(panel)
            tabProvider.dispose()
          },
          null,
          context.subscriptions,
        )
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

  const agentConsoleProvider = new AgentConsoleProvider(
    context.extensionUri,
    connectionService,
    context,
    remoteService,
    diffVirtualProvider,
    autoApprove,
  )
  context.subscriptions.push(agentConsoleProvider)
  registerAgentTerminal(context, () => agentConsoleProvider.openPanel())

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(AgentConsoleProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        agentConsoleProvider.deserializePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  // Create standalone editor providers (open in editor area, not sidebar)
  const settingsEditorProvider = new SettingsEditorProvider(context.extensionUri, connectionService, context)
  settingsEditorProvider.setRemoteService(remoteService)
  const marketplacePanelProvider = new MarketplacePanelProvider(context.extensionUri, connectionService, context)
  context.subscriptions.push(settingsEditorProvider, marketplacePanelProvider)

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
    vscode.commands.registerCommand("chipmate.v2.sidebarTitle.agentTerminalOpen", () => {
      track("agent_console", "chipmate.v2.agentTerminal.open")
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
        settingsEditorProvider.openPanel("settings", "providers")
        return
      }
      settingsEditorProvider.openPanel("profile")
    }),
    vscode.commands.registerCommand("chipmate.v2.settingsButtonClicked", (tab?: string) => {
      settingsEditorProvider.openPanel("settings", tab)
    }),
    vscode.commands.registerCommand("chipmate.v2.openIndexingSettings", () => {
      settingsEditorProvider.openPanel("settings", "indexing")
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
    vscode.commands.registerCommand("chipmate.v2.openInTab", () => {
      return openChipMateInNewTab(
        context,
        connectionService,
        agentManagerProvider,
        tabPanels,
        diffVirtualProvider,
        remoteService,
        autoApprove,
      )
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
}

export async function deactivate() {
  shuttingDown = true
  await agentManager?.shutdown()
  TelemetryProxy.getInstance().shutdown()
}

async function openChipMateInNewTab(
  context: vscode.ExtensionContext,
  connectionService: ChipMateConnectionService,
  agentManagerProvider: AgentManagerProvider,
  tabPanels: Map<vscode.WebviewPanel, ChipMateProvider>,
  diffVirtualProvider: DiffVirtualProvider,
  remoteService: RemoteStatusService,
  autoApprove: ReturnType<typeof registerToggleAutoApprove>,
) {
  const lastCol = Math.max(...vscode.window.visibleTextEditors.map((e) => e.viewColumn || 0), 0)
  const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0

  if (!hasVisibleEditors) {
    await vscode.commands.executeCommand("workbench.action.newGroupRight")
  }

  const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

  const panel = vscode.window.createWebviewPanel("chipmate.v2.TabPanel", EXTENSION_DISPLAY_NAME, targetCol, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [context.extensionUri],
  })

  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "chipmate-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "chipmate-dark.svg"),
  }

  const tabProvider = new ChipMateProvider(context.extensionUri, connectionService, context, {
    tabTitle: panelTitleHandler(panel),
  })
  tabProvider.setRemoteService(remoteService)
  tabProvider.setAutoApproveController(autoApprove)
  tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
    agentManagerProvider.continueFromSidebar(sessionId, progress),
  )
  tabProvider.setCreateWorktreeHandler((baseBranch, branchName) =>
    agentManagerProvider.createFromSidebar(baseBranch, branchName),
  )
  tabProvider.setDiffVirtualProvider(diffVirtualProvider)
  tabProvider.resolveWebviewPanel(panel)
  tabPanels.set(panel, tabProvider)

  // Wait for the new panel to become active before locking the editor group.
  // This avoids the race where VS Code hasn't switched focus yet.
  await waitForWebviewPanelToBeActive(panel)
  await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

  panel.onDidDispose(
    () => {
      console.log("[ChipMate New] Tab panel disposed")
      tabPanels.delete(panel)
      tabProvider.dispose()
    },
    null,
    context.subscriptions,
  )
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

function waitForWebviewPanelToBeActive(panel: vscode.WebviewPanel): Promise<void> {
  if (panel.active) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const disposable = panel.onDidChangeViewState((event) => {
      if (!event.webviewPanel.active) {
        return
      }
      disposable.dispose()
      resolve()
    })
  })
}
