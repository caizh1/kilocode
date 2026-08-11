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
      "chipmate.v2.plusButtonClicked",
      "chipmate.v2.agentManagerOpen",
      "chipmate.v2.sidebarTitle.agentTerminalOpen",
      "chipmate.v2.settingsButtonClicked",
      "chipmate.v2.openInTab",
      "chipmate.v2.documents.openArtifact",
      "chipmate.v2.documents.openArtifactFolder",
      "chipmate.v2.documents.exportDiagnostics",
      "chipmate.v2.agentTerminal.open",
      "chipmate.v2.autocomplete.generateSuggestions",
      "chipmate.v2.autocomplete.cancelSuggestions",
      "chipmate.v2.qwenAutocomplete.showLogs",
      "chipmate.v2.qwenAutocomplete.exportDiagnostics",
      "chipmate.v2.generateTerminalCommand",
      "chipmate.v2.generateCommentsForCurrentFunction",
      "chipmate.v2.generateCommentsForSelectedFunctions",
      "chipmate.v2.applyCodeCommentPreview",
      "chipmate.v2.discardCodeCommentPreview",
      "chipmate.v2.terminalAddToContext",
      "chipmate.v2.terminalFixCommand",
      "chipmate.v2.terminalExplainCommand",
    ]) {
      assert.ok(commands.includes(command), `${command} must be registered in the VS Code command registry`)
    }
  })

  test("keeps migrated settings sidecar-scoped and qwen autocomplete settings visible", () => {
    const config = vscode.workspace.getConfiguration()

    assert.strictEqual(config.get("chipmate.v2.documents.artifacts.root"), ".chipmate-v2/artifacts")
    assert.strictEqual(config.get("chipmate.v2.documents.tools.enabled"), true)
    assert.ok(!config.has("chipmate.v2.agentTerminal.enabled"))
    assert.strictEqual(config.get("chipmate.v2.autocomplete.enabled"), false)
    assert.strictEqual(config.get("chipmate.v2.autocomplete.provider"), "")
    assert.ok(!config.has("chipmate.v2.autocomplete.qwen.endpoint"))
    assert.ok(config.has("chipmate.v2.autocomplete.qwen.model"))
    assert.ok(config.has("chipmate.v2.autocomplete.qwen.modelTimeout"))
    assert.ok(config.has("chipmate.v2.documents.wordRender.remoteEndpoint"))
    assert.strictEqual(config.get("chipmate.v2.indexing.showButtonWhenDisabled"), true)
    assert.strictEqual(config.get("chipmate.v2.chat.shiftTabCyclesVariant"), true)
    assert.strictEqual(config.get("chipmate.v2.showTokenThroughput"), false)
    assert.strictEqual(config.get("chipmate.v2.languageCommitMessage"), "sync")
  })

  test("persists every migrated settings-page preference through the real VS Code configuration API", async () => {
    const cases = [
      { section: "chipmate.v2.indexing", key: "showButtonWhenDisabled", value: false },
      { section: "chipmate.v2.chat", key: "shiftTabCyclesVariant", value: false },
      { section: "chipmate.v2", key: "showTokenThroughput", value: true },
      { section: "chipmate.v2", key: "languageCommitMessage", value: "en" },
    ] as const
    const previous = cases.map((item) =>
      vscode.workspace.getConfiguration(item.section).inspect(item.key)?.globalValue,
    )

    try {
      for (const item of cases) {
        const config = vscode.workspace.getConfiguration(item.section)
        await config.update(item.key, item.value, vscode.ConfigurationTarget.Global)
        assert.strictEqual(config.get(item.key), item.value, `${item.section}.${item.key} must persist`)
      }
    } finally {
      await Promise.all(
        cases.map((item, index) =>
          vscode.workspace
            .getConfiguration(item.section)
            .update(item.key, previous[index], vscode.ConfigurationTarget.Global),
        ),
      )
    }
  })

  test("keeps native Kilo contributions present while adding the standalone Agent Console command", () => {
    const extension = vscode.extensions.getExtension("chipmate.chipmate")
    assert.ok(extension, "chipmate.chipmate extension must be discoverable")

    const contributes = extension.packageJSON.contributes
    const commandIds = new Set((contributes.commands ?? []).map((item: { command: string }) => item.command))

    for (const command of [
      "chipmate.v2.agentManagerOpen",
      "chipmate.v2.kiloClawOpen",
      "chipmate.v2.settingsButtonClicked",
      "chipmate.v2.generateTerminalCommand",
      "chipmate.v2.documents.openArtifact",
      "chipmate.v2.agentTerminal.open",
      "chipmate.v2.qwenAutocomplete.exportDiagnostics",
      "chipmate.v2.applyCodeCommentPreview",
      "chipmate.v2.discardCodeCommentPreview",
    ]) {
      assert.ok(commandIds.has(command), `${command} must remain contributed`)
    }

    assert.ok(!contributes.terminal?.profiles, "legacy terminal profile must not be contributed")

    const editorTitle = contributes.menus?.["editor/title"] ?? []
    for (const command of ["chipmate.v2.applyCodeCommentPreview", "chipmate.v2.discardCodeCommentPreview"]) {
      const item = editorTitle.find((entry: { command?: string }) => entry.command === command)
      assert.ok(item, `${command} must be contributed to the editor title toolbar`)
      assert.match(item.when, /chipmate\.v2\.codeComments\.previewPending/)
      assert.match(item.when, /resourceScheme == chipmate-code-comment-preview/)
    }

    const activityViews = contributes.views?.["chipmate-v2-activitybar"] ?? []
    assert.ok(
      activityViews.some((view: { id?: string }) => view.id === "chipmate.v2.SidebarProvider"),
      "native Kilo sidebar webview contribution must remain present",
    )

    const properties = contributes.configuration?.properties ?? {}
    for (const key of [
      "chipmate.v2.documents.artifacts.root",
      "chipmate.v2.documents.tools.enabled",
      "chipmate.v2.autocomplete.enabled",
      "chipmate.v2.autocomplete.provider",
      "chipmate.v2.autocomplete.qwen.model",
      "chipmate.v2.indexing.showButtonWhenDisabled",
      "chipmate.v2.chat.shiftTabCyclesVariant",
      "chipmate.v2.showTokenThroughput",
      "chipmate.v2.languageCommitMessage",
    ]) {
      assert.ok(Object.prototype.hasOwnProperty.call(properties, key), `${key} must remain contributed`)
    }
  })
})
