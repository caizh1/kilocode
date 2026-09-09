import { createHash } from "node:crypto"
import { z } from "zod"

export const PATENT_RADAR_METHOD_VERSION = "2.1.0"

export namespace PatentRadar {
  export const ScanScope = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("workspace") }),
    z.object({
      kind: z.literal("module"),
      moduleId: z.string().min(1).max(64).optional(),
      name: z.string().min(1).max(120).optional(),
      corePaths: z.array(z.string().min(1).max(2_000)).min(1).max(200),
      expansionPolicy: z.enum(["quality-first", "balanced"]),
    }),
  ])
  export type ScanScope = z.infer<typeof ScanScope>
  export const ModuleDefinition = z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    corePaths: z.array(z.string().min(1).max(2_000)).min(1).max(200),
    expansionPolicy: z.enum(["quality-first", "balanced"]),
    autoScan: z.boolean().default(false),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  export type ModuleDefinition = z.infer<typeof ModuleDefinition>
  export const ScopeBoundary = z.object({
    relationId: z.string(),
    fromFile: z.string(),
    toFile: z.string(),
    reason: z.string(),
  })
  export const ScopeCoverage = z.object({
    coreFiles: z.array(z.string()),
    dependencyFiles: z.array(z.string()),
    documentFiles: z.array(z.string()),
    supportingFiles: z.array(z.string()),
    selectedEvidence: z.number().int().nonnegative(),
    workspaceEvidence: z.number().int().nonnegative(),
    workspacePercent: z.number().min(0).max(1),
    closureComplete: z.boolean(),
    requiresConfirmation: z.boolean(),
    excludedBoundaries: z.array(ScopeBoundary),
    warnings: z.array(z.string()),
  })
  export type ScopeCoverage = z.infer<typeof ScopeCoverage>
  export const ScopePreview = z.object({
    scope: ScanScope,
    scopeFingerprint: z.string(),
    coverage: ScopeCoverage,
    estimatedModelCalls: z.number().int().nonnegative(),
  })
  export type ScopePreview = z.infer<typeof ScopePreview>
  export const AnalysisModel = z.object({ providerID: z.string().min(1).max(200), modelID: z.string().min(1).max(300) })
  export type AnalysisModel = z.infer<typeof AnalysisModel>
  export const Verdict = z.enum([
    "review-ready",
    "continue-human-review",
    "single-reference-conflict",
    "combination-risk",
    "cn-claim-risk",
    "observation",
    "insufficient-evidence",
  ])
  export type Verdict = z.infer<typeof Verdict>
  export const Location = z.object({
    file: z.string(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    page: z.number().int().positive().optional(),
    sha256: z.string(),
  })
  export type Location = z.infer<typeof Location>
  export const SourceEvidence = z.object({
    id: z.string(),
    parentId: z.string().optional(),
    kind: z.enum(["code", "document"]),
    location: Location,
    excerpt: z.string(),
    signals: z.array(z.string()),
    symbols: z.array(z.string()).default([]),
    variantIds: z.array(z.string()).default([]),
    condition: z.string().nullable().default(null),
  })
  export type SourceEvidence = z.infer<typeof SourceEvidence>

  export const RelationKind = z.enum([
    "call",
    "include",
    "type-dependency",
    "callback-registration",
    "operation-table",
    "shared-state",
    "state-transition",
    "data-path",
    "recovery-path",
    "register-control",
    "document-reference",
    "semantic-similarity",
  ])
  export const EvidenceRelation = z.object({
    relationId: z.string(),
    kind: RelationKind,
    fromEvidenceId: z.string(),
    toEvidenceId: z.string(),
    evidenceIds: z.array(z.string()).min(1),
    resolution: z.enum(["exact", "ambiguous", "unresolved", "conditional"]),
    strength: z.enum(["strong", "weak"]),
    variantIds: z.array(z.string()).default([]),
    condition: z.string().nullable().default(null),
    locations: z.array(Location).min(1),
  })
  export type EvidenceRelation = z.infer<typeof EvidenceRelation>

  export const EffectEvidenceLevel = z.enum(["measured", "implemented", "documented", "inferred", "proposed"])
  export type EffectEvidenceLevel = z.infer<typeof EffectEvidenceLevel>
  export const MechanismAtom = z.object({
    id: z.string(),
    abstractMechanism: z.string().min(4),
    implementation: z.string().min(4),
    technicalProblem: z.string().min(4),
    input: z.array(z.string()),
    processing: z.array(z.string()),
    output: z.array(z.string()),
    stateChanges: z.array(z.string()),
    constraints: z.array(z.string()),
    technicalEffect: z.string().min(4),
    effectEvidenceLevel: EffectEvidenceLevel,
    evidenceIds: z.array(z.string()).min(1),
    sourceFiles: z.array(z.string()).min(1),
    bridgeHooks: z.array(z.string()).default([]),
  })
  export type MechanismAtom = z.infer<typeof MechanismAtom>
  export const Feature = z.object({
    id: z.string(),
    text: z.string().min(4),
    necessary: z.boolean(),
    evidenceIds: z.array(z.string()).min(1),
    relationIds: z.array(z.string()).default([]),
  })
  export type Feature = z.infer<typeof Feature>
  export const EngineeringEvaluation = z.object({
    technicalProblemSpecificity: z.number().min(0).max(5),
    implementationDepth: z.number().min(0).max(5),
    crossComponentCoordination: z.number().min(0).max(5),
    causalEffectCompleteness: z.number().min(0).max(5),
    conventionalDifference: z.number().min(0).max(5),
    mechanismReusability: z.number().min(0).max(5),
    productCentrality: z.number().min(0).max(5),
    designAroundDifficulty: z.number().min(0).max(5),
    reasons: z.record(z.string(), z.string()),
  })
  export const Candidate = z.object({
    id: z.string(),
    title: z.string().min(4),
    technicalProblem: z.string().min(8),
    implementation: z.string().min(8),
    technicalEffect: z.string().min(8),
    features: z.array(Feature).min(2),
    keywords: z.array(z.string()).min(2),
    ipcHints: z.array(z.string()),
    evidenceIds: z.array(z.string()).min(1),
    extractionWarnings: z.array(z.string()),
    discoveryTier: z.enum(["observation", "technical-candidate", "review-ready"]).default("observation"),
    origin: z.enum(["local", "cross-file"]).default("local"),
    mechanismIds: z.array(z.string()).default([]),
    relationIds: z.array(z.string()).default([]),
    coreSourceFiles: z.array(z.string()).default([]),
    supportingSourceFiles: z.array(z.string()).default([]),
    abstractMechanism: z.string().default(""),
    effectEvidenceLevel: EffectEvidenceLevel.default("inferred"),
    groundingStatus: z.enum(["pending", "verified", "downgraded", "rejected"]).default("pending"),
    engineeringEvaluation: EngineeringEvaluation.nullable().default(null),
  })
  export type Candidate = z.infer<typeof Candidate>

  export const WorkspaceCoverage = z.object({
    supportedFiles: z.number().int().nonnegative(),
    analyzedFiles: z.number().int().nonnegative(),
    skippedFiles: z.number().int().nonnegative(),
    parseFailures: z.array(z.object({ file: z.string(), reason: z.string() })),
    skipped: z.array(z.object({ file: z.string(), reason: z.string() })),
    codeEvidence: z.number().int().nonnegative(),
    documentEvidence: z.number().int().nonnegative(),
    relations: z.number().int().nonnegative(),
    compileCommands: z.enum(["available", "missing", "invalid"]),
    variants: z.array(z.object({ id: z.string(), file: z.string(), condition: z.string().nullable() })),
    conditionalCoverageComplete: z.boolean(),
    completeWorkspaceScan: z.boolean(),
  })
  export type WorkspaceCoverage = z.infer<typeof WorkspaceCoverage>

  export const CorpusWatermark = z.object({
    status: z.string(),
    generation: z.string().nullable(),
    indexedAt: z.string().nullable(),
    requiredJurisdictions: z.array(z.string()).optional(),
    jurisdictions: z.array(
      z.object({
        jurisdiction: z.string(),
        records: z.number(),
        dataThrough: z.string().nullable(),
        legalStatusThrough: z.string().nullable(),
        claimsCoverage: z.number(),
        fullTextCoverage: z.number(),
        historicalBaseline: z.boolean(),
        coverageThrough: z.string().nullable(),
      }),
    ),
  })
  export type CorpusWatermark = z.infer<typeof CorpusWatermark>
  export const PatentPassage = z.object({ field: z.string(), locator: z.string(), text: z.string() })
  export const PatentHit = z.object({
    publicationNumber: z.string(),
    title: z.string().nullable(),
    priorityDate: z.string().nullable(),
    publicationDate: z.string().nullable(),
    familyId: z.string().nullable(),
    legalStatus: z.string().nullable(),
    jurisdiction: z.string(),
    classifications: z.array(z.string()),
    score: z.number(),
    scores: z.record(z.string(), z.number().nullable()),
    passages: z.array(PatentPassage),
    sourceBatch: z.string(),
  })
  export type PatentHit = z.infer<typeof PatentHit>
  export const MatrixCell = z.object({
    featureId: z.string(),
    publicationNumber: z.string(),
    covered: z.boolean(),
    locator: z.string().nullable(),
    quote: z.string().nullable(),
    rationale: z.string(),
  })
  export type MatrixCell = z.infer<typeof MatrixCell>
  export const Assessment = z.object({
    candidateId: z.string(),
    verdict: Verdict,
    reason: z.string(),
    references: z.array(PatentHit),
    matrix: z.array(MatrixCell),
    warnings: z.array(z.string()),
  })
  export type Assessment = z.infer<typeof Assessment>
  export const Review = z.object({
    reviewer: z.string(),
    decision: z.enum(["worthy", "reject", "needs-arbitration"]),
    note: z.string(),
    reviewedAt: z.string(),
    blind: z.boolean(),
  })
  export type Review = z.infer<typeof Review>
  export const BlindReviewImport = z.object({
    schemaVersion: z.literal(2),
    runId: z.string(),
    sourceFingerprint: z.string(),
    methodVersion: z.string(),
    reviews: z.array(
      z.object({
        candidateId: z.string(),
        reviewer: z.string().min(1).max(100),
        decision: z.enum(["worthy", "reject", "needs-arbitration"]),
        note: z.string().max(4000),
      }),
    ),
  })
  export type BlindReviewImport = z.infer<typeof BlindReviewImport>

  export const ProgressPhase = z.enum([
    "workspace-scan",
    "scope-resolution",
    "mechanism-distillation",
    "relation-building",
    "bridge-discovery",
    "bridge-verification",
    "patent-research",
    "complete",
  ])
  export const Run = z.object({
    schemaVersion: z.literal(2),
    methodVersion: z.string(),
    id: z.string(),
    workspace: z.string(),
    workspaceFingerprint: z.string(),
    sourceFingerprint: z.string(),
    fileFingerprints: z.record(z.string(), z.string()).default({}),
    createdAt: z.string(),
    updatedAt: z.string(),
    status: z.enum(["SCANNING", "EXTRACTED", "RESEARCHED", "FAILED", "CANCELLED", "STALE"]),
    cutoffDate: z.string(),
    serverBaseUrl: z.string().nullable(),
    analysisModel: AnalysisModel.nullable().default(null),
    scope: ScanScope.default({ kind: "workspace" }),
    scopeFingerprint: z.string().default("workspace"),
    scopeCoverage: ScopeCoverage.nullable().default(null),
    scopeLargeClosureConfirmed: z.boolean().default(false),
    corpus: CorpusWatermark.nullable(),
    coverage: WorkspaceCoverage.nullable().default(null),
    sources: z.array(SourceEvidence),
    mechanisms: z.array(MechanismAtom).default([]),
    relations: z.array(EvidenceRelation).default([]),
    bridgeCandidates: z.array(z.string()).default([]),
    candidates: z.array(Candidate),
    assessments: z.array(Assessment),
    reviews: z.record(z.string(), z.array(Review)),
    warnings: z.array(z.string()),
    failure: z.string().nullable(),
    rankingPolicy: z
      .object({ mode: z.literal("fused-rrf"), rerank: z.literal("off") })
      .default({ mode: "fused-rrf", rerank: "off" }),
    tokenUsage: z
      .object({
        input: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
        calls: z.number().int().nonnegative(),
        estimated: z.boolean().default(true),
      })
      .default({ input: 0, output: 0, calls: 0, estimated: true }),
    discoveryCheckpoints: z
      .record(
        z.string(),
        z.object({
          status: z.enum(["pending", "complete", "failed"]),
          hash: z.string(),
          updatedAt: z.string(),
          error: z.string().optional(),
        }),
      )
      .default({}),
    evidenceStore: z
      .object({
        count: z.number().int().nonnegative(),
        shards: z.array(
          z.object({
            file: z.string(),
            count: z.number().int().nonnegative(),
            sha256: z.string(),
            evidenceIds: z.array(z.string()).optional(),
          }),
        ),
      })
      .nullable()
      .default(null),
    qualityGate: z
      .object({ mode: z.literal("experimental"), goldSetValidated: z.boolean(), reasons: z.array(z.string()) })
      .default({ mode: "experimental", goldSetValidated: false, reasons: ["尚未完成真实 gold set 验收。"] }),
    progress: z
      .object({
        phase: ProgressPhase,
        completedUnits: z.number().int().nonnegative(),
        totalUnits: z.number().int().nonnegative(),
        failedUnits: z.number().int().nonnegative(),
        startedAt: z.string(),
        lastActivityAt: z.string(),
        events: z.array(
          z.object({
            id: z.string(),
            at: z.string(),
            phase: ProgressPhase,
            message: z.string(),
            batchIndex: z.number().int().positive().optional(),
            totalBatches: z.number().int().positive().optional(),
            candidateTitle: z.string().optional(),
          }),
        ),
      })
      .optional(),
    extractionBatches: z.record(z.string(), z.array(Candidate)).default({}),
    bridgeBatches: z.record(z.string(), z.array(Candidate)).default({}),
    verificationBatches: z.record(z.string(), Candidate).default({}),
    researchBatches: z.record(z.string(), Assessment).default({}),
    extractionEvidenceIds: z.array(z.string()).default([]),
  })
  export type Run = z.infer<typeof Run>
}

export function blindCandidateIds(candidateIds: string[]) {
  const unique = [...new Set(candidateIds)]
  const count = unique.length ? Math.max(1, Math.round(unique.length * 0.2)) : 0
  return new Set(
    unique
      .map((id) => ({ id, key: createHash("sha256").update(id).digest("hex") }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
      .slice(0, count)
      .map((item) => item.id),
  )
}
