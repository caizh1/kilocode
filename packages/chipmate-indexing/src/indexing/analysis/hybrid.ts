import type { ICodeGraphStorage, ICodePostingsStorage, CodePostingsSearchResult } from "../codegraph"
import { buildErrorPaths, errorPathLines, policyForErrorPaths, type ErrorPathBuildResult } from "./error-path"
import { queryGraphEvidence } from "./graph"
import {
  buildStateEvidence,
  finalizeStateEvidence,
  moduleFlowLines,
  policyForStateEvidence,
  stateTransitionLines,
  type StateBuildResult,
} from "./state-machine"
import { queryVectorEvidence, type VectorEvidenceAdapter, type VectorEvidenceResult } from "./vector"
import type {
  CodeGraphEvidenceQueryOptions,
  ErrorPathEvidence,
  EvidenceBudget,
  EvidenceRef,
  QueryEvidenceAnswerPolicy,
  QueryEvidenceDroppedByBudget,
  QueryEvidenceResult,
  QueryEvidenceTrace,
  QueryEvidenceTraceDiagnostic,
  QueryEvidenceTraceStage,
} from "./types"

const guidance =
  "Do not make code-level conclusions unless the answer is grounded in file path and line-number evidence returned by codebase_analysis."

type Planner = {
  query: string
  options: CodeGraphEvidenceQueryOptions
  budget: EvidenceBudget
  graph: ICodeGraphStorage
  postings: ICodePostingsStorage
  vector?: VectorEvidenceAdapter
}

type Candidate = EvidenceRef & {
  rank: number
}

