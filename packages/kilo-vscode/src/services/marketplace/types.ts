export interface McpParameter {
  name: string
  key: string
  placeholder?: string
  optional?: boolean
}

export interface McpInstallationMethod {
  name: string
  content: string
  parameters?: McpParameter[]
  prerequisites?: string[]
}

export interface MarketplaceSuggestFor {
  filename?: string[]
  vscode_extension?: string[]
}

export interface MarketplaceItemBase {
  id: string
  name: string
  description: string
  category: string
  author?: string
  authorUrl?: string
  prerequisites?: string[]
  suggest_for?: MarketplaceSuggestFor
}

export interface McpMarketplaceItem extends MarketplaceItemBase {
  type: "mcp"
  url: string
  content: string | McpInstallationMethod[]
  parameters?: McpParameter[]
}

export interface AgentContent {
  mode: "primary" | "subagent" | "all"
  description: string
  prompt: string
  options?: Record<string, unknown>
  permission?: Record<string, unknown>
  requirements?: {
    skills?: string[]
    mcps?: string[]
    vscode_extensions?: Array<{ name: string; id: string }>
  }
}

export interface AgentMarketplaceItem extends MarketplaceItemBase {
  type: "agent"
  content: AgentContent
}

export interface RawSkill {
  id: string
  name?: string
  description: string
  category: string
  githubUrl?: string
  content: string
  author?: string
  uploadedBy?: string
  uploadedAt?: string
  updatedAt?: string
  downloadCount?: number
  stars?: number
  suggest_for?: MarketplaceSuggestFor
}

export interface SkillMarketplaceItem extends MarketplaceItemBase {
  type: "skill"
  githubUrl?: string
  content: string
  displayName: string
  displayCategory: string
  uploadedBy?: string
  uploadedAt?: string
  updatedAt?: string
  downloadCount?: number
  stars?: number
  favorite?: boolean
  revision?: number
  sha256?: string
  risk?: SkillRiskSummary
  /** Generated from the locally installed CLI skill list, not the remote catalog. */
  localOnly?: boolean
  /** The latest successful remote catalog scan confirmed this local Skill is absent. */
  uploadable?: boolean
  origin?: "market" | "local-import" | "builtin"
  localState?: "managed" | "unmanaged" | "modified"
  publishState?: "unpublished" | "matched" | "local-changes" | "blocked"
  removeToken?: string
  localScope?: "global" | "project"
}

export type MarketplaceItem = McpMarketplaceItem | AgentMarketplaceItem | SkillMarketplaceItem
export type MarketplaceItemRef = Pick<MarketplaceItem, "id" | "type">

export interface InstallMarketplaceItemOptions {
  target?: "global" | "project"
  parameters?: Record<string, unknown>
}

export interface MarketplaceInstalledMetadata {
  project: Record<string, { type: string }>
  global: Record<string, { type: string }>
}

export interface MarketplaceRelevance {
  filename?: string[]
  vscodeExtension?: string[]
}

export type MarketplaceRelevanceMetadata = Record<string, MarketplaceRelevance>

export interface MarketplaceDataResponse {
  marketplaceItems: MarketplaceItem[]
  marketplaceInstalledMetadata: MarketplaceInstalledMetadata
  marketplaceRelevance: MarketplaceRelevanceMetadata
  errors?: string[]
  marketplaceUser?: MarketplaceUser
  marketplaceBaseUrl?: string
  marketplaceSkillsOnly?: boolean
  marketplaceMode?: "skills-only" | "full"
  marketplaceProtocol?: "aligned-v1" | "legacy"
  marketplaceCapabilities?: MarketCapabilities
  marketplaceInstallations?: InstallationState[]
  marketplacePublications?: PublicationRun[]
  marketplaceStatus?: MarketStatus
  marketplaceAnalytics?: AnalyticsSeries[]
  marketplaceServerState?: MarketplaceServerState
  marketplaceIdentityState?: MarketplaceIdentityState
}

export interface MarketplaceUser {
  name: string
  tokenName?: string
}

export type MarketplaceErrorReason =
  | "invalid-url"
  | "timeout"
  | "invalid-json"
  | "empty-response"
  | "rate-limited"
  | "upstream-http"
  | "network"
  | "unknown"

export interface MarketplaceIssue {
  summary: string
  status?: number
  code?: string
  reason?: MarketplaceErrorReason
  requestId?: string
  retryAfter?: string
  upstreamStatus?: number
}

export interface MarketplaceServerState {
  status: "connecting" | "connected" | "degraded" | "failed"
  checkedAt: string
  issue?: MarketplaceIssue
}

export interface MarketplaceIdentityState {
  status: "verifying" | "verified" | "unverified" | "failed"
  checkedAt: string
  user?: MarketplaceUser
  issue?: MarketplaceIssue
}

export interface MarketCapabilities {
  mode: "aligned-v1"
  apiVersion: string
  catalogVersion: string
  skillSpecVersion?: string
  features: {
    versions: boolean
    favorites: boolean
    installations: boolean
    publications: boolean
    repairs: boolean
    analytics: boolean
    events: boolean
    extensions?: boolean
    extensionPublications?: boolean
    extensionReviews?: boolean
    extensionAnalytics?: boolean
    extensionDirectoryImport?: boolean
  }
}

export type SkillSourceKind = "directory" | "skill-md" | "zip" | "tar-gz"
export type SkillFormatHint = "agent-skills" | "codex" | "claude" | "opencode"

