import path from "node:path"
import * as vscode from "vscode"
import type { FunctionTarget } from "./types"

export const CODE_COMMENT_PREVIEW_SCHEME = "chipmate-code-comment-preview"
export const APPLY_CODE_COMMENT_PREVIEW_COMMAND = "chipmate.v2.applyCodeCommentPreview"
export const DISCARD_CODE_COMMENT_PREVIEW_COMMAND = "chipmate.v2.discardCodeCommentPreview"
export const CODE_COMMENT_PREVIEW_PENDING_CONTEXT = "chipmate.v2.codeComments.previewPending"

type PreviewResource = {
  key: string
  value: unknown
}

export interface CodeCommentPreviewHost {
  createResource(id: string, side: "before" | "after", filename: string): PreviewResource
  registerProvider(read: (key: string) => string | undefined): vscode.Disposable
  registerCommand(command: string, run: () => void): vscode.Disposable
  onDidCloseDiff(run: (originalKey: string, modifiedKey: string) => void): vscode.Disposable
  openDiff(original: PreviewResource, modified: PreviewResource, title: string, languageId: string): Promise<void>
  closeDiff(originalKey: string, modifiedKey: string): Promise<void>
  setPendingContext(pending: boolean): Promise<void>
}

type PendingPreview = {
  original: PreviewResource
  modified: PreviewResource
  resolve: (apply: boolean) => void
  settled: boolean
}

export class CodeCommentPreviewController implements vscode.Disposable {
  private readonly contents = new Map<string, string>()
  private readonly disposables: vscode.Disposable[]
  private pending: PendingPreview | undefined
  private sequence = 0

  constructor(
    private readonly host: CodeCommentPreviewHost = new VscodeCodeCommentPreviewHost(),
    private readonly log: (message: string) => void = () => undefined,
  ) {
    this.disposables = [
      host.registerProvider((key) => this.contents.get(key)),
      host.registerCommand(APPLY_CODE_COMMENT_PREVIEW_COMMAND, () => this.settle(true)),
      host.registerCommand(DISCARD_CODE_COMMENT_PREVIEW_COMMAND, () => this.settle(false)),
      host.onDidCloseDiff((original, modified) => {
        if (this.matchesPending(original, modified)) this.settle(false, false)
      }),
    ]
    void host.setPendingContext(false).catch((error) => this.logFailure("初始化预览状态", error))
  }

  async confirm(target: FunctionTarget, candidate: string, functions: number): Promise<boolean> {
    if (this.pending) await this.finish(this.pending, false, true)

    const id = `${Date.now().toString(36)}-${++this.sequence}`
    const filename = path.basename(target.filePath)
    const original = this.host.createResource(id, "before", filename)
    const modified = this.host.createResource(id, "after", filename)
    this.contents.set(original.key, target.documentText)
    this.contents.set(modified.key, candidate)

    const result = new Promise<boolean>((resolve) => {
      this.pending = { original, modified, resolve, settled: false }
    })

    try {
      await this.host.setPendingContext(true)
      await this.host.openDiff(
        original,
        modified,
        `${filename} · ${functions} 个函数高可信注释预览`,
        target.languageId,
      )
    } catch (error) {
      if (this.pending) await this.finish(this.pending, false, false)
      throw error
    }
    return result
  }

  dispose(): void {
    const pending = this.pending
    if (pending) {
      void this.finish(pending, false, true)
    } else {
      void this.host.setPendingContext(false).catch((error) => this.logFailure("销毁预览状态", error))
    }
    this.contents.clear()
    for (const disposable of this.disposables) disposable.dispose()
  }

  private settle(apply: boolean, close = true): void {
    const pending = this.pending
    if (pending) void this.finish(pending, apply, close)
  }

  private async finish(pending: PendingPreview, apply: boolean, close: boolean): Promise<void> {
    if (pending.settled) return
    pending.settled = true
    if (this.pending === pending) this.pending = undefined
    this.contents.delete(pending.original.key)
    this.contents.delete(pending.modified.key)
    try {
      await this.host.setPendingContext(false)
    } catch (error) {
      this.logFailure("复位预览状态", error)
    }
    pending.resolve(apply)
    if (close) {
      try {
        await this.host.closeDiff(pending.original.key, pending.modified.key)
      } catch (error) {
        this.logFailure("关闭预览标签", error)
      }
    }
  }

  private matchesPending(original: string, modified: string): boolean {
    return this.pending?.original.key === original && this.pending.modified.key === modified
  }

  private logFailure(stage: string, error: unknown): void {
    this.log(`preview ${stage}失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

class VscodeCodeCommentPreviewHost implements CodeCommentPreviewHost {
  createResource(id: string, side: "before" | "after", filename: string): PreviewResource {
    const uri = vscode.Uri.from({
      scheme: CODE_COMMENT_PREVIEW_SCHEME,
      authority: id,
      path: `/${side}/${filename}`,
    })
    return { key: uri.toString(), value: uri }
  }

  registerProvider(read: (key: string) => string | undefined): vscode.Disposable {
    return vscode.workspace.registerTextDocumentContentProvider(CODE_COMMENT_PREVIEW_SCHEME, {
      provideTextDocumentContent: (uri) => read(uri.toString()),
    })
  }

  registerCommand(command: string, run: () => void): vscode.Disposable {
    return vscode.commands.registerCommand(command, run)
  }

  onDidCloseDiff(run: (originalKey: string, modifiedKey: string) => void): vscode.Disposable {
    return vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.closed) {
        if (!(tab.input instanceof vscode.TabInputTextDiff)) continue
        run(tab.input.original.toString(), tab.input.modified.toString())
      }
    })
  }

  async openDiff(
    original: PreviewResource,
    modified: PreviewResource,
    title: string,
    languageId: string,
  ): Promise<void> {
    const before = await vscode.workspace.openTextDocument(original.value as vscode.Uri)
    const after = await vscode.workspace.openTextDocument(modified.value as vscode.Uri)
    if (before.languageId !== languageId) await vscode.languages.setTextDocumentLanguage(before, languageId)
    if (after.languageId !== languageId) await vscode.languages.setTextDocumentLanguage(after, languageId)
    await vscode.commands.executeCommand("vscode.diff", before.uri, after.uri, title)
  }

  async closeDiff(originalKey: string, modifiedKey: string): Promise<void> {
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs)
    const tab = tabs.find((candidate) => {
      if (!(candidate.input instanceof vscode.TabInputTextDiff)) return false
      return candidate.input.original.toString() === originalKey && candidate.input.modified.toString() === modifiedKey
    })
    if (tab) await vscode.window.tabGroups.close(tab)
  }

  async setPendingContext(pending: boolean): Promise<void> {
    await vscode.commands.executeCommand("setContext", CODE_COMMENT_PREVIEW_PENDING_CONTEXT, pending)
  }
}
