import { bindAppearance } from "../appearance"
import path from "node:path"
import * as vscode from "vscode"
import { buildWebviewHtml } from "../utils"
import { isPatentRadarWebviewMessage, type PatentRadarRun } from "./types"

export interface PatentRadarPanelActions {
  currentWorkspace(): string | undefined
  list(): Promise<PatentRadarRun[]>
  get(runId: string): Promise<PatentRadarRun>
  research(runId: string): Promise<PatentRadarRun>
  export(runId: string): Promise<{ root: string }>
  review(
    runId: string,
    candidateId: string,
    decision: "worthy" | "reject" | "needs-arbitration",
    note: string,
  ): Promise<PatentRadarRun>
}

export class PatentRadarPanel implements vscode.Disposable {
  static readonly viewType = "chipmate.v2.PatentRadarPanel"
  private panel: vscode.WebviewPanel | undefined
  private run: PatentRadarRun | undefined
  private runs: PatentRadarRun[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: PatentRadarPanelActions,
  ) {}

  open(run?: PatentRadarRun) {
    this.run = this.current(run)
    if (this.run) this.runs = [this.run, ...this.runs.filter((item) => item.id !== this.run!.id)]
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      void this.post()
      return
    }
    const panel = vscode.window.createWebviewPanel(PatentRadarPanel.viewType, "Patent Radar", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    })
    this.panel = panel
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "chipmate-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "chipmate-dark.svg"),
    }
    bindAppearance(panel)
    panel.webview.html = buildWebviewHtml(panel.webview, {
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "patent-radar.js")),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "patent-radar.css")),
      iconsBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      motionBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "loading-motion")),
      workerUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Patent Radar",
    })
    const messages = panel.webview.onDidReceiveMessage((value: unknown) => void this.message(value))
    const closed = panel.onDidDispose(() => {
      messages.dispose()
      closed.dispose()
      this.panel = undefined
    })
  }

  clear() {
    this.run = undefined
    void this.post()
  }

  dispose() {
    this.panel?.dispose()
    this.panel = undefined
  }

  private async message(value: unknown) {
    if (!isPatentRadarWebviewMessage(value)) return
    if (value.type === "patentRadar.ready") {
      try {
        this.runs = await this.actions.list()
        const selected = this.run ?? this.runs[0]
        if (selected) this.run = this.current(await this.actions.get(selected.id))
        await this.post()
      } catch (error) {
        void vscode.window.showErrorMessage(`Patent Radar：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    await this.busy(true)
    try {
      if (value.type === "patentRadar.selectRun") this.run = this.current(await this.actions.get(value.runId))
      if (value.type === "patentRadar.research") this.run = this.current(await this.actions.research(value.runId))
      if (value.type === "patentRadar.review") {
        this.run = this.current(await this.actions.review(value.runId, value.candidateId, value.decision, value.note))
      }
      if (value.type === "patentRadar.export") {
        const exported = await this.actions.export(value.runId)
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(exported.root))
      }
      this.runs = await this.actions.list()
      await this.post()
    } catch (error) {
      void vscode.window.showErrorMessage(`Patent Radar：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await this.busy(false)
    }
  }

  private post() {
    return this.panel?.webview.postMessage({ type: "patentRadar.state", run: this.run, runs: this.runs }) ?? Promise.resolve(false)
  }

  private busy(value: boolean) {
    return this.panel?.webview.postMessage({ type: "patentRadar.busy", value }) ?? Promise.resolve(false)
  }

  private current(run?: PatentRadarRun) {
    const workspace = this.actions.currentWorkspace()
    if (!run || !workspace || path.resolve(run.workspace) !== path.resolve(workspace)) return undefined
    return run
  }
}
