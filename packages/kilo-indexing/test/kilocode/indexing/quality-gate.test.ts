import { describe, expect, test } from "bun:test"
import {
  buildCodeGraphDerivedIndex,
  CODEGRAPH_DERIVED_INDEX_FIELDS,
  CodeGraphDerivedIndexBuilder,
} from "../../../src/indexing/codegraph/derived-index"
import { buildPostingsDocument } from "../../../src/indexing/codegraph/postings/builder"
import type { CodeGraphFileGraph } from "../../../src/indexing/codegraph/types"
import {
  buildQualityManifest,
  compareQualityManifests,
  parseQualityManifest,
  type QualityInput,
} from "../../../src/indexing/kilocode/quality-gate"
import {
  fallbackCheckpointMeta,
  generationForFile,
  pointForBlock,
  vectorContext,
} from "../../../src/indexing/rag-checkpoint"
import type { CodeBlock } from "../../../src/indexing/interfaces"
import { CodeParser } from "../../../src/indexing/processors/parser"

const root = "/workspace"
const block: CodeBlock = {
  file_path: "/workspace/src/flash.c",
  identifier: "flash_read",
  type: "function_definition",
  start_line: 3,
  end_line: 8,
  content: "int flash_read(void) { return 0; }",
  fileHash: "file-hash",
  segmentHash: "segment-hash",
}

