import * as vscode from "vscode"
import { readQwenAutocompleteConfig, qwenAutocompleteEnabled } from "./config"
import { KiloQwenInlineCompletionProvider, QWEN_DOCUMENT_SELECTOR } from "./KiloQwenInlineCompletionProvider"

export function registerQwenAutocompleteProvider(context: vscode.ExtensionContext): vscode.Disposable {
  const reg = new QwenAutocompleteRegistration()
  context.subscriptions.push(reg)
  return reg
}

class QwenAutocompleteRegistration implements vscode.Disposable {
  private provider: vscode.Disposable | null = null
  private readonly watcher: vscode.Disposable

  constructor() {
    this.watcher = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("kilo.autocomplete")) this.sync()
    })
    this.sync()
  }

  dispose(): void {
    this.provider?.dispose()
    this.provider = null
    this.watcher.dispose()
  }

  private sync(): void {
    const enabled = qwenAutocompleteEnabled(readQwenAutocompleteConfig())
    if (enabled && !this.provider) {
      this.provider = vscode.languages.registerInlineCompletionItemProvider(
        QWEN_DOCUMENT_SELECTOR,
        new KiloQwenInlineCompletionProvider(),
      )
      return
    }
    if (!enabled && this.provider) {
      this.provider.dispose()
      this.provider = null
    }
  }
}
