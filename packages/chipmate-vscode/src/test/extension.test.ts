import * as assert from "assert"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"

import * as vscode from "vscode"
import {
  applyCommentProposals,
  applyCommentProposalsForTargets,
  validateTargetSnapshot,
} from "../services/code-comments/apply"
import {
  CodeCommentPreviewController,
  type CodeCommentPreviewHost,
  VscodeCodeCommentPreviewHost,
} from "../services/code-comments/preview-controller"
import { resolveTargetDocument } from "../services/code-comments/target-document"
import type { FunctionTarget } from "../services/code-comments/types"

async function waitForTab(match: (tab: vscode.Tab) => boolean): Promise<vscode.Tab> {
  const find = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs).find(match)
  const current = find()
  if (current) return current
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      disposable.dispose()
      reject(new Error("等待目标标签超时"))
    }, 10_000)
    const disposable = vscode.window.tabGroups.onDidChangeTabs(() => {
      const tab = find()
      if (!tab) return
      clearTimeout(timeout)
      disposable.dispose()
      resolve(tab)
    })
  })
}

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start ChipMate/ChipMate extension smoke tests.")

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
      "chipmate.v2.settingsButtonClicked",
      "chipmate.v2.openInTab",
      "chipmate.v2.returnToSidebar",
      "chipmate.v2.documents.openArtifact",
      "chipmate.v2.documents.openArtifactFolder",
      "chipmate.v2.documents.exportDiagnostics",
      "chipmate.v2.autocomplete.generateSuggestions",
      "chipmate.v2.autocomplete.cancelSuggestions",
      "chipmate.v2.qwenAutocomplete.showLogs",
      "chipmate.v2.qwenAutocomplete.exportDiagnostics",
      "chipmate.v2.generateTerminalCommand",
      "chipmate.v2.generateCommentsForCurrentFunction",
      "chipmate.v2.generateCommentsForSelectedFunctions",
      "chipmate.v2.generateCommentsForCurrentCodeTarget",
      "chipmate.v2.generateCommentsForSelectedCodeTargets",
      "chipmate.v2.generateCommentsForCurrentFileHeader",
      "chipmate.v2.generateCommentsForCurrentFile",
      "chipmate.v2.generateCommentsForSelectedLogicBlock",
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
    assert.strictEqual(config.get("chipmate.v2.autocomplete.enabled"), false)
    assert.strictEqual(config.get("chipmate.v2.autocomplete.provider"), "")
    assert.ok(!config.has("chipmate.v2.autocomplete.qwen.endpoint"))
    assert.ok(config.has("chipmate.v2.autocomplete.qwen.model"))
    assert.ok(config.has("chipmate.v2.autocomplete.qwen.modelTimeout"))
    assert.ok(config.has("chipmate.v2.documents.wordRender.remoteEndpoint"))
    assert.strictEqual(config.get("chipmate.v2.indexing.showButtonWhenDisabled"), true)
    assert.strictEqual(config.get("chipmate.v2.chat.shiftTabCyclesVariant"), true)
    assert.strictEqual(config.get("chipmate.v2.showTokenThroughput"), true)
    assert.strictEqual(config.get("chipmate.v2.languageCommitMessage"), "sync")
  })

  test("persists every migrated settings-page preference through the real VS Code configuration API", async () => {
    const cases = [
      { section: "chipmate.v2.indexing", key: "showButtonWhenDisabled", value: false },
      { section: "chipmate.v2.chat", key: "shiftTabCyclesVariant", value: false },
      { section: "chipmate.v2", key: "showTokenThroughput", value: true },
      { section: "chipmate.v2", key: "languageCommitMessage", value: "en" },
    ] as const
    const previous = cases.map((item) => vscode.workspace.getConfiguration(item.section).inspect(item.key)?.globalValue)

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

  test("keeps native ChipMate contributions present", () => {
    const extension = vscode.extensions.getExtension("chipmate.chipmate")
    assert.ok(extension, "chipmate.chipmate extension must be discoverable")

    const contributes = extension.packageJSON.contributes
    const commandIds = new Set((contributes.commands ?? []).map((item: { command: string }) => item.command))

    for (const command of [
      "chipmate.v2.agentManagerOpen",
      "chipmate.v2.chipmateClawOpen",
      "chipmate.v2.settingsButtonClicked",
      "chipmate.v2.generateTerminalCommand",
      "chipmate.v2.documents.openArtifact",
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
      "native ChipMate sidebar webview contribution must remain present",
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

  test("keeps code tabs, dirty documents, and selections unchanged after Settings closes", async function () {
    this.timeout(20_000)
    const id = randomUUID()
    const uris = ["one", "two", "three"].map((name) =>
      vscode.Uri.file(`${tmpdir()}/chipmate-settings-${id}-${name}.ts`),
    )
    const isTargetTextTab = (tab: vscode.Tab): tab is vscode.Tab & { input: vscode.TabInputText } => {
      const input = tab.input
      return input instanceof vscode.TabInputText && uris.some((uri) => input.uri.path === uri.path)
    }
    await Promise.all(
      uris.map((uri, index) => vscode.workspace.fs.writeFile(uri, Buffer.from(`const value = ${index}\n`))),
    )

    const documents: vscode.TextDocument[] = []
    try {
      for (const [index, uri] of uris.entries()) {
        const document = await vscode.workspace.openTextDocument(uri)
        documents.push(document)
        const editor = await vscode.window.showTextDocument(document, {
          preview: false,
          viewColumn: index === 2 ? vscode.ViewColumn.Two : vscode.ViewColumn.One,
        })
        await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), `// 未保存 ${index}\n`))
      }

      const sourceEditor = await vscode.window.showTextDocument(documents[0], {
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      })
      sourceEditor.selection = new vscode.Selection(1, 6, 1, 11)
      const before = vscode.window.tabGroups.all.map((group) =>
        group.tabs.filter(isTargetTextTab).map((tab) => tab.input.uri.toString()),
      )

      await vscode.commands.executeCommand("chipmate.v2.settingsButtonClicked")
      const settings = await waitForTab(
        (tab) => tab.input instanceof vscode.TabInputWebview && tab.label === "ChipMate Settings",
      )
      await vscode.window.tabGroups.close(settings)

      const after = vscode.window.tabGroups.all.map((group) =>
        group.tabs.filter(isTargetTextTab).map((tab) => tab.input.uri.toString()),
      )
      assert.deepStrictEqual(after, before, "closing Settings must not move or reorder code tabs")
      assert.ok(
        documents.every((document) => document.isDirty),
        "closing Settings must preserve unsaved content",
      )
      assert.deepStrictEqual(
        sourceEditor.selection,
        new vscode.Selection(1, 6, 1, 11),
        "closing Settings must preserve the code selection",
      )
    } finally {
      await Promise.all(documents.map((document) => document.save()))
      const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter(isTargetTextTab)
      if (tabs.length > 0) await vscode.window.tabGroups.close(tabs)
      await Promise.all(
        uris.map((uri) => vscode.workspace.fs.delete(uri, { useTrash: false }).then(undefined, () => undefined)),
      )
    }
  })

  test("keeps a preview source tab open and restores it after the comment Diff is closed", async function () {
    this.timeout(20_000)
    const id = randomUUID()
    const sourceUri = vscode.Uri.file(`${tmpdir()}/chipmate-comment-source-${id}.c`)
    const beforeUri = vscode.Uri.file(`${tmpdir()}/chipmate-comment-before-${id}.c`)
    const afterUri = vscode.Uri.file(`${tmpdir()}/chipmate-comment-after-${id}.c`)
    const text =
      Array.from({ length: 80 }, (_, index) => `int value_${index}(void) { return ${index}; }`).join("\n") + "\n"
    const candidate = `/** 返回对应的固定值。 */\n${text}`
    await Promise.all([
      vscode.workspace.fs.writeFile(sourceUri, Buffer.from(text)),
      vscode.workspace.fs.writeFile(beforeUri, Buffer.from(text)),
      vscode.workspace.fs.writeFile(afterUri, Buffer.from(candidate)),
    ])

    let controller: CodeCommentPreviewController | undefined
    try {
      const sourceDocument = await vscode.workspace.openTextDocument(sourceUri)
      const sourceEditor = await vscode.window.showTextDocument(sourceDocument, {
        preview: true,
        viewColumn: vscode.ViewColumn.One,
      })
      const selection = new vscode.Selection(63, 4, 63, 15)
      sourceEditor.selection = selection
      sourceEditor.revealRange(new vscode.Range(60, 0, 70, 0), vscode.TextEditorRevealType.AtTop)
      const sourceTab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === sourceUri.toString())
      assert.ok(sourceTab, "source tab must be open before showing the Diff")

      const delegate = new VscodeCodeCommentPreviewHost()
      const resources = {
        before: { key: beforeUri.toString(), value: beforeUri },
        after: { key: afterUri.toString(), value: afterUri },
      }
      const host: CodeCommentPreviewHost = {
        createResource: (_previewID, side) => resources[side],
        registerProvider: () => new vscode.Disposable(() => undefined),
        registerCommand: () => new vscode.Disposable(() => undefined),
        onDidCloseDiff: (run) => delegate.onDidCloseDiff(run),
        openDiff: (original, modified, title, languageID, source) =>
          delegate.openDiff(original, modified, title, languageID, source),
        closeDiff: (original, modified) => delegate.closeDiff(original, modified),
        restoreSource: (source) => delegate.restoreSource(source),
        setPendingContext: async () => undefined,
      }
      controller = new CodeCommentPreviewController(host)
      const target: FunctionTarget = {
        uri: sourceUri.toString(),
        filePath: sourceUri.fsPath,
        relativePath: "source.c",
        workspacePath: tmpdir(),
        languageId: "c",
        documentVersion: sourceDocument.version,
        documentText: text,
        functionSource: text.trimEnd(),
        functionHash: "preview-source-test",
        startIndex: 0,
        endIndex: text.trimEnd().length,
        startLine: 0,
        endLine: 79,
        contextBefore: "",
        contextAfter: "",
        functionHeaderStyle: "docBlock",
        existingComments: [],
        complexity: {
          lineCount: 80,
          controlRegionCount: 0,
          existingCoveredRegionCount: 0,
          minimumInlineComments: 0,
          controlRegions: [],
        },
        anchors: [{ line: 0, kind: "function", targetLineText: text.split("\n", 1)[0]!, indent: "" }],
        eol: "\n",
      }
      const sourceView = {
        uri: sourceUri.toString(),
        viewColumn: sourceEditor.viewColumn,
        preview: sourceTab.isPreview,
        selections: [...sourceEditor.selections],
        visibleRange: sourceEditor.visibleRanges[0],
      }
      const confirmation = controller.confirm(target, candidate, 1, sourceView)

      const diffTab = await waitForTab(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.original.toString() === beforeUri.toString() &&
          tab.input.modified.toString() === afterUri.toString(),
      )
      assert.strictEqual(diffTab.isPreview, false, "comment Diff must be pinned")
      assert.ok(
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === sourceUri.toString()),
        "opening the Diff must not replace the source preview tab",
      )

      await vscode.window.tabGroups.close(diffTab)
      assert.strictEqual(await confirmation, false)
      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), sourceUri.toString())
      assert.deepStrictEqual(vscode.window.activeTextEditor?.selection, selection)
      assert.strictEqual(sourceDocument.getText(), text)
    } finally {
      controller?.dispose()
      for (const uri of [sourceUri, beforeUri, afterUri]) {
        const tab = vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .find(
            (candidate) =>
              candidate.input instanceof vscode.TabInputText && candidate.input.uri.toString() === uri.toString(),
          )
        if (tab) await vscode.window.tabGroups.close(tab)
        await vscode.workspace.fs.delete(uri)
      }
    }
  })

  test("reopens an unloaded source document and accepts an identical snapshot with a new version", async () => {
    const uri = vscode.Uri.file(`${tmpdir()}/chipmate-code-comment-${randomUUID()}.c`)
    const text = "int value(void) { return 1; }\n"
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text))

    try {
      const target: FunctionTarget = {
        uri: uri.toString(),
        filePath: uri.fsPath,
        relativePath: "main.c",
        workspacePath: tmpdir(),
        languageId: "c",
        documentVersion: 99,
        documentText: text,
        functionSource: text.trimEnd(),
        functionHash: "unused-when-document-text-matches",
        startIndex: 0,
        endIndex: text.trimEnd().length,
        startLine: 0,
        endLine: 0,
        contextBefore: "",
        contextAfter: "",
        functionHeaderStyle: "docBlock",
        existingComments: [],
        complexity: {
          lineCount: 1,
          controlRegionCount: 0,
          existingCoveredRegionCount: 0,
          minimumInlineComments: 0,
          controlRegions: [],
        },
        anchors: [{ line: 0, kind: "function", targetLineText: text.trimEnd(), indent: "" }],
        eol: "\n",
      }
      const resolution = await resolveTargetDocument(target, {
        textDocuments: [],
        openTextDocument: vscode.workspace.openTextDocument,
      })

      assert.strictEqual(resolution.status, "ready")
      if (resolution.status === "ready") {
        assert.strictEqual(resolution.reopened, true)
        assert.strictEqual(resolution.document.getText(), text)
        assert.deepStrictEqual(validateTargetSnapshot(target, resolution.document), [])
        await vscode.window.showTextDocument(resolution.document, { preview: false })
        const applied = await applyCommentProposals(resolution.document, target, [
          {
            kind: "functionHeader",
            operation: "insert",
            insertBeforeLine: 0,
            indent: "",
            commentText: "/** 返回固定值。 */",
            anchor: { targetLineText: text.trimEnd() },
          },
        ])
        assert.strictEqual(applied, true)
        assert.strictEqual(resolution.document.getText(), `/** 返回固定值。 */\n${text}`)
        await vscode.commands.executeCommand("undo")
        assert.strictEqual(resolution.document.getText(), text)
      }
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
      await vscode.workspace.fs.delete(uri)
    }
  })

  test("applies batch comments atomically and reverts them with one undo", async () => {
    const uri = vscode.Uri.file(`${tmpdir()}/chipmate-code-comment-batch-${randomUUID()}.c`)
    const first = "int first(void) { return 1; }"
    const second = "int second(void) { return 2; }"
    const text = `${first}\n${second}\n`
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text))

    try {
      const document = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(document, { preview: false })
      const target = (line: number, source: string): FunctionTarget => ({
        uri: uri.toString(),
        filePath: uri.fsPath,
        relativePath: "batch.c",
        workspacePath: tmpdir(),
        languageId: "c",
        documentVersion: document.version,
        documentText: text,
        functionSource: source,
        functionHash: "unused-in-application-test",
        startIndex: line === 0 ? 0 : first.length + 1,
        endIndex: line === 0 ? first.length : first.length + 1 + second.length,
        startLine: line,
        endLine: line,
        contextBefore: "",
        contextAfter: "",
        functionHeaderStyle: "docBlock",
        existingComments: [],
        complexity: {
          lineCount: 1,
          controlRegionCount: 0,
          existingCoveredRegionCount: 0,
          minimumInlineComments: 0,
          controlRegions: [],
        },
        anchors: [{ line, kind: "function", targetLineText: source, indent: "" }],
        eol: "\n",
      })
      const firstTarget = target(0, first)
      const secondTarget = target(1, second)
      const applied = await applyCommentProposalsForTargets(document, [
        {
          target: firstTarget,
          proposals: [
            {
              kind: "functionHeader",
              operation: "insert",
              insertBeforeLine: 0,
              indent: "",
              commentText: "/** 返回第一个固定值。 */",
              anchor: { targetLineText: first },
            },
          ],
        },
        {
          target: secondTarget,
          proposals: [
            {
              kind: "functionHeader",
              operation: "insert",
              insertBeforeLine: 1,
              indent: "",
              commentText: "/** 返回第二个固定值。 */",
              anchor: { targetLineText: second },
            },
          ],
        },
      ])

      assert.strictEqual(applied, true)
      assert.strictEqual(
        document.getText(),
        `/** 返回第一个固定值。 */\n${first}\n/** 返回第二个固定值。 */\n${second}\n`,
      )
      await vscode.commands.executeCommand("undo")
      assert.strictEqual(document.getText(), text)
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
      await vscode.workspace.fs.delete(uri)
    }
  })
})