export interface LocalSkillConflict {
  scope: "global" | "project"
  state: "none" | "same" | "different" | "managed"
  installedSha256?: string
}

export interface SkillValidationReport {
  valid: boolean
  issues: ValidationIssue[]
  policyVersion?: string
  risk?: SkillRiskSummary
}

export type SkillRiskLevel = "none" | "medium" | "critical" | "unknown"

export interface SkillRiskSummary {
  level: SkillRiskLevel
  issueCount: number
  policyVersion?: string
}

export interface SkillImportCandidate extends SkillValidationReport {
  key: string
  id: string
  name: string
  description: string
  sourceKind: SkillSourceKind
  sourceLabel: string
  hints: SkillFormatHint[]
  fileCount: number
  totalBytes: number
  snapshotSha256: string
  repairs: Array<{ field: "name" | "description"; before?: string; after: string }>
  conflicts: LocalSkillConflict[]
}

export interface SkillImportPreview {
  token: string
  expiresAt: string
  projectAvailable: boolean
  candidates: SkillImportCandidate[]
}

export interface SkillImportSelection {
  token: string
  candidateIds: string[]
  scope: "global" | "project"
  replaceIds: string[]
  repairs?: Record<string, { name?: string; description?: string }>
}

export interface LocalSkillImportItemResult {
  id: string
  status: "installed" | "unchanged" | "skipped" | "failed"
  error?: string
}

export interface SkillImportResult {
  token: string
  items: LocalSkillImportItemResult[]
}

export interface LocalSkillImportProgress {
  token: string
  current: string
  completed: number
  total: number
}

export interface LocalSkillRecord {
  version: 1
  skillId: string
  scope: "global" | "project"
  workspaceId?: string
  sourceKind: SkillSourceKind
  sourceLabel: string
  sourceSha256: string
  installedSha256: string
  specVersion: string
  hints: SkillFormatHint[]
  importedAt: string
}

export interface InstallationState {
  skillId: string
  revision: number
  sha256: string
  scope: "global" | "project"
  status: "installed" | "updating" | "removed" | "local-unmanaged"
  clientId: string
  workspaceId?: string
  changedAt: string
}

export interface SkillRelease {
  skillId: string
  revision: number
  semver?: string
  sha256: string
  size: number
  notes?: string
  report: SkillValidationReport
  archiveUrl: string
  publishedAt: string
}

export interface SkillFile {
  path: string
  type: "text" | "image" | "binary"
  mime: string
  size: number
  sha256: string
  previewable: boolean
}

export interface SkillDetail {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  author: { id: string; displayName: string }
  latestRevision: number
  semver?: string
  sha256: string
  updatedAt: string
  downloads: number
  favorites: number
  risk: SkillRiskSummary
  markdown: string
  releases: SkillRelease[]
  files: SkillFile[]
}

export interface MarketStatus {
  ok: boolean
  transport: "trusted-http" | "https"
  render: "ready" | "degraded" | "unavailable"
  market: "ready" | "degraded" | "unavailable"
  packages: "ready" | "degraded" | "unavailable"
  warnings: string[]
}

export interface AnalyticsSeries {
  metric: string
  scope: "global" | "author" | "skill"
  points: Array<{ date: string; value: number }>
}

export interface MarketplaceUploadFile {
  path: string
  contentBase64: string
  sizeBytes?: number
}

export interface MarketplaceUploadPayload {
  id: string
  name: string
  description: string
  category?: string
  files: MarketplaceUploadFile[]
}

export interface ValidationIssue {
  code: string
  severity: "info" | "warning" | "error"
  file?: string
  line?: number
  field?: string
  message: string
  expected?: string
  actual?: string
  fixable: boolean
  repairKind: "none" | "deterministic" | "ai"
  riskLevel: "none" | "medium" | "critical"
}

export interface PublicationPatchFile {
  path: string
  beforeSha256: string
  afterSha256: string
  patch: string
}

export interface PublicationPatch {
  id: string
  runId: string
  kind: "deterministic" | "ai"
  files: PublicationPatchFile[]
  requiresConfirmation: boolean
  expiresAt: string
}

export interface PublicationRun {
  id: string
  skillId?: string
  ownerId: string
  status:
    | "VALIDATING"
    | "NEEDS_AUTHOR_FIX"
    | "NEEDS_AI_CONFIRMATION"
    | "SECURITY_REJECTED"
    | "PUBLISHING"
    | "PUBLISHED"
    | "UNPUBLISHED"
    | "UNDONE"
    | "UNCHANGED"
    | "FAILED"
  stage: "uploaded" | "format" | "deterministic" | "security" | "semantic" | "publishing" | "complete"
  report?: {
    valid: boolean
    stage: "format" | "deterministic" | "security" | "semantic" | "complete"
    issues: ValidationIssue[]
    sourceSha256: string
    snapshotSha256: string
    changed: boolean
    policyVersion?: string
    risk?: SkillRiskSummary
  }
  patches: PublicationPatch[]
  release?: {
    skillId: string
    revision: number
    semver?: string
    sha256: string
    archiveUrl: string
    publishedAt: string
  }
  createdAt: string
  updatedAt: string
}

export interface InstallResult {
  success: boolean
  slug: string
  error?: string
  filePath?: string
  line?: number
}

export interface RemoveResult {
  success: boolean
  slug: string
  error?: string
}
