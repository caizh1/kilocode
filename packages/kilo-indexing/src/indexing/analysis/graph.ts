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
import type {
  CodeGraphEvidenceQueryOptions,
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
  const refs = dedupe(planned).sort((left, right) => right.rank - left.rank || left.filePath.localeCompare(right.filePath))
  const kept = refs.slice(0, input.budget.maxEvidenceItems).map((item) => limitSnippet(item, input.budget.maxSnippetCharsPerItem))
  const dropped = refs.length - kept.length
  const policy = policyFor(kept)
  const full = format({
    query: input.query,
    traceId,
    requested,
    effective,
    reason: fallback,
    policy,
    refs: kept,
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
      refs.push(ref({
        graph,
        kind: "file",
        range,
        rank: 100,
        reason: "file path matched graph record",
        confidence: "high",
        displayName: graph.filePath,
      }))
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
  const wantsCallees = !wantsCallers && (/\b(callees?|calls|called functions|what does)\b/i.test(query) || q.includes("调用了谁"))
  const wantsSites = /\bcall sites?\b/i.test(query) || q.includes("调用点")
  if (!wantsCallers && !wantsCallees && !wantsSites) return refs

  for (const fn of graph.functions) {
    for (const call of fn.calls) {
      const callee = call.calleeName
      const caller = call.callerName
      const target = wantsCallees ? caller : callee
      if (!has(words, target) && !wantsSites) continue
      if (wantsSites && !has(words, caller) && !has(words, callee)) continue
      const def = wantsCallees ? funcs.find((item) => item.fn.name === callee) : funcs.find((item) => item.fn.name === caller)
      const next = ranged(graph, call, diagnostics, "call", () =>
        ref({
          graph,
          kind: wantsCallers ? "caller" : wantsCallees ? "callee" : "call_site",
          range: call,
          rank: wantsCallers || wantsCallees ? 98 : 90,
          reason: wantsCallers
            ? "caller query matched callee at call site"
            : wantsCallees
              ? "callee query matched caller function at call site"
              : "call site query matched graph call",
          confidence: "high",
          displayName: `${caller} -> ${callee}`,
          callerName: caller,
          calleeName: callee,
          shortSnippet: call.shortSnippet,
          callSite: {
            filePath: graph.filePath,
            startLine: call.startLine,
            endLine: call.endLine,
          },
          functionDefinition: def
            ? {
                filePath: def.graph.filePath,
                startLine: def.fn.startLine,
                endLine: def.fn.endLine,
                symbolName: def.fn.name,
              }
            : undefined,
        }),
      )
      if (next) refs.push(next)
    }
  }
  return refs
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
    if (!has(words, item.name) && !q.includes(item.kind.replace("_", " "))) continue
    const next = ranged(graph, item, diagnostics, item.kind, () =>
      ref({
        graph,
        kind: item.kind,
        range: item,
        rank: 84,
        reason: "label query matched graph label",
        confidence: "high",
        labelName: item.name,
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
  includePath?: string
  labelName?: string
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
  if (input.includePath) base.includePath = input.includePath
  if (input.labelName) base.labelName = input.labelName
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
  return Number.isFinite(item.startLine) && Number.isFinite(item.endLine) && item.startLine! > 0 && item.endLine! >= item.startLine!
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
}): QueryEvidenceResult {
  const policy = policyFor([])
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
    ...evidence,
    "</graph-evidence>",
    "<limitations>Phase 3 only reads valid C/C++ graph records. BM25, vector retrieval, semantic_search merge, state-machine extraction, module summaries, and rerank are not implemented in this phase.</limitations>",
    "<suggested-next-step>If evidence is insufficient, narrow the query to a symbol name, file path, include target, macro, global, or caller/callee relation.</suggested-next-step>",
    ...(input.diagnostics.length
      ? [
          "<diagnostics>",
          ...input.diagnostics.map((item) => `- ${xml(item.name)}: ${xml(item.reason)}${item.filePath ? ` file=${xml(item.filePath)}` : ""}`),
          "</diagnostics>",
        ]
      : []),
    "</local-analysis-pack>",
  ].join("\n")
}

function trim(text: string, max: number): string {
  if (text.length <= max) return text
  const marker = "\n<truncated reason=\"maxPackChars\" />"
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
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function emptySummaries() {
  return {
    functions: [],
    files: [],
    modules: [],
    subsystems: [],
  }
}
