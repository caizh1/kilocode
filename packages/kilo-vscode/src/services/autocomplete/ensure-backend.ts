import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"

/** Start the shared CLI backend when autocomplete is enabled for a workspace. */
export function ensureBackendForAutocomplete(connection: KiloConnectionService): void {
  const enabled =
    vscode.workspace.getConfiguration("kilo-code.new.autocomplete").get<boolean>("enableAutoTrigger") ?? true
  const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!enabled || !dir) return
  connection.connect(dir).catch((err) => {
    console.error("[Kilo New] Autocomplete: Failed to start CLI backend:", err)
  })
}
