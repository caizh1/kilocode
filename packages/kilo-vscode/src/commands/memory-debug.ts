import * as vscode from "vscode"
import * as MemoryDebug from "../services/memory-debug"

export function registerMemoryDebug(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand("kilo-code.new.openMemoryDebug", () => MemoryDebug.show()))
}
