import crypto from "node:crypto"
import type Parser from "web-tree-sitter"
import { getAst } from "../autocomplete/continuedev/core/autocomplete/util/ast"
import type { LogicBlockAnchor, LogicBlockTarget } from "./types"

type SyntaxNode = Parser.SyntaxNode

const CONTROL = new Set([
  "if_statement",
  "switch_statement",
  "case_statement",
  "for_statement",
  "for_range_loop",
  "while_statement",
  "do_statement",
  "preproc_if",
  "preproc_ifdef",
])
const EXIT = new Set(["return_statement", "goto_statement", "break_statement", "continue_statement"])

export async function resolveLogicBlockTarget(input: {
  uri: string
  filePath: string
  relativePath: string
  workspacePath: string
  languageId: string
  documentVersion: number
  documentText: string
  selectionStartOffset: number
  selectionEndOffset: number
  eol: "\n" | "\r\n"
}): Promise<LogicBlockTarget | undefined> {
  if (input.languageId !== "c" && input.languageId !== "cpp") return
  const start = Math.max(0, Math.min(input.selectionStartOffset, input.selectionEndOffset))
  const end = Math.min(input.documentText.length, Math.max(input.selectionStartOffset, input.selectionEndOffset))
  if (start === end) return
  const ast = await getAst(input.filePath, input.documentText)
  if (!ast) return
  try {
    const fn = smallestContainingFunction(ast.rootNode, start, end)
    const body = fn?.childForFieldName("body")
    if (!fn || !body || start <= body.startIndex || end >= body.endIndex || containsLambda(fn, start, end)) return
    const lines = input.documentText.split(/\r?\n/u)
    const nodes = collectSafeNodes(body, start, end, lines)
    const selected = selectNodes(nodes, 24)
    if (selected.length === 0) return
    const anchors = selected.map((node, index): LogicBlockAnchor => {
      const line = node.startPosition.row
      const targetLineText = lines[line] ?? ""
      return {
        id: `L${index + 1}`,
        kind: nodeKind(node),
        nodeType: node.type,
        startLine: line,
        endLine: inclusiveEndLine(node),
        insertBeforeLine: line,
        targetLineText,
        indent: targetLineText.match(/^\s*/u)?.[0] ?? "",
        source: input.documentText.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 700)),
      }
    })
    const first = selected[0]!
    const last = selected.at(-1)!
    const selectedSource = input.documentText.slice(first.startIndex, last.endIndex)
    return {
      uri: input.uri,
      filePath: input.filePath,
      relativePath: input.relativePath,
      workspacePath: input.workspacePath,
      languageId: input.languageId,
      documentVersion: input.documentVersion,
      documentText: input.documentText,
      documentHash: hash(input.documentText),
      eol: input.eol,
      displayName: functionName(fn, input.documentText),
      functionSource: input.documentText.slice(fn.startIndex, fn.endIndex),
      selectedSource,
      targetHash: hash(selectedSource),
      startIndex: first.startIndex,
      endIndex: last.endIndex,
      startLine: first.startPosition.row,
      endLine: inclusiveEndLine(last),
      anchors,
      existingComments: collectComments(selectedSource),
      detailTarget: suggestedDetailTarget(anchors),
    }
  } finally {
    ast.delete()
  }
}

function smallestContainingFunction(root: SyntaxNode, start: number, end: number): SyntaxNode | undefined {
  const candidates: SyntaxNode[] = []
  const visit = (node: SyntaxNode) => {
    if (node.startIndex > start || node.endIndex < end) return
    if (node.type === "function_definition") candidates.push(node)
    for (const child of node.namedChildren) visit(child)
  }
  visit(root)
  return candidates.sort((left, right) => left.endIndex - left.startIndex - (right.endIndex - right.startIndex))[0]
}

function containsLambda(fn: SyntaxNode, start: number, end: number): boolean {
  let found = false
  const visit = (node: SyntaxNode) => {
    if (found || node.endIndex <= start || node.startIndex >= end) return
    if (node !== fn && node.type === "lambda_expression") {
      found = true
      return
    }
    for (const child of node.namedChildren) visit(child)
  }
  visit(fn)
  return found
}

