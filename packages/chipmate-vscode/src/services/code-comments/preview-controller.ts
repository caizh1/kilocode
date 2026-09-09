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

export type CodeCommentSourceViewState = {
  uri: string
  viewColumn: vscode.ViewColumn | undefined
  preview: boolean | undefined
  selections: readonly vscode.Selection[]
  visibleRange: vscode.Range | undefined
}

export interface CodeCommentPreviewHost {
  createResource(id: string, side: "before" | "after", filename: string): PreviewResource
  registerProvider(read: (key: string) => string | undefined): vscode.Disposable
  registerCommand(command: string, run: () => void): vscode.Disposable
  onDidCloseDiff(run: (originalKey: string, modifiedKey: string) => void): vscode.Disposable
  openDiff(
    original: PreviewResource,
    modified: PreviewResource,
    title: string,
    languageId: string,
    source: CodeCommentSourceViewState,
  ): Promise<void>
  closeDiff(originalKey: string, modifiedKey: string): Promise<void>
  restoreSource(source: CodeCommentSourceViewState): Promise<void>
  setPendingContext(pending: boolean): Promise<void>
}

type PendingPreview = {
  original: PreviewResource
  modified: PreviewResource
  source: CodeCommentSourceViewState
  resolve: (apply: boolean) => void
  settled: boolean
}

export type CodeCommentPreviewTarget = Pick<FunctionTarget, "filePath" | "documentText" | "languageId">

