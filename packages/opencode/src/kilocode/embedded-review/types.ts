export type EmbeddedReviewScope =
  | { kind: "uncommitted" }
  | { kind: "commit"; requested: string; commit: string; parent: string }

export type ChangedLine = {
  old?: number
  next?: number
}

export type ChangeHunk = {
  header: string
  oldStart: number
  oldCount: number
  nextStart: number
  nextCount: number
  lines: string[]
  changed: ChangedLine[]
}

export type ChangeFile = {
  path: string
  previousPath?: string
  status: "added" | "modified" | "deleted" | "renamed" | "untracked"
  before: string
  after: string
  patch: string
  hunks: ChangeHunk[]
  changedLines: number[]
}

export type ChangeSet = {
  schemaVersion: 1
  scope: EmbeddedReviewScope
  root: string
  files: ChangeFile[]
  skipped: Array<{ path: string; reason: string }>
  generatedAt: string
  limits: {
    maxFiles: number
    maxHunks: number
    maxFileBytes: number
    maxEvidenceBytes: number
  }
}

export type RuleLevel = "MUST" | "SHOULD" | "ADVICE"
export type RuleCheck = "mechanical" | "semantic"

export type Rule = {
  id: string
  revision: number
  level: RuleLevel
  title: string
  description: string
  appliesTo: string[]
  languages: Array<"c" | "cpp">
  exceptions: string[]
  check: RuleCheck
  contentHash: string
}

export type RulePack = {
  schemaVersion: 1
  version: string
  status: "DRAFT" | "PUBLISHED" | "RETIRED"
  contentHash: string
  sourceHash: string
  publishedAt?: string
  rules: Rule[]
}

export type StandardFinding = {
  track: "STANDARD"
  ruleId: string
  ruleVersion: string
  path: string
  line: number
  violation: string
  code: string
  exceptionCounterevidence: string
}

export type LogicCategory =
  | "CONTROL_CONTRACT"
  | "MEMORY_SECURITY"
  | "REALTIME_CONCURRENCY"
  | "RESOURCE_LIFECYCLE"
  | "UPDATE_PERSISTENCE"

export type LogicProfile = {
  category: LogicCategory
  signals: string[]
  checks: string[]
}

export type LogicFinding = {
  track: "LOGIC"
  category: LogicCategory
  severity: "P0" | "P1"
  obligationId?: string
  path: string
  line: number
  trigger: string
  pathEvidence: string[]
  causalChain: string[]
  impact: string
  protectionCounterevidence: string
}

export type ReviewObligation = {
  id: string
  kind: "INTEGER_PROMOTION" | "CUMULATIVE_CAPACITY"
  category: Extract<LogicCategory, "CONTROL_CONTRACT" | "MEMORY_SECURITY">
  path: string
  line: number
  expression: string
  invariant: string
  facts: string[]
  guards: string[]
  counterexample: string
  confidence: "DETERMINISTIC_CANDIDATE"
}

export type StandardStatus = "COMPLIANT" | "NON_COMPLIANT" | "NOT_EVALUATED"
export type EmbeddedReviewVerdict = "PASS" | "FAIL"

export type EmbeddedReviewReport = {
  schemaVersion: 1
  scope: EmbeddedReviewScope
  rulePack?: Pick<RulePack, "version" | "contentHash" | "publishedAt">
  standard: {
    status: StandardStatus
    findings: StandardFinding[]
    reason?: string
  }
  logic: {
    verdict: EmbeddedReviewVerdict
    findings: LogicFinding[]
  }
  unverifiedRisks: string[]
  nonBlockingFindings: string[]
}

export type ReviewPacket = {
  path: string
  hunk: string
  changedLines: number[]
  function?: {
    name: string
    signature: string
    startLine: number
    endLine: number
    source: string
    calls: Array<{ callee: string; line: number; args: string[]; returnHandling?: string }>
  }
  relatedFunctions: Array<{
    path: string
    name: string
    signature: string
    startLine: number
    endLine: number
    source: string
    relation: "callee" | "caller" | "changed" | "shared"
  }>
  macros: Array<{ name: string; line: number; snippet?: string }>
  types: Array<{ name: string; kind: string; line: number; snippet?: string }>
  rules: Rule[]
  logicProfiles: LogicProfile[]
  logicHints: string[]
  obligations: ReviewObligation[]
}

export type EmbeddedReviewPreparation = {
  schemaVersion: 1
  changes: ChangeSet
  rulePack?: RulePack
  standard: {
    mechanicalStatus: StandardStatus
    findings: StandardFinding[]
    reason?: string
    evaluatedRuleIds: string[]
    semanticRuleIds: string[]
  }
  packets: ReviewPacket[]
  warnings: string[]
}

export type EmbeddedReviewSubmission = {
  standardFindings: Array<Omit<StandardFinding, "track" | "ruleVersion">>
  logicFindings: Array<Omit<LogicFinding, "track">>
  obligationReviews: Array<{
    obligationId: string
    disposition: "CONFIRMED" | "REFUTED" | "UNVERIFIED"
    reason: string
    evidence: string[]
  }>
  unverifiedRisks: string[]
  nonBlockingFindings: string[]
}