function collectSafeNodes(body: SyntaxNode, start: number, end: number, lines: readonly string[]): SyntaxNode[] {
  const byLine = new Map<number, SyntaxNode>()
  const visit = (node: SyntaxNode) => {
    if (node.endIndex <= start || node.startIndex >= end) return
    if (
      safeNode(node) &&
      node.startIndex >= start &&
      node.endIndex <= end &&
      !lines[node.startPosition.row]?.slice(0, node.startPosition.column).trim()
    ) {
      const line = node.startPosition.row
      const previous = byLine.get(line)
      if (!previous || nodePriority(node) < nodePriority(previous)) byLine.set(line, node)
    }
    for (const child of node.namedChildren) visit(child)
  }
  visit(body)
  return [...byLine.values()]
    .filter((node) => !leadingComment(node) && !trailingComment(node))
    .sort((left, right) => left.startIndex - right.startIndex)
}

function safeNode(node: SyntaxNode): boolean {
  if (node.type === "compound_statement" || node.type === "comment" || node.isError) return false
  return (
    CONTROL.has(node.type) ||
    EXIT.has(node.type) ||
    node.type === "expression_statement" ||
    node.type === "declaration" ||
    node.type === "labeled_statement"
  )
}

function leadingComment(node: SyntaxNode): boolean {
  return node.previousNamedSibling?.type === "comment"
}

function trailingComment(node: SyntaxNode): boolean {
  return node.nextNamedSibling?.type === "comment" && node.nextNamedSibling.startPosition.row === node.endPosition.row
}

function nodeKind(node: SyntaxNode): LogicBlockAnchor["kind"] {
  if (CONTROL.has(node.type)) return "control"
  if (EXIT.has(node.type)) return "exit"
  if (node.type === "declaration") return "declaration"
  return "statement"
}

function nodePriority(node: SyntaxNode): number {
  if (CONTROL.has(node.type)) return 0
  if (EXIT.has(node.type)) return 1
  if (node.type === "expression_statement") return 2
  return 3
}

function selectNodes(nodes: readonly SyntaxNode[], limit: number): SyntaxNode[] {
  if (nodes.length <= limit) return [...nodes]
  const critical = nodes.filter((node) => nodePriority(node) <= 1)
  const selected = evenlySample(critical, Math.min(16, limit))
  const selectedKeys = new Set(selected.map(nodeKey))
  const remaining = nodes.filter((node) => !selectedKeys.has(nodeKey(node)))
  selected.push(...evenlySample(remaining, limit - selected.length))
  return selected.sort((left, right) => left.startIndex - right.startIndex)
}

function evenlySample(nodes: readonly SyntaxNode[], limit: number): SyntaxNode[] {
  if (limit <= 0) return []
  if (nodes.length <= limit) return [...nodes]
  if (limit === 1) return [nodes[Math.floor(nodes.length / 2)]!]
  const result: SyntaxNode[] = []
  for (let index = 0; index < limit; index += 1) {
    result.push(nodes[Math.round((index * (nodes.length - 1)) / (limit - 1))]!)
  }
  return result
}

function nodeKey(node: SyntaxNode): string {
  return `${node.startIndex}:${node.endIndex}`
}

function inclusiveEndLine(node: SyntaxNode): number {
  return node.endPosition.column > 0 ? node.endPosition.row : Math.max(node.startPosition.row, node.endPosition.row - 1)
}

function functionName(node: SyntaxNode, source: string): string {
  const declarator = node.childForFieldName("declarator")?.text
  return (
    declarator?.match(/([A-Za-z_]\w*)\s*\(/u)?.[1] ??
    source.slice(node.startIndex, node.endIndex).match(/([A-Za-z_]\w*)\s*\(/u)?.[1] ??
    "函数逻辑块"
  )
}

function collectComments(source: string): string[] {
  return [...source.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//gu)].map((match) => match[0])
}

function suggestedDetailTarget(anchors: readonly LogicBlockAnchor[]): number {
  const controls = anchors.filter((anchor) => anchor.kind === "control" || anchor.kind === "exit").length
  if (anchors.length === 0) return 0
  if (controls === 0) return Math.min(2, anchors.length)
  if (controls <= 2) return Math.min(3, anchors.length)
  return Math.min(8, anchors.length, controls + 2)
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}
