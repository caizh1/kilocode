import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_POSTINGS_SCHEMA_VERSION,
  CODE_POSTINGS_TOKENIZER_VERSION,
} from "../constants"
import type {
  CodeGraphFileGraph,
  CodeGraphLineRange,
  CodePostingsDocument,
  CodePostingsField,
  CodePostingsRange,
  CodePostingsTermDocument,
} from "../types"
import { dict, own } from "../dict"
import { extractCommentTokens, tokenizeField, tokenizePath, type LexicalToken } from "./tokenizer"

type Entry = CodePostingsRange & {
  tokens: LexicalToken[]
}

export function buildPostingsDocument(input: {
  workspacePath: string
  graph: CodeGraphFileGraph
  content?: string
  updatedAt: string
}): CodePostingsDocument {
  const entries = collect(input.graph, input.content)
  const terms = dict<CodePostingsTermDocument>()

  for (const entry of entries) {
    if (!range(entry)) continue
    for (const token of entry.tokens) {
      const current = own(terms, token.term) ?? term(input.graph)
      current.termFrequency += 1
      current.weightedFrequency += token.weight
      current.fields[token.field] = (current.fields[token.field] ?? 0) + token.weight
      current.ranges.push({
        field: entry.field,
        kind: entry.kind,
        displayName: entry.displayName,
        weight: token.weight,
        startLine: entry.startLine,
        endLine: entry.endLine,
        ...(entry.shortSnippet ? { shortSnippet: entry.shortSnippet } : {}),
      })
      terms[token.term] = current
    }
  }

  const documentLength = Object.values(terms).reduce((sum, item) => sum + item.weightedFrequency, 0)

  return {
    workspacePath: input.workspacePath,
    postingsSchemaVersion: CODE_POSTINGS_SCHEMA_VERSION,
    tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
    graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
    parserVersion: CODE_GRAPH_PARSER_VERSION,
    filePath: input.graph.filePath,
    fileHash: input.graph.fileHash,
    documentLength,
    terms,
    updatedAt: input.updatedAt,
  }
}

function term(graph: CodeGraphFileGraph): CodePostingsTermDocument {
  return {
    filePath: graph.filePath,
    fileHash: graph.fileHash,
    termFrequency: 0,
    weightedFrequency: 0,
    fields: dict<number>(),
    ranges: [],
  }
}

function collect(graph: CodeGraphFileGraph, content?: string): Entry[] {
  const entries: Entry[] = []
  entries.push({
    field: "path",
    kind: "file",
    displayName: graph.filePath,
    startLine: 1,
    endLine: 1,
    weight: 1,
    tokens: tokenizePath(graph.filePath),
  })

  for (const item of graph.includes) {
    entries.push(entry("path", "include", item.target, item, [item.target, item.shortSnippet]))
  }
  for (const item of graph.macros) {
    entries.push(entry("macro", "macro", item.name, item, [item.name, item.shortSnippet]))
  }
  for (const item of graph.functions) {
    entries.push(entry("symbol", "function", item.name, item, [item.name, item.signature, item.shortSnippet]))
    for (const call of item.calls) {
      entries.push(
        entry("code", "call", `${call.callerName} -> ${call.calleeName}`, call, [
          call.callerName,
          call.calleeName,
          call.shortSnippet,
        ]),
      )
    }
  }
  for (const item of graph.declarations) {
    entries.push(entry("symbol", "declaration", item.name, item, [item.name, item.signature, item.shortSnippet]))
  }
  for (const item of graph.types) {
    entries.push(entry("type", item.kind, item.name, item, [item.kind, item.name, item.shortSnippet]))
  }
  for (const item of graph.globals) {
    entries.push(entry("symbol", "global", item.name, item, [item.name, item.shortSnippet]))
  }
  for (const item of graph.labels) {
    entries.push(
      entry("code", item.kind, item.name, item, [
        item.name,
        item.functionName,
        item.cleanupCalls.join(" "),
        item.shortSnippet,
      ]),
    )
  }
  for (const item of graph.initializers) {
    entries.push(
      entry("code", "initializer", item.typeName ?? "initializer", item, [
        item.typeName,
        item.fields.join(" "),
        item.shortSnippet,
      ]),
    )
  }
  for (const item of graph.registerMacroFamilies) {
    entries.push(
      entry("macro", "register_macro_family", item.family, item, [
        item.family,
        item.path,
        item.mmioIdentifiers.join(" "),
        item.macros.map((macro) => macro.name).join(" "),
        item.shortSnippet,
      ]),
    )
  }

  if (content) {
    for (const item of extractCommentTokens(content)) {
      entries.push({
        field: "comment",
        kind: "comment",
        displayName: "comment",
        startLine: item.startLine,
        endLine: item.endLine,
        weight: 1,
        shortSnippet: item.snippet,
        tokens: item.tokens,
      })
    }
  }

  return entries
}

function entry(
  field: CodePostingsField,
  kind: string,
  displayName: string,
  item: CodeGraphLineRange & { shortSnippet?: string },
  texts: Array<string | undefined>,
): Entry {
  return {
    field,
    kind,
    displayName,
    startLine: item.startLine,
    endLine: item.endLine,
    weight: 1,
    ...(item.shortSnippet ? { shortSnippet: item.shortSnippet } : {}),
    tokens: texts.filter(Boolean).flatMap((text) => tokenizeField(text!, field)),
  }
}

function range(item: Partial<CodeGraphLineRange>): item is CodeGraphLineRange {
  return (
    Number.isFinite(item.startLine) &&
    Number.isFinite(item.endLine) &&
    item.startLine! > 0 &&
    item.endLine! >= item.startLine!
  )
}
