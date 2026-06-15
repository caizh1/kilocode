export type CodeGraphEvidenceRetrievalMode = "hybrid" | "graph-only"

export type CodeGraphEvidenceEffectiveMode = "graph-only" | "hybrid"

export type EvidenceSource = "graph" | "bm25" | "vector"

export type EvidenceConfidence = "high" | "medium" | "low" | "none"

export type ErrorPathBranchKind = "goto-label" | "return-error" | "cleanup-call" | "error-label" | "unknown"

export type StateMachineEvidenceKind = "state-machine" | "transition" | "module-flow" | "impact" | "call-path"

export type EvidenceBudget = {
  maxEvidenceItems: number
  maxPackChars: number
  maxSnippetCharsPerItem: number
}

export const DEFAULT_EVIDENCE_BUDGET: EvidenceBudget = {
  maxEvidenceItems: 20,
  maxPackChars: 24000,
  maxSnippetCharsPerItem: 1200,
}

export type CodeGraphEvidenceQueryOptions = {
  directoryPrefix?: string
  retrievalMode?: CodeGraphEvidenceRetrievalMode
  maxEvidenceItems?: number
  maxPackChars?: number
  maxSnippetCharsPerItem?: number
}

export type EvidenceRef = {
  id: string
  source: EvidenceSource
  path: string
  filePath: string
  startLine: number
  endLine: number
  kind: string
  reason: string
  confidence: Exclude<EvidenceConfidence, "none">
  score?: number
  symbolName?: string
  functionName?: string
  includePath?: string
  labelName?: string
  cleanupCalls?: string[]
  returnStyle?: string
  displayName?: string
  callerName?: string
  calleeName?: string
  callSite?: {
    filePath: string
    startLine: number
    endLine: number
  }
  functionDefinition?: {
    filePath: string
    startLine: number
    endLine: number
    symbolName: string
  }
  shortSnippet?: string
  snippet?: string
  snippetHash?: string
}

export type QueryEvidenceStageStatus = "completed" | "skipped" | "failed" | "ok" | "unavailable" | "empty" | "malformed"

export type QueryEvidenceTraceStage = {
  name: "graph" | "bm25" | "vector" | "rerank" | "pack"
  status: QueryEvidenceStageStatus
  reason: string
  elapsedMs: number
  count?: number
  details?: Record<string, string | number | boolean>
}

export type QueryEvidenceTraceDiagnostic = {
  name: string
  reason: string
  count?: number
  filePath?: string
  kind?: string
}

export type QueryEvidenceTrace = {
  traceId: string
  query: string
  retrievalMode: CodeGraphEvidenceRetrievalMode
  requestedMode: CodeGraphEvidenceRetrievalMode
  effectiveMode: CodeGraphEvidenceEffectiveMode
  effectiveSources?: EvidenceSource[]
  reason?: string
  errorPathIntent?: QueryEvidenceErrorPathIntentTrace
  stateIntent?: QueryEvidenceStateIntentTrace
  stages: QueryEvidenceTraceStage[]
  diagnostics: QueryEvidenceTraceDiagnostic[]
  elapsedMs: number
}

export type QueryEvidenceErrorPathIntentTrace = {
  enabled: boolean
  reason: string
  matchedKeywords: string[]
  graphCandidateCount: number
  bm25CandidateCount: number
  vectorCandidateCount: number
  generatedCount: number
  droppedByBudget: number
  limitations: string[]
}

export type QueryEvidenceStateIntentTrace = {
  enabled: boolean
  reason: string
  matchedKeywords: string[]
  graphCandidateCount: number
  bm25CandidateCount: number
  vectorCandidateCount: number
  errorPathCandidateCount: number
  generatedTransitionCount: number
  generatedFlowCount: number
  droppedByBudget: number
  droppedTransitionCount: number
  droppedFlowCount: number
  limitations: string[]
}

export type QueryEvidenceAnswerPolicy = {
  mode: "grounded" | "conservative"
  confidence: EvidenceConfidence
  allowed: boolean
  requiresCitations: boolean
  reason: string
  guidance: string
}

export type QueryEvidenceSummary = {
  id: string
  kind: "function" | "file" | "module" | "subsystem"
  name: string
  summary: string
  evidenceRefs: string[]
  confidence: "high" | "medium" | "low" | "none"
}

export type QueryEvidenceSummaries = {
  functions: QueryEvidenceSummary[]
  files: QueryEvidenceSummary[]
  modules: QueryEvidenceSummary[]
  subsystems: QueryEvidenceSummary[]
}

export type QueryEvidenceStateMachine = {
  id: string
  name: string
  module?: string
  summary: string
  evidenceRefs: string[]
  confidence: "high" | "medium" | "low" | "none"
}

export type ErrorPathEvidence = {
  id: string
  functionName?: string
  labelName?: string
  branchKind: ErrorPathBranchKind
  condition?: string
  cleanupCalls: string[]
  returnStyle?: string
  filePath: string
  startLine: number
  endLine: number
  confidence: Exclude<EvidenceConfidence, "none">
  limitations: string[]
  backingEvidenceRefs: string[]
}

export type StateTransitionEvidence = {
  id: string
  kind: "transition"
  stateName?: string
  fromState?: string
  toState?: string
  eventName?: string
  guard?: string
  action?: string
  functionName?: string
  filePath: string
  startLine: number
  endLine: number
  confidence: Exclude<EvidenceConfidence, "none">
  backingEvidenceRefs: string[]
  limitations: string[]
}

export type ModuleFlowEvidence = {
  id: string
  kind: "module-flow" | "impact" | "call-path"
  title: string
  modulePath?: string
  involvedSymbols: string[]
  flowSteps: Array<{
    order: number
    label: string
    filePath: string
    startLine: number
    endLine: number
    evidenceRefId?: string
  }>
  confidence: Exclude<EvidenceConfidence, "none">
  backingEvidenceRefs: string[]
  limitations: string[]
}

export type QueryEvidenceDroppedByBudget = {
  evidenceRefs: number
  summaries: number
  stateMachines: number
  packChars: number
}

export type QueryEvidenceResult = {
  query: string
  budget: EvidenceBudget
  trace: QueryEvidenceTrace
  answerPolicy: QueryEvidenceAnswerPolicy
  evidenceRefs: EvidenceRef[]
  errorPaths: ErrorPathEvidence[]
  stateTransitions: StateTransitionEvidence[]
  moduleFlows: ModuleFlowEvidence[]
  summaries: QueryEvidenceSummaries
  stateMachines: QueryEvidenceStateMachine[]
  formattedPackText: string
  truncated: boolean
  droppedByBudget: QueryEvidenceDroppedByBudget
}
