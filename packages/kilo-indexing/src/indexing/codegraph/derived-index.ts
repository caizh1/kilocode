import type {
  CodeGraphDerivedIndex,
  CodeGraphDirectoryStats,
  CodeGraphFileGraph,
  CodeGraphModuleStats,
  CodeGraphPosting,
  CodeGraphPostingKind,
  CodeGraphSymbol,
  CodeGraphTypeField,
} from "./types"
import { dict, own } from "./dict"

export function buildCodeGraphDerivedIndex(files: Record<string, CodeGraphFileGraph>): CodeGraphDerivedIndex {
  const ids = dict<string[]>()
  const callers = dict<string[]>()
  const targets = dict<string[]>()
  const includers = dict<string[]>()
  const dirs = dict<CodeGraphDirectoryStats>()
  const names = dict<CodeGraphSymbol[]>()
  const paths = dict<CodeGraphSymbol[]>()
  const postings = dict<CodeGraphPosting[]>()
  const modules = new Map<string, Set<string>>()
  const owners = new Map<string, Set<string>>()

  for (const graph of Object.values(files).sort((left, right) => left.filePath.localeCompare(right.filePath))) {
    const dir = moduleKey(graph.filePath)
    const stats = get(dirs, dir, () => ({ files: 0, functions: 0, macros: 0, types: 0, globals: 0, bytes: 0 }))
    stats.files += 1
    stats.functions += graph.functions.length
    stats.macros += graph.macros.length
    stats.types += graph.types.length
    stats.globals += graph.globals.length
    stats.bytes += bytes(graph)

    addSymbol(names, paths, fileSymbol(graph))
    for (const term of terms(graph.filePath)) addPosting(postings, term, graph.filePath, 1, "path", 3)

    targets[graph.filePath] = graph.includes.map((include) => include.target)
    for (const include of graph.includes) {
      pushUnique(includers, include.target, graph.filePath)
      addPosting(postings, include.target, graph.filePath, include.startLine, "include", 2.2)
    }

    for (const fn of graph.functions) {
      pushUnique(ids, fn.name, fn.id)
      addSymbol(names, paths, {
        id: fn.id,
        kind: "function",
        name: fn.name,
        path: graph.filePath,
        startLine: fn.startLine,
        endLine: fn.endLine,
        signature: fn.signature,
        snippet: fn.shortSnippet ?? fn.signature,
      })
      addPosting(postings, fn.name, graph.filePath, fn.startLine, "function", 6, fn.id)
      addOwner(owners, fn.name, dir)
      const callees = modules.get(dir) ?? new Set<string>()
      for (const call of fn.calls) {
        pushUnique(callers, call.calleeName, fn.id)
        callees.add(call.calleeName)
      }
      modules.set(dir, callees)
    }

    for (const macro of graph.macros) {
      addSymbol(names, paths, {
        id: `${graph.filePath}:macro:${macro.name}:${macro.startLine}`,
        kind: "macro",
        name: macro.name,
        path: graph.filePath,
        startLine: macro.startLine,
        endLine: macro.endLine,
        snippet: macro.shortSnippet ?? macro.name,
      })
      addPosting(postings, macro.name, graph.filePath, macro.startLine, "macro", 4.5)
    }

    for (const type of graph.types) {
      addSymbol(names, paths, {
        id: `${graph.filePath}:type:${type.name}:${type.startLine}`,
        kind: "type",
        name: type.name,
        path: graph.filePath,
        startLine: type.startLine,
        endLine: type.endLine,
        signature: type.kind,
        snippet: type.shortSnippet ?? type.name,
      })
      addPosting(postings, type.name, graph.filePath, type.startLine, "type", 5)
      for (const field of type.fields ?? []) addSymbol(names, paths, fieldSymbol(graph.filePath, type.name, field))
    }

    for (const global of graph.globals) {
      addSymbol(names, paths, {
        id: `${graph.filePath}:global:${global.name}:${global.startLine}`,
        kind: "global",
        name: global.name,
        path: graph.filePath,
        startLine: global.startLine,
        endLine: global.endLine,
        snippet: global.shortSnippet ?? global.name,
      })
      addPosting(postings, global.name, graph.filePath, global.startLine, "global", 3.5)
    }
  }

  return {
    functionIdsByName: sortedArray(ids),
    callerIdsByCallee: sortedArray(callers),
    includeTargetsByFile: sortedArray(targets),
    filePathsByInclude: sortedArray(includers),
    directoryStats: sortedRecord(dirs),
    symbolsByName: sortedSymbols(names),
    symbolsByPath: sortedSymbols(paths),
    postingsByTerm: sortedPostings(postings),
    moduleStats: buildModuleStats(dirs, modules, owners),
  }
}

export function moduleKey(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/")
  if (parts.length <= 1) return "."
  return parts.slice(0, Math.min(2, parts.length - 1)).join("/")
}

