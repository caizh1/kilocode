import path from "path"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS,
  CODE_GRAPH_SUPPORTED_EXTENSIONS,
} from "../constants"
import type {
  CodeGraphCall,
  CodeGraphDeclaration,
  CodeGraphFileGraph,
  CodeGraphFunction,
  CodeGraphGlobalSymbol,
  CodeGraphInclude,
  CodeGraphInitializer,
  CodeGraphLabel,
  CodeGraphLanguage,
  CodeGraphMacro,
  CodeGraphRegisterMacroFamily,
  CodeGraphTypeField,
  CodeGraphTypeSymbol,
} from "../types"

const control = new Set([
  "if",
  "for",
  "while",
  "switch",
  "return",
  "sizeof",
  "alignof",
  "defined",
  "case",
  "do",
  "else",
])

const excludes = new Set([
  ...control,
  "typedef",
  "struct",
  "union",
  "enum",
  "static_assert",
  "__attribute__",
  "__declspec",
])

export function isCodeGraphSupportedPath(file: string): boolean {
  return CODE_GRAPH_SUPPORTED_EXTENSIONS.includes(path.extname(file).toLowerCase() as never)
}

export function parseCodeGraphFile(input: {
  workspacePath: string
  filePath: string
  content: string
  fileHash: string
  updatedAt?: string
}): CodeGraphFileGraph {
  if (!isCodeGraphSupportedPath(input.filePath)) {
    throw new Error(`Unsupported code graph file extension: ${input.filePath}`)
  }

  const masked = mask(input.content)
  const starts = lines(input.content)
  const functions = funcs(input.filePath, input.content, masked, starts)
  const types = typeSymbols(input.content, masked, starts)
  const declarations = decls(input.content, masked, starts, functions, types)
  const globals = globalSymbols(input.content, masked, starts, functions, types)
  const macros = macroSymbols(input.content, masked, starts)
  const initializers = initSymbols(input.content, masked, starts)
  const labels = labelSymbols(input.content, functions)
  const registerMacroFamilies = regFamilies(input.filePath, macros)
  const calls = functions.flatMap((fn) => fn.calls)

  return {
    workspacePath: input.workspacePath,
    graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
    parserVersion: CODE_GRAPH_PARSER_VERSION,
    filePath: input.filePath,
    fileHash: input.fileHash,
    language: lang(input.filePath),
    includes: includeSymbols(input.content, masked, starts),
    macros,
    functions,
    declarations,
    calls,
    types,
    globals,
    initializers,
    labels,
    registerMacroFamilies,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }
}

function includeSymbols(original: string, masked: string, starts: number[]): CodeGraphInclude[] {
  const result: CodeGraphInclude[] = []
  const pattern = /^[^\S\r\n]*#[^\S\r\n]*include[^\S\r\n]+([<"])([^>"\r\n]+)[>"]/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(original))) {
    if (!activeDirective(masked, match)) continue
    const line = lineFor(starts, match.index)
    result.push({
      target: match[2].trim(),
      system: match[1] === "<",
      startLine: line,
      endLine: line,
      shortSnippet: lineText(original, starts, line),
    })
  }
  return result
}

function macroSymbols(original: string, masked: string, starts: number[]): CodeGraphMacro[] {
  const result: CodeGraphMacro[] = []
  const pattern = /^[^\S\r\n]*#[^\S\r\n]*define[^\S\r\n]+([A-Za-z_]\w*)(?:[^\S\r\n]*\(((?:[^)\r\n]|\\(?:\r\n|\n|\r))*)\))?/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(original))) {
    if (!activeDirective(masked, match)) continue
    const line = lineFor(starts, match.index)
    const macro: CodeGraphMacro = {
      kind: "macro",
      name: match[1],
      startLine: line,
      endLine: line,
      shortSnippet: lineText(original, starts, line),
    }
    const params = match[2]
      ?.replace(/\\(?:\r\n|\n|\r)/g, " ")
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    if (params?.length) macro.parameters = params
    result.push(macro)
  }
  return result
}

