import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream, existsSync, mkdirSync } from "node:fs"
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { FastifyInstance, FastifyReply } from "fastify"
import type { ExtensionArtifactItem, MarketDb } from "@chipmate/market-db"
import { MarketEvents } from "./events.ts"
import { Identity, sendIdentityError, type ResolveUser } from "./identity.ts"
import {
  UPLOAD_MAX_ACTIVE,
  UPLOAD_MAX_BYTES,
  UPLOAD_MIN_FREE_BYTES,
  UploadAdmissionError,
  UploadGate,
} from "./upload-gate.ts"
import { inspectVsix, safeVsixFilename } from "./vsix.ts"

const MAX = UPLOAD_MAX_BYTES
const IDLE_TIMEOUT = 60_000
const ABSOLUTE_TIMEOUT = 2 * 60 * 60 * 1_000
const SOURCES = new Set(["home", "search", "detail", "external", "vscode"])

interface Options {
  root: string
  events: MarketEvents
  resolveUser?: ResolveUser
  now?: () => number
  scanMs?: number
  activeUploads?: number
  minimumFreeBytes?: number
  uploadIdleMs?: number
  uploadMaxMs?: number
  ownerBindings?: Record<string, string>
  packageRoot?: string
}

interface Query {
  q?: string
  category?: string
  target?: string
  uploader?: string
  sort?: "downloads" | "rating" | "favorites" | "updated" | "name"
  limit?: string
  cursor?: string
}

export class ExtensionRuntime {
  readonly root: string
  readonly drop: string
  readonly artifacts: string
  readonly tmp: string
  private readonly stable = new Map<string, { signature: string; count: number }>()
  private readonly imported = new Map<string, string>()
  private readonly legacy = new Map<string, { signature: string; valid: boolean }>()
  private readonly warnings = new Map<string, string>()
  private timer?: NodeJS.Timeout
  private scanning = false
  private syncing?: Promise<void>

  constructor(
    private readonly db: MarketDb,
    private readonly events: MarketEvents,
    private readonly scanMs = 5_000,
    root = "/data/skill-market/extensions",
    private readonly gate?: UploadGate,
    private readonly bindings: Record<string, string> = {},
    private readonly packages = process.env.PACKAGE_ROOT?.trim() || "/packages",
  ) {
    this.root = root
    this.drop = join(root, "drop")
    this.artifacts = join(root, "artifacts")
    this.tmp = join(root, ".tmp")
    mkdirSync(this.drop, { recursive: true })
    mkdirSync(this.artifacts, { recursive: true })
    mkdirSync(this.tmp, { recursive: true })
  }

  async start(): Promise<void> {
    await Promise.all([mkdir(this.drop, { recursive: true }), mkdir(this.artifacts, { recursive: true }), mkdir(this.tmp, { recursive: true })])
    await this.gate?.refresh()
    const stale = await readdir(this.tmp, { withFileTypes: true })
    await Promise.all(stale.map((entry) => rm(join(this.tmp, entry.name), { recursive: true, force: true })))
    await this.scan()
    this.timer = setInterval(() => void this.scan(), this.scanMs)
    this.timer.unref()
  }

  private async bindOwners(): Promise<void> {
    for (const [id, value] of Object.entries(this.bindings)) {
      const name = value.trim()
      if (!name) continue
      const user = await this.db.identity({
        id: `market-${createHash("sha256").update(name.toLocaleLowerCase()).digest("hex").slice(0, 40)}`,
        displayName: name,
      })
      try {
        await this.db.bindExtensionOwner(id.toLocaleLowerCase(), user.id, new Date().toISOString())
      } catch (err) {
        this.warnings.set(`owner:${id}`, message(err))
      }
    }
  }

  async syncLegacy(): Promise<void> {
    if (this.syncing) return this.syncing
    const task = this.loadLegacy()
    this.syncing = task
    try {
      await task
    } finally {
      if (this.syncing === task) delete this.syncing
    }
  }

