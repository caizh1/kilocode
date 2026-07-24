import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("update-check manifest contributions", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))
  const props = pkg.contributes.configuration.properties
  const commands = pkg.contributes.commands.map((cmd: { command: string; title: string }) => cmd)

  it("declares the manual check command", () => {
    expect(commands).toContainEqual({
      command: "chipmate.v2.checkForUpdates",
      title: "ChipMate: Check for Updates",
    })
  })

  it("declares internal VSIX update-check settings", () => {
    expect(props["chipmate.v2.updateCheck.enabled"]).toMatchObject({ type: "boolean", default: true })
    expect(props["chipmate.v2.updateCheck.autoInstall"]).toMatchObject({ type: "boolean", default: true })
    expect(props["chipmate.v2.updateCheck.baseUrl"]).toMatchObject({
      type: "string",
      default: "",
      deprecationMessage: expect.any(String),
    })
    expect(props["chipmate.v2.updateCheck.manifestFile"]).toMatchObject({
      type: "string",
      default: "latest.json",
      deprecationMessage: expect.any(String),
    })
    expect(props["chipmate.v2.updateCheck.checkOnStartup"]).toMatchObject({ type: "boolean", default: true })
    expect(props["chipmate.v2.updateCheck.intervalHours"]).toMatchObject({ type: "number", default: 24 })
    expect(props["chipmate.v2.updateCheck.timeoutMs"]).toMatchObject({ type: "number", default: 30000 })
    expect(props["chipmate.v2.updateCheck.downloadTimeoutMs"]).toMatchObject({
      type: "number",
      default: 900000,
    })
    expect(props["chipmate.v2.updateCheck.codeCliPath"]).toMatchObject({ type: "string", default: "code" })
    expect(props["chipmate.v2.updateCheck.maxDownloadBytes"]).toMatchObject({ type: "number", default: 268435456 })
  })
})