export async function queryHybridEvidence(input: Planner): Promise<QueryEvidenceResult> {
  const start = Date.now()
  const traceId = globalThis.crypto.randomUUID()
  const diagnostics: QueryEvidenceTraceDiagnostic[] = []
  const internal = {
    ...input.options,
    retrievalMode: "graph-only" as const,
    maxEvidenceItems: Math.max(input.budget.maxEvidenceItems * 4, 50),
    maxPackChars: Math.max(input.budget.maxPackChars, 24000),
  }
  const graph = await queryGraphEvidence({
    query: input.query,
    options: internal,
    budget: {
      ...input.budget,
      maxEvidenceItems: internal.maxEvidenceItems,
      maxPackChars: internal.maxPackChars,
    },
    storage: input.graph,
  })
  diagnostics.push(...graph.trace.diagnostics)

  const status = input.postings.status()
  const bm25 = status.needsRebuild
    ? {
        refs: [] as Candidate[],
        reason: status.tokenizerMismatch
          ? "tokenizer-mismatch-needs-rebuild"
          : status.schemaMismatch || status.graphSchemaMismatch || status.parserMismatch
            ? "postings-schema-mismatch-needs-rebuild"
            : "postings-needs-rebuild",
        skipped: true,
      }
    : await (async () => {
        const results = await input.postings.search(input.query, {
          directoryPrefix: input.options.directoryPrefix,
          maxResults: Math.max(input.budget.maxEvidenceItems * 4, 50),
          diagnostics,
        })
        return {
          refs: results.map(ref),
          reason: "valid-postings-records-read",
          skipped: false,
        }
      })()
  const maxVectorCandidates = Math.min(50, input.budget.maxEvidenceItems * 3)
  const vector = await queryVectorEvidence({
    query: input.query,
    directoryPrefix: input.options.directoryPrefix,
    maxResults: maxVectorCandidates,
    adapter: input.vector,
    diagnostics,
  })

  const graphRefs = graph.evidenceRefs.map((item) => ({
    ...item,
    rank: rankGraph(item),
  }))
  const vectorRefs = vector.refs.map((item) => ({
    ...item,
    rank: rankVector(item),
  }))
  const base = [...graphRefs, ...bm25.refs, ...vectorRefs]
  const errors = buildErrorPaths({ query: input.query, refs: base, budget: input.budget })
  const states = buildStateEvidence({
    query: input.query,
    refs: [...base, ...errors.refs],
    errorPaths: errors.paths,
    budget: input.budget,
  })
  const errorRefs = errors.refs.map((item) => ({
    ...item,
    rank: rankError(item),
  }))
  const stateRefs = states.refs.map((item) => ({
    ...item,
    rank: rankState(item),
  }))
  const pool =
    states.trace.enabled && states.refs.length === 0
      ? []
      : errors.trace.enabled && errors.refs.length === 0
        ? []
        : [...(states.trace.enabled ? stateRefs : []), ...(errors.trace.enabled ? errorRefs : []), ...base]
  const fused = dedupe(pool.sort(sort))
  const kept = fused.refs
    .slice(0, input.budget.maxEvidenceItems)
    .map((item) => limitSnippet(item, input.budget.maxSnippetCharsPerItem))
  const keptIds = new Set(kept.map((item) => item.id))
  const paths = errors.paths.filter((item) => item.backingEvidenceRefs.some((id) => keptIds.has(id)))
  const state = finalizeStateEvidence(states, kept)
  const dropped = fused.refs.length - kept.length
  const errorTrace = {
    ...errors.trace,
    generatedCount: paths.length,
    droppedByBudget: errors.trace.droppedByBudget + errors.paths.length - paths.length,
  }
  const policy = state.trace.enabled
    ? policyForStateEvidence({ transitions: state.transitions, flows: state.flows })
    : errors.trace.enabled
      ? policyForErrorPaths(paths)
      : policyFor(kept)
  const full = format({
    query: input.query,
    traceId,
    policy,
    refs: kept,
    errors,
    paths,
    states: state,
    budget: input.budget,
    diagnostics,
    vector,
  })
  const pack = trim(full, input.budget.maxPackChars)
  const droppedByBudget: QueryEvidenceDroppedByBudget = {
    evidenceRefs: dropped,
    summaries: 0,
    stateMachines: 0,
    packChars: full.length - pack.length,
  }
  const trace: QueryEvidenceTrace = {
    traceId,
    query: input.query,
    retrievalMode: "hybrid",
    requestedMode: "hybrid",
    effectiveMode: "hybrid",
    effectiveSources: ["graph", "bm25", "vector"],
    reason: "hybrid-effective-sources: graph,bm25,vector",
    errorPathIntent: errorTrace,
    stateIntent: state.trace,
    stages: stages({
      graph,
      bm25Reason: bm25.reason,
      bm25Skipped: bm25.skipped,
      bm25Count: bm25.refs.length,
      postingsCount: status.validFileCount,
      vector,
      maxVectorCandidates,
      deduped:
        graphRefs.length +
        bm25.refs.length +
        vectorRefs.length +
        errorRefs.length +
        stateRefs.length -
        fused.refs.length,
      dedupedVector: fused.dropped.vector,
      kept: kept.length,
      dropped,
      packChars: droppedByBudget.packChars,
    }),
    diagnostics,
    elapsedMs: Date.now() - start,
  }

  return {
    query: input.query,
    budget: input.budget,
    trace,
    answerPolicy: policy,
    evidenceRefs: kept,
    errorPaths: paths,
    stateTransitions: state.transitions,
    moduleFlows: state.flows,
    summaries: emptySummaries(),
    stateMachines: [],
    formattedPackText: pack,
    truncated: droppedByBudget.evidenceRefs > 0 || droppedByBudget.packChars > 0,
    droppedByBudget,
  }
}

function ref(item: CodePostingsSearchResult): Candidate {
  const snippet = item.shortSnippet ? clip(item.shortSnippet, 240) : undefined
  const id = `bm25_${hash([item.filePath, item.startLine, item.endLine, item.displayName, item.terms.join(",")].join(":")).slice(0, 16)}`
  return {
    id,
    source: "bm25",
    path: item.filePath,
    filePath: item.filePath,
    startLine: item.startLine,
    endLine: item.endLine,
    kind: "lexical",
    displayName: item.displayName,
    reason: item.reason,
    confidence: item.confidence,
    score: item.score,
    rank: rankBm25(item),
    ...(snippet ? { shortSnippet: snippet, snippet, snippetHash: hash(snippet) } : {}),
  }
}

