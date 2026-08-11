import type { ICodeGraphStorage, ICodePostingsStorage } from "../codegraph"
import { queryGraphEvidence } from "./graph"
import { queryHybridEvidence } from "./hybrid"
import type { VectorEvidenceAdapter } from "./vector"
import { buildErrorPaths } from "./error-path"
import { buildStateEvidence } from "./state-machine"
import {
  DEFAULT_EVIDENCE_BUDGET,
  type CodeGraphEvidenceQueryOptions,
  type CodeGraphEvidenceRetrievalMode,
  type EvidenceBudget,
  type QueryEvidenceResult,
  type QueryEvidenceTraceStage,
} from "./types"

const guidance =
  "Do not make code-level conclusions unless the answer is grounded in file path and line-number evidence returned by codebase_analysis."

export class CodeIndexAnalysisService {
  constructor(
    private readonly graph?: ICodeGraphStorage,
    private readonly postings?: ICodePostingsStorage,
    private readonly vector?: VectorEvidenceAdapter,
  ) {}

  public static createStub(
    query: string,
    options: CodeGraphEvidenceQueryOptions = {},
    reason = "phase-0-stub",
  ): QueryEvidenceResult {
    const start = Date.now()
    const mode = options.retrievalMode ?? "hybrid"
    const budget = resolveEvidenceBudget(options)
    const traceId = globalThis.crypto.randomUUID()
    const stages = createStages(mode, reason)
    const errors = buildErrorPaths({ query, refs: [], budget })
    const states = buildStateEvidence({ query, refs: [], errorPaths: [], budget })
    const elapsedMs = Date.now() - start
    const trace = {
      traceId,
      query,
      retrievalMode: mode,
      requestedMode: mode,
      effectiveMode: "graph-only" as const,
      reason,
      errorPathIntent: errors.trace,
      stateIntent: states.trace,
      stages,
      diagnostics: [],
      elapsedMs,
    }
    const answerPolicy = {
      mode: "conservative" as const,
      confidence: "none" as const,
      allowed: false,
      requiresCitations: true,
      reason: "No file path and line-number evidence was returned.",
      guidance,
    }
    const result: QueryEvidenceResult = {
      query,
      budget,
      trace,
      answerPolicy,
      evidenceRefs: [],
      errorPaths: [],
      stateTransitions: [],
      moduleFlows: [],
      summaries: {
        functions: [],
        files: [],
        modules: [],
        subsystems: [],
      },
      stateMachines: [],
      formattedPackText: formatPack({ traceId, answerPolicy, stages, budget, reason }),
      truncated: false,
      droppedByBudget: {
        evidenceRefs: 0,
        summaries: 0,
        stateMachines: 0,
        packChars: 0,
      },
    }
    return result
  }

  public async queryEvidence(
    query: string,
    options: CodeGraphEvidenceQueryOptions = {},
    ctx: { reason?: string } = {},
  ): Promise<QueryEvidenceResult> {
    const reason = ctx.reason ?? "phase-0-stub"
    if (!this.graph || reason !== "phase-0-stub") return CodeIndexAnalysisService.createStub(query, options, reason)
    if ((options.retrievalMode ?? "hybrid") === "hybrid" && this.postings) {
      return queryHybridEvidence({
        query,
        options,
        budget: resolveEvidenceBudget(options),
        graph: this.graph,
        postings: this.postings,
        vector: this.vector,
      })
    }
    return queryGraphEvidence({
      query,
      options,
      budget: resolveEvidenceBudget(options),
      storage: this.graph,
    })
  }
}

export function resolveEvidenceBudget(options: CodeGraphEvidenceQueryOptions = {}): EvidenceBudget {
  return {
    maxEvidenceItems: positive(options.maxEvidenceItems, DEFAULT_EVIDENCE_BUDGET.maxEvidenceItems),
    maxPackChars: positive(options.maxPackChars, DEFAULT_EVIDENCE_BUDGET.maxPackChars),
    maxSnippetCharsPerItem: positive(options.maxSnippetCharsPerItem, DEFAULT_EVIDENCE_BUDGET.maxSnippetCharsPerItem),
  }
}

function positive(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) return fallback
  if (value <= 0) return fallback
  return Math.trunc(value)
}

function createStages(mode: CodeGraphEvidenceRetrievalMode, reason: string): QueryEvidenceTraceStage[] {
  return [
    {
      name: "graph",
      status: "skipped",
      reason,
      elapsedMs: 0,
      count: 0,
    },
    {
      name: "bm25",
      status: "skipped",
      reason,
      elapsedMs: 0,
      count: 0,
    },
    {
      name: "vector",
      status: "skipped",
      reason: mode === "graph-only" ? "graph-only" : reason,
      elapsedMs: 0,
      count: 0,
    },
    {
      name: "rerank",
      status: "skipped",
      reason: "rerank-disabled",
      elapsedMs: 0,
      count: 0,
    },
    {
      name: "pack",
      status: "completed",
      reason: "no-evidence",
      elapsedMs: 0,
      count: 0,
    },
  ]
}

function formatPack(input: {
  traceId: string
  answerPolicy: QueryEvidenceResult["answerPolicy"]
  stages: QueryEvidenceTraceStage[]
  budget: EvidenceBudget
  reason: string
}) {
  return [
    `<local-analysis-pack traceId="${xml(input.traceId)}" confidence="${input.answerPolicy.confidence}" allowed="${input.answerPolicy.allowed ? "true" : "false"}">`,
    `<answer-policy>${xml(input.answerPolicy.reason)} ${xml(input.answerPolicy.guidance)}</answer-policy>`,
    `<resolved-budget maxEvidenceItems="${input.budget.maxEvidenceItems}" maxPackChars="${input.budget.maxPackChars}" maxSnippetCharsPerItem="${input.budget.maxSnippetCharsPerItem}" />`,
    "<query-trace>",
    ...input.stages.map((stage) => `- ${stage.name}: ${stage.status}; reason=${stage.reason}`),
    "</query-trace>",
    `<missing-evidence>${xml(input.reason)}</missing-evidence>`,
    "</local-analysis-pack>",
  ].join("\n")
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
