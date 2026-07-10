import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("VS Code engine manifest", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))

  it("supports VS Code 1.93 and keeps the extension identity stable", () => {
    expect(pkg.engines.vscode).toBe("^1.93.0")
    expect(pkg.devDependencies["@types/vscode"]).toBe("1.93.0")
    expect(pkg.publisher).toBe("chipmate")
    expect(pkg.name).toBe("chipmate")
  })
})
