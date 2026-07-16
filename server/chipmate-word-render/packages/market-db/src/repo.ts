import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { gunzipSync } from "node:zlib"
import { applySkillPatches, validateSkillArchive, type SkillSnapshot } from "@chipmate/skill-spec"
import { ExtensionRepo } from "./extension-repo.ts"
import { MIGRATIONS } from "./migrations.ts"
import type {
  ArtworkItem,
  DailyMetric,
  AuthorItem,
  CategoryItem,
  EventInput,
  ExportResult,
  FavoriteInput,
  FileItem,
  FilePreview,
  IdentityInput,
  ImportResult,
  InstallIntentInput,
  InstallIntentItem,
  InstallIntentLookup,
  InstallIntentResult,
  InstallationInput,
  MarketDbHealth,
  MarketUserItem,
  PublicationInput,
  PublicationItem,
  PublicationLookup,
  PublicationPatchesInput,
  PublicationApplyInput,
  PublicationPatch,
  PublicationPatchFile,
  PublicationReport,
  PublicationStart,
  ReleaseItem,
  SearchInput,
  SearchItem,
  SessionInput,
  SessionItem,
  SessionLookup,
  UnpublishInput,
  ExtensionArtifactInput,
  ExtensionDownloadInput,
  ExtensionFavoriteInput,
  ExtensionPublicationInput,
  ExtensionReviewInput,
  ExtensionSearchInput,
} from "./model.ts"

interface LegacyItem {
  id?: unknown
  name?: unknown
  description?: unknown
  category?: unknown
  tags?: unknown
  author?: unknown
  uploadedBy?: unknown
  content?: unknown
  semver?: unknown
  version?: unknown
  updatedAt?: unknown
  downloadCount?: unknown
}

interface SearchRow {
  id: string
  name: string
  description: string
  category: string
  tags_json: string
  author_id: string
  author: string
  latest_revision: number
  semver: string | null
  sha256: string
  archive_path: string
  updated_at: string
  download_count: number
  favorite_count: number
  legacy_json: string
}

interface ReleaseRow {
  id: string
  name: string
  description: string
  category: string
  tags_json: string
  author: string
  revision: number
  semver: string | null
  sha256: string
  archive_path: string
  updated_at: string
  download_count: number
  favorite_count: number
  legacy_json: string
}

interface PublicationRow {
  id: string
  owner_id: string
  skill_id: string | null
  status: PublicationItem["status"]
  stage: PublicationItem["stage"]
  report_json: string | null
  patches_json: string
  result_revision: number | null
  created_at: string
  updated_at: string
  source_sha256: string
}

