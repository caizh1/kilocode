import * as vscode from "vscode"
import { createPrompt } from "../services/code-actions/support-prompt"

/** 只保留编辑器引用；点击 Webview 后仍能读取最近的有效选区，不缓存正文。 */
export class EditorReferenceSource implements vscode.Disposable {
  private editor = vscode.window.activeTextEditor
  private subscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) this.editor = editor
  })

  read(kind: "file" | "selection") {
    const editor = vscode.window.activeTextEditor ?? this.editor
    if (!editor || editor.document.isClosed || editor.document.uri.scheme !== "file") {
      return { error: "请先打开要引用的文件。" }
    }
    const path = editor.document.uri.fsPath
    if (kind === "file") return { path }
    if (editor.selection.isEmpty) return { error: "请先在编辑器中选择要引用的代码。" }
    return {
      path,
      text: createPrompt("ADD_TO_CONTEXT", {
        filePath: path,
        startLine: String(editor.selection.start.line + 1),
        endLine: String(
          editor.selection.end.character === 0 && editor.selection.end.line > editor.selection.start.line
            ? editor.selection.end.line
            : editor.selection.end.line + 1,
        ),
        selectedText: editor.document.getText(editor.selection),
      }),
    }
  }

  dispose() {
    this.subscription.dispose()
    this.editor = undefined
  }
}
