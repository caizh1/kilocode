import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { resolveConfiguredLocale } from "../../src/services/cli-backend/i18n"

const root = path.resolve(import.meta.dir, "../..")

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), "utf-8")
}

describe("language default", () => {
  it("defaults ChipMate UI language to Simplified Chinese while keeping Auto available", () => {
    const pkg = JSON.parse(read("package.json"))
    const cfg = pkg.contributes.configuration.properties["kilo-code.new.language"]

    expect(cfg.default).toBe("zh")
    expect(cfg.enum).toContain("")
    expect(cfg.enum).toContain("zh")
  })

  it("resolves configured language before VS Code language", () => {
    expect(resolveConfiguredLocale("zh", "en")).toBe("zh")
    expect(resolveConfiguredLocale("en", "zh-CN")).toBe("en")
  })

  it("treats an empty configured language as Auto", () => {
    expect(resolveConfiguredLocale("", "ja-JP")).toBe("ja")
    expect(resolveConfiguredLocale("", "zh-TW")).toBe("zht")
  })

  it("preserves empty language override messages instead of treating them as absent", () => {
    const provider = read("src/KiloProvider.ts")
    const server = read("webview-ui/src/context/server.tsx")
    const language = read("webview-ui/src/context/language.tsx")

    expect(provider).toContain('.update("language", message.locale, vscode.ConfigurationTarget.Global)')
    expect(server).toContain('if ("languageOverride" in message)')
    expect(server).toContain("setLanguageOverride(message.locale)")
    expect(language).toContain("if (override !== undefined) setUserOverride(override ? normalizeLocale(override) : \"\")")
  })
})
