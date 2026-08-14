import crypto from "node:crypto"
import type Parser from "web-tree-sitter"
import { getAst, getTreePathAtCursor } from "../autocomplete/continuedev/core/autocomplete/util/ast"
import type {
  CommentAnchor,
  CommentControlRegion,
  DoxygenTagContract,
  FunctionHeaderStyle,
  FunctionTarget,
} from "./types"

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

export type FunctionTargetRangeInput = Omit<FunctionTargetInput, "cursorOffset"> & {
  selectionStartOffset: number
  selectionEndOffset: number
}

const CONTROL_TYPES = new Set([
  "if_statement",
  "switch_statement",
  "for_statement",
  "for_range_loop",
  "while_statement",
  "do_statement",
  "try_statement",
  "catch_clause",
  "else_clause",
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
    const lines = splitLines(input.documentText)
    return buildFunctionTarget({ ...input, languageId: input.languageId }, ast.rootNode, lines, functionNode, body)
  } finally {
    ast.delete()
  }
}

export async function resolveFunctionTargetsInRange(input: FunctionTargetRangeInput): Promise<FunctionTarget[]> {
  if (!isSupportedCodeCommentLanguage(input.languageId)) return []
  const languageId = input.languageId
  const start = Math.max(0, Math.min(input.selectionStartOffset, input.selectionEndOffset))
  const end = Math.min(input.documentText.length, Math.max(input.selectionStartOffset, input.selectionEndOffset))
  if (start === end) return []
  const ast = await getAst(input.filePath, maskFunctionAnnotations(input.documentText))
  if (!ast) return []
  try {
    const lines = splitLines(input.documentText)
    const targets: FunctionTarget[] = []
    const seen = new Set<string>()
    const visit = (node: SyntaxNode) => {
      if (node.type === "function_definition") {
        const body = node.childForFieldName("body")
        const targetNode = expandFunctionNode(node)
        const key = `${targetNode.startIndex}:${targetNode.endIndex}`
        if (
          body &&
          !containsMissingNode(body) &&
          targetNode.startIndex < end &&
          targetNode.endIndex > start &&
          !seen.has(key)
        ) {
          const target = buildFunctionTarget({ ...input, languageId }, ast.rootNode, lines, node, body)
          if (target) {
            targets.push(target)
            seen.add(key)
          }
        }
        return
      }
      for (const child of node.namedChildren) visit(child)
    }
    visit(ast.rootNode)
    return targets.sort((left, right) => left.startIndex - right.startIndex)
  } finally {
    ast.delete()
  }
}

function buildFunctionTarget(
  input: Omit<FunctionTargetInput, "cursorOffset" | "languageId"> & { languageId: "c" | "cpp" },
  root: SyntaxNode,
  lines: string[],
  functionNode: SyntaxNode,
  body: SyntaxNode,
): FunctionTarget | undefined {
  const targetNode = expandFunctionNode(functionNode)
  const startLine = expandFunctionStartLine(lines, targetNode.startPosition.row)
  const startIndex = lineStartIndex(input.documentText, startLine)
  const endIndex = targetNode.endIndex
  const endLine = endLineInclusive(targetNode, lines.length)
  if (startLine < 0 || endLine < startLine || endLine >= lines.length) return
  const anchors = collectAnchors({ lines, functionNode, body, startLine, endLine })
  if (anchors.length === 0 || anchors[0]?.kind !== "function") return
  const controlRegions = collectControlRegions(body, startLine, endLine, lines, anchors)
  const existingCoveredRegionCount = controlRegions.filter((region) => region.existingCovered).length
  const lineCount = endLine - startLine + 1
  const requiredCoverage = minimumControlCoverage(lineCount, controlRegions.length)
  const safelyAnchorableUncovered = controlRegions.filter((region) => !region.existingCovered && region.anchor).length
  const functionSource = input.documentText.slice(startIndex, endIndex)
  const existingFunctionHeader = findExistingFunctionHeader(lines, startLine, input.eol)
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
    functionHeaderStyle: detectFunctionHeaderStyle(root, lines),
    ...(existingFunctionHeader ? { existingFunctionHeader } : {}),
    existingComments: collectExistingComments(lines, startLine, endLine),
    complexity: {
      lineCount,
      controlRegionCount: controlRegions.length,
      existingCoveredRegionCount,
      minimumInlineComments: Math.min(
        Math.max(0, requiredCoverage - existingCoveredRegionCount),
        safelyAnchorableUncovered,
      ),
      controlRegions,
    },
    anchors,
    eol: input.eol,
  }
}

function expandFunctionStartLine(lines: string[], functionLine: number): number {
  let line = functionLine
  while (line > 0 && standaloneDeclarationPrefix(lines[line - 1] ?? "")) line -= 1
  return line
}

function standaloneDeclarationPrefix(value: string): boolean {
  const text = value.trim()
  if (!text || text.startsWith("#") || /[;{}=]/u.test(text)) return false
  return /^(?:[A-Z_][A-Z0-9_]*(?:\s*\([^;{}]*\))?\s*)+$/u.test(text)
}

