import { Type, type Static, type TSchema } from "@sinclair/typebox"

const dt = Type.String({ format: "date-time" })
const sha = Type.String({ pattern: "^[a-f0-9]{64}$" })
const id = Type.String({ minLength: 1, maxLength: 128, pattern: "^[a-z0-9][a-z0-9._-]*$" })
const path = Type.String({ minLength: 1, maxLength: 1024 })

export const PUBLICATION_STATUSES = [
  "VALIDATING",
  "NEEDS_AUTHOR_FIX",
  "NEEDS_AI_CONFIRMATION",
  "SECURITY_REJECTED",
  "PUBLISHING",
  "PUBLISHED",
  "UNPUBLISHED",
  "UNDONE",
  "UNCHANGED",
  "FAILED",
] as const

export const PUBLICATION_LABELS = {
  VALIDATING: "草稿校验中",
  NEEDS_AUTHOR_FIX: "需要作者修复",
  NEEDS_AI_CONFIRMATION: "等待 AI 补丁确认",
  SECURITY_REJECTED: "安全扫描失败",
  PUBLISHING: "正在发布",
  PUBLISHED: "已发布",
  UNPUBLISHED: "已下架",
  UNDONE: "已撤销",
  UNCHANGED: "版本无变化",
  CAPABILITY_UNSUPPORTED: "服务器能力不支持",
} as const

export const MARKET_ERROR_CODES = [
  "CAPABILITY_UNSUPPORTED",
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "SESSION_EXPIRED",
  "STALE_PUBLICATION",
  "CSRF_INVALID",
  "ORIGIN_INVALID",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_FAILED",
  "SECURITY_REJECTED",
  "OWNERSHIP_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "INTENT_EXPIRED",
  "INTENT_REPLAYED",
  "HASH_MISMATCH",
  "ARCHIVE_UNSAFE",
  "RATE_LIMITED",
  "MARKET_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const

function literals<const T extends readonly string[]>(values: T) {
  return Type.Union(values.map((value) => Type.Literal(value)))
}

export const PublicationStatusSchema = literals(PUBLICATION_STATUSES)
export type PublicationStatus = Static<typeof PublicationStatusSchema>

export const MarketErrorCodeSchema = literals(MARKET_ERROR_CODES)
export type MarketErrorCode = Static<typeof MarketErrorCodeSchema>

export const SkillRiskLevelSchema = literals(["unknown", "none", "medium", "critical"] as const)
export type SkillRiskLevel = Static<typeof SkillRiskLevelSchema>

export const SkillRiskSummarySchema = Type.Object(
  {
    level: SkillRiskLevelSchema,
    issueCount: Type.Integer({ minimum: 0 }),
    policyVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { $id: "SkillRiskSummary", additionalProperties: false },
)
export type SkillRiskSummary = Static<typeof SkillRiskSummarySchema>

export const ValidationIssueSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    severity: literals(["info", "warning", "error"] as const),
    file: Type.Optional(path),
    line: Type.Optional(Type.Integer({ minimum: 1 })),
    field: Type.Optional(Type.String({ minLength: 1 })),
    message: Type.String({ minLength: 1 }),
    expected: Type.Optional(Type.String()),
    actual: Type.Optional(Type.String()),
    fixable: Type.Boolean(),
    repairKind: literals(["none", "deterministic", "ai"] as const),
    riskLevel: literals(["none", "medium", "critical"] as const),
  },
  { $id: "ValidationIssue", additionalProperties: false },
)
export type ValidationIssue = Static<typeof ValidationIssueSchema>

export const ValidationReportSchema = Type.Object(
  {
    valid: Type.Boolean(),
    stage: literals(["format", "deterministic", "security", "semantic", "complete"] as const),
    issues: Type.Array(Type.Ref(ValidationIssueSchema)),
    sourceSha256: sha,
    snapshotSha256: sha,
    changed: Type.Boolean(),
    policyVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    risk: Type.Ref(SkillRiskSummarySchema),
  },
  { $id: "ValidationReport", additionalProperties: false },
)
export type ValidationReport = Static<typeof ValidationReportSchema>

