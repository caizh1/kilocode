import crypto from "node:crypto"
import type Parser from "web-tree-sitter"
import { getAst, getTreePathAtCursor } from "../autocomplete/continuedev/core/autocomplete/util/ast"
import type {
  DeclarationDoxygenTagContract,
  DeclarationHeaderStyle,
  DeclarationKind,
  DeclarationMemberAnchor,
  DeclarationTarget,
  DeclarationTargetInput,
  DeclarationTargetRangeInput,
} from "./types"

type SyntaxNode = Parser.SyntaxNode

const AGGREGATES = new Set(["struct_specifier", "union_specifier", "enum_specifier"])
const MACROS = new Set(["preproc_def", "preproc_function_def"])

export async function resolveDeclarationTarget(input: DeclarationTargetInput): Promise<DeclarationTarget | undefined> {
  if (!isSupportedDeclarationLanguage(input.languageId)) return
  if (input.cursorOffset < 0 || input.cursorOffset > input.documentText.length) return
  const ast = await getAst(input.filePath, input.documentText)
  if (!ast) return
  try {
    const path = await getTreePathAtCursor(ast, input.cursorOffset)
    const pathNode = canonicalDeclarationFromPath(path)
    const node =
      pathNode && containsOffset(pathNode, input.cursorOffset)
        ? pathNode
        : smallestDeclarationContaining(ast.rootNode, input.cursorOffset)
    if (!node) return
    return buildDeclarationTarget({ ...input, languageId: input.languageId }, ast.rootNode, node)
  } finally {
    ast.delete()
  }
}

function smallestDeclarationContaining(root: SyntaxNode, offset: number): SyntaxNode | undefined {
  const candidates = new Map<string, SyntaxNode>()
  const visit = (node: SyntaxNode) => {
    if (!containsOffset(node, offset)) return
    const canonical = canonicalDeclarationNode(node)
    if (canonical && containsOffset(canonical, offset)) {
      candidates.set(`${canonical.startIndex}:${canonical.endIndex}`, canonical)
    }
    for (const child of node.namedChildren) visit(child)
  }
  visit(root)
  return [...candidates.values()].sort(
    (left, right) => left.endIndex - left.startIndex - (right.endIndex - right.startIndex),
  )[0]
}

function containsOffset(node: SyntaxNode, offset: number): boolean {
  return node.startIndex <= offset && offset < node.endIndex
}

export async function resolveDeclarationTargetsInRange(
  input: DeclarationTargetRangeInput,
): Promise<DeclarationTarget[]> {
  if (!isSupportedDeclarationLanguage(input.languageId)) return []
  const languageId = input.languageId
  const start = Math.max(0, Math.min(input.selectionStartOffset, input.selectionEndOffset))
  const end = Math.min(input.documentText.length, Math.max(input.selectionStartOffset, input.selectionEndOffset))
  if (start === end) return []
  const ast = await getAst(input.filePath, input.documentText)
  if (!ast) return []
  try {
    const nodes: SyntaxNode[] = []
    const seen = new Set<string>()
    const visit = (node: SyntaxNode) => {
      const canonical = canonicalDeclarationNode(node)
      if (canonical && canonical.startIndex < end && canonical.endIndex > start) {
        const key = `${canonical.startIndex}:${canonical.endIndex}`
        if (!seen.has(key)) {
          nodes.push(canonical)
          seen.add(key)
        }
        if (canonical === node) return
      }
      for (const child of node.namedChildren) visit(child)
    }
    visit(ast.rootNode)
    return nodes
      .sort((left, right) => left.startIndex - right.startIndex)
      .map((node) => buildDeclarationTarget({ ...input, languageId }, ast.rootNode, node))
      .filter((target): target is DeclarationTarget => target !== undefined)
  } finally {
    ast.delete()
  }
}

function canonicalDeclarationFromPath(path: SyntaxNode[]): SyntaxNode | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const candidate = canonicalDeclarationNode(path[index]!)
    if (candidate) return candidate
  }
}

