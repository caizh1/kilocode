import { expect, test } from "bun:test"
import * as vscode from "vscode"
import { handleEditorAction } from "../../src/chipmate-provider/editor-actions"
import { documentArtifactCardFromToolPart } from "../../webview-ui/src/components/chat/document-artifact-card"

test("页面卡片保留真实页码；正式打开处理器选择图片预览而非文本编辑器", async () => {
  const card = documentArtifactCardFromToolPart({
    id: "页面",
    type: "tool",
    tool: "word_to_images",
    state: {
      status: "completed",
      input: {},
      title: "Word 页面图片",
      metadata: {},
      output: JSON.stringify({
        pagePngPaths: [".chipmate/artifacts/页面/page-0012.png"],
        pageNumbers: [12],
        pageCount: 20,
        nextPage: 13,
      }),
    },
  })
  const link = card?.links.find((link) => link.kind === "page-png")
  expect(link?.label).toBe("查看第 12 页")
  const execute = vscode.commands.executeCommand,
    stat = vscode.workspace.fs.stat,
    open = vscode.workspace.openTextDocument
  const seen: unknown[] = []
  Object.assign(vscode.commands, {
    executeCommand: async (...args: unknown[]) => {
      seen.push(args)
    },
  })
  Object.assign(vscode.workspace.fs, { stat: async () => ({ type: vscode.FileType.File }) })
  Object.assign(vscode.workspace, {
    openTextDocument: async () => {
      throw new Error("不应按文本打开 PNG")
    },
  })
  try {
    expect(handleEditorAction({ type: "openFile", filePath: link!.path }, { dir: () => "/远程工作区" })).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toHaveLength(1)
    expect((seen[0] as unknown[])[0]).toBe("vscode.open")
    expect(((seen[0] as unknown[])[1] as vscode.Uri).fsPath).toBe("/远程工作区/" + link!.path)
  } finally {
    Object.assign(vscode.commands, { executeCommand: execute })
    Object.assign(vscode.workspace.fs, { stat })
    Object.assign(vscode.workspace, { openTextDocument: open })
  }
})
