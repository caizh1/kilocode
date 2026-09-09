import * as vscode from "vscode"
import { ChipMateProvider } from "./ChipMateProvider"
import { resolvePanelProjectDirectory } from "./project-directory"
import type { ChipMateConnectionService } from "./services/cli-backend"
import type { RemoteStatusService } from "./services/RemoteStatusService"
import { SettingsPanelReturnState, type SettingsReturnTarget } from "./settings-panel-return"

type PanelView = "settings" | "profile" | "indexing"

const PANEL_TITLES: Record<PanelView, string> = {
  settings: "ChipMate Settings",
  profile: "ChipMate Profile",
  indexing: "Codebase Indexing",
}

/**
 * Opens Settings or Profile as an editor-area WebviewPanel,
 * keeping the sidebar chat undisturbed.
 *
 * Each view type is a singleton panel — calling openPanel() again
 * reveals the existing panel instead of creating a duplicate.
 *
 * Uses a full ChipMateProvider under the hood so each panel has
 * the same backend connectivity (config, providers, profile, auth)
 * as the sidebar.
 */
export class SettingsEditorProvider implements vscode.Disposable {
  private panels = new Map<PanelView, vscode.WebviewPanel>()
  private providers = new Map<PanelView, ChipMateProvider>()
  private tabs = new Map<PanelView, string>()
  private returns = new Map<PanelView, SettingsPanelReturnState>()
  private remoteService: RemoteStatusService | null = null
  private disposing = false

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: ChipMateConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {}

  private getProjectDirectory(): string | null {
    const editor = vscode.window.activeTextEditor
    const active =
      editor?.document.uri.scheme === "file"
        ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
        : undefined
    return resolvePanelProjectDirectory(active, vscode.workspace.workspaceFolders)
  }

  /** Extract the PanelView from a viewType string like "chipmate.v2.settingsPanel". */
  static viewFromType(type: string): PanelView | undefined {
    const match = type.match(/^chipmate\.v2\.(\w+)Panel$/)
    if (!match) return undefined
    const view = match[1] as PanelView
    if (!(view in PANEL_TITLES)) return undefined
    return view
  }

  openPanel(view: PanelView, tab?: string, returnTarget?: SettingsReturnTarget): void {
    if (tab) this.tabs.set(view, tab)
    const returnState = this.returns.get(view) ?? new SettingsPanelReturnState()
    returnState.setTarget(returnTarget)
    this.returns.set(view, returnState)

    const projectDirectory = this.getProjectDirectory()
    const existing = this.panels.get(view)
    if (existing) {
      this.providers.get(view)?.setProjectDirectory(projectDirectory)
      if (tab) {
        const provider = this.providers.get(view)
        provider?.postMessage({ type: "navigate", view, tab })
      }
      existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Active, false)
      this.providers.get(view)?.postMessage({ type: "navigate", view, ...(tab ? { tab } : {}) })
      return
    }

    const panel = vscode.window.createWebviewPanel(
      `chipmate.v2.${view}Panel`,
      PANEL_TITLES[view],
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )

    this.wirePanel(panel, view, projectDirectory)
  }

  /** Re-wire a deserialized panel after extension restart. */
  deserializePanel(panel: vscode.WebviewPanel): void {
    const view = SettingsEditorProvider.viewFromType(panel.viewType)
    if (!view) {
      panel.dispose()
      return
    }
    this.wirePanel(panel, view, this.getProjectDirectory())
  }

  private wirePanel(panel: vscode.WebviewPanel, view: PanelView, projectDirectory: string | null): void {
    const returnState = this.returns.get(view) ?? new SettingsPanelReturnState()
    returnState.setActive(panel.active)
    this.returns.set(view, returnState)
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "chipmate-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "chipmate-dark.svg"),
    }

    // Create a dedicated ChipMateProvider for this panel so it has full
    // backend connectivity (config, providers, agents, profile, auth).
    const provider = new ChipMateProvider(this.extensionUri, this.connectionService, this.context, {
      projectDirectory,
    })
    if (this.remoteService) {
      provider.setRemoteService(this.remoteService)
    }
    provider.resolveWebviewPanel(panel)

    // Close the editor tab when the Settings header close button requests it.
    const closePanelDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "closePanel") {
        returnState.requestClose()
        panel.dispose()
      }
    })

    const viewStateDisposable = panel.onDidChangeViewState((event) => {
      returnState.setActive(event.webviewPanel.active)
    })

    // Navigate to the target view on every webviewReady (including after
    // "Developer: Reload Webviews" which re-creates the JS context).
    const readyDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "webviewReady") {
        // Small delay to let ChipMateProvider's own webviewReady handler finish first
        setTimeout(() => {
          provider.postMessage({ type: "navigate", view, tab: this.tabs.get(view) })
        }, 50)
      }
    })

    // Remember the active settings tab so it survives webview reloads.
    const tabDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "settingsTabChanged" && typeof msg.tab === "string") {
        this.tabs.set(view, msg.tab)
      }
    })

    this.panels.set(view, panel)
    this.providers.set(view, provider)

    const title = PANEL_TITLES[view]
    panel.onDidDispose(() => {
      console.log(`[ChipMate New] ${title} panel disposed`)
      closePanelDisposable.dispose()
      viewStateDisposable.dispose()
      readyDisposable.dispose()
      tabDisposable.dispose()
      provider.dispose()
      this.panels.delete(view)
      this.providers.delete(view)
      this.tabs.delete(view)
      this.returns.delete(view)
      const target = returnState.consume(this.disposing)
      if (target) {
        void Promise.resolve(target.restore()).catch((error) =>
          console.warn(`[ChipMate New] Failed to restore Settings origin ${target.id}:`, error),
        )
      }
    })
  }

  setRemoteService(service: RemoteStatusService): void {
    this.remoteService = service
    // Apply to any existing providers
    for (const [, provider] of this.providers) {
      provider.setRemoteService(service)
    }
  }

  dispose(): void {
    this.disposing = true
    for (const [, panel] of this.panels) {
      panel.dispose()
    }
    this.panels.clear()
    this.providers.clear()
    this.tabs.clear()
    this.returns.clear()
  }
}
