import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { dict as uiEn } from "../../../ui/src/i18n/en"
import { dict as uiZh } from "../../../ui/src/i18n/zh"
import { dict as kiloEn } from "../../../kilo-i18n/src/en"
import { dict as kiloZh } from "../../../kilo-i18n/src/zh"
import { dict as hostEn } from "../../src/services/i18n/en"
import { dict as hostZh } from "../../src/services/i18n/zh"
import { dict as cliEn } from "../../src/services/cli-backend/i18n/en"
import { dict as cliZh } from "../../src/services/cli-backend/i18n/zh"
import { dict as appEn } from "../../webview-ui/src/i18n/en"
import { dict as appZh } from "../../webview-ui/src/i18n/zh"
import { dict as amEn } from "../../webview-ui/agent-manager/i18n/en"
import { dict as amZh } from "../../webview-ui/agent-manager/i18n/zh"
import { dict as clawEn } from "../../webview-ui/kiloclaw/i18n/en"
import { dict as clawZh } from "../../webview-ui/kiloclaw/i18n/zh"

const root = path.resolve(import.meta.dir, "../..")
const brand = /\bKilo(?: Code| Gateway| Pass| Remote| Go|Claw)?\b/

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), "utf8")
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
  it("removes Kilo branding from the effective English and Simplified Chinese dictionaries", () => {
    const en = { ...appEn, ...uiEn, ...kiloEn, ...amEn }
    const zh = { ...en, ...appZh, ...uiZh, ...kiloZh, ...amEn, ...amZh }

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
      expect.objectContaining({ command: "chipmate.v2.kiloClawOpen", title: "ChipMateClaw" }),
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
        '{ value: "kilo", label: "ChipMate" }',
        '{ value: "kilo", label: "Kilo" }',
      ],
      ["webview-ui/src/components/profile/ProfileView.tsx", "ChipMate Pass", ">Kilo Pass<"],
      [
        "webview-ui/src/hooks/useSlashCommand.ts",
        'description: "Open ChipMateClaw chat"',
        'description: "Open KiloClaw chat"',
      ],
      ["src/kiloclaw/KiloClawProvider.ts", '"ChipMateClaw"', ', "KiloClaw",'],
      ["src/services/RemoteStatusService.ts", "ChipMate Remote", "$(radio-tower) Kilo Remote"],
      ["src/services/autocomplete/AutocompleteStatusBar.ts", '"ChipMate Gateway"', '= "Kilo Gateway"'],
      ["src/services/marketplace/notify.ts", "ChipMate found", "`Kilo found"],
      ["src/kilo-provider/memory.ts", "# ChipMate Memory", '"# Kilo Memory"'],
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

  it("preserves compatibility identifiers, paths, commands, and coexistence messaging", () => {
    const pkg = JSON.parse(read("package.json"))
    const commands = pkg.contributes.commands as Array<{ command: string }>

    expect(appEn["settings.config.source.homeKilo"]).toBe("Home .kilo config")
    expect(appEn["settings.config.source.projectKilocode"]).toBe("Legacy .kilocode config")
    expect(appEn["session.cloud.import.placeholder"]).toContain("kilo import")
    expect(commands.some((item) => item.command === "chipmate.v2.kiloClawOpen")).toBe(true)
    expect(read("src/chipmate/coexistence.ts")).toContain("ChipMate detected Kilo Code.")
    expect(read("src/kiloclaw/KiloClawProvider.ts")).toContain('viewType = "chipmate.v2.KiloClawPanel"')
  })
})
