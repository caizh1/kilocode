import * as vscode from "vscode"
import { SHORTCUTS } from "./identity"

const OFFICIAL = "kilocode.kilo-code"
const NOTICE = "chipmate.v2.coexistence.shortcutNoticeShown"

export interface Coexistence extends vscode.Disposable {
  autocomplete(): boolean
  readonly onDidChangeAutocomplete: vscode.Event<boolean>
}

export function registerCoexistence(context: vscode.ExtensionContext): Coexistence {
  const emitter = new vscode.EventEmitter<boolean>()
  let official = vscode.extensions.getExtension(OFFICIAL) !== undefined
  const sync = async (notify: boolean) => {
    const next = vscode.extensions.getExtension(OFFICIAL) !== undefined
    const changed = next !== official
    official = next
    if (changed) emitter.fire(!official)
    await vscode.commands.executeCommand("setContext", SHORTCUTS, !official)
    if (!notify || !official || context.globalState.get<boolean>(NOTICE)) return
    await context.globalState.update(NOTICE, true)
    void vscode.window.showInformationMessage(
      "ChipMate detected Kilo Code. Kilo Code now owns autocomplete and global shortcuts; ChipMate chat and other features remain available.",
    )
  }

  const run = () => void sync(true).catch((err) => console.warn("[ChipMate] coexistence sync failed", err))
  run()
  const change = vscode.extensions.onDidChange(run)
  return {
    autocomplete: () => !official,
    onDidChangeAutocomplete: emitter.event,
    dispose: () => {
      change.dispose()
      emitter.dispose()
      void vscode.commands.executeCommand("setContext", SHORTCUTS, false)
    },
  }
}