function activeDirective(masked: string, match: RegExpExecArray): boolean {
  const hash = match[0].indexOf("#")
  return hash >= 0 && masked[match.index + hash] === "#"
}

function funcs(file: string, original: string, masked: string, starts: number[]): CodeGraphFunction[] {
  const result: CodeGraphFunction[] = []
  for (let index = 0; index < masked.length; index++) {
    if (masked[index] !== "{") continue
    const candidate = fnCandidate(masked, index)
    if (!candidate) continue
    const end = closeBrace(masked, index)
    if (end === -1) continue
    const body = masked.slice(index + 1, end)
    const startLine = lineFor(starts, candidate.nameIndex)
    const endLine = lineFor(starts, end)
    const signature = compact(masked.slice(candidate.start, index))
    const id = `${file}:${candidate.name}:${startLine}`
    result.push({
      kind: "function",
      id,
      name: candidate.name,
      signature,
      startLine,
      endLine,
      isStatic: /\bstatic\b/.test(signature),
      calls: callSymbols(body, original, index + 1, starts, candidate.name),
      shortSnippet: short(`${signature} { ... }`),
    })
    index = end
  }
  return result
}

function decls(
  original: string,
  masked: string,
  starts: number[],
  functions: CodeGraphFunction[],
  types: CodeGraphTypeSymbol[],
): CodeGraphDeclaration[] {
  const result: CodeGraphDeclaration[] = []
  const ranges = [...functions, ...types].map((item) => ({ start: item.startLine, end: item.endLine }))
  const rows = masked.split(/\r?\n/)
  for (let index = 0; index < rows.length; index++) {
    const line = index + 1
    const statement = compact(rows[index].replace(/;.*/, ""))
    if (!rows[index].trim().endsWith(";")) continue
    if (!statement.includes("(") || statement.includes("{") || statement.includes("}")) continue
    const decl = /^(.+?\b([A-Za-z_]\w*)\s*\([^;{}]*\))$/.exec(statement)
    if (!decl) continue
    const name = decl[2]
    if (!name || excludes.has(name)) continue
    if (ranges.some((range) => line >= range.start && line <= range.end)) continue
    const signature = decl[1]
    if (!signature || /\btypedef\b/.test(signature)) continue
    result.push({
      kind: "function",
      name,
      signature,
      startLine: line,
      endLine: line,
      shortSnippet: lineText(original, starts, line),
    })
  }
  return result
}

function callSymbols(
  body: string,
  original: string,
  offset: number,
  starts: number[],
  caller: string,
): CodeGraphCall[] {
  const result = new Map<string, CodeGraphCall>()
  const pattern = /\b([A-Za-z_]\w*)\s*\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body))) {
    const name = match[1]
    if (excludes.has(name)) continue
    const before = body.slice(Math.max(0, match.index - 24), match.index)
    if (/\b(struct|union|enum|typedef)\s+$/.test(before)) continue
    const line = lineFor(starts, offset + match.index)
    const key = `${caller}:${name}:${line}`
    if (result.has(key)) continue
    const open = body.indexOf("(", match.index + name.length)
    const close = open === -1 ? -1 : closeParen(body, open)
    const snippet = lineText(original, starts, line)
    result.set(key, {
      callerName: caller,
      calleeName: name,
      startLine: line,
      endLine: line,
      args: close === -1 ? [] : splitArgs(original.slice(offset + open + 1, offset + close)),
      returnHandling: ret(snippet, name),
      shortSnippet: snippet,
    })
  }
  return [...result.values()]
}

