import * as vscode from "vscode"
import { ChipMateProvider } from "../ChipMateProvider"
import type { DiffVirtualProvider } from "../DiffVirtualProvider"
import type { AutoApproveController } from "../commands/toggle-auto-approve"
import { readTerminalFont, watchTerminalFont } from "../agent-manager/terminal-font"
import type { ChipMateConnectionService } from "../services/cli-backend"
import type { RemoteStatusService } from "../services/RemoteStatusService"
import { getWorkspaceRoot } from "../review-utils"
import { buildWebviewHtml } from "../utils"
import { AgentConsoleTerminal } from "./terminal"
import { isAgentConsoleMessage } from "./types"

export class AgentConsoleProvider implements vscode.Disposable {
  static readonly viewType = "chipmate.v2.AgentConsolePanel"

  private panel: vscode.WebviewPanel | undefined
  private provider: ChipMateProvider | undefined
  private terminal: AgentConsoleTerminal | undefined
  private readonly output = vscode.window.createOutputChannel("ChipMate Agent Console")

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: ChipMateConnectionService,
    private readonly context: vscode.ExtensionContext,
    private readonly remote: RemoteStatusService,
    private readonly diff: DiffVirtualProvider,
    private readonly approve: AutoApproveController,
  ) {}

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }
    const panel = vscode.window.createWebviewPanel(
      AgentConsoleProvider.viewType,
      "Agent Console",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )
    this.attach(panel)
  }

  deserializePanel(panel: vscode.WebviewPanel): void {
    if (this.panel) {
      panel.dispose()
      return
    }
    this.attach(panel)
  }

  dispose(): void {
    this.panel?.dispose()
    this.cleanup()
    this.output.dispose()
  }

  private attach(panel: vscode.WebviewPanel): void {
    this.panel = panel
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "chipmate-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "chipmate-dark.svg"),
    }
    panel.webview.html = buildWebviewHtml(panel.webview, {
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-console.js")),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-console.css")),
      iconsBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      motionBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "loading-motion")),
      workerUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Agent Console",
      port: this.connection.getServerInfo()?.port,
    })

    const terminal = new AgentConsoleTerminal({
      client: () => this.connection.getClient(),
      ready: (root) => this.connection.getClientAsync(root).then(() => undefined),
      config: () => this.connection.getServerConfig() ?? undefined,
      root: getWorkspaceRoot,
      rcfile: () => vscode.Uri.joinPath(this.extensionUri, "assets", "agent-console", "bashrc").fsPath,
      psfile: () => vscode.Uri.joinPath(this.extensionUri, "assets", "agent-console", "powershell.ps1").fsPath,
      font: readTerminalFont,
      post: (message) => void panel.webview.postMessage(message),
      log: (message) => this.output.appendLine(`[Shell] ${message}`),
    })
    this.terminal = terminal

    const provider = new ChipMateProvider(this.extensionUri, this.connection, this.context, {
      platform: "agent-console",
      slimEditMetadata: true,
      disableViewedRegistration: true,
      beforePrompt: async ({ sessionID, directory, agent }) => {
        if (agent !== "agent-console") return
        await terminal.bind(sessionID, directory)
      },
    })
    provider.setRemoteService(this.remote)
    provider.setDiffVirtualProvider(this.diff)
    provider.setAutoApproveController(this.approve)
    provider.attachToWebview(panel.webview)
    provider.setStreamVisibility(panel.active && panel.visible)
    this.provider = provider

    const messages = panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isAgentConsoleMessage(message)) return
      terminal.handle(message)
    })
    const fonts = watchTerminalFont((font) => {
      void panel.webview.postMessage({ type: "agentConsole.terminal.fontChanged", font })
    })
    const streams = panel.onDidChangeViewState((event) => {
      provider.setStreamVisibility(event.webviewPanel.active && event.webviewPanel.visible)
    })
    const closed = panel.onDidDispose(() => {
      messages.dispose()
      fonts()
      streams.dispose()
      closed.dispose()
      this.cleanup()
    })
  }

  private cleanup(): void {
    const provider = this.provider
    const terminal = this.terminal
    this.panel = undefined
    this.provider = undefined
    this.terminal = undefined
    provider?.dispose()
    void terminal?.dispose()
  }
}
