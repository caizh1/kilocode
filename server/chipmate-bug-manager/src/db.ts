import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import type {
  Artifact,
  Audit,
  Bug,
  BugInput,
  Invite,
  Role,
  Run,
  RunLog,
  RunLogInput,
  RunResult,
  Session,
  Stage,
  User,
} from "./types.js"

const transitions: Record<Stage, readonly Stage[]> = {
  queued: ["queued", "diagnosing", "failed"],
  diagnosing: ["diagnosing", "fixing", "testing", "failed"],
  fixing: ["fixing", "testing", "failed"],
  testing: ["testing", "fixing", "reviewing", "failed"],
  reviewing: ["reviewing", "fixing", "approval_wait", "packaging", "failed"],
  approval_wait: [],
  packaging: ["packaging", "validating", "failed"],
  validating: ["validating", "publishing", "failed"],
  publishing: ["publishing", "released", "failed"],
  released: [],
  failed: [],
  cancelled: [],
  revoked: [],
}

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -16384;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reporter', 'maintainer', 'admin')),
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY,
  creator_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 3 CHECK (max_uses = 3),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  created_at TEXT NOT NULL,
  exhausted_at TEXT,
  UNIQUE(creator_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS invites_one_default
ON invites((1))
WHERE creator_id IS NULL;

CREATE TABLE IF NOT EXISTS bugs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reproduction TEXT NOT NULL,
  expected TEXT NOT NULL,
  actual TEXT NOT NULL,
  environment TEXT NOT NULL,
  component TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  bug_id INTEGER NOT NULL REFERENCES bugs(id),
  stage TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  release_version TEXT NOT NULL,
  baseline_commit TEXT,
  source_commit TEXT,
  summary TEXT,
  error TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS runs_active_bug
ON runs(bug_id)
WHERE stage NOT IN ('released', 'failed', 'cancelled', 'revoked');

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, platform)
);

