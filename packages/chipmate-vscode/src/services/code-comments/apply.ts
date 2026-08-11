import * as vscode from "vscode"
import type Parser from "web-tree-sitter"
import { getAst } from "../autocomplete/continuedev/core/autocomplete/util/ast"
import { sha256 } from "./function-target"
import type { FunctionTarget, RawCommentProposal } from "./types"

export function buildCommentedDocument(target: FunctionTarget, proposals: RawCommentProposal[]): string {
  return buildCommentedDocumentForTargets(target.documentText, target.eol, [{ target, proposals }])
}

export function buildCommentedDocumentForTargets(
  documentText: string,
  eol: "\n" | "\r\n",
  changes: Array<{ target: FunctionTarget; proposals: RawCommentProposal[] }>,
): string {
  const lines = documentText.split(/\r?\n/)
  const proposals = changes.flatMap((change) => change.proposals)
  for (const proposal of proposals.sort(compareProposalDescending)) {
    const deleteCount = proposal.operation === "replace" ? proposal.replaceEndLine! - proposal.insertBeforeLine + 1 : 0
    lines.splice(proposal.insertBeforeLine, deleteCount, ...renderCommentLines(proposal))
  }
  return lines.join(eol)
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
  const header = target.existingFunctionHeader
  if (header) {
    const lines = text.split(/\r?\n/)
    if (sha256(lines.slice(header.startLine, header.endLine + 1).join(target.eol)) !== header.hash) {
      reasons.push("既有函数说明在生成期间发生变化")
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
  return validateCommentOnlyDocument(target.filePath, target.documentText, candidate)
}

export async function validateCommentOnlyDocument(
  filePath: string,
  beforeText: string,
  afterText: string,
): Promise<boolean> {
  const [before, after] = await Promise.all([
    getAst(filePath, beforeText),
    getAst(filePath, afterText),
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
    addProposalEdit(edit, document, proposal, target.eol)
  }
  return vscode.workspace.applyEdit(edit)
}

export async function applyCommentProposalsForTargets(
  document: vscode.TextDocument,
  changes: Array<{ target: FunctionTarget; proposals: RawCommentProposal[] }>,
): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit()
  for (const change of changes) {
    for (const proposal of change.proposals) addProposalEdit(edit, document, proposal, change.target.eol)
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

function addProposalEdit(
  edit: vscode.WorkspaceEdit,
  document: vscode.TextDocument,
  proposal: RawCommentProposal,
  eol: "\n" | "\r\n",
): void {
  const start = new vscode.Position(proposal.insertBeforeLine, 0)
  if (proposal.operation === "insert") {
    edit.insert(document.uri, start, renderComment(proposal, eol))
    return
  }
  const end = new vscode.Position(proposal.replaceEndLine! + 1, 0)
  edit.replace(document.uri, new vscode.Range(start, end), renderComment(proposal, eol))
}

function compareProposalDescending(left: RawCommentProposal, right: RawCommentProposal): number {
  return right.insertBeforeLine - left.insertBeforeLine
}

function leafTokens(node: Parser.SyntaxNode): string[] {
  if (node.type === "comment") return []
  if (node.childCount === 0) return [`${node.type}:${node.text}`]
  return node.children.flatMap(leafTokens)
}