export const MarketCapabilitiesSchema = Type.Object(
  {
    mode: literals(["aligned-v1", "legacy"] as const),
    apiVersion: Type.String({ minLength: 1 }),
    catalogVersion: Type.String({ minLength: 1 }),
    skillSpecVersion: Type.Optional(Type.String({ minLength: 1 })),
    features: Type.Object(
      {
        versions: Type.Boolean(),
        favorites: Type.Boolean(),
        installations: Type.Boolean(),
        publications: Type.Boolean(),
        repairs: Type.Boolean(),
        analytics: Type.Boolean(),
        events: Type.Boolean(),
        extensions: Type.Optional(Type.Boolean()),
        extensionPublications: Type.Optional(Type.Boolean()),
        extensionReviews: Type.Optional(Type.Boolean()),
        extensionAnalytics: Type.Optional(Type.Boolean()),
        extensionDirectoryImport: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "MarketCapabilities", additionalProperties: false },
)
export type MarketCapabilities = Static<typeof MarketCapabilitiesSchema>

export const MarketUserSchema = Type.Object(
  {
    id: Type.String({ minLength: 16, maxLength: 128 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 }),
    firstSeenAt: dt,
    lastSeenAt: dt,
  },
  { $id: "MarketUser", additionalProperties: false },
)
export type MarketUser = Static<typeof MarketUserSchema>

export const FavoriteStateSchema = Type.Object(
  {
    skillId: id,
    favorite: Type.Boolean(),
    changedAt: dt,
  },
  { $id: "FavoriteState", additionalProperties: false },
)
export type FavoriteState = Static<typeof FavoriteStateSchema>

export const InstallationStateSchema = Type.Object(
  {
    skillId: id,
    revision: Type.Integer({ minimum: 1 }),
    sha256: sha,
    scope: literals(["global", "project"] as const),
    status: literals(["installed", "updating", "removed", "local-unmanaged"] as const),
    clientId: Type.String({ minLength: 16, maxLength: 128 }),
    workspaceId: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
    changedAt: dt,
  },
  { $id: "InstallationState", additionalProperties: false },
)
export type InstallationState = Static<typeof InstallationStateSchema>

export const SkillArtworkSchema = Type.Object(
  {
    type: literals(["icon", "cover", "screenshot"] as const),
    url: Type.String({ minLength: 1 }),
    mime: Type.String({ minLength: 1 }),
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    sha256: sha,
  },
  { $id: "SkillArtwork", additionalProperties: false },
)
export type SkillArtwork = Static<typeof SkillArtworkSchema>

export const SkillReleaseSchema = Type.Object(
  {
    skillId: id,
    revision: Type.Integer({ minimum: 1 }),
    semver: Type.Optional(
      Type.String({
        pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$",
      }),
    ),
    sha256: sha,
    archiveUrl: Type.String({ minLength: 1 }),
    notes: Type.Optional(Type.String({ maxLength: 4096 })),
    report: Type.Ref(ValidationReportSchema),
    publishedAt: dt,
  },
  { $id: "SkillRelease", additionalProperties: false },
)
export type SkillRelease = Static<typeof SkillReleaseSchema>

export const SkillFileSchema = Type.Object(
  {
    path,
    type: literals(["text", "image", "binary"] as const),
    mime: Type.String({ minLength: 1 }),
    size: Type.Integer({ minimum: 0 }),
    sha256: sha,
    previewable: Type.Boolean(),
  },
  { $id: "SkillFile", additionalProperties: false },
)
export type SkillFile = Static<typeof SkillFileSchema>

export const SkillSummarySchema = Type.Object(
  {
    id,
    name: Type.String({ minLength: 1, maxLength: 128 }),
    description: Type.String({ minLength: 1, maxLength: 2048 }),
    category: Type.String({ minLength: 1, maxLength: 128 }),
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 }),
    author: Type.Object(
      {
        id: Type.String({ minLength: 16, maxLength: 128 }),
        displayName: Type.String({ minLength: 1, maxLength: 128 }),
      },
      { additionalProperties: false },
    ),
    latestRevision: Type.Integer({ minimum: 1 }),
    semver: Type.Optional(Type.String()),
    sha256: sha,
    updatedAt: dt,
    downloads: Type.Integer({ minimum: 0 }),
    favorites: Type.Integer({ minimum: 0 }),
    favorite: Type.Optional(Type.Boolean()),
    installation: Type.Optional(Type.Ref(InstallationStateSchema)),
    artwork: Type.Optional(Type.Ref(SkillArtworkSchema)),
    risk: Type.Ref(SkillRiskSummarySchema),
  },
  { $id: "SkillSummary", additionalProperties: false },
)
export type SkillSummary = Static<typeof SkillSummarySchema>

