import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")

function source(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8")
}

describe("Reviewer Webview 隔离接线", () => {
  test("注册专属工具卡片并在 Agent 选择器显示原生图标", () => {
    const app = source("webview-ui/src/App.tsx")
    const mode = source("webview-ui/src/components/shared/ModeSwitcher.tsx")
    expect(app).toContain("registerUfsReviewTool()")
    expect(mode).toContain('"ufs-reviewer": "shield"')
    expect(mode).not.toContain('"ufs-review": "shield"')
  })

  test("普通 PromptInput 和 ChatView 不包含 Reviewer 条件分支", () => {
    const prompt = source("webview-ui/src/components/chat/PromptInput.tsx")
    const chat = source("webview-ui/src/components/chat/ChatView.tsx")
    for (const content of [prompt, chat]) {
      expect(content).not.toMatch(/UfsReview|ufsReview|ufs-review|ufs_review/)
    }
  })

  test("修复交接先切换 Code，再把冻结 runId 和 finding 写入输入框", () => {
    const card = source("webview-ui/src/components/chat/UfsReviewToolCard.tsx")
    expect(card).toContain('requestAgentSelection("code")')
    expect(card).toContain('new CustomEvent("prefillPrompt"')
    expect(card).toContain("current.runId")
    expect(card).toContain("selectedIDs()")
  })

  test("卡片和图标布局保持正常文档流并提供高对比兜底", () => {
    const css = source("webview-ui/src/styles/ufs-review.css")
    expect(css).not.toContain("position: absolute")
    expect(css).toContain("display: flex")
    expect(css).toContain("display: grid")
    expect(css).toContain("body.vscode-high-contrast")
    expect(css).toContain("backdrop-filter")
  })
})
