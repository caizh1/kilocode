import { diagnosticCapabilities } from "./diagnostics.ts"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import type { FastifyInstance, FastifyReply } from "fastify"
import type {
  AnalyticsEvent,
  MarketCapabilities,
  SkillDetail,
  SkillRelease,
  SkillRiskSummary,
  SkillSummary,
  ValidationReport,
} from "@chipmate/market-contracts"
import type {
  EventInput,
  FilePreview,
  InstallationInput,
  MarketDb,
  PublicationItem,
  ReleaseItem,
  SearchItem,
} from "@chipmate/market-db"
import { SKILL_SPEC_VERSION } from "@chipmate/skill-spec"
import { Identity, IdentityError, isSecure, sendIdentityError } from "./identity.ts"
import type { LdapConfig } from "./ldap.ts"
import { MarketEvents } from "./events.ts"

interface Params {
  id: string
  revision?: string
  "*"?: string
}

interface Query {
  q?: string
  category?: string
  author?: string
  updatedAfter?: string
  sort?: "updated" | "downloads" | "favorites" | "name"
  limit?: string
  cursor?: string
  revision?: string
  catalogVersion?: string
}

interface AlignedOptions {
  identity?: Identity
  events?: MarketEvents
  now?: () => number
  extensionMarket?: boolean
  extensionStatus?: () => ExtensionStatus
}

interface ExtensionStatus {
  enabled: boolean
  scanner: string
  drop: boolean
  artifacts: boolean
  temporary: boolean
  warnings: string[]
  activeUploads?: number
  maxActiveUploads?: number
  reservedBytes?: number
  freeBytes?: number
  minimumFreeBytes?: number
  storagePressure?: boolean
}

interface InstallationBody {
  skillId?: string
  revision?: number
  sha256?: string
  scope?: "global" | "project"
  status?: InstallationInput["status"]
  clientId?: string
  workspaceId?: string
}

const EVENTS = new Set<AnalyticsEvent["name"]>([
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
])

const CONTEXT = new Set([
  "queryLength",
  "hasQuery",
  "category",
  "author",
  "sort",
  "source",
  "action",
  "status",
  "reason",
])

