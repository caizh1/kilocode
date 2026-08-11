import path from "node:path"
import type {
  CodeGraphCall,
  CodeGraphFileGraph,
  CodeGraphInclude,
  CodeGraphLabel,
  CodeGraphLineRange,
  CodeGraphMacro,
  CodeGraphTypeSymbol,
  ICodeGraphStorage,
} from "../codegraph"
import type { CodeGraphFunction } from "../codegraph/types"
import { buildErrorPaths, errorPathLines, policyForErrorPaths, type ErrorPathBuildResult } from "./error-path"
import {
  buildStateEvidence,
  finalizeStateEvidence,
  moduleFlowLines,
  policyForStateEvidence,
  stateTransitionLines,
  type StateBuildResult,
} from "./state-machine"
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

const MAX_FUZZY_CANDIDATES = 5
const headerExtensions = new Set([".h", ".hh", ".hpp"])

const guidance =
  "Do not make code-level conclusions unless the answer is grounded in file path and line-number evidence returned by codebase_analysis."

const common = new Set([
  "a",
  "an",
  "and",
  "call",
  "called",
  "callee",
  "callees",
  "caller",
  "callers",
  "calls",
  "cleanup",
  "code",
  "does",
  "error",
  "file",
  "find",
  "function",
  "include",
  "label",
  "lookup",
  "macro",
  "of",
  "path",
  "show",
  "site",
  "sites",
  "struct",
  "symbol",
  "the",
  "to",
  "typedef",
  "what",
  "where",
  "who",
])

type Candidate = EvidenceRef & {
  rank: number
}

type FunctionEntry = {
  graph: CodeGraphFileGraph
  fn: CodeGraphFunction
}

type Planner = {
  query: string
  options: CodeGraphEvidenceQueryOptions
  budget: EvidenceBudget
  storage: ICodeGraphStorage
}

