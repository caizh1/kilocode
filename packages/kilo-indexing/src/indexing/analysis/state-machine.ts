import type {
  ErrorPathEvidence,
  EvidenceBudget,
  EvidenceConfidence,
  EvidenceRef,
  ModuleFlowEvidence,
  QueryEvidenceAnswerPolicy,
  QueryEvidenceStateIntentTrace,
  StateTransitionEvidence,
} from "./types"

const guidance =
  "Do not make code-level conclusions unless the answer is grounded in file path and line-number evidence returned by codebase_analysis."

const MAX_STATE_TRANSITIONS = 12
const MAX_MODULE_FLOWS = 4
const MAX_FLOW_STEPS_PER_FLOW = 12
const MAX_IMPACT_REFS = 20

const phrases = [
  "state machine",
  "transition",
  "state transition",
  "state flow",
  "module flow",
  "init flow",
  "initialization flow",
  "call path",
  "impact analysis",
  "flow chart",
  "workflow",
  "lifecycle",
  "sequence",
  "state enum",
  "event handler",
  "dispatch",
  "handler table",
  "状态机",
  "状态跳转",
  "状态迁移",
  "状态流转",
  "模块流程",
  "初始化流程",
  "调用路径",
  "影响面",
  "流程图",
  "生命周期",
  "事件处理",
  "分发表",
  "状态枚举",
  "跳转条件",
]

const words = ["impact", "handler"]

export type StateBuildResult = {
  trace: QueryEvidenceStateIntentTrace
  refs: EvidenceRef[]
  transitions: StateTransitionEvidence[]
  flows: ModuleFlowEvidence[]
}

export function buildStateEvidence(input: {
  query: string
  refs: EvidenceRef[]
  errorPaths: ErrorPathEvidence[]
  budget: EvidenceBudget
}): StateBuildResult {
  const matched = keywords(input.query)
  const counts = count(input.refs, input.errorPaths)
  if (matched.length === 0) {
    return empty("intent-not-matched", [], counts)
  }

  const transitions = input.refs.flatMap((item) => transition(item)).filter((item) => item !== undefined)
  const flows = flow(input.query, input.refs, input.errorPaths)
  const maxTransitions = Math.min(MAX_STATE_TRANSITIONS, input.budget.maxEvidenceItems)
  const maxFlows = Math.min(MAX_MODULE_FLOWS, input.budget.maxEvidenceItems)
  const keptTransitions = transitions.slice(0, maxTransitions)
  const keptFlows = flows.slice(0, maxFlows)
  const refs = [...keptTransitions.map((item) => item.ref), ...keptFlows.map((item) => item.ref)]
  const out = {
    refs,
    transitions: keptTransitions.map((item) => item.transition),
    flows: keptFlows.map((item) => item.flow),
  }
  return {
    ...out,
    trace: trace({
      reason:
        out.transitions.length || out.flows.length
          ? "intent-matched-line-backed-candidate-evidence"
          : "intent-matched-no-line-backed-candidate-evidence",
      matched,
      counts,
      generatedTransitionCount: out.transitions.length,
      generatedFlowCount: out.flows.length,
      droppedTransitionCount: Math.max(0, transitions.length - out.transitions.length),
      droppedFlowCount: Math.max(0, flows.length - out.flows.length),
      limitations:
        out.transitions.length || out.flows.length
          ? limits(out.transitions, out.flows)
          : ["No source-backed candidate state/flow/impact evidence was returned for this query."],
    }),
  }
}

export function finalizeStateEvidence(input: StateBuildResult, refs: EvidenceRef[]): StateBuildResult {
  if (!input.trace.enabled) return input

  const ids = new Set(refs.map((item) => item.id))
  const transitions = input.transitions
    .map((item) => ({
      ...item,
      backingEvidenceRefs: item.backingEvidenceRefs.filter((id) => ids.has(id)),
    }))
    .filter((item) => item.backingEvidenceRefs.length > 0)
  const flows = input.flows
    .map((item) => {
      const flowSteps = item.flowSteps.filter((step) => !step.evidenceRefId || ids.has(step.evidenceRefId))
      const backingEvidenceRefs = item.backingEvidenceRefs.filter((id) => ids.has(id))
      return {
        ...item,
        flowSteps,
        backingEvidenceRefs,
      }
    })
    .filter((item) => item.backingEvidenceRefs.length > 0 && item.flowSteps.length > 0)
  const droppedTransitionCount = input.trace.droppedTransitionCount + input.transitions.length - transitions.length
  const droppedFlowCount = input.trace.droppedFlowCount + input.flows.length - flows.length
  return {
    refs: input.refs,
    transitions,
    flows,
    trace: {
      ...input.trace,
      generatedTransitionCount: transitions.length,
      generatedFlowCount: flows.length,
      droppedTransitionCount,
      droppedFlowCount,
      droppedByBudget:
        input.trace.droppedByBudget + input.transitions.length - transitions.length + input.flows.length - flows.length,
      limitations:
        transitions.length || flows.length
          ? limits(transitions, flows)
          : ["No source-backed candidate state/flow/impact evidence survived the evidence budget."],
    },
  }
}