export function captureCodeCommentSourceView(editor: vscode.TextEditor): CodeCommentSourceViewState {
  const uri = editor.document.uri.toString()
  const sourceTab = findSourceTab(uri, editor.viewColumn)
  return {
    uri,
    viewColumn: editor.viewColumn,
    preview: sourceTab?.isPreview,
    selections: [...editor.selections],
    visibleRange: editor.visibleRanges[0],
  }
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
      host.registerCommand("chipmate.v2.applyCodeCommentPreview", () => this.settle(true)),
      host.registerCommand("chipmate.v2.discardCodeCommentPreview", () => this.settle(false)),
      host.onDidCloseDiff((original, modified) => {
        if (this.matchesPending(original, modified)) this.settle(false, false)
      }),
    ]
    void host.setPendingContext(false).catch((error) => this.logFailure("初始化预览状态", error))
  }

  async confirm(
    target: CodeCommentPreviewTarget,
    candidate: string,
    functions: number,
    source: CodeCommentSourceViewState,
    onOpened?: () => void,
    coverageIncomplete = 0,
  ): Promise<boolean> {
    return this.confirmWithTitle(
      target,
      candidate,
      previewTitle(path.basename(target.filePath), functions, coverageIncomplete),
      source,
      onOpened,
    )
  }

  async confirmSourceAnnotations(
    target: CodeCommentPreviewTarget,
    candidate: string,
    targets: number,
    source: CodeCommentSourceViewState,
    onOpened?: () => void,
  ): Promise<boolean> {
    return this.confirmWithTitle(
      target,
      candidate,
      sourceAnnotationPreviewTitle(path.basename(target.filePath), targets),
      source,
      onOpened,
    )
  }

  private async confirmWithTitle(
    target: CodeCommentPreviewTarget,
    candidate: string,
    title: string,
    source: CodeCommentSourceViewState,
    onOpened?: () => void,
  ): Promise<boolean> {
    if (this.pending) await this.finish(this.pending, false, true)

    const id = `${Date.now().toString(36)}-${++this.sequence}`
    const filename = path.basename(target.filePath)
    const original = this.host.createResource(id, "before", filename)
    const modified = this.host.createResource(id, "after", filename)
    this.contents.set(original.key, target.documentText)
    this.contents.set(modified.key, candidate)

    const result = new Promise<boolean>((resolve) => {
      this.pending = { original, modified, source, resolve, settled: false }
    })

    try {
      await this.host.setPendingContext(true)
      await this.host.openDiff(original, modified, title, target.languageId, source)
      onOpened?.()
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
    if (close) {
      try {
        await this.host.closeDiff(pending.original.key, pending.modified.key)
      } catch (error) {
        this.logFailure("关闭预览标签", error)
      }
    }
    try {
      await this.host.restoreSource(pending.source)
    } catch (error) {
      this.logFailure("恢复源码标签", error)
      void vscode.window.showWarningMessage(
        `注释预览已关闭，但无法恢复原源码：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    pending.resolve(apply)
  }

  private matchesPending(original: string, modified: string): boolean {
    return this.pending?.original.key === original && this.pending.modified.key === modified
  }

  private logFailure(stage: string, error: unknown): void {
    this.log(`preview ${stage}失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export function previewTitle(filename: string, functions: number, coverageIncomplete: number): string {
  if (coverageIncomplete === 0) return `${filename} · ${functions} 个函数高可信注释预览`
  if (functions === 1) return `${filename} · 1 个函数注释预览（复杂逻辑覆盖不足）`
  return `${filename} · ${functions} 个函数注释预览（${coverageIncomplete} 个覆盖不足）`
}

export function sourceAnnotationPreviewTitle(filename: string, targets: number): string {
  return `${filename} · ${targets} 个源码目标高可信注释预览`
}

export class VscodeCodeCommentPreviewHost implements CodeCommentPreviewHost {
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
    source: CodeCommentSourceViewState,
  ): Promise<void> {
    const before = await vscode.workspace.openTextDocument(original.value as vscode.Uri)
    const after = await vscode.workspace.openTextDocument(modified.value as vscode.Uri)
    if (before.languageId !== languageId) await vscode.languages.setTextDocumentLanguage(before, languageId)
    if (after.languageId !== languageId) await vscode.languages.setTextDocumentLanguage(after, languageId)
    await vscode.commands.executeCommand("vscode.diff", before.uri, after.uri, title, {
      preview: false,
      viewColumn: this.resolveViewColumn(source),
    } satisfies vscode.TextDocumentShowOptions)
  }

  async closeDiff(originalKey: string, modifiedKey: string): Promise<void> {
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs)
    const tab = tabs.find((candidate) => {
      if (!(candidate.input instanceof vscode.TabInputTextDiff)) return false
      return candidate.input.original.toString() === originalKey && candidate.input.modified.toString() === modifiedKey
    })
    if (tab) await vscode.window.tabGroups.close(tab)
  }

  async restoreSource(source: CodeCommentSourceViewState): Promise<void> {
    const uri = vscode.Uri.parse(source.uri)
    const existingTab = findSourceTab(source.uri, source.viewColumn)
    const document =
      vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === source.uri) ??
      (await vscode.workspace.openTextDocument(uri))
    const options: vscode.TextDocumentShowOptions = {
      viewColumn: existingTab?.group.viewColumn ?? this.resolveViewColumn(source),
      preserveFocus: false,
      selection: source.selections[0],
    }
    if (!existingTab && source.preview !== undefined) options.preview = source.preview
    const editor = await vscode.window.showTextDocument(document, options)
    if (source.selections.length > 0) editor.selections = [...source.selections]
    if (source.visibleRange) editor.revealRange(source.visibleRange, vscode.TextEditorRevealType.AtTop)
  }

  async setPendingContext(pending: boolean): Promise<void> {
    await vscode.commands.executeCommand("setContext", CODE_COMMENT_PREVIEW_PENDING_CONTEXT, pending)
  }

  private resolveViewColumn(source: CodeCommentSourceViewState): vscode.ViewColumn {
    if (
      source.viewColumn !== undefined &&
      vscode.window.tabGroups.all.some((group) => group.viewColumn === source.viewColumn)
    ) {
      return source.viewColumn
    }
    return findSourceTab(source.uri)?.group.viewColumn ?? vscode.window.tabGroups.activeTabGroup.viewColumn
  }
}

function findSourceTab(uri: string, preferredColumn?: vscode.ViewColumn): vscode.Tab | undefined {
  const matches = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs
      .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri)
      .map((tab) => ({ group, tab })),
  )
  return matches.find(({ group }) => group.viewColumn === preferredColumn)?.tab ?? matches[0]?.tab
}