export const SkillDetailSchema = Type.Intersect(
  [
    Type.Ref(SkillSummarySchema),
    Type.Object({
      markdown: Type.String(),
      releases: Type.Array(Type.Ref(SkillReleaseSchema)),
      files: Type.Array(Type.Ref(SkillFileSchema)),
      gallery: Type.Array(Type.Ref(SkillArtworkSchema)),
      related: Type.Array(Type.Ref(SkillSummarySchema)),
    }),
  ],
  { $id: "SkillDetail" },
)
export type SkillDetail = Static<typeof SkillDetailSchema>

const extensionId = Type.String({ minLength: 3, maxLength: 256, pattern: "^[a-z0-9][a-z0-9._-]+$" })
const semver = Type.String({
  pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$",
})

export const ExtensionArtifactSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    extensionId,
    version: semver,
    target: Type.String({ minLength: 1, maxLength: 64 }),
    sha256: sha,
    size: Type.Integer({ minimum: 1, maximum: 536870912 }),
    filename: Type.String({ minLength: 6, maxLength: 180 }),
    uploader: Type.Object(
      {
        id: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
        displayName: Type.String({ minLength: 1, maxLength: 128 }),
      },
      { additionalProperties: false },
    ),
    source: literals(["system", "web"] as const),
    prerelease: Type.Boolean(),
    conflict: Type.Boolean(),
    downloads: Type.Integer({ minimum: 0 }),
    publishedAt: dt,
    status: literals(["published", "removed"] as const),
    downloadUrl: Type.String({ minLength: 1 }),
  },
  { $id: "ExtensionArtifact", additionalProperties: false },
)
export type ExtensionArtifact = Static<typeof ExtensionArtifactSchema>

export const ExtensionSummarySchema = Type.Object(
  {
    id: extensionId,
    publisher: Type.String({ minLength: 1, maxLength: 128 }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    displayName: Type.String({ minLength: 1, maxLength: 256 }),
    description: Type.String({ minLength: 1, maxLength: 4096 }),
    version: semver,
    engineVscode: Type.String({ minLength: 1, maxLength: 128 }),
    categories: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 }),
    keywords: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 64 }),
    targets: Type.Array(Type.String({ minLength: 1, maxLength: 64 })),
    uploader: Type.String({ minLength: 1, maxLength: 128 }),
    iconData: Type.Optional(Type.String({ pattern: "^data:image/" })),
    systemPlugin: Type.Boolean(),
    prerelease: Type.Boolean(),
    downloads: Type.Integer({ minimum: 0 }),
    favorites: Type.Integer({ minimum: 0 }),
    rating: Type.Number({ minimum: 0, maximum: 5 }),
    ratingCount: Type.Integer({ minimum: 0 }),
    updatedAt: dt,
  },
  { $id: "ExtensionSummary", additionalProperties: false },
)
export type ExtensionSummary = Static<typeof ExtensionSummarySchema>