export function policyForStateEvidence(input: {
  transitions: StateTransitionEvidence[]
  flows: ModuleFlowEvidence[]
}): QueryEvidenceAnswerPolicy {
  const items = [...input.transitions, ...input.flows]
  if (items.length === 0) {
    return {
      mode: "conservative",
      confidence: "none",
      allowed: false,
      requiresCitations: true,
      reason: "No source-backed candidate state/flow/impact evidence with file paths and line numbers was returned.",
      guidance,
    }
  }

  const conf = confidence(items)
  return {
    mode: "grounded",
    confidence: conf,
    allowed: true,
    requiresCitations: true,
    reason: "Source-backed candidate state/flow/impact evidence with file paths and line numbers was returned.",
    guidance,
  }
}

export function stateTransitionLines(items: StateTransitionEvidence[]): string[] {
  if (items.length === 0) return ["- No source-backed candidate state/transition evidence matched this query."]
  return items.map((item) => {
    const name = item.stateName ?? item.functionName ?? item.eventName ?? item.id
    const limits = item.limitations.length ? ` limitations="${xml(item.limitations.join("; "))}"` : ""
    return `- [state-transition] ${xml(item.filePath)}:${item.startLine}-${item.endLine} name="${xml(name)}" confidence="${item.confidence}"${limits}`
  })
}

export function moduleFlowLines(items: ModuleFlowEvidence[]): string[] {
  if (items.length === 0) return ["- No source-backed candidate module-flow/impact evidence matched this query."]
  return items.map((item) => {
    const steps = item.flowSteps
      .map((step) => `${step.order}:${step.filePath}:${step.startLine}-${step.endLine}:${step.label}`)
      .join(" | ")
    const limits = item.limitations.length ? ` limitations="${xml(item.limitations.join("; "))}"` : ""
    return `- [${item.kind}] title="${xml(item.title)}" confidence="${item.confidence}" steps="${xml(steps)}"${limits}`
  })
}

function transition(item: EvidenceRef): { ref: EvidenceRef; transition: StateTransitionEvidence } | undefined {
  if (!range(item)) return undefined
  if (!transitionLike(item)) return undefined

  const id = `state_${hash([item.id, item.filePath, item.startLine, item.endLine, "transition"].join(":")).slice(0, 16)}`
  const conf = confFor(item)
  const ref: EvidenceRef = {
    ...item,
    id,
    kind: "state-transition",
    confidence: conf,
    reason: `candidate state/transition evidence derived from ${item.source} candidate`,
    displayName:
      item.displayName ??
      item.symbolName ??
      item.functionName ??
      item.labelName ??
      `${item.filePath}:${item.startLine}`,
  }
  return {
    ref,
    transition: {
      id: `transition_${hash(id).slice(0, 16)}`,
      kind: "transition",
      ...(stateName(item) ? { stateName: stateName(item) } : {}),
      ...(eventName(item) ? { eventName: eventName(item) } : {}),
      ...(functionName(item) ? { functionName: functionName(item) } : {}),
      filePath: item.filePath,
      startLine: item.startLine,
      endLine: item.endLine,
      confidence: conf,
      backingEvidenceRefs: [item.id, id],
      limitations: transitionLimits(item),
    },
  }
}

function flow(
  query: string,
  refs: EvidenceRef[],
  errorPaths: ErrorPathEvidence[],
): Array<{ ref: EvidenceRef; flow: ModuleFlowEvidence }> {
  const kind = flowKind(query)
  if (!kind) return []

  const sources = refs
    .filter((item) => item.source !== "vector")
    .filter(range)
    .filter((item) => flowLike(item) || kind === "impact")
    .slice(0, MAX_IMPACT_REFS)
    .sort(order)
  if (sources.length === 0) return []

  const steps = sources.slice(0, MAX_FLOW_STEPS_PER_FLOW).map((item, index) => ({
    order: index + 1,
    label: label(item),
    filePath: item.filePath,
    startLine: item.startLine,
    endLine: item.endLine,
    evidenceRefId: item.id,
  }))
  if (steps.length === 0) return []

  const first = sources[0]!
  const basis = orderBasis(sources)
  const id = `flow_${hash([query, kind, first.id, steps.length].join(":")).slice(0, 16)}`
  const ref: EvidenceRef = {
    ...first,
    id,
    kind,
    confidence: confFor(first),
    reason: `candidate ${kind} evidence derived from source-backed candidates`,
    displayName: title(query, first, kind),
  }
  const limitations = [
    basis,
    "Only listed source-backed candidate flow/impact evidence is included.",
    ...(basis.includes("顺序未被完整证明") ? [] : ["Only listed evidence-backed steps are included."]),
    ...(errorPaths.length > 0
      ? ["Related error/cleanup evidence may indicate failure-path steps, not full lifecycle coverage."]
      : []),
  ]
  return [
    {
      ref,
      flow: {
        id: `module_${hash(id).slice(0, 16)}`,
        kind,
        title: title(query, first, kind),
        ...(modulePath(first) ? { modulePath: modulePath(first) } : {}),
        involvedSymbols: symbols(sources),
        flowSteps: steps,
        confidence: confidence(sources),
        backingEvidenceRefs: [id, ...steps.flatMap((step) => (step.evidenceRefId ? [step.evidenceRefId] : []))],
        limitations,
      },
    },
  ]
}