  private async loadLegacy(): Promise<void> {
    const names = (await readdir(this.packages, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return []
      throw err
    }))
      .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".vsix"))
      .map((entry) => entry.name)
    const keys = new Set(names.map((name) => `packages:${name}`))
    const current = await this.db.extensionSystemSources()
    const active = new Set(current.map((item) => item.key))
    for (const name of this.legacy.keys()) {
      if (!keys.has(`packages:${name}`)) this.legacy.delete(name)
    }
    for (const item of current) {
      if (!item.key.startsWith("packages:") || keys.has(item.key)) continue
      await this.db.unlistExtensionSource(item.key, new Date().toISOString())
    }
    for (const name of names) {
      const path = join(this.packages, name)
      const key = `packages:${name}`
      try {
        const info = await stat(path)
        const signature = `${info.size}:${info.mtimeMs}`
        const cached = this.legacy.get(name)
        if (cached?.signature === signature && (!cached.valid || active.has(key))) continue
        await this.publish(path, await hash(path), info.size, safeVsixFilename(name), key, "system")
        this.legacy.set(name, { signature, valid: true })
        this.warnings.delete(key)
      } catch (err) {
        await this.db.unlistExtensionSource(key, new Date().toISOString())
        const info = await stat(path).catch(() => undefined)
        if (info) this.legacy.set(name, { signature: `${info.size}:${info.mtimeMs}`, valid: false })
        this.warnings.set(key, message(err))
      }
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async scan(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      const names = (await readdir(this.drop, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".vsix") && !entry.name.startsWith("."))
        .map((entry) => entry.name)
      const present = new Set(names)
      for (const name of this.stable.keys()) {
        if (present.has(name)) continue
        this.stable.delete(name)
        this.imported.delete(name)
        this.warnings.delete(name)
      }
      const keys = new Set(names.map((name) => `drop:${name}`))
      const current = await this.db.extensionSystemSources()
      for (const item of current) {
        if (!item.key.startsWith("drop:")) continue
        if (keys.has(item.key)) continue
        const removed = await this.db.unlistExtensionSource(item.key, new Date().toISOString())
        if (removed) this.events.publish("extension.catalog.changed", { extensionId: removed.extensionId })
      }
      for (const name of names) await this.inspect(name)
    } catch (err) {
      this.warnings.set("scanner", message(err))
    } finally {
      this.scanning = false
    }
  }

  health() {
    return {
      enabled: true,
      scanner: this.scanning ? "scanning" : "ready",
      drop: existsSync(this.drop),
      artifacts: existsSync(this.artifacts),
      temporary: existsSync(this.tmp),
      warnings: [...this.warnings.entries()].map(([file, warning]) => `${file}: ${warning}`),
      ...(this.gate?.health() ?? {}),
    }
  }

  async publish(
    file: string,
    sha256: string,
    size: number,
    filename: string,
    sourceKey: string,
    sourceKind: "system" | "web",
    uploader?: { id: string; name: string },
  ): Promise<{ artifact: ExtensionArtifactItem; duplicate: boolean }> {
    if (sourceKind === "web") {
      await this.syncLegacy()
      await this.bindOwners()
    }
    const manifest = await inspectVsix(file)
    const current = await this.db.extensionArtifactBySha(sha256)
    if (current) {
      const result = await this.db.publishExtension({
        id: current.id,
        sha256,
        size,
        path: current.path,
        filename,
        ...(uploader ? { uploaderId: uploader.id } : {}),
        uploaderName: uploader?.name ?? current.uploaderName,
        sourceKey,
        sourceKind,
        manifest,
        publishedAt: new Date().toISOString(),
      })
      if (sourceKind === "web") await rm(file, { force: true })
      return result
    }
    const id = `extension-${sha256.slice(0, 40)}`
    const path = sourceKind === "system" ? file : join(this.artifacts, manifest.id, `${sha256}.vsix`)
    if (sourceKind === "web") {
      await mkdir(join(this.artifacts, manifest.id), { recursive: true })
      await rename(file, path)
    }
    try {
      return await this.db.publishExtension({
        id,
        sha256,
        size,
        path,
        filename,
        ...(uploader ? { uploaderId: uploader.id } : {}),
        uploaderName: uploader?.name ?? "系统导入",
        sourceKey,
        sourceKind,
        manifest,
        publishedAt: new Date().toISOString(),
      })
    } catch (err) {
      if (sourceKind === "web") await rm(path, { force: true })
      throw err
    }
  }

  private async inspect(name: string): Promise<void> {
    const path = join(this.drop, name)
    const info = await stat(path)
    if (info.size > MAX) {
      this.warnings.set(name, "文件超过 512 MiB")
      return
    }
    const signature = `${info.size}:${info.mtimeMs}`
    const previous = this.stable.get(name)
    const count = previous?.signature === signature ? previous.count + 1 : 1
    this.stable.set(name, { signature, count })
    if (count < 2 || this.imported.get(name) === signature) return
    try {
      const digest = await hash(path)
      const key = `drop:${name}`
      const existing = (await this.db.extensionSystemSources()).find((item) => item.key === key)
      const same = existing ? await this.db.extensionArtifact(existing.artifactId) : undefined
      if (same?.sha256 !== digest) await this.db.unlistExtensionSource(key, new Date().toISOString())
      const result = await this.publish(path, digest, info.size, safeVsixFilename(name), key, "system")
      this.imported.set(name, signature)
      this.warnings.delete(name)
      this.events.publish("extension.catalog.changed", {
        extensionId: result.artifact.extensionId,
        artifactId: result.artifact.id,
        status: result.duplicate ? "DUPLICATE" : "PUBLISHED",
      })
    } catch (err) {
      this.warnings.set(name, message(err))
    }
  }
}

