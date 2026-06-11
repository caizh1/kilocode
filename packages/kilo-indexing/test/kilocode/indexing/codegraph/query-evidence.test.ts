import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, mock, test } from "bun:test"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  type CodeGraphFileGraph,
  type CodeGraphManifest,
} from "../../../../src/indexing/codegraph"
import { CodeIndexAnalysisService } from "../../../../src/indexing/analysis"
import { queryVectorEvidence, type VectorEvidenceAdapter } from "../../../../src/indexing/analysis/vector"
import { parseCodeGraphFile } from "../../../../src/indexing/codegraph/parser"
import { CodeGraphJsonStorage, CodePostingsJsonStorage } from "../../../../src/indexing/codegraph/storage"

const driver = `
#include "driver.h"
#include <stdint.h>

#define UART0_BASE 0x40000000u
#define UART0_CTRL_REG (*(volatile uint32_t *)(UART0_BASE + 0x00))

// timeout waiting for device_ready error path EIO
typedef struct device {
  int id;
} device_t;

enum state {
  STATE_IDLE,
  STATE_BUSY,
};

static int global_count = 0;

static int init_uart(void)
{
  return read_reg(UART0_CTRL_REG);
}

int start_device(void)
{
  int rc = init_uart();
  if (rc) {
    goto err_cleanup;
  }
  finish_device();
  return 0;
err_cleanup:
  cleanup_device();
  return rc;
}
`

const other = `
#include "driver.h"

int boot(void)
{
  return start_device();
}
`

async function root() {
  const dir = await mkdtemp(path.join(tmpdir(), "codegraph-query-test-"))
  await mkdir(path.join(dir, "src"), { recursive: true })
  await mkdir(path.join(dir, "include"), { recursive: true })
  return dir
}

function hash(text: string) {
  return digest(text)
}

function graph(workspacePath: string, filePath: string, content: string): CodeGraphFileGraph {
  return parseCodeGraphFile({
    workspacePath,
    filePath,
    content,
    fileHash: hash(content),
    updatedAt: "2026-06-10T00:00:00.000Z",
  })
}

async function fixture(vector?: VectorEvidenceAdapter) {
  const workspacePath = await root()
  const cacheDirectory = path.join(workspacePath, ".cache")
  const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
  const postings = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })
  await storage.beginFullScan()
  await postings.beginFullScan()
  const driverGraph = graph(workspacePath, "src/driver.c", driver)
  const otherGraph = graph(workspacePath, "src/other.c", other)
  await storage.upsertFileGraph(path.join(workspacePath, "src/driver.c"), driverGraph.fileHash, driverGraph)
  await postings.upsertFilePostings(path.join(workspacePath, "src/driver.c"), driverGraph.fileHash, driverGraph, {
    content: driver,
  })
  await storage.upsertFileGraph(path.join(workspacePath, "src/other.c"), otherGraph.fileHash, otherGraph)
  await postings.upsertFilePostings(path.join(workspacePath, "src/other.c"), otherGraph.fileHash, otherGraph, {
    content: other,
  })
  await storage.markFullScanComplete()
  await postings.markFullScanComplete()
  return {
    workspacePath,
    cacheDirectory,
    storage,
    postings,
    service: new CodeIndexAnalysisService(storage, postings, vector),
  }
}