function rankGraph(item: EvidenceRef): number {
  if (item.reason.includes("exact") || item.reason.includes("file path")) return 120
  if (item.kind === "caller" || item.kind === "callee" || item.kind === "call_site") return 105
  return 100 + Math.round((item.score ?? 0) * 10)
}

function rankBm25(item: CodePostingsSearchResult): number {
  if (item.confidence === "high") return 85
  if (item.confidence === "medium") return 70
  return 65
}

function rankVector(item: EvidenceRef): number {
  if (item.confidence === "medium") return 75
  return 55
}

function rankError(item: EvidenceRef): number {
  if (item.source === "graph") return 112
  if (item.source === "bm25") return 88
  return 58
}

function rankState(item: EvidenceRef): number {
  if (item.source === "graph") return 111
  if (item.source === "bm25") return 87
  return 57
}

function sort(left: Candidate, right: Candidate): number {
  return (
    right.rank - left.rank ||
    (right.score ?? 0) - (left.score ?? 0) ||
    `${left.filePath}:${left.startLine}:${left.endLine}:${left.id}`.localeCompare(
      `${right.filePath}:${right.startLine}:${right.endLine}:${right.id}`,
    )
  )
}

function dedupe(refs: Candidate[]): { refs: Candidate[]; dropped: Record<"graph" | "bm25" | "vector", number> } {
  const out: Candidate[] = []
  const dropped = {
    graph: 0,
    bm25: 0,
    vector: 0,
  }
  for (const item of refs) {
    const same = out.some((seen) => {
      if (seen.filePath !== item.filePath) return false
      if (overlap(seen, item)) return true
      const left = seen.snippetHash ?? seen.displayName ?? seen.symbolName ?? seen.id
      const right = item.snippetHash ?? item.displayName ?? item.symbolName ?? item.id
      return left === right
    })
    if (same) {
      dropped[item.source] += 1
      continue
    }
    out.push(item)
  }
  return {
    refs: out,
    dropped,
  }
}

function overlap(left: EvidenceRef, right: EvidenceRef): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine
}

function limitSnippet(item: Candidate, max: number): Candidate {
  if (!item.shortSnippet) return item
  const snippet = clip(item.shortSnippet, max)
  return {
    ...item,
    shortSnippet: snippet,
    snippet,
    snippetHash: hash(snippet),
  }
}

function policyFor(refs: EvidenceRef[]): QueryEvidenceAnswerPolicy {
  if (refs.length === 0) {
    return {
      mode: "conservative",
      confidence: "none",
      allowed: false,
      requiresCitations: true,
      reason: "No file path and line-number evidence was returned.",
      guidance,
    }
  }
  const onlyVector = refs.every((item) => item.source === "vector")
  const onlyBm25 = refs.every((item) => item.source === "bm25")
  const hasGraph = refs.some((item) => item.source === "graph")
  return {
    mode: "grounded",
    confidence: onlyVector ? "low" : onlyBm25 || !hasGraph ? "medium" : "high",
    allowed: true,
    requiresCitations: true,
    reason: "Source-backed graph, BM25, and/or vector evidence with file paths and line numbers was returned.",
    guidance,
  }
}

