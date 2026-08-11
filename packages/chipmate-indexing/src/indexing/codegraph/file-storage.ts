import {
  CODEGRAPH_JSON_HARD_PART_BYTES,
  CODEGRAPH_JSON_TARGET_PART_BYTES,
  estimateJsonBytes,
  splitArrayValueIntoBoundedChunks,
  splitRecordIntoBoundedJsonParts,
  type BoundedJsonPart,
} from "./bounded-json"
import { CODE_GRAPH_PARSER_VERSION, CODE_GRAPH_SCHEMA_VERSION } from "./constants"
import type {
  CodeGraphCall,
  CodeGraphDeclaration,
  CodeGraphFileGraph,
  CodeGraphGlobalSymbol,
  CodeGraphInclude,
  CodeGraphInitializer,
  CodeGraphLabel,
  CodeGraphMacro,
  CodeGraphRegisterMacroFamily,
  CodeGraphShardData,
  CodeGraphStoredFileArrayField,
  CodeGraphStoredFileBase,
  CodeGraphStoredFilePart,
  CodeGraphTypeSymbol,
} from "./types"

export const CODEGRAPH_FILE_ARRAY_FIELDS: CodeGraphStoredFileArrayField[] = [
  "includes",
  "macros",
  "functions",
  "declarations",
  "calls",
  "types",
  "globals",
  "initializers",
  "labels",
  "registerMacroFamilies",
]

const largeFileBytes = 2 * 1024 * 1024
const largeFileArrayItems = 25000
const largeRecordBytes = 24 * 1024 * 1024

type SplitOptions = {
  shardKey: string
  basePath: string
  label: string
  targetPartBytes?: number
  hardPartBytes?: number
  stringify?: (value: unknown) => string | undefined
  onLargeFileSplit?: (event: {
    path: string
    field: CodeGraphStoredFileArrayField
    items: number
    chunks: number
  }) => void
  onProgress?: (event: { label: string; processed: number; total: number }) => void
}

type Builder = {
  base?: CodeGraphStoredFileBase
  arrays: Map<CodeGraphStoredFileArrayField, Array<{ offset: number; items: unknown[] }>>
}

export function groupGraphsByShard(
  graphs: Record<string, CodeGraphFileGraph>,
): Map<string, Record<string, CodeGraphFileGraph>> {
  const groups = new Map<string, Record<string, CodeGraphFileGraph>>()
  for (const [file, graph] of Object.entries(graphs)) {
    const key = shardKeyForPath(file)
    const group = groups.get(key) ?? (Object.create(null) as Record<string, CodeGraphFileGraph>)
    group[file] = graph
    groups.set(key, group)
  }
  return groups
}

export function shardKeyForPath(file: string): string {
  const normalized = file.replace(/\\/g, "/")
  const [first, second] = normalized.split("/")
  if (!first) return "root"
  if (!second || /\.[A-Za-z0-9_+-]+$/.test(first) || /\.[A-Za-z0-9_+-]+$/.test(second)) return first
  return `${first}/${second}`
}

export function shardFileName(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 48) || "root"
  return `${safe}.json`
}

export function splitCodeGraphFilesForStorage(
  graphs: Record<string, CodeGraphFileGraph>,
  opts: SplitOptions,
): BoundedJsonPart<CodeGraphShardData>[] {
  const parts = Object.create(null) as Record<string, CodeGraphStoredFilePart>
  for (const graph of Object.values(graphs).sort((left, right) => left.filePath.localeCompare(right.filePath))) {
    for (const part of splitGraph(graph, opts)) parts[partKey(part)] = part
  }
  return splitRecordIntoBoundedJsonParts<CodeGraphStoredFilePart, CodeGraphShardData>({
    record: parts,
    label: opts.label,
    targetPartBytes: opts.targetPartBytes ?? CODEGRAPH_JSON_TARGET_PART_BYTES,
    hardPartBytes: opts.hardPartBytes ?? CODEGRAPH_JSON_HARD_PART_BYTES,
    stringify: opts.stringify,
    pathForPart: (_index, key) => `${base(opts.basePath)}/${key}.json`,
    createPayload: (records, key) => ({
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      key: opts.shardKey,
      part: key,
      fileParts: Object.entries(records)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, part]) => part),
    }),
  })
}

export function mergeCodeGraphFileStorageParts(parts: CodeGraphShardData[]): Record<string, CodeGraphFileGraph> {
  const builders = new Map<string, Builder>()
  const whole = Object.create(null) as Record<string, CodeGraphFileGraph>
  for (const payload of parts) {
    if (
      payload.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION ||
      payload.parserVersion !== CODE_GRAPH_PARSER_VERSION
    ) {
      throw new Error(
        `Code graph shard ${payload.key} part ${payload.part} does not match the current storage version.`,
      )
    }
    for (const part of payload.fileParts) {
      if (part.kind === "whole") {
        whole[part.path] = part.file
        continue
      }
      const builder: Builder = builders.get(part.path) ?? { arrays: new Map() }
      if (part.kind === "base") {
        builder.base = part.file
      } else {
        const items = builder.arrays.get(part.field) ?? []
        items.push({ offset: part.offset, items: part.items })
        builder.arrays.set(part.field, items)
      }
      builders.set(part.path, builder)
    }
  }

  const out = { ...whole }
  for (const [file, builder] of [...builders.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!builder.base) throw new Error(`Missing stored code graph file base for ${file}.`)
    out[file] = buildFile(builder.base, builder.arrays)
  }
  return out
}

