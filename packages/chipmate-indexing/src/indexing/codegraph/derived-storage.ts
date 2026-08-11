import {
  CODEGRAPH_JSON_HARD_PART_BYTES,
  CODEGRAPH_JSON_TARGET_PART_BYTES,
  splitArrayRecordIntoBoundedJsonParts,
  splitRecordIntoBoundedJsonParts,
  type BoundedJsonPart,
} from "./bounded-json"
import { CODE_GRAPH_PARSER_VERSION, CODE_GRAPH_SCHEMA_VERSION } from "./constants"
import { CODEGRAPH_DERIVED_INDEX_FIELDS, emptyCodeGraphDerivedIndex } from "./derived-index"
import type {
  CodeGraphDerivedIndex,
  CodeGraphDerivedSidecarField,
  CodeGraphDerivedSidecarManifest,
  CodeGraphDerivedSidecarPartData,
  CodeGraphDerivedSidecarShard,
} from "./types"

export const CODEGRAPH_DERIVED_SIDECAR_FIELDS: CodeGraphDerivedSidecarField[] = [...CODEGRAPH_DERIVED_INDEX_FIELDS]

export type CodeGraphDerivedSidecarData = {
  manifest: CodeGraphDerivedSidecarManifest
  parts: BoundedJsonPart<CodeGraphDerivedSidecarPartData>[]
}

type SplitOptions = {
  basePath?: string
  targetPartBytes?: number
  hardPartBytes?: number
}

export function splitCodeGraphDerivedIndex(
  derived: CodeGraphDerivedIndex,
  opts: SplitOptions = {},
): CodeGraphDerivedSidecarData {
  const root = base(opts.basePath ?? "derived")
  const fields = emptyFields()
  const parts: BoundedJsonPart<CodeGraphDerivedSidecarPartData>[] = []

  for (const field of CODEGRAPH_DERIVED_SIDECAR_FIELDS) {
    const split = splitField(field, derived[field] as Record<string, unknown>, root, opts)
    fields[field] = split.map(info)
    parts.push(...split)
  }

  return {
    manifest: {
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      fields,
    },
    parts,
  }
}

export function mergeCodeGraphDerivedSidecar(input: CodeGraphDerivedSidecarData): CodeGraphDerivedIndex {
  assert(input.manifest.graphSchemaVersion, input.manifest.parserVersion, "derived manifest")
  const counts = expected(input.manifest)
  const known = new Set<string>(CODEGRAPH_DERIVED_SIDECAR_FIELDS)
  const derived = emptyCodeGraphDerivedIndex()

  for (const part of input.parts) {
    assert(
      part.payload.graphSchemaVersion,
      part.payload.parserVersion,
      `derived ${part.payload.field} part ${part.payload.key}`,
    )
    if (!known.has(part.payload.field))
      throw new Error(`Unsupported derived sidecar field ${part.payload.field}. Rebuild the local code graph index.`)
    const key = countKey(part.payload.field, part.payload.key)
    const remaining = counts.get(key) ?? 0
    if (remaining <= 0)
      throw new Error(
        `Unexpected derived sidecar part ${part.payload.field}/${part.payload.key}. Rebuild the local code graph index.`,
      )
    counts.set(key, remaining - 1)
    merge(derived, part.payload.field, part.payload.records)
  }

  for (const [key, remaining] of counts) {
    if (remaining > 0) throw new Error(`Missing derived sidecar part ${key}. Rebuild the local code graph index.`)
  }

  return sort(derived)
}

function splitField(
  field: CodeGraphDerivedSidecarField,
  record: Record<string, unknown>,
  root: string,
  opts: SplitOptions,
): BoundedJsonPart<CodeGraphDerivedSidecarPartData>[] {
  const targetPartBytes = opts.targetPartBytes ?? CODEGRAPH_JSON_TARGET_PART_BYTES
  const hardPartBytes = opts.hardPartBytes ?? CODEGRAPH_JSON_HARD_PART_BYTES
  if (arrays(field)) {
    return splitArrayRecordIntoBoundedJsonParts<unknown, CodeGraphDerivedSidecarPartData>({
      record: record as Record<string, unknown[]>,
      label: `derived ${field}`,
      targetPartBytes,
      hardPartBytes,
      pathForPart: (_index, key) => `${root}/${field}/${key}.json`,
      createPayload: (records, key) => ({
        graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
        parserVersion: CODE_GRAPH_PARSER_VERSION,
        field,
        key,
        records,
      }),
    })
  }
  return splitRecordIntoBoundedJsonParts<unknown, CodeGraphDerivedSidecarPartData>({
    record,
    label: `derived ${field}`,
    targetPartBytes,
    hardPartBytes,
    pathForPart: (_index, key) => `${root}/${field}/${key}.json`,
    createPayload: (records, key) => ({
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      field,
      key,
      records,
    }),
  })
}

function arrays(field: CodeGraphDerivedSidecarField): boolean {
  return field !== "directoryStats" && field !== "moduleStats"
}

function info(part: BoundedJsonPart<CodeGraphDerivedSidecarPartData>): CodeGraphDerivedSidecarShard {
  return {
    key: part.key,
    path: part.path,
    entries: part.entries,
    estimatedBytes: part.estimatedBytes,
  }
}

function assert(graphSchemaVersion: number, parserVersion: number, label: string): void {
  if (graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION || parserVersion !== CODE_GRAPH_PARSER_VERSION) {
    throw new Error(`Unsupported ${label} version. Rebuild the local code graph index.`)
  }
}

function expected(manifest: CodeGraphDerivedSidecarManifest): Map<string, number> {
  const counts = new Map<string, number>()
  for (const field of CODEGRAPH_DERIVED_SIDECAR_FIELDS) {
    for (const part of manifest.fields[field] ?? []) {
      const key = countKey(field, part.key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

function countKey(field: CodeGraphDerivedSidecarField, key: string): string {
  return `${field}/${key}`
}

function merge(
  derived: CodeGraphDerivedIndex,
  field: CodeGraphDerivedSidecarField,
  records: Record<string, unknown>,
): void {
  const target = derived[field] as Record<string, unknown>
  for (const [key, value] of Object.entries(records).sort(([left], [right]) => left.localeCompare(right))) {
    const existing = target[key]
    target[key] = Array.isArray(existing) && Array.isArray(value) ? [...existing, ...value] : value
  }
}

function sort(derived: CodeGraphDerivedIndex): CodeGraphDerivedIndex {
  return {
    functionIdsByName: sortedArray(derived.functionIdsByName),
    callerIdsByCallee: sortedArray(derived.callerIdsByCallee),
    includeTargetsByFile: sortedArray(derived.includeTargetsByFile),
    filePathsByInclude: sortedArray(derived.filePathsByInclude),
    directoryStats: sortedRecord(derived.directoryStats),
    symbolsByName: sortedArray(derived.symbolsByName),
    symbolsByPath: sortedArray(derived.symbolsByPath),
    postingsByTerm: sortedArray(derived.postingsByTerm),
    moduleStats: sortedRecord(derived.moduleStats),
  }
}

function emptyFields(): CodeGraphDerivedSidecarManifest["fields"] {
  const fields = Object.create(null) as CodeGraphDerivedSidecarManifest["fields"]
  for (const field of CODEGRAPH_DERIVED_SIDECAR_FIELDS) fields[field] = []
  return fields
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right))) as Record<
    string,
    T
  >
}

function sortedArray<T>(record: Record<string, T[]>): Record<string, T[]> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, [...values]]),
  ) as Record<string, T[]>
}

function base(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "derived"
}