interface TarEntry {
  path: string
  data: Buffer
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export class MarketRepo {
  private readonly db: DatabaseSync
  private readonly dir: string
  private readonly extensions: ExtensionRepo

  constructor(dir: string) {
    this.dir = resolve(dir)
    mkdirSync(this.dir, { recursive: true })
    this.db = new DatabaseSync(join(this.dir, "market.sqlite"))
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
    this.db.prepare("PRAGMA journal_mode=WAL").get()
    this.migrate()
    this.extensions = new ExtensionRepo(this.db)
  }

  health(): MarketDbHealth {
    const version = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as unknown as { version: number }
    const journal = this.db.prepare("PRAGMA journal_mode").get() as unknown as { journal_mode: string }
    const foreign = this.db.prepare("PRAGMA foreign_keys").get() as unknown as { foreign_keys: number }
    const timeout = this.db.prepare("PRAGMA busy_timeout").get() as unknown as { timeout: number }
    return {
      available: true,
      schemaVersion: Number(version.version),
      journalMode: journal.journal_mode.toLowerCase() as "wal",
      foreignKeys: Boolean(foreign.foreign_keys) as true,
      busyTimeout: Number(timeout.timeout),
    }
  }

  importLegacy(root: string): ImportResult {
    const source = resolve(root)
    const file = join(source, "skills.json")
    const raw = readFileSync(file, "utf8")
    const parsed = JSON.parse(raw) as LegacyItem[] | { items?: LegacyItem[] }
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : []
    const result: ImportResult = { imported: 0, unchanged: 0, skipped: 0, revisions: [] }
    const copied: string[] = []
    const now = new Date().toISOString()

    this.db.exec("BEGIN IMMEDIATE")
    try {
      for (const item of items) {
        const key = String(item.id ?? "").trim()
        const archive = this.archive(source, key, item.content)
        if (!SAFE_ID.test(key) || !archive || !existsSync(archive)) {
          result.skipped += 1
          continue
        }
        const bytes = readFileSync(archive)
        const hash = sha(bytes)
        const current = this.db
          .prepare(
            "SELECT s.latest_revision AS revision, r.sha256 FROM skills s LEFT JOIN releases r ON r.skill_id=s.id AND r.revision=s.latest_revision WHERE s.id=?",
          )
          .get(key) as unknown as { revision: number; sha256: string | null } | undefined
        if (current?.sha256 === hash) {
          result.unchanged += 1
          continue
        }

        const author = String(item.uploadedBy ?? item.author ?? "legacy").trim() || "legacy"
        const authorId = `legacy-${sha(Buffer.from(author)).slice(0, 32)}`
        this.user(authorId, author, now)
        const name = String(item.name ?? key).trim() || key
        const description = String(item.description ?? "").trim()
        const category = String(item.category ?? "general").trim() || "general"
        const tags = Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : []
        const updated = validDate(item.updatedAt) ?? now
        const downloads = Math.max(0, Number(item.downloadCount ?? 0) || 0)
        this.db
          .prepare(
            `INSERT INTO skills(id,name,description,category,tags_json,author_id,status,latest_revision,download_count,created_at,updated_at,legacy_json)
             VALUES(?,?,?,?,?,?, 'published',0,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,tags_json=excluded.tags_json,author_id=excluded.author_id,download_count=MAX(skills.download_count,excluded.download_count),updated_at=excluded.updated_at,legacy_json=excluded.legacy_json`,
          )
          .run(
            key,
            name,
            description,
            category,
            JSON.stringify(tags),
            authorId,
            downloads,
            now,
            updated,
            JSON.stringify(item),
          )

        const revision = Number(current?.revision ?? 0) + 1
        const dir = join(this.dir, "releases", key)
        const target = join(dir, `${revision}.tar.gz`)
        mkdirSync(dir, { recursive: true })
        if (!existsSync(target)) {
          copyFileSync(archive, target)
          copied.push(target)
        }
        const semver = string(item.semver) ?? string(item.version)
        const report = JSON.stringify({ valid: true, stage: "complete", issues: [], source: "legacy-import" })
        this.db
          .prepare(
            "INSERT INTO releases(skill_id,revision,semver,sha256,size_bytes,notes,validation_report_json,archive_path,published_at,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            key,
            revision,
            semver ?? null,
            hash,
            statSync(target).size,
            null,
            report,
            target,
            updated,
            JSON.stringify(item),
          )
        this.db.prepare("UPDATE skills SET latest_revision=?,updated_at=? WHERE id=?").run(revision, updated, key)
        result.imported += 1
        result.revisions.push({ id: key, revision, sha256: hash })
      }
      this.db
        .prepare("INSERT OR IGNORE INTO imports(source_root,source_sha256,item_count,imported_at) VALUES(?,?,?,?)")
        .run(source, sha(Buffer.from(raw)), items.length, now)
      this.db.exec("COMMIT")
      return result
    } catch (err) {
      this.db.exec("ROLLBACK")
      for (const path of copied) rmSync(path, { force: true })
      throw err
    }
  }

  exportLegacy(root: string): ExportResult {
    const target = resolve(root)
    const stage = `${target}.staging-${process.pid}`
    const backup = `${target}.backup-${process.pid}`
    rmSync(stage, { recursive: true, force: true })
    rmSync(backup, { recursive: true, force: true })
    mkdirSync(join(stage, "skills"), { recursive: true })
    const rows = this.db
      .prepare(
        `SELECT s.id,s.name,s.description,s.category,s.tags_json,u.display_name AS author,s.latest_revision AS revision,r.semver,r.sha256,r.archive_path,s.updated_at,s.download_count,s.favorite_count,s.legacy_json
         FROM skills s JOIN users u ON u.id=s.author_id JOIN releases r ON r.skill_id=s.id AND r.revision=s.latest_revision
         WHERE s.status='published' ORDER BY s.id`,
      )
      .all() as unknown as ReleaseRow[]
    const items = rows.map((row) => {
      const filename = `${row.id}.tar.gz`
      copyFileSync(row.archive_path, join(stage, "skills", filename))
      return {
        ...parseObject(row.legacy_json),
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        tags: parseTags(row.tags_json),
        author: row.author,
        content: `skills/${filename}`,
        revision: row.revision,
        semver: row.semver || undefined,
        sha256: row.sha256,
        updatedAt: row.updated_at,
        downloadCount: row.download_count,
        stars: row.favorite_count,
      }
    })
    const catalog = `${JSON.stringify({ items }, null, 2)}\n`
    writeFileSync(join(stage, "skills.json"), catalog)
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(target)) renameSync(target, backup)
    try {
      renameSync(stage, target)
      rmSync(backup, { recursive: true, force: true })
    } catch (err) {
      if (existsSync(backup) && !existsSync(target)) renameSync(backup, target)
      rmSync(stage, { recursive: true, force: true })
      throw err
    }
    return { count: items.length, catalogVersion: sha(Buffer.from(catalog)), root: target }
  }

