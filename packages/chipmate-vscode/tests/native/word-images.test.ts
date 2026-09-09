// 在隔离的真实 VS Code 扩展宿主运行；输入为真实 Server 生成的页面。
import * as vscode from "vscode"
import assert from "node:assert/strict"
import { handleEditorAction } from "../../src/chipmate-provider/editor-actions"

export async function run() {
  const file = process.env.CHIPMATE_WORD_IMAGES_TEST_PNG
  assert.ok(file, "缺少真实转图样本")
  assert.equal(handleEditorAction({ type: "openFile", filePath: file }, { dir: () => "/tmp" }), true)
  for (let index = 0; index < 100; index++) {
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((tab) => tab.input instanceof vscode.TabInputCustom && tab.input.uri.fsPath === file)
    if (tab) {
      assert.ok(tab.input instanceof vscode.TabInputCustom)
      assert.equal(tab.input.viewType, "imagePreview.previewEditor")
      console.log("原生 VS Code 图片预览验收通过")
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("页面链接未在原生图片预览器打开")
}
