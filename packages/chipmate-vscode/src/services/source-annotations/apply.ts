import * as vscode from "vscode"
import type { CoordinatedSourceAnnotations, SourceAnnotationFileGroup, SourceAnnotationOperation } from "./types"

export type SourceAnnotationDocumentResolution =
  | { status: "ready"; documents: ReadonlyMap<string, vscode.TextDocument>; reopened: readonly string[] }
  | { status: "unavailable"; reason: string }

export async function resolveSourceAnnotationDocuments(
  plan: CoordinatedSourceAnnotations,
): Promise<SourceAnnotationDocumentResolution> {
  const documents = new Map<string, vscode.TextDocument>()
  const reopened: string[] = []
  for (const file of plan.files) {
    const loaded = vscode.workspace.textDocuments.find((document) => document.uri.toString() === file.uri)
    if (loaded) {
      documents.set(file.uri, loaded)
      continue
    }
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file.uri))
      if (document.uri.toString() !== file.uri) {
        return { status: "unavailable", reason: `${file.relativePath}：重新打开的文档 URI 与生成目标不一致` }
      }
      documents.set(file.uri, document)
      reopened.push(file.uri)
    } catch (error) {
      return {
        status: "unavailable",
        reason: `${file.relativePath}：目标文件无法重新打开：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  return { status: "ready", documents, reopened }
}

export function validateSourceAnnotationSnapshots(
  plan: CoordinatedSourceAnnotations,
  documents: ReadonlyMap<string, vscode.TextDocument>,
): string[] {
  const reasons: string[] = []
  for (const file of plan.files) {
    const document = documents.get(file.uri)
    if (!document) {
      reasons.push(`${file.relativePath}：缺少待应用文档`)
      continue
    }
    if (document.getText() !== file.documentText) reasons.push(`${file.relativePath}：源码内容在生成期间发生变化`)
    const lines = document.getText().split(/\r?\n/)
    for (const artifact of file.artifacts) {
      for (const operation of artifact.operations) {
        const anchorLine = operation.insertBeforeLine
        if (operation.operation === "insert" && lines[anchorLine] !== operation.targetLineText) {
          reasons.push(`${file.relativePath}：第 ${anchorLine + 1} 行注释锚点已变化`)
        }
      }
    }
  }
  return [...new Set(reasons)]
}

export async function applyCoordinatedSourceAnnotations(
  plan: CoordinatedSourceAnnotations,
  documents: ReadonlyMap<string, vscode.TextDocument>,
): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit()
  for (const file of plan.files) {
    const document = documents.get(file.uri)
    if (!document) return false
    for (const operation of file.operations) addOperation(edit, document, operation, file.eol)
  }
  return vscode.workspace.applyEdit(edit)
}

function addOperation(
  edit: vscode.WorkspaceEdit,
  document: vscode.TextDocument,
  operation: SourceAnnotationOperation,
  eol: "\n" | "\r\n",
): void {
  const start = new vscode.Position(operation.insertBeforeLine, operation.insertBeforeCharacter ?? 0)
  const text = `${operation.commentText
    .split(/\r?\n/)
    .map((line) => {
      const content = line.trimEnd()
      return content ? `${operation.indent}${content}` : operation.indent
    })
    .join(eol)}${eol}`
  if (operation.operation === "insert") {
    edit.insert(document.uri, start, text)
    return
  }
  edit.replace(document.uri, new vscode.Range(start, new vscode.Position(operation.replaceEndLine! + 1, 0)), text)
}

export function primarySourceAnnotationFile(plan: CoordinatedSourceAnnotations): SourceAnnotationFileGroup | undefined {
  return plan.files[0]
}