  search(input: SearchInput = {}): SearchItem[] {
    const terms = tokens(input.q)
    const values: SQLInputValue[] = []
    const where: string[] = ["s.status='published'"]
    const join = terms ? "JOIN skill_search f ON f.id=s.id" : ""
    if (terms) {
      where.push("skill_search MATCH ?")
      values.push(terms)
    }
    if (input.category) {
      where.push("s.category=?")
      values.push(input.category)
    }
    if (input.author) {
      where.push("(s.author_id=? OR u.display_name=?)")
      values.push(input.author, input.author)
    }
    if (input.updatedAfter) {
      where.push("s.updated_at>=?")
      values.push(input.updatedAfter)
    }
    const order = {
      downloads: "s.download_count DESC,s.updated_at DESC",
      favorites: "s.favorite_count DESC,s.updated_at DESC",
      name: "s.name COLLATE NOCASE ASC",
      updated: "s.updated_at DESC",
    }[input.sort ?? "updated"]
    const limit = Math.max(1, Math.min(100, input.limit ?? 20))
    const offset = Math.max(0, input.offset ?? 0)
    values.push(limit, offset)
    const rows = this.db
      .prepare(
        `SELECT s.id,s.name,s.description,s.category,s.tags_json,s.author_id,u.display_name AS author,s.latest_revision,r.semver,r.sha256,r.archive_path,s.updated_at,s.download_count,s.favorite_count,s.legacy_json
         FROM skills s ${join} JOIN users u ON u.id=s.author_id JOIN releases r ON r.skill_id=s.id AND r.revision=s.latest_revision
         WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...values) as unknown as SearchRow[]
    return rows.map(mapSearch)
  }

  get(id: string): SearchItem | undefined {
    const row = this.db
      .prepare(
        `SELECT s.id,s.name,s.description,s.category,s.tags_json,s.author_id,u.display_name AS author,s.latest_revision,r.semver,r.sha256,r.archive_path,s.updated_at,s.download_count,s.favorite_count,s.legacy_json
         FROM skills s JOIN users u ON u.id=s.author_id JOIN releases r ON r.skill_id=s.id AND r.revision=s.latest_revision
         WHERE s.id=? AND s.status='published'`,
      )
      .get(id) as unknown as SearchRow | undefined
    return row ? mapSearch(row) : undefined
  }

  version() {
    const rows = this.db
      .prepare("SELECT id,latest_revision,updated_at FROM skills WHERE status='published' ORDER BY id")
      .all() as unknown as Array<{ id: string; latest_revision: number; updated_at: string }>
    return sha(Buffer.from(JSON.stringify(rows)))
  }

  releases(id: string): ReleaseItem[] {
    const rows = this.db
      .prepare(
        "SELECT skill_id,revision,semver,sha256,size_bytes,notes,validation_report_json,archive_path,published_at FROM releases WHERE skill_id=? ORDER BY revision DESC",
      )
      .all(id) as unknown as Array<{
      skill_id: string
      revision: number
      semver: string | null
      sha256: string
      size_bytes: number
      notes: string | null
      validation_report_json: string
      archive_path: string
      published_at: string
    }>
    return rows.map((row) => ({
      skillId: row.skill_id,
      revision: Number(row.revision),
      ...(row.semver ? { semver: row.semver } : {}),
      sha256: row.sha256,
      size: Number(row.size_bytes),
      ...(row.notes ? { notes: row.notes } : {}),
      report: parseObject(row.validation_report_json),
      archivePath: row.archive_path,
      publishedAt: row.published_at,
    }))
  }

  release(id: string, revision?: number) {
    const releases = this.releases(id)
    return revision ? releases.find((release) => release.revision === revision) : releases[0]
  }

  categories(): CategoryItem[] {
    const rows = this.db
      .prepare(
        "SELECT category AS id,category AS name,COUNT(*) AS count FROM skills WHERE status='published' GROUP BY category ORDER BY count DESC,category",
      )
      .all() as unknown as Array<{ id: string; name: string; count: number }>
    return rows.map((row) => ({ id: row.id, name: row.name, count: Number(row.count) }))
  }

  author(id: string): AuthorItem | undefined {
    const user = this.db.prepare("SELECT id,display_name FROM users WHERE id=?").get(id) as unknown as
      | { id: string; display_name: string }
      | undefined
    if (!user) return undefined
    const skills = this.search({ author: id, limit: 100, sort: "updated" })
    return { id: user.id, displayName: user.display_name, skills }
  }

  files(id: string, revision?: number): FileItem[] {
    const release = this.release(id, revision)
    if (!release) return []
    return entries(release.archivePath).map(fileItem)
  }

  file(id: string, path: string, revision?: number): FilePreview | undefined {
    const release = this.release(id, revision)
    if (!release) return undefined
    const entry = entries(release.archivePath).find((item) => item.path === path)
    if (!entry) return undefined
    const file = fileItem(entry)
    if (!file.previewable || file.size > 1024 * 1024) return { file }
    if (file.type === "image") return { file, dataUrl: `data:${file.mime};base64,${entry.data.toString("base64")}` }
    return { file, text: entry.data.toString("utf8") }
  }

  identity(input: IdentityInput): MarketUserItem {
    const now = new Date().toISOString()
    this.user(input.id, input.displayName, now)
    return this.getUser(input.id)!
  }

  createSession(input: SessionInput): SessionItem {
    const now = new Date().toISOString()
    this.user(input.id, input.displayName, now)
    this.db
      .prepare(
        `INSERT INTO sessions(hash,user_id,idle_expires_at,absolute_expires_at,created_at,last_seen_at,csrf_hash)
         VALUES(?,?,?,?,?,?,?)`,
      )
      .run(input.hash, input.id, input.idleExpiresAt, input.absoluteExpiresAt, now, now, input.csrfHash)
    return {
      user: this.getUser(input.id)!,
      csrfHash: input.csrfHash,
      idleExpiresAt: input.idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
    }
  }

  getSession(input: SessionLookup): SessionItem | undefined {
    this.db.prepare("DELETE FROM sessions WHERE idle_expires_at<=? OR absolute_expires_at<=?").run(input.now, input.now)
    const row = this.db
      .prepare(
        `SELECT s.user_id,s.csrf_hash,s.idle_expires_at,s.absolute_expires_at,u.display_name,u.first_seen_at
         FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=?`,
      )
      .get(input.hash) as unknown as
      | {
          user_id: string
          csrf_hash: string
          idle_expires_at: string
          absolute_expires_at: string
          display_name: string
          first_seen_at: string
        }
      | undefined
    if (!row) return undefined
    const idle = input.idleExpiresAt < row.absolute_expires_at ? input.idleExpiresAt : row.absolute_expires_at
    this.db
      .prepare("UPDATE sessions SET idle_expires_at=?,last_seen_at=? WHERE hash=?")
      .run(idle, input.now, input.hash)
    this.db.prepare("UPDATE users SET last_seen_at=? WHERE id=?").run(input.now, row.user_id)
    return {
      user: {
        id: row.user_id,
        displayName: row.display_name,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: input.now,
      },
      csrfHash: row.csrf_hash,
      idleExpiresAt: idle,
      absoluteExpiresAt: row.absolute_expires_at,
    }
  }

  deleteSession(hash: string) {
    return this.db.prepare("DELETE FROM sessions WHERE hash=?").run(hash).changes > 0
  }

  favorite(input: FavoriteInput) {
    const now = new Date().toISOString()
    this.user(input.userId, input.displayName, now)
    if (input.value) {
      this.db
        .prepare("INSERT OR IGNORE INTO favorites(user_id,skill_id,created_at) VALUES(?,?,?)")
        .run(input.userId, input.skillId, now)
    } else {
      this.db.prepare("DELETE FROM favorites WHERE user_id=? AND skill_id=?").run(input.userId, input.skillId)
    }
    return { skillId: input.skillId, favorite: input.value, changedAt: now }
  }

  favorites(userId: string): SearchItem[] {
    const rows = this.db
      .prepare(
        `SELECT s.id,s.name,s.description,s.category,s.tags_json,s.author_id,u.display_name AS author,s.latest_revision,r.semver,r.sha256,r.archive_path,s.updated_at,s.download_count,s.favorite_count,s.legacy_json
         FROM favorites x JOIN skills s ON s.id=x.skill_id JOIN users u ON u.id=s.author_id JOIN releases r ON r.skill_id=s.id AND r.revision=s.latest_revision
         WHERE x.user_id=? ORDER BY x.created_at DESC`,
      )
      .all(userId) as unknown as SearchRow[]
    return rows.map(mapSearch)
  }

  installation(input: InstallationInput) {
    const now = new Date().toISOString()
    const workspace = input.workspaceId ?? ""
    this.user(input.userId, input.displayName, now)
    this.db
      .prepare(
        `INSERT INTO installations(user_id,client_id,skill_id,scope,workspace_id,revision,sha256,status,changed_at)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id,client_id,skill_id,scope,workspace_id) DO UPDATE SET revision=excluded.revision,sha256=excluded.sha256,status=excluded.status,changed_at=excluded.changed_at`,
      )
      .run(
        input.userId,
        input.clientId,
        input.skillId,
        input.scope,
        workspace,
        input.revision,
        input.sha256,
        input.status,
        now,
      )
    return { ...input, workspaceId: workspace || undefined, changedAt: now }
  }

  installations(userId: string) {
    const rows = this.db
      .prepare(
        `SELECT user_id,client_id,skill_id,scope,workspace_id,revision,sha256,status,changed_at
         FROM installations WHERE user_id=? ORDER BY changed_at DESC`,
      )
      .all(userId) as unknown as Array<{
      user_id: string
      client_id: string
      skill_id: string
      scope: "global" | "project"
      workspace_id: string
      revision: number
      sha256: string
      status: InstallationInput["status"]
      changed_at: string
    }>
    return rows.map((row) => ({
      userId: row.user_id,
      displayName: this.getUser(row.user_id)?.displayName ?? row.user_id,
      clientId: row.client_id,
      skillId: row.skill_id,
      revision: Number(row.revision),
      sha256: row.sha256,
      scope: row.scope,
      ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
      status: row.status,
      changedAt: row.changed_at,
    }))
  }

  createIntent(input: InstallIntentInput): InstallIntentItem {
    const now = new Date().toISOString()
    this.db.prepare("DELETE FROM install_intents WHERE expires_at<=? OR consumed_at IS NOT NULL").run(now)
    this.db
      .prepare(
        `INSERT INTO install_intents(hash,user_id,skill_id,revision,sha256,expires_at,created_at)
         VALUES(?,?,?,?,?,?,?)`,
      )
      .run(input.hash, input.userId, input.skillId, input.revision, input.sha256, input.expiresAt, now)
    return { skillId: input.skillId, revision: input.revision, sha256: input.sha256 }
  }

  consumeIntent(input: InstallIntentLookup): InstallIntentResult {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const row = this.db
        .prepare(
          `SELECT skill_id,revision,sha256,expires_at,consumed_at FROM install_intents
           WHERE hash=? AND user_id=?`,
        )
        .get(input.hash, input.userId) as unknown as
        | { skill_id: string; revision: number; sha256: string; expires_at: string; consumed_at: string | null }
        | undefined
      if (!row) {
        this.db.exec("COMMIT")
        return { state: "missing" }
      }
      if (row.consumed_at) {
        this.db.exec("COMMIT")
        return { state: "replayed" }
      }
      if (row.expires_at <= input.now) {
        this.db.exec("COMMIT")
        return { state: "expired" }
      }
      this.db.prepare("UPDATE install_intents SET consumed_at=? WHERE hash=?").run(input.now, input.hash)
      this.db.exec("COMMIT")
      return {
        state: "ok",
        item: { skillId: row.skill_id, revision: Number(row.revision), sha256: row.sha256 },
      }
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
  }

  publication(input: PublicationInput) {
    const now = new Date().toISOString()
    this.user(input.ownerId, input.ownerName, now)
    this.db
      .prepare(
        `INSERT INTO publication_runs(id,owner_id,skill_id,status,stage,snapshot_path,snapshot_sha256,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.ownerId,
        input.skillId ?? null,
        input.status,
        input.stage,
        input.snapshotPath,
        input.snapshotSha256,
        now,
        now,
      )
    return { ...input, createdAt: now, updatedAt: now }
  }

