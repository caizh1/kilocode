import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("VS Code engine manifest", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))
  const build = readFileSync(join(__dirname, "../../esbuild.js"), "utf8")

  it("supports VS Code 1.93 and keeps the extension identity stable", () => {
    expect(pkg.engines.vscode).toBe("^1.93.0")
    expect(pkg.devDependencies["@types/vscode"]).toBe("1.93.0")
    expect(pkg.publisher).toBe("chipmate")
    expect(pkg.name).toBe("chipmate")
  })

  it("isolates Node navigator compatibility from browser webviews", () => {
    expect(build).toContain('navigator: "undefined"')
    expect(build).toContain('"globalThis.navigator": "undefined"')

    const host = build.slice(
      build.indexOf('entryPoints: ["src/extension.ts"]'),
      build.indexOf("// Build Agent Manager webview"),
    )
    expect(host).toContain("define: node")

    const browser = build.slice(
      build.indexOf("function createBrowserWebviewContext"),
      build.indexOf("function removeMaps"),
    )
    expect(browser).toContain("define,")
    expect(browser).not.toContain("define: node")
  })
})
