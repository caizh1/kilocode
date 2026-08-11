import { describe, expect, test } from "bun:test"
import {
  splitArrayRecordIntoBoundedJsonParts,
  splitRecordIntoBoundedJsonParts,
} from "../../../../src/indexing/codegraph/bounded-json"
import { buildCodeGraphDerivedIndex } from "../../../../src/indexing/codegraph/derived-index"
import {
  mergeCodeGraphDerivedSidecar,
  splitCodeGraphDerivedIndex,
} from "../../../../src/indexing/codegraph/derived-storage"
import {
  mergeCodeGraphFileStorageParts,
  splitCodeGraphFilesForStorage,
} from "../../../../src/indexing/codegraph/file-storage"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  type CodeGraphFileGraph,
} from "../../../../src/indexing/codegraph"

describe("Code Graph sharded storage layout", () => {
  test("splits bounded JSON around the target and rejects hard-limit records", () => {
    const parts = splitRecordIntoBoundedJsonParts<string, { key: string; records: Record<string, string> }>({
      record: {
        a: "x".repeat(120),
        b: "y".repeat(120),
        c: "z".repeat(120),
      },
      label: "bounded test",
      targetPartBytes: 180,
      hardPartBytes: 800,
      pathForPart: (_index, key) => `${key}.json`,
      createPayload: (records, key) => ({ key, records }),
    })

    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part) => part.estimatedBytes <= 800)).toBe(true)
    expect(() =>
      splitRecordIntoBoundedJsonParts<string, { key: string; records: Record<string, string> }>({
        record: { huge: "x".repeat(1000) },
        label: "bounded hard",
        targetPartBytes: 180,
        hardPartBytes: 300,
        pathForPart: (_index, key) => `${key}.json`,
        createPayload: (records, key) => ({ key, records }),
      }),
    ).toThrow(/hard JSON part limit/)
  })

  test("keeps ordinary file graphs as whole parts", () => {
    const graph = sample("src/main.c")
    const parts = splitCodeGraphFilesForStorage(
      { [graph.filePath]: graph },
      {
        shardKey: "src",
        basePath: "shards/gen/src",
        label: "small shard",
        targetPartBytes: 8192,
        hardPartBytes: 16384,
      },
    )
    const stored = parts.flatMap((part) => part.payload.fileParts)

    expect(stored).toHaveLength(1)
    expect(stored[0]?.kind).toBe("whole")
    expect(mergeCodeGraphFileStorageParts(parts.map((part) => part.payload))).toEqual({ [graph.filePath]: graph })
  })

  test("splits large file graphs into base plus array chunks and merges losslessly", () => {
    const graph = sample("drivers/big/main.c", 90)
    const parts = splitCodeGraphFilesForStorage(
      { [graph.filePath]: graph },
      {
        shardKey: "drivers/big",
        basePath: "shards/gen/drivers_big",
        label: "large shard",
        targetPartBytes: 900,
        hardPartBytes: 12000,
      },
    )
    const stored = parts.flatMap((part) => part.payload.fileParts)

    expect(stored.some((part) => part.kind === "base")).toBe(true)
    expect(stored.some((part) => part.kind === "array" && part.field === "functions")).toBe(true)
    expect(mergeCodeGraphFileStorageParts(parts.map((part) => part.payload))).toEqual({ [graph.filePath]: graph })
  })

  test("splits and merges derived sidecar records without losing symbol or posting indexes", () => {
    const graph = sample("drivers/nand/nand.c", 12)
    const derived = buildCodeGraphDerivedIndex({ [graph.filePath]: graph })
    const sidecar = splitCodeGraphDerivedIndex(derived, {
      basePath: "derived/gen",
      targetPartBytes: 700,
      hardPartBytes: 5000,
    })

    expect(sidecar.manifest.fields.symbolsByName.length).toBeGreaterThan(0)
    expect(sidecar.manifest.fields.callerIdsByCallee.length).toBeGreaterThan(0)
    expect(sidecar.manifest.fields.postingsByTerm.length).toBeGreaterThan(0)
    expect(mergeCodeGraphDerivedSidecar(sidecar)).toEqual(derived)
  })

  test("splits oversized array values into bounded chunks", () => {
    const parts = splitArrayRecordIntoBoundedJsonParts<string, { key: string; records: Record<string, string[]> }>({
      record: {
        dense: Array.from({ length: 40 }, (_, index) => `symbol_${index}_${"x".repeat(20)}`),
      },
      label: "array chunks",
      targetPartBytes: 500,
      hardPartBytes: 2000,
      pathForPart: (_index, key) => `${key}.json`,
      createPayload: (records, key) => ({ key, records }),
    })

    expect(parts.length).toBeGreaterThan(1)
    expect(parts.reduce((sum, part) => sum + part.entries, 0)).toBe(40)
  })
})

function sample(filePath: string, count = 1): CodeGraphFileGraph {
  const functions = Array.from({ length: count }, (_, index) => ({
    kind: "function" as const,
    id: `${filePath}:fn_${index}:${index + 2}`,
    name: `fn_${index}`,
    signature: `int fn_${index}(void)`,
    startLine: index + 2,
    endLine: index + 4,
    isStatic: true,
    calls: [
      {
        callerName: `fn_${index}`,
        calleeName: index % 2 === 0 ? "shared_helper" : "local_helper",
        args: [],
        startLine: index + 3,
        endLine: index + 3,
        shortSnippet: "shared_helper();",
      },
    ],
    shortSnippet: `int fn_${index}(void) { return ${index}; }`,
  }))
  return {
    workspacePath: "/workspace",
    graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
    parserVersion: CODE_GRAPH_PARSER_VERSION,
    filePath,
    fileHash: `${filePath}:${count}`,
    language: "c",
    includes: [{ target: "nand.h", system: false, startLine: 1, endLine: 1, shortSnippet: '#include "nand.h"' }],
    macros: [{ kind: "macro", name: "NAND_CTRL", startLine: 1, endLine: 1, shortSnippet: "#define NAND_CTRL 1" }],
    functions,
    declarations: [],
    calls: functions.flatMap((fn) => fn.calls),
    types: [
      {
        kind: "struct",
        name: "nand_chip",
        startLine: 20,
        endLine: 24,
        shortSnippet: "struct nand_chip { int ready; };",
        fields: [
          {
            name: "ready",
            type: "int",
            startLine: 21,
            endLine: 21,
            shortSnippet: "int ready;",
          },
        ],
      },
    ],
    globals: [{ kind: "global", name: "nand_ready", startLine: 30, endLine: 30, shortSnippet: "int nand_ready;" }],
    initializers: [],
    labels: [],
    registerMacroFamilies: [],
    updatedAt: "2026-06-10T00:00:00.000Z",
  }
}
