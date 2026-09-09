import * as vscode from "vscode"
import { join } from "node:path"
import { DiagnosticStore, type DiagnosticRecord } from "@opencode-ai/core/chipmate/diagnostics/store"
import { anonymous } from "@opencode-ai/core/chipmate/diagnostics/redact"

let store: DiagnosticStore | undefined
export function initializeDiagnostics(context: vscode.ExtensionContext) {
  const salt = anonymous(context.globalStorageUri.fsPath)
  store = new DiagnosticStore({ root: join(context.globalStorageUri.fsPath, "diagnostics", "records"), source: "extension", workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "", salt })
  store.append("扩展诊断已初始化", { extensionVersion: context.extension.packageJSON.version, vscodeVersion: vscode.version, platform: process.platform, arch: process.arch, remoteName: vscode.env.remoteName ?? "local" })
  const current = store
  context.subscriptions.push({ dispose() { current.append("扩展诊断结束"); void current.flush(); if (store === current) store = undefined } })
  return current
}
export function diagnostic(event: string, data?: unknown, level: DiagnosticRecord["level"] = "INFO", source?: string) { store?.append(event, data, level, source) }
export function diagnosticStore() { return store }
export function diagnosticsEnvironment() {
  return store ? { CHIPMATE_DIAGNOSTICS_DIR: store.context.root, CHIPMATE_DIAGNOSTICS_SALT: store.context.salt, CHIPMATE_DIAGNOSTICS_WORKSPACE: store.context.workspace } : {}
}
