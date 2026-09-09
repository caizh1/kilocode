import { Schema } from "effect"

export const Scope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("uncommitted") }),
  Schema.Struct({ kind: Schema.Literal("staged") }),
  Schema.Struct({ kind: Schema.Literal("unpushed") }),
  Schema.Struct({ kind: Schema.Literal("branch"), base: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("commit"), sha: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("pr"), target: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("module"), path: Schema.String }),
])
export type Scope = typeof Scope.Type

export const Request = Schema.Struct({
  scope: Schema.optional(Scope).annotate({ description: "审核范围；未指定时默认 uncommitted" }),
  effort: Schema.optional(Schema.Literals(["quick", "standard", "deep"])).annotate({
    description: "审核强度；未指定时默认 standard",
  }),
  guidance: Schema.optional(Schema.String),
})
export type Request = typeof Request.Type
export type ResolvedRequest = {
  scope: Scope
  effort: "quick" | "standard" | "deep"
  guidance?: string
}

export function resolveRequest(request: Request): ResolvedRequest {
  return {
    scope: request.scope ?? { kind: "uncommitted" },
    effort: request.effort ?? "standard",
    guidance: request.guidance,
  }
}

export const Severity = Schema.Literals(["P0", "P1", "P2", "P3", "A1", "A2"])
export type Severity = typeof Severity.Type

export const Finding = Schema.Struct({
  id: Schema.String,
  lane: Schema.String,
  severity: Severity,
  locations: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      line: Schema.optional(Schema.Number),
    }),
  ),
  trigger: Schema.String,
  causalChain: Schema.String,
  impact: Schema.String,
  evidence: Schema.Array(Schema.String),
  counterEvidenceChecked: Schema.Array(Schema.String),
  confidence: Schema.Literals(["high", "medium", "low"]),
  remediation: Schema.String,
  recheck: Schema.String,
})
export type Finding = typeof Finding.Type

export const ValidationCommand = Schema.Struct({
  argv: Schema.Array(Schema.String),
  reason: Schema.String,
})
export type ValidationCommand = typeof ValidationCommand.Type

export const LaneReport = Schema.Struct({
  summary: Schema.String,
  findings: Schema.Array(Finding),
  unverifiedRisks: Schema.Array(Schema.String),
  validationCommands: Schema.Array(ValidationCommand),
})
export type LaneReport = typeof LaneReport.Type

export type Effort = ResolvedRequest["effort"]
export type RunStatus = "COMPLETE" | "LIMITED" | "INCOMPLETE" | "STALE" | "CANCELLED"
export type Verdict = "PASS" | "FAIL"
export type ArchitectureGate = "PASS" | "NEEDS REWORK"

export type Lane = {
  id: "architecture" | "behavior" | "reliability" | "verification"
  agent: string
  title: string
  status: "pending" | "running" | "complete" | "failed"
  attempts: number
  sessionID?: string
  reason?: string
}

export type ValidationResult = {
  argv: readonly string[]
  reason: string
  status: "passed" | "failed" | "rejected" | "skipped"
  exitCode?: number
  output?: string
}

export type Report = {
  version: 1
  runId: string
  productStatus: "technical-preview"
  startedAt: number
  completedAt: number
  durationMs: number
  scope: Scope
  scopeLabel: string
  effort: Effort
  guidance?: string
  fingerprint: string
  finalFingerprint: string
  files: number
  additions: number
  deletions: number
  configuration: string[]
  lanes: Lane[]
  validation: ValidationResult[]
  model?: { providerID: string; modelID: string; variant?: string }
  usage: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
  filesRead: string[]
  verdict: Verdict
  architectureGate: ArchitectureGate
  runStatus: RunStatus
  approvable: boolean
  findings: Finding[]
  unverifiedRisks: string[]
  nonBlockingFindings: Finding[]
  notes: string[]
}
