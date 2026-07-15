import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import { readQwenAutocompleteConfig, qwenAutocompleteEnabled } from "./config"
import { exportQwenAutocompleteDiagnostics, showQwenAutocompleteLogs } from "./diagnostics"
import { KiloQwenInlineCompletionProvider, QWEN_DOCUMENT_SELECTOR } from "./KiloQwenInlineCompletionProvider"
import { qwenDiagnosticSmoke } from "./smoke"
import { QwenImportDefinitionsTracker } from "./importDefinitions"
import { QwenRecentlyEditedTracker } from "./recentlyEdited"
import { QwenRecentlyOpenedTracker } from "./recentlyOpened"
import { QwenRootPathTracker } from "./rootPathContext"
import {
  autocompleteSelectionUpdating,
  onDidUpdateAutocompleteSelection,
  QWEN_DEFAULT_STATE,
} from "../autocomplete/settings"
import { autocompleteResource } from "../autocomplete/workspace"

export function registerQwenAutocompleteProvider(
  context: vscode.ExtensionContext,
  connection: KiloConnectionService,
): QwenAutocompleteRegistration {
  const reg = new QwenAutocompleteRegistration(context, connection)
  context.subscriptions.push(reg)
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.qwenAutocomplete.showLogs", showQwenAutocompleteLogs),
    vscode.commands.registerCommand(
      "kilo-code.new.qwenAutocomplete.exportDiagnostics",
      exportQwenAutocompleteDiagnostics,
    ),
    vscode.commands.registerCommand("kilo-code.new.qwenAutocomplete.smokeDiagnostics", () =>
      qwenDiagnosticSmoke(connection),
    ),
  )
  return reg
}

export class QwenAutocompleteRegistration implements vscode.Disposable {
  private readonly connection: KiloConnectionService
  private readonly origin: () => "automatic" | "explicit"
  private provider: KiloQwenInlineCompletionProvider | null = null
  private registration: vscode.Disposable | null = null
  private readonly watcher: vscode.Disposable
  private readonly selection: vscode.Disposable
  private edited = false
  private opened = false
  private imports = false
  private root = false

  constructor(context: vscode.ExtensionContext, connection: KiloConnectionService) {
    this.connection = connection
    this.origin = () => (context.globalState?.get<boolean>(QWEN_DEFAULT_STATE, false) ? "automatic" : "explicit")
    this.watcher = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("kilo.autocomplete") || event.affectsConfiguration("kilo-code.new.autocomplete")) {
        if (autocompleteSelectionUpdating()) return
        this.sync()
      }
    })
    this.selection = onDidUpdateAutocompleteSelection(() => this.sync()) ?? { dispose: () => undefined }
    this.sync()
  }

  dispose(): void {
    this.disposeProvider()
    this.watcher.dispose()
    this.selection.dispose()
  }

  private sync(): void {
    const cfg = readQwenAutocompleteConfig(autocompleteResource())
    const enabled = qwenAutocompleteEnabled(cfg)
    const edited = enabled && cfg.recentlyEditedEnabled
    const opened = enabled && cfg.recentlyOpenedEnabled
    const imports = enabled && cfg.importDefinitionsEnabled
    const root = enabled && cfg.rootPathEnabled
    if (
      enabled &&
      this.provider &&
      this.edited === edited &&
      this.opened === opened &&
      this.imports === imports &&
      this.root === root
    ) {
      return
    }
    this.disposeProvider()
    if (enabled) {
      const recent = edited ? new QwenRecentlyEditedTracker() : undefined
      const files = opened ? new QwenRecentlyOpenedTracker() : undefined
      const defs = imports ? new QwenImportDefinitionsTracker() : undefined
      const path = root ? new QwenRootPathTracker() : undefined
      this.provider = new KiloQwenInlineCompletionProvider({
        connection: this.connection,
        state: () => this.connection.getConnectionState(),
        edited: recent,
        imports: defs,
        opened: files,
        root: path,
        origin: this.origin,
      })
      this.registration = vscode.languages.registerInlineCompletionItemProvider(QWEN_DOCUMENT_SELECTOR, this.provider)
      this.edited = edited
      this.opened = opened
      this.imports = imports
      this.root = root
      return
    }
  }

  private disposeProvider(): void {
    this.registration?.dispose()
    this.registration = null
    this.provider?.dispose()
    this.provider = null
    this.edited = false
    this.opened = false
    this.imports = false
    this.root = false
  }
}