export function registerExtensions(app: FastifyInstance, db: MarketDb, opts: Options): ExtensionRuntime {
  const identity = new Identity(db, opts.resolveUser, opts.now)
  const gate = new UploadGate({
    root: opts.root,
    active: opts.activeUploads ?? UPLOAD_MAX_ACTIVE,
    free: opts.minimumFreeBytes ?? UPLOAD_MIN_FREE_BYTES,
  })
  const runtime = new ExtensionRuntime(
    db,
    opts.events,
    opts.scanMs,
    opts.root,
    gate,
    opts.ownerBindings,
    opts.packageRoot,
  )
  app.addContentTypeParser("application/vnd.microsoft.vscode.vsix", (_req, payload, done) => done(null, payload))

  app.get("/api/v1/extensions", async (req, reply) => {
    const query = req.query as Query
    const limit = integer(query.limit, 20, 1, 100)
    const offset = integer(query.cursor, 0, 0, 1_000_000)
    const items = await db.searchExtensions({
      ...(query.q ? { q: query.q } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.target ? { target: query.target } : {}),
      ...(query.uploader ? { uploader: query.uploader } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
      limit: limit + 1,
      offset,
    })
    const more = items.length > limit
    return reply.send({ items: items.slice(0, limit), ...(more ? { nextCursor: String(offset + limit) } : {}) })
  })

  app.get("/api/v1/extensions/:id", async (req, reply) => {
    const item = await db.getExtension((req.params as { id: string }).id)
    if (!item) return problem(reply, 404, "NOT_FOUND", "Extension not found.")
    return reply.send({ ...item, artifacts: item.artifacts.map(publicArtifact) })
  })

  app.post(
    "/api/v1/extension-publications",
    { config: { bodyLimit: MAX + 1 } },
    async (req, reply) => {
      let principal: Awaited<ReturnType<Identity["write"]>>
      try {
        principal = await identity.write(req)
      } catch (err) {
        return sendIdentityError(reply, err)
      }
      if (principal.mode !== "session") return problem(reply, 403, "AUTH_INVALID", "Web session is required.")
      const runId = header(req.headers["x-publication-run-id"])
      const key = header(req.headers["idempotency-key"])
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(runId) || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
        return problem(reply, 400, "VALIDATION_FAILED", "Publication and idempotency identifiers are required.")
      const filename = safeHeaderFilename(header(req.headers["x-vsix-filename"]))
      if (!filename) return problem(reply, 400, "VALIDATION_FAILED", "A valid .vsix filename is required.")
      const total = Number(header(req.headers["content-length"])) || 0
      if (total > MAX) return problem(reply, 413, "VALIDATION_FAILED", "VSIX exceeds 512 MiB.")
      const prior = await db.getExtensionPublication(runId, principal.user.id)
      if (prior) return reply.send(prior)
      const declared = Number(header(req.headers["content-length"]))
      const reserve = !req.headers["transfer-encoding"] && Number.isSafeInteger(declared) && declared > 0 && declared <= MAX
        ? declared
        : MAX
      const admission = await gate.claim(reserve).catch((err: unknown) => {
        if (err instanceof UploadAdmissionError) return err
        throw err
      })
      if (admission instanceof UploadAdmissionError) {
        if (admission.code === "PUBLICATION_BUSY") reply.header("retry-after", "5")
        return problem(
          reply,
          admission.code === "PUBLICATION_BUSY" ? 503 : 507,
          admission.code,
          admission.message,
        )
      }
      try {
        await db.extensionPublication({
          id: runId,
          ownerId: principal.user.id,
          filename,
          totalBytes: total,
          idempotencyKey: key,
          status: "UPLOADING",
          stage: "uploading",
        })
        opts.events.publish("extension.publication.changed", { runId, status: "UPLOADING", stage: "uploading" })
        const target = join(runtime.tmp, `${runId}.part`)
        try {
          const body = req.body
          if (!(body instanceof Readable)) throw new Error("INVALID_VSIX: streaming request body is required")
          const saved = await saveExtensionUpload(body, target, opts.uploadIdleMs, opts.uploadMaxMs)
          await db.extensionPublication({
            id: runId,
            ownerId: principal.user.id,
            filename,
            totalBytes: saved.size,
            idempotencyKey: key,
            status: "VALIDATING",
            stage: "validating",
            sha256: saved.sha256,
          })
          opts.events.publish("extension.publication.changed", { runId, status: "VALIDATING", stage: "validating" })
          const manifest = await inspectVsix(target)
          const peers = await db.extensionUpdateArtifacts(manifest.id)
          const notes = peers
            .filter((item) => item.version === manifest.version)
            .map((item) => item.manifest.releaseNotes?.trim())
            .filter((item): item is string => Boolean(item))
          if (manifest.releaseNotes && notes.some((item) => item !== manifest.releaseNotes)) {
            throw new Error(
              "EXTENSION_RELEASE_NOTES_CONFLICT: release notes must match every target for the same extension version",
            )
          }
          await db.extensionPublication({
            id: runId,
            ownerId: principal.user.id,
            filename,
            totalBytes: saved.size,
            idempotencyKey: key,
            status: "PUBLISHING",
            stage: "publishing",
            sha256: saved.sha256,
          })
          opts.events.publish("extension.publication.changed", {
            runId,
            extensionId: manifest.id,
            status: "PUBLISHING",
            stage: "publishing",
          })
          const result = await runtime.publish(
            target,
            saved.sha256,
            saved.size,
            filename,
            `upload:${runId}`,
            "web",
            { id: principal.user.id, name: principal.user.displayName },
          )
          const status = result.duplicate ? "DUPLICATE" : "PUBLISHED"
          const run = await db.extensionPublication({
            id: runId,
            ownerId: principal.user.id,
            filename,
            totalBytes: saved.size,
            idempotencyKey: key,
            status,
            stage: "complete",
            sha256: saved.sha256,
            artifactId: result.artifact.id,
          })
          opts.events.publish("extension.publication.changed", {
            runId,
            extensionId: result.artifact.extensionId,
            artifactId: result.artifact.id,
            status,
            stage: "complete",
          })
          opts.events.publish("extension.catalog.changed", { extensionId: result.artifact.extensionId })
          return reply.send({ ...run, artifact: publicArtifact(result.artifact) })
        } catch (err) {
          await rm(target, { force: true })
          const timedout = err instanceof UploadTimeoutError
          const cancelled = !timedout && (req.raw.aborted || message(err).includes("aborted"))
          const status = cancelled ? "CANCELLED" : "FAILED"
          await db.extensionPublication({
            id: runId,
            ownerId: principal.user.id,
            filename,
            totalBytes: total,
            idempotencyKey: key,
            status,
            stage: "complete",
            error: message(err),
          })
          opts.events.publish("extension.publication.changed", { runId, status, stage: "complete", error: message(err) })
          if (cancelled) return reply.code(499).send({ ok: false, code: "UPLOAD_CANCELLED", message: "Upload cancelled." })
          if (timedout) return problem(reply, 408, "UPLOAD_TIMEOUT", message(err))
          const conflict = publicationConflict(err)
          if (conflict) {
            return reply.code(409).send({
              ok: false,
              code: "EXTENSION_VERSION_CONFLICT",
              message: "同一扩展版本和平台已存在 SHA-256 不同的构建，未保存本次上传。",
              conflict,
            })
          }
          if (message(err).startsWith("EXTENSION_RELEASE_NOTES_CONFLICT:")) {
            return problem(
              reply,
              409,
              "EXTENSION_RELEASE_NOTES_CONFLICT",
              "同一扩展版本的不同平台包必须包含完全一致的更新说明。",
            )
          }
          if (message(err).includes("EXTENSION_OWNER_UNASSIGNED")) {
            return problem(
              reply,
              409,
              "EXTENSION_OWNER_UNASSIGNED",
              "This system extension has no publisher owner. Apply the one-time server owner binding before uploading.",
            )
          }
          if (message(err).includes("OWNERSHIP_REQUIRED")) {
            return problem(reply, 403, "OWNERSHIP_REQUIRED", "Only the original extension publisher can upload a new version.")
          }
          const tooLarge = message(err).includes("512 MiB")
          return problem(reply, tooLarge ? 413 : 400, "VALIDATION_FAILED", message(err))
        }
      } finally {
        await admission.release()
      }
    },
  )

  app.get("/api/v1/extension-publications/:runId", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      const run = await db.getExtensionPublication((req.params as { runId: string }).runId, principal.user.id)
      if (!run) return problem(reply, 404, "NOT_FOUND", "Publication not found.")
      return reply.send(run)
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/extensions/:id/artifacts/:artifactId/download", async (req, reply) => {
    if (req.headers.range) return reply.header("accept-ranges", "none").code(416).send()
    const params = req.params as { id: string; artifactId: string }
    const item = await db.extensionArtifact(params.artifactId)
    if (!item || item.extensionId !== params.id || item.status !== "published")
      return problem(reply, 404, "NOT_FOUND", "Extension artifact not found.")
    const source = normalizeSource((req.query as { source?: unknown }).source)
    const stream = createReadStream(item.path)
    let finished = false
    reply.raw.once("finish", () => {
      if (finished) return
      finished = true
      void db.extensionDownload({ id: `extension-download-${randomUUID()}`, artifactId: item.id, source, occurredAt: new Date().toISOString() })
    })
    return reply
      .header("content-type", "application/vnd.microsoft.vscode.vsix")
      .header("content-length", item.size)
      .header("content-disposition", disposition(item.filename))
      .header("accept-ranges", "none")
      .header("x-content-sha256", item.sha256)
      .send(stream)
  })

  app.put("/api/v1/extension-favorites/:id", async (req, reply) => favorite(req, reply, true))
  app.delete("/api/v1/extension-favorites/:id", async (req, reply) => favorite(req, reply, false))

  async function favorite(req: Parameters<Identity["write"]>[0], reply: FastifyReply, value: boolean) {
    try {
      const principal = await identity.write(req)
      const extensionId = (req.params as { id: string }).id
      if (!(await db.getExtension(extensionId))) return problem(reply, 404, "NOT_FOUND", "Extension not found.")
      const state = await db.extensionFavorite({ userId: principal.user.id, extensionId, value })
      opts.events.publish("extension.favorite.changed", state)
      return reply.send(state)
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  }

  app.get("/api/v1/extensions/:id/review", async (req, reply) => {
    const id = (req.params as { id: string }).id
    return reply.send(await db.extensionReviews(id))
  })

  app.put("/api/v1/extensions/:id/review", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      const id = (req.params as { id: string }).id
      const body = (req.body ?? {}) as { rating?: unknown; comment?: unknown; artifactId?: unknown }
      const rating = Number(body.rating)
      const comment = typeof body.comment === "string" ? body.comment.trim() : ""
      if (!Number.isSafeInteger(rating) || rating < 1 || rating > 5 || comment.length > 2_000)
        return problem(reply, 400, "VALIDATION_FAILED", "Rating must be 1-5 and comment at most 2000 characters.")
      if (!(await db.getExtension(id))) return problem(reply, 404, "NOT_FOUND", "Extension not found.")
      if (body.artifactId) {
        const artifact = await db.extensionArtifact(String(body.artifactId))
        if (!artifact || artifact.extensionId !== id)
          return problem(reply, 400, "VALIDATION_FAILED", "Review artifact does not belong to this extension.")
      }
      const review = await db.extensionReview({
        userId: principal.user.id,
        userName: principal.user.displayName,
        extensionId: id,
        ...(body.artifactId ? { artifactId: String(body.artifactId) } : {}),
        rating,
        comment,
      })
      opts.events.publish("extension.review.changed", { extensionId: id })
      return reply.send(review)
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.delete("/api/v1/extensions/:id/review", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      const extensionId = (req.params as { id: string }).id
      return reply.send({ deleted: await db.deleteExtensionReview(principal.user.id, extensionId) })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/me/extensions/uploads", async (req, reply) =>
    me(req, reply, async (id) => (await db.extensionUploads(id)).map(publicArtifact)),
  )
  app.get("/api/v1/me/extensions/favorites", async (req, reply) => me(req, reply, (id) => db.extensionFavorites(id)))
  app.get("/api/v1/me/extensions/reviews", async (req, reply) => me(req, reply, (id) => db.userExtensionReviews(id)))
  app.get("/api/v1/me/extensions/publications", async (req, reply) => me(req, reply, (id) => db.extensionPublications(id)))

  async function me(req: Parameters<Identity["principal"]>[0], reply: FastifyReply, load: (id: string) => Promise<unknown>) {
    try {
      return reply.send(await load((await identity.principal(req)).user.id))
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  }

  app.delete("/api/v1/extension-artifacts/:artifactId", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      const item = await db.removeExtensionArtifact(
        (req.params as { artifactId: string }).artifactId,
        principal.user.id,
        new Date().toISOString(),
      )
      opts.events.publish("extension.catalog.changed", { extensionId: item.extensionId })
      return reply.send(publicArtifact(item))
    } catch (err) {
      const value = message(err)
      if (value.includes("OWNERSHIP_REQUIRED")) return problem(reply, 403, "OWNERSHIP_REQUIRED", "Only the original extension publisher can delete this artifact.")
      if (value.includes("NOT_FOUND")) return problem(reply, 404, "NOT_FOUND", "Artifact not found.")
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/analytics/extensions/overview", async (_req, reply) => reply.send(await db.extensionAnalytics()))
  app.get("/api/v1/analytics/extension-artifacts/:artifactId/sources", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      return reply.send(await db.extensionSources((req.params as { artifactId: string }).artifactId, principal.user.id))
    } catch (err) {
      const value = message(err)
      if (value.includes("OWNERSHIP_REQUIRED")) return problem(reply, 403, "OWNERSHIP_REQUIRED", "Uploader access is required.")
      if (value.includes("NOT_FOUND")) return problem(reply, 404, "NOT_FOUND", "Artifact not found.")
      return sendIdentityError(reply, err)
    }
  })

  void runtime.start()
  app.addHook("onClose", () => runtime.stop())
  return runtime
}

class UploadTimeoutError extends Error {}

export async function saveExtensionUpload(
  input: Readable,
  path: string,
  idleMs = IDLE_TIMEOUT,
  maxMs = ABSOLUTE_TIMEOUT,
): Promise<{ sha256: string; size: number }> {
  const digest = createHash("sha256")
  const size = { value: 0 }
  const abort = new AbortController()
  const state: { idle?: NodeJS.Timeout; absolute?: NodeJS.Timeout; reason: string } = { reason: "" }
  const timeout = (reason: string) => {
    state.reason = reason
    abort.abort()
  }
  const refresh = () => {
    if (state.idle) clearTimeout(state.idle)
    state.idle = setTimeout(() => timeout("Upload was idle for longer than 60 seconds."), idleMs)
  }
  refresh()
  state.absolute = setTimeout(() => timeout("Upload exceeded the two hour time limit."), maxMs)
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      refresh()
      size.value += chunk.length
      if (size.value > MAX) return callback(new Error("VSIX exceeds 512 MiB"))
      digest.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(input, meter, createWriteStream(path, { flags: "wx" }), { signal: abort.signal })
  } catch (err) {
    if (state.reason) throw new UploadTimeoutError(state.reason)
    throw err
  } finally {
    if (state.idle) clearTimeout(state.idle)
    if (state.absolute) clearTimeout(state.absolute)
  }
  return { sha256: digest.digest("hex"), size: size.value }
}

async function hash(path: string): Promise<string> {
  const digest = createHash("sha256")
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer)
  return digest.digest("hex")
}