export async function queryGraphEvidence(input: Planner): Promise<QueryEvidenceResult> {
  const start = Date.now()
  const requested = input.options.retrievalMode ?? "hybrid"
  const effective = "graph-only" as const
  const fallback = requested === "hybrid" ? "bm25-and-vector-not-implemented-in-phase-3" : "graph-only"
  const traceId = globalThis.crypto.randomUUID()
  const diagnostics: QueryEvidenceTraceDiagnostic[] = []
  const status = input.storage.status()

  if (status.needsRebuild || status.schemaMismatch || status.parserMismatch) {
    const reason = status.parserMismatch ? "parser-mismatch-needs-rebuild" : "schema-mismatch-needs-rebuild"
    return none({
      query: input.query,
      budget: input.budget,
      traceId,
      requested,
      effective,
      reason,
      diagnostics,
      start,
      graphCount: 0,
      fallback,
    })
  }

  const files = await input.storage.listFiles()
  const prefix = normalizePrefix(input.options.directoryPrefix)
  const scoped = prefix ? files.filter((file) => inPrefix(file, prefix)) : files
  const graphs: CodeGraphFileGraph[] = []

  for (const file of scoped) {
    const graph = await input.storage.getFileGraph(file)
    if (!graph) continue
    graphs.push(graph)
  }

  const planned = plan(input.query, graphs, diagnostics)
  const refs = dedupe(planned).sort(
    (left, right) => right.rank - left.rank || left.filePath.localeCompare(right.filePath),
  )
  const errors = buildErrorPaths({ query: input.query, refs, budget: input.budget })
  const states = buildStateEvidence({
    query: input.query,
    refs: [...refs, ...errors.refs],
    errorPaths: errors.paths,
    budget: input.budget,
  })
  const ranked = states.trace.enabled
    ? dedupe([
        ...states.refs.map((item) => ({
          ...item,
          rank: rankState(item),
        })),
        ...(errors.trace.enabled
          ? errors.refs.map((item) => ({
              ...item,
              rank: rankError(item),
            }))
          : []),
        ...refs,
      ]).sort((left, right) => right.rank - left.rank || left.filePath.localeCompare(right.filePath))
    : errors.trace.enabled
      ? dedupe([
          ...errors.refs.map((item) => ({
            ...item,
            rank: rankError(item),
          })),
          ...refs,
        ]).sort((left, right) => right.rank - left.rank || left.filePath.localeCompare(right.filePath))
      : refs
  const active =
    states.trace.enabled && states.refs.length === 0
      ? []
      : errors.trace.enabled && errors.refs.length === 0
        ? []
        : ranked
  const kept = active
    .slice(0, input.budget.maxEvidenceItems)
    .map((item) => limitSnippet(item, input.budget.maxSnippetCharsPerItem))
  const keptIds = new Set(kept.map((item) => item.id))
  const paths = errors.paths.filter((item) => item.backingEvidenceRefs.some((id) => keptIds.has(id)))
  const state = finalizeStateEvidence(states, kept)
  const dropped = active.length - kept.length
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
    requested,
    effective,
    reason: fallback,
    policy,
    refs: kept,
    errors,
    paths,
    states: state,
    budget: input.budget,
    diagnostics,
  })
  const pack = trim(full, input.budget.maxPackChars)
  const traceStages = createStages({
    graph: scoped.length,
    evidence: kept.length,
    reason: fallback,
    fuzzy: planned.fuzzy,
    dropped,
    packChars: full.length - pack.length,
  })
  const trace: QueryEvidenceTrace = {
    traceId,
    query: input.query,
    retrievalMode: requested,
    requestedMode: requested,
    effectiveMode: effective,
    reason: fallback,
    errorPathIntent: errorTrace,
    stateIntent: state.trace,
    stages: traceStages,
    diagnostics,
    elapsedMs: Date.now() - start,
  }

  if (kept.length === 0) {
    return none({
      query: input.query,
      budget: input.budget,
      traceId,
      requested,
      effective,
      reason: "no-source-backed-graph-evidence",
      diagnostics,
      start,
      graphCount: scoped.length,
      fallback,
      errors: {
        ...errors,
        trace: errorTrace,
      },
      states: state,
    })
  }

  const droppedByBudget: QueryEvidenceDroppedByBudget = {
    evidenceRefs: dropped,
    summaries: 0,
    stateMachines: 0,
    packChars: full.length - pack.length,
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

function plan(query: string, graphs: CodeGraphFileGraph[], diagnostics: QueryEvidenceTraceDiagnostic[]) {
  const q = query.toLowerCase()
  const words = tokens(query)
  const refs: Candidate[] = []
  const funcs = graphs.flatMap((graph) => graph.functions.map((fn) => ({ graph, fn })))
  const exact = funcs.filter((item) => has(words, item.fn.name))
  const fuzzy = {
    exactMiss: exact.length === 0,
    fuzzyUsed: false,
    candidateCount: 0,
    maxFuzzyCandidates: MAX_FUZZY_CANDIDATES,
  }

  for (const graph of graphs) {
    if (q.includes(graph.filePath.toLowerCase()) || q.includes(path.basename(graph.filePath).toLowerCase())) {
      const range = firstRange(graph)
      refs.push(
        ref({
          graph,
          kind: "file",
          range,
          rank: 100,
          reason: "file path matched graph record",
          confidence: "high",
          displayName: graph.filePath,
        }),
      )
    }

    for (const item of graph.functions) {
      if (!has(words, item.name)) continue
      const next = ranged(graph, item, diagnostics, "function", () =>
        ref({
          graph,
          kind: "function",
          range: item,
          rank: 95,
          reason: "exact function symbol match",
          confidence: "high",
          symbolName: item.name,
          displayName: item.signature,
          shortSnippet: item.shortSnippet,
        }),
      )
      if (next) refs.push(next)
    }

    for (const item of graph.declarations) {
      if (!has(words, item.name)) continue
      const next = ranged(graph, item, diagnostics, "declaration", () =>
        ref({
          graph,
          kind: "declaration",
          range: item,
          rank: 88,
          reason: "exact function declaration match",
          confidence: "high",
          symbolName: item.name,
          displayName: item.signature,
          shortSnippet: item.shortSnippet,
        }),
      )
      if (next) refs.push(next)
    }

    for (const item of graph.macros) {
      if (!has(words, item.name)) continue
      const next = ranged(graph, item, diagnostics, "macro", () =>
        ref({
          graph,
          kind: "macro",
          range: item,
          rank: 85,
          reason: "macro name match",
          confidence: "high",
          symbolName: item.name,
          displayName: item.name,
          shortSnippet: item.shortSnippet,
        }),
      )
      if (next) refs.push(next)
    }

    for (const item of graph.types) {
      if (!has(words, item.name)) continue
      const next = ranged(graph, item, diagnostics, item.kind, () =>
        ref({
          graph,
          kind: item.kind,
          range: item,
          rank: 82,
          reason: `${item.kind} name match`,
          confidence: "high",
          symbolName: item.name,
          displayName: `${item.kind} ${item.name}`,
          shortSnippet: item.shortSnippet,
        }),
      )
      if (next) refs.push(next)
    }

    for (const item of graph.globals) {
      if (!has(words, item.name)) continue
      const next = ranged(graph, item, diagnostics, "global", () =>
        ref({
          graph,
          kind: "global",
          range: item,
          rank: 78,
          reason: "global variable name match",
          confidence: "high",
          symbolName: item.name,
          displayName: item.name,
          shortSnippet: item.shortSnippet,
        }),
      )
      if (next) refs.push(next)
    }

    refs.push(...callRefs(query, words, graph, funcs, diagnostics))
    refs.push(...includeRefs(q, words, graph, diagnostics))
    refs.push(...labelRefs(q, words, graph, diagnostics))
  }

  if (exact.length === 0) {
    const matches = funcs
      .map((item) => ({ item, score: fuzzyScore(words, item.fn.name) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
    fuzzy.candidateCount = matches.length
    fuzzy.fuzzyUsed = matches.length > 0
    for (const match of matches.slice(0, MAX_FUZZY_CANDIDATES)) {
      const next = ranged(match.item.graph, match.item.fn, diagnostics, "function", () =>
        ref({
          graph: match.item.graph,
          kind: "function",
          range: match.item.fn,
          rank: 52 + match.score,
          reason: "fuzzy function symbol fallback",
          confidence: "medium",
          symbolName: match.item.fn.name,
          displayName: match.item.fn.signature,
          shortSnippet: match.item.fn.shortSnippet,
        }),
      )
      if (next) refs.push(next)
    }
  }

  return Object.assign(refs, { fuzzy })
}

function callRefs(
  query: string,
  words: Set<string>,
  graph: CodeGraphFileGraph,
  funcs: FunctionEntry[],
  diagnostics: QueryEvidenceTraceDiagnostic[],
): Candidate[] {
  const q = query.toLowerCase()
  const refs: Candidate[] = []
  const wantsCallers = /\b(callers?|who calls|caller)\b/i.test(query) || q.includes("谁调用") || q.includes("调用方")
  const wantsCallees =
    !wantsCallers && (/\b(callees?|calls|called functions|what does)\b/i.test(query) || q.includes("调用了谁"))
  const wantsSites = /\bcall sites?\b/i.test(query) || q.includes("调用点")
  if (!wantsCallers && !wantsCallees && !wantsSites) return refs

  for (const fn of graph.functions) {
    for (const call of fn.calls) {
      const callee = call.calleeName
      const caller = call.callerName
      const target = wantsCallees ? caller : callee
      if (!has(words, target) && !wantsSites) continue
      if (wantsSites && !has(words, caller) && !has(words, callee)) continue
      const resolution = wantsCallees
        ? resolveCallee(graph, callee, funcs)
        : { definition: { graph, fn }, ambiguous: false }
      const reason = wantsCallers
        ? "caller query matched callee at call site"
        : wantsCallees
          ? "callee query matched caller function at call site"
          : "call site query matched graph call"
      const next = ranged(graph, call, diagnostics, "call", () =>
        ref({
          graph,
          kind: wantsCallers ? "caller" : wantsCallees ? "callee" : "call_site",
          range: call,
          rank: wantsCallers || wantsCallees ? 98 : 90,
          reason: resolution.ambiguous ? `${reason}; callee definition is ambiguous` : reason,
          confidence: resolution.ambiguous ? "medium" : "high",
          displayName: `${caller} -> ${callee}`,
          callerName: caller,
          calleeName: callee,
          shortSnippet: call.shortSnippet,
          callSite: {
            filePath: graph.filePath,
            startLine: call.startLine,
            endLine: call.endLine,
          },
          functionDefinition: resolution.definition
            ? {
                filePath: resolution.definition.graph.filePath,
                startLine: resolution.definition.fn.startLine,
                endLine: resolution.definition.fn.endLine,
                symbolName: resolution.definition.fn.name,
              }
            : undefined,
        }),
      )
      if (next) refs.push(next)
    }
  }
  return refs
}

function resolveCallee(
  graph: CodeGraphFileGraph,
  name: string,
  funcs: FunctionEntry[],
): { definition?: FunctionEntry; ambiguous: boolean } {
  const local = funcs.filter((item) => item.graph.filePath === graph.filePath && item.fn.name === name)
  if (local.length === 1) return { definition: local[0], ambiguous: false }
  if (local.length > 1) return { ambiguous: true }

  const included = funcs.filter(
    (item) => item.fn.name === name && item.fn.isStatic && includedHeader(graph, item.graph.filePath),
  )
  if (included.length === 1) return { definition: included[0], ambiguous: false }
  if (included.length > 1) return { ambiguous: true }

  const external = funcs.filter((item) => item.fn.name === name && !item.fn.isStatic)
  if (external.length === 1) return { definition: external[0], ambiguous: false }
  return { ambiguous: external.length > 1 }
}

function includedHeader(graph: CodeGraphFileGraph, file: string): boolean {
  if (!headerExtensions.has(path.extname(file).toLowerCase())) return false
  const windows = process.platform === "win32" || graph.filePath.includes("\\") || file.includes("\\")
  const candidate = path.posix.normalize(file.replaceAll("\\", "/"))
  const parent = path.posix.dirname(path.posix.normalize(graph.filePath.replaceAll("\\", "/")))
  return graph.includes.some((item) => {
    if (item.system) return false
    const target = path.posix.normalize(item.target.replaceAll("\\", "/"))
    const relative = path.posix.normalize(path.posix.join(parent, target))
    return windows ? candidate.toLowerCase() === relative.toLowerCase() : candidate === relative
  })
}

function includeRefs(
  q: string,
  words: Set<string>,
  graph: CodeGraphFileGraph,
  diagnostics: QueryEvidenceTraceDiagnostic[],
): Candidate[] {
  if (!q.includes("include") && !q.includes("包含") && !q.includes("依赖")) return []
  const refs: Candidate[] = []
  for (const item of graph.includes) {
    const target = item.target.toLowerCase()
    const matched = [...words].some((word) => target.includes(word.toLowerCase())) || q.includes(target)
    if (!matched && words.size > 0) continue
    const next = ranged(graph, item, diagnostics, "include", () =>
      ref({
        graph,
        kind: "include",
        range: item,
        rank: 74,
        reason: "include neighbor match",
        confidence: "high",
        includePath: item.target,
        displayName: `include ${item.target}`,
        shortSnippet: item.shortSnippet,
      }),
    )
    if (next) refs.push(next)
  }
  return refs
}

function labelRefs(
  q: string,
  words: Set<string>,
  graph: CodeGraphFileGraph,
  diagnostics: QueryEvidenceTraceDiagnostic[],
): Candidate[] {
  const wants = q.includes("label") || q.includes("cleanup") || q.includes("error") || q.includes("错误")
  if (!wants) return []
  const refs: Candidate[] = []
  for (const item of graph.labels) {
    if (!has(words, item.name) && !has(words, item.functionName) && !q.includes(item.kind.replace("_", " "))) continue
    const next = ranged(graph, item, diagnostics, item.kind, () =>
      ref({
        graph,
        kind: item.kind,
        range: item,
        rank: 84,
        reason: "label query matched graph label",
        confidence: "high",
        functionName: item.functionName,
        labelName: item.name,
        cleanupCalls: item.cleanupCalls,
        returnStyle: item.returnStyle,
        displayName: `${item.functionName}:${item.name}`,
        shortSnippet: item.shortSnippet,
      }),
    )
    if (next) refs.push(next)
  }
  return refs
}

function ref(input: {
  graph: CodeGraphFileGraph
  kind: string
  range: CodeGraphLineRange
  rank: number
  reason: string
  confidence: "high" | "medium" | "low"
  symbolName?: string
  functionName?: string
  includePath?: string
  labelName?: string
  cleanupCalls?: string[]
  returnStyle?: string
  displayName?: string
  callerName?: string
  calleeName?: string
  shortSnippet?: string
  callSite?: EvidenceRef["callSite"]
  functionDefinition?: EvidenceRef["functionDefinition"]
}): Candidate {
  const snippet = input.shortSnippet ? clip(input.shortSnippet, 240) : undefined
  const id = `graph_${hash([input.kind, input.graph.filePath, input.range.startLine, input.range.endLine, input.displayName ?? input.symbolName ?? ""].join(":")).slice(0, 16)}`
  const base: Candidate = {
    id,
    source: "graph",
    kind: input.kind,
    path: input.graph.filePath,
    filePath: input.graph.filePath,
    startLine: input.range.startLine,
    endLine: input.range.endLine,
    reason: input.reason,
    confidence: input.confidence,
    score: input.rank / 100,
    rank: input.rank,
  }
  if (input.symbolName) base.symbolName = input.symbolName
  if (input.functionName) base.functionName = input.functionName
  if (input.includePath) base.includePath = input.includePath
  if (input.labelName) base.labelName = input.labelName
  if (input.cleanupCalls) base.cleanupCalls = input.cleanupCalls
  if (input.returnStyle) base.returnStyle = input.returnStyle
  if (input.displayName) base.displayName = input.displayName
  if (input.callerName) base.callerName = input.callerName
  if (input.calleeName) base.calleeName = input.calleeName
  if (input.callSite) base.callSite = input.callSite
  if (input.functionDefinition) base.functionDefinition = input.functionDefinition
  if (snippet) {
    base.shortSnippet = snippet
    base.snippet = snippet
    base.snippetHash = hash(snippet)
  }
  return base
}

function ranged<T extends Partial<CodeGraphLineRange>>(
  graph: CodeGraphFileGraph,
  item: T,
  diagnostics: QueryEvidenceTraceDiagnostic[],
  kind: string,
  fn: () => Candidate,
): Candidate | undefined {
  if (rangeOk(item)) return fn()
  diagnostics.push({
    name: "missing-line-range",
    reason: "graph item omitted from evidence because it has no complete line range",
    filePath: graph.filePath,
    kind,
    count: 1,
  })
  return undefined
}

function rangeOk(item: Partial<CodeGraphLineRange>): item is CodeGraphLineRange {
  return (
    Number.isFinite(item.startLine) &&
    Number.isFinite(item.endLine) &&
    item.startLine! > 0 &&
    item.endLine! >= item.startLine!
  )
}

function firstRange(graph: CodeGraphFileGraph): CodeGraphLineRange {
  const items: Array<Partial<CodeGraphLineRange>> = [
    ...graph.includes,
    ...graph.macros,
    ...graph.functions,
    ...graph.declarations,
    ...graph.types,
    ...graph.globals,
    ...graph.labels,
  ]
  return items.find(rangeOk) ?? { startLine: 1, endLine: 1 }
}

function dedupe(refs: Candidate[]): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const item of refs) {
    const key = `${item.kind}:${item.filePath}:${item.startLine}:${item.endLine}:${item.displayName ?? item.symbolName ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
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
  const fuzzy = refs.some((item) => item.confidence === "medium" || item.reason.includes("fuzzy"))
  return {
    mode: "grounded",
    confidence: fuzzy ? "medium" : "high",
    allowed: true,
    requiresCitations: true,
    reason: "Source-backed graph evidence with file paths and line numbers was returned.",
    guidance,
  }
}

function rankError(item: EvidenceRef): number {
  if (item.source === "graph") return 112
  if (item.source === "bm25") return 86
  return 58
}

function rankState(item: EvidenceRef): number {
  if (item.source === "graph") return 111
  if (item.source === "bm25") return 87
  return 57
}

function none(input: {
  query: string
  budget: EvidenceBudget
  traceId: string
  requested: "hybrid" | "graph-only"
  effective: "graph-only"
  reason: string
  diagnostics: QueryEvidenceTraceDiagnostic[]
  start: number
  graphCount: number
  fallback: string
  errors?: ErrorPathBuildResult
  states?: StateBuildResult
}): QueryEvidenceResult {
  const errors =
    input.errors ??
    buildErrorPaths({
      query: input.query,
      refs: [],
      budget: input.budget,
    })
  const states =
    input.states ??
    buildStateEvidence({
      query: input.query,
      refs: [],
      errorPaths: [],
      budget: input.budget,
    })
  const policy = states.trace.enabled
    ? policyForStateEvidence({ transitions: states.transitions, flows: states.flows })
    : errors.trace.enabled
      ? policyForErrorPaths([])
      : policyFor([])
  const traceStages = createStages({
    graph: input.graphCount,
    evidence: 0,
    reason: input.fallback,
    fuzzy: {
      exactMiss: true,
      fuzzyUsed: false,
      candidateCount: 0,
      maxFuzzyCandidates: MAX_FUZZY_CANDIDATES,
    },
    dropped: 0,
    packChars: 0,
  })
  const trace: QueryEvidenceTrace = {
    traceId: input.traceId,
    query: input.query,
    retrievalMode: input.requested,
    requestedMode: input.requested,
    effectiveMode: input.effective,
    reason: input.reason,
    errorPathIntent: errors.trace,
    stateIntent: states.trace,
    stages: traceStages,
    diagnostics: input.diagnostics,
    elapsedMs: Date.now() - input.start,
  }
  const full = format({
    query: input.query,
    traceId: input.traceId,
    requested: input.requested,
    effective: input.effective,
    reason: input.reason,
    policy,
    refs: [],
    errors,
    paths: [],
    states,
    budget: input.budget,
    diagnostics: input.diagnostics,
  })
  const pack = trim(full, input.budget.maxPackChars)
  const droppedByBudget = {
    evidenceRefs: 0,
    summaries: 0,
    stateMachines: 0,
    packChars: full.length - pack.length,
  }
  return {
    query: input.query,
    budget: input.budget,
    trace,
    answerPolicy: policy,
    evidenceRefs: [],
    errorPaths: [],
    stateTransitions: [],
    moduleFlows: [],
    summaries: emptySummaries(),
    stateMachines: [],
    formattedPackText: pack,
    truncated: droppedByBudget.packChars > 0,
    droppedByBudget,
  }
}

function createStages(input: {
  graph: number
  evidence: number
  reason: string
  fuzzy: {
    exactMiss: boolean
    fuzzyUsed: boolean
    candidateCount: number
    maxFuzzyCandidates: number
  }
  dropped: number
  packChars: number
}): QueryEvidenceTraceStage[] {
  return [
    {
      name: "graph",
      status: "completed",
      reason: "valid-graph-records-read",
      elapsedMs: 0,
      count: input.evidence,
      details: {
        validGraphFileCount: input.graph,
        exactMiss: input.fuzzy.exactMiss,
        fuzzyUsed: input.fuzzy.fuzzyUsed,
        candidateCount: input.fuzzy.candidateCount,
        maxFuzzyCandidates: input.fuzzy.maxFuzzyCandidates,
      },
    },
    {
      name: "bm25",
      status: "skipped",
      reason: input.reason,
      elapsedMs: 0,
      count: 0,
    },
    {
      name: "vector",
      status: "skipped",
      reason: input.reason,
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
      reason: input.dropped > 0 || input.packChars > 0 ? "budget-applied" : "within-budget",
      elapsedMs: 0,
      count: input.evidence,
      details: {
        droppedEvidenceRefs: input.dropped,
        droppedPackChars: input.packChars,
      },
    },
  ]
}

function format(input: {
  query: string
  traceId: string
  requested: "hybrid" | "graph-only"
  effective: "graph-only"
  reason: string
  policy: QueryEvidenceAnswerPolicy
  refs: EvidenceRef[]
  errors: ErrorPathBuildResult
  paths: ErrorPathEvidence[]
  states: StateBuildResult
  budget: EvidenceBudget
  diagnostics: QueryEvidenceTraceDiagnostic[]
}) {
  const head = [
    `<local-analysis-pack traceId="${xml(input.traceId)}" confidence="${input.policy.confidence}" allowed="${input.policy.allowed ? "true" : "false"}">`,
    `<query>${xml(input.query)}</query>`,
    `<retrieval requestedMode="${input.requested}" effectiveMode="${input.effective}" reason="${xml(input.reason)}" />`,
    `<answer-policy mode="${input.policy.mode}" confidence="${input.policy.confidence}">${xml(input.policy.reason)} ${xml(input.policy.guidance)}</answer-policy>`,
    `<resolved-budget maxEvidenceItems="${input.budget.maxEvidenceItems}" maxPackChars="${input.budget.maxPackChars}" maxSnippetCharsPerItem="${input.budget.maxSnippetCharsPerItem}" />`,
    '<graph-evidence title="Graph evidence">',
  ]
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
  const evidence =
    input.refs.length === 0
      ? [
          "- No source-backed graph evidence matched this query.",
          "- No file path and line-number evidence was returned.",
        ]
      : input.refs.map((item) => {
          const name = item.displayName ?? item.symbolName ?? item.includePath ?? item.labelName ?? item.id
          const snippet = item.shortSnippet ? ` snippet="${xml(item.shortSnippet)}"` : ""
          const call = item.callSite
            ? ` callSite="${xml(item.callSite.filePath)}:${item.callSite.startLine}-${item.callSite.endLine}"`
            : ""
          const def = item.functionDefinition
            ? ` functionDefinition="${xml(item.functionDefinition.filePath)}:${item.functionDefinition.startLine}-${item.functionDefinition.endLine}:${xml(item.functionDefinition.symbolName)}"`
            : ""
          return `- [${item.source}:${item.kind}] ${xml(item.filePath)}:${item.startLine}-${item.endLine} name="${xml(name)}" confidence="${item.confidence}" reason="${xml(item.reason)}"${call}${def}${snippet}`
        })
  return [
    ...head,
    ...error,
    ...state,
    ...evidence,
    "</graph-evidence>",
    `<limitations>${xml(limitations(input.errors, input.states))}</limitations>`,
    `<suggested-next-step>${xml(suggestion(input.errors, input.states))}</suggested-next-step>`,
    ...(input.diagnostics.length
      ? [
          "<diagnostics>",
          ...input.diagnostics.map(
            (item) => `- ${xml(item.name)}: ${xml(item.reason)}${item.filePath ? ` file=${xml(item.filePath)}` : ""}`,
          ),
          "</diagnostics>",
        ]
      : []),
    "</local-analysis-pack>",
  ].join("\n")
}

function limitations(errors: ErrorPathBuildResult, states: StateBuildResult): string {
  const base =
    "Graph-only mode reads valid C/C++ graph records only. BM25, vector retrieval, semantic_search merge, module summaries, and rerank are not used."
  const suffix: string[] = []
  if (errors.trace.enabled && errors.paths.length === 0) {
    suffix.push(
      "No source-backed error/cleanup path evidence was returned; do not infer cleanup order, return code, or failure behavior.",
    )
  }
  if (errors.trace.enabled && errors.paths.length > 0) {
    suffix.push(...errors.paths.flatMap((item) => item.limitations))
  }
  if (states.trace.enabled && states.transitions.length === 0 && states.flows.length === 0) {
    suffix.push(
      "No source-backed candidate state/flow/impact evidence was returned; do not infer states, transitions, order, or impact scope.",
    )
  }
  if (states.trace.enabled) suffix.push(...states.trace.limitations)
  if (suffix.length === 0) return base
  return `${base} ${[...new Set(suffix)].join(" ")}`
}

function suggestion(errors: ErrorPathBuildResult, states: StateBuildResult): string {
  if (states.trace.enabled) {
    return "If candidate state/flow evidence is insufficient, narrow the module path, state enum, handler name, or specific function."
  }
  if (errors.trace.enabled) {
    return "If error/cleanup evidence is insufficient, narrow the function name, path, exact error label, or return code."
  }
  return "If evidence is insufficient, narrow the query to a symbol name, file path, include target, macro, global, or caller/callee relation."
}

function trim(text: string, max: number): string {
  if (text.length <= max) return text
  const marker = '\n<truncated reason="maxPackChars" />'
  if (max <= marker.length) return marker.slice(0, max)
  return `${text.slice(0, max - marker.length)}${marker}`
}

function tokens(query: string): Set<string> {
  const result = new Set<string>()
  for (const match of query.matchAll(/[A-Za-z_][A-Za-z0-9_./-]*/g)) {
    const raw = match[0].replace(/[().,;:]+$/g, "")
    const item = raw.toLowerCase()
    if (item.length < 2 || common.has(item)) continue
    result.add(item)
    if (item.includes("/")) result.add(path.basename(item))
  }
  return result
}

function has(words: Set<string>, name: string): boolean {
  const lower = name.toLowerCase()
  if (words.has(lower)) return true
  return [...words].some((word) => word === lower || word.endsWith(`/${lower}`))
}

function fuzzyScore(words: Set<string>, name: string): number {
  const lower = name.toLowerCase()
  const scores = [...words].map((word) => {
    if (word.length < 3) return 0
    if (lower.includes(word) || word.includes(lower)) return 30
    if (subseq(word, lower) || subseq(lower, word)) return 18
    return distance(word, lower) <= 2 ? 12 : 0
  })
  return Math.max(0, ...scores)
}

function subseq(needle: string, value: string): boolean {
  const chars = [...needle]
  let index = 0
  for (const char of value) {
    if (chars[index] !== char) continue
    index += 1
    if (index === chars.length) return true
  }
  return false
}

function distance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, (_, row) =>
    Array.from({ length: right.length + 1 }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)),
  )
  for (let row = 1; row <= left.length; row++) {
    for (let col = 1; col <= right.length; col++) {
      rows[row]![col] =
        left[row - 1] === right[col - 1]
          ? rows[row - 1]![col - 1]!
          : Math.min(rows[row - 1]![col - 1]!, rows[row - 1]![col]!, rows[row]![col - 1]!) + 1
    }
  }
  return rows[left.length]![right.length]!
}

function normalizePrefix(input?: string): string | undefined {
  if (!input) return undefined
  const value = input.split(path.sep).join("/").replace(/^\/+/, "").replace(/\/+$/, "")
  return value || undefined
}

function inPrefix(file: string, prefix: string): boolean {
  return file === prefix || file.startsWith(`${prefix}/`)
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  if (max <= 3) return value.slice(0, max)
  return `${value.slice(0, max - 3)}...`
}

function hash(value: string): string {
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

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function emptySummaries() {
  return {
    functions: [],
    files: [],
    modules: [],
    subsystems: [],
  }
}
