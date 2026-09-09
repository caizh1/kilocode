import type { DatabaseSync } from "node:sqlite"
import type { AdminActor, AdminChange, AdminChangeResult, AdminItem } from "./model.ts"

// 授权绑定目录主体，不依赖会被重新映射的市场用户 ID。
export function isAdministrator(db: DatabaseSync, subject: string) {
  return Boolean(db.prepare("SELECT 1 FROM auth_admins WHERE source_id='ldap' AND subject=?").get(subject))
}

export function administrators(db: DatabaseSync): AdminItem[] {
  const rows = db.prepare(`SELECT a.*,x.user_id FROM auth_admins a LEFT JOIN external_identities x
    ON x.source_id=a.source_id AND x.subject=a.subject ORDER BY a.granted_at,a.subject`).all() as unknown as Array<{
    subject: string; username: string; display_name: string; email: string | null
    granted_by: string; granted_at: string; user_id: string | null
  }>
  return rows.map((row) => ({
    subject: row.subject, username: row.username, displayName: row.display_name,
    ...(row.email ? { email: row.email } : {}),
    grantedBy: row.granted_by, grantedAt: row.granted_at,
    ...(row.user_id ? { userId: row.user_id } : {}),
  }))
}

export function revokeSubject(db: DatabaseSync, subject: string) {
  db.prepare(`DELETE FROM device_authorizations WHERE user_id IN
    (SELECT user_id FROM external_identities WHERE source_id='ldap' AND subject=?)`).run(subject)
  db.prepare("DELETE FROM sessions WHERE subject=?").run(subject)
  db.prepare("DELETE FROM token_families WHERE subject=?").run(subject)
}

function authorized(db: DatabaseSync, actor: AdminActor, now: string) {
  if (actor.actor === "break-glass" && !actor.subject) return Boolean(actor.expiresAt && actor.expiresAt > now)
  if (!actor.subject || !isAdministrator(db, actor.subject)) return false
  return hasIdentitySession(db, actor, now)
}

export function hasIdentitySession(db: DatabaseSync, actor: AdminActor, now: string) {
  if (!actor.subject) return false
  if (actor.sessionHash) return Boolean(db.prepare(`SELECT 1 FROM sessions s
    JOIN external_identities x ON x.subject=s.subject AND x.source_id='ldap' AND x.user_id=s.user_id
    JOIN auth_settings a ON a.revision=s.auth_revision
    WHERE s.hash=? AND s.subject=? AND s.user_id=? AND s.idle_expires_at>? AND s.absolute_expires_at>?`)
    .get(actor.sessionHash, actor.subject, actor.actor, now, now))
  if (actor.familyId) return Boolean(db.prepare(`SELECT 1 FROM token_families f
    JOIN external_identities x ON x.subject=f.subject AND x.source_id='ldap' AND x.user_id=f.user_id
    JOIN auth_settings a ON a.revision=f.auth_revision
    WHERE f.id=? AND f.subject=? AND f.user_id=? AND f.revoked_at IS NULL AND f.expires_at>?`)
    .get(actor.familyId, actor.subject, actor.actor, now))
  return false
}

export function changeAdministrator(db: DatabaseSync, input: AdminChange): AdminChangeResult {
  db.exec("BEGIN IMMEDIATE")
  try {
    const allowed = authorized(db, input.actor, input.now)
    const exists = isAdministrator(db, input.target.subject)
    const count = db.prepare("SELECT COUNT(*) AS count FROM auth_admins").get() as { count: number }
    const code = !allowed ? "ADMIN_REQUIRED" : !input.grant && exists && count.count <= 1 ? "LAST_ADMIN_REQUIRED" : undefined
    if (code) {
      audit(db, input, "server.admin.denied", { code })
      db.exec("COMMIT")
      return { ok: false, code }
    }
    const changed = input.grant !== exists
    if (input.grant && !exists) db.prepare(`INSERT INTO auth_admins
      (source_id,subject,username,display_name,email,granted_by,granted_at) VALUES('ldap',?,?,?,?,?,?)`)
      .run(input.target.subject, input.target.username, input.target.displayName, input.target.email ?? null, input.actor.actor, input.now)
    if (!input.grant && exists) db.prepare("DELETE FROM auth_admins WHERE source_id='ldap' AND subject=?").run(input.target.subject)
    if (changed) revokeSubject(db, input.target.subject)
    audit(db, input, input.grant ? "server.admin.granted" : "server.admin.revoked", { changed })
    db.exec("COMMIT")
    return { ok: true, changed }
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }
}

function audit(db: DatabaseSync, input: AdminChange, action: string, details: Record<string, unknown>) {
  db.prepare("INSERT INTO auth_audit_events(actor,action,details_json,occurred_at) VALUES(?,?,?,?)")
    .run(input.actor.actor, action, JSON.stringify({ subject: input.target.subject, username: input.target.username, ...details }), input.now)
}
