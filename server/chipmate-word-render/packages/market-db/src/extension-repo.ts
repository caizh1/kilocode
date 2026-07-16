import { rmSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import type {
  ExtensionAnalyticsItem,
  ExtensionArtifactInput,
  ExtensionArtifactItem,
  ExtensionDetailItem,
  ExtensionDownloadInput,
  ExtensionFavoriteInput,
  ExtensionManifest,
  ExtensionPublicationInput,
  ExtensionPublicationItem,
  ExtensionReviewInput,
  ExtensionReviewItem,
  ExtensionSearchInput,
  ExtensionSummaryItem,
} from "./model.ts"

interface ExtensionRow {
  id: string
  publisher: string
  name: string
  display_name: string
  description: string
  categories_json: string
  keywords_json: string
  engine_vscode: string
  latest_version: string
  latest_artifact_id: string | null
  icon_data: string | null
  readme: string
  system_plugin: number
  status: string
  download_count: number
  favorite_count: number
  rating_total: number
  rating_count: number
  updated_at: string
}

interface ArtifactRow {
  id: string
  extension_id: string
  version: string
  target: string
  sha256: string
  size_bytes: number
  path: string
  filename: string
  uploader_id: string | null
  uploader_name: string
  manifest_json: string
  prerelease: number
  status: "published" | "removed"
  download_count: number
  published_at: string
  source: "system" | "web"
}

interface PublicationRow {
  id: string
  owner_id: string
  artifact_id: string | null
  status: ExtensionPublicationItem["status"]
  stage: string
  filename: string
  total_bytes: number
  sha256: string | null
  error: string | null
  idempotency_key: string
  created_at: string
  updated_at: string
}

interface ReviewRow {
  user_id: string
  user_name: string
  extension_id: string
  artifact_id: string | null
  rating: number
  comment: string
  created_at: string
  updated_at: string
}

export class ExtensionRepo {
  private pruned = ""

  constructor(private readonly db: DatabaseSync) {}

  search(input: ExtensionSearchInput = {}): ExtensionSummaryItem[] {
    const rows = this.db
      .prepare("SELECT * FROM extensions WHERE status='published'")
      .all() as unknown as ExtensionRow[]
    const query = input.q?.trim().toLocaleLowerCase()
    const items = rows
      .map((row) => this.summary(row))
      .filter((item) => {
        if (query) {
          const text = [item.id, item.displayName, item.description, ...item.categories, ...item.keywords]
            .join(" ")
            .toLocaleLowerCase()
          if (!text.includes(query)) return false
        }
        if (input.category && !item.categories.includes(input.category)) return false
        if (input.target && !item.targets.includes(input.target)) return false
        if (input.uploader) {
          const hit = this.db
            .prepare(
              "SELECT 1 FROM extension_artifacts WHERE extension_id=? AND status='published' AND uploader_name=? LIMIT 1",
            )
            .get(item.id, input.uploader)
          if (!hit) return false
        }
        return true
      })
    const sort = input.sort ?? "downloads"
    items.sort((a, b) => {
      if (sort === "rating") return b.rating - a.rating || b.ratingCount - a.ratingCount
      if (sort === "favorites") return b.favorites - a.favorites
      if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt)
      if (sort === "name") return a.displayName.localeCompare(b.displayName)
      return b.downloads - a.downloads || b.updatedAt.localeCompare(a.updatedAt)
    })
    const offset = Math.max(0, input.offset ?? 0)
    const limit = Math.max(1, Math.min(100, input.limit ?? 20))
    return items.slice(offset, offset + limit)
  }

  get(id: string): ExtensionDetailItem | undefined {
    const row = this.db
      .prepare("SELECT * FROM extensions WHERE id=? AND status='published'")
      .get(id) as unknown as ExtensionRow | undefined
    if (!row) return undefined
    const artifacts = this.artifacts(id)
    const latest = artifacts.find((item) => item.id === row.latest_artifact_id)
    return {
      ...this.summary(row),
      readme: row.readme,
      dependencies: latest?.manifest.dependencies ?? [],
      artifacts,
      versions: [...new Set(artifacts.map((item) => item.version))].sort(compare).reverse(),
    }
  }

  artifact(id: string): ExtensionArtifactItem | undefined {
    const row = this.artifactRow("a.id=?", id)
    return row ? this.item(row) : undefined
  }

  artifactBySha(sha256: string): ExtensionArtifactItem | undefined {
    const row = this.artifactRow("a.sha256=? AND a.status='published'", sha256)
    return row ? this.item(row) : undefined
  }

  artifacts(id: string): ExtensionArtifactItem[] {
    const rows = this.db
      .prepare(
        `SELECT a.*,
          CASE WHEN EXISTS(SELECT 1 FROM extension_sources s WHERE s.artifact_id=a.id AND s.active=1 AND s.kind='system')
            THEN 'system' ELSE 'web' END AS source
         FROM extension_artifacts a
         WHERE a.extension_id=? AND a.status='published'
         ORDER BY a.published_at ASC`,
      )
      .all(id) as unknown as ArtifactRow[]
    return rows.map((row) => this.item(row))
  }

  publish(input: ExtensionArtifactInput): { artifact: ExtensionArtifactItem; duplicate: boolean } {
    const duplicate = this.artifactBySha(input.sha256)
    if (duplicate) {
      if (input.sourceKind === "system") this.source(input.sourceKey, duplicate.id, input.sourceKind, input.publishedAt)
      return { artifact: duplicate, duplicate: true }
    }
    const removed = this.artifactRow("a.sha256=?", input.sha256)
    if (removed) {
      this.db
        .prepare(
          `UPDATE extension_artifacts
           SET path=?,filename=?,uploader_id=?,uploader_name=?,manifest_json=?,status='published',removed_at=NULL,
             removed_by=NULL,removal_reason=NULL,published_at=? WHERE id=?`,
        )
        .run(
          input.path,
          input.filename,
          input.uploaderId ?? null,
          input.uploaderName,
          JSON.stringify(input.manifest),
          input.publishedAt,
          removed.id,
        )
      this.source(input.sourceKey, removed.id, input.sourceKind, input.publishedAt)
      this.recompute(input.manifest.id, input.publishedAt)
      return { artifact: this.artifact(removed.id)!, duplicate: false }
    }
    const current = this.db.prepare("SELECT id FROM extensions WHERE id=?").get(input.manifest.id)
    if (!current) {
      this.db
        .prepare(
          `INSERT INTO extensions(
            id,publisher,name,display_name,description,categories_json,keywords_json,engine_vscode,latest_version,
            latest_artifact_id,icon_data,readme,system_plugin,status,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?,'published',?,?)`,
        )
        .run(
          input.manifest.id,
          input.manifest.publisher,
          input.manifest.name,
          input.manifest.displayName,
          input.manifest.description,
          JSON.stringify(input.manifest.categories),
          JSON.stringify(input.manifest.keywords),
          input.manifest.engineVscode,
          input.manifest.version,
          input.id,
          input.manifest.iconData ?? null,
          input.manifest.readme,
          input.manifest.systemPlugin ? 1 : 0,
          input.publishedAt,
          input.publishedAt,
        )
    }
    this.db
      .prepare(
        `INSERT INTO extension_artifacts(
          id,extension_id,version,target,sha256,size_bytes,path,filename,uploader_id,uploader_name,manifest_json,
          prerelease,status,published_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'published',?)`,
      )
      .run(
        input.id,
        input.manifest.id,
        input.manifest.version,
        input.manifest.target,
        input.sha256,
        input.size,
        input.path,
        input.filename,
        input.uploaderId ?? null,
        input.uploaderName,
        JSON.stringify(input.manifest),
        input.manifest.prerelease ? 1 : 0,
        input.publishedAt,
      )
    this.source(input.sourceKey, input.id, input.sourceKind, input.publishedAt)
    this.recompute(input.manifest.id, input.publishedAt)
    this.audit(input.uploaderId, "extension.publish", input.manifest.id, input.id, { source: input.sourceKind })
    return { artifact: this.artifact(input.id)!, duplicate: false }
  }

  touchSource(key: string, stamp: string): boolean {
    const result = this.db
      .prepare("UPDATE extension_sources SET active=1,last_seen_at=? WHERE source_key=?")
      .run(stamp, key)
    return Number(result.changes) > 0
  }

  systemSources(): Array<{ key: string; artifactId: string; path: string }> {
    return this.db
      .prepare(
        `SELECT s.source_key AS key,s.artifact_id AS artifactId,a.path
         FROM extension_sources s JOIN extension_artifacts a ON a.id=s.artifact_id
         WHERE s.kind='system' AND s.active=1`,
      )
      .all() as unknown as Array<{ key: string; artifactId: string; path: string }>
  }

  unlistSource(key: string, stamp: string): ExtensionArtifactItem | undefined {
    const row = this.db
      .prepare("SELECT artifact_id FROM extension_sources WHERE source_key=? AND active=1")
      .get(key) as unknown as { artifact_id: string } | undefined
    if (!row) return undefined
    this.db.prepare("UPDATE extension_sources SET active=0,last_seen_at=? WHERE source_key=?").run(stamp, key)
    const active = this.db
      .prepare("SELECT 1 FROM extension_sources WHERE artifact_id=? AND active=1 LIMIT 1")
      .get(row.artifact_id)
    if (active) return this.artifact(row.artifact_id)
    const item = this.artifact(row.artifact_id)
    if (!item) return undefined
    this.db
      .prepare(
        "UPDATE extension_artifacts SET status='removed',removed_at=?,removed_by='system',removal_reason='drop-deleted' WHERE id=?",
      )
      .run(stamp, row.artifact_id)
    this.recompute(item.extensionId, stamp)
    this.audit(undefined, "extension.system-unlist", item.extensionId, item.id, { sourceKey: key })
    return item
  }

  remove(id: string, userId: string, stamp: string): ExtensionArtifactItem {
    const item = this.artifact(id)
    if (!item) throw new Error("NOT_FOUND")
    if (!item.uploaderId || item.uploaderId !== userId) throw new Error("OWNERSHIP_REQUIRED")
    this.db.prepare("UPDATE extension_sources SET active=0,last_seen_at=? WHERE artifact_id=?").run(stamp, id)
    this.db
      .prepare(
        "UPDATE extension_artifacts SET status='removed',removed_at=?,removed_by=?,removal_reason='uploader-request' WHERE id=?",
      )
      .run(stamp, userId, id)
    rmSync(item.path, { force: true })
    this.recompute(item.extensionId, stamp)
    this.audit(userId, "extension.remove", item.extensionId, item.id, { sha256: item.sha256 })
    return { ...item, status: "removed" }
  }

  publication(input: ExtensionPublicationInput): ExtensionPublicationItem {
    const now = new Date().toISOString()
    const current = this.db
      .prepare("SELECT id FROM extension_publication_runs WHERE owner_id=? AND idempotency_key=?")
      .get(input.ownerId, input.idempotencyKey) as unknown as { id: string } | undefined
    if (current && current.id !== input.id) throw new Error("IDEMPOTENCY_CONFLICT")
    this.db
      .prepare(
        `INSERT INTO extension_publication_runs(
          id,owner_id,artifact_id,status,stage,filename,total_bytes,sha256,error,idempotency_key,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET artifact_id=excluded.artifact_id,status=excluded.status,stage=excluded.stage,
          total_bytes=excluded.total_bytes,sha256=excluded.sha256,error=excluded.error,updated_at=excluded.updated_at`,
      )
      .run(
        input.id,
        input.ownerId,
        input.artifactId ?? null,
        input.status,
        input.stage,
        input.filename,
        input.totalBytes,
        input.sha256 ?? null,
        input.error ?? null,
        input.idempotencyKey,
        now,
        now,
      )
    return this.getPublication(input.id, input.ownerId)!
  }

  getPublication(id: string, ownerId: string): ExtensionPublicationItem | undefined {
    const row = this.db
      .prepare("SELECT * FROM extension_publication_runs WHERE id=? AND owner_id=?")
      .get(id, ownerId) as unknown as PublicationRow | undefined
    return row ? publication(row) : undefined
  }

  publications(ownerId: string): ExtensionPublicationItem[] {
    const rows = this.db
      .prepare("SELECT * FROM extension_publication_runs WHERE owner_id=? ORDER BY created_at DESC")
      .all(ownerId) as unknown as PublicationRow[]
    return rows.map(publication)
  }

  uploadCount(ownerId: string, since: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM extension_publication_runs WHERE owner_id=? AND created_at>=?")
      .get(ownerId, since) as unknown as { count: number }
    return row.count
  }

  favorite(input: ExtensionFavoriteInput): { extensionId: string; favorite: boolean; changedAt: string } {
    const now = new Date().toISOString()
    if (input.value) {
      const result = this.db
        .prepare("INSERT OR IGNORE INTO extension_favorites(user_id,extension_id,created_at) VALUES(?,?,?)")
        .run(input.userId, input.extensionId, now)
      if (Number(result.changes) > 0) {
        this.db
          .prepare(
            `INSERT INTO extension_daily_metrics(date,metric,extension_id,artifact_id,source,count)
             VALUES(?,'favorite',?,'','',1)
             ON CONFLICT(date,metric,extension_id,artifact_id,source) DO UPDATE SET count=count+1`,
          )
          .run(now.slice(0, 10), input.extensionId)
      }
    } else {
      this.db
        .prepare("DELETE FROM extension_favorites WHERE user_id=? AND extension_id=?")
        .run(input.userId, input.extensionId)
    }
    return { extensionId: input.extensionId, favorite: input.value, changedAt: now }
  }

  favorites(userId: string): ExtensionSummaryItem[] {
    const rows = this.db
      .prepare(
        `SELECT e.* FROM extensions e JOIN extension_favorites f ON f.extension_id=e.id
         WHERE f.user_id=? AND e.status='published' ORDER BY f.created_at DESC`,
      )
      .all(userId) as unknown as ExtensionRow[]
    return rows.map((row) => this.summary(row))
  }

  reviews(id: string): ExtensionReviewItem[] {
    const rows = this.db
      .prepare(
        `SELECT r.*,u.display_name AS user_name FROM extension_reviews r JOIN users u ON u.id=r.user_id
         WHERE r.extension_id=? ORDER BY r.updated_at DESC`,
      )
      .all(id) as unknown as ReviewRow[]
    return rows.map(review)
  }

  review(input: ExtensionReviewInput): ExtensionReviewItem {
    const now = new Date().toISOString()
    if (input.artifactId) {
      const item = this.artifact(input.artifactId)
      if (!item || item.extensionId !== input.extensionId) throw new Error("ARTIFACT_MISMATCH")
    }
    this.db
      .prepare(
        `INSERT INTO extension_reviews(user_id,extension_id,artifact_id,rating,comment,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(user_id,extension_id) DO UPDATE SET artifact_id=excluded.artifact_id,rating=excluded.rating,
           comment=excluded.comment,updated_at=excluded.updated_at`,
      )
      .run(
        input.userId,
        input.extensionId,
        input.artifactId ?? null,
        input.rating,
        input.comment,
        now,
        now,
      )
    return this.reviews(input.extensionId).find((item) => item.userId === input.userId)!
  }

  deleteReview(userId: string, extensionId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM extension_reviews WHERE user_id=? AND extension_id=?")
      .run(userId, extensionId)
    return Number(result.changes) > 0
  }

  userReviews(userId: string): ExtensionReviewItem[] {
    const rows = this.db
      .prepare(
        `SELECT r.*,u.display_name AS user_name FROM extension_reviews r JOIN users u ON u.id=r.user_id
         WHERE r.user_id=? ORDER BY r.updated_at DESC`,
      )
      .all(userId) as unknown as ReviewRow[]
    return rows.map(review)
  }

  uploads(userId: string): ExtensionArtifactItem[] {
    const rows = this.db
      .prepare(
        `SELECT a.*,'web' AS source FROM extension_artifacts a
         WHERE a.uploader_id=? ORDER BY a.published_at DESC`,
      )
      .all(userId) as unknown as ArtifactRow[]
    return rows.map((row) => this.item(row))
  }

  download(input: ExtensionDownloadInput): void {
    this.prune(input.occurredAt)
    const item = this.artifact(input.artifactId)
    if (!item) return
    const date = input.occurredAt.slice(0, 10)
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const inserted = this.db
        .prepare("INSERT OR IGNORE INTO extension_download_events(id,extension_id,artifact_id,source,occurred_at) VALUES(?,?,?,?,?)")
        .run(input.id, item.extensionId, item.id, input.source, input.occurredAt)
      if (Number(inserted.changes) === 0) {
        this.db.exec("COMMIT")
        return
      }
      this.db.prepare("UPDATE extension_artifacts SET download_count=download_count+1 WHERE id=?").run(item.id)
      this.db.prepare("UPDATE extensions SET download_count=download_count+1 WHERE id=?").run(item.extensionId)
      this.db
        .prepare(
          `INSERT INTO extension_daily_metrics(date,metric,extension_id,artifact_id,source,count)
           VALUES(?,'download',?,?,?,1)
           ON CONFLICT(date,metric,extension_id,artifact_id,source) DO UPDATE SET count=count+1`,
        )
        .run(date, item.extensionId, item.id, input.source)
      this.db.exec("COMMIT")
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
  }

  analytics(): ExtensionAnalyticsItem {
    this.prune(new Date().toISOString())
    const totals = this.db
      .prepare(
        `SELECT COALESCE(SUM(download_count),0) AS downloads,COALESCE(SUM(favorite_count),0) AS favorites,
          COALESCE(SUM(rating_total),0) AS rating_total,COALESCE(SUM(rating_count),0) AS rating_count,
          COUNT(*) AS active FROM extensions WHERE status='published'`,
      )
      .get() as unknown as {
      downloads: number
      favorites: number
      rating_total: number
      rating_count: number
      active: number
    }
    const trend = this.db
      .prepare(
        `SELECT date,SUM(CASE WHEN metric='download' THEN count ELSE 0 END) AS downloads,0 AS favorites
         FROM extension_daily_metrics WHERE date>=date('now','-89 days') GROUP BY date ORDER BY date`,
      )
      .all() as unknown as Array<{ date: string; downloads: number; favorites: number }>
    const downloads = this.db
      .prepare(
        "SELECT id,display_name AS name,download_count AS value FROM extensions WHERE status='published' ORDER BY value DESC LIMIT 10",
      )
      .all() as unknown as Array<{ id: string; name: string; value: number }>
    const ratings = this.db
      .prepare(
        `SELECT id,display_name AS name,CASE WHEN rating_count=0 THEN 0 ELSE CAST(rating_total AS REAL)/rating_count END AS value
         FROM extensions WHERE status='published' ORDER BY value DESC,rating_count DESC LIMIT 10`,
      )
      .all() as unknown as Array<{ id: string; name: string; value: number }>
    const targets = this.db
      .prepare(
        "SELECT target,COUNT(*) AS value FROM extension_artifacts WHERE status='published' GROUP BY target ORDER BY value DESC",
      )
      .all() as unknown as Array<{ target: string; value: number }>
    const windows = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN date>=date('now','-29 days') THEN count ELSE 0 END),0) AS current,
          COALESCE(SUM(CASE WHEN date BETWEEN date('now','-59 days') AND date('now','-30 days') THEN count ELSE 0 END),0) AS previous
         FROM extension_daily_metrics WHERE metric='download'`,
      )
      .get() as unknown as { current: number; previous: number }
    const activity = this.db
      .prepare(
        `SELECT 'publish' AS type,a.extension_id AS extensionId,e.display_name AS name,a.published_at AS at
         FROM extension_artifacts a JOIN extensions e ON e.id=a.extension_id
         WHERE a.status='published' ORDER BY a.published_at DESC LIMIT 12`,
      )
      .all() as unknown as ExtensionAnalyticsItem["activity"]
    return {
      totals: {
        downloads: totals.downloads,
        favorites: totals.favorites,
        rating: totals.rating_count ? totals.rating_total / totals.rating_count : 0,
        active: totals.active,
        growth30d: windows.previous
          ? ((windows.current - windows.previous) / windows.previous) * 100
          : windows.current
            ? 100
            : 0,
      },
      trend,
      downloads,
      ratings,
      targets,
      activity,
    }
  }

  sources(artifactId: string, userId: string): Array<{ source: string; value: number }> {
    const item = this.artifact(artifactId)
    if (!item) throw new Error("NOT_FOUND")
    if (!item.uploaderId || item.uploaderId !== userId) throw new Error("OWNERSHIP_REQUIRED")
    return this.db
      .prepare(
        `SELECT source,SUM(count) AS value FROM extension_daily_metrics
         WHERE metric='download' AND artifact_id=? GROUP BY source ORDER BY value DESC`,
      )
      .all(artifactId) as unknown as Array<{ source: string; value: number }>
  }

  private summary(row: ExtensionRow): ExtensionSummaryItem {
    const artifacts = this.artifacts(row.id)
    const latest = artifacts.find((item) => item.id === row.latest_artifact_id)
    return {
      id: row.id,
      publisher: row.publisher,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      version: row.latest_version,
      engineVscode: row.engine_vscode,
      categories: JSON.parse(row.categories_json) as string[],
      keywords: JSON.parse(row.keywords_json) as string[],
      targets: [...new Set(artifacts.map((item) => item.target))].sort(),
      uploader: latest?.uploaderName ?? "系统导入",
      ...(row.icon_data ? { iconData: row.icon_data } : {}),
      systemPlugin: row.system_plugin === 1,
      prerelease: latest?.prerelease ?? false,
      downloads: row.download_count,
      favorites: row.favorite_count,
      rating: row.rating_count ? row.rating_total / row.rating_count : 0,
      ratingCount: row.rating_count,
      updatedAt: row.updated_at,
    }
  }

  private artifactRow(where: string, value: string): ArtifactRow | undefined {
    return this.db
      .prepare(
        `SELECT a.*,
          CASE WHEN EXISTS(SELECT 1 FROM extension_sources s WHERE s.artifact_id=a.id AND s.active=1 AND s.kind='system')
            THEN 'system' ELSE 'web' END AS source
         FROM extension_artifacts a WHERE ${where} LIMIT 1`,
      )
      .get(value) as unknown as ArtifactRow | undefined
  }

  private item(row: ArtifactRow): ExtensionArtifactItem {
    const count = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM extension_artifacts
         WHERE extension_id=? AND version=? AND target=? AND status='published'`,
      )
      .get(row.extension_id, row.version, row.target) as unknown as { count: number }
    return artifact(row, count.count > 1)
  }

  private source(key: string, artifactId: string, kind: "system" | "web", stamp: string): void {
    this.db
      .prepare(
        `INSERT INTO extension_sources(source_key,artifact_id,kind,active,first_seen_at,last_seen_at)
         VALUES(?,?,?,1,?,?)
         ON CONFLICT(source_key) DO UPDATE SET artifact_id=excluded.artifact_id,kind=excluded.kind,active=1,
           last_seen_at=excluded.last_seen_at`,
      )
      .run(key, artifactId, kind, stamp, stamp)
  }

  private recompute(id: string, stamp: string): void {
    const artifacts = this.artifacts(id)
    if (artifacts.length === 0) {
      this.db.prepare("UPDATE extensions SET status='unlisted',latest_artifact_id=NULL,updated_at=? WHERE id=?").run(stamp, id)
      return
    }
    const versions = [...new Set(artifacts.map((item) => item.version))].sort(compare).reverse()
    const latest = artifacts.find((item) => item.version === versions[0])!
    const meta = latest.manifest
    this.db
      .prepare(
        `UPDATE extensions SET publisher=?,name=?,display_name=?,description=?,categories_json=?,keywords_json=?,
          engine_vscode=?,latest_version=?,latest_artifact_id=?,icon_data=?,readme=?,system_plugin=?,status='published',updated_at=?
         WHERE id=?`,
      )
      .run(
        meta.publisher,
        meta.name,
        meta.displayName,
        meta.description,
        JSON.stringify(meta.categories),
        JSON.stringify(meta.keywords),
        meta.engineVscode,
        meta.version,
        latest.id,
        meta.iconData ?? null,
        meta.readme,
        meta.systemPlugin ? 1 : 0,
        stamp,
        id,
      )
  }

  private audit(
    userId: string | undefined,
    action: string,
    extensionId: string,
    artifactId: string,
    details: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        "INSERT INTO extension_audit_events(user_id,action,extension_id,artifact_id,details_json,occurred_at) VALUES(?,?,?,?,?,?)",
      )
      .run(userId ?? null, action, extensionId, artifactId, JSON.stringify(details), new Date().toISOString())
  }

  private prune(stamp: string): void {
    const date = stamp.slice(0, 10)
    if (this.pruned === date) return
    this.db.prepare("DELETE FROM extension_download_events WHERE occurred_at<datetime(?,'-90 days')").run(stamp)
    this.db.prepare("DELETE FROM extension_daily_metrics WHERE date<date(?,'-1 year')").run(date)
    this.pruned = date
  }
}

