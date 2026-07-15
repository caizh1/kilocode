import type {
  CodeGraphDerivedIndex,
  CodeGraphDerivedSidecarField,
  CodeGraphDirectoryStats,
  CodeGraphFileGraph,
  CodeGraphModuleStats,
  CodeGraphPosting,
  CodeGraphPostingKind,
  CodeGraphSymbol,
  CodeGraphTypeField,
} from "./types"
import { dict, own } from "./dict"

export const CODEGRAPH_DERIVED_INDEX_FIELDS: CodeGraphDerivedSidecarField[] = [
  "functionIdsByName",
  "callerIdsByCallee",
  "includeTargetsByFile",
  "filePathsByInclude",
  "directoryStats",
  "symbolsByName",
  "symbolsByPath",
  "postingsByTerm",
  "moduleStats",
]

export function buildCodeGraphDerivedIndex(files: Record<string, CodeGraphFileGraph>): CodeGraphDerivedIndex {
  const builder = new CodeGraphDerivedIndexBuilder()
  for (const graph of Object.values(files).sort((left, right) => left.filePath.localeCompare(right.filePath))) {
    builder.add(graph)
  }
  return builder.build()
}

export class CodeGraphDerivedIndexBuilder {
  private readonly fields: Set<CodeGraphDerivedSidecarField>
  private readonly ids = dict<string[]>()
  private readonly callers = dict<string[]>()
  private readonly targets = dict<string[]>()
  private readonly includers = dict<string[]>()
  private readonly dirs = dict<CodeGraphDirectoryStats>()
  private readonly names = dict<CodeGraphSymbol[]>()
  private readonly paths = dict<CodeGraphSymbol[]>()
  private readonly postings = dict<CodeGraphPosting[]>()
  private readonly modules = new Map<string, Set<string>>()
  private readonly owners = new Map<string, Set<string>>()

  constructor(fields: Iterable<CodeGraphDerivedSidecarField> = CODEGRAPH_DERIVED_INDEX_FIELDS) {
    this.fields = new Set(fields)
  }