export function emptyCodeGraphDerivedIndex(): CodeGraphDerivedIndex {
  return {
    functionIdsByName: dict<string[]>(),
    callerIdsByCallee: dict<string[]>(),
    includeTargetsByFile: dict<string[]>(),
    filePathsByInclude: dict<string[]>(),
    directoryStats: dict<CodeGraphDirectoryStats>(),
    symbolsByName: dict<CodeGraphSymbol[]>(),
    symbolsByPath: dict<CodeGraphSymbol[]>(),
    postingsByTerm: dict<CodeGraphPosting[]>(),
    moduleStats: dict<CodeGraphModuleStats>(),
  }
}

function get<T>(record: Record<string, T>, key: string, create: () => T): T {
  const value = own(record, key)
  if (value !== undefined) return value
  const next = create()
  record[key] = next
  return next
}

function fileSymbol(graph: CodeGraphFileGraph): CodeGraphSymbol {
  return {
    id: `${graph.filePath}:file`,
    kind: "file",
    name: graph.filePath.split(/[\\/]/).pop() ?? graph.filePath,
    path: graph.filePath,
    startLine: 1,
    endLine: 1,
    snippet: `${graph.filePath} (${graph.language})`,
  }
}

function fieldSymbol(path: string, type: string, field: CodeGraphTypeField): CodeGraphSymbol {
  return {
    id: `${path}:field:${type}:${field.name}:${field.startLine}`,
    kind: "field",
    name: field.name,
    path,
    startLine: field.startLine,
    endLine: field.endLine,
    signature: `${type}.${field.name}: ${field.type}`,
    snippet: field.shortSnippet ?? field.name,
  }
}

function addSymbol(
  names: Record<string, CodeGraphSymbol[]>,
  paths: Record<string, CodeGraphSymbol[]>,
  symbol: CodeGraphSymbol,
): void {
  pushUniqueSymbol(names, symbol.name.toLowerCase(), symbol)
  pushUniqueSymbol(paths, symbol.path, symbol)
}

function addPosting(
  record: Record<string, CodeGraphPosting[]>,
  term: string,
  path: string,
  line: number,
  kind: CodeGraphPostingKind,
  weight: number,
  symbolId?: string,
): void {
  for (const normalized of terms(term)) {
    const values = get(record, normalized, () => [])
    values.push({
      term: normalized,
      path,
      line,
      kind,
      weight,
      ...(symbolId ? { symbolId } : {}),
    })
  }
}

function addOwner(record: Map<string, Set<string>>, name: string, dir: string): void {
  const modules = record.get(name) ?? new Set<string>()
  modules.add(dir)
  record.set(name, modules)
}

function pushUnique(record: Record<string, string[]>, key: string, value: string): void {
  const values = get(record, key, () => [])
  if (!values.includes(value)) values.push(value)
}

function pushUniqueSymbol(record: Record<string, CodeGraphSymbol[]>, key: string, value: CodeGraphSymbol): void {
  const values = get(record, key, () => [])
  if (!values.some((symbol) => symbol.id === value.id)) values.push(value)
}

function terms(value: string): string[] {
  const seen = new Set<string>()
  const add = (term: string) => {
    const lower = term.toLowerCase()
    if (lower.length >= 2) seen.add(lower)
  }
  add(value)
  for (const part of value.split(/[^A-Za-z0-9_]+/)) add(part)
  for (const part of value.split(/[_./\\-]+/)) add(part)
  return [...seen].sort()
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function buildModuleStats(
  dirs: Record<string, CodeGraphDirectoryStats>,
  modules: Map<string, Set<string>>,
  owners: Map<string, Set<string>>,
): Record<string, CodeGraphModuleStats> {
  const out = dict<CodeGraphModuleStats>()
  for (const [dir, stats] of Object.entries(dirs)) {
    let externalCallers = 0
    const hot: string[] = []
    for (const callee of modules.get(dir) ?? []) {
      const owner = owners.get(callee)
      if (!owner) continue
      hot.push(callee)
      if ([...owner].some((item) => item !== dir)) externalCallers += 1
    }
    out[dir] = {
      ...stats,
      externalCallers,
      hotSymbols: [...new Set(hot)].sort().slice(0, 12),
    }
  }
  return sortedRecord(out)
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right))) as Record<
    string,
    T
  >
}

function sortedArray(record: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, [...values].sort()]),
  )
}

function sortedSymbols(record: Record<string, CodeGraphSymbol[]>): Record<string, CodeGraphSymbol[]> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [
        key,
        [...values].sort(
          (left, right) =>
            left.path.localeCompare(right.path) ||
            left.startLine - right.startLine ||
            left.name.localeCompare(right.name),
        ),
      ]),
  )
}

function sortedPostings(record: Record<string, CodeGraphPosting[]>): Record<string, CodeGraphPosting[]> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [
        key,
        [...values]
          .sort(
            (left, right) =>
              right.weight - left.weight || left.path.localeCompare(right.path) || left.line - right.line,
          )
          .slice(0, 400),
      ]),
  )
}
