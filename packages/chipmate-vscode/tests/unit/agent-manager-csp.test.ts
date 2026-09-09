import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const HOST_FILE = path.join(ROOT, "src/agent-manager/vscode-host.ts")

describe("Agent Manager CSP", () => {
  it("allows the bundled DeepSeek Harness client to evaluate Cordis expressions", () => {
    const source = fs.readFileSync(HOST_FILE, "utf-8")
    const start = source.indexOf("panel.webview.html = buildWebviewHtml")
    const end = source.indexOf("const provider = new ChipMateProvider", start)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(source.slice(start, end)).toContain("allowUnsafeEval: true")
  })
})
