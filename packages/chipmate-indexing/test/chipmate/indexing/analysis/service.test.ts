import { describe, expect, test } from "bun:test"
import {
  CodeIndexAnalysisService,
  DEFAULT_EVIDENCE_BUDGET,
  resolveEvidenceBudget,
} from "../../../../src/indexing/analysis"
import { CodeIndexManager } from "../../../../src/indexing/manager"

describe("CodeIndexAnalysisService", () => {
  test("resolves the default evidence budget", () => {
    expect(resolveEvidenceBudget()).toEqual(DEFAULT_EVIDENCE_BUDGET)
  })

  test("returns conservative stub evidence with a formatted pack", async () => {
    const svc = new CodeIndexAnalysisService()
    const result = await svc.queryEvidence("who calls ufs_send_tm_request?")

    expect(result.budget).toEqual(DEFAULT_EVIDENCE_BUDGET)
    expect(result.answerPolicy).toMatchObject({
      mode: "conservative",
      confidence: "none",
      allowed: false,
      requiresCitations: true,
    })
    expect(result.answerPolicy.guidance).toContain("file path and line-number evidence")
    expect(result.formattedPackText).toContain("<local-analysis-pack")
    expect(result.formattedPackText).toContain("<query-trace>")
    expect(result.truncated).toBe(false)
    expect(result.droppedByBudget).toEqual({
      evidenceRefs: 0,
      summaries: 0,
      stateMachines: 0,
      packChars: 0,
    })
  })

  test("marks vector and rerank as skipped in graph-only mode", async () => {
    const svc = new CodeIndexAnalysisService()
    const result = await svc.queryEvidence("find cleanup paths", { retrievalMode: "graph-only" })
    const vector = result.trace.stages.find((stage) => stage.name === "vector")
    const rerank = result.trace.stages.find((stage) => stage.name === "rerank")

    expect(result.trace.retrievalMode).toBe("graph-only")
    expect(vector).toMatchObject({
      status: "skipped",
      reason: "graph-only",
    })
    expect(rerank).toMatchObject({
      status: "skipped",
      reason: "rerank-disabled",
    })
  })

  test("uses caller-provided budget values when valid", async () => {
    const svc = new CodeIndexAnalysisService()
    const result = await svc.queryEvidence("register macro writes", {
      maxEvidenceItems: 3,
      maxPackChars: 1200,
      maxSnippetCharsPerItem: 200,
    })

    expect(result.budget).toEqual({
      maxEvidenceItems: 3,
      maxPackChars: 1200,
      maxSnippetCharsPerItem: 200,
    })
    expect(result.formattedPackText).toContain('maxEvidenceItems="3"')
    expect(result.formattedPackText).toContain('maxPackChars="1200"')
    expect(result.formattedPackText).toContain('maxSnippetCharsPerItem="200"')
  })

  test("manager returns conservative evidence before indexing is initialized", async () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
    const result = await mgr.queryEvidence("explain module flow", { retrievalMode: "graph-only" })
    const graph = result.trace.stages.find((stage) => stage.name === "graph")

    expect(result.answerPolicy.mode).toBe("conservative")
    expect(result.answerPolicy.confidence).toBe("none")
    expect(graph?.reason).toBe("indexing-not-initialized")
  })
})
