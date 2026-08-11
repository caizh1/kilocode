import path from "path"
import * as vscode from "vscode"
import type { DesignDocArtifactContent } from "@chipmate/sdk/v2/client"
import type { ChipMateConnectionService } from "../services/cli-backend"
import { buildWebviewHtml } from "../utils"
import {
  isDesignDocInMessage,
  type DesignDocInMessage,
  type DesignDocOutMessage,
  type DesignDocPanelState,
} from "./types"

export class DesignDocPanelProvider implements vscode.Disposable {
  static readonly viewType = "chipmate.v2.DesignDocPanel"

  private panel: vscode.WebviewPanel | undefined
  private readonly disposables: vscode.Disposable[] = []
  private generation = 0
  private state: DesignDocPanelState = { jobs: [], modules: [], artifacts: [], loading: false }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: ChipMateConnectionService,
  ) {
    const unsubscribe = connection.onEventFiltered(
      (event) => event.type === "design_doc.job.updated",
      (event, directory) => {
        if (directory && directory !== this.state.workspace) return
        const properties = "properties" in event ? event.properties : undefined
        const jobID = properties && typeof properties === "object" && "jobID" in properties ? properties.jobID : undefined
        void this.refresh(typeof jobID === "string" ? jobID : undefined)
      },
    )
    this.disposables.push({ dispose: unsubscribe })
  }

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }
    this.attach(
      vscode.window.createWebviewPanel(DesignDocPanelProvider.viewType, "源码详细设计", vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      }),
    )
  }

  restorePanel(panel: vscode.WebviewPanel): void {
    if (this.panel) {
      panel.dispose()
      return
    }
    this.attach(panel)
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = undefined
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }

  private attach(panel: vscode.WebviewPanel): void {
    this.panel = panel
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] }
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "chipmate-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "chipmate-dark.svg"),
    }
    panel.webview.html = buildWebviewHtml(panel.webview, {
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "design-doc.js")),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "design-doc.css")),
      iconsBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      motionBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "loading-motion")),
      workerUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "源码详细设计",
      port: this.connection.getServerInfo()?.port,
    })
    const messages = panel.webview.onDidReceiveMessage((value: unknown) => {
      if (isDesignDocInMessage(value)) void this.handle(value)
    })
    const closed = panel.onDidDispose(() => {
      messages.dispose()
      closed.dispose()
      if (this.panel === panel) this.panel = undefined
    })
  }

  private post(message: DesignDocOutMessage): void {
    void this.panel?.webview.postMessage(message)
  }

  private async handle(message: DesignDocInMessage): Promise<void> {
    try {
      switch (message.type) {
        case "designDoc.ready":
        case "designDoc.refresh":
          await this.refresh()
          return
        case "designDoc.chooseTarget":
          await this.chooseTarget()
          return
        case "designDoc.create": {
          const client = await this.connection.getClientAsync(message.workspace)
          const response = await client.designDoc.create({
            directory: message.workspace,
            designDocCreateJobInput: {
              targetPath: message.targetPath,
              artifactTypes: message.artifactTypes,
              documentProfile: message.documentProfile,
              outputFormats: message.outputFormats,
              recursive: message.recursive,
              concurrency: message.concurrency,
              model: message.model,
              maxAttempts: message.maxAttempts,
            },
          })
          const job = requireData(response.data, response.error)
          this.state.workspace = message.workspace
          this.state.targetPath = message.targetPath
          await this.refresh(job.id)
          return
        }
        case "designDoc.selectJob":
          await this.refresh(message.jobID)
          return
        case "designDoc.pause":
          await this.mutate(message.jobID, (client, directory) => client.designDoc.pause({ jobID: message.jobID, directory }))
          return
        case "designDoc.resume":
          await this.mutate(message.jobID, (client, directory) => client.designDoc.resume({ jobID: message.jobID, directory }))
          return
        case "designDoc.cancel":
          await this.mutate(message.jobID, (client, directory) => client.designDoc.cancel({ jobID: message.jobID, directory }))
          return
        case "designDoc.retry":
          await this.mutate(message.jobID, (client, directory) =>
            client.designDoc.retry({
              jobID: message.jobID,
              workItemID: message.workItemID,
              directory,
              designDocRetryWorkItemInput: message.model ? { model: message.model } : {},
            }),
          )
          return
        case "designDoc.openArtifact":
          await this.openArtifact(message.jobID, message.artifactID)
          return
      }
    } catch (error) {
      this.state = { ...this.state, loading: false, error: errorMessage(error) }
      this.post({ type: "designDoc.state", state: this.state })
    }
  }

  private async chooseTarget(): Promise<void> {
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "选择源码模块",
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    })
    const selected = folders?.[0]
    if (!selected) return
    const workspace = vscode.workspace.getWorkspaceFolder(selected)?.uri.fsPath
    if (!workspace) throw new Error("所选目录必须位于当前 VS Code 工作区内")
    const targetPath = path.relative(workspace, selected.fsPath) || "."
    this.state = { ...this.state, workspace, targetPath, error: undefined }
    this.post({ type: "designDoc.state", state: this.state })
  }

  private async refresh(preferredJobID?: string): Promise<void> {
    const generation = ++this.generation
    const workspace = this.state.workspace ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspace) throw new Error("请先打开一个工作区")
    this.state = { ...this.state, workspace, loading: true, error: undefined }
    this.post({ type: "designDoc.state", state: this.state })
    const client = await this.connection.getClientAsync(workspace)
    const listed = await client.designDoc.list({ directory: workspace })
    const jobs = requireData(listed.data, listed.error)
    const selectedJobID = preferredJobID ?? this.state.selectedJobID ?? jobs[0]?.id
    const selectedResponse = selectedJobID
      ? await client.designDoc.get({ jobID: selectedJobID, directory: workspace })
      : undefined
    const selectedJob = selectedResponse ? requireData(selectedResponse.data, selectedResponse.error) : undefined
    const artifactResponse = selectedJobID
      ? await client.designDoc.artifacts({ jobID: selectedJobID, directory: workspace })
      : undefined
    const artifacts = artifactResponse ? requireData(artifactResponse.data, artifactResponse.error) : []
    const manifestArtifact = artifacts.find((artifact) => artifact.kind === "manifest")
    const manifestResponse = manifestArtifact && selectedJobID
      ? await client.designDoc.artifact({ jobID: selectedJobID, artifactID: manifestArtifact.id, directory: workspace })
      : undefined
    const manifest = manifestResponse ? requireData(manifestResponse.data, manifestResponse.error) : undefined
    const modules = manifest ? parseModules(manifest) : []
    if (generation !== this.generation) return
    this.state = {
      ...this.state,
      workspace,
      jobs,
      selectedJobID,
      selectedJob,
      modules,
      artifacts,
      preview: this.state.preview?.artifact.workItemID && selectedJobID === this.state.selectedJobID ? this.state.preview : undefined,
      loading: false,
      error: undefined,
    }
    this.post({ type: "designDoc.state", state: this.state })
  }

  private async mutate(
    jobID: string,
    action: (client: Awaited<ReturnType<ChipMateConnectionService["getClientAsync"]>>, directory: string) => Promise<{ data?: unknown; error?: unknown }>,
  ): Promise<void> {
    const directory = this.state.workspace ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!directory) throw new Error("请先打开一个工作区")
    const client = await this.connection.getClientAsync(directory)
    const response = await action(client, directory)
    requireData(response.data, response.error)
    await this.refresh(jobID)
  }

  private async openArtifact(jobID: string, artifactID: string): Promise<void> {
    const directory = this.state.workspace
    if (!directory) throw new Error("Job 工作区未知")
    const client = await this.connection.getClientAsync(directory)
    const response = await client.designDoc.artifact({ jobID, artifactID, directory })
    const preview = requireData(response.data, response.error) as DesignDocArtifactContent
    if (
      preview.encoding === "base64" &&
      preview.artifact.mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(vscode.Uri.file(directory), "design-doc.docx"),
        filters: { "Word 文档": ["docx"] },
        saveLabel: "导出详细设计 Word",
      })
      if (!target) return
      await vscode.workspace.fs.writeFile(target, Buffer.from(preview.content, "base64"))
      void vscode.env.openExternal(target)
      return
    }
    this.state = { ...this.state, preview, error: undefined }
    this.post({ type: "designDoc.state", state: this.state })
  }
}

function requireData<T>(data: T | undefined, error: unknown): T {
  if (data !== undefined) return data
  throw new Error(errorMessage(error) || "DesignDoc API 未返回数据")
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message
  return String(error ?? "未知错误")
}

function parseModules(value: DesignDocArtifactContent) {
  if (value.encoding !== "utf8") return []
  const parsed = JSON.parse(value.content) as {
    modules?: Array<{ id?: unknown; name?: unknown; path?: unknown; parentID?: unknown }>
  }
  return (parsed.modules ?? []).flatMap((module) => {
    if (typeof module.id !== "string" || typeof module.name !== "string" || typeof module.path !== "string") return []
    return [{ id: module.id, name: module.name, path: module.path, ...(typeof module.parentID === "string" ? { parentID: module.parentID } : {}) }]
  })
}