function canonicalDeclarationNode(node: SyntaxNode): SyntaxNode | undefined {
  if (MACROS.has(node.type)) return insideFunction(node) ? undefined : node
  if (node.type === "type_definition") return validTypeDefinition(node) ? node : undefined
  if (AGGREGATES.has(node.type)) {
    if (!aggregateHasBody(node)) return
    const typeDefinition = nearestAncestor(node, "type_definition")
    if (typeDefinition) return validTypeDefinition(typeDefinition) ? typeDefinition : undefined
    const outerAggregate = outerAggregateAncestor(node)
    if (outerAggregate) return outerAggregate
    return node
  }
  if (node.type === "declaration" && isSupportedGlobalVariable(node)) return node
}

function buildDeclarationTarget(
  input: Omit<DeclarationTargetInput, "cursorOffset" | "languageId"> & { languageId: "c" | "cpp" },
  root: SyntaxNode,
  node: SyntaxNode,
): DeclarationTarget | undefined {
  if (node.isError || containsMissingNode(node)) return
  const lines = input.documentText.split(/\r?\n/)
  const startLine = node.startPosition.row
  const endLine = endLineInclusive(node, lines.length)
  if (startLine < 0 || endLine < startLine || endLine >= lines.length) return
  const kind = declarationKind(node)
  if (!kind) return
  const source = input.documentText.slice(node.startIndex, node.endIndex)
  const existingHeader = findExistingHeader(lines, startLine, input.eol)
  return {
    uri: input.uri,
    filePath: input.filePath,
    relativePath: input.relativePath,
    workspacePath: input.workspacePath,
    languageId: input.languageId,
    documentVersion: input.documentVersion,
    documentText: input.documentText,
    eol: input.eol,
    kind,
    displayName: declarationDisplayName(node, kind, source),
    declarationSource: source,
    declarationHash: hash(source),
    documentHash: hash(input.documentText),
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startLine,
    endLine,
    contextBefore: lines.slice(Math.max(0, startLine - 24), startLine).join(input.eol),
    contextAfter: lines.slice(endLine + 1, Math.min(lines.length, endLine + 17)).join(input.eol),
    headerStyle: detectHeaderStyle(root, lines),
    ...(existingHeader ? { existingHeader } : {}),
    existingComments: collectExistingComments(lines, startLine, endLine),
    memberAnchors: collectMemberAnchors(node, lines),
  }
}

function declarationKind(node: SyntaxNode): DeclarationKind | undefined {
  if (node.type === "preproc_function_def") return "function-macro"
  if (node.type === "preproc_def") return "object-macro"
  if (node.type === "declaration") return "global-variable"
  if (node.type === "type_definition") {
    const aggregate = findFirst(node, (child) => AGGREGATES.has(child.type))
    if (!aggregate) return "typedef"
    return aggregateKind(aggregate)
  }
  return aggregateKind(node)
}

function aggregateKind(node: SyntaxNode): "struct" | "union" | "enum" | undefined {
  if (node.type === "struct_specifier") return "struct"
  if (node.type === "union_specifier") return "union"
  if (node.type === "enum_specifier") return "enum"
}