function stages(input: {
  graph: QueryEvidenceResult
  bm25Reason: string
  bm25Skipped: boolean
  bm25Count: number
  postingsCount: number
  vector: VectorEvidenceResult
  maxVectorCandidates: number
  deduped: number
  dedupedVector: number
  kept: number
  dropped: number
  packChars: number
}): QueryEvidenceTraceStage[] {
  const graphStage = input.graph.trace.stages.find((stage) => stage.name === "graph")
  return [
    {
      name: "graph",
      status: "completed",
      reason: "valid-graph-records-read",
      elapsedMs: graphStage?.elapsedMs ?? 0,
      count: input.graph.evidenceRefs.length,
      details: {
        source: "graph",
        exactSource: "exact",
        validGraphFileCount: Number(graphStage?.details?.validGraphFileCount ?? 0),
      },
    },
    {
      name: "bm25",
      status: input.bm25Skipped ? "skipped" : "completed",
      reason: input.bm25Reason,
      elapsedMs: 0,
      count: input.bm25Count,
      details: {
        source: "bm25",
        validPostingsFileCount: input.postingsCount,
      },
    },
    {
      name: "vector",
      status: input.vector.status,
      reason: input.vector.reason,
      elapsedMs: input.vector.elapsedMs,
      count: input.vector.refs.length,
      details: {
        source: "vector",
        candidateCount: input.vector.candidates,
        resultCount: input.vector.refs.length,
        malformedResultCount: input.vector.malformed,
        filteredByDirectoryPrefix: input.vector.filtered,
        dedupedEvidenceRefs: input.dedupedVector,
        maxVectorCandidates: input.maxVectorCandidates,
        scoreDirection: input.vector.scoreDirection,
      },
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
      reason: input.dropped > 0 || input.packChars > 0 ? "budget-applied" : "within-budget",
      elapsedMs: 0,
      count: input.kept,
      details: {
        "hybrid-effective-sources": "graph,bm25,vector",
        sources: "exact,graph,bm25,vector",
        dedupedEvidenceRefs: input.deduped,
        droppedEvidenceRefs: input.dropped,
        droppedPackChars: input.packChars,
      },
    },
  ]
}

function format(input: {
  query: string
  traceId: string
  policy: QueryEvidenceAnswerPolicy
  refs: EvidenceRef[]
  errors: ErrorPathBuildResult
  paths: ErrorPathEvidence[]
  states: StateBuildResult
  budget: EvidenceBudget
  diagnostics: QueryEvidenceTraceDiagnostic[]
  vector: VectorEvidenceResult
}) {
  const errorIds = new Set(input.paths.flatMap((item) => item.backingEvidenceRefs))
  const stateIds = new Set([
    ...input.states.transitions.flatMap((item) => item.backingEvidenceRefs),
    ...input.states.flows.flatMap((item) => item.backingEvidenceRefs),
  ])
  const exact = input.refs.filter(
    (item) => item.source === "graph" && (item.reason.includes("exact") || item.reason.includes("file path")),
  )
  const graph = input.refs.filter(
    (item) => item.source === "graph" && !exact.includes(item) && !errorIds.has(item.id) && !stateIds.has(item.id),
  )
  const bm25 = input.refs.filter((item) => item.source === "bm25" && !stateIds.has(item.id))
  const vector = input.refs.filter((item) => item.source === "vector" && !stateIds.has(item.id))
  const vectorOnly = input.refs.length > 0 && input.refs.every((item) => item.source === "vector")
  const error = input.errors.trace.enabled
    ? [
        '<error-path-evidence title="Error / cleanup path evidence">',
        ...errorPathLines(input.paths),
        "</error-path-evidence>",
      ]
    : []
  const state = input.states.trace.enabled
    ? [
        '<state-transition-evidence title="State / transition evidence">',
        ...stateTransitionLines(input.states.transitions),
        "</state-transition-evidence>",
        '<module-flow-evidence title="Module flow / impact evidence">',
        ...moduleFlowLines(input.states.flows),
        "</module-flow-evidence>",
      ]
    : []
  return [
    `<local-analysis-pack traceId="${xml(input.traceId)}" confidence="${input.policy.confidence}" allowed="${input.policy.allowed ? "true" : "false"}">`,
    `<query>${xml(input.query)}</query>`,
    '<retrieval requestedMode="hybrid" effectiveMode="hybrid" effectiveSources="graph,bm25,vector" />',
    `<answer-policy mode="${input.policy.mode}" confidence="${input.policy.confidence}">${xml(input.policy.reason)} ${xml(input.policy.guidance)}</answer-policy>`,
    `<resolved-budget maxEvidenceItems="${input.budget.maxEvidenceItems}" maxPackChars="${input.budget.maxPackChars}" maxSnippetCharsPerItem="${input.budget.maxSnippetCharsPerItem}" />`,
    ...error,
    ...state,
    '<exact-hits title="Exact hits">',
    ...lines(exact, "No exact path or symbol evidence matched this query."),
    "</exact-hits>",
    '<graph-evidence title="Graph evidence">',
    ...lines(graph, "No source-backed graph relationship or definition evidence matched this query."),
    "</graph-evidence>",
    '<bm25-evidence title="Lexical / BM25 evidence">',
    ...lines(bm25, "No source-backed BM25 evidence matched this query."),
    "</bm25-evidence>",
    '<vector-evidence title="Semantic / vector evidence">',
    ...lines(
      vector,
      `Semantic/vector evidence ${input.vector.status === "ok" ? "did not survive fusion." : `${input.vector.status}; reason=${input.vector.reason}`}`,
    ),
    "</vector-evidence>",
    `<limitations>${xml(limitations(input.vector, vectorOnly, input.errors, input.states))}</limitations>`,
    `<suggested-next-step>${xml(suggestion(input.errors, input.states))}</suggested-next-step>`,
    input.refs.length === 0
      ? "<missing-evidence>No file path and line-number evidence was returned.</missing-evidence>"
      : "",
    input.diagnostics.length > 0 ? `<diagnostics count="${input.diagnostics.length}" />` : "",
    "</local-analysis-pack>",
  ]
    .filter(Boolean)
    .join("\n")
}

