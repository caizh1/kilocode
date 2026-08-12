import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { dict as uiEn } from "../../../ui/src/i18n/en"
import { dict as uiZh } from "../../../ui/src/i18n/zh"
import { dict as chipmateEn } from "../../../chipmate-i18n/src/en"
import { dict as chipmateZh } from "../../../chipmate-i18n/src/zh"
import { dict as hostEn } from "../../src/services/i18n/en"
import { dict as hostZh } from "../../src/services/i18n/zh"
import { dict as cliEn } from "../../src/services/cli-backend/i18n/en"
import { dict as cliZh } from "../../src/services/cli-backend/i18n/zh"
import { dict as appEn } from "../../webview-ui/src/i18n/en"
import { dict as appZh } from "../../webview-ui/src/i18n/zh"
import { dict as amEn } from "../../webview-ui/agent-manager/i18n/en"
import { dict as amZh } from "../../webview-ui/agent-manager/i18n/zh"
import { dict as clawEn } from "../../webview-ui/chipmateclaw/i18n/en"
import { dict as clawZh } from "../../webview-ui/chipmateclaw/i18n/zh"

const root = path.resolve(import.meta.dir, "../..")
const brand = /\bKilo(?: Code| Gateway| Pass| Remote| Go|Claw)?\b/

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), "utf8")
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return ["dist", "node_modules", "out"].includes(entry.name) ? [] : sourceFiles(file)
    return /\.(?:cjs|css|html|js|json|mjs|ts|tsx)$/.test(entry.name) ? [file] : []
  })
}

function text(dict: Record<string, string>): string {
  return Object.values(dict).join("\n")
}

const labels = new Set([
  "category",
  "description",
  "displayName",
  "enumDescriptions",
  "markdownDescription",
  "name",
  "shortDescription",
  "title",
])

function manifest(value: unknown, key = ""): string[] {
  if (typeof value === "string") return labels.has(key) ? [value] : []
  if (Array.isArray(value)) return value.flatMap((item) => manifest(item, key))
  if (!value || typeof value !== "object") return []
  return Object.entries(value).flatMap(([name, item]) => manifest(item, name))
}

describe("internal ChipMate branding", () => {
  it("removes legacy branding from the effective English and Simplified Chinese dictionaries", () => {
    const en = { ...appEn, ...uiEn, ...chipmateEn, ...amEn }
    const zh = { ...en, ...appZh, ...uiZh, ...chipmateZh, ...amEn, ...amZh }

    for (const dict of [en, zh, hostEn, hostZh, cliEn, cliZh, clawEn, { ...clawEn, ...clawZh }]) {
      expect(text(dict)).not.toMatch(brand)
    }

    expect(zh["settings.models.hidePromptTraining.description"]).toBe(
      "隐藏提供商可能会使用您的提示词进行训练的 ChipMate Gateway 模型。",
    )
    expect(en["dialog.usageExceeded.freeTier.description"]).toContain("ChipMate Go")
    expect(zh["dialog.usageExceeded.freeTier.description"]).toContain("ChipMate Go")
  })

  it("uses ChipMate labels on hardcoded extension surfaces", () => {
    const pkg = JSON.parse(read("package.json"))
    const commands = pkg.contributes.commands as Array<{ command: string; title: string }>

    expect(manifest(pkg).join("\n")).not.toMatch(brand)
    expect(commands).toContainEqual(
      expect.objectContaining({ command: "chipmate.v2.chipmateClawOpen", title: "ChipMateClaw" }),
    )
    expect(commands).toContainEqual(
      expect.objectContaining({ command: "chipmate.v2.checkForUpdates", title: "ChipMate: Check for Updates" }),
    )

    const surfaces = [
      [
        "webview-ui/src/components/settings/ProvidersTab.tsx",
        ">\n              ChipMate Gateway\n",
        ">\n              Kilo Gateway\n",
      ],
      [
        "webview-ui/src/components/settings/IndexingTab.tsx",
        '{ value: "chipmate", label: "ChipMate" }',
        '{ value: "kilo", label: "Kilo" }',
      ],
      ["webview-ui/src/components/profile/ProfileView.tsx", "ChipMate Pass", ">Kilo Pass<"],
      [
        "webview-ui/src/hooks/useSlashCommand.ts",
        'description: "Open ChipMateClaw chat"',
        'description: "Open KiloClaw chat"',
      ],
      ["src/chipmateclaw/ChipMateClawProvider.ts", '"ChipMateClaw"', ', "KiloClaw",'],
      ["src/services/RemoteStatusService.ts", "ChipMate Remote", "$(radio-tower) Kilo Remote"],
      ["src/services/autocomplete/AutocompleteStatusBar.ts", '"ChipMate Gateway"', '= "Kilo Gateway"'],
      ["src/services/marketplace/notify.ts", "ChipMate found", "`Kilo found"],
      ["src/chipmate-provider/memory.ts", "# ChipMate Memory", '"# Kilo Memory"'],
      [
        "src/agent-manager/setup-script-template.ts",
        "# ChipMate Worktree Setup Script",
        "# Kilo Code Worktree Setup Script",
      ],
    ] as const

    for (const [file, expected, forbidden] of surfaces) {
      const source = read(file)
      expect(source).toContain(expected)
      expect(source).not.toContain(forbidden)
    }
  })

  it("preserves current compatibility identifiers, paths, and commands", () => {
    const pkg = JSON.parse(read("package.json"))
    const commands = pkg.contributes.commands as Array<{ command: string }>

    expect(appEn["settings.config.source.homeChipMate"]).toBe("Home .chipmate config")
    expect(appEn["settings.config.source.projectChipMate"]).toBe("Project .chipmate config")
    expect(appEn["session.cloud.import.placeholder"]).toContain("chipmate import")
    expect(commands.some((item) => item.command === "chipmate.v2.chipmateClawOpen")).toBe(true)
    expect(read("src/chipmate/coexistence.ts")).not.toContain("detected")
    expect(read("src/chipmateclaw/ChipMateClawProvider.ts")).toContain('viewType = "chipmate.v2.ChipMateClawPanel"')
  })

  it("isolates every legacy product literal to compatibility modules", () => {
    const compatibility = [path.join("src", "legacy-migration"), path.join("src", "migration")]
    const files = ["package.json", ...sourceFiles("src"), ...sourceFiles("webview-ui")].filter(
      (file) => !compatibility.some((directory) => file === directory || file.startsWith(`${directory}${path.sep}`)),
    )
    const leaks = files.filter((file) => /\bkilo(?:code)?\b/i.test(read(file)))

    expect(leaks).toEqual([])
  })
})
