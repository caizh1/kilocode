import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  APPLY_CODE_COMMENT_PREVIEW_COMMAND,
  captureCodeCommentSourceView,
  CodeCommentPreviewController,
  DISCARD_CODE_COMMENT_PREVIEW_COMMAND,
  previewTitle,
  sourceAnnotationPreviewTitle,
  type CodeCommentPreviewHost,
  type CodeCommentSourceViewState,
} from "../../src/services/code-comments/preview-controller"
import type { FunctionTarget } from "../../src/services/code-comments/types"

class PreviewHost implements CodeCommentPreviewHost {
  readonly commands = new Map<string, () => void>()
  readonly contexts: boolean[] = []
  readonly closed: Array<[string, string]> = []
  readonly restored: CodeCommentSourceViewState[] = []
  restoreFailure: Error | undefined
  opened:
    | {
        original: { key: string; value: unknown }
        modified: { key: string; value: unknown }
        title: string
        language: string
        source: CodeCommentSourceViewState
      }
    | undefined
  read: ((key: string) => string | undefined) | undefined
  closeListener: ((original: string, modified: string) => void) | undefined

  createResource(id: string, side: "before" | "after", filename: string) {
    const key = `chipmate-code-comment-preview://${id}/${side}/${filename}`
    return { key, value: key }
  }

  registerProvider(read: (key: string) => string | undefined) {
    this.read = read
    return { dispose: () => undefined }
  }

  registerCommand(command: string, run: () => void) {
    this.commands.set(command, run)
    return { dispose: () => this.commands.delete(command) }
  }

  onDidCloseDiff(run: (originalKey: string, modifiedKey: string) => void) {
    this.closeListener = run
    return { dispose: () => (this.closeListener = undefined) }
  }

  async openDiff(
    original: { key: string; value: unknown },
    modified: { key: string; value: unknown },
    title: string,
    language: string,
    source: CodeCommentSourceViewState,
  ) {
    this.opened = { original, modified, title, language, source }
  }

  async closeDiff(original: string, modified: string) {
    this.closed.push([original, modified])
  }

  async restoreSource(source: CodeCommentSourceViewState) {
    if (this.restoreFailure) throw this.restoreFailure
    this.restored.push(source)
  }

  async setPendingContext(pending: boolean) {
    this.contexts.push(pending)
  }
}

const target: FunctionTarget = {
  uri: "file:///repo/nvme_cmd_table.c",
  filePath: "/repo/nvme_cmd_table.c",
  relativePath: "nvme_cmd_table.c",
  workspacePath: "/repo",
  languageId: "c",
  documentVersion: 1,
  documentText: "int command(void) { return 0; }\n",
  functionSource: "int command(void) { return 0; }",
  functionHash: "hash",
  startIndex: 0,
  endIndex: 31,
  startLine: 0,
  endLine: 0,
  contextBefore: "",
  contextAfter: "",
  functionHeaderStyle: "docBlock",
  existingComments: [],
  complexity: {
    lineCount: 1,
    controlRegionCount: 0,
    existingCoveredRegionCount: 0,
    minimumInlineComments: 0,
    controlRegions: [],
  },
  anchors: [{ line: 0, kind: "function", targetLineText: "int command(void) { return 0; }", indent: "" }],
  eol: "\n",
}

const sourceView: CodeCommentSourceViewState = {
  uri: target.uri,
  viewColumn: vscode.ViewColumn.Two,
  preview: true,
  selections: [
    {
      anchor: { line: 0, character: 4 },
      active: { line: 0, character: 11 },
      start: { line: 0, character: 4 },
      end: { line: 0, character: 11 },
      isEmpty: false,
      isSingleLine: true,
      isReversed: false,
    } as vscode.Selection,
  ],
  visibleRange: new vscode.Range(0, 0, 0, 31),
}

