import * as vscode from "vscode"
import { join } from "node:path"
import { DiagnosticStore, type DiagnosticRecord } from "@opencode-ai/core/chipmate/diagnostics/store"
import { anonymous } from "@opencode-ai/core/chipmate/diagnostics/redact"

let store: DiagnosticStore | undefined
export function initializeDiagnostics(context: vscode.ExtensionContext) {
  const salt = anonymous(context.globalStorageUri.fsPath)
  store = new DiagnosticStore({
    root: join(context.globalStorageUri.fsPath, "diagnostics", "records"),
    source: "extension",
    workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
    salt,
  })
  store.append("扩展诊断已初始化", {
    extensionVersion: context.extension.packageJSON.version,
    vscodeVersion: vscode.version,
    platform: process.platform,
    arch: process.arch,
    remoteName: vscode.env.remoteName ?? "local",
  })
  const current = store
  context.subscriptions.push({
    dispose() {
      current.append("扩展诊断结束")
      void current.flush()
      if (store === current) store = undefined
    },
  })
  return current
}
export function diagnostic(event: string, data?: unknown, level: DiagnosticRecord["level"] = "INFO", source?: string) {
  store?.append(event, data, level, source)
}
export function diagnosticStore() {
  return store
}
export function diagnosticsEnvironment() {
  return store
    ? {
        CHIPMATE_DIAGNOSTICS_DIR: store.context.root,
        CHIPMATE_DIAGNOSTICS_SALT: store.context.salt,
        CHIPMATE_DIAGNOSTICS_WORKSPACE: store.context.workspace,
      }
    : {}
}

// 仅接入事件元数据；消息正文和工具结果不进入默认诊断日志。
export function diagnosticConnectionEvent(value: unknown, directory?: string) {
  if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") return
  const type = value.type
  if (!["session.error", "session.status", "session.idle", "message.updated"].includes(type)) return
  const properties =
    "properties" in value && value.properties && typeof value.properties === "object"
      ? (value.properties as Record<string, unknown>)
      : {}
  if (type === "message.updated") {
    const info = properties.info as Record<string, unknown> | undefined
    if (info?.role !== "assistant") return
    diagnostic(
      "模型请求状态",
      {
        directory,
        sessionID: info.sessionID,
        messageID: info.id,
        modelID: info.modelID,
        providerID: info.providerID,
        time: info.time,
        tokens: tokenCounts(info.tokens),
        finishReason: info.finish,
        error: info.error,
      },
      info.error ? "ERROR" : "INFO",
      "model",
    )
    return
  }
  diagnostic(
    type,
    { directory, sessionID: properties.sessionID, status: properties.status, error: properties.error },
    type === "session.error" ? "ERROR" : "INFO",
    "model",
  )
}

function tokenCounts(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const tokens = value as Record<string, unknown>
  return {
    total: tokens.total,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    reasoningLength: tokens.reasoning,
  }
}
