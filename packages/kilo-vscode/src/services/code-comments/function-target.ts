import crypto from "node:crypto"
import type Parser from "web-tree-sitter"
import { getAst, getTreePathAtCursor } from "../autocomplete/continuedev/core/autocomplete/util/ast"
import type { CommentAnchor, FunctionHeaderStyle, FunctionTarget } from "./types"

type SyntaxNode = Parser.SyntaxNode

export type FunctionTargetInput = {
  uri: string
  filePath: string
  relativePath: string
  workspacePath: string
  languageId: string
  documentVersion: number
  documentText: string
  cursorOffset: number
  eol: "\n" | "\r\n"
}

const CONTROL_TYPES = new Set([
  "if_statement",
  "switch_statement",
  "for_statement",
  "for_range_loop",
  "while_statement",
  "do_statement",
  "try_statement",
  "case_statement",
])

const STATEMENT_TYPES = new Set(["declaration", "expression_statement", "return_statement", "throw_statement"])
const TEMPLATE_TYPES = new Set(["template_declaration"])
const MAX_ANCHORS = 80
const C_FUNCTION_ANNOTATIONS = /\b(?:coroutine_fn|coroutine_mixed_fn|QEMU_NORETURN|G_GNUC_NORETURN|G_GNUC_UNUSED)\b/g

export function isSupportedCodeCommentLanguage(languageId: string): languageId is "c" | "cpp" {
  return languageId === "c" || languageId === "cpp"
}

export async function resolveFunctionTarget(input: FunctionTargetInput): Promise<FunctionTarget | undefined> {
  if (!isSupportedCodeCommentLanguage(input.languageId)) return
  if (input.cursorOffset < 0 || input.cursorOffset > input.documentText.length) return
  const ast = await getAst(input.filePath, maskFunctionAnnotations(input.documentText))
  if (!ast) return
  try {
    const path = await getTreePathAtCursor(ast, input.cursorOffset)
    const functionIndex = path.findLastIndex((node) => node.type === "function_definition")
    const functionNode = functionIndex >= 0 ? path[functionIndex] : undefined
    if (!functionNode || functionNode.isError) return
    if (path.slice(functionIndex + 1).some((node) => node.type === "lambda_expression")) return
    const body = functionNode.childForFieldName("body")
    if (!body || containsMissingNode(body)) return
    const targetNode = expandFunctionNode(functionNode)
    const startIndex = targetNode.startIndex
    const endIndex = targetNode.endIndex
    const lines = splitLines(input.documentText)
    const startLine = targetNode.startPosition.row
    const endLine = endLineInclusive(targetNode, lines.length)
    if (startLine < 0 || endLine < startLine || endLine >= lines.length) return
    const anchors = collectAnchors({
      lines,
      functionNode,
      body,
      startLine,
      endLine,
    })
    if (anchors.length === 0 || anchors[0]?.kind !== "function") return
    const functionSource = input.documentText.slice(startIndex, endIndex)
    return {
      uri: input.uri,
      filePath: input.filePath,
      relativePath: input.relativePath,
      workspacePath: input.workspacePath,
      languageId: input.languageId,
      documentVersion: input.documentVersion,
      documentText: input.documentText,
      functionSource,
      functionHash: sha256(functionSource),
      startIndex,
      endIndex,
      startLine,
      endLine,
      contextBefore: lines.slice(Math.max(0, startLine - 30), startLine).join(input.eol),
      contextAfter: lines.slice(endLine + 1, Math.min(lines.length, endLine + 21)).join(input.eol),
      functionHeaderStyle: detectFunctionHeaderStyle(ast.rootNode, lines),
      existingComments: collectExistingComments(lines, startLine, endLine),
      anchors,
      eol: input.eol,
    }
  } finally {
    ast.delete()
  }
}

function expandFunctionNode(node: SyntaxNode): SyntaxNode {
  let result = node
  let parent = node.parent
  while (parent && TEMPLATE_TYPES.has(parent.type)) {
    result = parent
    parent = parent.parent
  }
  return result
}

function containsMissingNode(node: SyntaxNode): boolean {
  if (node.isMissing) return true
  return node.namedChildren.some(containsMissingNode)
}

