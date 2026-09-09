import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as vscode from "vscode"
import { handleFilePicker } from "../../src/chipmate-provider/file-picker"
import { EditorReferenceSource } from "../../src/chipmate-provider/editor-reference"

describe("引用入口的扩展宿主契约", () => {
  afterEach(() => {
    Object.assign(vscode.window, { activeTextEditor: undefined })
  })
  it("旧调用选文件，文件夹调用只选目录，取消仍返回原请求标识", async () => {
    const dialog = spyOn(vscode.window, "showOpenDialog").mockResolvedValue(undefined)
    const output: unknown[] = []
    try {
      await handleFilePicker({ requestId: "文件", post: (value) => output.push(value) })
      expect(dialog.mock.calls[0]?.[0]).toMatchObject({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
      })
      await handleFilePicker({ requestId: "目录", kind: "folder", post: (value) => output.push(value) })
      expect(dialog.mock.calls[1]?.[0]).toMatchObject({ canSelectFiles: false, canSelectFolders: true })
      expect(output).toEqual([
        { type: "filePickerResult", requestId: "文件", path: "" },
        { type: "filePickerResult", requestId: "目录", path: "" },
      ])
    } finally {
      dialog.mockRestore()
    }
  })
  it("失焦仍能引用最近编辑器的选区，空选区和已关闭文档有明确提示", () => {
    const editor = {
      document: { isClosed: false, uri: vscode.Uri.file("/验收/入口.c"), getText: () => "return 7;" },
      selection: { isEmpty: false, start: { line: 2, character: 0 }, end: { line: 4, character: 0 } },
    }
    Object.assign(vscode.window, { activeTextEditor: editor })
    const source = new EditorReferenceSource()
    try {
      Object.assign(vscode.window, { activeTextEditor: undefined })
      expect(source.read("file")).toEqual({ path: "/验收/入口.c" })
      const selected = source.read("selection")
      expect(selected.text).toContain("return 7;")
      expect(selected.text).toContain("入口.c")
      expect(selected.text).toContain("入口.c:3-4")
      editor.selection.isEmpty = true
      expect(source.read("selection").error).toContain("选择")
      editor.document.isClosed = true
      expect(source.read("file").error).toContain("打开")
    } finally {
      source.dispose()
    }
  })
})