function artifact(row: ArtifactRow, conflict: boolean): ExtensionArtifactItem {
  return {
    id: row.id,
    extensionId: row.extension_id,
    version: row.version,
    target: row.target,
    sha256: row.sha256,
    size: row.size_bytes,
    path: row.path,
    filename: row.filename,
    ...(row.uploader_id ? { uploaderId: row.uploader_id } : {}),
    uploaderName: row.uploader_name,
    source: row.source,
    prerelease: row.prerelease === 1,
    conflict,
    downloads: row.download_count,
    publishedAt: row.published_at,
    status: row.status,
    manifest: JSON.parse(row.manifest_json) as ExtensionManifest,
  }
}

function publication(row: PublicationRow): ExtensionPublicationItem {
  return {
    id: row.id,
    ownerId: row.owner_id,
    filename: row.filename,
    totalBytes: row.total_bytes,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    stage: row.stage,
    ...(row.sha256 ? { sha256: row.sha256 } : {}),
    ...(row.artifact_id ? { artifactId: row.artifact_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function review(row: ReviewRow): ExtensionReviewItem {
  return {
    userId: row.user_id,
    userName: row.user_name,
    extensionId: row.extension_id,
    ...(row.artifact_id ? { artifactId: row.artifact_id } : {}),
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function compare(a: string, b: string): number {
  const parse = (value: string) => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
    if (!match) return { core: [0, 0, 0], pre: [value] }
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split(".") ?? [] }
  }
  const first = parse(a)
  const second = parse(b)
  for (let index = 0; index < 3; index += 1) {
    const diff = (first.core[index] ?? 0) - (second.core[index] ?? 0)
    if (diff) return diff
  }
  if (first.pre.length === 0 && second.pre.length > 0) return 1
  if (first.pre.length > 0 && second.pre.length === 0) return -1
  const size = Math.max(first.pre.length, second.pre.length)
  for (let index = 0; index < size; index += 1) {
    const left = first.pre[index]
    const right = second.pre[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    const ln = /^\d+$/.test(left)
    const rn = /^\d+$/.test(right)
    if (ln && rn) return Number(left) - Number(right)
    if (ln !== rn) return ln ? -1 : 1
    return left.localeCompare(right)
  }
  return 0
}