export const ExtensionDetailSchema = Type.Intersect(
  [
    Type.Ref(ExtensionSummarySchema),
    Type.Object({
      readme: Type.String(),
      dependencies: Type.Array(Type.String({ minLength: 1, maxLength: 256 })),
      artifacts: Type.Array(Type.Ref(ExtensionArtifactSchema)),
      versions: Type.Array(semver),
    }),
  ],
  { $id: "ExtensionDetail" },
)
export type ExtensionDetail = Static<typeof ExtensionDetailSchema>

export const ExtensionPublicationRunSchema = Type.Object(
  {
    id: Type.String({ minLength: 16, maxLength: 128 }),
    ownerId: Type.String({ minLength: 16, maxLength: 128 }),
    artifactId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    status: literals([
      "UPLOADING",
      "VALIDATING",
      "PUBLISHING",
      "PUBLISHED",
      "DUPLICATE",
      "CANCELLED",
      "FAILED",
    ] as const),
    stage: Type.String({ minLength: 1, maxLength: 32 }),
    filename: Type.String({ minLength: 6, maxLength: 180 }),
    totalBytes: Type.Integer({ minimum: 0, maximum: 536870912 }),
    sha256: Type.Optional(sha),
    error: Type.Optional(Type.String({ maxLength: 4096 })),
    idempotencyKey: Type.String({ minLength: 16, maxLength: 128 }),
    createdAt: dt,
    updatedAt: dt,
    artifact: Type.Optional(Type.Ref(ExtensionArtifactSchema)),
  },
  { $id: "ExtensionPublicationRun", additionalProperties: false },
)
export type ExtensionPublicationRun = Static<typeof ExtensionPublicationRunSchema>

export const ExtensionReviewSchema = Type.Object(
  {
    userId: Type.String({ minLength: 16, maxLength: 128 }),
    userName: Type.String({ minLength: 1, maxLength: 128 }),
    extensionId,
    artifactId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    rating: Type.Integer({ minimum: 1, maximum: 5 }),
    comment: Type.String({ maxLength: 2000 }),
    createdAt: dt,
    updatedAt: dt,
  },
  { $id: "ExtensionReview", additionalProperties: false },
)
export type ExtensionReview = Static<typeof ExtensionReviewSchema>

export const ExtensionAnalyticsSchema = Type.Object(
  {
    totals: Type.Object({
      downloads: Type.Integer({ minimum: 0 }),
      favorites: Type.Integer({ minimum: 0 }),
      rating: Type.Number({ minimum: 0, maximum: 5 }),
      active: Type.Integer({ minimum: 0 }),
      growth30d: Type.Number(),
    }),
    trend: Type.Array(
      Type.Object({
        date: Type.String({ format: "date" }),
        downloads: Type.Integer({ minimum: 0 }),
        favorites: Type.Integer({ minimum: 0 }),
      }),
    ),
    downloads: Type.Array(Type.Object({ id: extensionId, name: Type.String(), value: Type.Integer({ minimum: 0 }) })),
    ratings: Type.Array(
      Type.Object({ id: extensionId, name: Type.String(), value: Type.Number({ minimum: 0, maximum: 5 }) }),
    ),
    targets: Type.Array(Type.Object({ target: Type.String(), value: Type.Integer({ minimum: 0 }) })),
    activity: Type.Array(
      Type.Object({
        type: Type.Literal("publish"),
        extensionId,
        name: Type.String(),
        at: dt,
      }),
    ),
  },
  { $id: "ExtensionAnalytics", additionalProperties: false },
)
export type ExtensionAnalytics = Static<typeof ExtensionAnalyticsSchema>

export const ExtensionAnalyticsSeriesSchema = Type.Intersect([Type.Ref(ExtensionAnalyticsSchema)], {
  $id: "ExtensionAnalyticsSeries",
})
export type ExtensionAnalyticsSeries = Static<typeof ExtensionAnalyticsSeriesSchema>

