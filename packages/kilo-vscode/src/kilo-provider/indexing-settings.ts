import * as vscode from "vscode"

type Post = (msg: unknown) => void

export function buildIndexingSettingsMessage() {
  const config = vscode.workspace.getConfiguration("chipmate.v2.indexing")
  return {
    type: "indexingSettingsLoaded" as const,
    settings: {
      showButtonWhenDisabled: config.get<boolean>("showButtonWhenDisabled", true),
    },
  }
}

export function watchIndexingConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("chipmate.v2.indexing")) {
      post(buildIndexingSettingsMessage())
    }
  })
}

export function validIndexingSetting(key: string, value: unknown) {
  return key === "showButtonWhenDisabled" && typeof value === "boolean"
}
