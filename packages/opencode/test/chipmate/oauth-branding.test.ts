import { describe, expect, test } from "bun:test"
import path from "path"
import { ChipMateOauthCallbackPage } from "@opencode-ai/core/chipmate/oauth/page"

const root = path.join(__dirname, "..", "..")

describe("ChipMate OAuth branding", () => {
  test("Codex OAuth browser flow uses ChipMate branding", async () => {
    const src = await Bun.file(path.join(root, "src", "plugin", "openai", "codex.ts")).text()

    expect(src).toContain('originator: "chipmate"')
    expect(src).toContain('"User-Agent": `chipmate/${InstallationVersion}`')
    expect(src).toContain("return to ChipMate")
    expect(src).not.toContain('originator: "opencode"')
    expect(src).not.toContain("return to OpenCode")
  })

  test("core OAuth browser flow uses ChipMate branding", async () => {
    const src = await Bun.file(path.join(root, "..", "core", "src", "plugin", "provider", "openai.ts")).text()
    const pages = [
      ChipMateOauthCallbackPage.success({ provider: "ChatGPT" }),
      ChipMateOauthCallbackPage.error("Denied", { provider: "ChatGPT" }),
    ]

    expect(src).toContain('originator: "chipmate"')
    expect(src).toContain('"User-Agent": `chipmate/${InstallationVersion}`')
    expect(src).toContain("ChipMateOauthCallbackPage")
    expect(src).not.toContain('originator: "opencode"')
    for (const page of pages) {
      expect(page).toContain("· ChipMate</title>")
      expect(page).toContain('aria-label="ChipMate"')
      expect(page).toContain('viewBox="0 0 100 100"')
      expect(page).not.toContain("OpenCode")
      expect(page).not.toContain('viewBox="0 0 234 42"')
    }
  })

  test("MCP OAuth callback page uses ChipMate branding", async () => {
    const src = await Bun.file(path.join(root, "src", "mcp", "oauth-callback.ts")).text()

    expect(src).toContain("return to ChipMate")
    expect(src).not.toContain("return to OpenCode")
  })
})