function flowKind(query: string): ModuleFlowEvidence["kind"] | undefined {
  const lower = query.toLowerCase()
  if (lower.includes("impact") || lower.includes("影响面")) return "impact"
  if (lower.includes("call path") || lower.includes("调用路径")) return "call-path"
  if (
    lower.includes("module flow") ||
    lower.includes("init flow") ||
    lower.includes("initialization flow") ||
    lower.includes("workflow") ||
    lower.includes("flow chart") ||
    lower.includes("sequence") ||
    lower.includes("模块流程") ||
    lower.includes("初始化流程") ||
    lower.includes("流程图")
  ) {
    return "module-flow"
  }
  return undefined
}

function transitionLike(item: EvidenceRef): boolean {
  const text = blob(item)
  if (item.source === "vector") return /\b(state|transition|event|handler|dispatch|lifecycle)\b/i.test(text)
  if (item.kind === "enum" && /\bstate\b|STATE_/i.test(text)) return true
  if (item.kind === "macro" && /\b(STATE|EVENT|EVT|HANDLER|DISPATCH)_/i.test(text)) return true
  if (/\b(state|transition|event|handler|dispatch|lifecycle)\b/i.test(text)) return true
  if (item.kind === "cleanup-path" || item.kind === "error-path") return true
  return false
}

function flowLike(item: EvidenceRef): boolean {
  if (item.kind === "caller" || item.kind === "callee" || item.kind === "call_site") return true
  if (item.kind === "function" || item.kind === "declaration" || item.kind === "file" || item.kind === "include")
    return true
  if (item.kind === "cleanup-path" || item.kind === "error-path") return true
  return /init|deinit|dispatch|handler|flow|impact/i.test(blob(item))
}

function confFor(item: EvidenceRef): Exclude<EvidenceConfidence, "none"> {
  if (item.source === "vector") return "low"
  if (item.source === "bm25") return item.confidence === "high" ? "medium" : "low"
  if (item.confidence === "low") return "low"
  if (item.confidence === "medium") return "medium"
  return "high"
}

function transitionLimits(item: EvidenceRef): string[] {
  if (item.source === "vector") {
    return [
      "Only line-backed semantic/vector evidence supports this candidate transition; graph/BM25 support is missing.",
    ]
  }
  if (item.source === "bm25") {
    return ["Lexical evidence can identify candidate state/transition text but does not prove control flow by itself."]
  }
  if (item.kind === "cleanup-path" || item.kind === "error-path") {
    return ["Failure-path evidence can indicate a candidate transition but does not prove the full state behavior."]
  }
  return ["Only listed source-backed candidate transition evidence is included."]
}

function orderBasis(refs: EvidenceRef[]): string {
  if (refs.some((item) => item.kind === "caller" || item.kind === "callee" || item.kind === "call_site")) {
    return "Order basis: caller/callee or call-site relation evidence."
  }
  if (refs.every((item) => item.filePath === refs[0]?.filePath)) {
    return "Order basis: same-file line order."
  }
  if (refs.some((item) => /init|deinit/i.test(label(item)))) {
    return "Order basis: explicit init/deinit naming evidence."
  }
  return "顺序未被完整证明; order is a candidate ordering from source-backed evidence."
}

function keywords(query: string): string[] {
  const lower = query.toLowerCase()
  const matched = phrases.filter((item) => lower.includes(item.toLowerCase()))
  for (const item of words) {
    if (new RegExp(`(?:^|[^A-Za-z0-9_])${item}(?:$|[^A-Za-z0-9_])`, "i").test(query)) matched.push(item)
  }
  return [...new Set(matched)]
}

