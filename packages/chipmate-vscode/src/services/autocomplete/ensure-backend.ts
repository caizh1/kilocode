import * as vscode from "vscode"
import type { ChipMateConnectionService } from "../cli-backend"

/** Start the shared CLI backend when autocomplete is enabled for a workspace. */
export function ensureBackendForAutocomplete(connection: ChipMateConnectionService): void {
  const enabled =
    vscode.workspace.getConfiguration("chipmate.v2.autocomplete").get<boolean>("enableAutoTrigger") ?? true
  const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!enabled || !dir) return
  connection.connect(dir).catch((err) => {
    console.error("[ChipMate New] Autocomplete: Failed to start CLI backend:", err)
  })
}
