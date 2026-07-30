import * as vscode from "vscode"

type Post = (msg: unknown) => void

const CONFIG = "chipmate.v2"

export function buildThroughputSettingMessage() {
  const config = vscode.workspace.getConfiguration(CONFIG)
  return {
    type: "throughputSettingLoaded" as const,
    visible: config.get<boolean>("showTokenThroughput", false),
  }
}

export function watchThroughputConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${CONFIG}.showTokenThroughput`)) {
      post(buildThroughputSettingMessage())
    }
  })
}