function limitations(
  vector: VectorEvidenceResult,
  vectorOnly: boolean,
  errors: ErrorPathBuildResult,
  states: StateBuildResult,
): string {
  const suffix: string[] = []
  if (errors.trace.enabled && errors.paths.length === 0) {
    suffix.push(
      "No source-backed error/cleanup path evidence was returned; do not infer cleanup order, return code, or failure behavior.",
    )
  }
  if (errors.trace.enabled && errors.paths.length > 0) suffix.push(...errors.paths.flatMap((item) => item.limitations))
  if (states.trace.enabled && states.transitions.length === 0 && states.flows.length === 0) {
    suffix.push(
      "No source-backed candidate state/flow/impact evidence was returned; do not infer states, transitions, order, or impact scope.",
    )
  }
  if (states.trace.enabled) suffix.push(...states.trace.limitations)
  const text = suffix.length > 0 ? ` ${[...new Set(suffix)].join(" ")}` : ""
  if (vectorOnly) {
    return `Only semantic/vector evidence was returned; exact graph/BM25 support is missing, so treat conclusions as weak and verify with file reads.${text}`
  }
  if (vector.status !== "ok") {
    return `Phase 5 fell back to graph + BM25 because semantic/vector evidence was ${vector.status}: ${vector.reason}. Rerank and module summaries are not enabled.${text}`
  }
  return `Phase 5 uses valid C/C++ graph records, BM25 postings, and existing ChipMate vector search. Rerank and module summaries are not enabled.${text}`
}

function suggestion(errors: ErrorPathBuildResult, states: StateBuildResult): string {
  if (states.trace.enabled) {
    return "If candidate state/flow evidence is insufficient, narrow the module path, state enum, handler name, or specific function."
  }
  if (errors.trace.enabled) {
    return "If error/cleanup evidence is insufficient, narrow the function name, path, exact error label, or return code."
  }
  return "If evidence is insufficient, narrow the query with an exact symbol, file path, macro name, or error label."
}

function lines(refs: EvidenceRef[], empty: string): string[] {
  if (refs.length === 0) return [`- ${empty}`]
  return refs.map((item) => {
    const name = item.displayName ?? item.symbolName ?? item.includePath ?? item.labelName ?? item.id
    const snippet = item.shortSnippet ? ` snippet="${xml(item.shortSnippet)}"` : ""
    const score = item.score === undefined ? "" : ` score="${item.score.toFixed(4)}"`
    return `- [${item.source}:${item.kind}] ${xml(item.filePath)}:${item.startLine}-${item.endLine} name="${xml(name)}" confidence="${item.confidence}" reason="${xml(item.reason)}"${score}${snippet}`
  })
}

function emptySummaries(): QueryEvidenceResult["summaries"] {
  return {
    functions: [],
    files: [],
    modules: [],
    subsystems: [],
  }
}

function trim(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, max)
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 3))}...`
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function hash(value: string): string {
  let out = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    out ^= value.charCodeAt(index)
    out = Math.imul(out, 0x01000193)
  }
  return (out >>> 0).toString(16).padStart(8, "0")
}