  startPublication(input: PublicationStart): PublicationItem {
    const bytes = Buffer.from(input.archive)
    const source = sha(bytes)
    const existing = this.db
      .prepare("SELECT id,source_sha256 FROM publication_runs WHERE owner_id=? AND idempotency_key=?")
      .get(input.ownerId, input.idempotencyKey) as unknown as { id: string; source_sha256: string } | undefined
    if (existing) {
      if (existing.source_sha256 !== source) throw new Error("IDEMPOTENCY_CONFLICT")
      return this.publicationItem(existing.id)!
    }

    const snapshot = validateSkillArchive(bytes)
    const now = new Date().toISOString()
    const dir = join(this.dir, "publications", input.id)
    const path = join(dir, "snapshot.tar.gz")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, snapshot.archive)
    const report = publicationReport(snapshot)
    const patches = deterministicPatches(input.id, snapshot, now)
    const created: string[] = []

    this.db.exec("BEGIN IMMEDIATE")
    try {
      this.user(input.ownerId, input.ownerName, now)
      const result = snapshot.valid ? this.publishSnapshot(input.ownerId, snapshot, report, created) : undefined
      const status = result?.status ?? publicationFailure(snapshot)
      const stage = snapshot.valid ? "complete" : snapshot.stage
      this.db
        .prepare(
          `INSERT INTO publication_runs(id,owner_id,skill_id,status,stage,snapshot_path,snapshot_sha256,report_json,result_revision,created_at,updated_at,idempotency_key,source_sha256,patches_json)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          input.id,
          input.ownerId,
          result ? snapshot.spec.id : null,
          status,
          stage,
          path,
          snapshot.snapshotSha256,
          JSON.stringify(report),
          result?.revision ?? null,
          now,
          now,
          input.idempotencyKey,
          source,
          JSON.stringify(patches),
        )
      this.db.exec("COMMIT")
      return this.publicationItem(input.id)!
    } catch (err) {
      this.db.exec("ROLLBACK")
      for (const file of created) rmSync(file, { force: true })
      rmSync(dir, { recursive: true, force: true })
      throw err
    }
  }

  getPublication(input: PublicationLookup) {
    const row = this.db.prepare("SELECT owner_id FROM publication_runs WHERE id=?").get(input.id) as unknown as
      | { owner_id: string }
      | undefined
    if (!row) return undefined
    if (row.owner_id !== input.ownerId) throw new Error("OWNERSHIP_REQUIRED")
    return this.publicationItem(input.id)
  }

  publications(ownerId: string) {
    const rows = this.db
      .prepare("SELECT id FROM publication_runs WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 100")
      .all(ownerId) as unknown as Array<{ id: string }>
    return rows.flatMap((row) => {
      const item = this.publicationItem(row.id)
      return item ? [item] : []
    })
  }

  putPublicationPatches(input: PublicationPatchesInput): PublicationItem {
    const run = this.getPublication(input)
    if (!run) throw new Error("NOT_FOUND")
    if (run.status !== "NEEDS_AI_CONFIRMATION") throw new Error("CONFLICT: publication does not accept AI patches")
    const now = Date.now()
    const source = run.patches.find(
      (patch) => patch.kind === "deterministic" && patch.files.some((file) => file.path === "SKILL.md"),
    )
    if (!source || Date.parse(source.expiresAt) <= now) throw new Error("CONFLICT: publication repair window expired")
    if (input.patches.length === 0 || input.patches.length > 20)
      throw new Error("VALIDATION_FAILED: invalid patch count")
    for (const patch of input.patches) {
      if (
        patch.runId !== input.id ||
        patch.kind !== "ai" ||
        !patch.requiresConfirmation ||
        Date.parse(patch.expiresAt) <= now
      ) {
        throw new Error("VALIDATION_FAILED: invalid AI patch metadata")
      }
      if (patch.files.length === 0 || patch.files.length > 50 || patch.files.some((file) => !validPatchFile(file))) {
        throw new Error("VALIDATION_FAILED: invalid AI patch files")
      }
    }
    const deterministic = run.patches.filter((patch) => patch.kind === "deterministic")
    const updated = new Date().toISOString()
    this.db
      .prepare("UPDATE publication_runs SET patches_json=?,updated_at=? WHERE id=?")
      .run(JSON.stringify([...deterministic, ...input.patches]), updated, input.id)
    return this.publicationItem(input.id)!
  }

  applyPublicationPatches(input: PublicationApplyInput): PublicationItem {
    const run = this.getPublication(input)
    if (!run) throw new Error("NOT_FOUND")
    const selected = run.patches.filter((patch) => input.patchIds.includes(patch.id) && patch.kind === "ai")
    if (selected.length === 0 || selected.length !== input.patchIds.length)
      throw new Error("CONFLICT: explicit AI patch confirmation is required")
    if (selected.some((patch) => Date.parse(patch.expiresAt) <= Date.now()))
      throw new Error("CONFLICT: AI patch expired")
    const row = this.db.prepare("SELECT snapshot_path FROM publication_runs WHERE id=?").get(input.id) as unknown as {
      snapshot_path: string
    }
    const original = readFileSync(row.snapshot_path)
    const snapshot = applySkillPatches(
      original,
      selected.flatMap((patch) => patch.files),
    )
    const report = publicationReport(snapshot)
    const now = new Date().toISOString()
    const created: string[] = []
    writeFileSync(row.snapshot_path, snapshot.archive)
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = snapshot.valid ? this.publishSnapshot(input.ownerId, snapshot, report, created) : undefined
      this.db
        .prepare(
          `UPDATE publication_runs SET skill_id=?,status=?,stage=?,snapshot_sha256=?,report_json=?,result_revision=?,updated_at=? WHERE id=?`,
        )
        .run(
          result ? snapshot.spec.id : null,
          result?.status ?? publicationFailure(snapshot),
          snapshot.valid ? "complete" : snapshot.stage,
          snapshot.snapshotSha256,
          JSON.stringify(report),
          result?.revision ?? null,
          now,
          input.id,
        )
      this.db.exec("COMMIT")
      return this.publicationItem(input.id)!
    } catch (err) {
      this.db.exec("ROLLBACK")
      writeFileSync(row.snapshot_path, original)
      for (const file of created) rmSync(file, { force: true })
      throw err
    }
  }

  unpublish(input: UnpublishInput): PublicationItem {
    const now = new Date().toISOString()
    const skill = this.db
      .prepare("SELECT author_id,latest_revision FROM skills WHERE id=?")
      .get(input.skillId) as unknown as { author_id: string; latest_revision: number } | undefined
    if (!skill) throw new Error("NOT_FOUND")
    if (skill.author_id !== input.ownerId) throw new Error("OWNERSHIP_REQUIRED")
    const release = this.release(input.skillId, skill.latest_revision)
    if (!release) throw new Error("NOT_FOUND")
    this.db.exec("BEGIN IMMEDIATE")
    try {
      this.user(input.ownerId, input.ownerName, now)
      this.db.prepare("UPDATE skills SET status='unpublished',updated_at=? WHERE id=?").run(now, input.skillId)
      this.db
        .prepare(
          `INSERT INTO publication_runs(id,owner_id,skill_id,status,stage,snapshot_path,snapshot_sha256,result_revision,created_at,updated_at,source_sha256,patches_json)
           VALUES(?,?,?,'UNPUBLISHED','complete',?,?,?,?,?,?, '[]')`,
        )
        .run(
          input.id,
          input.ownerId,
          input.skillId,
          release.archivePath,
          release.sha256,
          release.revision,
          now,
          now,
          release.sha256,
        )
      this.db.exec("COMMIT")
      return this.publicationItem(input.id)!
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
  }

  events(items: EventInput[]) {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const stmt = this.db.prepare(
        "INSERT OR IGNORE INTO events(id,name,surface,user_id,client_id,skill_id,revision,occurred_at,context_json) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      const count = { value: 0 }
      for (const item of items) {
        const result = stmt.run(
          item.id,
          item.name,
          item.surface,
          item.userId,
          item.clientId,
          item.skillId ?? null,
          item.revision ?? null,
          item.occurredAt,
          JSON.stringify(item.context ?? {}),
        )
        count.value += Number(result.changes)
      }
      this.db.exec("COMMIT")
      return { accepted: count.value }
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
  }

  aggregate(): DailyMetric[] {
    this.db.exec(`
      BEGIN IMMEDIATE;
      INSERT INTO daily_metrics(date,event_name,skill_id,count)
      SELECT substr(occurred_at,1,10),name,COALESCE(skill_id,''),COUNT(*) FROM events
      GROUP BY substr(occurred_at,1,10),name,COALESCE(skill_id,'')
      ON CONFLICT(date,event_name,skill_id) DO UPDATE SET count=excluded.count;
      COMMIT;
    `)
    return this.metrics()
  }

  maintain(now: string) {
    if (!Number.isFinite(Date.parse(now))) throw new Error("VALIDATION_FAILED: invalid retention timestamp")
    const raw = new Date(Date.parse(now) - 90 * 24 * 60 * 60 * 1000).toISOString()
    const daily = new Date(Date.parse(now) - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    this.aggregate()
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const events = this.db.prepare("DELETE FROM events WHERE occurred_at < ?").run(raw)
      const metrics = this.db.prepare("DELETE FROM daily_metrics WHERE date < ?").run(daily)
      this.db.exec("COMMIT")
      return {
        rawDeleted: Number(events.changes),
        metricsDeleted: Number(metrics.changes),
        metrics: this.metrics(),
      }
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
  }

  searchExtensions(input: ExtensionSearchInput = {}) {
    return this.extensions.search(input)
  }

  getExtension(id: string) {
    return this.extensions.get(id)
  }

  extensionArtifact(id: string) {
    return this.extensions.artifact(id)
  }

  extensionArtifactBySha(sha256: string) {
    return this.extensions.artifactBySha(sha256)
  }

  extensionArtifacts(id: string) {
    return this.extensions.artifacts(id)
  }

  publishExtension(input: ExtensionArtifactInput) {
    return this.extensions.publish(input)
  }

  touchExtensionSource(key: string, stamp: string) {
    return this.extensions.touchSource(key, stamp)
  }

  extensionSystemSources() {
    return this.extensions.systemSources()
  }

  unlistExtensionSource(key: string, stamp: string) {
    return this.extensions.unlistSource(key, stamp)
  }

  removeExtensionArtifact(id: string, userId: string, stamp: string) {
    return this.extensions.remove(id, userId, stamp)
  }

  extensionPublication(input: ExtensionPublicationInput) {
    return this.extensions.publication(input)
  }

  getExtensionPublication(id: string, ownerId: string) {
    return this.extensions.getPublication(id, ownerId)
  }

  extensionPublications(ownerId: string) {
    return this.extensions.publications(ownerId)
  }

  extensionUploadCount(ownerId: string, since: string) {
    return this.extensions.uploadCount(ownerId, since)
  }

  extensionFavorite(input: ExtensionFavoriteInput) {
    return this.extensions.favorite(input)
  }

  extensionFavorites(userId: string) {
    return this.extensions.favorites(userId)
  }

  extensionReviews(id: string) {
    return this.extensions.reviews(id)
  }

  extensionReview(input: ExtensionReviewInput) {
    return this.extensions.review(input)
  }

  deleteExtensionReview(userId: string, extensionId: string) {
    return this.extensions.deleteReview(userId, extensionId)
  }

  userExtensionReviews(userId: string) {
    return this.extensions.userReviews(userId)
  }

  extensionUploads(userId: string) {
    return this.extensions.uploads(userId)
  }

  extensionDownload(input: ExtensionDownloadInput) {
    return this.extensions.download(input)
  }

  extensionAnalytics() {
    return this.extensions.analytics()
  }

  extensionSources(artifactId: string, userId: string) {
    return this.extensions.sources(artifactId, userId)
  }

  private metrics(): DailyMetric[] {
    const rows = this.db
      .prepare("SELECT date,event_name,skill_id,count FROM daily_metrics ORDER BY date,event_name,skill_id")
      .all() as unknown as Array<{
      date: string
      event_name: string
      skill_id: string
      count: number
    }>
    return rows.map((row) => ({
      date: row.date,
      name: row.event_name,
      ...(row.skill_id ? { skillId: row.skill_id } : {}),
      count: Number(row.count),
    }))
  }

  close() {
    this.db.close()
  }

  private migrate() {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)",
    )
    const applied = new Set(
      (this.db.prepare("SELECT version FROM schema_migrations").all() as unknown as Array<{ version: number }>).map(
        (row) => Number(row.version),
      ),
    )
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue
      this.db.exec("BEGIN IMMEDIATE")
      try {
        this.db.exec(migration.sql)
        this.db
          .prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)")
          .run(migration.version, migration.name, new Date().toISOString())
        this.db.exec("COMMIT")
      } catch (err) {
        this.db.exec("ROLLBACK")
        throw err
      }
    }
  }

  private user(id: string, name: string, now: string) {
    this.db
      .prepare(
        `INSERT INTO users(id,display_name,first_seen_at,last_seen_at) VALUES(?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at`,
      )
      .run(id, name, now, now)
  }

  private publishSnapshot(ownerId: string, snapshot: SkillSnapshot, report: PublicationReport, created: string[]) {
    const current = this.db
      .prepare("SELECT author_id,latest_revision FROM skills WHERE id=?")
      .get(snapshot.spec.id) as unknown as { author_id: string; latest_revision: number } | undefined
    if (current && current.author_id !== ownerId) throw new Error("OWNERSHIP_REQUIRED")
    const duplicate = this.db
      .prepare("SELECT revision FROM releases WHERE skill_id=? AND sha256=?")
      .get(snapshot.spec.id, snapshot.snapshotSha256) as unknown as { revision: number } | undefined
    if (duplicate) return { status: "UNCHANGED" as const, revision: Number(duplicate.revision) }
    if (snapshot.semver) {
      const semver = this.db
        .prepare("SELECT revision FROM releases WHERE skill_id=? AND semver=?")
        .get(snapshot.spec.id, snapshot.semver)
      if (semver) throw new Error("CONFLICT: semver already exists")
    }
    const now = new Date().toISOString()
    if (!current) {
      this.db
        .prepare(
          `INSERT INTO skills(id,name,description,category,tags_json,author_id,status,latest_revision,created_at,updated_at,legacy_json)
           VALUES(?,?,?,?,?,?,'published',0,?,?,?)`,
        )
        .run(
          snapshot.spec.id,
          snapshot.spec.name,
          snapshot.spec.description,
          snapshot.spec.category,
          JSON.stringify(snapshot.spec.tags),
          ownerId,
          now,
          now,
          JSON.stringify(snapshot.spec),
        )
    } else {
      this.db
        .prepare(
          "UPDATE skills SET name=?,description=?,category=?,tags_json=?,status='published',updated_at=?,legacy_json=? WHERE id=?",
        )
        .run(
          snapshot.spec.name,
          snapshot.spec.description,
          snapshot.spec.category,
          JSON.stringify(snapshot.spec.tags),
          now,
          JSON.stringify(snapshot.spec),
          snapshot.spec.id,
        )
    }
    const revision = Number(current?.latest_revision ?? 0) + 1
    const dir = join(this.dir, "releases", snapshot.spec.id)
    const path = join(dir, `${revision}.tar.gz`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, snapshot.archive)
    created.push(path)
    this.db
      .prepare(
        `INSERT INTO releases(skill_id,revision,semver,sha256,size_bytes,notes,validation_report_json,archive_path,published_at,metadata_json)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        snapshot.spec.id,
        revision,
        snapshot.semver ?? null,
        snapshot.snapshotSha256,
        snapshot.archive.length,
        null,
        JSON.stringify(report),
        path,
        now,
        JSON.stringify(snapshot.spec),
      )
    this.db.prepare("UPDATE skills SET latest_revision=?,updated_at=? WHERE id=?").run(revision, now, snapshot.spec.id)
    return { status: "PUBLISHED" as const, revision }
  }

  private publicationItem(id: string): PublicationItem | undefined {
    const row = this.db
      .prepare(
        `SELECT id,owner_id,skill_id,status,stage,report_json,patches_json,result_revision,created_at,updated_at,source_sha256
         FROM publication_runs WHERE id=?`,
      )
      .get(id) as unknown as PublicationRow | undefined
    if (!row) return undefined
    const report = row.report_json ? (JSON.parse(row.report_json) as PublicationReport) : undefined
    const patches = JSON.parse(row.patches_json) as PublicationPatch[]
    const release = row.skill_id && row.result_revision ? this.release(row.skill_id, row.result_revision) : undefined
    return {
      id: row.id,
      ...(row.skill_id ? { skillId: row.skill_id } : {}),
      ownerId: row.owner_id,
      status: row.status,
      stage: row.stage,
      ...(report ? { report } : {}),
      patches,
      ...(release ? { release } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private getUser(id: string): MarketUserItem | undefined {
    const row = this.db
      .prepare("SELECT id,display_name,first_seen_at,last_seen_at FROM users WHERE id=?")
      .get(id) as unknown as
      | { id: string; display_name: string; first_seen_at: string; last_seen_at: string }
      | undefined
    if (!row) return undefined
    return {
      id: row.id,
      displayName: row.display_name,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    }
  }

  private archive(root: string, id: string, value: unknown) {
    if (!SAFE_ID.test(id)) return undefined
    const raw = String(value ?? `${id}.tar.gz`).trim()
    const path = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw
    const file = basename(path)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.tar\.gz$/.test(file)) return undefined
    return join(root, "skills", file)
  }
}

function sha(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function publicationReport(snapshot: SkillSnapshot): PublicationReport {
  return {
    valid: snapshot.valid,
    stage: snapshot.stage,
    issues: snapshot.issues,
    sourceSha256: snapshot.sourceSha256,
    snapshotSha256: snapshot.snapshotSha256,
    changed: snapshot.changed,
  }
}

function deterministicPatches(runId: string, snapshot: SkillSnapshot, now: string): PublicationPatch[] {
  const files = [...snapshot.changes]
  if (!files.some((file) => file.path === "SKILL.md")) {
    const skill = entries(snapshot.archive).find((file) => file.path === "SKILL.md")
    if (skill) {
      const hash = sha(skill.data)
      files.push({
        path: "SKILL.md",
        beforeSha256: hash,
        afterSha256: hash,
        patch: `replace-base64:${skill.data.toString("base64")}`,
      })
    }
  }
  if (files.length === 0) return []
  return [
    {
      id: `det-${runId}`,
      runId,
      kind: "deterministic",
      files,
      requiresConfirmation: false,
      expiresAt: new Date(Date.parse(now) + 8 * 60 * 60 * 1000).toISOString(),
    },
  ]
}

function publicationFailure(snapshot: SkillSnapshot): PublicationItem["status"] {
  if (snapshot.stage === "security") return "SECURITY_REJECTED"
  if (snapshot.stage === "semantic") return "NEEDS_AI_CONFIRMATION"
  return "NEEDS_AUTHOR_FIX"
}

function validPatchFile(file: PublicationPatchFile) {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/.test(file.path) &&
    !file.path.split("/").includes("..") &&
    /^[a-f0-9]{64}$/.test(file.beforeSha256) &&
    /^[a-f0-9]{64}$/.test(file.afterSha256) &&
    file.patch.startsWith("replace-base64:") &&
    file.patch.length <= 16 * 1024 * 1024
  )
}

function string(value: unknown) {
  const text = typeof value === "string" ? value.trim() : ""
  return text || undefined
}

function validDate(value: unknown) {
  const text = string(value)
  if (!text || Number.isNaN(Date.parse(text))) return undefined
  return new Date(text).toISOString()
}

function parseTags(value: string) {
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.map(String) : []
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}

function tokens(value: string | undefined) {
  const parts = value?.match(/[\p{L}\p{N}._-]+/gu)?.filter(Boolean) ?? []
  if (parts.length === 0) return undefined
  return parts.map((part) => `"${part.replaceAll('"', '""')}"*`).join(" AND ")
}

function mapSearch(row: SearchRow): SearchItem {
  const legacy = parseObject(row.legacy_json)
  const gallery = artworks(legacy.gallery)
  const artwork = artworkItem(legacy.artwork) ?? gallery[0]
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    tags: parseTags(row.tags_json),
    authorId: row.author_id,
    author: row.author,
    latestRevision: Number(row.latest_revision),
    ...(row.semver ? { semver: row.semver } : {}),
    sha256: row.sha256,
    archivePath: row.archive_path,
    updatedAt: row.updated_at,
    downloads: Number(row.download_count),
    favorites: Number(row.favorite_count),
    ...(artwork ? { artwork } : {}),
    ...(gallery.length > 0 ? { gallery } : {}),
  }
}

function artworks(value: unknown): ArtworkItem[] {
  return Array.isArray(value) ? value.map(artworkItem).filter((item) => item !== undefined) : []
}

function artworkItem(value: unknown): ArtworkItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const type = item.type
  const url = string(item.url)
  const mime = string(item.mime)
  const width = Number(item.width)
  const height = Number(item.height)
  const hash = string(item.sha256)
  if (type !== "icon" && type !== "cover" && type !== "screenshot") return undefined
  if (!url || !/^(?:https:\/\/|\/|data:image\/)/.test(url)) return undefined
  if (!mime?.startsWith("image/")) return undefined
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) return undefined
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return undefined
  return { type, url, mime, width, height, sha256: hash }
}

