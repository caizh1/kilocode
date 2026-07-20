import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { dict as en } from "../../webview-ui/src/i18n/en"
import { dict as zh } from "../../webview-ui/src/i18n/zh"
import { dict as zht } from "../../webview-ui/src/i18n/zht"

const root = path.resolve(import.meta.dir, "../..")
const logo = fs.readFileSync(path.join(root, "webview-ui/src/components/shared/ChipMateLogo.tsx"), "utf-8")
const messages = fs.readFileSync(path.join(root, "webview-ui/src/components/chat/MessageList.tsx"), "utf-8")
const sidebar = fs.readFileSync(path.join(root, "webview-ui/src/components/chat/SidebarEmptyState.tsx"), "utf-8")
const welcome = fs.readFileSync(path.join(root, "webview-ui/src/components/chat/WelcomeEmptyState.tsx"), "utf-8")
const feedback = fs.readFileSync(path.join(root, "webview-ui/src/components/chat/FeedbackDialog.tsx"), "utf-8")

describe("QA welcome branding", () => {
  it("uses the packaged ChipMate asset only in the QA welcome state", () => {
    expect(fs.existsSync(path.join(root, "assets/icons/chipmate-icon.png"))).toBe(true)
    expect(logo).toContain('props.welcome ? "chipmate-icon.png"')
    expect(messages).not.toContain('<ChipMateLogo class="kilo-logo" welcome />')
    expect(sidebar).toContain('<ChipMateLogo class="kilo-logo" welcome />')
    expect(sidebar).not.toContain("KiloLogo")
    expect(welcome).toContain('<ChipMateLogo class="kilo-logo" welcome />')
    expect(welcome).not.toContain("KiloLogo")
    expect(welcome).toContain('<h1 class="kilo-product-title">ChipMate</h1>')
    expect(welcome).toContain('<div class="recent-session-list">')
    expect(feedback).toContain('<ChipMateLogo class="feedback-dialog-logo" />')
  })

  it("uses ChipMate branding throughout the English and Chinese work style onboarding", () => {
    for (const dict of [en, zh, zht]) {
      const text = Object.entries(dict)
        .filter(([key]) => key.startsWith("workStyle."))
        .map(([, value]) => value)
        .join("\n")
      expect(text).not.toContain("Kilo")
    }

    expect(en["workStyle.onboarding.welcome"]).toBe("Welcome to ChipMate")
    expect(zh["workStyle.onboarding.welcome"]).toBe("欢迎使用 ChipMate")
    expect(zht["workStyle.onboarding.welcome"]).toBe("歡迎使用 ChipMate")
  })
})