function typeSymbols(original: string, masked: string, starts: number[]): CodeGraphTypeSymbol[] {
  const result = new Map<string, CodeGraphTypeSymbol>()
  const tags = /\b(struct|union|enum)\s+([A-Za-z_]\w*)\b[^;{]*\{/g
  let match: RegExpExecArray | null
  while ((match = tags.exec(masked))) {
    const brace = masked.indexOf("{", match.index)
    const end = brace === -1 ? -1 : closeBrace(masked, brace)
    if (end === -1) continue
    const startLine = lineFor(starts, match.index)
    const endLine = lineFor(starts, end)
    const kind = match[1] as "struct" | "union" | "enum"
    const symbol: CodeGraphTypeSymbol = {
      kind,
      name: match[2],
      startLine,
      endLine,
      shortSnippet: short(original.slice(match.index, end + 1)),
      fields: kind === "enum" ? [] : fields(original, masked, brace + 1, end, starts),
    }
    result.set(`${kind}:${symbol.name}:${startLine}`, symbol)
    tags.lastIndex = end + 1
  }

  const aggregate = /\btypedef\s+(struct|union)\b[^;{]*\{/g
  while ((match = aggregate.exec(masked))) {
    const brace = masked.indexOf("{", match.index)
    const end = brace === -1 ? -1 : closeBrace(masked, brace)
    const semi = end === -1 ? -1 : masked.indexOf(";", end)
    if (end === -1 || semi === -1) continue
    const name = masked.slice(end + 1, semi).match(/\b([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/)?.[1]
    if (!name || control.has(name)) continue
    const startLine = lineFor(starts, match.index)
    const symbol: CodeGraphTypeSymbol = {
      kind: "typedef",
      name,
      startLine,
      endLine: lineFor(starts, semi),
      shortSnippet: short(original.slice(match.index, semi + 1)),
      fields: fields(original, masked, brace + 1, end, starts),
    }
    result.set(`typedef:${name}:${startLine}`, symbol)
    aggregate.lastIndex = semi + 1
  }

  const typedef = /\btypedef\b[\s\S]*?;/g
  while ((match = typedef.exec(masked))) {
    const statement = match[0]
    if (statement.includes("{")) continue
    if (statement.includes("(") && !/\btypedef\s+(?:struct|union|enum)\b[\s\S]*\{/.test(statement)) continue
    const name = statement.match(/\b([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;$/)?.[1]
    if (!name || control.has(name)) continue
    const startLine = lineFor(starts, match.index)
    const symbol: CodeGraphTypeSymbol = {
      kind: "typedef",
      name,
      startLine,
      endLine: lineFor(starts, match.index + statement.length),
      shortSnippet: short(original.slice(match.index, match.index + statement.length)),
      fields: typedefFields(original, masked, match.index, statement, starts),
    }
    result.set(`typedef:${name}:${startLine}`, symbol)
  }

  return [...result.values()].sort(
    (left, right) => left.startLine - right.startLine || left.name.localeCompare(right.name),
  )
}

function globalSymbols(
  original: string,
  masked: string,
  starts: number[],
  functions: CodeGraphFunction[],
  types: CodeGraphTypeSymbol[],
): CodeGraphGlobalSymbol[] {
  const ranges = [...functions, ...types].map((item) => ({ start: item.startLine, end: item.endLine }))
  const result: CodeGraphGlobalSymbol[] = []
  const rows = masked.split(/\r?\n/)
  let offset = 0
  for (let index = 0; index < rows.length; index++) {
    const line = index + 1
    const raw = rows[index]
    const trimmed = raw.trim()
    const start = offset
    offset += raw.length + 1
    if (!trimmed || !trimmed.endsWith(";")) continue
    if (ranges.some((range) => line >= range.start && line <= range.end)) continue
    if (/^#/.test(trimmed)) continue
    if (/\b(typedef|struct|union|enum|return|if|for|while|switch)\b/.test(trimmed)) continue
    if (trimmed.includes("(")) continue
    const base = trimmed.replace(/=.*/, "").replace(/;.*/, "").trim()
    const name = base.match(/\b([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?$/)?.[1]
    if (!name || control.has(name)) continue
    result.push({
      kind: "global",
      name,
      startLine: line,
      endLine: line,
      shortSnippet: lineText(original, starts, lineFor(starts, start)),
    })
  }
  return result
}

function initSymbols(original: string, masked: string, starts: number[]): CodeGraphInitializer[] {
  const result: CodeGraphInitializer[] = []
  const pattern = /=\s*\{/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(masked))) {
    const brace = masked.indexOf("{", match.index)
    const end = brace === -1 ? -1 : closeBrace(masked, brace)
    if (end === -1) continue
    const semi = masked.indexOf(";", end)
    if (semi === -1) continue
    const start = initStart(masked, match.index)
    const fields = unique([...original.slice(brace, end).matchAll(/\.([A-Za-z_]\w*)\s*=/g)].map((item) => item[1]))
    if (!fields.length) continue
    result.push({
      typeName: initType(masked.slice(start, match.index)),
      startLine: lineFor(starts, start),
      endLine: lineFor(starts, semi),
      fields,
      shortSnippet: short(original.slice(start, semi + 1)),
    })
    pattern.lastIndex = end + 1
  }
  return result
}

function labelSymbols(original: string, functions: CodeGraphFunction[]): CodeGraphLabel[] {
  const rows = original.replace(/\r\n/g, "\n").split("\n")
  const result: CodeGraphLabel[] = []
  for (const fn of functions) {
    for (let index = fn.startLine - 1; index < Math.min(rows.length, fn.endLine); index++) {
      const match = /^\s*([A-Za-z_]\w*)\s*:\s*(?:\/\/.*)?$/.exec(rows[index] ?? "")
      if (!match || /^(?:case|default)$/.test(match[1])) continue
      const part = labelSnippet(rows, index, fn.endLine)
      const snippet = short(part.join("\n").trim())
      const cleanupCalls = cleanup(snippet)
      result.push({
        kind: cleanupCalls.length || /^err|fail|cleanup|out/i.test(match[1]) ? "error_label" : "label",
        name: match[1],
        functionName: fn.name,
        functionId: fn.id,
        startLine: index + 1,
        endLine: index + part.length,
        shortSnippet: snippet,
        cleanupCalls,
        returnStyle: part.map((line) => line.trim()).find((line) => /^return\b.*;\s*$/.test(line)),
      })
    }
  }
  return result
}

function regFamilies(file: string, macros: CodeGraphMacro[]): CodeGraphRegisterMacroFamily[] {
  const groups = new Map<string, CodeGraphRegisterMacroFamily["macros"]>()
  const mmio = new Map<string, string[]>()
  for (const macro of macros) {
    const item = reg(macro.name)
    const like = mmioLike(macro.name)
    if (!item && !like) continue
    const family = item?.family ?? macro.name
    const suffix = item?.suffix ?? "MMIO"
    const group = groups.get(family) ?? []
    group.push({
      name: macro.name,
      suffix,
      startLine: macro.startLine,
      endLine: macro.endLine,
      shortSnippet: macro.shortSnippet,
    })
    groups.set(family, group)
    if (like) mmio.set(family, [...(mmio.get(family) ?? []), macro.name])
  }

  return [...groups.entries()]
    .filter(([, macros]) => macros.length >= 2 || macros.some((macro) => mmioLike(macro.name)))
    .map(([family, macros]) => ({
      family,
      path: file,
      startLine: Math.min(...macros.map((macro) => macro.startLine)),
      endLine: Math.max(...macros.map((macro) => macro.endLine)),
      macros: macros.sort((left, right) => left.startLine - right.startLine || left.name.localeCompare(right.name)),
      mmioIdentifiers: unique(mmio.get(family) ?? []),
      shortSnippet: short(
        macros
          .map((macro) => macro.shortSnippet)
          .filter(Boolean)
          .join("\n"),
      ),
    }))
    .sort((left, right) => left.startLine - right.startLine || left.family.localeCompare(right.family))
}

function fields(original: string, masked: string, start: number, end: number, starts: number[]): CodeGraphTypeField[] {
  const result: CodeGraphTypeField[] = []
  for (const match of masked.slice(start, end).matchAll(/([^;{}]+);/g)) {
    const raw = match[1].trim()
    if (!raw || raw.includes("(")) continue
    const cleaned = raw
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\s*:\s*\d+\s*$/, "")
      .replace(/\s+/g, " ")
      .trim()
    const field = /^(.+?)\s+(\**\s*)?([A-Za-z_]\w*)$/.exec(cleaned)
    if (!field || control.has(field[3])) continue
    const line = lineFor(starts, start + (match.index ?? 0))
    result.push({
      name: field[3],
      type: compact(`${field[1]} ${field[2] ?? ""}`),
      startLine: line,
      endLine: line,
      shortSnippet: lineText(original, starts, line),
    })
  }
  return result
}

function typedefFields(original: string, masked: string, start: number, statement: string, starts: number[]) {
  if (!/\btypedef\s+(?:struct|union)\b/.test(statement)) return []
  const brace = masked.indexOf("{", start)
  const end = closeBrace(masked, brace)
  if (brace < start || end === -1 || end > start + statement.length) return []
  return fields(original, masked, brace + 1, end, starts)
}

function fnCandidate(masked: string, brace: number) {
  let cursor = brace - 1
  while (cursor >= 0 && /\s/.test(masked[cursor])) cursor--
  if (masked[cursor] !== ")") return undefined
  const open = openParen(masked, cursor)
  if (open === -1) return undefined
  let end = open - 1
  while (end >= 0 && /\s/.test(masked[end])) end--
  let start = end
  while (start >= 0 && /[A-Za-z0-9_]/.test(masked[start])) start--
  start++
  const name = masked.slice(start, end + 1)
  if (!/^[A-Za-z_]\w*$/.test(name) || control.has(name)) return undefined
  let sig = start
  while (sig > 0) {
    const prev = masked[sig - 1]
    if (prev === ";" || prev === "}" || prev === "{") break
    if (prev === "\n") {
      const line = masked.lastIndexOf("\n", sig - 2) + 1
      if (/^\s*#/.test(masked.slice(line, sig - 1))) break
    }
    sig--
  }
  const prefix = masked.slice(sig, start)
  if (!prefix.trim()) return undefined
  if (/[=,]$/.test(prefix.trim())) return undefined
  if (/\btypedef\b/.test(prefix)) return undefined
  return { name, nameIndex: start, start: sig }
}

function mask(text: string) {
  let result = ""
  let index = 0
  let state: "code" | "line" | "block" | "string" | "char" = "code"
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (state === "code") {
      if (char === "/" && next === "/") {
        result += "  "
        index += 2
        state = "line"
        continue
      }
      if (char === "/" && next === "*") {
        result += "  "
        index += 2
        state = "block"
        continue
      }
      if (char === '"') {
        result += " "
        index++
        state = "string"
        continue
      }
      if (char === "'") {
        result += " "
        index++
        state = "char"
        continue
      }
      result += char
      index++
      continue
    }
    if (state === "line") {
      result += char === "\n" || char === "\r" ? char : " "
      index++
      if (char === "\n") state = "code"
      continue
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        result += "  "
        index += 2
        state = "code"
        continue
      }
      result += char === "\n" || char === "\r" ? char : " "
      index++
      continue
    }
    if (char === "\\" && next !== undefined) {
      result += " "
      result += next === "\n" || next === "\r" ? next : " "
      index += 2
      continue
    }
    const close = state === "string" ? '"' : "'"
    result += char === "\n" || char === "\r" ? char : " "
    index++
    if (char === close) state = "code"
  }
  return result
}

function splitArgs(input: string) {
  const result: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (char === "(" || char === "[" || char === "{") depth++
    if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1)
    if (char !== "," || depth !== 0) continue
    result.push(compact(input.slice(start, index)))
    start = index + 1
  }
  const tail = compact(input.slice(start))
  if (tail) result.push(tail)
  return result.filter(Boolean).slice(0, 12)
}

function initStart(masked: string, index: number) {
  let cursor = index - 1
  while (cursor > 0) {
    const char = masked[cursor]
    if (char === ";" || char === "{" || char === "}") return cursor + 1
    cursor--
  }
  return 0
}

function initType(prefix: string) {
  const parts = prefix
    .replace(/\b(?:static|const|volatile|extern|register|struct|union)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length < 2) return undefined
  return parts[parts.length - 2]?.replace(/^\*+/, "")
}

function labelSnippet(rows: string[], start: number, end: number) {
  const result: string[] = []
  for (let index = start; index < Math.min(rows.length, end, start + 10); index++) {
    if (index > start && /^\s*[A-Za-z_]\w*\s*:\s*(?:\/\/.*)?$/.test(rows[index] ?? "")) break
    result.push(rows[index] ?? "")
    if (index > start && /^\s*return\b.*;\s*$/.test(rows[index] ?? "")) break
  }
  return result
}

function cleanup(snippet: string) {
  const result: string[] = []
  const pattern = /\b([A-Za-z_]\w*)\s*\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(snippet))) {
    const name = match[1]
    if (!excludes.has(name)) result.push(name)
  }
  return unique(result).slice(0, 12)
}

function reg(name: string) {
  const parts = name.split("_").filter(Boolean)
  if (parts.length < 2) return undefined
  const last = parts.at(-1)
  const prev = parts.at(-2)
  if (!last) return undefined
  if (/^(?:MASK|SHIFT|BIT|BITS)$/.test(last) && prev && parts.length >= 3) {
    return { family: parts.slice(0, -2).join("_"), suffix: `${prev}_${last}` }
  }
  if (/^(?:BASE|ADDR|REG|CTRL|CFG|STATUS|ENABLE|DISABLE|MASK|SHIFT|BIT|BITS|VALUE|VAL|DATA|DR)$/.test(last)) {
    return { family: parts.slice(0, -1).join("_"), suffix: last }
  }
  return undefined
}

function mmioLike(name: string) {
  return /\b(?:MMIO|REG|IRQ|ISR|GPIO|UART|SPI|I2C|CTRL|STATUS|ADDR)\b/i.test(name.replace(/_/g, " "))
}

function ret(snippet: string, callee: string) {
  const escaped = callee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (new RegExp(`\\breturn\\s+${escaped}\\s*\\(`).test(snippet)) return "return"
  const assign = new RegExp(`\\b([A-Za-z_]\\w*)\\s*=\\s*${escaped}\\s*\\(`).exec(snippet)
  if (assign?.[1]) return `assignment:${assign[1]}`
  if (new RegExp(`\\bif\\s*\\(\\s*${escaped}\\s*\\(`).test(snippet)) return "condition"
  return undefined
}

function lines(text: string) {
  const result = [0]
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") result.push(index + 1)
  }
  return result
}

function lineFor(starts: number[], index: number) {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (starts[mid] <= index) low = mid + 1
    else high = mid - 1
  }
  return Math.max(1, high + 1)
}

function lineStart(starts: number[], line: number) {
  return starts[Math.max(0, line - 1)] ?? 0
}

function lineEnd(text: string, starts: number[], line: number) {
  const next = starts[line]
  return next === undefined ? text.length : Math.max(0, next - 1)
}

function lineText(text: string, starts: number[], line: number) {
  return short(text.slice(lineStart(starts, line), lineEnd(text, starts, line)).trim())
}

function openParen(text: string, close: number) {
  let depth = 0
  for (let index = close; index >= 0; index--) {
    if (text[index] === ")") depth++
    if (text[index] !== "(") continue
    depth--
    if (depth === 0) return index
  }
  return -1
}

function closeParen(text: string, open: number) {
  let depth = 0
  for (let index = open; index < text.length; index++) {
    if (text[index] === "(") depth++
    if (text[index] !== ")") continue
    depth--
    if (depth === 0) return index
  }
  return -1
}

function closeBrace(text: string, open: number) {
  let depth = 0
  for (let index = open; index < text.length; index++) {
    if (text[index] === "{") depth++
    if (text[index] !== "}") continue
    depth--
    if (depth === 0) return index
  }
  return -1
}

function short(input: string) {
  const value = compact(input)
  if (value.length <= CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS) return value
  return `${value.slice(0, CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS - 3)}...`
}

function compact(input: string) {
  return input.replace(/\s+/g, " ").trim()
}

function unique(input: string[]) {
  return [...new Set(input.filter(Boolean))]
}

function lang(file: string): CodeGraphLanguage {
  const ext = path.extname(file).toLowerCase()
  return ext === ".cc" || ext === ".cpp" || ext === ".hpp" || ext === ".hh" ? "cpp" : "c"
}
