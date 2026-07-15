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

export interface MarketplaceItemBase {
  id: string
  name: string
  description: string
  author?: string
  authorUrl?: string
  tags?: string[]
  prerequisites?: string[]
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
}

export interface AgentMarketplaceItem extends MarketplaceItemBase {
  type: "agent"
  content: AgentContent
}

export interface SkillMarketplaceItem extends MarketplaceItemBase {
  type: "skill"
  category: string
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
  localOnly?: boolean
  uploadable?: boolean
  origin?: "market" | "local-import" | "builtin"
  localState?: "managed" | "unmanaged" | "modified"
  publishState?: "unpublished" | "matched" | "local-changes" | "blocked"
  removeToken?: string
  localScope?: "global" | "project"
}

export type MarketplaceItem = McpMarketplaceItem | AgentMarketplaceItem | SkillMarketplaceItem

export interface InstallMarketplaceItemOptions {
  target?: "global" | "project"
  parameters?: Record<string, unknown>
}

export interface MarketplaceInstalledMetadata {
  project: Record<string, { type: string }>
  global: Record<string, { type: string }>
}

export interface MarketplaceFilters {
  type?: string
  search?: string
  tags?: string[]
}

export interface MarketplaceUser {
  name: string
  tokenName?: string
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
  issues: Array<{
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
  }>
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
  report: Record<string, unknown>
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

export interface PublicationRun {
  id: string
  skillId?: string
  ownerId: string
  status: string
  stage: string
  report?: {
    valid: boolean
    changed: boolean
    issues: Array<{ code: string; severity: string; file?: string; field?: string; message: string }>
  }
  patches: Array<{ id: string; kind: "deterministic" | "ai"; expiresAt: string }>
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
