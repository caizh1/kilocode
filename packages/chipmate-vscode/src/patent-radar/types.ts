export type PatentRadarVerdict =
  | "review-ready"
  | "continue-human-review"
  | "single-reference-conflict"
  | "combination-risk"
  | "cn-claim-risk"
  | "observation"
  | "insufficient-evidence"

export interface PatentRadarRun {
  schemaVersion: 2
  methodVersion: string
  id: string
  workspace: string
  scope: { kind: "workspace" } | { kind: "module"; moduleId?: string; name?: string; corePaths: string[]; expansionPolicy: "quality-first" | "balanced" }
  scopeFingerprint: string
  scopeCoverage: {
    coreFiles: string[]
    dependencyFiles: string[]
    documentFiles: string[]
    supportingFiles: string[]
    selectedEvidence: number
    workspaceEvidence: number
    workspacePercent: number
    closureComplete: boolean
    requiresConfirmation: boolean
    excludedBoundaries: Array<{ relationId: string; fromFile: string; toFile: string; reason: string }>
    warnings: string[]
  } | null
  sourceFingerprint: string
  fileFingerprints?: Record<string, string>
  createdAt: string
  updatedAt: string
  status: "SCANNING" | "EXTRACTED" | "RESEARCHED" | "FAILED" | "CANCELLED" | "STALE"
  cutoffDate: string
  corpus: { generation: string | null; indexedAt: string | null } | null
  coverage: {
    supportedFiles: number
    analyzedFiles: number
    skippedFiles: number
    codeEvidence: number
    documentEvidence: number
    relations: number
    compileCommands: "available" | "missing" | "invalid"
    completeWorkspaceScan: boolean
  } | null
  relations: Array<{
    relationId: string
    kind: string
    fromEvidenceId: string
    toEvidenceId: string
    resolution: "exact" | "ambiguous" | "unresolved" | "conditional"
    strength: "strong" | "weak"
    variantIds: string[]
    locations: Array<{ file: string; lineStart: number; lineEnd: number }>
  }>
  candidates: Array<{
    id: string
    title: string
    technicalProblem: string
    implementation: string
    technicalEffect: string
    features: Array<{ id: string; text: string; necessary: boolean }>
    evidenceIds: string[]
    discoveryTier: "observation" | "technical-candidate" | "review-ready"
    origin: "local" | "cross-file"
    relationIds: string[]
    coreSourceFiles: string[]
    supportingSourceFiles: string[]
    effectEvidenceLevel: "measured" | "implemented" | "documented" | "inferred" | "proposed"
    groundingStatus: "pending" | "verified" | "downgraded" | "rejected"
  }>
  sources: Array<{
    id: string
    location: { file: string; lineStart: number; lineEnd: number; page?: number; sha256: string }
    excerpt: string
  }>
  assessments: Array<{
    candidateId: string
    verdict: PatentRadarVerdict
    reason: string
    references: Array<{ publicationNumber: string; title: string | null }>
    matrix: Array<{
      featureId: string
      publicationNumber: string
      covered: boolean
      locator: string | null
      quote: string | null
      rationale: string
    }>
    warnings: string[]
  }>
  reviews: Record<
    string,
    Array<{ reviewer: string; decision: string; note: string; reviewedAt: string; blind: boolean }>
  >
  warnings: string[]
  failure: string | null
  progress?: {
    phase:
      | "workspace-scan"
      | "scope-resolution"
      | "mechanism-distillation"
      | "relation-building"
      | "bridge-discovery"
      | "bridge-verification"
      | "patent-research"
      | "complete"
    completedUnits: number
    totalUnits: number
    failedUnits: number
    startedAt: string
    lastActivityAt: string
    events: Array<{
      id: string
      at: string
      phase:
        | "workspace-scan"
        | "scope-resolution"
        | "mechanism-distillation"
        | "relation-building"
        | "bridge-discovery"
        | "bridge-verification"
        | "patent-research"
        | "complete"
      message: string
      batchIndex?: number
      totalBatches?: number
      candidateTitle?: string
    }>
  }
}

export function isPatentRadarRun(value: unknown): value is PatentRadarRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Partial<PatentRadarRun>
  return (
    item.schemaVersion === 2 &&
    typeof item.id === "string" &&
    typeof item.workspace === "string" &&
    typeof item.status === "string" &&
    Array.isArray(item.candidates) &&
    Array.isArray(item.sources) &&
    Array.isArray(item.assessments)
  )
}

export type PatentRadarWebviewMessage =
  | { type: "patentRadar.ready" }
  | { type: "patentRadar.selectRun"; runId: string }
  | { type: "patentRadar.research"; runId: string }
  | { type: "patentRadar.export"; runId: string }
  | {
      type: "patentRadar.review"
      runId: string
      candidateId: string
      decision: "worthy" | "reject" | "needs-arbitration"
      note: string
    }

export function isPatentRadarWebviewMessage(value: unknown): value is PatentRadarWebviewMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as { type?: unknown; runId?: unknown; candidateId?: unknown; decision?: unknown; note?: unknown }
  if (item.type === "patentRadar.ready") return true
  if (
    (item.type === "patentRadar.research" || item.type === "patentRadar.export" || item.type === "patentRadar.selectRun") &&
    typeof item.runId === "string"
  )
    return true
  return (
    item.type === "patentRadar.review" &&
    typeof item.runId === "string" &&
    typeof item.candidateId === "string" &&
    ["worthy", "reject", "needs-arbitration"].includes(String(item.decision)) &&
    typeof item.note === "string"
  )
}
