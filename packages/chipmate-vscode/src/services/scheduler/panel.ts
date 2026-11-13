import * as vscode from "vscode"
import { bindAppearance } from "../../appearance"
import { buildWebviewHtml } from "../../utils"
import type { SchedulerMessage, SchedulerViewState } from "../../shared/scheduled-task"

export class SchedulerPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel
  constructor(
    private readonly uri: vscode.Uri,
    private readonly receive: (message: SchedulerMessage) => Promise<void>,
  ) {}
  open() {
    if (this.panel) {
      this.panel.reveal()
      return
    }
    const panel = vscode.window.createWebviewPanel("chipmate.v2.ScheduledTasks", "定时任务", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.uri],
    })
    this.panel = panel
    bindAppearance(panel)
    const asset = (...parts: string[]) => panel.webview.asWebviewUri(vscode.Uri.joinPath(this.uri, ...parts))
    panel.webview.html = buildWebviewHtml(panel.webview, {
      scriptUri: asset("dist", "scheduled-tasks.js"),
      styleUri: asset("dist", "scheduled-tasks.css"),
      iconsBaseUri: asset("assets", "icons"),
      motionBaseUri: asset("assets", "loading-motion"),
      workerUri: asset("dist", "shiki-worker.js"),
      title: "定时任务",
    })
    const messages = panel.webview.onDidReceiveMessage(async (message: SchedulerMessage) => {
      if (!message || typeof message.type !== "string" || !message.type.startsWith("scheduler.")) return
      try {
        await this.receive(message)
      } catch (error) {
        this.error(error)
      }
    })
    panel.onDidDispose(() => {
      messages.dispose()
      this.panel = undefined
    })
  }
  state(value: SchedulerViewState) {
    void this.panel?.webview.postMessage({ type: "scheduler.state", value })
  }
  result(value: unknown) {
    void this.panel?.webview.postMessage({ type: "scheduler.result", value })
  }
  error(error: unknown) {
    void this.panel?.webview.postMessage({
      type: "scheduler.error",
      message: error instanceof Error ? error.message : String(error),
    })
  }
  dispose() {
    this.panel?.dispose()
  }
}