function safeHeaderFilename(value: string): string | undefined {
  try {
    return safeVsixFilename(decodeURIComponent(value))
  } catch (err) {
    console.warn("Invalid encoded VSIX filename", err)
    return undefined
  }
}

function disposition(filename: string): string {
  const fallback = basename(filename).replace(/[^A-Za-z0-9._-]/g, "-") || "extension.vsix"
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function normalizeSource(value: unknown): string {
  const source = typeof value === "string" ? value : "external"
  return SOURCES.has(source) ? source : "external"
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

function header(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

function problem(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ ok: false, code, message })
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function publicationConflict(err: unknown): Record<string, unknown> | undefined {
  const value = message(err)
  const raw = value.startsWith("EXTENSION_VERSION_CONFLICT:") ? value.slice("EXTENSION_VERSION_CONFLICT:".length) : ""
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
  } catch (error) {
    console.warn("Invalid extension conflict payload", error)
    return undefined
  }
}

function publicArtifact(item: ExtensionArtifactItem) {
  return {
    id: item.id,
    extensionId: item.extensionId,
    version: item.version,
    target: item.target,
    sha256: item.sha256,
    size: item.size,
    filename: item.filename,
    uploader: {
      ...(item.uploaderId ? { id: item.uploaderId } : {}),
      displayName: item.uploaderName,
    },
    source: item.source,
    prerelease: item.prerelease,
    conflict: item.conflict,
    downloads: item.downloads,
    publishedAt: item.publishedAt,
    status: item.status,
    releaseNotesAvailable: Boolean(item.manifest.releaseNotes?.trim()),
    downloadUrl: `/api/v1/extensions/${encodeURIComponent(item.extensionId)}/artifacts/${encodeURIComponent(item.id)}/download`,
  }
}
