import * as vscode from "vscode"
import { readQwenAutocompleteConfig, qwenAutocompleteEnabled } from "./config"
import { exportQwenAutocompleteDiagnostics, showQwenAutocompleteLogs } from "./diagnostics"
import { KiloQwenInlineCompletionProvider, QWEN_DOCUMENT_SELECTOR } from "./KiloQwenInlineCompletionProvider"
import { QwenRecentlyEditedTracker } from "./recentlyEdited"

export function registerQwenAutocompleteProvider(context: vscode.ExtensionContext): vscode.Disposable {
  const reg = new QwenAutocompleteRegistration()
  context.subscriptions.push(reg)
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.qwenAutocomplete.showLogs", showQwenAutocompleteLogs),
    vscode.commands.registerCommand("kilo-code.new.qwenAutocomplete.exportDiagnostics", exportQwenAutocompleteDiagnostics),
  )
  return reg
}

class QwenAutocompleteRegistration implements vscode.Disposable {
  private provider: KiloQwenInlineCompletionProvider | null = null
  private registration: vscode.Disposable | null = null
  private readonly watcher: vscode.Disposable
  private collecting = false

  constructor() {
    this.watcher = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("kilo.autocomplete")) this.sync()
    })
    this.sync()
  }

  dispose(): void {
    this.disposeProvider()
    this.watcher.dispose()
  }

  private sync(): void {
    const cfg = readQwenAutocompleteConfig()
    const enabled = qwenAutocompleteEnabled(cfg)
    const collecting = enabled && cfg.recentlyEditedEnabled
    if (enabled && this.provider && this.collecting === collecting) return
    this.disposeProvider()
    if (enabled) {
      const edited = collecting ? new QwenRecentlyEditedTracker() : undefined
      this.provider = new KiloQwenInlineCompletionProvider({ edited })
      this.registration = vscode.languages.registerInlineCompletionItemProvider(QWEN_DOCUMENT_SELECTOR, this.provider)
      this.collecting = collecting
      return
    }
  }

  private disposeProvider(): void {
    this.registration?.dispose()
    this.registration = null
    this.provider?.dispose()
    this.provider = null
    this.collecting = false
  }
}
