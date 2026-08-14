import * as vscode from "vscode"
import type { FunctionTarget } from "./types"

export type TargetDocumentResolution =
  | { status: "ready"; document: vscode.TextDocument; reopened: boolean }
  | { status: "unavailable"; reason: string }

type TargetDocumentHost = {
  textDocuments: readonly vscode.TextDocument[]
  openTextDocument(uri: vscode.Uri): Thenable<vscode.TextDocument>
}

export async function resolveTargetDocument(
  target: FunctionTarget,
  host: TargetDocumentHost = vscode.workspace,
): Promise<TargetDocumentResolution> {
  const loaded = host.textDocuments.find((document) => document.uri.toString() === target.uri)
  if (loaded) return { status: "ready", document: loaded, reopened: false }

  try {
    const document = await host.openTextDocument(vscode.Uri.parse(target.uri))
    if (document.uri.toString() !== target.uri) {
      return { status: "unavailable", reason: "重新打开的文档 URI 与生成目标不一致" }
    }
    return { status: "ready", document, reopened: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: "unavailable", reason: `目标文件无法重新打开：${detail}` }
  }
}