function declarationDisplayName(node: SyntaxNode, kind: DeclarationKind, source: string): string {
  if (kind === "object-macro" || kind === "function-macro") {
    return node.childForFieldName("name")?.text ?? source.match(/^\s*#\s*define\s+([A-Za-z_]\w*)/u)?.[1] ?? "宏"
  }
  if (node.type === "type_definition") {
    const declarator = node.childForFieldName("declarator")
    if (declarator?.text) return declarator.text
  }
  if (AGGREGATES.has(node.type)) {
    const name = node.childForFieldName("name")?.text
    if (name) return name
  }
  if (kind === "global-variable") {
    const declarators = node.namedChildren
      .filter(
        (child) => child.type.includes("declarator") || child.type === "identifier" || child.type === "init_declarator",
      )
      .map((child) => child.text)
      .filter(Boolean)
    if (declarators.length > 0) return declarators.join(", ")
  }
  return `${kind}（第 ${node.startPosition.row + 1} 行）`
}

function collectMemberAnchors(node: SyntaxNode, lines: string[]): DeclarationMemberAnchor[] {
  const aggregate = node.type === "type_definition" ? findFirst(node, (child) => AGGREGATES.has(child.type)) : node
  if (!aggregate || !AGGREGATES.has(aggregate.type)) return []
  const body =
    aggregate.childForFieldName("body") ??
    aggregate.namedChildren.find((child) => child.type === "field_declaration_list" || child.type === "enumerator_list")
  if (!body) return []
  const expected = aggregate.type === "enum_specifier" ? "enumerator" : "field_declaration"
  const seenLines = new Set<number>()
  const members = body.namedChildren.filter((child) => {
    const line = child.startPosition.row
    if (child.type !== expected || line <= aggregate.startPosition.row || seenLines.has(line)) return false
    seenLines.add(line)
    return true
  })
  return members.slice(0, 80).map((member, index) => {
    const line = member.startPosition.row
    const text = lines[line] ?? ""
    return {
      id: `M${index + 1}`,
      kind: expected === "enumerator" ? "enumerator" : "field",
      label: memberLabel(member),
      startLine: line,
      endLine: endLineInclusive(member, lines.length),
      insertBeforeLine: line,
      targetLineText: text,
      indent: text.match(/^\s*/)?.[0] ?? "",
      existingCovered: leadingCommentLine(lines, line) >= 0 || trailingComment(member, lines),
    }
  })
}

function memberLabel(node: SyntaxNode): string {
  const declarator = node.childForFieldName("declarator") ?? node.childForFieldName("name")
  if (declarator?.text) return declarator.text
  return node.text.split(/[,;=]/u, 1)[0]!.trim().slice(0, 80)
}

function trailingComment(node: SyntaxNode, lines: string[]): boolean {
  const line = lines[endLineInclusive(node, lines.length)] ?? ""
  const endColumn = node.endPosition.row === node.startPosition.row ? node.endPosition.column : 0
  const trailing = endColumn > 0 ? line.slice(endColumn) : ""
  return /\/\/|\/\*/u.test(trailing)
}

function isSupportedGlobalVariable(node: SyntaxNode): boolean {
  if (!globalScope(node)) return false
  if (findFirst(node, isFunctionDeclaration)) return false
  if (findFirst(node, (child) => AGGREGATES.has(child.type) && aggregateHasBody(child))) return false
  return node.namedChildren.some(
    (child) => child.type === "identifier" || child.type.includes("declarator") || child.type === "init_declarator",
  )
}

function globalScope(node: SyntaxNode): boolean {
  let parent = node.parent
  while (parent?.type === "linkage_specification" || parent?.type === "declaration_list") {
    if (parent.type === "declaration_list" && parent.parent?.type === "namespace_definition") return true
    parent = parent.parent
  }
  return parent?.type === "translation_unit"
}

function isFunctionDeclaration(node: SyntaxNode): boolean {
  if (node.type !== "function_declarator") return false
  const declarator = node.childForFieldName("declarator")
  return declarator ? !containsNodeType(declarator, "pointer_declarator") : true
}

function containsNodeType(node: SyntaxNode, type: string): boolean {
  if (node.type === type) return true
  return node.namedChildren.some((child) => containsNodeType(child, type))
}

function validTypeDefinition(node: SyntaxNode): boolean {
  const aggregate = findFirst(node, (child) => AGGREGATES.has(child.type))
  return aggregate ? aggregateHasBody(aggregate) : true
}

function aggregateHasBody(node: SyntaxNode): boolean {
  return Boolean(
    node.childForFieldName("body") ??
      node.namedChildren.find((child) => child.type === "field_declaration_list" || child.type === "enumerator_list"),
  )
}

function insideFunction(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (current.type === "function_definition" || current.type === "lambda_expression") return true
    current = current.parent
  }
  return false
}

function nearestAncestor(node: SyntaxNode, type: string): SyntaxNode | undefined {
  let current = node.parent
  while (current) {
    if (current.type === type) return current
    current = current.parent
  }
}

function outerAggregateAncestor(node: SyntaxNode): SyntaxNode | undefined {
  let result: SyntaxNode | undefined
  let current = node.parent
  while (current) {
    if (AGGREGATES.has(current.type) && aggregateHasBody(current)) result = current
    if (current.type === "type_definition" || current.type === "declaration" || current.type === "translation_unit")
      break
    current = current.parent
  }
  return result
}