describe("graph-only queryEvidence", () => {
  test("returns exact file and function graph evidence", async () => {
    const ctx = await fixture()

    const file = await ctx.service.queryEvidence("src/driver.c", { retrievalMode: "graph-only" })
    const fn = await ctx.service.queryEvidence("start_device", { retrievalMode: "graph-only" })

    expect(file.evidenceRefs[0]).toMatchObject({
      source: "graph",
      kind: "file",
      filePath: "src/driver.c",
      displayName: "src/driver.c",
      confidence: "high",
    })
    expect(fn.answerPolicy).toMatchObject({ mode: "grounded", confidence: "high" })
    expect(fn.evidenceRefs[0]).toMatchObject({
      source: "graph",
      kind: "function",
      filePath: "src/driver.c",
      symbolName: "start_device",
    })
    expect(fn.evidenceRefs[0]?.startLine).toBeGreaterThan(0)
    expect(fn.formattedPackText).toContain("Graph evidence")
    expect(fn.formattedPackText).toContain("src/driver.c:")
  })

  test("uses bounded fuzzy function symbol fallback with trace details", async () => {
    const ctx = await fixture()
    const result = await ctx.service.queryEvidence("strt_devce", { retrievalMode: "graph-only" })
    const graph = result.trace.stages.find((stage) => stage.name === "graph")

    expect(result.evidenceRefs[0]).toMatchObject({
      kind: "function",
      symbolName: "start_device",
      confidence: "medium",
      reason: "fuzzy function symbol fallback",
    })
    expect(graph?.details).toMatchObject({
      exactMiss: true,
      fuzzyUsed: true,
      maxFuzzyCandidates: 5,
    })
    expect(Number(graph?.details?.candidateCount)).toBeGreaterThan(0)
  })

  test("finds macro, type, and global evidence", async () => {
    const ctx = await fixture()
    const macro = await ctx.service.queryEvidence("UART0_CTRL_REG", { retrievalMode: "graph-only" })
    const type = await ctx.service.queryEvidence("device_t state", { retrievalMode: "graph-only" })
    const global = await ctx.service.queryEvidence("global_count", { retrievalMode: "graph-only" })

    expect(macro.evidenceRefs[0]).toMatchObject({ kind: "macro", symbolName: "UART0_CTRL_REG" })
    expect(type.evidenceRefs.map((item) => `${item.kind}:${item.symbolName}`)).toEqual(
      expect.arrayContaining(["typedef:device_t", "enum:state"]),
    )
    expect(global.evidenceRefs[0]).toMatchObject({ kind: "global", symbolName: "global_count" })
  })

  test("finds callers, callees, call sites, include neighbors, and error labels", async () => {
    const ctx = await fixture()
    const callers = await ctx.service.queryEvidence("who calls start_device", { retrievalMode: "graph-only" })
    const callees = await ctx.service.queryEvidence("what does start_device call", { retrievalMode: "graph-only" })
    const site = await ctx.service.queryEvidence("call site cleanup_device", { retrievalMode: "graph-only" })
    const include = await ctx.service.queryEvidence("include driver.h", { retrievalMode: "graph-only" })
    const label = await ctx.service.queryEvidence("error label err_cleanup", { retrievalMode: "graph-only" })

    expect(callers.evidenceRefs[0]).toMatchObject({
      kind: "caller",
      filePath: "src/other.c",
      callerName: "boot",
      calleeName: "start_device",
      callSite: { filePath: "src/other.c" },
      functionDefinition: { symbolName: "boot" },
    })
    expect(callees.evidenceRefs.map((item) => item.calleeName)).toEqual(
      expect.arrayContaining(["init_uart", "finish_device", "cleanup_device"]),
    )
    expect(site.evidenceRefs[0]).toMatchObject({
      kind: "call_site",
      filePath: "src/driver.c",
      calleeName: "cleanup_device",
    })
    expect(include.evidenceRefs[0]).toMatchObject({
      kind: "include",
      filePath: "src/driver.c",
      includePath: "driver.h",
    })
    expect(label.evidenceRefs[0]).toMatchObject({
      kind: "error_label",
      filePath: "src/driver.c",
      labelName: "err_cleanup",
    })
  })

  test("filters by directoryPrefix before reading graphs", async () => {
    const ctx = await fixture()

    const src = await ctx.service.queryEvidence("start_device", {
      retrievalMode: "graph-only",
      directoryPrefix: "src",
    })
    const include = await ctx.service.queryEvidence("start_device", {
      retrievalMode: "graph-only",
      directoryPrefix: "include",
    })

    expect(src.evidenceRefs.length).toBeGreaterThan(0)
    expect(src.evidenceRefs.every((item) => item.filePath.startsWith("src/"))).toBe(true)
    expect(include.evidenceRefs).toEqual([])
    expect(include.answerPolicy).toMatchObject({ mode: "conservative", confidence: "none" })
  })

  test("keeps graph-only off bm25 and vector while hybrid uses graph bm25 and vector", async () => {
    const vector = mock(async () => [
      {
        id: "vec1",
        score: 0.94,
        payload: {
          filePath: "src/vector.c",
          codeChunk: "int vector_only(void) { return start_device(); }",
          startLine: 7,
          endLine: 7,
        },
      },
    ])
    const ctx = await fixture(vector)
    const graph = await ctx.service.queryEvidence("timeout device_ready", { retrievalMode: "graph-only" })
    const hybrid = await ctx.service.queryEvidence("start_device timeout device_ready", { retrievalMode: "hybrid" })

    expect(vector).toHaveBeenCalledTimes(1)
    expect(graph.trace.effectiveMode).toBe("graph-only")
    expect(graph.evidenceRefs).toEqual([])
    expect(graph.trace.stages.find((stage) => stage.name === "vector")).toMatchObject({
      status: "skipped",
      reason: "graph-only",
    })
    expect(hybrid.trace).toMatchObject({
      requestedMode: "hybrid",
      effectiveMode: "hybrid",
      reason: "hybrid-effective-sources: graph,bm25,vector",
    })
    expect(hybrid.trace.effectiveSources).toEqual(["graph", "bm25", "vector"])
    expect(hybrid.trace.stages.find((stage) => stage.name === "bm25")).toMatchObject({
      status: "completed",
      reason: "valid-postings-records-read",
    })
    expect(hybrid.trace.stages.find((stage) => stage.name === "vector")).toMatchObject({
      status: "ok",
      reason: "valid-vector-results-read",
      details: {
        maxVectorCandidates: 50,
        scoreDirection: "higher-is-better",
      },
    })
    expect(hybrid.trace.stages.find((stage) => stage.name === "rerank")).toMatchObject({
      status: "skipped",
      reason: "rerank-disabled",
    })
    expect(hybrid.trace.stages.find((stage) => stage.name === "pack")?.details).toMatchObject({
      "hybrid-effective-sources": "graph,bm25,vector",
    })
    expect(hybrid.evidenceRefs.map((item) => item.source)).toEqual(expect.arrayContaining(["graph", "bm25", "vector"]))
    expect(hybrid.formattedPackText).toContain("Lexical / BM25 evidence")
    expect(hybrid.formattedPackText).toContain("Semantic / vector evidence")
  })

  test("applies evidence and pack budgets", async () => {
    const ctx = await fixture()
    const result = await ctx.service.queryEvidence("call site start_device init_uart cleanup_device finish_device", {
      retrievalMode: "graph-only",
      maxEvidenceItems: 1,
      maxPackChars: 360,
      maxSnippetCharsPerItem: 12,
    })

    expect(result.evidenceRefs).toHaveLength(1)
    expect(result.evidenceRefs[0]?.shortSnippet?.length).toBeLessThanOrEqual(12)
    expect(result.droppedByBudget.evidenceRefs).toBeGreaterThan(0)
    expect(result.droppedByBudget.packChars).toBeGreaterThan(0)
    expect(result.truncated).toBe(true)
    expect(result.formattedPackText.length).toBeLessThanOrEqual(360)
  })

  test("applies hybrid budget after graph and bm25 fusion", async () => {
    const ctx = await fixture()
    const result = await ctx.service.queryEvidence("start_device timeout UART0_CTRL_REG", {
      retrievalMode: "hybrid",
      maxEvidenceItems: 1,
      maxPackChars: 420,
      maxSnippetCharsPerItem: 16,
    })

    expect(result.evidenceRefs).toHaveLength(1)
    expect(result.droppedByBudget.evidenceRefs).toBeGreaterThan(0)
    expect(result.truncated).toBe(true)
    expect(result.formattedPackText.length).toBeLessThanOrEqual(420)
  })

  test("uses a bounded vector candidate limit and calls the adapter once per hybrid query", async () => {
    const vector = mock(async () => [])
    const ctx = await fixture(vector)

    const result = await ctx.service.queryEvidence("start_device timeout", {
      retrievalMode: "hybrid",
      maxEvidenceItems: 2,
    })

    expect(vector).toHaveBeenCalledTimes(1)
    expect(vector.mock.calls[0]?.[1]).toMatchObject({
      maxResults: 6,
    })
    expect(result.trace.stages.find((stage) => stage.name === "vector")).toMatchObject({
      status: "empty",
      reason: "vector-empty",
    })
  })

  test("falls back when vector is unavailable, empty, malformed, failed, or timed out", async () => {
    const cases: Array<[string, VectorEvidenceAdapter, string]> = [
      ["unavailable", async () => Promise.reject(new Error("vector-search-unavailable")), "unavailable"],
      ["empty", async () => [], "empty"],
      ["malformed", async () => [{ id: "bad", score: 0.5, payload: { filePath: "src/driver.c" } }], "malformed"],
      ["failed", async () => Promise.reject(new Error("boom")), "failed"],
    ]

    for (const [name, adapter, status] of cases) {
      const ctx = await fixture(adapter)
      const result = await ctx.service.queryEvidence("start_device timeout", { retrievalMode: "hybrid" })

      const stage = result.trace.stages.find((item) => item.name === "vector")
      expect(`${name}:${stage?.status}`).toBe(`${name}:${status}`)
      expect(stage).toMatchObject({
        status,
      })
      expect(result.answerPolicy.mode).toBe("grounded")
      expect(result.evidenceRefs.map((item) => item.source)).toEqual(expect.arrayContaining(["graph", "bm25"]))
      expect(result.formattedPackText).toContain("fell back")
    }

    const timeout = await queryVectorEvidence({
      query: "hang",
      maxResults: 1,
      timeoutMs: 1,
      diagnostics: [],
      adapter: async () => new Promise(() => {}),
    })
    expect(timeout).toMatchObject({
      status: "failed",
      reason: "vector-timeout",
    })
  })

  test("filters vector results by directoryPrefix after the vector store returns them", async () => {
    const ctx = await fixture(async () => [
      {
        id: "outside",
        score: 0.99,
        payload: {
          filePath: "other/outside.c",
          codeChunk: "outside hit",
          startLine: 1,
          endLine: 1,
        },
      },
      {
        id: "inside",
        score: 0.92,
        payload: {
          filePath: "src/inside.c",
          codeChunk: "inside hit",
          startLine: 3,
          endLine: 3,
        },
      },
    ])

    const result = await ctx.service.queryEvidence("inside hit", {
      retrievalMode: "hybrid",
      directoryPrefix: "src",
    })

    expect(result.evidenceRefs.some((item) => item.filePath === "other/outside.c")).toBe(false)
    expect(result.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "vector",
          filePath: "src/inside.c",
        }),
      ]),
    )
    expect(result.trace.stages.find((stage) => stage.name === "vector")?.details).toMatchObject({
      filteredByDirectoryPrefix: 1,
    })
  })

  test("allows vector-only line-backed evidence as grounded with low confidence", async () => {
    const ctx = await fixture(async () => [
      {
        id: "only",
        score: 0.62,
        payload: {
          filePath: "src/semantic.c",
          codeChunk: "semantic only weak match",
          startLine: 8,
          endLine: 9,
        },
      },
    ])

    const result = await ctx.service.queryEvidence("semantic only weak match", { retrievalMode: "hybrid" })

    expect(result.answerPolicy).toMatchObject({
      mode: "grounded",
      confidence: "low",
    })
    expect(result.evidenceRefs).toHaveLength(1)
    expect(result.evidenceRefs[0]).toMatchObject({
      source: "vector",
      confidence: "low",
    })
    expect(result.formattedPackText).toContain("Only semantic/vector evidence was returned")
    expect(result.formattedPackText).toContain("exact graph/BM25 support is missing")
  })

  test("returns conservative output when no evidence matches", async () => {
    const ctx = await fixture()
    const result = await ctx.service.queryEvidence("totally_missing_symbol", { retrievalMode: "graph-only" })

    expect(result.answerPolicy).toMatchObject({ mode: "conservative", confidence: "none", allowed: false })
    expect(result.evidenceRefs).toEqual([])
    expect(result.formattedPackText).toContain("No source-backed graph evidence matched this query.")
    expect(result.formattedPackText).toContain("No file path and line-number evidence was returned.")
    expect(result.formattedPackText).toContain("<limitations>")
  })

  test("ignores parse_error unsupported and stale records", async () => {
    const ctx = await fixture()
    await ctx.storage.markFileGraphStatus(path.join(ctx.workspacePath, "src/bad.c"), "parse_error", {
      fileHash: "bad",
      error: "parse failed",
    })
    await ctx.storage.markFileGraphStatus(path.join(ctx.workspacePath, "src/readme.md"), "unsupported", {
      fileHash: "md",
    })
    await ctx.storage.removeFileGraph(path.join(ctx.workspacePath, "src/old.c"))
    await ctx.postings.markFilePostingsStatus(path.join(ctx.workspacePath, "src/driver.c"), "postings_error", {
      fileHash: "bad",
      error: "postings failed",
    })

    const result = await ctx.service.queryEvidence("timeout bad readme old", { retrievalMode: "hybrid" })

    expect(ctx.storage.status()).toMatchObject({
      parseErrorCount: 1,
      unsupportedCount: 1,
      staleCount: 1,
    })
    expect(ctx.postings.status()).toMatchObject({
      postingsErrorCount: 1,
    })
    expect(result.evidenceRefs).toEqual([])
  })

  test("does not read old graph when schema or parser version needs rebuild", async () => {
    const ctx = await fixture()
    const manifestPath = path.join(ctx.cacheDirectory, "codegraph/v1/manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION + 1,
        parserVersion: CODE_GRAPH_PARSER_VERSION + 1,
      }),
      "utf-8",
    )
    const storage = new CodeGraphJsonStorage({ workspacePath: ctx.workspacePath, cacheDirectory: ctx.cacheDirectory })
    const service = new CodeIndexAnalysisService(storage, ctx.postings)
    const result = await service.queryEvidence("start_device", { retrievalMode: "graph-only" })

    expect(storage.status()).toMatchObject({
      schemaMismatch: true,
      parserMismatch: true,
      needsRebuild: true,
      validFileCount: 0,
    })
    expect(result.evidenceRefs).toEqual([])
    expect(result.trace.reason).toBe("parser-mismatch-needs-rebuild")
    expect(result.formattedPackText).toContain("No file path and line-number evidence was returned.")
  })

  test("does not read old postings when tokenizer version needs rebuild", async () => {
    const ctx = await fixture()
    const manifestPath = path.join(ctx.cacheDirectory, "codepostings/v1/manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"))
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        tokenizerVersion: 999,
      }),
      "utf-8",
    )
    const postings = new CodePostingsJsonStorage({ workspacePath: ctx.workspacePath, cacheDirectory: ctx.cacheDirectory })
    const service = new CodeIndexAnalysisService(ctx.storage, postings)
    const result = await service.queryEvidence("timeout device_ready", { retrievalMode: "hybrid" })

    expect(postings.status()).toMatchObject({
      tokenizerMismatch: true,
      needsRebuild: true,
      validFileCount: 0,
    })
    expect(result.evidenceRefs).toEqual([])
    expect(result.trace.stages.find((stage) => stage.name === "bm25")).toMatchObject({
      status: "skipped",
      reason: "tokenizer-mismatch-needs-rebuild",
    })
  })

  test("omits graph items missing line ranges from evidence", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const parsed = graph(workspacePath, "src/driver.c", driver)
    const bad = {
      ...parsed,
      macros: [{ ...parsed.macros.find((item) => item.name === "UART0_CTRL_REG"), startLine: undefined }],
    } as unknown as CodeGraphFileGraph
    await storage.upsertFileGraph(path.join(workspacePath, "src/driver.c"), parsed.fileHash, bad)
    const service = new CodeIndexAnalysisService(storage)
    const result = await service.queryEvidence("UART0_CTRL_REG", { retrievalMode: "graph-only" })

    expect(result.evidenceRefs).toEqual([])
    expect(result.trace.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "missing-line-range",
          filePath: "src/driver.c",
          kind: "macro",
        }),
      ]),
    )
  })
})

function digest(value: string): string {
  return `${fnv(value, 0x811c9dc5)}${fnv(value, 0x45d9f3b)}`
}

function fnv(value: string, seed: number): string {
  let hash = seed
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
