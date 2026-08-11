import * as vscode from "vscode"

export function pickInstallScope(project: string | undefined, title: string) {
  const items = [
    ...(project ? [{ label: "安装到当前项目", description: project, scope: "project" as const }] : []),
    { label: "安装到全局", description: "对所有工作区可用", scope: "global" as const },
  ]
  return vscode.window.showQuickPick(items, { title, placeHolder: "选择安装范围" })
}
