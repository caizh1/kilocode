import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { SKILL_LIMITS, validateSkillArchive } from "@chipmate/skill-spec"
import { discoverSkillCandidates } from "@chipmate/skill-spec/node"
import type { SkillMarketRequest, SkillMarketResult } from "@kilocode/sdk/v2/client"
import { exec } from "../../util/process"
import type { MarketplaceService } from "../marketplace"
import { buildMarketplaceSkillUploadPayload } from "../marketplace/upload"
import type { LocalSkillRecord } from "../marketplace/types"

const DAY = 24 * 60 * 60 * 1_000
const OPEN_TTL = 10 * 60 * 1_000
const UNDO_TTL = 7 * DAY
const MAX_RETAINED = 20
const LOCK_STALE = 30_000
const MAX_FILE = 10 * 1024 * 1024
const MAX_TOTAL = 100 * 1024 * 1024

type Scope = "global" | "project"
type State = NonNullable<SkillMarketResult["state"]>
type Intent = "create" | "install" | "publish"

interface RecordFile {
  version: 1
  id: string
  skillId: string
  scope: Scope
  intents: Intent[]
  state: State
  root: string
  target: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  undoUntil?: string
  beforeExists?: boolean
  beforeSha256?: string
  afterSha256?: string
  revision?: number
  archiveSha256?: string
  approved: Intent[]
  prepared: Intent[]
  publishKey: string
  publishRunId?: string
  remoteStarted?: boolean
  localStarted?: boolean
  beforeRegistry?: LocalSkillRecord
  afterRegistry?: LocalSkillRecord
  error?: string
}

export class MarketTransactionError extends Error {
  constructor(
    readonly code:
      | "validation_failed"
      | "security_rejected"
      | "conflict"
      | "stale_target"
      | "locked"
      | "auth_required"
      | "remote_uncertain"
      | "rollback_failed"
      | "undo_expired"
      | "undo_conflict"
      | "manual_intervention"
      | "not_found"
      | "host_error",
    message: string,
    readonly transactionId?: string,
  ) {
    super(message)
  }
}

export interface MarketTransactionOptions {
  global: string
  market: MarketplaceService
  key(): Promise<string | undefined>
  workspaces?(): string[]
  registry?: {
    workspaceId(dir: string | undefined): string | undefined
    get(skillId: string, scope: Scope, workspaceId?: string): Promise<LocalSkillRecord | undefined>
    put(item: LocalSkillRecord): Promise<void>
    remove(skillId: string, scope: Scope, workspaceId?: string): Promise<void>
    cas?(
      skillId: string,
      scope: Scope,
      workspaceId: string | undefined,
      before: LocalSkillRecord | undefined,
      after: LocalSkillRecord | undefined,
    ): Promise<boolean>
  }
}

export class MarketTransactionManager {
  private readonly ready: Promise<void>

  constructor(private readonly opts: MarketTransactionOptions) {
    this.ready = this.recover()
  }

  async execute(request: SkillMarketRequest, workspace: string): Promise<SkillMarketResult> {
    if (request.operation === "search") {
      const found = await this.opts.market.searchSkills({
        query: request.query,
        category: request.category,
        author: request.author,
        sort: request.sort,
        cursor: request.cursor,
        limit: request.limit,
      })
      const items = await Promise.all(
        found.items.map(async (item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          author: item.author,
          revision: item.revision,
          sha256: item.sha256,
          risk: item.risk,
          installed: {
            project: await exists(path.join(this.root("project", workspace), "skills", item.id)),
            global: await exists(path.join(this.root("global", workspace), "skills", item.id)),
          },
        })),
      )
      return {
        operation: request.operation,
        result: {
          items,
          ...(found.nextCursor ? { nextCursor: found.nextCursor } : {}),
        },
      }
    }