function lineStartIndex(value: string, targetLine: number): number {
  let line = 0
  let index = 0
  while (line < targetLine) {
    const newline = value.indexOf("\n", index)
    if (newline < 0) return value.length
    index = newline + 1
    line += 1
  }
  return index
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

function collectControlRegions(
  body: SyntaxNode,
  startLine: number,
  endLine: number,
  lines: string[],
  anchors: CommentAnchor[],
): CommentControlRegion[] {
  const regions = new Map<number, { startLine: number; endLine: number }>()
  const visit = (node: SyntaxNode) => {
    if (CONTROL_TYPES.has(node.type)) {
      const start = Math.max(startLine, node.startPosition.row)
      const end = Math.min(endLine, endLineInclusive(node, endLine + 1))
      const current = regions.get(start)
      if (start <= end && (!current || end - start < current.endLine - current.startLine)) {
        regions.set(start, { startLine: start, endLine: end })
      }
    }
    for (const child of node.namedChildren) visit(child)
  }
  visit(body)
  return [...regions.values()]
    .sort((left, right) => left.startLine - right.startLine)
    .map((region) => ({
      id: `control-${region.startLine}-${region.endLine}`,
      ...region,
      existingCovered: leadingCommentLine(lines, region.startLine) >= 0,
      anchor: anchors.find((anchor) => anchor.kind === "controlBlock" && anchor.line === region.startLine),
    }))
}

function leadingCommentLine(lines: string[], line: number): number {
  let current = line - 1
  while (current >= 0 && !lines[current]?.trim()) current -= 1
  const text = lines[current]?.trim() ?? ""
  if (text.startsWith("//") || text.startsWith("/*")) return current
  if (!text.endsWith("*/")) return -1
  let opening = current - 1
  while (opening >= 0 && !lines[opening]?.includes("/*")) opening -= 1
  return lines[opening]?.trim().startsWith("/*") ? current : -1
}

export function minimumControlCoverage(lineCount: number, controls: number): number {
  let minimum = 0
  if (controls >= 3 && controls <= 4) minimum = 2
  else if (controls >= 5 && controls <= 7) minimum = 3
  else if (controls >= 8) minimum = Math.min(8, 4 + Math.floor((controls - 8) / 3))
  if (lineCount >= 50 && controls >= 3) minimum = Math.max(minimum, 3)
  return minimum
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

function findExistingFunctionHeader(
  lines: string[],
  functionLine: number,
  eol: "\n" | "\r\n",
): FunctionTarget["existingFunctionHeader"] | undefined {
  const endLine = functionLine - 1
  const endText = lines[endLine]?.trim()
  if (!endText) return
  let startLine = endLine
  let style: FunctionHeaderStyle | undefined
  if (endText.startsWith("//")) {
    style = "line"
    while (startLine > 0 && lines[startLine - 1]?.trim().startsWith("//")) startLine -= 1
  } else if (endText.endsWith("*/")) {
    while (startLine >= 0 && !lines[startLine]?.includes("/*")) startLine -= 1
    if (startLine < 0) return
    const start = lines[startLine]!.trim()
    if (!start.startsWith("/*")) return
    style = start.startsWith("/**") ? "docBlock" : "block"
  }
  if (!style) return
  const text = lines.slice(startLine, endLine + 1).join(eol)
  return { startLine, endLine, text, hash: sha256(text), style, tagContract: doxygenTagContract(text) }
}

export function doxygenTagContract(text: string): DoxygenTagContract[] {
  return text
    .split(/\r?\n/)
    .map(commentContentLine)
    .map((line) => tagContractLine(line))
    .filter((tag): tag is DoxygenTagContract => tag !== undefined)
}

function commentContentLine(line: string): string {
  return line
    .trim()
    .replace(/^\/\*+[!]?\s?/, "")
    .replace(/^\/\/[/!]?\s?/, "")
    .replace(/\s*\*\/\s*$/, "")
    .replace(/^\*\s?/, "")
    .trim()
}

function tagContractLine(line: string): DoxygenTagContract | undefined {
  const match = line.match(/^@(\w+)\b(.*)$/u)
  if (!match) return
  const name = match[1]!.toLocaleLowerCase()
  const rest = match[2] ?? ""
  if (name === "param" || name === "tparam") {
    const value = rest.match(/^\s*(?:\[([^\]]+)\])?\s*(\S+)?/u)
    const direction = value?.[1]?.replace(/\s+/gu, "").toLocaleLowerCase() ?? ""
    const parameter = value?.[2] ?? ""
    return { name, identity: `${direction}:${parameter}` }
  }
  if (name === "retval" || name === "throws" || name === "exception") {
    return { name, identity: rest.trim().split(/\s+/, 1)[0] ?? "" }
  }
  if (name === "brief" || name === "note" || name === "return" || name === "returns") {
    return { name, identity: "" }
  }
  return { name, identity: "", rawLine: line }
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
