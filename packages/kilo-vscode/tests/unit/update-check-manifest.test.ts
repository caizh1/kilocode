import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("update-check manifest contributions", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))
  const props = pkg.contributes.configuration.properties
  const commands = pkg.contributes.commands.map((cmd: { command: string; title: string }) => cmd)

  it("declares the manual check command", () => {
    expect(commands).toContainEqual({
      command: "kilo-code.new.checkForUpdates",
      title: "Kilo: Check for Updates",
    })
  })

  it("declares internal VSIX update-check settings", () => {
    expect(props["kilo.updateCheck.enabled"]).toMatchObject({ type: "boolean", default: true })
    expect(props["kilo.updateCheck.autoInstall"]).toMatchObject({ type: "boolean", default: true })
    expect(props["kilo.updateCheck.baseUrl"]).toMatchObject({
      type: "string",
      default: "",
      deprecationMessage: expect.any(String),
    })
    expect(props["kilo.updateCheck.manifestFile"]).toMatchObject({
      type: "string",
      default: "latest.json",
      deprecationMessage: expect.any(String),
    })
    expect(props["kilo.updateCheck.checkOnStartup"]).toMatchObject({ type: "boolean", default: true })
    expect(props["kilo.updateCheck.intervalHours"]).toMatchObject({ type: "number", default: 24 })
    expect(props["kilo.updateCheck.timeoutMs"]).toMatchObject({ type: "number", default: 10000 })
    expect(props["kilo.updateCheck.codeCliPath"]).toMatchObject({ type: "string", default: "code" })
    expect(props["kilo.updateCheck.maxDownloadBytes"]).toMatchObject({ type: "number", default: 209715200 })
  })
})
