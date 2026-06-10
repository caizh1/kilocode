export type CodeGraphEvidenceRetrievalMode = "hybrid" | "graph-only"

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
  path: string
  startLine: number
  endLine: number
  kind: string
  reason: string
  score?: number
  snippet?: string
  snippetHash?: string
}

export type QueryEvidenceStageStatus = "completed" | "skipped" | "failed"

export type QueryEvidenceTraceStage = {
  name: "graph" | "bm25" | "vector" | "rerank" | "pack"
  status: QueryEvidenceStageStatus
  reason: string
  elapsedMs: number
  count?: number
}

export type QueryEvidenceTrace = {
  traceId: string
  query: string
  retrievalMode: CodeGraphEvidenceRetrievalMode
  stages: QueryEvidenceTraceStage[]
  elapsedMs: number
}

export type QueryEvidenceAnswerPolicy = {
  mode: "grounded" | "conservative"
  confidence: "high" | "medium" | "low" | "none"
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
  summaries: QueryEvidenceSummaries
  stateMachines: QueryEvidenceStateMachine[]
  formattedPackText: string
  truncated: boolean
  droppedByBudget: QueryEvidenceDroppedByBudget
}
