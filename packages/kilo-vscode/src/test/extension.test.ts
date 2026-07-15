import * as assert from "assert"

import * as vscode from "vscode"

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start ChipMate/Kilo extension smoke tests.")

  test("activates the extension and exposes migrated sidecar commands", async function () {
    this.timeout(20_000)

    const extension = vscode.extensions.getExtension("chipmate.chipmate")
    assert.ok(extension, "chipmate.chipmate extension must be discoverable in the VS Code extension host")

    await extension.activate()
    assert.strictEqual(extension.isActive, true, "chipmate.chipmate extension must activate without throwing")

    const commands = await vscode.commands.getCommands(true)
    for (const command of [
      "kilo-code.new.plusButtonClicked",
      "kilo-code.new.agentManagerOpen",
      "kilo-code.new.settingsButtonClicked",
      "kilo-code.new.documents.openArtifact",
      "kilo-code.new.documents.openArtifactFolder",
      "kilo-code.new.documents.exportDiagnostics",
      "kilo-code.new.agentTerminal.open",
      "kilo-code.new.autocomplete.generateSuggestions",
      "kilo-code.new.autocomplete.cancelSuggestions",
      "kilo-code.new.qwenAutocomplete.showLogs",
      "kilo-code.new.qwenAutocomplete.exportDiagnostics",
      "kilo-code.new.generateTerminalCommand",
      "kilo-code.new.terminalAddToContext",
      "kilo-code.new.terminalFixCommand",
      "kilo-code.new.terminalExplainCommand",
    ]) {
      assert.ok(commands.includes(command), `${command} must be registered in the VS Code command registry`)
    }
  })

  test("keeps migrated settings sidecar-scoped and qwen autocomplete settings visible", () => {
    const config = vscode.workspace.getConfiguration()

    assert.strictEqual(config.get("kilo.documents.artifacts.root"), ".kilo/artifacts")
    assert.strictEqual(config.get("kilo.documents.tools.enabled"), true)
    assert.strictEqual(config.get("kilo.agentTerminal.enabled"), false)
    assert.strictEqual(config.get("kilo.autocomplete.enabled"), false)
    assert.strictEqual(config.get("kilo.autocomplete.provider"), "none")
    assert.ok(!config.has("kilo.autocomplete.qwen.endpoint"))
    assert.ok(config.has("kilo.autocomplete.qwen.model"))
    assert.ok(config.has("kilo.autocomplete.qwen.modelTimeout"))
    assert.ok(config.has("kilo.documents.wordRender.remoteEndpoint"))
  })

  test("keeps native Kilo contributions present while adding sidecar document and Agent Terminal contributions", () => {
    const extension = vscode.extensions.getExtension("chipmate.chipmate")
    assert.ok(extension, "chipmate.chipmate extension must be discoverable")

    const contributes = extension.packageJSON.contributes
    const commandIds = new Set((contributes.commands ?? []).map((item: { command: string }) => item.command))

    for (const command of [
      "kilo-code.new.agentManagerOpen",
      "kilo-code.new.kiloClawOpen",
      "kilo-code.new.settingsButtonClicked",
      "kilo-code.new.generateTerminalCommand",
      "kilo-code.new.documents.openArtifact",
      "kilo-code.new.agentTerminal.open",
      "kilo-code.new.qwenAutocomplete.exportDiagnostics",
    ]) {
      assert.ok(commandIds.has(command), `${command} must remain contributed`)
    }

    const profiles = contributes.terminal?.profiles ?? []
    assert.ok(
      profiles.some((profile: { id?: string }) => profile.id === "kilo.agentTerminal"),
      "kilo.agentTerminal profile must be contributed as an additive terminal profile",
    )

    const activityViews = contributes.views?.["kilo-code-ActivityBar"] ?? []
    assert.ok(
      activityViews.some((view: { id?: string }) => view.id === "kilo-code.SidebarProvider"),
      "native Kilo sidebar webview contribution must remain present",
    )

    const properties = contributes.configuration?.properties ?? {}
    for (const key of [
      "kilo.documents.artifacts.root",
      "kilo.documents.tools.enabled",
      "kilo.agentTerminal.enabled",
      "kilo.autocomplete.enabled",
      "kilo.autocomplete.provider",
      "kilo.autocomplete.qwen.model",
    ]) {
      assert.ok(Object.prototype.hasOwnProperty.call(properties, key), `${key} must remain contributed`)
    }
  })
})