function findFirst(node: SyntaxNode, predicate: (node: SyntaxNode) => boolean): SyntaxNode | undefined {
  for (const child of node.namedChildren) {
    if (predicate(child)) return child
    const nested = findFirst(child, predicate)
    if (nested) return nested
  }
}

function containsMissingNode(node: SyntaxNode): boolean {
  if (node.isMissing) return true
  return node.namedChildren.some(containsMissingNode)
}

function findExistingHeader(
  lines: string[],
  declarationLine: number,
  eol: "\n" | "\r\n",
): DeclarationTarget["existingHeader"] | undefined {
  const endLine = declarationLine - 1
  const endText = lines[endLine]?.trim()
  if (!endText) return
  let startLine = endLine
  let style: DeclarationHeaderStyle | undefined
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
  if (startLine === 0 && isLicenseHeader(text)) return
  return { startLine, endLine, text, hash: hash(text), style, tagContract: declarationDoxygenTagContract(text) }
}

function detectHeaderStyle(root: SyntaxNode, lines: string[]): DeclarationHeaderStyle {
  const counts: Record<DeclarationHeaderStyle, number> = { docBlock: 0, block: 0, line: 0 }
  const visit = (node: SyntaxNode) => {
    const canonical = canonicalDeclarationNode(node)
    if (canonical === node) {
      const style = leadingCommentStyle(lines, node.startPosition.row)
      if (style) counts[style] += 1
      return
    }
    for (const child of node.namedChildren) visit(child)
  }
  visit(root)
  return (Object.keys(counts) as DeclarationHeaderStyle[]).sort(
    (left, right) => counts[right] - counts[left] || styleOrder(left) - styleOrder(right),
  )[0]!
}

function leadingCommentStyle(lines: string[], startLine: number): DeclarationHeaderStyle | undefined {
  let line = startLine - 1
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

function styleOrder(style: DeclarationHeaderStyle): number {
  if (style === "docBlock") return 0
  if (style === "block") return 1
  return 2
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
  for (let line = Math.max(0, startLine - 10); line <= endLine; line += 1) {
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
  return result.slice(0, 16)
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

function endLineInclusive(node: SyntaxNode, lineCount: number): number {
  if (node.endPosition.column > 0) return Math.min(lineCount - 1, node.endPosition.row)
  return Math.min(lineCount - 1, Math.max(node.startPosition.row, node.endPosition.row - 1))
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function isLicenseHeader(text: string): boolean {
  return /SPDX-License-Identifier|copyright\b|licensed under|permission is hereby granted|all rights reserved/iu.test(
    text,
  )
}

function isSupportedDeclarationLanguage(languageId: string): languageId is "c" | "cpp" {
  return languageId === "c" || languageId === "cpp"
}

export function declarationDoxygenTagContract(text: string): DeclarationDoxygenTagContract[] {
  return text
    .split(/\r?\n/u)
    .map((line) =>
      line
        .trim()
        .replace(/^\/\*+[!]?\s?/u, "")
        .replace(/^\/\/[/!]?\s?/u, "")
        .replace(/\s*\*\/\s*$/u, "")
        .replace(/^\*\s?/u, "")
        .trim(),
    )
    .map(declarationTagContractLine)
    .filter((tag): tag is DeclarationDoxygenTagContract => tag !== undefined)
}

function declarationTagContractLine(line: string): DeclarationDoxygenTagContract | undefined {
  const match = line.match(/^@(\w+)\b(.*)$/u)
  if (!match) return
  const name = match[1]!.toLocaleLowerCase()
  const rest = match[2] ?? ""
  if (name === "param" || name === "tparam") {
    const value = rest.match(/^\s*(?:\[([^\]]+)\])?\s*(\S+)?/u)
    const direction = value?.[1]?.replace(/\s+/gu, "").toLocaleLowerCase() ?? ""
    return { name, identity: `${direction}:${value?.[2] ?? ""}` }
  }
  if (name === "retval" || name === "throws" || name === "exception") {
    return { name, identity: rest.trim().split(/\s+/u, 1)[0] ?? "" }
  }
  if (name === "brief" || name === "note" || name === "return" || name === "returns") {
    return { name, identity: "" }
  }
  return { name, identity: "", rawLine: line }
}
