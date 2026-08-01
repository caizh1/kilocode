export const roles = ["reporter", "maintainer", "admin"] as const
export type Role = (typeof roles)[number]

export const severities = ["low", "medium", "high", "critical"] as const
export type Severity = (typeof severities)[number]

export const stages = [
  "queued",
  "diagnosing",
  "fixing",
  "testing",
  "reviewing",
  "approval_wait",
  "packaging",
  "validating",
  "publishing",
  "released",
  "failed",
  "cancelled",
  "revoked",
] as const
export type Stage = (typeof stages)[number]

export interface User {
  id: number
  username: string
  password_hash: string
  role: Role
  created_at: string
  disabled_at: string | null
}

export interface Invite {
  id: number
  creator_id: number | null
  code_hash: string
  code_prefix: string
  max_uses: number
  used_count: number
  created_at: string
  exhausted_at: string | null
}

export interface Session {
  id: number
  user_id: number
  token_hash: string
  csrf: string
  expires_at: string
  created_at: string
}

export interface Bug {
  id: number
  title: string
  description: string
  reproduction: string
  expected: string
  actual: string
  environment: string
  component: string
  severity: Severity
  status: string
  reporter_id: number
  created_at: string
  updated_at: string
}

export interface Run {
  id: number
  bug_id: number
  stage: Stage
  requires_approval: number
  approved_by: number | null
  approved_at: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  attempts: number
  release_version: string
  baseline_commit: string | null
  source_commit: string | null
  summary: string | null
  error: string | null
  token_count: number
  created_at: string
  updated_at: string
}

export const logKinds = ["system", "codex", "command", "test", "review", "package", "qa", "publish"] as const
export type LogKind = (typeof logKinds)[number]

export const logLevels = ["info", "success", "warning", "error"] as const
export type LogLevel = (typeof logLevels)[number]

export interface RunLog {
  id: number
  run_id: number
  stage: Stage
  kind: LogKind
  level: LogLevel
  message: string
  summary: string | null
  detail: string | null
  created_at: string
}

export interface RunLogInput {
  stage: Stage
  kind: LogKind
  level: LogLevel
  message: string
  summary?: string
  detail?: string
}

export interface Artifact {
  id: number
  run_id: number
  version: string
  platform: string
  name: string
  size: number
  sha256: string
  url: string
  created_at: string
}

export interface Audit {
  id: number
  actor_type: string
  actor_id: string
  action: string
  subject_type: string
  subject_id: string
  detail: string
  created_at: string
}

export interface BugInput {
  title: string
  description: string
  reproduction: string
  expected: string
  actual: string
  environment: string
  component: string
  severity: Severity
}

export interface RunResult {
  stage: Stage
  summary?: string
  error?: string
  baselineCommit?: string
  sourceCommit?: string
  tokenCount?: number
  requiresApproval?: boolean
  artifacts?: Array<{
    version: string
    platform: string
    name: string
    size: number
    sha256: string
    url: string
  }>
}
