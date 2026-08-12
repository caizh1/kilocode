import * as vscode from "vscode"
import { SHORTCUTS } from "./identity"

export interface Coexistence extends vscode.Disposable {
  autocomplete(): boolean
  readonly onDidChangeAutocomplete: vscode.Event<boolean>
}

export function registerCoexistence(): Coexistence {
  const emitter = new vscode.EventEmitter<boolean>()
  void vscode.commands.executeCommand("setContext", SHORTCUTS, true)
  return {
    autocomplete: () => true,
    onDidChangeAutocomplete: emitter.event,
    dispose: () => {
      emitter.dispose()
      void vscode.commands.executeCommand("setContext", SHORTCUTS, false)
    },
  }
}
