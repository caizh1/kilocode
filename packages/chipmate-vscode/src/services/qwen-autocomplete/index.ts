import * as vscode from "vscode"
import type { ChipMateConnectionService } from "../cli-backend"
import { readQwenAutocompleteConfig, qwenAutocompleteEnabled } from "./config"
import { exportQwenAutocompleteDiagnostics, showQwenAutocompleteLogs } from "./diagnostics"
import { ChipMateQwenInlineCompletionProvider, QWEN_DOCUMENT_SELECTOR } from "./ChipMateQwenInlineCompletionProvider"
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
import type { Coexistence } from "../../chipmate/coexistence"

export function registerQwenAutocompleteProvider(
  context: vscode.ExtensionContext,
  connection: ChipMateConnectionService,
  gate?: Coexistence,
): QwenAutocompleteRegistration {
  const reg = new QwenAutocompleteRegistration(context, connection, gate)
  context.subscriptions.push(reg)
  context.subscriptions.push(
    vscode.commands.registerCommand("chipmate.v2.qwenAutocomplete.showLogs", showQwenAutocompleteLogs),
    vscode.commands.registerCommand(
      "chipmate.v2.qwenAutocomplete.exportDiagnostics",
      exportQwenAutocompleteDiagnostics,
    ),
    vscode.commands.registerCommand("chipmate.v2.qwenAutocomplete.smokeDiagnostics", () =>
      qwenDiagnosticSmoke(connection),
    ),
  )
  return reg
}

export class QwenAutocompleteRegistration implements vscode.Disposable {
  private readonly connection: ChipMateConnectionService
  private readonly origin: () => "automatic" | "explicit"
  private provider: ChipMateQwenInlineCompletionProvider | null = null
  private registration: vscode.Disposable | null = null
  private readonly watcher: vscode.Disposable
  private readonly selection: vscode.Disposable
  private readonly coexistence: vscode.Disposable
  private readonly gate: Pick<Coexistence, "autocomplete">
  private edited = false
  private opened = false
  private imports = false
  private root = false

  constructor(context: vscode.ExtensionContext, connection: ChipMateConnectionService, gate?: Coexistence) {
    this.connection = connection
    this.gate = gate ?? { autocomplete: () => true }
    this.origin = () => (context.globalState?.get<boolean>(QWEN_DEFAULT_STATE, false) ? "automatic" : "explicit")
    this.watcher = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("chipmate.v2.autocomplete")) {
        if (autocompleteSelectionUpdating()) return
        this.sync()
      }
    })
    this.selection = onDidUpdateAutocompleteSelection(() => this.sync()) ?? { dispose: () => undefined }
    this.coexistence = gate?.onDidChangeAutocomplete(() => this.sync()) ?? { dispose: () => undefined }
    this.sync()
  }

  dispose(): void {
    this.disposeProvider()
    this.watcher.dispose()
    this.selection.dispose()
    this.coexistence.dispose()
  }

  private sync(): void {
    if (!this.gate.autocomplete()) {
      this.disposeProvider()
      return
    }
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
      this.provider = new ChipMateQwenInlineCompletionProvider({
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