export function registerAligned(app: FastifyInstance, db: MarketDb, opts: AlignedOptions = {}) {
  const identity = opts.identity ?? new Identity(db)
  const now = opts.now ?? Date.now
  const events = opts.events ?? new MarketEvents()
  const searches = new Map<string, Promise<SearchItem[]>>()
  const publish = (name: string, payload: unknown) => events.publish(name, payload)

  app.get("/api/v1/capabilities", async (req, reply) =>
    cached(reply, req.headers["if-none-match"], await capabilities(db, opts.extensionMarket === true)),
  )

  app.get("/api/v1/auth/status", async (_req, reply) => reply.send(await identity.authStatus()))

  app.post("/api/v1/auth/session", async (req, reply) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown }
    const username = typeof body.username === "string" ? body.username.trim() : ""
    const password = typeof body.password === "string" ? body.password : ""
    if (!username || !password) return problem(reply, 400, "AUTH_INVALID", "用户名和密码为必填项。")
    try {
      const session = await identity.login(username, password, req.ip)
      identity.cookie(reply, session.token, isSecure(req))
      return reply
        .header("x-csrf-token", session.csrf)
        .send({ ...session.user, isAdmin: session.isAdmin, authSource: "ldap" })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.delete("/api/v1/auth/session", async (req, reply) => {
    try {
      await identity.logout(req)
      identity.clear(reply, isSecure(req))
      return reply.send({ ok: true })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/auth/me", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      return reply.send({ ...principal.user, isAdmin: principal.isAdmin, authSource: "ldap" })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/auth/device/code", async (req, reply) => {
    try {
      return reply.send(await identity.createDevice(origin(req)))
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/auth/device/approve", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      const userCode = typeof (req.body as { userCode?: unknown } | undefined)?.userCode === "string"
        ? (req.body as { userCode: string }).userCode
        : ""
      await identity.approveDevice(userCode, principal)
      return reply.send({ ok: true })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/auth/device/deny", async (req, reply) => {
    try {
      await identity.write(req)
      const userCode = typeof (req.body as { userCode?: unknown } | undefined)?.userCode === "string"
        ? (req.body as { userCode: string }).userCode
        : ""
      await identity.denyDevice(userCode)
      return reply.send({ ok: true })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/auth/device/token", async (req, reply) => {
    try {
      const deviceCode = typeof (req.body as { deviceCode?: unknown } | undefined)?.deviceCode === "string"
        ? (req.body as { deviceCode: string }).deviceCode
        : ""
      if (!deviceCode) return problem(reply, 400, "VALIDATION_FAILED", "deviceCode 为必填项。")
      const result = await identity.pollDevice(deviceCode)
      if (!("state" in result)) return reply.send(result)
      if (result.state === "pending") return problem(reply, 400, "AUTHORIZATION_PENDING", "等待用户批准。")
      if (result.state === "slow_down") {
        return reply.header("retry-after", String(result.interval ?? 10)).code(429).send({ ok: false, code: "SLOW_DOWN", message: "轮询过快。" })
      }
      if (result.state === "expired" || result.state === "consumed") {
        return problem(reply, 410, "DEVICE_CODE_EXPIRED", "设备码已过期或已使用。")
      }
      return problem(reply, result.state === "denied" ? 403 : 404, "DEVICE_CODE_INVALID", "设备码无效。")
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/auth/token/refresh", async (req, reply) => {
    try {
      const refreshToken = typeof (req.body as { refreshToken?: unknown } | undefined)?.refreshToken === "string"
        ? (req.body as { refreshToken: string }).refreshToken
        : ""
      return reply.send(await identity.refresh(refreshToken))
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/auth/token/revoke", async (req, reply) => {
    try {
      await identity.revoke(bearer(req.headers.authorization))
      return reply.send({ ok: true })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/admin/auth/session", async (req, reply) => {
    try {
      const key = typeof (req.body as { key?: unknown } | undefined)?.key === "string"
        ? (req.body as { key: string }).key
        : ""
      const session = await identity.breakGlassLogin(key)
      identity.adminCookie(reply, session.token, isSecure(req))
      return reply.header("x-csrf-token", session.csrf).send({ ok: true })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/admin/auth/session", async (req, reply) => {
    try { return reply.send(await identity.adminStatus(req, reply)) }
    catch (err) { return sendIdentityError(reply, err) }
  })

  app.delete("/api/v1/admin/auth/session", async (req, reply) => {
    try {
      await identity.adminLogout(req)
      identity.clearAdmin(reply, isSecure(req))
      return reply.send({ ok: true })
    } catch (err) { return sendIdentityError(reply, err) }
  })

  app.get("/api/v1/admin/auth/admins", async (req, reply) => {
    try {
      await identity.admin(req)
      return reply.header("cache-control", "no-store").send({ items: await db.administrators() })
    } catch (err) { return sendIdentityError(reply, err) }
  })

  app.post("/api/v1/admin/auth/admins/resolve", async (req, reply) => {
    try {
      await identity.admin(req, true)
      const body = req.body as { username?: unknown } | undefined
      if (typeof body?.username !== "string" || !body.username.trim()) return problem(reply, 400, "VALIDATION_FAILED", "请输入 LDAP 用户名。")
      return reply.header("cache-control", "no-store").send(await identity.resolveAdministrator(body.username))
    } catch (err) { return sendIdentityError(reply, err) }
  })

  app.post("/api/v1/admin/auth/admins", async (req, reply) => {
    try {
      await identity.admin(req, true)
      const body = req.body as { username?: unknown; subject?: unknown } | undefined
      if (typeof body?.username !== "string" || typeof body.subject !== "string" || !body.subject || !body.username.trim()) {
        return problem(reply, 400, "VALIDATION_FAILED", "请先查询并确认 LDAP 身份。")
      }
      return reply.send(await identity.changeAdministrator(req, { username: body.username, subject: body.subject, displayName: "" }, true))
    } catch (err) {
      await identity.auditAdminDenied(req, "grant", err)
      return sendIdentityError(reply, err)
    }
  })

  app.delete("/api/v1/admin/auth/admins/:subject", async (req, reply) => {
    try {
      await identity.admin(req, true)
      const subject = (req.params as { subject: string }).subject
      const target = (await db.administrators()).find((item) => item.subject === subject)
      if (!target) return problem(reply, 404, "NOT_FOUND", "管理员记录不存在。")
      return reply.send(await identity.changeAdministrator(req, target, false))
    } catch (err) {
      await identity.auditAdminDenied(req, "revoke", err)
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/admin/auth/ldap", async (req, reply) => {
    try {
      await identity.admin(req)
      return reply.header("cache-control", "no-store").send({ config: await identity.config() })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/admin/auth/ldap/test", async (req, reply) => {
    try {
      await identity.admin(req, true)
      const body = (req.body ?? {}) as { config?: LdapConfig; bindPassword?: unknown; username?: unknown }
      if (!body.config || typeof body.config !== "object") {
        return problem(reply, 400, "VALIDATION_FAILED", "config 为必填项。")
      }
      const profile = await identity.testConfig(
        body.config,
        typeof body.bindPassword === "string" ? body.bindPassword : "",
        typeof body.username === "string" ? body.username : undefined,
      )
      return reply.send({ ok: true, ...(profile ? { profile } : {}) })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.put("/api/v1/admin/auth/ldap", async (req, reply) => {
    try {
      const admin = await identity.admin(req, true)
      const body = (req.body ?? {}) as { config?: LdapConfig; bindPassword?: unknown; testUsername?: unknown }
      if (!body.config || typeof body.config !== "object") {
        return problem(reply, 400, "VALIDATION_FAILED", "config 为必填项。")
      }
      const config = await identity.saveConfig(
        body.config,
        typeof body.bindPassword === "string" ? body.bindPassword : "",
        admin.actor,
        typeof body.testUsername === "string" ? body.testUsername : undefined,
      )
      identity.clearAdmin(reply, isSecure(req))
      return reply.send({ config, sessionsRevoked: true })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/admin/auth/identity-mappings", async (req, reply) => {
    try {
      await identity.admin(req)
      return reply.header("cache-control", "no-store").send({ items: await db.identityMappings() })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/admin/auth/identity-mappings", async (req, reply) => {
    try {
      const admin = await identity.admin(req, true)
      const body = (req.body ?? {}) as { username?: unknown; userId?: unknown }
      if (typeof body.username !== "string" || typeof body.userId !== "string") {
        return problem(reply, 400, "VALIDATION_FAILED", "username 和 userId 为必填项。")
      }
      return reply.send(await identity.mapIdentity(body.username, body.userId, admin.actor))
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.delete("/api/v1/admin/auth/identity-mappings/:subject", async (req, reply) => {
    try {
      const admin = await identity.admin(req, true)
      const removed = await identity.unmapIdentity((req.params as { subject: string }).subject, admin.actor)
      return reply.send({ ok: true, removed })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/skills", async (req, reply) => {
    const query = req.query as Query
    const limit = clamp(query.limit, 20)
    const offset = clamp(query.cursor, 0, 0)
    const version = await db.version()
    const search = {
      ...(query.q ? { q: query.q } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.author ? { author: query.author } : {}),
      ...(query.updatedAfter ? { updatedAfter: query.updatedAfter } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
      limit: limit + 1,
      offset,
    }
    const key = JSON.stringify([version, search])
    const pending = searches.get(key) ?? db.search(search)
    if (!searches.has(key)) {
      searches.set(key, pending)
      if (searches.size > 256) searches.delete(searches.keys().next().value ?? "")
    }
    const items = await pending
    const more = items.length > limit
    const payload = {
      items: items.slice(0, limit).map(summary),
      ...(more ? { nextCursor: String(offset + limit) } : {}),
      catalogVersion: version,
    }
    return cached(reply, req.headers["if-none-match"], payload, version)
  })

  app.get("/api/v1/skills/:id", async (req, reply) => {
    const id = (req.params as Params).id
    const item = await db.get(id)
    if (!item) return missing(reply, "Skill not found.")
    const [releases, files, source, related, version] = await Promise.all([
      db.releases(id),
      db.files(id),
      db.file(id, "SKILL.md"),
      db.search({ category: item.category, limit: 5, sort: "downloads" }),
      db.version(),
    ])
    const payload: SkillDetail = {
      ...summary(item),
      markdown: source?.text ?? "",
      releases: releases.map(release),
      files,
      gallery: item.gallery ?? [],
      related: related
        .filter((entry) => entry.id !== id)
        .slice(0, 4)
        .map(summary),
    }
    return cached(reply, req.headers["if-none-match"], payload, version)
  })

  app.get("/api/v1/skills/:id/releases", async (req, reply) => {
    const id = (req.params as Params).id
    if (!(await db.get(id))) return missing(reply, "Skill not found.")
    return reply.send((await db.releases(id)).map(release))
  })

  app.get("/api/v1/skills/:id/releases/:revision", async (req, reply) => {
    const params = req.params as Params
    const item = await db.release(params.id, positive(params.revision))
    if (!item) return missing(reply, "Skill release not found.")
    return reply.send(release(item))
  })

  app.get("/api/v1/skills/:id/files", async (req, reply) => {
    const params = req.params as Params
    if (!(await db.get(params.id))) return missing(reply, "Skill not found.")
    return reply.send(await db.files(params.id, positive((req.query as Query).revision)))
  })

  app.get("/api/v1/skills/:id/files/*", async (req, reply) => {
    const params = req.params as Params
    const path = params["*"] ?? ""
    const item = await db.file(params.id, path, positive((req.query as Query).revision))
    if (!item) return missing(reply, "Skill file not found.")
    return reply.send(item satisfies FilePreview)
  })

  app.get("/api/v1/categories", async (_req, reply) => reply.send(await db.categories()))

  app.get("/api/v1/authors/:id", async (req, reply) => {
    const item = await db.author((req.params as Params).id)
    if (!item) return missing(reply, "Author not found.")
    return reply.send({ id: item.id, displayName: item.displayName, skills: item.skills.map(summary) })
  })

  app.post("/api/v1/publications", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      const idempotencyKey = header(req.headers["idempotency-key"])
      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return problem(reply, 400, "VALIDATION_FAILED", "A valid Idempotency-Key is required.")
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0)
        return problem(reply, 400, "VALIDATION_FAILED", "A gzip Skill archive is required.")
      const run = await db.startPublication({
        id: `publication-${randomUUID()}`,
        ownerId: principal.user.id,
        ownerName: principal.user.displayName,
        idempotencyKey,
        archive: req.body,
      })
      publish("publication.changed", { runId: run.id, skillId: run.skillId, status: run.status })
      if (run.status === "PUBLISHED") {
        publish("skill.published", { skillId: run.skillId, revision: run.release?.revision })
        publish("catalog.invalidated", { catalogVersion: await db.version() })
      }
      return reply.send(publication(run))
    } catch (err) {
      return marketError(reply, err)
    }
  })

  app.get("/api/v1/publications/:runId", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      const run = await db.getPublication({ id: (req.params as { runId: string }).runId, ownerId: principal.user.id })
      if (!run) return missing(reply, "Publication run not found.")
      return reply.send(publication(run))
    } catch (err) {
      return marketError(reply, err)
    }
  })

  app.post("/api/v1/publications/:runId/undo", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      const idempotencyKey = header(req.headers["idempotency-key"])
      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return problem(reply, 400, "VALIDATION_FAILED", "A valid Idempotency-Key is required.")
      }
      const run = await db.undoPublication({
        id: `publication-undo-${randomUUID()}`,
        ownerId: principal.user.id,
        ownerName: principal.user.displayName,
        runId: (req.params as { runId: string }).runId,
        idempotencyKey,
      })
      publish("publication.changed", { runId: run.id, skillId: run.skillId, status: run.status })
      const restored = run.skillId ? await db.get(run.skillId) : undefined
      if (restored) publish("skill.published", { skillId: run.skillId, revision: restored.latestRevision })
      else publish("skill.unpublished", { skillId: run.skillId })
      publish("catalog.invalidated", { catalogVersion: await db.version() })
      return reply.send(publication(run))
    } catch (err) {
      return marketError(reply, err)
    }
  })

  app.get("/api/v1/me/publications", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      return reply.send((await db.publications(principal.user.id)).map(publication))
    } catch (err) {
      return marketError(reply, err)
    }
  })

  app.post("/api/v1/publications/:runId/patches", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      if (principal.mode !== "bearer") return problem(reply, 403, "AUTH_INVALID", "Bearer authentication is required.")
      const patches = Array.isArray(req.body) ? req.body : []
      const run = await db.putPublicationPatches({
        id: (req.params as { runId: string }).runId,
        ownerId: principal.user.id,
        patches: patches as Parameters<MarketDb["putPublicationPatches"]>[0]["patches"],
      })
      publish("publication.changed", { runId: run.id, skillId: run.skillId, status: run.status })
      return reply.send(publication(run))
    } catch (err) {
      return marketError(reply, err)
    }
  })

  app.post("/api/v1/publications/:runId/apply", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      const body = (req.body ?? {}) as { patchIds?: unknown }
      const patchIds = Array.isArray(body.patchIds)
        ? body.patchIds.filter((id): id is string => typeof id === "string")
        : []
      const run = await db.applyPublicationPatches({
        id: (req.params as { runId: string }).runId,
        ownerId: principal.user.id,
        patchIds,
      })
      publish("publication.changed", { runId: run.id, skillId: run.skillId, status: run.status })
      if (run.status === "PUBLISHED") {
        publish("skill.published", { skillId: run.skillId, revision: run.release?.revision })
        publish("catalog.invalidated", { catalogVersion: await db.version() })
      }
      return reply.send(publication(run))
    } catch (err) {
      return marketError(reply, err)
    }
  })

  app.post("/api/v1/skills/:id/unpublish", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      const run = await db.unpublish({
        id: `publication-${randomUUID()}`,
        ownerId: principal.user.id,
        ownerName: principal.user.displayName,
        skillId: (req.params as Params).id,
      })
      publish("skill.unpublished", { skillId: run.skillId })
      publish("catalog.invalidated", { catalogVersion: await db.version() })
      return reply.send(publication(run))
    } catch (err) {
      return marketError(reply, err)
    }
  })

  app.put("/api/v1/favorites/:id", async (req, reply) => favorite(req, reply, true))
  app.delete("/api/v1/favorites/:id", async (req, reply) => favorite(req, reply, false))

  async function favorite(req: Parameters<typeof identity.write>[0], reply: FastifyReply, value: boolean) {
    try {
      const principal = await identity.write(req)
      const skillId = (req.params as Params).id
      if (!(await db.get(skillId))) return missing(reply, "Skill not found.")
      const state = await db.favorite({
        userId: principal.user.id,
        displayName: principal.user.displayName,
        skillId,
        value,
      })
      publish("favorite.changed", { skillId, changedAt: state.changedAt })
      return reply.send(state)
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  }

  app.get("/api/v1/me/favorites", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      return reply.send((await db.favorites(principal.user.id)).map((item) => ({ ...summary(item), favorite: true })))
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/me/installations", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      return reply.send((await db.installations(principal.user.id)).map(installation))
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/analytics/overview", async (req, reply) => {
    try {
      await identity.principal(req)
      return reply.send(analytics(await db.aggregate(), "global"))
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/analytics/skills/:id", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      const id = (req.params as Params).id
      const skill = await db.get(id)
      if (!skill) return missing(reply, "Skill not found.")
      if (skill.authorId !== principal.user.id)
        return problem(reply, 403, "OWNERSHIP_REQUIRED", "Only the Skill author can view this funnel.")
      const metrics = (await db.aggregate()).filter((item) => item.skillId === id)
      return reply.send(analytics(metrics, "skill"))
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/events/batch", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      const body = Array.isArray(req.body) ? req.body : []
      if (body.length === 0 || body.length > 100)
        return problem(reply, 400, "VALIDATION_FAILED", "Event batch must contain 1 to 100 items.")
      const items = body.map((value) => metric(value, principal.user.id, now()))
      if (items.some((item) => !item))
        return problem(reply, 400, "VALIDATION_FAILED", "Event batch contains an invalid or sensitive item.")
      const result = await db.events(items.filter((item): item is NonNullable<typeof item> => Boolean(item)))
      void db
        .maintain(new Date(now()).toISOString())
        .then((state) => publish("analytics.updated", { accepted: result.accepted, metrics: state.metrics.length }))
        .catch((err) => app.log.error({ err }, "market analytics maintenance failed"))
      return reply.code(202).send(result)
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.put("/api/v1/installations/:id", async (req, reply) => saveInstallation(req, reply, false))
  app.delete("/api/v1/installations/:id", async (req, reply) => saveInstallation(req, reply, true))

  async function saveInstallation(req: Parameters<typeof identity.write>[0], reply: FastifyReply, remove: boolean) {
    try {
      const principal = await identity.write(req)
      if (principal.mode !== "bearer") return problem(reply, 403, "AUTH_INVALID", "Bearer authentication is required.")
      const skillId = (req.params as Params).id
      const body = (req.body ?? {}) as InstallationBody
      if (!(await db.get(skillId))) return missing(reply, "Skill not found.")
      if (!validInstallation(skillId, body))
        return problem(reply, 400, "VALIDATION_FAILED", "Installation state is invalid.")
      const release = await db.release(skillId, body.revision)
      if (!release) return problem(reply, 409, "CONFLICT", "Installation revision does not exist.")
      if (release.sha256 !== body.sha256)
        return problem(reply, 409, "HASH_MISMATCH", "Installation hash does not match the release.")
      const state = await db.installation({
        userId: principal.user.id,
        displayName: principal.user.displayName,
        skillId,
        revision: body.revision,
        sha256: body.sha256,
        scope: body.scope,
        status: remove ? "removed" : body.status,
        clientId: body.clientId,
        ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}),
      })
      const payload = installation(state)
      publish("installation.changed", { skillId, changedAt: payload.changedAt })
      return reply.send(payload)
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  }

  app.post("/api/v1/skills/:id/install-intents", async (req, reply) => {
    try {
      const principal = await identity.write(req)
      if (principal.mode !== "session") return problem(reply, 403, "AUTH_INVALID", "Web session is required.")
      const skillId = (req.params as Params).id
      const requested = Number((req.body as { revision?: unknown } | undefined)?.revision)
      const release = await db.release(
        skillId,
        Number.isSafeInteger(requested) && requested > 0 ? requested : undefined,
      )
      if (!release) return missing(reply, "Skill release not found.")
      const token = randomBytes(32).toString("base64url")
      const expiresAt = new Date(now() + 5 * 60 * 1000).toISOString()
      await db.createIntent({
        hash: digest(token),
        userId: principal.user.id,
        skillId,
        revision: release.revision,
        sha256: release.sha256,
        expiresAt,
      })
      publish("install.intent.created", { skillId, revision: release.revision })
      return reply.send({ token, expiresAt })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.post("/api/v1/install-intents/:token/consume", async (req, reply) => {
    try {
      const principal = await identity.principal(req)
      if (principal.mode !== "bearer") return problem(reply, 403, "AUTH_INVALID", "Bearer authentication is required.")
      const token = (req.params as { token: string }).token
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return problem(reply, 404, "NOT_FOUND", "Install intent not found.")
      const result = await db.consumeIntent({
        hash: digest(token),
        userId: principal.user.id,
        now: new Date(now()).toISOString(),
      })
      if (result.state === "replayed")
        return problem(reply, 409, "INTENT_REPLAYED", "Install intent was already consumed.")
      if (result.state === "expired") return problem(reply, 410, "INTENT_EXPIRED", "Install intent expired.")
      if (result.state === "missing") return problem(reply, 404, "NOT_FOUND", "Install intent not found.")
      if (result.state !== "ok") return problem(reply, 404, "NOT_FOUND", "Install intent not found.")
      return reply.send({
        skillId: result.item.skillId,
        revision: result.item.revision,
        sha256: result.item.sha256,
        downloadUrl: `/api/v1/skills/${encodeURIComponent(result.item.skillId)}/releases/${result.item.revision}/archive`,
      })
    } catch (err) {
      return sendIdentityError(reply, err)
    }
  })

  app.get("/api/v1/skills/:id/releases/:revision/archive", async (req, reply) => {
    if (req.headers.range) return reply.header("accept-ranges", "none").code(416).send()
    const params = req.params as Params
    const release = await db.release(params.id, positive(params.revision))
    if (!release) return missing(reply, "Skill release not found.")
    if (req.method === "GET") {
      reply.raw.once("finish", () => {
        void db
          .skillDownload(release.skillId)
          .then(async (downloads) => {
            if (downloads === undefined) return
            publish("catalog.invalidated", { catalogVersion: await db.version() })
          })
          .catch((err) => app.log.error({ err, skillId: release.skillId }, "skill download count failed"))
      })
    }
    return reply
      .header("content-type", "application/gzip")
      .header("content-length", release.size)
      .header("content-disposition", `attachment; filename="${release.skillId}-r${release.revision}.tar.gz"`)
      .header("cache-control", "no-store")
      .header("accept-ranges", "none")
      .header("x-content-sha256", release.sha256)
      .send(createReadStream(release.archivePath))
  })

  app.get("/api/v1/status", async (req, reply) => {
    const health = await db.health()
    const auth = await identity.authStatus()
    const authReady = auth.configured && auth.enabled
    const trustedHttp = req.protocol !== "https"
    const runtime = opts.extensionStatus?.() ?? {
      enabled: true,
      scanner: "starting",
      drop: false,
      artifacts: false,
      temporary: false,
      warnings: [],
    }
    const extensions = opts.extensionMarket
      ? { database: health.available ? "ready" : "degraded", ...runtime }
      : undefined
    const extensionReady =
      !extensions ||
      (extensions.database === "ready" &&
        extensions.drop === true &&
        extensions.artifacts === true &&
        extensions.temporary === true &&
        (extensions.warnings?.length ?? 0) === 0)
    return reply.send({
      ok: health.available && extensionReady && authReady,
      transport: trustedHttp ? "trusted-http" : "https",
      render: "ready",
      market: health.available ? "ready" : "degraded",
      packages: "ready",
      auth,
      ...(extensions ? { extensions } : {}),
      warnings: [
        ...(trustedHttp ? ["当前网页使用 HTTP，LDAP 用户名、密码和会话不受浏览器到 Server 的传输加密保护。"] : []),
        ...(!auth.configured ? ["LDAP 尚未配置，受保护的市场操作不可用。"] : []),
        ...(auth.configured && !auth.enabled ? ["LDAP 认证当前未启用，受保护的市场操作不可用。"] : []),
        ...(authReady && auth.insecure ? ["Server 到 Active Directory 使用未加密 LDAP。"] : []),
        ...(health.available ? [] : ["Market database is unavailable."]),
      ],
    })
  })

  app.get("/api/v1/market/stream", async (req, reply) => {
    const version = await db.version()
    reply.hijack()
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    })
    const known = (req.query as Query).catalogVersion
    if (known !== version) reply.raw.write(event("catalog.invalidated", version, { catalogVersion: version }))
    else reply.raw.write(`: catalog ${version} current\n\n`)
    const remove = events.add(reply.raw)
    const timer = setInterval(() => reply.raw.write(`: heartbeat ${Date.now()}\n\n`), 25_000)
    req.raw.once("close", () => {
      clearInterval(timer)
      remove()
    })
  })
}

async function capabilities(db: MarketDb, extensions: boolean): Promise<MarketCapabilities> {
  return {
    mode: "aligned-v1",
    apiVersion: "1.0.0",
    diagnostics: diagnosticCapabilities,
    catalogVersion: await db.version(),
    skillSpecVersion: SKILL_SPEC_VERSION,
    features: {
      versions: true,
      favorites: true,
      installations: true,
      publications: true,
      repairs: true,
      analytics: true,
      events: true,
      extensions,
      extensionPublications: extensions,
      extensionReviews: extensions,
      extensionAnalytics: extensions,
      extensionDirectoryImport: extensions,
    },
  }
}

function analytics(items: Array<{ date: string; name: string; count: number }>, scope: "global" | "skill") {
  const groups = new Map<string, Array<{ date: string; value: number }>>()
  for (const item of items) {
    const points = groups.get(item.name) ?? []
    points.push({ date: item.date, value: item.count })
    groups.set(item.name, points)
  }
  return [...groups.entries()].map(([metric, points]) => ({ metric, scope, points }))
}

function summary(item: SearchItem): SkillSummary {
  return {
    id: item.id,
    name: item.name,
    description: item.description || "No description provided.",
    category: item.category,
    tags: item.tags,
    author: { id: item.authorId, displayName: item.author },
    latestRevision: item.latestRevision,
    ...(item.semver ? { semver: item.semver } : {}),
    sha256: item.sha256,
    updatedAt: item.updatedAt,
    downloads: item.downloads,
    favorites: item.favorites,
    risk: risk(item.report),
    ...(item.artwork ? { artwork: item.artwork } : {}),
  }
}

function release(item: ReleaseItem): SkillRelease {
  return {
    skillId: item.skillId,
    revision: item.revision,
    ...(item.semver ? { semver: item.semver } : {}),
    sha256: item.sha256,
    archiveUrl: `/api/v1/skills/${encodeURIComponent(item.skillId)}/releases/${item.revision}/archive`,
    ...(item.notes ? { notes: item.notes } : {}),
    report: report(item),
    publishedAt: item.publishedAt,
  }
}

function report(item: ReleaseItem): ValidationReport {
  return validation(item.report, item.sha256)
}

function validation(value: Record<string, unknown>, fallback: string): ValidationReport {
  const policyVersion = typeof value.policyVersion === "string" ? value.policyVersion : undefined
  const current = policyVersion === "skill-risk-v2" || policyVersion === "skill-risk-v3"
  const issues =
    current && Array.isArray(value.issues)
      ? value.issues.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
          const item = entry as Record<string, unknown>
          if (typeof item.code !== "string" || typeof item.message !== "string") return []
          const severity =
            item.severity === "info" || item.severity === "warning" || item.severity === "error"
              ? item.severity
              : "warning"
          const riskLevel = item.riskLevel === "medium" || item.riskLevel === "critical" ? item.riskLevel : "none"
          return [
            {
              code: item.code,
              severity,
              ...(typeof item.file === "string" ? { file: item.file } : {}),
              ...(typeof item.line === "number" ? { line: item.line } : {}),
              ...(typeof item.field === "string" ? { field: item.field } : {}),
              message: item.message,
              ...(typeof item.expected === "string" ? { expected: item.expected } : {}),
              ...(typeof item.actual === "string" ? { actual: item.actual } : {}),
              fixable: item.fixable === true,
              repairKind: item.repairKind === "deterministic" || item.repairKind === "ai" ? item.repairKind : "none",
              riskLevel,
            },
          ]
        })
      : []
  const sourceSha256 =
    typeof value.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(value.sourceSha256) ? value.sourceSha256 : fallback
  const snapshotSha256 =
    typeof value.snapshotSha256 === "string" && /^[a-f0-9]{64}$/.test(value.snapshotSha256)
      ? value.snapshotSha256
      : fallback
  return {
    valid: value.valid === true,
    stage:
      value.stage === "format" ||
      value.stage === "deterministic" ||
      value.stage === "security" ||
      value.stage === "semantic"
        ? value.stage
        : "complete",
    issues,
    sourceSha256,
    snapshotSha256,
    changed: value.changed === true,
    ...(policyVersion ? { policyVersion } : {}),
    risk: risk(value),
  }
}

function risk(value: Record<string, unknown>): SkillRiskSummary {
  const policyVersion =
    value.policyVersion === "skill-risk-v2" || value.policyVersion === "skill-risk-v3" ? value.policyVersion : undefined
  if (!policyVersion) return { level: "unknown", issueCount: 0 }
  const source =
    value.risk && typeof value.risk === "object" && !Array.isArray(value.risk)
      ? (value.risk as Record<string, unknown>)
      : {}
  const level =
    source.level === "medium" || source.level === "critical" || source.level === "none" ? source.level : "none"
  const issueCount =
    Number.isSafeInteger(source.issueCount) && Number(source.issueCount) >= 0 ? Number(source.issueCount) : 0
  return { level, issueCount, policyVersion }
}

function cached(reply: FastifyReply, match: string | undefined, payload: unknown, version?: string) {
  const raw = version ?? createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  const etag = `"${raw}"`
  reply.header("cache-control", "private, max-age=0, must-revalidate").header("etag", etag)
  if (match === etag || match === raw) return reply.code(304).send()
  return reply.send(payload)
}

function missing(reply: FastifyReply, message: string) {
  return reply.code(404).send({ ok: false, code: "NOT_FOUND", message })
}

function problem(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ ok: false, code, message })
}

function marketError(reply: FastifyReply, err: unknown) {
  if (err instanceof IdentityError) return sendIdentityError(reply, err)
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes("OWNERSHIP_REQUIRED"))
    return problem(reply, 403, "OWNERSHIP_REQUIRED", "The current user does not own this publication.")
  if (message.includes("IDEMPOTENCY_CONFLICT"))
    return problem(reply, 409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for different content.")
  if (message.includes("STALE_PUBLICATION"))
    return problem(reply, 409, "STALE_PUBLICATION", "A newer publication already exists.")
  if (message.includes("CONFLICT")) return problem(reply, 409, "CONFLICT", message.replace(/^CONFLICT:\s*/, ""))
  if (message.includes("VALIDATION_FAILED"))
    return problem(reply, 400, "VALIDATION_FAILED", message.replace(/^VALIDATION_FAILED:\s*/, ""))
  if (message.includes("NOT_FOUND")) return problem(reply, 404, "NOT_FOUND", "Publication target not found.")
  throw err
}

function publication(item: PublicationItem) {
  return {
    id: item.id,
    ...(item.skillId ? { skillId: item.skillId } : {}),
    ownerId: item.ownerId,
    status: item.status,
    stage: item.stage,
    ...(item.report
      ? { report: validation(item.report as unknown as Record<string, unknown>, item.report.snapshotSha256) }
      : {}),
    patches: item.patches,
    ...(item.release ? { release: release(item.release) } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function installation(item: InstallationInput & { changedAt: string }) {
  return {
    skillId: item.skillId,
    revision: item.revision,
    sha256: item.sha256,
    scope: item.scope,
    status: item.status,
    clientId: item.clientId,
    ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
    changedAt: item.changedAt,
  }
}

function validInstallation(
  skillId: string,
  body: InstallationBody,
): body is Required<Omit<InstallationBody, "workspaceId">> & Pick<InstallationBody, "workspaceId"> {
  if (body.skillId !== undefined && body.skillId !== skillId) return false
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1) return false
  if (!/^[a-f0-9]{64}$/.test(body.sha256 ?? "")) return false
  if (body.scope !== "global" && body.scope !== "project") return false
  if (!body.status || !["installed", "updating", "removed", "local-unmanaged"].includes(body.status)) return false
  if (!body.clientId || body.clientId.length < 16 || body.clientId.length > 128) return false
  if (body.scope === "project" && (!body.workspaceId || body.workspaceId.length < 16 || body.workspaceId.length > 128))
    return false
  return true
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function metric(value: unknown, userId: string, now: number): EventInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (typeof item.name !== "string" || !EVENTS.has(item.name as AnalyticsEvent["name"])) return undefined
  if (item.surface !== "web" && item.surface !== "vscode") return undefined
  if (typeof item.clientId !== "string" || item.clientId.length < 16 || item.clientId.length > 128) return undefined
  const time = typeof item.occurredAt === "string" ? Date.parse(item.occurredAt) : Number.NaN
  if (!Number.isFinite(time) || time < now - 90 * 24 * 60 * 60 * 1000 || time > now + 5 * 60 * 1000) return undefined
  if (
    item.skillId !== undefined &&
    (typeof item.skillId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(item.skillId))
  )
    return undefined
  if (item.revision !== undefined && (!Number.isSafeInteger(item.revision) || Number(item.revision) < 1))
    return undefined
  const context = metricContext(item.context)
  if (item.context !== undefined && !context) return undefined
  return {
    id: `event-${randomUUID()}`,
    name: item.name,
    surface: item.surface,
    userId,
    clientId: `client-${digest(item.clientId).slice(0, 40)}`,
    ...(item.skillId ? { skillId: item.skillId } : {}),
    ...(item.revision ? { revision: Number(item.revision) } : {}),
    occurredAt: new Date(time).toISOString(),
    ...(context ? { context } : {}),
  }
}

function metricContext(value: unknown) {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > 9 || entries.some(([key]) => !CONTEXT.has(key))) return undefined
  const context: Record<string, string | number | boolean> = {}
  for (const [key, item] of entries) {
    if (typeof item === "string" && item.length <= 128) context[key] = item
    else if (typeof item === "boolean") context[key] = item
    else if (typeof item === "number" && Number.isFinite(item)) context[key] = item
    else return undefined
  }
  return context
}

function header(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

function bearer(value: string | undefined) {
  return value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ""
}

function origin(req: Parameters<Identity["write"]>[0]) {
  const configured = process.env.CHIPMATE_PUBLIC_BASE_URL?.trim()
  try {
    const value = new URL(configured || `${req.protocol}://${header(req.headers.host)}`)
    if (!/^https?:$/.test(value.protocol) || (configured && (value.pathname !== "/" || value.search || value.hash))) {
      throw new Error("invalid")
    }
    return value.origin
  } catch {
    throw new IdentityError(503, "PUBLIC_URL_INVALID", "ChipMate Server 公网地址配置无效。")
  }
}

function positive(value: string | undefined) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

function clamp(value: string | undefined, fallback: number, minimum = 1) {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) return fallback
  return Math.max(minimum, Math.min(100, number))
}

function event(name: string, id: string, payload: unknown) {
  return `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(payload)}\n\n`
}