function splitGraph(graph: CodeGraphFileGraph, opts: SplitOptions): CodeGraphStoredFilePart[] {
  if (!shouldSplit(graph, opts)) return [{ kind: "whole", path: graph.filePath, file: graph }]
  const parts: CodeGraphStoredFilePart[] = [{ kind: "base", path: graph.filePath, file: fileBase(graph) }]
  for (const field of CODEGRAPH_FILE_ARRAY_FIELDS) {
    const values = array(graph, field)
    if (values.length === 0) continue
    let offset = 0
    const chunks = splitArrayValueIntoBoundedChunks({
      values,
      label: `${opts.label} file ${graph.filePath} ${field}`,
      targetPartBytes: opts.targetPartBytes ?? CODEGRAPH_JSON_TARGET_PART_BYTES,
      hardPartBytes: opts.hardPartBytes ?? CODEGRAPH_JSON_HARD_PART_BYTES,
      stringify: opts.stringify,
      progressIntervalItems: 2048,
      onProgress: opts.onProgress,
      createPayload: (items) =>
        ({
          graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
          parserVersion: CODE_GRAPH_PARSER_VERSION,
          key: opts.shardKey,
          part: "single-file-array",
          fileParts: [{ kind: "array", path: graph.filePath, field, offset, items }],
        }) satisfies CodeGraphShardData,
    })
    opts.onLargeFileSplit?.({ path: graph.filePath, field, items: values.length, chunks: chunks.length })
    for (const chunk of chunks) {
      parts.push({ kind: "array", path: graph.filePath, field, offset, items: chunk })
      offset += chunk.length
    }
  }
  return parts
}

function shouldSplit(graph: CodeGraphFileGraph, opts: SplitOptions): boolean {
  const hard = opts.hardPartBytes ?? CODEGRAPH_JSON_HARD_PART_BYTES
  const size = graph.functions.reduce((sum, fn) => sum + (fn.shortSnippet?.length ?? 0) + fn.signature.length, 0)
  if (size > largeFileBytes) return true
  if (CODEGRAPH_FILE_ARRAY_FIELDS.reduce((count, field) => count + array(graph, field).length, 0) > largeFileArrayItems)
    return true
  try {
    const bytes = estimateJsonBytes(
      {
        graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
        parserVersion: CODE_GRAPH_PARSER_VERSION,
        key: opts.shardKey,
        part: "single-file",
        fileParts: [{ kind: "whole", path: graph.filePath, file: graph }],
      } satisfies CodeGraphShardData,
      { label: `${opts.label} file ${graph.filePath}`, stringify: opts.stringify },
    )
    return bytes > Math.min(largeRecordBytes, Math.floor(hard * 0.75))
  } catch (err) {
    void err
    return true
  }
}

function fileBase(graph: CodeGraphFileGraph): CodeGraphStoredFileBase {
  const {
    includes: _includes,
    macros: _macros,
    functions: _functions,
    declarations: _declarations,
    calls: _calls,
    types: _types,
    globals: _globals,
    initializers: _initializers,
    labels: _labels,
    registerMacroFamilies: _families,
    ...rest
  } = graph
  return rest
}

function buildFile(
  base: CodeGraphStoredFileBase,
  arrays: Map<CodeGraphStoredFileArrayField, Array<{ offset: number; items: unknown[] }>>,
): CodeGraphFileGraph {
  return {
    ...base,
    includes: items<CodeGraphInclude>(arrays, "includes"),
    macros: items<CodeGraphMacro>(arrays, "macros"),
    functions: items(arrays, "functions"),
    declarations: items<CodeGraphDeclaration>(arrays, "declarations"),
    calls: items<CodeGraphCall>(arrays, "calls"),
    types: items<CodeGraphTypeSymbol>(arrays, "types"),
    globals: items<CodeGraphGlobalSymbol>(arrays, "globals"),
    initializers: items<CodeGraphInitializer>(arrays, "initializers"),
    labels: items<CodeGraphLabel>(arrays, "labels"),
    registerMacroFamilies: items<CodeGraphRegisterMacroFamily>(arrays, "registerMacroFamilies"),
  }
}

function array(graph: CodeGraphFileGraph, field: CodeGraphStoredFileArrayField): unknown[] {
  switch (field) {
    case "includes":
      return graph.includes
    case "macros":
      return graph.macros
    case "functions":
      return graph.functions
    case "declarations":
      return graph.declarations
    case "calls":
      return graph.calls
    case "types":
      return graph.types
    case "globals":
      return graph.globals
    case "initializers":
      return graph.initializers
    case "labels":
      return graph.labels
    case "registerMacroFamilies":
      return graph.registerMacroFamilies
  }
}

function items<T>(
  arrays: Map<CodeGraphStoredFileArrayField, Array<{ offset: number; items: unknown[] }>>,
  field: CodeGraphStoredFileArrayField,
): T[] {
  return (arrays.get(field) ?? [])
    .sort((left, right) => left.offset - right.offset)
    .flatMap((chunk) => chunk.items) as T[]
}

function partKey(part: CodeGraphStoredFilePart): string {
  if (part.kind === "whole") return `whole:${part.path}`
  if (part.kind === "base") return `base:${part.path}`
  return `array:${part.path}:${part.field}:${part.offset.toString().padStart(10, "0")}`
}

function base(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "shards"
}