export const RepairPatchSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    runId: Type.String({ minLength: 1 }),
    kind: literals(["deterministic", "ai"] as const),
    files: Type.Array(
      Type.Object(
        {
          path,
          beforeSha256: sha,
          afterSha256: sha,
          patch: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
    requiresConfirmation: Type.Boolean(),
    expiresAt: dt,
  },
  { $id: "RepairPatch", additionalProperties: false },
)
export type RepairPatch = Static<typeof RepairPatchSchema>

export const PublicationRunSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    skillId: Type.Optional(id),
    ownerId: Type.String({ minLength: 16, maxLength: 128 }),
    status: PublicationStatusSchema,
    stage: literals(["uploaded", "format", "deterministic", "security", "semantic", "publishing", "complete"] as const),
    report: Type.Optional(Type.Ref(ValidationReportSchema)),
    patches: Type.Array(Type.Ref(RepairPatchSchema)),
    release: Type.Optional(Type.Ref(SkillReleaseSchema)),
    createdAt: dt,
    updatedAt: dt,
  },
  { $id: "PublicationRun", additionalProperties: false },
)
export type PublicationRun = Static<typeof PublicationRunSchema>

export const AnalyticsEventSchema = Type.Object(
  {
    name: literals([
      "market_impression",
      "market_search",
      "market_filter",
      "skill_open",
      "skill_file_preview",
      "skill_favorite",
      "skill_install_intent",
      "skill_install",
      "skill_update",
      "skill_remove",
      "publication_start",
      "publication_validation_failed",
      "publication_ai_repair",
      "publication_success",
    ] as const),
    surface: literals(["web", "vscode"] as const),
    userId: Type.String({ minLength: 16, maxLength: 128 }),
    clientId: Type.String({ minLength: 16, maxLength: 128 }),
    skillId: Type.Optional(id),
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
    occurredAt: dt,
    context: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]))),
  },
  { $id: "AnalyticsEvent", additionalProperties: false },
)
export type AnalyticsEvent = Static<typeof AnalyticsEventSchema>

export const AnalyticsSeriesSchema = Type.Object(
  {
    metric: Type.String({ minLength: 1 }),
    scope: literals(["global", "author", "skill"] as const),
    points: Type.Array(
      Type.Object(
        {
          date: Type.String({ format: "date" }),
          value: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: "AnalyticsSeries", additionalProperties: false },
)
export type AnalyticsSeries = Static<typeof AnalyticsSeriesSchema>

export const ApiErrorSchema = Type.Object(
  {
    ok: Type.Literal(false),
    code: MarketErrorCodeSchema,
    message: Type.String({ minLength: 1 }),
    issues: Type.Optional(Type.Array(Type.Ref(ValidationIssueSchema))),
  },
  { $id: "ApiError", additionalProperties: false },
)
export type ApiError = Static<typeof ApiErrorSchema>

export const SCHEMAS = {
  AnalyticsEvent: AnalyticsEventSchema,
  AnalyticsSeries: AnalyticsSeriesSchema,
  ApiError: ApiErrorSchema,
  FavoriteState: FavoriteStateSchema,
  ExtensionAnalytics: ExtensionAnalyticsSchema,
  ExtensionAnalyticsSeries: ExtensionAnalyticsSeriesSchema,
  ExtensionArtifact: ExtensionArtifactSchema,
  ExtensionDetail: ExtensionDetailSchema,
  ExtensionPublicationRun: ExtensionPublicationRunSchema,
  ExtensionReview: ExtensionReviewSchema,
  ExtensionSummary: ExtensionSummarySchema,
  InstallationState: InstallationStateSchema,
  MarketCapabilities: MarketCapabilitiesSchema,
  MarketUser: MarketUserSchema,
  PublicationRun: PublicationRunSchema,
  PublicationStatus: PublicationStatusSchema,
  RepairPatch: RepairPatchSchema,
  SkillArtwork: SkillArtworkSchema,
  SkillDetail: SkillDetailSchema,
  SkillFile: SkillFileSchema,
  SkillRelease: SkillReleaseSchema,
  SkillRiskSummary: SkillRiskSummarySchema,
  SkillSummary: SkillSummarySchema,
  ValidationIssue: ValidationIssueSchema,
  ValidationReport: ValidationReportSchema,
} satisfies Record<string, TSchema>
