import * as vscode from "vscode"
import type { ChipMateProvider } from "./ChipMateProvider"

/** 聚焦具体视图，避免活动栏容器命令再次执行时切走聊天。 */
export async function openAppearanceSidebar(
  provider: Pick<ChipMateProvider, "waitForReady" | "postMessage">,
  action: "plusButtonClicked" | "historyButtonClicked",
) {
  await vscode.commands.executeCommand("chipmate.v2.SidebarProvider.focus")
  await provider.waitForReady()
  provider.postMessage({ type: "action", action })
}