describe("RAG quality gate", () => {
  test("validates persisted manifests before comparison", () => {
    const manifest = buildQualityManifest({ candidates: [block.file_path] })
    expect(parseQualityManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest)
    expect(() => parseQualityManifest({ version: 1 })).toThrow("Invalid RAG quality manifest.")
  })

  test("locks the current C parser chunk identity", async () => {
    const content = `#include <stdint.h>
static int flash_read(uint32_t addr, uint32_t length, uint8_t *buffer) {
  if (addr == 0 || length == 0 || buffer == 0) return -1;
  for (uint32_t i = 0; i < length; i++) buffer[i] = (uint8_t)(addr + i);
  return (int)length;
}
`
    const chunks = await new CodeParser().parseFile("/workspace/src/flash.c", {
      content,
      fileHash: "fixture-file-hash",
    })

    expect(buildQualityManifest({ chunks }).chunks).toEqual([
      {
        key: [
          "/workspace/src/flash.c",
          2,
          2,
          "function_declarator",
          "flash_read",
          "2236a26f3de3b6233cc7e361430dd005f0b289912f2e9ed87313d74df432f6a0",
        ].join("\0"),
        fileHash: "fixture-file-hash",
        contentHash: "2485cceeae83ea7530ea9f6b03b9a012fa126599404d996b7d2a4ecca9cd78db",
      },
    ])
  })

  test("accepts runtime-only differences from the actual point builder", () => {
    const meta = fallbackCheckpointMeta(root)
    const generation = generationForFile(meta, "src/flash.c", block.fileHash)
    const first = pointForBlock({
      block,
      vector: [0.1, 0.2, 0.3],
      workspace: root,
      ctx: vectorContext(root, "run-a", meta),
      generation,
    })
    const second = pointForBlock({
      block,
      vector: [0.1, 0.2, 0.3],
      workspace: root,
      ctx: vectorContext(root, "run-b", meta),
      generation,
    })

    const baseline = buildQualityManifest({ candidates: [block.file_path], chunks: [block], points: [first] })
    const candidate = buildQualityManifest({ candidates: [block.file_path], chunks: [block], points: [second] })

    expect(baseline.points).toEqual([
      {
        id: "3f7b4a7b-98e5-501d-a7b1-ecbc64262490",
        vectorHash: "9e9de4ffd2c4e28c8ca3764d2567d8ba1e2c1efcc3f64eb11fd77fd5b51a31b3",
        payloadHash: "2cc074eb4427dee934e36b047bd63da763bc06f472a8ca7eb5467a5b5de1c9bf",
      },
    ])
    expect(compareQualityManifests(baseline, candidate)).toEqual({ ok: true, mismatches: [] })
  })

  test("detects candidate, chunk, embedding batch, vector, and payload changes", () => {
    const baseline = buildQualityManifest({
      candidates: [block.file_path],
      chunks: [block],
      batches: [[block.content, "second"]],
      points: [{ id: "point", vector: [0.1, 0.2], payload: { active: true, filePath: "src/flash.c" } }],
    })
    const candidate = buildQualityManifest({
      candidates: [block.file_path, "/workspace/src/extra.c"],
      chunks: [{ ...block, content: `${block.content}\n` }],
      batches: [["second", block.content]],
      points: [{ id: "point", vector: [0.1, 0.3], payload: { active: false, filePath: "src/flash.c" } }],
    })

    const report = compareQualityManifests(baseline, candidate)
    expect(report.ok).toBe(false)
    expect(report.mismatches).toEqual([
      "candidates differs",
      "chunks differs",
      "embedding batches differs",
      "vector points differs",
    ])
  })

  test("compares actual graph, postings, and derived logical records without timestamps", () => {
    const first = graph("2026-07-14T00:00:00.000Z")
    const second = graph("2026-07-14T01:00:00.000Z")
    const firstDoc = buildPostingsDocument({ workspacePath: root, graph: first, updatedAt: first.updatedAt })
    const secondDoc = buildPostingsDocument({ workspacePath: root, graph: second, updatedAt: second.updatedAt })
    const baseline = buildQualityManifest({
      graphs: [first],
      postings: [firstDoc],
      derived: buildCodeGraphDerivedIndex({ [first.filePath]: first }),
    })
    const equivalent = buildQualityManifest({
      graphs: [second],
      postings: [secondDoc],
      derived: buildCodeGraphDerivedIndex({ [second.filePath]: second }),
    })

    expect({ graphs: baseline.graphs, postings: baseline.postings, derivedHash: baseline.derivedHash }).toEqual({
      graphs: [{ filePath: "src/flash.c", hash: "4d60d195765cde67dbde2a0ec6d74a128159b88fd14d5a70fe5cfdaa392e3e6b" }],
      postings: [{ filePath: "src/flash.c", hash: "a0e850083098e5baf913a698d343b02173136d44bd99f84053d38946616c0750" }],
      derivedHash: "451749c011a4f38fed2d508d4ecaa267070a1437b531f63a2f63b5567366dc06",
    })

    expect(compareQualityManifests(baseline, equivalent).ok).toBe(true)

    secondDoc.terms.flash.termFrequency += 1
    const changed = buildQualityManifest({
      graphs: [second],
      postings: [secondDoc],
      derived: buildCodeGraphDerivedIndex({ [second.filePath]: second }),
    })
    expect(compareQualityManifests(baseline, changed).mismatches).toContain("postings differs")
  })

  test("builds every derived field in bounded passes without changing logical data", () => {
    const first = graph("2026-07-14T00:00:00.000Z")
    const second = graph("2026-07-14T00:00:00.000Z")
    second.filePath = "src/controller.c"
    second.fileHash = "controller-hash"
    second.functions = [
      {
        kind: "function",
        id: "src/controller.c:function:controller:4",
        name: "controller",
        signature: "int controller(void)",
        isStatic: false,
        calls: [
          {
            callerName: "controller",
            calleeName: "flash_read",
            args: [],
            startLine: 5,
            endLine: 5,
          },
        ],
        startLine: 4,
        endLine: 9,
      },
    ]
    second.calls = second.functions[0].calls
    const graphs = [first, second].sort((left, right) => left.filePath.localeCompare(right.filePath))
    const complete = buildCodeGraphDerivedIndex(Object.fromEntries(graphs.map((item) => [item.filePath, item])))

    for (const field of CODEGRAPH_DERIVED_INDEX_FIELDS) {
      const builder = new CodeGraphDerivedIndexBuilder([field])
      for (const item of graphs) builder.add(item)
      expect(builder.build()[field]).toEqual(complete[field])
    }
  })

  test("allows tie reordering but rejects non-tie reordering and score drift", () => {
    const baseline = buildQualityManifest(
      searches([result("src/a.c", 1, 0.9), result("src/b.c", 2, 0.9), result("src/c.c", 3, 0.7)]),
    )
    const tied = buildQualityManifest(
      searches([result("src/b.c", 2, 0.9000001), result("src/a.c", 1, 0.9), result("src/c.c", 3, 0.7)]),
    )
    const reordered = buildQualityManifest(
      searches([result("src/c.c", 3, 0.9), result("src/a.c", 1, 0.9), result("src/b.c", 2, 0.7)]),
    )
    const drifted = buildQualityManifest(
      searches([result("src/a.c", 1, 0.9), result("src/b.c", 2, 0.9), result("src/c.c", 3, 0.6)]),
    )

    expect(compareQualityManifests(baseline, tied).ok).toBe(true)
    expect(compareQualityManifests(baseline, reordered).mismatches).toContain("search order differs for flash at 1-2")
    expect(compareQualityManifests(baseline, drifted).mismatches).toContain("search score differs for flash at 3")
  })
})

function graph(updatedAt: string): CodeGraphFileGraph {
  return {
    workspacePath: root,
    graphSchemaVersion: 1,
    parserVersion: 1,
    filePath: "src/flash.c",
    fileHash: "file-hash",
    language: "c",
    includes: [],
    macros: [],
    functions: [
      {
        kind: "function",
        id: "src/flash.c:function:flash_read:3",
        name: "flash_read",
        signature: "int flash_read(void)",
        isStatic: false,
        calls: [],
        startLine: 3,
        endLine: 8,
        shortSnippet: block.content,
      },
    ],
    declarations: [],
    calls: [],
    types: [],
    globals: [],
    initializers: [],
    labels: [],
    registerMacroFamilies: [],
    updatedAt,
  }
}

function searches(results: NonNullable<QualityInput["searches"]>[string]): QualityInput {
  return { searches: { flash: results } }
}

function result(filePath: string, line: number, score: number) {
  return {
    id: `${filePath}:${line}`,
    score,
    payload: {
      filePath,
      codeChunk: `chunk ${filePath}`,
      startLine: line,
      endLine: line + 1,
    },
  }
}