  public add(graph: CodeGraphFileGraph): void {
    const dir = moduleKey(graph.filePath)
    if (this.has("directoryStats") || this.has("moduleStats")) {
      const stats = get(this.dirs, dir, () => ({
        files: 0,
        functions: 0,
        macros: 0,
        types: 0,
        globals: 0,
        bytes: 0,
      }))
      stats.files += 1
      stats.functions += graph.functions.length
      stats.macros += graph.macros.length
      stats.types += graph.types.length
      stats.globals += graph.globals.length
      stats.bytes += bytes(graph)
    }

    if (this.has("symbolsByName") || this.has("symbolsByPath")) {
      addSymbol(
        this.has("symbolsByName") ? this.names : undefined,
        this.has("symbolsByPath") ? this.paths : undefined,
        fileSymbol(graph),
      )
    }
    if (this.has("postingsByTerm")) {
      for (const term of terms(graph.filePath)) addPosting(this.postings, term, graph.filePath, 1, "path", 3)
    }

    if (this.has("includeTargetsByFile")) this.targets[graph.filePath] = graph.includes.map((include) => include.target)
    for (const include of graph.includes) {
      if (this.has("filePathsByInclude")) pushUnique(this.includers, include.target, graph.filePath)
      if (this.has("postingsByTerm")) {
        addPosting(this.postings, include.target, graph.filePath, include.startLine, "include", 2.2)
      }
    }

    for (const fn of graph.functions) {
      if (this.has("functionIdsByName")) pushUnique(this.ids, fn.name, fn.id)
      if (this.has("symbolsByName") || this.has("symbolsByPath")) {
        addSymbol(
          this.has("symbolsByName") ? this.names : undefined,
          this.has("symbolsByPath") ? this.paths : undefined,
          {
            id: fn.id,
            kind: "function",
            name: fn.name,
            path: graph.filePath,
            startLine: fn.startLine,
            endLine: fn.endLine,
            signature: fn.signature,
            snippet: fn.shortSnippet ?? fn.signature,
          },
        )
      }
      if (this.has("postingsByTerm"))
        addPosting(this.postings, fn.name, graph.filePath, fn.startLine, "function", 6, fn.id)
      if (this.has("moduleStats")) addOwner(this.owners, fn.name, dir)
      const callees = this.modules.get(dir) ?? new Set<string>()
      for (const call of fn.calls) {
        if (this.has("callerIdsByCallee")) pushUnique(this.callers, call.calleeName, fn.id)
        if (this.has("moduleStats")) callees.add(call.calleeName)
      }
      if (this.has("moduleStats")) this.modules.set(dir, callees)
    }

    for (const macro of graph.macros) {
      if (this.has("symbolsByName") || this.has("symbolsByPath")) {
        addSymbol(
          this.has("symbolsByName") ? this.names : undefined,
          this.has("symbolsByPath") ? this.paths : undefined,
          {
            id: `${graph.filePath}:macro:${macro.name}:${macro.startLine}`,
            kind: "macro",
            name: macro.name,
            path: graph.filePath,
            startLine: macro.startLine,
            endLine: macro.endLine,
            snippet: macro.shortSnippet ?? macro.name,
          },
        )
      }
      if (this.has("postingsByTerm"))
        addPosting(this.postings, macro.name, graph.filePath, macro.startLine, "macro", 4.5)
    }

    for (const type of graph.types) {
      if (this.has("symbolsByName") || this.has("symbolsByPath")) {
        addSymbol(
          this.has("symbolsByName") ? this.names : undefined,
          this.has("symbolsByPath") ? this.paths : undefined,
          {
            id: `${graph.filePath}:type:${type.name}:${type.startLine}`,
            kind: "type",
            name: type.name,
            path: graph.filePath,
            startLine: type.startLine,
            endLine: type.endLine,
            signature: type.kind,
            snippet: type.shortSnippet ?? type.name,
          },
        )
        for (const field of type.fields ?? []) {
          addSymbol(
            this.has("symbolsByName") ? this.names : undefined,
            this.has("symbolsByPath") ? this.paths : undefined,
            fieldSymbol(graph.filePath, type.name, field),
          )
        }
      }
      if (this.has("postingsByTerm")) addPosting(this.postings, type.name, graph.filePath, type.startLine, "type", 5)
    }

    for (const global of graph.globals) {
      if (this.has("symbolsByName") || this.has("symbolsByPath")) {
        addSymbol(
          this.has("symbolsByName") ? this.names : undefined,
          this.has("symbolsByPath") ? this.paths : undefined,
          {
            id: `${graph.filePath}:global:${global.name}:${global.startLine}`,
            kind: "global",
            name: global.name,
            path: graph.filePath,
            startLine: global.startLine,
            endLine: global.endLine,
            snippet: global.shortSnippet ?? global.name,
          },
        )
      }
      if (this.has("postingsByTerm"))
        addPosting(this.postings, global.name, graph.filePath, global.startLine, "global", 3.5)
    }
  }

  public build(): CodeGraphDerivedIndex {
    return {
      functionIdsByName: sortedArray(this.ids),
      callerIdsByCallee: sortedArray(this.callers),
      includeTargetsByFile: sortedArray(this.targets),
      filePathsByInclude: sortedArray(this.includers),
      directoryStats: sortedRecord(this.dirs),
      symbolsByName: sortedSymbols(this.names),
      symbolsByPath: sortedSymbols(this.paths),
      postingsByTerm: sortedPostings(this.postings),
      moduleStats: this.has("moduleStats") ? buildModuleStats(this.dirs, this.modules, this.owners) : dict(),
    }
  }

  private has(field: CodeGraphDerivedSidecarField): boolean {
    return this.fields.has(field)
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
  names: Record<string, CodeGraphSymbol[]> | undefined,
  paths: Record<string, CodeGraphSymbol[]> | undefined,
  symbol: CodeGraphSymbol,
): void {
  if (names) pushUniqueSymbol(names, symbol.name.toLowerCase(), symbol)
  if (paths) pushUniqueSymbol(paths, symbol.path, symbol)
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