function entries(file: string | Buffer): TarEntry[] {
  const raw = gunzipSync(typeof file === "string" ? readFileSync(file) : file)
  const found: TarEntry[] = []
  const state = { offset: 0, path: "" }
  while (state.offset + 512 <= raw.length) {
    const header = raw.subarray(state.offset, state.offset + 512)
    if (header.every((value) => value === 0)) break
    const name = field(header, 0, 100)
    const prefix = field(header, 345, 155)
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8) || 0
    const type = String.fromCharCode(header[156] ?? 0)
    const start = state.offset + 512
    const data = raw.subarray(start, start + size)
    const path = state.path || [prefix, name].filter(Boolean).join("/")
    state.path = ""
    if (type === "x") state.path = pax(data)
    if (type === "L") state.path = data.toString("utf8").replace(/\0.*$/s, "").trim()
    if (type === "0" || type === "\0" || type === "") {
      const safe = safePath(path)
      if (safe) found.push({ path: safe, data: Buffer.from(data) })
    }
    state.offset = start + Math.ceil(size / 512) * 512
  }
  const roots = new Set(found.map((entry) => entry.path.split("/")[0]))
  if (roots.size !== 1 || found.some((entry) => !entry.path.includes("/"))) return found
  return found.map((entry) => ({ path: entry.path.slice(entry.path.indexOf("/") + 1), data: entry.data }))
}

function field(value: Buffer, start: number, size: number) {
  return value
    .subarray(start, start + size)
    .toString("utf8")
    .replace(/\0.*$/s, "")
    .trim()
}

function pax(value: Buffer) {
  const line = value
    .toString("utf8")
    .split("\n")
    .find((item) => item.includes(" path="))
  return line?.slice(line.indexOf(" path=") + 6) ?? ""
}

function safePath(value: string) {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "..")) return undefined
  return path
}

function fileItem(entry: TarEntry): FileItem {
  const mime = mimeType(entry.path)
  const type: FileItem["type"] =
    mime.startsWith("text/") || /json|yaml|xml/.test(mime) ? "text" : mime.startsWith("image/") ? "image" : "binary"
  return {
    path: entry.path,
    type,
    mime,
    size: entry.data.length,
    sha256: sha(entry.data),
    previewable: type !== "binary",
  }
}

function mimeType(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  if (lower.endsWith(".json")) return "application/json"
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "application/yaml"
  if (lower.endsWith(".xml")) return "application/xml"
  if (/\.(md|txt|ts|tsx|js|mjs|c|h|cpp|hpp|py|sh|css|html|csv)$/.test(lower)) return "text/plain"
  return "application/octet-stream"
}