describe("高可信注释 Diff 预览控制器", () => {
  it("完整和覆盖不足候选使用不同的非误导标题", () => {
    expect(previewTitle("main.c", 1, 0)).toBe("main.c · 1 个函数高可信注释预览")
    expect(previewTitle("main.c", 1, 1)).toBe("main.c · 1 个函数注释预览（复杂逻辑覆盖不足）")
    expect(previewTitle("main.c", 4, 2)).toBe("main.c · 4 个函数注释预览（2 个覆盖不足）")
    expect(sourceAnnotationPreviewTitle("main.c", 3)).toBe("main.c · 3 个源码目标高可信注释预览")
  })

  it("声明和混合目标复用同一个只读 Diff 生命周期", async () => {
    const host = new PreviewHost()
    const controller = new CodeCommentPreviewController(host)
    const result = controller.confirmSourceAnnotations(target, target.documentText, 2, sourceView)
    await Promise.resolve()

    expect(host.opened?.title).toBe("nvme_cmd_table.c · 2 个源码目标高可信注释预览")
    expect(host.read?.(host.opened!.original.key)).toBe(target.documentText)
    host.commands.get(APPLY_CODE_COMMENT_PREVIEW_COMMAND)?.()
    expect(await result).toBe(true)
    expect(host.restored).toEqual([sourceView])
  })

  it("通过只读虚拟资源打开一个 Diff，并从标题栏应用", async () => {
    const host = new PreviewHost()
    const controller = new CodeCommentPreviewController(host)
    const candidate = "/** 执行命令。 */\nint command(void) { return 0; }\n"
    let opened = false
    const result = controller.confirm(target, candidate, 1, sourceView, () => (opened = true))
    await Bun.sleep(0)

    expect(host.opened?.title).toBe("nvme_cmd_table.c · 1 个函数高可信注释预览")
    expect(host.opened?.language).toBe("c")
    expect(host.read?.(host.opened!.original.key)).toBe(target.documentText)
    expect(host.read?.(host.opened!.modified.key)).toBe(candidate)
    expect(host.opened?.original.key).not.toStartWith("untitled:")
    expect(host.opened?.source).toBe(sourceView)
    expect(opened).toBe(true)

    host.commands.get(APPLY_CODE_COMMENT_PREVIEW_COMMAND)?.()
    expect(await result).toBe(true)
    await Promise.resolve()
    expect(host.contexts.at(-1)).toBe(false)
    expect(host.read?.(host.opened!.original.key)).toBeUndefined()
    expect(host.closed).toHaveLength(1)
    expect(host.restored).toEqual([sourceView])
  })

  it("放弃或关闭 Diff 都返回 false 且不重复确认", async () => {
    const host = new PreviewHost()
    const controller = new CodeCommentPreviewController(host)
    const discarded = controller.confirm(target, target.documentText, 1, sourceView)
    await Promise.resolve()
    host.commands.get(DISCARD_CODE_COMMENT_PREVIEW_COMMAND)?.()
    host.commands.get(APPLY_CODE_COMMENT_PREVIEW_COMMAND)?.()
    expect(await discarded).toBe(false)
    expect(host.closed).toHaveLength(1)
    expect(host.restored).toEqual([sourceView])

    const closed = controller.confirm(target, target.documentText, 1, sourceView)
    await Promise.resolve()
    host.closeListener?.(host.opened!.original.key, host.opened!.modified.key)
    expect(await closed).toBe(false)
    expect(host.closed).toHaveLength(1)
    expect(host.restored).toEqual([sourceView, sourceView])
    expect(host.contexts.at(-1)).toBe(false)
  })

  it("新预览会放弃旧预览，销毁时清理剩余资源和命令", async () => {
    const host = new PreviewHost()
    const controller = new CodeCommentPreviewController(host)
    const first = controller.confirm(target, target.documentText, 1, sourceView)
    await Promise.resolve()
    const second = controller.confirm(target, target.documentText, 2, sourceView)
    expect(await first).toBe(false)
    expect(host.restored).toEqual([sourceView])
    await Promise.resolve()
    expect(host.opened?.title).toContain("2 个函数")

    controller.dispose()
    expect(await second).toBe(false)
    expect(host.commands.size).toBe(0)
    expect(host.contexts.at(-1)).toBe(false)
  })

  it("恢复源码失败仍会结束确认并清理状态", async () => {
    const host = new PreviewHost()
    const logs: string[] = []
    const controller = new CodeCommentPreviewController(host, (message) => logs.push(message))
    host.restoreFailure = new Error("源文件已删除")

    const result = controller.confirm(target, target.documentText, 1, sourceView)
    await Promise.resolve()
    host.commands.get(DISCARD_CODE_COMMENT_PREVIEW_COMMAND)?.()

    expect(await result).toBe(false)
    expect(host.contexts.at(-1)).toBe(false)
    expect(logs.some((message) => message.includes("恢复源码标签失败：源文件已删除"))).toBe(true)
  })

  it("捕获源码所在编辑器组、预览状态、选区和可见范围", () => {
    const uri = { toString: () => target.uri }
    const tab = {
      input: new vscode.TabInputText(uri as vscode.Uri),
      isPreview: true,
    }
    const otherTab = {
      input: new vscode.TabInputText(uri as vscode.Uri),
      isPreview: false,
    }
    const groups = vscode.window.tabGroups.all
    ;(vscode.window.tabGroups as unknown as { all: unknown[] }).all = [
      { tabs: [otherTab], viewColumn: vscode.ViewColumn.One },
      { tabs: [tab], viewColumn: vscode.ViewColumn.Two },
    ]
    try {
      const captured = captureCodeCommentSourceView({
        document: { uri },
        viewColumn: vscode.ViewColumn.Two,
        selections: sourceView.selections,
        visibleRanges: [sourceView.visibleRange!],
      } as vscode.TextEditor)

      expect(captured).toEqual(sourceView)
    } finally {
      ;(vscode.window.tabGroups as unknown as { all: unknown[] }).all = [...groups]
    }
  })
})
