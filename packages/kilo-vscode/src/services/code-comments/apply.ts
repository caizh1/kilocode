import * as vscode from "vscode"
import type Parser from "web-tree-sitter"
import { getAst } from "../autocomplete/continuedev/core/autocomplete/util/ast"
import { sha256 } from "./function-target"
import type { FunctionTarget, RawCommentProposal } from "./types"

export function buildCommentedDocument(target: FunctionTarget, proposals: RawCommentProposal[]): string {
  const lines = target.documentText.split(/\r?\n/)
  for (const proposal of [...proposals].sort((left, right) => right.insertBeforeLine - left.insertBeforeLine)) {
    lines.splice(proposal.insertBeforeLine, 0, ...renderCommentLines(proposal))
  }
  return lines.join(target.eol)
}

export function validateTargetSnapshot(
  target: FunctionTarget,
  document: Pick<vscode.TextDocument, "uri" | "version" | "getText" | "lineAt" | "lineCount">,
): string[] {
  const reasons: string[] = []
  if (document.uri.toString() !== target.uri) reasons.push("当前文档 URI 与生成目标不一致")
  if (document.version !== target.documentVersion) reasons.push("文档版本在生成期间发生变化")
  const text = document.getText()
  if (sha256(text.slice(target.startIndex, target.endIndex)) !== target.functionHash) {
    reasons.push("当前函数源码在生成期间发生变化")
  }
  for (const anchor of target.anchors) {
    if (anchor.line >= document.lineCount || document.lineAt(anchor.line).text !== anchor.targetLineText) {
      reasons.push(`第 ${anchor.line + 1} 行注释锚点已变化`)
    }
  }
  return [...new Set(reasons)]
}

export async function validateOnlyCommentInsertions(
  target: FunctionTarget,
  proposals: RawCommentProposal[],
  candidate: string,
): Promise<boolean> {
  if (buildCommentedDocument(target, proposals) !== candidate) return false
  const [before, after] = await Promise.all([
    getAst(target.filePath, target.documentText),
    getAst(target.filePath, candidate),
  ])
  if (!before || !after) {
    before?.delete()
    after?.delete()
    return false
  }
  try {
    return leafTokens(before.rootNode).join("\u0000") === leafTokens(after.rootNode).join("\u0000")
  } finally {
    before.delete()
    after.delete()
  }
}

export async function applyCommentProposals(
  document: vscode.TextDocument,
  target: FunctionTarget,
  proposals: RawCommentProposal[],
): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit()
  for (const proposal of proposals) {
    edit.insert(document.uri, new vscode.Position(proposal.insertBeforeLine, 0), renderComment(proposal, target.eol))
  }
  return vscode.workspace.applyEdit(edit)
}

export function renderComment(proposal: RawCommentProposal, eol: "\n" | "\r\n"): string {
  return `${renderCommentLines(proposal).join(eol)}${eol}`
}

function renderCommentLines(proposal: RawCommentProposal): string[] {
  return proposal.commentText.split(/\r?\n/).map((line) => {
    const content = line.trimEnd()
    return content ? `${proposal.indent}${content}` : proposal.indent
  })
}

function leafTokens(node: Parser.SyntaxNode): string[] {
  if (node.type === "comment") return []
  if (node.childCount === 0) return [`${node.type}:${node.text}`]
  return node.children.flatMap(leafTokens)
}
