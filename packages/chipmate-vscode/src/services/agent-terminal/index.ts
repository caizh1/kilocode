import * as vscode from "vscode"

export function registerAgentTerminal(context: vscode.ExtensionContext, openConsole: () => void): void {
  context.subscriptions.push(vscode.commands.registerCommand("chipmate.v2.agentTerminal.open", () => openConsole()))
}
