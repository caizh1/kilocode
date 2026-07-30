import { describe, expect, it } from "bun:test"

const css = await Bun.file(new URL("../../webview-ui/src/styles/qa-tool-call.css", import.meta.url)).text()
const chat = await Bun.file(new URL("../../webview-ui/src/styles/chat.css", import.meta.url)).text()
const message = await Bun.file(new URL("../../webview-ui/src/components/chat/AssistantMessage.tsx", import.meta.url)).text()
const tool = await Bun.file(new URL("../../../kilo-ui/src/components/basic-tool.tsx", import.meta.url)).text()
const base = await Bun.file(new URL("../../../kilo-ui/src/components/basic-tool.css", import.meta.url)).text()
const en = await Bun.file(new URL("../../../kilo-i18n/src/en.ts", import.meta.url)).text()
const zh = await Bun.file(new URL("../../../kilo-i18n/src/zh.ts", import.meta.url)).text()
const zht = await Bun.file(new URL("../../../kilo-i18n/src/zht.ts", import.meta.url)).text()

describe("QA 工具调用框", () => {
  it("只在 QA Shell 中启用专属视觉样式", () => {
    expect(css).toContain('.chat-view[data-ui="qa-shell"]')
    expect(css).not.toContain(".settings-shell")
    expect(css).not.toContain(".marketplace")
    expect(css).not.toContain("position: absolute")
    expect(css).toContain('[data-ui="qa-part-shell"][data-qa-tool-call]')
    expect(message).toContain('data-qa-tool-call={standard(part) ? "" : undefined}')
    expect(message).toContain('new Set(["question", "task", "todowrite"])')
    expect(css).toContain("min-height: 40px")
    expect(css).toContain("--sticky-accordion-offset: 40px")
    expect(chat.indexOf('@import "./titanium-studio.css"')).toBeLessThan(
      chat.indexOf('@import "./qa-tool-call.css"'),
    )
    expect(chat.indexOf('@import "./qa-tool-call.css"')).toBeLessThan(chat.indexOf('@import "./high-contrast.css"'))
  })

  it("完成状态使用现有图标且在非 QA 环境默认隐藏", () => {
    expect(tool).toContain('props.status === "completed"')
    expect(tool).toContain('name="circle-check"')
    expect(tool).toContain('data-slot="basic-tool-completed-label"')
    expect(tool).not.toContain("position: absolute")
    expect(base).toMatch(/\[data-slot="basic-tool-completed"\]\s*\{\s*display: none;/)
    expect(css).toMatch(/\[data-slot="basic-tool-completed"\]\s*\{\s*display: inline-flex;/)
  })

  it("强调线位于所有标准工具图标之前并保持既有文字坐标", () => {
    expect(css).toContain("width: calc(100% - 6px)")
    expect(css).toContain("min-height: 40px")
    expect(css).toContain("border-block: 1px solid")
    expect(css).toContain("flex: 0 0 2px")
    expect(css).toContain("height: 20px")
    expect(css).toContain('[data-slot="basic-tool-tool-trigger-content"]::before')
    expect(css).not.toContain('[data-slot="basic-tool-trigger-layout"]::before')
    expect(css).toContain("gap: 2px !important")
    expect(css).toContain("margin-inline: 4px")
    expect(css).toContain("margin-inline: 0 -4px")
    expect(css).toContain("margin-inline-start: -4px")
    expect(css).toContain("font-size: var(--kilo-font-size-11)")
    expect(css).toContain("letter-spacing: normal")
    expect(css).not.toContain("letter-spacing: -0.75px")
    expect(css).toContain("flex: 0 0 12px")
    expect(css).toContain("stroke-width: 1.5px")
    expect(css).toContain("margin-inline-start: 4px")
  })

  it("提供英文、简体中文和繁体中文完成文案", () => {
    expect(en).toContain('"ui.basicTool.completed": "Done"')
    expect(zh).toContain('"ui.basicTool.completed": "完成"')
    expect(zht).toContain('"ui.basicTool.completed": "完成"')
    expect(en).toContain('"ui.basicTool.readFile": "Read file"')
    expect(zh).toContain('"ui.basicTool.readFile": "读取文件"')
    expect(zht).toContain('"ui.basicTool.readFile": "讀取檔案"')
    expect(tool).toContain('name="liquid-file"')
    expect(base).toContain('[data-slot="basic-tool-qa-read-icon"]')
  })
})
