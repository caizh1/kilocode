import type { DatabaseSync } from "node:sqlite"

export interface DiagnosticBundle {
  id: string
  ownerId: string
  ownerName: string
  createdAt: string
  expiresAt: string
  size: number
  sha256: string
  version: string
  platform: string
  from: string
  to: string
  summary: string
  partial: boolean
  sources: Array<{ name: string; status: string; message?: string | undefined }>
}
export type DiagnosticOperation =
  | { action: "put"; item: DiagnosticBundle }
  | { action: "get"; id: string }
  | { action: "list"; ownerId?: string | undefined; query?: string | undefined; version?: string | undefined; platform?: string | undefined; after?: string | undefined; before?: string | undefined; offset?: number; now: string }
  | { action: "expired"; now: string }
  | { action: "remove"; id: string }
  | { action: "usage" }

export function diagnostics(db: DatabaseSync, input: DiagnosticOperation): unknown {
  if (input.action === "put") {
    const item = input.item
    db.prepare(`INSERT INTO diagnostic_bundles(id,owner_id,created_at,expires_at,size,metadata_json) VALUES(?,?,?,?,?,?)`)
      .run(item.id, item.ownerId, item.createdAt, item.expiresAt, item.size, JSON.stringify(item))
    return item
  }
  if (input.action === "get") return decode(db.prepare("SELECT metadata_json FROM diagnostic_bundles WHERE id=?").get(input.id))
  if (input.action === "remove") return db.prepare("DELETE FROM diagnostic_bundles WHERE id=?").run(input.id).changes
  if (input.action === "usage") return (db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM diagnostic_bundles").get() as { bytes: number }).bytes
  if (input.action === "expired") return db.prepare("SELECT metadata_json FROM diagnostic_bundles WHERE expires_at<=?").all(input.now).map(decode)
  const clauses = ["expires_at>?"]
  const args: Array<string | number> = [input.now]
  if (input.ownerId) { clauses.push("owner_id=?"); args.push(input.ownerId) }
  if (input.query) { clauses.push("(instr(id,?)>0 OR instr(json_extract(metadata_json,'$.ownerName'),?)>0)"); args.push(input.query, input.query) }
  if (input.version) { clauses.push("json_extract(metadata_json,'$.version')=?"); args.push(input.version) }
  if (input.platform) { clauses.push("json_extract(metadata_json,'$.platform')=?"); args.push(input.platform) }
  if (input.after) { clauses.push("created_at>=?"); args.push(input.after) }
  if (input.before) { clauses.push("created_at<=?"); args.push(input.before) }
  return db.prepare(`SELECT metadata_json FROM diagnostic_bundles WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 51 OFFSET ?`)
    .all(...args, input.offset ?? 0).map(decode)
}
function decode(row: unknown): DiagnosticBundle | undefined {
  if (!row) return
  return JSON.parse((row as { metadata_json: string }).metadata_json) as DiagnosticBundle
}
