import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { CodeIndexAnalysisService } from "@kilocode/kilo-indexing/engine"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Agent } from "../../src/agent/agent"
import { CodebaseAnalysisTool } from "../../src/kilocode/tool/codebase-analysis"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { WithInstance } from "../../src/project/with-instance"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"

const rt = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

async function initTool() {
  return rt.runPromise(
    Effect.gen(function* () {
      const info = yield* CodebaseAnalysisTool
      return yield* Tool.init(info)
    }),
  )
}

const baseCtx = {
  sessionID: SessionID.make("ses_test-codebase-analysis"),
  messageID: MessageID.make("msg_test-codebase-analysis"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
} satisfies Tool.Context

describe("tool.codebase_analysis", () => {
  test("describes C/C++ analysis use cases", async () => {
    const tool = await initTool()

    expect(tool.description).toContain("C/C++ symbol relationships")
    expect(tool.description).toContain("call chains")
    expect(tool.description).toContain("semantic_search")
  })

  test("throws when query is empty", async () => {
    const tool = await initTool()
    expect(rt.runPromise(tool.execute({ query: "" }, baseCtx))).rejects.toThrow("query is required")
  })

  test("asks permission and forwards options to queryEvidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const stub = CodeIndexAnalysisService.createStub("find cleanup paths", { retrievalMode: "graph-only" })
        const query = spyOn(KiloIndexing, "queryEvidence").mockResolvedValue(stub)

        try {
          const tool = await initTool()
          const result = await rt.runPromise(
            tool.execute(
              {
                query: "find cleanup paths",
                path: "./drivers/../drivers/ufs",
                mode: "graph-only",
                maxEvidenceItems: 5,
                maxPackChars: 1000,
              },
              {
                ...baseCtx,
                ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
                  requests.push(req)
                  return Effect.void
                },
              },
            ),
          )

          expect(requests).toHaveLength(1)
          expect(requests[0]?.permission).toBe("codebase_analysis")
          expect(requests[0]?.metadata).toEqual({
            query: "find cleanup paths",
            path: "./drivers/../drivers/ufs",
            mode: "graph-only",
          })
          expect(query).toHaveBeenCalledWith("find cleanup paths", {
            directoryPrefix: path.normalize("drivers/ufs"),
            retrievalMode: "graph-only",
            maxEvidenceItems: 5,
            maxPackChars: 1000,
          })
          expect(result.output).toContain("<local-analysis-pack")
          expect(result.output).toContain("<query-trace>")
          expect(result.output).toContain("rerank-disabled")
          expect(result.metadata.result.trace.retrievalMode).toBe("graph-only")
          expect(result.metadata.trace).toEqual(stub.trace)
          expect(result.metadata.answerPolicy).toEqual(stub.answerPolicy)
          expect(result.metadata.evidenceRefs).toEqual(stub.evidenceRefs)
          expect(result.metadata.result).toBe(stub)
          expect(result.metadata.answerPolicy).toMatchObject({
            mode: "conservative",
            confidence: "none",
          })
          expect(result.metadata.evidenceRefs).toEqual([])
          expect(result.output).toContain("No file path and line-number evidence was returned.")
          expect(result.output).not.toContain("<evidence-ref")
        } finally {
          query.mockRestore()
        }
      },
    })
  })

  test("defaults to hybrid mode", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const stub = CodeIndexAnalysisService.createStub("find callers", { retrievalMode: "hybrid" })
        const query = spyOn(KiloIndexing, "queryEvidence").mockResolvedValue(stub)

        try {
          const tool = await initTool()
          const result = await rt.runPromise(tool.execute({ query: "find callers" }, baseCtx))

          expect(query).toHaveBeenCalledWith("find callers", {
            retrievalMode: "hybrid",
          })
          expect(result.metadata.trace.retrievalMode).toBe("hybrid")
          expect(result.metadata.result).toBe(stub)
        } finally {
          query.mockRestore()
        }
      },
    })
  })

  test("returns fused graph bm25 and vector evidence in default hybrid mode", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const stub = CodeIndexAnalysisService.createStub("start_device timeout", { retrievalMode: "hybrid" })
        const result = {
          ...stub,
          trace: {
            ...stub.trace,
            requestedMode: "hybrid" as const,
            effectiveMode: "hybrid" as const,
            effectiveSources: ["graph" as const, "bm25" as const, "vector" as const],
            reason: "hybrid-effective-sources: graph,bm25,vector",
            stages: stub.trace.stages.map((stage) => {
              if (stage.name === "bm25") return { ...stage, status: "completed" as const, reason: "valid-postings-records-read", count: 1 }
              if (stage.name === "vector")
                return {
                  ...stage,
                  status: "ok" as const,
                  reason: "valid-vector-results-read",
                  count: 1,
                  details: {
                    source: "vector",
                    scoreDirection: "higher-is-better",
                  },
                }
              if (stage.name === "rerank") return { ...stage, status: "skipped" as const, reason: "rerank-disabled" }
              if (stage.name === "pack")
                return {
                  ...stage,
                  details: {
                    "hybrid-effective-sources": "graph,bm25,vector",
                    sources: "exact,graph,bm25,vector",
                  },
                }
              return stage
            }),
          },
          answerPolicy: {
            ...stub.answerPolicy,
            mode: "grounded" as const,
            confidence: "high" as const,
            allowed: true,
            reason: "Source-backed graph, BM25, and/or vector evidence with file paths and line numbers was returned.",
          },
          evidenceRefs: [
            {
              id: "graph_start",
              source: "graph" as const,
              path: "src/driver.c",
              filePath: "src/driver.c",
              startLine: 20,
              endLine: 34,
              kind: "function",
              reason: "exact function symbol match",
              confidence: "high" as const,
              symbolName: "start_device",
              displayName: "int start_device(void)",
            },
            {
              id: "bm25_timeout",
              source: "bm25" as const,
              path: "src/driver.c",
              filePath: "src/driver.c",
              startLine: 5,
              endLine: 5,
              kind: "lexical",
              reason: "BM25 lexical match on timeout",
              confidence: "low" as const,
              score: 1.25,
              displayName: "comment",
              shortSnippet: "timeout waiting for device_ready",
            },
            {
              id: "vector_timeout",
              source: "vector" as const,
              path: "src/vector.c",
              filePath: "src/vector.c",
              startLine: 9,
              endLine: 12,
              kind: "semantic",
              reason: "semantic vector match from existing Kilo index",
              confidence: "medium" as const,
              score: 0.94,
              displayName: "src/vector.c:9-12",
              shortSnippet: "semantic timeout match",
            },
          ],
          formattedPackText:
            '<local-analysis-pack><graph-evidence title="Graph evidence">src/driver.c:20-34 start_device</graph-evidence><bm25-evidence title="Lexical / BM25 evidence">src/driver.c:5-5 timeout</bm25-evidence><vector-evidence title="Semantic / vector evidence">src/vector.c:9-12 timeout</vector-evidence><limitations>Phase 5 uses valid C/C++ graph records, BM25 postings, and existing Kilo vector search.</limitations></local-analysis-pack>',
        }
        const query = spyOn(KiloIndexing, "queryEvidence").mockResolvedValue(result)

        try {
          const tool = await initTool()
          const output = await rt.runPromise(tool.execute({ query: "start_device timeout" }, baseCtx))

          expect(query).toHaveBeenCalledWith("start_device timeout", {
            retrievalMode: "hybrid",
          })
          expect(output.output).toContain("Lexical / BM25 evidence")
          expect(output.output).toContain("Semantic / vector evidence")
          expect(output.metadata.trace).toEqual(result.trace)
          expect(output.metadata.trace.effectiveMode).toBe("hybrid")
          expect(output.metadata.trace.effectiveSources).toEqual(["graph", "bm25", "vector"])
          expect(output.metadata.evidenceRefs.map((item) => item.source)).toEqual(
            expect.arrayContaining(["graph", "bm25", "vector"]),
          )
          expect(output.metadata.result).toBe(result)
        } finally {
          query.mockRestore()
        }
      },
    })
  })

  test("surfaces vector fallback without failing the tool", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const stub = CodeIndexAnalysisService.createStub("timeout", { retrievalMode: "hybrid" })
        const result = {
          ...stub,
          trace: {
            ...stub.trace,
            effectiveMode: "hybrid" as const,
            effectiveSources: ["graph" as const, "bm25" as const, "vector" as const],
            reason: "hybrid-effective-sources: graph,bm25,vector",
            stages: stub.trace.stages.map((stage) => {
              if (stage.name === "vector") return { ...stage, status: "unavailable" as const, reason: "vector-search-unavailable" }
              return stage
            }),
          },
          answerPolicy: {
            ...stub.answerPolicy,
            mode: "grounded" as const,
            confidence: "medium" as const,
            allowed: true,
          },
          evidenceRefs: [
            {
              id: "bm25_timeout",
              source: "bm25" as const,
              path: "src/driver.c",
              filePath: "src/driver.c",
              startLine: 5,
              endLine: 5,
              kind: "lexical",
              reason: "BM25 lexical match on timeout",
              confidence: "medium" as const,
              score: 1.2,
              displayName: "timeout",
            },
          ],
          formattedPackText:
            '<local-analysis-pack><vector-evidence title="Semantic / vector evidence">Semantic/vector evidence unavailable</vector-evidence><limitations>fallback to graph + BM25</limitations></local-analysis-pack>',
        }
        const query = spyOn(KiloIndexing, "queryEvidence").mockResolvedValue(result)

        try {
          const tool = await initTool()
          const output = await rt.runPromise(tool.execute({ query: "timeout" }, baseCtx))

          expect(output.output).toContain("fallback")
          expect(output.metadata.trace.stages.find((stage) => stage.name === "vector")).toMatchObject({
            status: "unavailable",
            reason: "vector-search-unavailable",
          })
          expect(output.metadata.result).toBe(result)
        } finally {
          query.mockRestore()
        }
      },
    })
  })

  test("returns graph evidence output and metadata in graph-only mode", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const stub = CodeIndexAnalysisService.createStub("who calls start_device", { retrievalMode: "graph-only" })
        const result = {
          ...stub,
          answerPolicy: {
            ...stub.answerPolicy,
            mode: "grounded" as const,
            confidence: "high" as const,
            allowed: true,
            reason: "Source-backed graph evidence with file paths and line numbers was returned.",
          },
          evidenceRefs: [
            {
              id: "graph_test",
              source: "graph" as const,
              path: "src/other.c",
              filePath: "src/other.c",
              startLine: 5,
              endLine: 5,
              kind: "caller",
              reason: "caller query matched callee at call site",
              confidence: "high" as const,
              callerName: "boot",
              calleeName: "start_device",
              displayName: "boot -> start_device",
              shortSnippet: "return start_device();",
              snippet: "return start_device();",
              callSite: {
                filePath: "src/other.c",
                startLine: 5,
                endLine: 5,
              },
              functionDefinition: {
                filePath: "src/other.c",
                startLine: 3,
                endLine: 6,
                symbolName: "boot",
              },
            },
          ],
          formattedPackText:
            '<local-analysis-pack><graph-evidence title="Graph evidence">src/other.c:5-5 boot -> start_device</graph-evidence><limitations>Phase 3 only reads valid C/C++ graph records.</limitations></local-analysis-pack>',
        }
        const query = spyOn(KiloIndexing, "queryEvidence").mockResolvedValue(result)

        try {
          const tool = await initTool()
          const output = await rt.runPromise(
            tool.execute(
              {
                query: "who calls start_device",
                mode: "graph-only",
              },
              baseCtx,
            ),
          )

          expect(query).toHaveBeenCalledWith("who calls start_device", {
            retrievalMode: "graph-only",
          })
          expect(output.output).toContain("src/other.c:5-5")
          expect(output.output).toContain("<limitations>")
          expect(output.metadata.trace).toEqual(result.trace)
          expect(output.metadata.answerPolicy).toEqual(result.answerPolicy)
          expect(output.metadata.evidenceRefs).toEqual(result.evidenceRefs)
          expect(output.metadata.result).toBe(result)
        } finally {
          query.mockRestore()
        }
      },
    })
  })

  test("rejects paths outside the workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const query = spyOn(KiloIndexing, "queryEvidence").mockResolvedValue(
          CodeIndexAnalysisService.createStub("auth"),
        )

        try {
          const tool = await initTool()
          expect(rt.runPromise(tool.execute({ query: "auth", path: "../outside" }, baseCtx))).rejects.toThrow(
            "path must be within the current workspace: ../outside",
          )
          expect(query).not.toHaveBeenCalled()
        } finally {
          query.mockRestore()
        }
      },
    })
  })
})
