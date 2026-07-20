export interface MarketDbOptions {
  dir: string
}

export interface MarketDbHealth {
  available: boolean
  schemaVersion: number
  journalMode: "wal"
  foreignKeys: true
  busyTimeout: number
  message?: string
}

export type ExtensionPublicationStatus =
  | "UPLOADING"
  | "VALIDATING"
  | "PUBLISHING"
  | "PUBLISHED"
  | "DUPLICATE"
  | "CANCELLED"
  | "FAILED"

export interface ExtensionManifest {
  id: string
  publisher: string
  name: string
  displayName: string
  description: string
  version: string
  target: string
  engineVscode: string
  categories: string[]
  keywords: string[]
  dependencies: string[]
  prerelease: boolean
  systemPlugin: boolean
  readme: string
  iconData?: string
}

export interface ExtensionArtifactInput {
  id: string
  sha256: string
  size: number
  path: string
  filename: string
  uploaderId?: string
  uploaderName: string
  sourceKey: string
  sourceKind: "system" | "web"
  manifest: ExtensionManifest
  publishedAt: string
}

export interface ExtensionArtifactItem {
  id: string
  extensionId: string
  version: string
  target: string
  sha256: string
  size: number
  path: string
  filename: string
  uploaderId?: string
  uploaderName: string
  source: "system" | "web"
  prerelease: boolean
  conflict: boolean
  downloads: number
  publishedAt: string
  status: "published" | "removed"
  manifest: ExtensionManifest
}

export interface ExtensionSummaryItem {
  id: string
  publisher: string
  name: string
  displayName: string
  description: string
  version: string
  engineVscode: string
  categories: string[]
  keywords: string[]
  targets: string[]
  uploader: string
  iconData?: string
  systemPlugin: boolean
  prerelease: boolean
  downloads: number
  favorites: number
  rating: number
  ratingCount: number
  updatedAt: string
}

export interface ExtensionDetailItem extends ExtensionSummaryItem {
  readme: string
  dependencies: string[]
  artifacts: ExtensionArtifactItem[]
  versions: string[]
}

export interface ExtensionSearchInput {
  q?: string
  category?: string
  target?: string
  uploader?: string
  sort?: "downloads" | "rating" | "favorites" | "updated" | "name"
  limit?: number
  offset?: number
}

export interface ExtensionPublicationInput {
  id: string
  ownerId: string
  filename: string
  totalBytes: number
  idempotencyKey: string
  status: ExtensionPublicationStatus
  stage: string
  sha256?: string
  artifactId?: string
  error?: string
}

export interface ExtensionPublicationItem extends ExtensionPublicationInput {
  createdAt: string
  updatedAt: string
}

export interface ExtensionFavoriteInput {
  userId: string
  extensionId: string
  value: boolean
}

export interface ExtensionReviewInput {
  userId: string
  userName: string
  extensionId: string
  artifactId?: string
  rating: number
  comment: string
}

export interface ExtensionReviewItem {
  userId: string
  userName: string
  extensionId: string
  artifactId?: string
  rating: number
  comment: string
  createdAt: string
  updatedAt: string
}

export interface ExtensionDownloadInput {
  id: string
  artifactId: string
  source: string
  occurredAt: string
}

export interface ExtensionAnalyticsItem {
  totals: {
    downloads: number
    favorites: number
    rating: number
    active: number
    growth30d: number
  }
  trend: Array<{ date: string; downloads: number; favorites: number }>
  downloads: Array<{ id: string; name: string; value: number }>
  ratings: Array<{ id: string; name: string; value: number }>
  targets: Array<{ target: string; value: number }>
  activity: Array<{ type: "publish"; extensionId: string; name: string; at: string }>
}

export interface ImportResult {
  imported: number
  unchanged: number
  skipped: number
  revisions: Array<{ id: string; revision: number; sha256: string }>
}

export interface ExportResult {
  count: number
  catalogVersion: string
  root: string
}

export interface SearchInput {
  q?: string
  category?: string
  author?: string
  updatedAfter?: string
  sort?: "updated" | "downloads" | "favorites" | "name"
  limit?: number
  offset?: number
}

