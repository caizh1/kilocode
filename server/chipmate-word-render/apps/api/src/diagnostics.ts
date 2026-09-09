import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, lstat, readdir, rename, unlink, statfs } from "node:fs/promises"
import { join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { FastifyInstance, FastifyRequest } from "fastify"
import type { DiagnosticBundle, MarketDb } from "@chipmate/market-db"
import { Identity, IdentityError, sendIdentityError } from "./identity.ts"
import { DIAGNOSTIC_MAX, inspectDiagnostics } from "./diagnostics-archive.ts"

export const diagnosticCapabilities = { enabled: true, schemaVersion: 1, maxBytes: DIAGNOSTIC_MAX, retentionDays: 7 }
interface Options { root: string; identity: Identity; now?: (() => number) | undefined; quota?: number; active?: number; free?: number; timeout?: number }
const validId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)

export function registerDiagnostics(app: FastifyInstance, db: MarketDb, options: Options) {
  const now = options.now ?? Date.now
  const identity = options.identity
  const active = new Map<string, { owner: string; abort: AbortController; bytes: number }>()
  let reserved = 0
  let chain = Promise.resolve()
  let sweeping = false
  const lock = <T>(action: () => Promise<T>) => {
    const next = chain.then(action, action)
    chain = next.then(() => undefined, () => undefined)
    return next
  }
  const audit = (actor: string, action: string, id?: string) => db.authAudit({ actor, action: `diagnostics.${action}`, details: id ? { id } : {}, occurredAt: new Date(now()).toISOString() })
  const remove = async (file: string) => unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error })
  const file = (id: string, part = false) => join(options.root, `${id}.${part ? "part" : "zip"}`)
  async function sweep(start = false) {
    if (sweeping) return
    sweeping = true
    try {
      await mkdir(options.root, { recursive: true, mode: 0o700 })
      const root = await lstat(options.root)
      if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("诊断目录不可为链接")
      const expired = await db.diagnostics<DiagnosticBundle[]>({ action: "expired", now: new Date(now()).toISOString() })
      for (const item of expired) {
        await remove(file(item.id))
        await db.diagnostics({ action: "remove", id: item.id })
        await audit("system", "expired", item.id)
      }
      if (start) for (const name of await readdir(options.root)) {
        const id = name.replace(/\.(part|zip)$/, "")
        if (!validId(id) || !/\.(part|zip)$/.test(name)) continue
        if (name.endsWith(".part") || !await db.diagnostics({ action: "get", id })) await remove(join(options.root, name))
      }
    } finally { sweeping = false }
  }
  let timer: ReturnType<typeof setInterval> | undefined
  app.addHook("onReady", async () => {
    await sweep(true)
    timer = setInterval(() => { void sweep().catch(() => { console.error("诊断过期清理失败") }) }, 60_000)
    timer.unref()
  })
  app.addHook("onClose", async () => { if (timer) clearInterval(timer); for (const item of active.values()) item.abort.abort(); await chain })
  app.addContentTypeParser("application/vnd.chipmate.diagnostics+zip", (_req, body, done) => done(null, body))

  async function reader(req: FastifyRequest): Promise<{ owner?: string | undefined; actor: string }> {
    try {
      const principal = await identity.principal(req)
      const administrator = await db.isAdministrator(principal.subject)
      return { owner: administrator ? undefined : principal.user.id, actor: principal.user.id }
    } catch (error) {
      if (!(error instanceof IdentityError) || error.status !== 401) throw error
      const admin = await identity.admin(req)
      return { actor: admin.actor }
    }
  }
  function denied(reply: Parameters<typeof sendIdentityError>[0], error: unknown) {
    void audit("unauthorized", "denied").catch(() => console.error("诊断拒绝审计失败"))
    return sendIdentityError(reply, error)
  }
  app.get("/api/v1/diagnostics/bundles", async (req, reply) => {
    try {
      const access = await reader(req)
      const query = req.query as Record<string, string | undefined>
      const offset = Number(query.cursor ?? 0)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return reply.code(400).send({ message: "分页参数无效" })
      const items = await db.diagnostics<DiagnosticBundle[]>({ action: "list", ownerId: access.owner, query: query.q?.slice(0, 128), version: query.version?.slice(0, 128), platform: query.platform?.slice(0, 128), after: query.after, before: query.before, offset, now: new Date(now()).toISOString() })
      reply.header("cache-control", "no-store")
      return { items: items.slice(0, 50), ...(items.length > 50 ? { nextCursor: String(offset + 50) } : {}) }
    } catch (error) { return denied(reply, error) }
  })
  for (const archive of [false, true]) app.get(`/api/v1/diagnostics/bundles/:id${archive ? "/archive" : ""}`, async (req, reply) => {
    try {
      const access = await reader(req)
      const id = (req.params as { id: string }).id
      if (!validId(id)) return reply.code(404).send({ message: "诊断记录不存在" })
      const item = await db.diagnostics<DiagnosticBundle | undefined>({ action: "get", id })
      if (!item || (access.owner && item.ownerId !== access.owner) || Date.parse(item.expiresAt) <= now()) {
        const pending = active.get(id)
        if (!archive && pending && (!access.owner || pending.owner === access.owner)) return { id, status: "uploading" }
        return reply.code(404).send({ message: "诊断记录不存在或已到期" })
      }
      reply.header("cache-control", "private, no-store").header("x-content-type-options", "nosniff")
      if (!archive) return { ...item, status: "submitted" }
      const stat = await lstat(file(id)).catch(() => undefined)
      if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== item.size) return reply.code(410).send({ message: "诊断文件不可用" })
      await audit(access.actor, "download", id)
      reply.header("content-type", "application/zip").header("content-disposition", `attachment; filename="chipmate-diagnostics-${id}.zip"`).header("content-length", item.size).header("x-content-sha256", item.sha256)
      return reply.send(createReadStream(file(id)))
    } catch (error) { return denied(reply, error) }
  })
  app.post("/api/v1/diagnostics/bundles", { bodyLimit: DIAGNOSTIC_MAX + 1 }, async (req, reply) => {
    let principal: Awaited<ReturnType<Identity["write"]>>
    try { principal = await identity.write(req) } catch (error) { return denied(reply, error) }
    const id = String(req.headers["idempotency-key"] ?? "")
    const declared = String(req.headers["x-content-sha256"] ?? "")
    const length = Number(req.headers["content-length"])
    if (!validId(id) || !/^[a-f0-9]{64}$/.test(declared) || !Number.isSafeInteger(length) || length <= 0 || length > DIAGNOSTIC_MAX || !(req.body instanceof Readable)) return reply.code(400).send({ message: "诊断包标识、大小或格式无效" })
    const prior = await db.diagnostics<DiagnosticBundle | undefined>({ action: "get", id })
    if (prior && Date.parse(prior.expiresAt) <= now()) return reply.code(410).send({ message: "诊断编号已到期，请重新收集" })
    if (prior && (prior.ownerId !== principal.user.id || prior.sha256 !== declared)) return reply.code(409).send({ message: "诊断编号与现有内容不一致" })
    const controller = new AbortController()
    const admission = await lock(async () => {
      if (active.has(id)) return "该诊断正在提交"
      if (active.size >= (options.active ?? 4)) return "诊断上传繁忙"
      const usage = await db.diagnostics<number>({ action: "usage" })
      const storage = await statfs(options.root)
      if (usage + reserved + length > (options.quota ?? 10 * 1024 ** 3) || Number(storage.bavail) * Number(storage.bsize) - reserved - length < (options.free ?? 2 * 1024 ** 3)) return "诊断存储空间不足"
      reserved += length; active.set(id, { owner: principal.user.id, abort: controller, bytes: length }); return undefined
    }).catch(() => "诊断存储不可用")
    if (admission) return reply.code(503).header("retry-after", "5").send({ message: admission })
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 300_000)
    let idle = setTimeout(() => controller.abort(), 30_000)
    const disconnect = () => { if (!reply.raw.writableFinished) controller.abort() }
    req.raw.once("aborted", disconnect); reply.raw.once("close", disconnect)
    let committed = false
    try {
      const hash = createHash("sha256")
      let size = 0
      const meter = new Transform({ transform(chunk: Buffer, _encoding, next) {
        clearTimeout(idle); idle = setTimeout(() => controller.abort(), 30_000)
        size += chunk.length
        if (size > length || size > DIAGNOSTIC_MAX) { next(new Error("诊断包大小超限")); return }
        hash.update(chunk); next(null, chunk)
      } })
      await pipeline(req.body, meter, createWriteStream(file(id, true), { flags: "wx", mode: 0o600 }), { signal: controller.signal })
      clearTimeout(idle)
      if (size !== length || hash.digest("hex") !== declared) throw new Error("诊断包大小或 SHA-256 校验失败")
      const manifest = await inspectDiagnostics(file(id, true), controller.signal)
      if (manifest.id !== id) throw new Error("诊断清单编号与提交编号不一致")
      controller.signal.throwIfAborted()
      if (prior) return { ...prior, status: "submitted" }
      const item: DiagnosticBundle = { id, ownerId: principal.user.id, ownerName: principal.user.displayName, createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 7 * 86400_000).toISOString(), size, sha256: declared, version: manifest.version, platform: manifest.platform, from: manifest.from, to: manifest.to, summary: manifest.summary, partial: manifest.partial, sources: manifest.sources }
      await rename(file(id, true), file(id))
      try { await db.diagnostics({ action: "put", item }) } catch (error) { await remove(file(id)); throw error }
      committed = true
      await audit(principal.user.id, "submitted", id)
      return reply.code(201).send({ ...item, status: "submitted" })
    } catch (error) {
      if (committed) return reply.code(503).send({ id, message: "日志已保存，请按编号查询提交结果" })
      return reply.code(controller.signal.aborted ? 408 : 400).send({ message: controller.signal.aborted ? "诊断上传已中止或超时" : error instanceof Error ? error.message : "诊断接收失败" })
    } finally {
      clearTimeout(timeout); clearTimeout(idle); req.raw.removeListener("aborted", disconnect); reply.raw.removeListener("close", disconnect)
      await remove(file(id, true)).catch(() => console.error("诊断临时文件清理失败"))
      await lock(async () => { reserved -= length; active.delete(id) })
    }
  })
}