function collectAnchors(input: {
  lines: string[]
  functionNode: SyntaxNode
  body: SyntaxNode
  startLine: number
  endLine: number
}): CommentAnchor[] {
  const anchors = new Map<number, CommentAnchor>()
  addAnchor(anchors, input.lines, input.startLine, "function")

  const visit = (node: SyntaxNode) => {
    if (anchors.size >= MAX_ANCHORS) return
    const line = node.startPosition.row
    if (line > input.startLine && line <= input.endLine) {
      if (CONTROL_TYPES.has(node.type)) addAnchor(anchors, input.lines, line, "controlBlock")
      if (STATEMENT_TYPES.has(node.type)) addAnchor(anchors, input.lines, line, "statement")
    }
    for (const child of node.namedChildren) visit(child)
  }
  visit(input.body)

  return [...anchors.values()].sort((left, right) => left.line - right.line)
}

function addAnchor(
  anchors: Map<number, CommentAnchor>,
  lines: string[],
  line: number,
  kind: CommentAnchor["kind"],
): void {
  if (anchors.has(line) || !safeAnchor(lines, line)) return
  const text = lines[line] ?? ""
  anchors.set(line, {
    line,
    kind,
    targetLineText: text,
    indent: text.match(/^\s*/)?.[0] ?? "",
  })
}

function safeAnchor(lines: string[], line: number): boolean {
  const text = lines[line]
  if (text === undefined || !text.trim()) return false
  const trimmed = text.trim()
  if (trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
    return false
  }
  if (text.trimEnd().endsWith("\\")) return false
  if (line > 0 && lines[line - 1]?.trimEnd().endsWith("\\")) return false
  return true
}

function collectExistingComments(lines: string[], startLine: number, endLine: number): string[] {
  const result: string[] = []
  let block: string[] = []
  let inBlock = false
  const flush = () => {
    const value = block.join("\n").trim()
    if (value) result.push(value)
    block = []
  }
  for (let line = Math.max(0, startLine - 12); line <= endLine; line += 1) {
    const trimmed = lines[line]?.trim() ?? ""
    if (inBlock) {
      block.push(trimmed)
      if (trimmed.includes("*/")) {
        inBlock = false
        flush()
      }
      continue
    }
    if (trimmed.startsWith("/*")) {
      flush()
      block.push(trimmed)
      if (trimmed.includes("*/")) flush()
      else inBlock = true
      continue
    }
    if (trimmed.startsWith("//")) {
      block.push(trimmed)
      continue
    }
    flush()
  }
  flush()
  return result.slice(0, 12)
}

function detectFunctionHeaderStyle(root: SyntaxNode, lines: string[]): FunctionHeaderStyle {
  const counts: Record<FunctionHeaderStyle, number> = {
    docBlock: 0,
    block: 0,
    line: 0,
  }
  const visit = (node: SyntaxNode) => {
    if (node.type === "function_definition") {
      const style = leadingCommentStyle(lines, node.startPosition.row)
      if (style) counts[style] += 1
      return
    }
    for (const child of node.namedChildren) visit(child)
  }
  visit(root)
  const styles = (Object.keys(counts) as FunctionHeaderStyle[]).filter((style) => counts[style] > 0)
  if (styles.length === 0) return "docBlock"
  return styles.sort((left, right) => counts[right] - counts[left] || styleOrder(left) - styleOrder(right))[0]!
}

function leadingCommentStyle(lines: string[], functionLine: number): FunctionHeaderStyle | undefined {
  let line = functionLine - 1
  while (line >= 0 && !lines[line]?.trim()) line -= 1
  const text = lines[line]?.trim()
  if (!text) return
  if (text.startsWith("//")) return "line"
  if (!text.endsWith("*/")) return
  while (line >= 0) {
    const current = lines[line]?.trim() ?? ""
    const start = current.indexOf("/*")
    if (start >= 0) return current.slice(start).startsWith("/**") ? "docBlock" : "block"
    line -= 1
  }
}

function styleOrder(style: FunctionHeaderStyle): number {
  if (style === "docBlock") return 0
  if (style === "block") return 1
  return 2
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/)
}

function maskFunctionAnnotations(value: string): string {
  return value.replace(C_FUNCTION_ANNOTATIONS, (match) => " ".repeat(match.length))
}

function endLineInclusive(node: SyntaxNode, lineCount: number): number {
  if (node.endPosition.column > 0) return Math.min(lineCount - 1, node.endPosition.row)
  return Math.min(lineCount - 1, Math.max(node.startPosition.row, node.endPosition.row - 1))
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}
