import path from "node:path"
import { CODE_POSTINGS_FIELD_WEIGHTS } from "../constants"
import type { CodePostingsField } from "../types"

const stop = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
])

export type LexicalToken = {
  term: string
  field: CodePostingsField
  weight: number
}

export function tokenizeQuery(query: string): string[] {
  return unique([...tokens(query, "code").map((item) => item.term), ...pathTokens(query).map((item) => item.term)])
}

export function tokenizeField(text: string, field: CodePostingsField): LexicalToken[] {
  return tokens(text, field)
}

export function tokenizePath(filePath: string): LexicalToken[] {
  return pathTokens(filePath)
}

export function extractCommentTokens(
  text: string,
): Array<{ startLine: number; endLine: number; snippet: string; tokens: LexicalToken[] }> {
  const out: Array<{ startLine: number; endLine: number; snippet: string; tokens: LexicalToken[] }> = []
  const starts = lines(text)
  const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const raw = match[0]
    const cleaned = raw
      .replace(/^\/\*/, "")
      .replace(/\*\/$/, "")
      .replace(/^\/\//, "")
      .replace(/^\s*\*/gm, "")
      .trim()
    const item = tokens(cleaned, "comment")
    if (!item.length) continue
    const startLine = lineFor(starts, match.index)
    const endLine = lineFor(starts, match.index + raw.length)
    out.push({
      startLine,
      endLine,
      snippet: clip(cleaned, 240),
      tokens: item,
    })
  }
  return out
}

function pathTokens(input: string): LexicalToken[] {
  const parts = input
    .split(/[\\/._-]+/g)
    .flatMap((item) => item.split(path.sep))
    .filter(Boolean)
  return parts.flatMap((item) => tokens(item, "path"))
}

function tokens(input: string, field: CodePostingsField): LexicalToken[] {
  const out: LexicalToken[] = []
  const pattern = /[A-Za-z_][A-Za-z0-9_]*|0x[0-9A-Fa-f]+|\d+[A-Za-z_]*|[A-Za-z_]+\d+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input))) {
    for (const part of split(match[0])) {
      const term = part.toLowerCase()
      if ((term.length < 2 && !/^\d+$/.test(term)) || stop.has(term)) continue
      out.push({
        term,
        field,
        weight: CODE_POSTINGS_FIELD_WEIGHTS[field],
      })
    }
  }
  return out
}

function split(value: string): string[] {
  const snake = value.split(/_+/g).filter(Boolean)
  const words = snake.flatMap((item) => item.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g))
  const expanded = new Set<string>()
  expanded.add(value)
  for (const word of words) {
    expanded.add(word)
    const numeric = /^([A-Za-z]+)(\d+)$/.exec(word) ?? /^(\d+)([A-Za-z]+)$/.exec(word)
    if (numeric) {
      expanded.add(numeric[1])
      expanded.add(numeric[2])
    }
    const register = /^([A-Za-z]+)(\d+)([A-Za-z]+)$/.exec(word)
    if (register) {
      expanded.add(register[1])
      expanded.add(register[2])
      expanded.add(register[3])
    }
  }
  return [...expanded]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function lines(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") starts.push(index + 1)
  }
  return starts
}

function lineFor(starts: number[], index: number): number {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (starts[mid] <= index) low = mid + 1
    else high = mid - 1
  }
  return high + 1
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