    await this.ready
    if (request.operation === "begin") return this.begin(request.skillId, request.scope, request.intents, workspace)
    if (request.operation === "list") return this.list(request.limit, workspace)
    if (request.operation === "prepare_create") return this.create(request, workspace)
    if (request.operation === "prepare_install") return this.install(request, workspace)
    if (request.operation === "prepare_publish") return this.publish(request, workspace)
    if (request.operation === "approve") return this.approve(request.transactionId, workspace)
    if (request.operation === "commit") return this.commit(request.transactionId, workspace)
    if (request.operation === "abort") return this.abort(request.transactionId, workspace)
    if (request.operation === "status") return this.status(request.transactionId, workspace)
    if (request.operation === "undo") return this.undo(request.transactionId, workspace)
    return this.purge(request.transactionId, workspace)
  }

  private async begin(skillId: string, scope: Scope, intents: Intent[], workspace: string) {
    safeId(skillId)
    const id = randomUUID()
    const root = this.root(scope, workspace)
    const now = new Date()
    const record: RecordFile = {
      version: 1,
      id,
      skillId,
      scope,
      intents: [...new Set(intents)],
      state: "OPEN",
      root,
      target: path.join(root, "skills", skillId),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + OPEN_TTL).toISOString(),
      approved: [],
      prepared: [],
      publishKey: `skill-market-${id}-publish`,
    }
    await fs.mkdir(this.dir(record), { recursive: true })
    await this.save(record)
    return result(record, "begin")
  }

  private async create(request: Extract<SkillMarketRequest, { operation: "prepare_create" }>, workspace: string) {
    const record = await this.parent(request.transactionId, request.skillId, request.scope, ["create"], workspace)
    this.assert(record, "create")
    if (record.prepared.includes("create")) return result(record, request.operation)
    if (await exists(record.target)) {
      if (!request.replace) throw new MarketTransactionError("conflict", "Skill already exists; set replace=true", record.id)
      record.beforeExists = true
      record.beforeSha256 = await digest(record.target)
    } else {
      record.beforeExists = false
    }
    record.beforeRegistry = await this.registry(record, workspace)
    const stage = this.stage(record)
    await fs.rm(stage, { recursive: true, force: true })
    await fs.mkdir(stage, { recursive: true })
    const seen = new Set<string>()
    const total = request.files.reduce((sum, file) => {
      const name = safePath(file.path)
      if (seen.has(name)) throw new MarketTransactionError("validation_failed", `Duplicate file: ${name}`, record.id)
      seen.add(name)
      const data = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8")
      if (data.length > MAX_FILE) throw new MarketTransactionError("validation_failed", `File too large: ${name}`, record.id)
      return sum + data.length
    }, 0)
    if (total > MAX_TOTAL) throw new MarketTransactionError("validation_failed", "Skill exceeds 100 MiB", record.id)
    for (const file of request.files) {
      const name = safePath(file.path)
      const data = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8")
      const target = path.join(stage, name)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, data, { flag: "wx" })
    }
    await this.validate(record)
    record.afterSha256 = await digest(stage)
    record.prepared.push("create")
    record.state = "PREPARED"
    await this.save(record)
    return result(record, request.operation, { files: request.files.length, bytes: total, replace: request.replace })
  }

  private async install(request: Extract<SkillMarketRequest, { operation: "prepare_install" }>, workspace: string) {
    const record = await this.parent(request.transactionId, request.skillId, request.scope, ["install"], workspace)
    this.assert(record, "install")
    if (record.prepared.includes("install")) return result(record, request.operation)
    const detail = await this.opts.market.skill(request.skillId)
    const revision = request.revision ?? detail.latestRevision
    const release = detail.releases.find((item) => item.revision === revision)
    if (!release) throw new MarketTransactionError("not_found", "Requested Skill revision was not found", record.id)
    if (detail.risk.level === "critical" || release.report.risk?.level === "critical") {
      throw new MarketTransactionError("security_rejected", "Critical-risk Skill cannot be installed", record.id)
    }
    if (await exists(record.target)) {
      const current = await digest(record.target)
      record.beforeExists = true
      record.beforeSha256 = current
    } else {
      record.beforeExists = false
    }
    record.beforeRegistry = await this.registry(record, workspace)
    const response = await fetch(new URL(release.archiveUrl, this.opts.market.serverBaseUrl()))
    if (!response.ok) throw new MarketTransactionError("host_error", `Skill download failed: ${response.status}`, record.id)
    const length = Number(response.headers.get("content-length"))
    if (Number.isFinite(length) && length > SKILL_LIMITS.uploadBytes) {
      throw new MarketTransactionError("validation_failed", "Skill archive exceeds 50 MiB", record.id)
    }
    const archive = Buffer.from(await response.arrayBuffer())
    if (archive.length > SKILL_LIMITS.uploadBytes) {
      throw new MarketTransactionError("validation_failed", "Skill archive exceeds 50 MiB", record.id)
    }
    const actual = createHash("sha256").update(archive).digest("hex")
    if (actual !== release.sha256) throw new MarketTransactionError("validation_failed", "Archive SHA-256 mismatch", record.id)
    const snapshot = validateSkillArchive(archive)
    if (!snapshot.valid) {
      throw new MarketTransactionError("validation_failed", "Skill archive failed shared Skill Spec validation", record.id)
    }
    if (snapshot.risk.level === "critical") {
      throw new MarketTransactionError("security_rejected", "Critical-risk Skill cannot be installed", record.id)
    }
    const archivePath = path.join(this.dir(record), "archive.tar.gz")
    const stage = this.stage(record)
    await fs.rm(stage, { recursive: true, force: true })
    await fs.mkdir(stage, { recursive: true })
    await fs.writeFile(archivePath, archive)
    const listing = await exec("tar", ["-tzf", archivePath])
    for (const entry of listing.stdout.split(/\r?\n/).filter(Boolean)) safeArchive(entry, request.skillId)
    await exec("tar", ["-xzf", archivePath, "--strip-components=1", "-C", stage])
    await this.validate(record)
    const staged = await digest(stage)
    if (record.beforeSha256 === staged) {
      record.afterSha256 = staged
      record.state = "COMMITTED"
      await fs.rm(stage, { recursive: true, force: true })
      await this.save(record)
      return result(record, request.operation, { unchanged: true, revision, sha256: actual })
    }
    if (record.beforeExists && !request.replace) {
      throw new MarketTransactionError("conflict", "Installed Skill differs; set replace=true", record.id)
    }
    record.revision = revision
    record.archiveSha256 = actual
    record.afterSha256 = staged
    record.prepared.push("install")
    record.state = "PREPARED"
    await this.save(record)
    return result(record, request.operation, { revision, sha256: actual, replace: request.replace })
  }

  private async publish(request: Extract<SkillMarketRequest, { operation: "prepare_publish" }>, workspace: string) {
    const record = await this.parent(request.transactionId, request.skillId, request.scope, ["publish"], workspace)
    this.assert(record, "publish")
    const source = record.prepared.some((item) => item === "create" || item === "install")
      ? this.stage(record)
      : record.target
    if (!(await exists(source))) throw new MarketTransactionError("not_found", "Local Skill was not found", record.id)
    const sha = await digest(source)
    if (!record.prepared.some((item) => item === "create" || item === "install")) {
      record.beforeExists = true
      record.beforeSha256 = sha
      record.afterSha256 = sha
    }
    if (request.expectedSha256 && request.expectedSha256 !== sha) {
      throw new MarketTransactionError("stale_target", "Local Skill hash does not match expectedSha256", record.id)
    }
    const payload = await buildMarketplaceSkillUploadPayload(source)
    if (payload.id !== request.skillId) throw new MarketTransactionError("validation_failed", "Skill ID does not match SKILL.md", record.id)
    if (!record.prepared.includes("publish")) record.prepared.push("publish")
    record.state = "PREPARED"
    await this.save(record)
    return result(record, request.operation, { sha256: sha, files: payload.files.length, notes: request.notes })
  }

  private async approve(id: string, workspace: string) {
    const record = await this.load(id, workspace)
    for (const intent of record.prepared) if (!record.approved.includes(intent)) record.approved.push(intent)
    await this.save(record)
    return result(record, "approve")
  }

  private async commit(id: string, workspace: string) {
    const record = await this.load(id, workspace)
    if (record.state === "COMMITTED") return result(record, "commit")
    if (record.state === "REMOTE_UNCERTAIN") return this.resume(record)
    if (record.state !== "PREPARED" || record.prepared.some((item) => !record.approved.includes(item))) {
      throw new MarketTransactionError("conflict", "Transaction is not fully prepared and approved", id)
    }
    const lock = await this.lock(record)
    record.state = "COMMITTING"
    await this.save(record)
    try {
      const current = (await exists(record.target)) ? await digest(record.target) : undefined
      if (current !== record.beforeSha256) throw new MarketTransactionError("stale_target", "Skill changed after approval", id)
      if (record.prepared.some((item) => item === "create" || item === "install")) {
        await this.commitLocal(record, workspace)
      }
      if (record.prepared.includes("publish")) await this.commitPublish(record)
      record.state = "COMMITTED"
      record.undoUntil = new Date(Date.now() + UNDO_TTL).toISOString()
      await this.save(record)
      await this.retain(record.root)
      return result(record, "commit", { path: record.target, revision: record.revision })
    } catch (error) {
      if (record.remoteStarted && !(error instanceof MarketTransactionError)) {
        record.state = "REMOTE_UNCERTAIN"
        record.error = error instanceof Error ? error.message : String(error)
        await this.save(record)
        throw new MarketTransactionError("remote_uncertain", "Publication outcome is not yet confirmed", record.id)
      }
      await this.rollback(record, error)
      throw error
    } finally {
      await this.unlock(lock)
    }
  }

  private async abort(id: string, workspace: string) {
    const record = await this.load(id, workspace)
    if (record.state === "COMMITTED") return this.undo(id, workspace)
    record.state = "ABORTED"
    await this.save(record)
    await fs.rm(this.stage(record), { recursive: true, force: true })
    return result(record, "abort")
  }

  private async status(id: string, workspace: string) {
    return result(await this.load(id, workspace), "status")
  }

  private async list(limit: number, workspace: string) {
    const roots = [this.root("project", workspace), this.root("global", workspace)]
    const records = (await Promise.all(roots.map((root) => this.records(root)))).flat()
    records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { operation: "list", result: { transactions: records.slice(0, limit).map(summary) } }
  }

  private async undo(id: string, workspace: string) {
    const record = await this.load(id, workspace)
    if (record.state === "UNDONE") return result(record, "undo")
    if (record.state !== "COMMITTED") throw new MarketTransactionError("conflict", "Only committed transactions can be undone", id)
    const lock = await this.lock(record)
    try {
      return await this.undoRecord(record, workspace)
    } finally {
      await this.unlock(lock)
    }
  }

  private async undoRecord(record: RecordFile, workspace: string) {
    const id = record.id
    if (!record.undoUntil || Date.parse(record.undoUntil) < Date.now()) {
      record.state = "EXPIRED"
      await this.save(record)
      throw new MarketTransactionError("undo_expired", "Undo retention has expired", id)
    }
    const current = (await exists(record.target)) ? await digest(record.target) : undefined
    if (current !== record.afterSha256) {
      record.state = "MANUAL_INTERVENTION"
      await this.save(record)
      throw new MarketTransactionError("undo_conflict", "Skill changed after commit; refusing to overwrite it", id)
    }
    record.state = "UNDOING"
    await this.save(record)
    const local = record.prepared.some((item) => item === "create" || item === "install")
    const currentPath = path.join(this.dir(record), "undo-current")
    if (local) await this.undoLocal(record, workspace, currentPath)
    try {
      await this.undoPublish(record)
    } catch (error) {
      if (local) await this.restoreUndo(record, currentPath)
      record.state = "COMMITTED"
      await this.save(record)
      throw error
    }
    record.state = "UNDONE"
    await this.save(record)
    return result(record, "undo")
  }

  private async purge(id: string, workspace: string) {
    const record = await this.load(id, workspace)
    await fs.rm(this.dir(record), { recursive: true, force: true })
    return { operation: "purge", transactionId: id, skillId: record.skillId, scope: record.scope, result: { purged: true } }
  }

  private async rollback(record: RecordFile, error: unknown) {
    record.state = "ROLLING_BACK"
    record.error = error instanceof Error ? error.message : String(error)
    await this.save(record)
    const present = await exists(record.target)
    const current = present ? await digest(record.target) : undefined
    if (record.prepared.some((item) => item === "create" || item === "install")) {
      const before = await exists(this.before(record))
      if (record.localStarted) {
        const known = current === record.afterSha256 || current === record.beforeSha256 || (!present && before)
        if (!known) {
          record.state = "MANUAL_INTERVENTION"
          await this.save(record)
          throw new MarketTransactionError("manual_intervention", "Rollback would overwrite later changes", record.id)
        }
        if (current === record.afterSha256) await fs.rm(record.target, { recursive: true, force: true })
        if (record.beforeExists && before) {
          if (await exists(record.target)) await fs.rm(record.target, { recursive: true, force: true })
          await fs.rename(this.before(record), record.target)
        }
      }
      if (record.afterRegistry) {
        await this.restoreRegistry(record, record.scope === "project" ? path.dirname(record.root) : "")
      }
    }
    record.state = "ROLLED_BACK"
    await this.save(record)
  }

  private async recover() {
    const roots = [this.opts.global, ...(this.opts.workspaces?.() ?? []).map((workspace) => this.root("project", workspace))]
    for (const root of [...new Set(roots)]) {
      for (const record of await this.records(root)) {
        const lock = await this.lock(record).catch((error: unknown) => {
          if (error instanceof MarketTransactionError && error.code === "locked") return undefined
          throw error
        })
        if (!lock) continue
        try {
          if (record.state === "COMMITTING" || record.state === "REMOTE_UNCERTAIN") {
            const current = (await exists(record.target)) ? await digest(record.target) : undefined
            if (record.prepared.includes("publish") && record.afterSha256 && current === record.afterSha256) {
              await this.resume(record).catch(() => undefined)
              continue
            }
          }
          if (record.state === "UNDOING") {
            await this.continueUndo(record, record.scope === "project" ? path.dirname(record.root) : "").catch(
              async (error: unknown) => {
                record.state = "MANUAL_INTERVENTION"
                record.error = error instanceof Error ? error.message : String(error)
                await this.save(record)
              },
            )
            continue
          }
          if (record.state === "COMMITTING" || record.state === "ROLLING_BACK") {
            await this.rollback(record, new Error("Recovered interrupted transaction")).catch(async (error: unknown) => {
              record.state = "MANUAL_INTERVENTION"
              record.error = error instanceof Error ? error.message : String(error)
              await this.save(record)
            })
            continue
          }
          if (["OPEN", "PREPARING", "PREPARED"].includes(record.state) && Date.parse(record.expiresAt) < Date.now()) {
            record.state = "ABORTED"
            await this.save(record)
            await fs.rm(this.stage(record), { recursive: true, force: true })
          }
        } finally {
          await this.unlock(lock)
        }
      }
    }
  }

  private async validate(record: RecordFile) {
    const candidates = await discoverSkillCandidates(this.stage(record))
    const candidate = candidates.find((item) => item.key === "0:.") ?? candidates[0]
    if (!candidate?.snapshot.valid) throw new MarketTransactionError("validation_failed", "Skill does not satisfy the shared Skill Spec", record.id)
    if (candidate.snapshot.spec.id !== record.skillId) throw new MarketTransactionError("validation_failed", "Skill ID does not match SKILL.md", record.id)
    if (candidate.snapshot.risk?.level === "critical") throw new MarketTransactionError("security_rejected", "Critical-risk Skill is blocked", record.id)
  }

  private async parent(id: string | undefined, skillId: string, scope: Scope, intents: Intent[], workspace: string) {
    if (!id) return this.begin(skillId, scope, intents, workspace).then((value) => this.load(value.transactionId!, workspace))
    const record = await this.load(id, workspace)
    if (record.skillId !== skillId || record.scope !== scope) throw new MarketTransactionError("conflict", "Parent transaction target does not match", id)
    return record
  }

  private assert(record: RecordFile, intent: Intent) {
    if (!record.intents.includes(intent)) throw new MarketTransactionError("conflict", `Transaction does not allow ${intent}`, record.id)
    if (!["OPEN", "PREPARING", "PREPARED"].includes(record.state)) throw new MarketTransactionError("conflict", `Transaction is ${record.state}`, record.id)
  }

  private root(scope: Scope, workspace: string) {
    return scope === "project" ? path.join(workspace, ".chipmate-v2") : this.opts.global
  }

  private dir(record: RecordFile) {
    return path.join(record.root, ".marketplace-transactions", record.id)
  }

  private stage(record: RecordFile) {
    return path.join(this.dir(record), "stage", "skill")
  }

  private before(record: RecordFile) {
    return path.join(this.dir(record), "before", "skill")
  }

  private async load(id: string, workspace: string) {
    for (const root of [this.root("project", workspace), this.root("global", workspace)]) {
      const file = path.join(root, ".marketplace-transactions", id, "record.json")
      const value = await fs.readFile(file, "utf8").catch(() => undefined)
      if (value) return JSON.parse(value) as RecordFile
    }
    throw new MarketTransactionError("not_found", "Skill transaction was not found", id)
  }

  private async save(record: RecordFile) {
    record.updatedAt = new Date().toISOString()
    const dir = this.dir(record)
    const file = path.join(dir, "record.json")
    const temp = path.join(dir, `.record-${randomUUID()}.tmp`)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    const handle = await fs.open(temp, "r")
    await handle.sync()
    await handle.close()
    await fs.rename(temp, file)
  }

  private async records(root: string) {
    const base = path.join(root, ".marketplace-transactions")
    const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => [])
    return Promise.all(
      entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const text = await fs.readFile(path.join(base, entry.name, "record.json"), "utf8")
        return JSON.parse(text) as RecordFile
      }),
    ).catch(() => [] as RecordFile[])
  }

  private async retain(root: string) {
    const committed = (await this.records(root))
      .filter((record) => record.state === "COMMITTED")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    for (const record of committed.slice(MAX_RETAINED)) {
      record.state = "EXPIRED"
      await this.save(record)
      await fs.rm(this.before(record), { recursive: true, force: true })
    }
  }

  private async lock(record: RecordFile) {
    const file = `${record.target}.market.lock`
    await fs.mkdir(path.dirname(record.target), { recursive: true })
    const handle = await fs.open(file, "wx").catch(async (error: unknown) => {
      if ((error as { code?: string }).code !== "EEXIST") throw error
      const owner = await fs.readFile(file, "utf8").then(
        (value) => JSON.parse(value) as { pid?: number },
        () => ({ pid: undefined } as { pid?: number }),
      )
      if (owner.pid && alive(owner.pid)) {
        throw new MarketTransactionError("locked", "Another process is updating this Skill", record.id)
      }
      const age = Date.now() - (await fs.stat(file)).mtimeMs
      if (!owner.pid && age < LOCK_STALE) {
        throw new MarketTransactionError("locked", "Another process is acquiring this Skill lock", record.id)
      }
      await fs.rm(file, { force: true })
      return fs.open(file, "wx")
    })
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, transactionId: record.id })}\n`)
    await handle.sync()
    return { path: file, handle }
  }

  private async unlock(lock: { path: string; handle: Awaited<ReturnType<typeof fs.open>> }) {
    await lock.handle.close()
    await fs.rm(lock.path, { force: true })
  }

  private async commitLocal(record: RecordFile, workspace: string) {
    const before = this.before(record)
    record.localStarted = true
    await this.save(record)
    await fs.rm(before, { recursive: true, force: true })
    if (record.beforeExists) await fs.rename(record.target, before)
    await fs.rename(this.stage(record), record.target)
    record.afterSha256 = await digest(record.target)
    if (this.opts.registry) {
      const workspaceId = this.opts.registry.workspaceId(record.scope === "project" ? workspace : undefined)
      record.afterRegistry = {
        version: 1,
        skillId: record.skillId,
        scope: record.scope,
        ...(workspaceId ? { workspaceId } : {}),
        sourceKind: "directory",
        sourceLabel: record.prepared.includes("install") ? "skill-market" : "model-created",
        sourceSha256: record.archiveSha256 ?? record.afterSha256,
        installedSha256: record.afterSha256,
        specVersion: "1",
        hints: ["opencode"],
        importedAt: new Date().toISOString(),
      }
      await this.save(record)
      const changed = this.opts.registry.cas
        ? await this.opts.registry.cas(
            record.skillId,
            record.scope,
            workspaceId,
            record.beforeRegistry,
            record.afterRegistry,
          )
        : (await this.opts.registry.put(record.afterRegistry), true)
      if (!changed) throw new MarketTransactionError("stale_target", "Skill registry changed after approval", record.id)
    }
    await this.save(record)
  }

  private async commitPublish(record: RecordFile) {
    const key = await this.opts.key()
    if (!key) throw new MarketTransactionError("auth_required", "No provider API key is available", record.id)
    const payload = await buildMarketplaceSkillUploadPayload(record.target)
    record.remoteStarted = true
    await this.save(record)
    const run = await this.opts.market
      .uploadSkill(payload, key, record.publishKey)
      .catch(() => this.opts.market.uploadSkill(payload, key, record.publishKey))
    if (!run || (run.status !== "PUBLISHED" && run.status !== "UNCHANGED")) {
      throw new MarketTransactionError("validation_failed", `Publication ended in ${run?.status ?? "FAILED"}`, record.id)
    }
    record.publishRunId = run.id
    record.revision = run.release?.revision
  }

  private async resume(record: RecordFile) {
    try {
      await this.commitPublish(record)
      record.state = "COMMITTED"
      record.undoUntil = new Date(Date.now() + UNDO_TTL).toISOString()
      await this.save(record)
      await this.retain(record.root)
      return result(record, "commit", { path: record.target, revision: record.revision })
    } catch (error) {
      if (error instanceof MarketTransactionError && error.code !== "remote_uncertain") {
        await this.rollback(record, error)
        throw error
      }
      record.state = "REMOTE_UNCERTAIN"
      record.error = error instanceof Error ? error.message : String(error)
      await this.save(record)
      throw new MarketTransactionError("remote_uncertain", "Publication outcome is not yet confirmed", record.id)
    }
  }

  private async undoLocal(record: RecordFile, workspace: string, currentPath: string) {
    const current = await this.registry(record, workspace)
    if (JSON.stringify(current) !== JSON.stringify(record.afterRegistry)) {
      record.state = "MANUAL_INTERVENTION"
      await this.save(record)
      throw new MarketTransactionError("undo_conflict", "Skill registry changed after commit", record.id)
    }
    await fs.rm(currentPath, { recursive: true, force: true })
    if (await exists(record.target)) await fs.rename(record.target, currentPath)
    if (record.beforeExists && (await exists(this.before(record)))) await fs.rename(this.before(record), record.target)
    await this.restoreRegistry(record, workspace)
  }

  private async continueUndo(record: RecordFile, workspace: string) {
    const local = record.prepared.some((item) => item === "create" || item === "install")
    const currentPath = path.join(this.dir(record), "undo-current")
    if (local && !(await exists(currentPath))) {
      const current = (await exists(record.target)) ? await digest(record.target) : undefined
      if (current !== record.afterSha256) {
        throw new MarketTransactionError("undo_conflict", "Skill changed during interrupted undo", record.id)
      }
      await fs.rename(record.target, currentPath)
    }
    if (local && record.beforeExists && !(await exists(record.target)) && (await exists(this.before(record)))) {
      await fs.rename(this.before(record), record.target)
    }
    if (local && record.afterRegistry) await this.restoreRegistry(record, workspace)
    await this.undoPublish(record)
    record.state = "UNDONE"
    await this.save(record)
  }

  private async undoPublish(record: RecordFile) {
    if (!record.publishRunId) return
    const key = await this.opts.key()
    if (!key) throw new MarketTransactionError("auth_required", "No provider API key is available", record.id)
    await this.opts.market.undoPublication(record.publishRunId, key, `${record.publishKey}-undo`)
  }

  private async restoreUndo(record: RecordFile, currentPath: string) {
    if (record.afterRegistry) await this.opts.registry?.put(record.afterRegistry)
    if (record.beforeExists && (await exists(record.target))) await fs.rename(record.target, this.before(record))
    if (await exists(currentPath)) await fs.rename(currentPath, record.target)
  }

  private registry(record: RecordFile, workspace: string) {
    const workspaceId = this.opts.registry?.workspaceId(record.scope === "project" ? workspace : undefined)
    return this.opts.registry?.get(record.skillId, record.scope, workspaceId)
  }

  private async restoreRegistry(record: RecordFile, workspace: string) {
    if (!this.opts.registry) return
    const workspaceId = this.opts.registry.workspaceId(record.scope === "project" ? workspace : undefined)
    const current = await this.opts.registry.get(record.skillId, record.scope, workspaceId)
    if (same(current, record.beforeRegistry)) return
    if (!same(current, record.afterRegistry)) {
      throw new MarketTransactionError("manual_intervention", "Skill registry changed after transaction write", record.id)
    }
    if (this.opts.registry.cas) {
      const changed = await this.opts.registry.cas(
        record.skillId,
        record.scope,
        workspaceId,
        record.afterRegistry,
        record.beforeRegistry,
      )
      if (!changed) throw new MarketTransactionError("manual_intervention", "Skill registry CAS failed", record.id)
      return
    }
    if (record.beforeRegistry) {
      await this.opts.registry.put(record.beforeRegistry)
      return
    }
    await this.opts.registry.remove(record.skillId, record.scope, workspaceId)
  }
}

function result(record: RecordFile, operation: string, preview?: Record<string, unknown>): SkillMarketResult {
  return {
    operation,
    transactionId: record.id,
    state: record.state,
    skillId: record.skillId,
    scope: record.scope,
    ...(preview ? { preview } : {}),
    ...(record.undoUntil ? { undoUntil: record.undoUntil } : {}),
  }
}

function summary(record: RecordFile) {
  return {
    transactionId: record.id,
    skillId: record.skillId,
    scope: record.scope,
    state: record.state,
    updatedAt: record.updatedAt,
    undoUntil: record.undoUntil,
  }
}

function safeId(id: string) {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id)) throw new MarketTransactionError("validation_failed", "Invalid Skill ID")
}

function safePath(value: string) {
  if (Buffer.byteLength(value) > 1024 || path.isAbsolute(value)) throw new MarketTransactionError("validation_failed", "Invalid Skill path")
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new MarketTransactionError("validation_failed", `Unsafe Skill path: ${value}`)
  }
  return normalized
}

function safeArchive(value: string, id: string) {
  const normalized = value.replaceAll("\\", "/").replace(/\/$/, "")
  if (!normalized) return
  const parts = normalized.split("/")
  if (parts[0] !== id || parts.some((part) => !part || part === "." || part === "..")) {
    throw new MarketTransactionError("validation_failed", "Archive contains unsafe paths")
  }
}

async function exists(target: string) {
  return fs.access(target).then(
    () => true,
    () => false,
  )
}

async function digest(root: string) {
  const hash = createHash("sha256")
  const walk = async (dir: string, base = "") => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const name = path.posix.join(base, entry.name)
      const target = path.join(dir, entry.name)
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new MarketTransactionError("security_rejected", `Unsupported Skill entry: ${name}`)
      }
      if (entry.isDirectory()) await walk(target, name)
      if (entry.isFile()) hash.update(name).update("\0").update(await fs.readFile(target)).update("\0")
    }
  }
  await walk(root)
  return hash.digest("hex")
}

function same(left: LocalSkillRecord | undefined, right: LocalSkillRecord | undefined) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