function count(refs: EvidenceRef[], errorPaths: ErrorPathEvidence[]) {
  return {
    graphCandidateCount: refs.filter((item) => item.source === "graph").length,
    bm25CandidateCount: refs.filter((item) => item.source === "bm25").length,
    vectorCandidateCount: refs.filter((item) => item.source === "vector").length,
    errorPathCandidateCount: errorPaths.length,
  }
}

function empty(reason: string, matched: string[], counts: ReturnType<typeof count>): StateBuildResult {
  return {
    trace: trace({
      reason,
      matched,
      counts,
      generatedTransitionCount: 0,
      generatedFlowCount: 0,
      droppedTransitionCount: 0,
      droppedFlowCount: 0,
      limitations: [],
    }),
    refs: [],
    transitions: [],
    flows: [],
  }
}

function trace(input: {
  reason: string
  matched: string[]
  counts: ReturnType<typeof count>
  generatedTransitionCount: number
  generatedFlowCount: number
  droppedTransitionCount: number
  droppedFlowCount: number
  limitations: string[]
}): QueryEvidenceStateIntentTrace {
  return {
    enabled: input.matched.length > 0,
    reason: input.reason,
    matchedKeywords: input.matched,
    ...input.counts,
    generatedTransitionCount: input.generatedTransitionCount,
    generatedFlowCount: input.generatedFlowCount,
    droppedByBudget: input.droppedTransitionCount + input.droppedFlowCount,
    droppedTransitionCount: input.droppedTransitionCount,
    droppedFlowCount: input.droppedFlowCount,
    limitations: input.limitations,
  }
}

function limits(transitions: StateTransitionEvidence[], flows: ModuleFlowEvidence[]): string[] {
  return [
    ...new Set([...transitions.flatMap((item) => item.limitations), ...flows.flatMap((item) => item.limitations)]),
  ]
}

function confidence(
  items: Array<{ confidence: Exclude<EvidenceConfidence, "none"> }>,
): Exclude<EvidenceConfidence, "none"> {
  if (items.some((item) => item.confidence === "high")) return "high"
  if (items.some((item) => item.confidence === "medium")) return "medium"
  return "low"
}

function range(item: EvidenceRef): boolean {
  return (
    Number.isFinite(item.startLine) &&
    Number.isFinite(item.endLine) &&
    item.startLine > 0 &&
    item.endLine >= item.startLine
  )
}

function order(left: EvidenceRef, right: EvidenceRef): number {
  return left.filePath.localeCompare(right.filePath) || left.startLine - right.startLine || left.endLine - right.endLine
}

function label(item: EvidenceRef): string {
  return item.displayName ?? item.symbolName ?? item.functionName ?? item.labelName ?? item.includePath ?? item.kind
}

function title(query: string, item: EvidenceRef, kind: ModuleFlowEvidence["kind"]): string {
  const text = query.trim().replace(/\s+/g, " ")
  if (text) return `query: ${clip(text, 80)}`
  return `${kind}: ${label(item)}`
}

function modulePath(item: EvidenceRef): string | undefined {
  const parts = item.filePath.split("/")
  if (parts.length <= 1) return undefined
  return parts.slice(0, -1).join("/")
}

function symbols(refs: EvidenceRef[]): string[] {
  return [
    ...new Set(
      refs
        .map(
          (item) =>
            item.symbolName ??
            item.functionName ??
            item.callerName ??
            item.calleeName ??
            item.labelName ??
            item.displayName,
        )
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, MAX_FLOW_STEPS_PER_FLOW)
}

function stateName(item: EvidenceRef): string | undefined {
  const text = item.symbolName ?? item.displayName ?? item.labelName
  if (!text) return undefined
  const match = /\b[A-Z][A-Z0-9_]*STATE[A-Z0-9_]*\b|\bSTATE_[A-Z0-9_]+\b|\bstate\b/i.exec(text)
  return match?.[0]
}

function eventName(item: EvidenceRef): string | undefined {
  const text = item.symbolName ?? item.displayName ?? item.shortSnippet
  if (!text) return undefined
  const match = /\b[A-Z][A-Z0-9_]*(?:EVENT|EVT)[A-Z0-9_]*\b|\b(?:event|evt)_[A-Za-z0-9_]+\b/i.exec(text)
  return match?.[0]
}

function functionName(item: EvidenceRef): string | undefined {
  return item.functionName ?? item.symbolName ?? item.callerName
}

function blob(item: EvidenceRef): string {
  return [
    item.kind,
    item.reason,
    item.symbolName,
    item.functionName,
    item.labelName,
    item.displayName,
    item.callerName,
    item.calleeName,
    item.shortSnippet,
    item.snippet,
    item.cleanupCalls?.join(" "),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3))}...`
}

function hash(value: string): string {
  let out = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    out ^= value.charCodeAt(index)
    out = Math.imul(out, 0x01000193)
  }
  return (out >>> 0).toString(16).padStart(8, "0")
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