export interface SearchItem {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  authorId: string
  author: string
  latestRevision: number
  semver?: string
  sha256: string
  archivePath: string
  updatedAt: string
  downloads: number
  favorites: number
  report: Record<string, unknown>
  artwork?: ArtworkItem
  gallery?: ArtworkItem[]
}

export interface ArtworkItem {
  type: "icon" | "cover" | "screenshot"
  url: string
  mime: string
  width: number
  height: number
  sha256: string
}

export interface ReleaseItem {
  skillId: string
  revision: number
  semver?: string
  sha256: string
  size: number
  notes?: string
  report: Record<string, unknown>
  archivePath: string
  publishedAt: string
}

export interface FileItem {
  path: string
  type: "text" | "image" | "binary"
  mime: string
  size: number
  sha256: string
  previewable: boolean
}

export interface FilePreview {
  file: FileItem
  text?: string
  dataUrl?: string
}

export interface CategoryItem {
  id: string
  name: string
  count: number
}

export interface AuthorItem {
  id: string
  displayName: string
  skills: SearchItem[]
}

export interface FavoriteInput {
  userId: string
  displayName: string
  skillId: string
  value: boolean
}

export interface IdentityInput {
  id: string
  displayName: string
}

export interface MarketUserItem extends IdentityInput {
  firstSeenAt: string
  lastSeenAt: string
}

export interface SessionInput extends IdentityInput {
  hash: string
  csrfHash: string
  idleExpiresAt: string
  absoluteExpiresAt: string
}

export interface SessionLookup {
  hash: string
  now: string
  idleExpiresAt: string
}

export interface SessionItem {
  user: MarketUserItem
  csrfHash: string
  idleExpiresAt: string
  absoluteExpiresAt: string
}

export interface InstallationInput {
  userId: string
  displayName: string
  clientId: string
  skillId: string
  revision: number
  sha256: string
  scope: "global" | "project"
  workspaceId?: string
  status: "installed" | "updating" | "removed" | "local-unmanaged"
}

export interface InstallIntentInput {
  hash: string
  userId: string
  skillId: string
  revision: number
  sha256: string
  expiresAt: string
}

export interface InstallIntentLookup {
  hash: string
  userId: string
  now: string
}

export interface InstallIntentItem {
  skillId: string
  revision: number
  sha256: string
}

export type InstallIntentResult =
  | { state: "ok"; item: InstallIntentItem }
  | { state: "expired" | "replayed" | "missing" }

export interface PublicationInput {
  id: string
  ownerId: string
  ownerName: string
  skillId?: string
  status: string
  stage: string
  snapshotPath: string
  snapshotSha256: string
}

export interface PublicationStart {
  id: string
  ownerId: string
  ownerName: string
  idempotencyKey: string
  archive: Uint8Array
}

export interface PublicationLookup {
  id: string
  ownerId: string
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

export interface PublicationReport {
  valid: boolean
  stage: "format" | "deterministic" | "security" | "semantic" | "complete"
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
    riskLevel: "none" | "medium" | "critical"
  }>
  sourceSha256: string
  snapshotSha256: string
  changed: boolean
  policyVersion?: string
  risk: {
    level: "none" | "medium" | "critical"
    issueCount: number
    policyVersion: string
  }
}

export interface PublicationItem {
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
  report?: PublicationReport
  patches: PublicationPatch[]
  release?: ReleaseItem
  createdAt: string
  updatedAt: string
}

export interface PublicationPatchesInput extends PublicationLookup {
  patches: PublicationPatch[]
}

export interface PublicationApplyInput extends PublicationLookup {
  patchIds: string[]
}

export interface UnpublishInput {
  id: string
  ownerId: string
  ownerName: string
  skillId: string
}

export interface UndoPublicationInput {
  id: string
  ownerId: string
  ownerName: string
  runId: string
  idempotencyKey: string
}

export interface EventInput {
  id: string
  name: string
  surface: "web" | "vscode"
  userId: string
  clientId: string
  skillId?: string
  revision?: number
  occurredAt: string
  context?: Record<string, string | number | boolean>
}

export interface DailyMetric {
  date: string
  name: string
  skillId?: string
  count: number
}

export interface RetentionResult {
  rawDeleted: number
  metricsDeleted: number
  metrics: DailyMetric[]
}