CREATE TABLE IF NOT EXISTS run_logs (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('system', 'codex', 'command', 'test', 'review', 'package', 'qa', 'publish')),
  level TEXT NOT NULL CHECK (level IN ('info', 'success', 'warning', 'error')),
  message TEXT NOT NULL,
  summary TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS bugs_reporter ON bugs(reporter_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS runs_stage ON runs(stage, created_at);
CREATE INDEX IF NOT EXISTS run_logs_run ON run_logs(run_id, id);
CREATE INDEX IF NOT EXISTS audits_subject ON audits(subject_type, subject_id, created_at);
`

function now() {
  return new Date().toISOString()
}

function row<T>(value: unknown) {
  return value as T | undefined
}

function rows<T>(value: unknown) {
  return value as T[]
}

export class Store {
  readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(schema)
    const columns = rows<{ name: string }>(this.db.prepare("PRAGMA table_info(run_logs)").all())
    if (!columns.some((column) => column.name === "detail")) {
      this.db.exec("ALTER TABLE run_logs ADD COLUMN detail TEXT")
    }
  }

  close() {
    this.db.close()
  }

  transaction<T>(fn: () => T) {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const value = fn()
      this.db.exec("COMMIT")
      return value
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
  }

  createUser(username: string, password: string, role: Role) {
    const stamp = now()
    const result = this.db
      .prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)")
      .run(username, password, role, stamp)
    this.audit("system", "admin-cli", "user.create", "user", String(result.lastInsertRowid), { username, role })
    return Number(result.lastInsertRowid)
  }

  userByName(username: string) {
    return row<User>(this.db.prepare("SELECT * FROM users WHERE username = ?").get(username))
  }

  user(id: number) {
    return row<User>(this.db.prepare("SELECT * FROM users WHERE id = ?").get(id))
  }

  registerWithInvite(username: string, password: string, codeHash: string) {
    return this.transaction(() => {
      const invite = row<Invite>(
        this.db
          .prepare(
            `SELECT * FROM invites
             WHERE code_hash = ? AND exhausted_at IS NULL AND used_count < max_uses`,
          )
          .get(codeHash),
      )
      if (!invite) throw new Error("INVITE_INVALID")
      const stamp = now()
      const created = this.db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'reporter', ?)",
        )
        .run(username, password, stamp)
      const user = Number(created.lastInsertRowid)
      const consumed = this.db
        .prepare(
          `UPDATE invites
           SET used_count = used_count + 1,
               exhausted_at = CASE WHEN used_count + 1 = max_uses THEN ? ELSE NULL END
           WHERE id = ? AND exhausted_at IS NULL AND used_count < max_uses`,
        )
        .run(stamp, invite.id)
      if (consumed.changes !== 1) throw new Error("INVITE_INVALID")
      this.audit("user", String(user), "auth.register", "user", String(user), {
        username,
        role: "reporter",
        invite: invite.id,
      })
      this.audit("user", String(user), "invite.consume", "invite", String(invite.id), {
        remaining: invite.max_uses - invite.used_count - 1,
      })
      const value = this.user(user)
      if (!value) throw new Error("USER_CREATE_FAILED")
      return value
    })
  }

  createInvite(creator: number, codeHash: string, prefix: string) {
    return this.transaction(() => this.insertInvite(creator, codeHash, prefix))
  }

  createDefaultInvite(codeHash: string, prefix: string) {
    return this.transaction(() => this.insertInvite(null, codeHash, prefix))
  }

  private insertInvite(creator: number | null, codeHash: string, prefix: string) {
    const stamp = now()
    const result = this.db
      .prepare(
        `INSERT INTO invites (creator_id, code_hash, code_prefix, max_uses, used_count, created_at)
         VALUES (?, ?, ?, 3, 0, ?)`,
      )
      .run(creator, codeHash, prefix, stamp)
    const invite = Number(result.lastInsertRowid)
    this.audit(
      creator === null ? "system" : "user",
      creator === null ? "default-invite-cli" : String(creator),
      "invite.create",
      "invite",
      String(invite),
      { maxUses: 3, default: creator === null },
    )
    const value = this.invite(invite)
    if (!value) throw new Error("INVITE_CREATE_FAILED")
    return value
  }

  invite(id: number) {
    return row<Invite>(this.db.prepare("SELECT * FROM invites WHERE id = ?").get(id))
  }

  inviteForCreator(creator: number) {
    return row<Invite>(this.db.prepare("SELECT * FROM invites WHERE creator_id = ?").get(creator))
  }

  defaultInvite() {
    return row<Invite>(this.db.prepare("SELECT * FROM invites WHERE creator_id IS NULL").get())
  }

  createSession(user: number, hash: string, csrf: string, expires: string) {
    const stamp = now()
    const result = this.db
      .prepare(
        "INSERT INTO sessions (user_id, token_hash, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(user, hash, csrf, expires, stamp)
    return Number(result.lastInsertRowid)
  }

  session(hash: string) {
    const value = this.db
      .prepare(
        `SELECT sessions.*, users.username, users.role, users.disabled_at
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      )
      .get(hash, now())
    return row<Session & Pick<User, "username" | "role" | "disabled_at">>(value)
  }

  deleteSession(hash: string) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash)
  }

  pruneSessions() {
    return Number(this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now()).changes)
  }

  createBug(input: BugInput, reporter: number) {
    const stamp = now()
    const result = this.db
      .prepare(
        `INSERT INTO bugs
         (title, description, reproduction, expected, actual, environment, component, severity, status,
          reporter_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'triage', ?, ?, ?)`,
      )
      .run(
        input.title,
        input.description,
        input.reproduction,
        input.expected,
        input.actual,
        input.environment,
        input.component,
        input.severity,
        reporter,
        stamp,
        stamp,
      )
    const id = Number(result.lastInsertRowid)
    this.audit("user", String(reporter), "bug.create", "bug", String(id), { severity: input.severity })
    return this.bug(id)
  }

  createBugAndTrigger(input: BugInput, reporter: number) {
    return this.transaction(() => {
      const bug = this.createBug(input, reporter)
      if (!bug) throw new Error("BUG_CREATE_FAILED")
      const run = this.queue(bug.id, reporter)
      return { bug, run }
    })
  }

  bugs(role: Role, user: number) {
    const sql =
      role === "reporter"
        ? `SELECT bugs.*, users.username AS reporter
           FROM bugs JOIN users ON users.id = bugs.reporter_id
           WHERE reporter_id = ? ORDER BY bugs.updated_at DESC`
        : `SELECT bugs.*, users.username AS reporter
           FROM bugs JOIN users ON users.id = bugs.reporter_id
           ORDER BY bugs.updated_at DESC`
    const value = role === "reporter" ? this.db.prepare(sql).all(user) : this.db.prepare(sql).all()
    return rows<Bug & { reporter: string }>(value)
  }

  bug(id: number) {
    return row<Bug & { reporter: string }>(
      this.db
        .prepare(
          `SELECT bugs.*, users.username AS reporter
           FROM bugs JOIN users ON users.id = bugs.reporter_id WHERE bugs.id = ?`,
        )
        .get(id),
    )
  }

  run(id: number) {
    return row<Run>(this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id))
  }

  runsForBug(id: number) {
    return rows<Run>(this.db.prepare("SELECT * FROM runs WHERE bug_id = ? ORDER BY created_at DESC").all(id))
  }

  artifacts(id: number) {
    return rows<Artifact>(this.db.prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY platform").all(id))
  }

  runLogs(id: number, limit = 200) {
    const size = Math.max(1, Math.min(500, Math.trunc(limit)))
    return rows<RunLog>(
      this.db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM run_logs WHERE run_id = ? ORDER BY id DESC LIMIT ?
           ) ORDER BY id`,
        )
        .all(id, size),
    )
  }

  appendRunLogs(id: number, owner: string, logs: RunLogInput[]) {
    return this.transaction(() => {
      const run = this.run(id)
      if (!run) throw new Error("RUN_NOT_FOUND")
      if (run.lease_owner !== owner) throw new Error("LEASE_MISMATCH")
      const statement = this.db.prepare(
        `INSERT INTO run_logs (run_id, stage, kind, level, message, summary, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const inserted: RunLog[] = []
      for (const log of logs) {
        const result = statement.run(
          id,
          log.stage,
          log.kind,
          log.level,
          log.message,
          log.summary ?? null,
          log.detail ?? null,
          now(),
        )
        const entry = row<RunLog>(this.db.prepare("SELECT * FROM run_logs WHERE id = ?").get(result.lastInsertRowid))
        if (entry) inserted.push(entry)
      }
      this.db
        .prepare(
          `DELETE FROM run_logs
           WHERE run_id = ? AND id NOT IN (
             SELECT id FROM run_logs WHERE run_id = ? ORDER BY id DESC LIMIT 500
           )`,
        )
        .run(id, id)
      return inserted
    })
  }

  trigger(id: number, actor: number) {
    return this.transaction(() => this.queue(id, actor))
  }

  private queue(id: number, actor: number) {
    const bug = this.bug(id)
    if (!bug) throw new Error("BUG_NOT_FOUND")
    const critical = bug.severity === "critical" || /auth|update|release|publish|automation/i.test(bug.component)
    const stamp = now()
    const version = this.nextVersion()
    const result = this.db
      .prepare(
        `INSERT INTO runs (bug_id, stage, requires_approval, release_version, created_at, updated_at)
         VALUES (?, 'queued', ?, ?, ?, ?)`,
      )
      .run(id, critical ? 1 : 0, version, stamp, stamp)
    const run = Number(result.lastInsertRowid)
    this.db.prepare("UPDATE bugs SET status = 'queued', updated_at = ? WHERE id = ?").run(stamp, id)
    this.audit("user", String(actor), "run.trigger", "run", String(run), { bug: id, critical, version })
    const queued = this.run(run)
    if (!queued) throw new Error("RUN_CREATE_FAILED")
    return queued
  }

  seedVersion(version: string) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("初始版本必须是 x.y.z")
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('release_version', ?) ON CONFLICT(key) DO NOTHING")
      .run(version)
  }

  nextVersion() {
    const current = row<{ value: string }>(
      this.db.prepare("SELECT value FROM settings WHERE key = 'release_version'").get(),
    )
    if (!current) throw new Error("RELEASE_VERSION_NOT_INITIALIZED")
    const parts = current.value.split(".").map(Number)
    if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
      throw new Error("RELEASE_VERSION_INVALID")
    }
    const version = `${parts[0]}.${parts[1]}.${parts[2]! + 1}`
    this.db.prepare("UPDATE settings SET value = ? WHERE key = 'release_version'").run(version)
    return version
  }

  queued() {
    return rows<Run>(
      this.db
        .prepare(
          `SELECT * FROM runs
           WHERE stage IN ('queued', 'packaging')
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY created_at`,
        )
        .all(now()),
    )
  }

  lease(id: number, owner: string, ttl: number) {
    return this.transaction(() => {
      const stamp = now()
      const expires = new Date(Date.now() + ttl).toISOString()
      const result = this.db
        .prepare(
          `UPDATE runs SET lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ?
           WHERE id = ? AND stage IN ('queued', 'packaging')
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        )
        .run(owner, expires, stamp, id, stamp)
      if (result.changes !== 1) return undefined
      this.audit("worker", owner, "run.lease", "run", String(id), { expires })
      return this.run(id)
    })
  }

  heartbeat(id: number, owner: string, ttl: number) {
    const expires = new Date(Date.now() + ttl).toISOString()
    const result = this.db
      .prepare(
        `UPDATE runs SET lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND lease_owner = ? AND lease_expires_at > ?`,
      )
      .run(expires, now(), id, owner, now())
    return result.changes === 1
  }

  updateRun(id: number, owner: string, input: RunResult) {
    return this.transaction(() => {
      const current = this.run(id)
      if (!current) throw new Error("RUN_NOT_FOUND")
      if (current.lease_owner !== owner) throw new Error("LEASE_MISMATCH")
      if (!transitions[current.stage].includes(input.stage)) throw new Error("INVALID_TRANSITION")
      const requires = current.requires_approval || input.requiresApproval ? 1 : 0
      if (
        requires
        && !current.approved_at
        && ["packaging", "validating", "publishing", "released"].includes(input.stage)
      ) {
        throw new Error("APPROVAL_REQUIRED")
      }
      if (input.stage === "released") {
        const artifacts = input.artifacts ?? []
        const platforms = new Set(artifacts.map((artifact) => artifact.platform))
        if (
          artifacts.length !== 2
          || platforms.size !== 2
          || !platforms.has("win32-x64-baseline")
          || !platforms.has("linux-x64-baseline")
          || artifacts.some((artifact) => artifact.version !== current.release_version)
        ) {
          throw new Error("ARTIFACTS_INVALID")
        }
      }
      const stamp = now()
      this.db
        .prepare(
          `UPDATE runs SET stage = ?, requires_approval = ?, baseline_commit = COALESCE(?, baseline_commit),
           source_commit = COALESCE(?, source_commit), summary = COALESCE(?, summary),
           error = ?, token_count = MAX(token_count, ?), updated_at = ?,
           lease_owner = CASE WHEN ? IN ('released', 'failed', 'cancelled', 'approval_wait') THEN NULL ELSE lease_owner END,
           lease_expires_at = CASE WHEN ? IN ('released', 'failed', 'cancelled', 'approval_wait') THEN NULL ELSE lease_expires_at END
           WHERE id = ?`,
        )
        .run(
          input.stage,
          requires,
          input.baselineCommit ?? null,
          input.sourceCommit ?? null,
          input.summary ?? null,
          input.error ?? null,
          input.tokenCount ?? current.token_count,
          stamp,
          input.stage,
          input.stage,
          id,
        )
      if (input.artifacts) {
        const stmt = this.db.prepare(
          `INSERT INTO artifacts (run_id, version, platform, name, size, sha256, url, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id, platform) DO UPDATE SET
             version = excluded.version, name = excluded.name, size = excluded.size,
             sha256 = excluded.sha256, url = excluded.url`,
        )
        for (const artifact of input.artifacts) {
          stmt.run(
            id,
            artifact.version,
            artifact.platform,
            artifact.name,
            artifact.size,
            artifact.sha256,
            artifact.url,
            stamp,
          )
        }
      }
      const status = input.stage === "released" ? "released" : input.stage
      this.db.prepare("UPDATE bugs SET status = ?, updated_at = ? WHERE id = ?").run(status, stamp, current.bug_id)
      this.audit("worker", owner, "run.update", "run", String(id), { stage: input.stage })
      return this.run(id)
    })
  }

  approve(id: number, actor: number) {
    return this.transaction(() => {
      const stamp = now()
      const result = this.db
        .prepare(
          `UPDATE runs SET stage = 'packaging', approved_by = ?, approved_at = ?, updated_at = ?
           WHERE id = ? AND stage = 'approval_wait' AND requires_approval = 1`,
        )
        .run(actor, stamp, stamp, id)
      if (result.changes !== 1) return undefined
      const run = this.run(id)
      if (run) this.db.prepare("UPDATE bugs SET status = 'packaging', updated_at = ? WHERE id = ?").run(stamp, run.bug_id)
      this.audit("user", String(actor), "run.approve", "run", String(id), {})
      return run
    })
  }

  cancel(id: number, actor: number) {
    return this.transaction(() => {
      const current = this.run(id)
      if (!current || ["publishing", "released", "cancelled", "revoked"].includes(current.stage)) return undefined
      const stamp = now()
      this.db
        .prepare(
          `UPDATE runs SET stage = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(stamp, id)
      this.db.prepare("UPDATE bugs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(stamp, current.bug_id)
      this.audit("user", String(actor), "run.cancel", "run", String(id), {})
      return this.run(id)
    })
  }

  audit(
    actorType: string,
    actor: string,
    action: string,
    subjectType: string,
    subject: string,
    detail: Record<string, unknown>,
  ) {
    this.db
      .prepare(
        `INSERT INTO audits
         (actor_type, actor_id, action, subject_type, subject_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(actorType, actor, action, subjectType, subject, JSON.stringify(detail), now())
  }

  audits(subjectType: string, subject: string) {
    return rows<Audit>(
      this.db
        .prepare(
          "SELECT * FROM audits WHERE subject_type = ? AND subject_id = ? ORDER BY created_at DESC",
        )
        .all(subjectType, subject),
    )
  }
}

export function canReadBug(role: Role, user: number, bug: Bug) {
  return role !== "reporter" || bug.reporter_id === user
}

export function terminal(stage: Stage) {
  return ["released", "failed", "cancelled", "revoked"].includes(stage)
}
