import { describe, expect, it } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { buildSettingPath } from "../../src/chipmate-provider-utils"

const root = join(__dirname, "../..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const props = pkg.contributes.configuration.properties as Record<string, unknown>
const keys = new Set<string>()

for (const file of readdirSync(join(root, "webview-ui/src"), { recursive: true, encoding: "utf8" })) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) continue
  const source = readFileSync(join(root, "webview-ui/src", file), "utf8")
  for (const match of source.matchAll(/updateSetting\(\s*"([^"]+)"/g)) keys.add(match[1]!)
}

for (const key of [
  "autocomplete.enableAutoTrigger",
  "autocomplete.enableSmartInlineTaskKeybinding",
  "autocomplete.enableChatAutocomplete",
  "browserAutomation.enabled",
  "browserAutomation.useSystemChrome",
  "browserAutomation.headless",
  "chipmateServer.baseUrl",
  "updateCheck.autoDownload",
  "attention.enabled",
  "attention.sound",
  "claudeCodeCompat",
  "fontSize",
  "showTaskTimeline",
]) {
  keys.add(key)
}

describe("settings configuration manifest", () => {
  it("registers every VS Code setting that the webview can save", () => {
    const missing = Array.from(keys)
      .map((key) => {
        const path = buildSettingPath(key)
        return `chipmate.v2${path.section ? `.${path.section}` : ""}.${path.leaf}`
      })
      .filter((key) => !(key in props))

    expect(missing).toEqual([])
  })

  it("declares the migrated ChipMate settings with matching defaults", () => {
    expect(props["chipmate.v2.indexing.showButtonWhenDisabled"]).toMatchObject({
      type: "boolean",
      default: true,
      scope: "application",
    })
    expect(props["chipmate.v2.chat.shiftTabCyclesVariant"]).toMatchObject({ type: "boolean", default: true })
    expect(props["chipmate.v2.showTokenThroughput"]).toMatchObject({ type: "boolean", default: false })
    expect(props["chipmate.v2.languageCommitMessage"]).toMatchObject({ type: "string", default: "sync" })
  })

  it("writes imported legacy preferences into registered ChipMate namespaces", () => {
    const source = readFileSync(join(root, "src/legacy-migration/migration-service.ts"), "utf8")

    expect(source).not.toContain('getConfiguration("chipmate-code.new')
    expect(source).toContain('getConfiguration("chipmate.v2.autocomplete")')
    expect(source).toContain('getConfiguration("chipmate.v2")')
  })
})
