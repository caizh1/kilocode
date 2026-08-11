import { describe, expect, it } from "bun:test"
import {
  APPLY_CODE_COMMENT_PREVIEW_COMMAND,
  CodeCommentPreviewController,
  DISCARD_CODE_COMMENT_PREVIEW_COMMAND,
  type CodeCommentPreviewHost,
} from "../../src/services/code-comments/preview-controller"
import type { FunctionTarget } from "../../src/services/code-comments/types"

class PreviewHost implements CodeCommentPreviewHost {
  readonly commands = new Map<string, () => void>()
  readonly contexts: boolean[] = []
  readonly closed: Array<[string, string]> = []
  opened:
    | { original: { key: string; value: unknown }; modified: { key: string; value: unknown }; title: string; language: string }
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
  ) {
    this.opened = { original, modified, title, language }
  }

  async closeDiff(original: string, modified: string) {
    this.closed.push([original, modified])
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
  anchors: [{ line: 0, kind: "function", targetLineText: "int command(void) { return 0; }", indent: "" }],
  eol: "\n",
}

describe("高可信注释 Diff 预览控制器", () => {
  it("通过只读虚拟资源打开一个 Diff，并从标题栏应用", async () => {
    const host = new PreviewHost()
    const controller = new CodeCommentPreviewController(host)
    const candidate = "/** 执行命令。 */\nint command(void) { return 0; }\n"
    const result = controller.confirm(target, candidate, 1)
    await Promise.resolve()

    expect(host.opened?.title).toBe("nvme_cmd_table.c · 1 个函数高可信注释预览")
    expect(host.opened?.language).toBe("c")
    expect(host.read?.(host.opened!.original.key)).toBe(target.documentText)
    expect(host.read?.(host.opened!.modified.key)).toBe(candidate)
    expect(host.opened?.original.key).not.toStartWith("untitled:")

    host.commands.get(APPLY_CODE_COMMENT_PREVIEW_COMMAND)?.()
    expect(await result).toBe(true)
    await Promise.resolve()
    expect(host.contexts.at(-1)).toBe(false)
    expect(host.read?.(host.opened!.original.key)).toBeUndefined()
    expect(host.closed).toHaveLength(1)
  })

  it("放弃或关闭 Diff 都返回 false 且不重复确认", async () => {
    const host = new PreviewHost()
    const controller = new CodeCommentPreviewController(host)
    const discarded = controller.confirm(target, target.documentText, 1)
    await Promise.resolve()
    host.commands.get(DISCARD_CODE_COMMENT_PREVIEW_COMMAND)?.()
    host.commands.get(APPLY_CODE_COMMENT_PREVIEW_COMMAND)?.()
    expect(await discarded).toBe(false)
    expect(host.closed).toHaveLength(1)

    const closed = controller.confirm(target, target.documentText, 1)
    await Promise.resolve()
    host.closeListener?.(host.opened!.original.key, host.opened!.modified.key)
    expect(await closed).toBe(false)
    expect(host.closed).toHaveLength(1)
    expect(host.contexts.at(-1)).toBe(false)
  })

  it("新预览会放弃旧预览，销毁时清理剩余资源和命令", async () => {
    const host = new PreviewHost()
    const controller = new CodeCommentPreviewController(host)
    const first = controller.confirm(target, target.documentText, 1)
    await Promise.resolve()
    const second = controller.confirm(target, target.documentText, 2)
    expect(await first).toBe(false)
    await Promise.resolve()
    expect(host.opened?.title).toContain("2 个函数")

    controller.dispose()
    expect(await second).toBe(false)
    expect(host.commands.size).toBe(0)
    expect(host.contexts.at(-1)).toBe(false)
  })
})
