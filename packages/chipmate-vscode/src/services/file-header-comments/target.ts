import crypto from "node:crypto"
import type Parser from "web-tree-sitter"
import { getAst } from "../autocomplete/continuedev/core/autocomplete/util/ast"
import type { FileHeaderStyle, FileHeaderTagContract, FileHeaderTarget } from "./types"

type SyntaxNode = Parser.SyntaxNode

export async function resolveFileHeaderTarget(input: {
  uri: string
  filePath: string
  relativePath: string
  workspacePath: string
  languageId: string
  documentVersion: number
  documentText: string
  eol: "\n" | "\r\n"
}): Promise<FileHeaderTarget | undefined> {
  if (input.languageId !== "c" && input.languageId !== "cpp") return
  if (!input.documentText.trim()) return
  const lines = input.documentText.split(/\r?\n/u)
  const leading = leadingPreamble(lines)
  const anchorLine = leading.existing?.startLine ?? leading.nextLine
  if (anchorLine < 0 || anchorLine >= lines.length) return
  const ast = await getAst(input.filePath, input.documentText)
  if (!ast) return
  try {
    return {
      ...input,
      languageId: input.languageId,
      documentHash: hash(input.documentText),
      anchorLine,
      anchorLineText: lines[anchorLine] ?? "",
      style: leading.existing?.style ?? detectStyle(ast.rootNode, input.documentText),
      evidence: buildEvidence(ast.rootNode, input.documentText, input.eol),
      ...(leading.existing
        ? {
            existingHeader: {
              ...leading.existing,
              tagContract: fileHeaderTagContract(leading.existing.text),
              meaningful: meaningfulHeader(leading.existing.text),
            },
          }
        : {}),
    }
  } finally {
    ast.delete()
  }
}

type CommentGroup = Readonly<{
  startLine: number
  endLine: number
  text: string
  style: FileHeaderStyle
}>

function leadingPreamble(lines: readonly string[]): { nextLine: number; existing?: CommentGroup } {
  let line = 0
  while (line < lines.length && !cleanLine(lines[line] ?? "").trim()) line += 1
  while (line < lines.length) {
    const group = commentGroup(lines, line)
    if (!group) break
    if (!isLicenseHeader(group.text)) {
      if (isModuleHeader(lines, group)) return { nextLine: group.startLine, existing: group }
      return { nextLine: group.startLine }
    }
    line = group.endLine + 1
    while (line < lines.length && !lines[line]?.trim()) line += 1
  }
  return { nextLine: line }
}

function commentGroup(lines: readonly string[], startLine: number): CommentGroup | undefined {
  const first = cleanLine(lines[startLine] ?? "").trimStart()
  if (first.startsWith("//")) {
    let endLine = startLine
    while (endLine + 1 < lines.length && lines[endLine + 1]?.trimStart().startsWith("//")) endLine += 1
    return {
      startLine,
      endLine,
      text: lines.slice(startLine, endLine + 1).join("\n"),
      style: "line",
    }
  }
  if (!first.startsWith("/*")) return
  let endLine = startLine
  while (endLine < lines.length && !lines[endLine]?.includes("*/")) endLine += 1
  if (endLine >= lines.length) return
  return {
    startLine,
    endLine,
    text: lines.slice(startLine, endLine + 1).join("\n"),
    style: first.startsWith("/**") ? "docBlock" : "block",
  }
}

function isModuleHeader(lines: readonly string[], group: CommentGroup): boolean {
  if (/@(?:file|defgroup|addtogroup)\b/iu.test(group.text)) return true
  const next = group.endLine + 1
  if (!lines[next]?.trim()) return true
  return /^\s*#\s*(?:ifndef|define|pragma|include)\b/u.test(lines[next] ?? "")
}

function cleanLine(value: string): string {
  return value.replace(/^\uFEFF/u, "")
}

function isLicenseHeader(text: string): boolean {
  return /SPDX-License-Identifier|copyright\b|licensed under|permission is hereby granted|all rights reserved|GNU (?:General Public|Lesser General Public) License|Apache License|MIT License|BSD License|Mozilla Public License|redistribution and use|without warranty|版权所有|许可协议/iu.test(
    text,
  )
}

function detectStyle(root: SyntaxNode, source: string): FileHeaderStyle {
  const comments: SyntaxNode[] = []
  const visit = (node: SyntaxNode) => {
    if (node.type === "comment") comments.push(node)
    if (comments.length >= 20) return
    for (const child of node.namedChildren) visit(child)
  }
  visit(root)
  for (const comment of comments) {
    const text = source.slice(comment.startIndex, comment.endIndex).trimStart()
    if (isLicenseHeader(text)) continue
    if (text.startsWith("/**")) return "docBlock"
    if (text.startsWith("/*")) return "block"
    if (text.startsWith("//")) return "line"
  }
  return "docBlock"
}

function buildEvidence(root: SyntaxNode, source: string, eol: "\n" | "\r\n"): string {
  const entries: string[] = []
  let size = 0
  for (const node of root.namedChildren) {
    if (node.type === "comment") continue
    const raw = source.slice(node.startIndex, node.endIndex).trim()
    if (!raw) continue
    const compact =
      raw.length > 2400
        ? `${raw.slice(0, 1800)}\n/* 中间内容省略 */\n${raw.slice(Math.max(1800, raw.length - 500))}`
        : raw
    const entry = `[${node.type} ${node.startPosition.row + 1}-${node.endPosition.row + 1}]\n${compact}`
    if (size + entry.length > 100_000) break
    entries.push(entry)
    size += entry.length
  }
  return entries.join(`${eol}${eol}`)
}

export function meaningfulHeader(text: string): boolean {
  const body = text
    .split(/\r?\n/u)
    .map((line) =>
      line
        .trim()
        .replace(/^\/\*+[!]?\s?/u, "")
        .replace(/^\/\/[\/]?[!]?\s?/u, "")
        .replace(/^\*\s?/u, "")
        .replace(/\*\/$/u, "")
        .replace(/^@\w+\b/u, "")
        .trim(),
    )
    .filter(Boolean)
    .join("")
    .replace(/\b(?:NA|NONE|N\/A|TODO|TBD)\b/giu, "")
    .replace(/(?:无|暂无|待补充|未知)/gu, "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
  return body.length >= 6
}

export function fileHeaderTagContract(text: string): FileHeaderTagContract[] {
  return text
    .split(/\r?\n/u)
    .map((line) =>
      line
        .trim()
        .replace(/^\/\*+[!]?\s?/u, "")
        .replace(/^\/\/[\/]?[!]?\s?/u, "")
        .replace(/\s*\*\/\s*$/u, "")
        .replace(/^\*\s?/u, "")
        .trim(),
    )
    .map(tagContractLine)
    .filter((tag): tag is FileHeaderTagContract => tag !== undefined)
}

function tagContractLine(line: string): FileHeaderTagContract | undefined {
  const match = line.match(/^@(\w+)\b(.*)$/u)
  if (!match) return
  const name = match[1]!.toLocaleLowerCase()
  const rest = match[2]?.trim() ?? ""
  if (name === "file") return { name, identity: rest.split(/\s+/u)[0] ?? "" }
  if (["brief", "details", "note", "warning", "since", "version"].includes(name)) return { name, identity: "" }
  return { name, identity: rest, rawLine: line }
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}
