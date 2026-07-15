import * as vscode from "vscode"

export function autocompleteFolder(document?: vscode.TextDocument): vscode.WorkspaceFolder | undefined {
  const editor = document ?? vscode.window.activeTextEditor?.document
  const folder = editor ? vscode.workspace.getWorkspaceFolder?.(editor.uri) : undefined
  return folder ?? vscode.workspace.workspaceFolders?.[0]
}

export function autocompleteResource(document?: vscode.TextDocument): vscode.Uri | undefined {
  return autocompleteFolder(document)?.uri
}

export function autocompleteDirectory(document?: vscode.TextDocument): string | undefined {
  return autocompleteFolder(document)?.uri.fsPath
}
