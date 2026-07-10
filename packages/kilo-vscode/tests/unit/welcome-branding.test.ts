import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const logo = fs.readFileSync(path.join(root, "webview-ui/src/components/shared/ChipMateLogo.tsx"), "utf-8")
const messages = fs.readFileSync(path.join(root, "webview-ui/src/components/chat/MessageList.tsx"), "utf-8")
const feedback = fs.readFileSync(path.join(root, "webview-ui/src/components/chat/FeedbackDialog.tsx"), "utf-8")

describe("QA welcome branding", () => {
  it("uses the packaged ChipMate asset only in the QA welcome state", () => {
    expect(fs.existsSync(path.join(root, "assets/icons/chipmate-icon.png"))).toBe(true)
    expect(logo).toContain('props.welcome ? "chipmate-icon.png"')
    expect(messages).toContain('<ChipMateLogo class="kilo-logo" welcome />')
    expect(feedback).toContain('<ChipMateLogo class="feedback-dialog-logo" />')
  })
})
