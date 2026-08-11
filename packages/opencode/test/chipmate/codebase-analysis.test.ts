import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { CodeIndexAnalysisService } from "@chipmate/chipmate-indexing/engine"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Agent } from "../../src/agent/agent"
import { CodebaseAnalysisTool } from "../../src/chipmate/tool/codebase-analysis"
import { ChipMateIndexing } from "../../src/chipmate/indexing"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
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

    expect(tool.description).toContain("optional supporting evidence")
    expect(tool.description).toContain("not as a prerequisite")
    expect(tool.description).toContain("call chains")
    expect(tool.description).toContain("When to use Grep instead")
    expect(tool.description).toContain("only asks where an exact identifier")
    expect(tool.description).toContain("Directly locating and reading")
    expect(tool.description).toContain("If the index is not ready")
    expect(tool.description).toContain("semantic_search")
    expect(tool.description).not.toContain("Use this tool first")
    expect(tool.description).not.toMatch(/take priority/i)
  })

  test("throws when query is empty", async () => {
    const tool = await initTool()
    expect(rt.runPromise(tool.execute({ query: "" }, baseCtx))).rejects.toThrow("query is required")
  })

  test("asks permission and forwards options to queryEvidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const stub = CodeIndexAnalysisService.createStub("find cleanup paths", { retrievalMode: "graph-only" })
        const query = spyOn(ChipMateIndexing, "queryEvidence").mockResolvedValue(stub)

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
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const stub = CodeIndexAnalysisService.createStub("find callers", { retrievalMode: "hybrid" })
        const query = spyOn(ChipMateIndexing, "queryEvidence").mockResolvedValue(stub)

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
    await provideTestInstance({
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
              if (stage.name === "bm25")
                return { ...stage, status: "completed" as const, reason: "valid-postings-records-read", count: 1 }
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
              reason: "semantic vector match from existing ChipMate index",
              confidence: "medium" as const,
              score: 0.94,
              displayName: "src/vector.c:9-12",
              shortSnippet: "semantic timeout match",
            },
          ],
          formattedPackText:
            '<local-analysis-pack><graph-evidence title="Graph evidence">src/driver.c:20-34 start_device</graph-evidence><bm25-evidence title="Lexical / BM25 evidence">src/driver.c:5-5 timeout</bm25-evidence><vector-evidence title="Semantic / vector evidence">src/vector.c:9-12 timeout</vector-evidence><limitations>Phase 5 uses valid C/C++ graph records, BM25 postings, and existing ChipMate vector search.</limitations></local-analysis-pack>',
        }
        const query = spyOn(ChipMateIndexing, "queryEvidence").mockResolvedValue(result)

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

  test("surfaces structured error path evidence from queryEvidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const stub = CodeIndexAnalysisService.createStub("error path start_device", { retrievalMode: "hybrid" })
        const result = {
          ...stub,
          trace: {
            ...stub.trace,
            requestedMode: "hybrid" as const,
            effectiveMode: "hybrid" as const,
            errorPathIntent: {
              enabled: true,
              reason: "intent-matched-line-backed-evidence",
              matchedKeywords: ["error path"],
              graphCandidateCount: 1,
              bm25CandidateCount: 0,
              vectorCandidateCount: 0,
              generatedCount: 1,
              droppedByBudget: 0,
              limitations: [],
            },
          },
          answerPolicy: {
            ...stub.answerPolicy,
            mode: "grounded" as const,
            confidence: "high" as const,
            allowed: true,
            reason: "Source-backed error/cleanup path evidence with file paths and line numbers was returned.",
          },
          evidenceRefs: [
            {
              id: "error_cleanup",
              source: "graph" as const,
              path: "src/driver.c",
              filePath: "src/driver.c",
              startLine: 29,
              endLine: 31,
              kind: "cleanup-path",
              reason: "cleanup path evidence derived from graph candidate",
              confidence: "high" as const,
              functionName: "start_device",
              labelName: "err_cleanup",
              cleanupCalls: ["cleanup_device"],
              returnStyle: "return rc;",
              displayName: "start_device:err_cleanup",
            },
          ],
          errorPaths: [
            {
              id: "path_cleanup",
              functionName: "start_device",
              labelName: "err_cleanup",
              branchKind: "cleanup-call" as const,
              cleanupCalls: ["cleanup_device"],
              returnStyle: "return rc;",
              filePath: "src/driver.c",
              startLine: 29,
              endLine: 31,
              confidence: "high" as const,
              limitations: [],
              backingEvidenceRefs: ["error_cleanup"],
            },
          ],
          formattedPackText:
            '<local-analysis-pack><error-path-evidence title="Error / cleanup path evidence">src/driver.c:29-31 cleanup_device</error-path-evidence><limitations>source-backed</limitations></local-analysis-pack>',
        }
        const query = spyOn(ChipMateIndexing, "queryEvidence").mockResolvedValue(result)

        try {
          const tool = await initTool()
          const output = await rt.runPromise(tool.execute({ query: "error path start_device" }, baseCtx))

          expect(query).toHaveBeenCalledWith("error path start_device", {
            retrievalMode: "hybrid",
          })
          expect(output.output).toContain("Error / cleanup path evidence")
          expect(output.metadata.result.errorPaths).toEqual(result.errorPaths)
          expect(output.metadata.result.errorPaths[0]).toMatchObject({
            functionName: "start_device",
            cleanupCalls: ["cleanup_device"],
          })
          expect(output.metadata.evidenceRefs[0]).toMatchObject({
            kind: "cleanup-path",
            source: "graph",
          })
        } finally {
          query.mockRestore()
        }
      },
    })
  })

  test("surfaces structured candidate state and flow evidence from queryEvidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const stub = CodeIndexAnalysisService.createStub("module flow start_device", { retrievalMode: "hybrid" })
        const result = {
          ...stub,
          trace: {
            ...stub.trace,
            requestedMode: "hybrid" as const,
            effectiveMode: "hybrid" as const,
            stateIntent: {
              enabled: true,
              reason: "intent-matched-line-backed-candidate-evidence",
              matchedKeywords: ["module flow"],
              graphCandidateCount: 2,
              bm25CandidateCount: 0,
              vectorCandidateCount: 0,
              errorPathCandidateCount: 0,
              generatedTransitionCount: 1,
              generatedFlowCount: 1,
              droppedByBudget: 0,
              droppedTransitionCount: 0,
              droppedFlowCount: 0,
              limitations: ["Order basis: same-file line order."],
            },
          },
          answerPolicy: {
            ...stub.answerPolicy,
            mode: "grounded" as const,
            confidence: "high" as const,
            allowed: true,
            reason: "Source-backed candidate state/flow/impact evidence with file paths and line numbers was returned.",
          },
          evidenceRefs: [
            {
              id: "state_ref",
              source: "graph" as const,
              path: "src/driver.c",
              filePath: "src/driver.c",
              startLine: 9,
              endLine: 12,
              kind: "state-transition",
              reason: "candidate state/transition evidence derived from graph candidate",
              confidence: "high" as const,
              symbolName: "state",
              displayName: "enum state",
            },
            {
              id: "flow_ref",
              source: "graph" as const,
              path: "src/driver.c",
              filePath: "src/driver.c",
              startLine: 20,
              endLine: 31,
              kind: "module-flow",
              reason: "candidate module-flow evidence derived from source-backed candidates",
              confidence: "high" as const,
              symbolName: "start_device",
              displayName: "query: module flow start_device",
            },
          ],
          stateTransitions: [
            {
              id: "transition_state",
              kind: "transition" as const,
              stateName: "state",
              functionName: "state",
              filePath: "src/driver.c",
              startLine: 9,
              endLine: 12,
              confidence: "high" as const,
              backingEvidenceRefs: ["state_ref"],
              limitations: ["Only listed source-backed candidate transition evidence is included."],
            },
          ],
          moduleFlows: [
            {
              id: "module_flow",
              kind: "module-flow" as const,
              title: "query: module flow start_device",
              modulePath: "src",
              involvedSymbols: ["start_device"],
              flowSteps: [
                {
                  order: 1,
                  label: "start_device",
                  filePath: "src/driver.c",
                  startLine: 20,
                  endLine: 31,
                  evidenceRefId: "flow_ref",
                },
              ],
              confidence: "high" as const,
              backingEvidenceRefs: ["flow_ref"],
              limitations: ["Order basis: same-file line order."],
            },
          ],
          formattedPackText:
            '<local-analysis-pack><state-transition-evidence title="State / transition evidence">src/driver.c:9-12 state</state-transition-evidence><module-flow-evidence title="Module flow / impact evidence">src/driver.c:20-31 start_device</module-flow-evidence><limitations>Only listed source-backed candidate evidence is included.</limitations></local-analysis-pack>',
        }
        const query = spyOn(ChipMateIndexing, "queryEvidence").mockResolvedValue(result)

        try {
          const tool = await initTool()
          const output = await rt.runPromise(tool.execute({ query: "module flow start_device" }, baseCtx))

          expect(query).toHaveBeenCalledWith("module flow start_device", {
            retrievalMode: "hybrid",
          })
          expect(output.output).toContain("State / transition evidence")
          expect(output.output).toContain("Module flow / impact evidence")
          expect(output.metadata.result.stateTransitions).toEqual(result.stateTransitions)
          expect(output.metadata.result.moduleFlows).toEqual(result.moduleFlows)
          expect(output.metadata.trace.stateIntent).toMatchObject({
            enabled: true,
            matchedKeywords: ["module flow"],
          })
          expect(output.output).not.toContain("完整状态机")
          expect(output.output).not.toContain("完整模块流程")
        } finally {
          query.mockRestore()
        }
      },
    })
  })

  test("does not surface error path output for ordinary analysis queries", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const stub = CodeIndexAnalysisService.createStub("start_device", { retrievalMode: "hybrid" })
        const result = {
          ...stub,
          trace: {
            ...stub.trace,
            errorPathIntent: {
              enabled: false,
              reason: "intent-not-matched",
              matchedKeywords: [],
              graphCandidateCount: 1,
              bm25CandidateCount: 0,
              vectorCandidateCount: 0,
              generatedCount: 0,
              droppedByBudget: 0,
              limitations: [],
            },
          },
          formattedPackText:
            '<local-analysis-pack><graph-evidence title="Graph evidence">src/driver.c:20-34 start_device</graph-evidence></local-analysis-pack>',
        }
        const query = spyOn(ChipMateIndexing, "queryEvidence").mockResolvedValue(result)

        try {
          const tool = await initTool()
          const output = await rt.runPromise(tool.execute({ query: "start_device" }, baseCtx))

          expect(output.metadata.result.errorPaths).toEqual([])
          expect(output.metadata.result.stateTransitions).toEqual([])
          expect(output.metadata.result.moduleFlows).toEqual([])
          expect(output.metadata.trace.errorPathIntent).toMatchObject({
            enabled: false,
            reason: "intent-not-matched",
          })
          expect(output.output).not.toContain("Error / cleanup path evidence")
          expect(output.output).not.toContain("State / transition evidence")
          expect(output.output).not.toContain("Module flow / impact evidence")
        } finally {
          query.mockRestore()
        }
      },
    })
  })

  test("surfaces vector fallback without failing the tool", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
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
              if (stage.name === "vector")
                return { ...stage, status: "unavailable" as const, reason: "vector-search-unavailable" }
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
        const query = spyOn(ChipMateIndexing, "queryEvidence").mockResolvedValue(result)

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
    await provideTestInstance({
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
        const query = spyOn(ChipMateIndexing, "queryEvidence").mockResolvedValue(result)

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
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const query = spyOn(ChipMateIndexing, "queryEvidence").mockResolvedValue(
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
