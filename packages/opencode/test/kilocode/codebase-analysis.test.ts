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
