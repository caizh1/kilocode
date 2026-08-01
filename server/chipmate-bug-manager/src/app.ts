import { existsSync } from "node:fs"
import { resolve } from "node:path"
import cookie from "@fastify/cookie"
import rateLimit from "@fastify/rate-limit"
import statics from "@fastify/static"
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify"
import { canReadBug, type Store } from "./db.js"
import { digest, hashPassword, inviteCode, safeEqual, sanitizeLog, token, verifyPassword } from "./security.js"
import {
  logKinds,
  logLevels,
  roles,
  severities,
  stages,
  type BugInput,
  type Invite,
  type Role,
  type RunLogInput,
  type RunResult,
  type User,
} from "./types.js"

const cookieName = "chipmate_session"
const day = 24 * 60 * 60 * 1000

interface AppOptions {
  store: Store
  workerToken: string
  webRoot?: string
  secureCookie?: boolean
  logger?: boolean
}

interface Auth {
  id: number
  username: string
  role: Role
  csrf: string
  hash: string
}

interface Event {
  id: string
  type: string
  data: Record<string, unknown>
}

type RunnerMode = "monitor" | "shadow" | "release"

interface RunnerClient {
  send: (event: Event) => void
  owner: string
  mode: RunnerMode
  connectedAt: string
}

interface ViewerClient {
  canRead: (bug: number) => boolean
  send: (event: Event) => void
  user: number
}

class Hub {
  readonly clients = new Set<RunnerClient>()
  readonly viewers = new Set<ViewerClient>()
  seq = 0

  emit(type: string, data: Record<string, unknown>) {
    this.seq += 1
    const event = { id: String(this.seq), type, data }
    for (const client of this.clients) client.send(event)
  }

  emitViewers(type: string, data: Record<string, unknown>) {
    this.seq += 1
    const event = { id: String(this.seq), type, data }
    const bug = typeof data.bugId === "number" ? data.bugId : undefined
    for (const client of this.viewers) {
      if (bug && !client.canRead(bug)) continue
      client.send(event)
    }
  }

  status(queued: number) {
    const clients = [...this.clients]
    const order: RunnerMode[] = ["monitor", "shadow", "release"]
    const mode = clients.reduce<RunnerMode | null>((current, client) => {
      if (!current || order.indexOf(client.mode) > order.indexOf(current)) return client.mode
      return current
    }, null)
    return {
      online: clients.length > 0,
      mode,
      workers: clients.length,
      queued,
      connectedAt: clients.map((client) => client.connectedAt).sort()[0] ?? null,
    }
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function text(value: unknown, max: number) {
  if (typeof value !== "string") return undefined
  const result = value.trim()
  if (!result || result.length > max) return undefined
  return result
}

function password(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) return undefined
  return value
}

function registrationUsername(value: unknown) {
  const username = text(value, 32)
  if (!username || !/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) return undefined
  return username
}

function normalizedInvite(value: unknown) {
  if (typeof value !== "string") return undefined
  const code = value.trim().toUpperCase()
  if (!/^CM-[A-F0-9]{24}$/.test(code)) return undefined
  return code
}

function visibleInvite(invite: Invite) {
  return {
    id: invite.id,
    codePrefix: invite.code_prefix,
    maxUses: invite.max_uses,
    usedCount: invite.used_count,
    createdAt: invite.created_at,
    exhaustedAt: invite.exhausted_at,
  }
}

function id(value: unknown) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) return undefined
  return number
}

function bugInput(value: unknown): BugInput | undefined {
  const input = record(value)
  if (!input) return undefined
  const title = text(input.title, 160)
  const description = text(input.description, 20_000)
  const reproduction = text(input.reproduction, 12_000)
  const expected = text(input.expected, 8_000)
  const actual = text(input.actual, 8_000)
  const environment = text(input.environment, 4_000)
  const component = text(input.component, 120)
  const severity = typeof input.severity === "string" && severities.includes(input.severity as never)
    ? input.severity as BugInput["severity"]
    : undefined
  if (!title || !description || !reproduction || !expected || !actual || !environment || !component || !severity) {
    return undefined
  }
  return { title, description, reproduction, expected, actual, environment, component, severity }
}

function runResult(value: unknown): RunResult | undefined {
  const input = record(value)
  if (!input || typeof input.stage !== "string" || !stages.includes(input.stage as never)) return undefined
  const stage = input.stage as RunResult["stage"]
  const summary = input.summary === undefined ? undefined : text(input.summary, 20_000)
  const error = input.error === undefined ? undefined : text(input.error, 20_000)
  const baselineCommit = input.baselineCommit === undefined ? undefined : text(input.baselineCommit, 128)
  const sourceCommit = input.sourceCommit === undefined ? undefined : text(input.sourceCommit, 128)
  const tokenCount = input.tokenCount === undefined ? undefined : Number(input.tokenCount)
  const requiresApproval = input.requiresApproval === undefined ? undefined : Boolean(input.requiresApproval)
  if (input.summary !== undefined && !summary) return undefined
  if (input.error !== undefined && !error) return undefined
  if (tokenCount !== undefined && (!Number.isSafeInteger(tokenCount) || tokenCount < 0)) return undefined
  const artifacts = Array.isArray(input.artifacts)
    ? input.artifacts.map((value) => {
        const artifact = record(value)
        if (!artifact) return undefined
        const version = text(artifact.version, 64)
        const platform = text(artifact.platform, 64)
        const name = text(artifact.name, 240)
        const size = Number(artifact.size)
        const sha256 = text(artifact.sha256, 64)
        const url = text(artifact.url, 2_000)
        if (!version || !platform || !name || !Number.isSafeInteger(size) || size <= 0 || !sha256 || !url) {
          return undefined
        }
        if (!/^[a-f0-9]{64}$/.test(sha256)) return undefined
        return { version, platform, name, size, sha256, url }
      })
    : undefined
  if (artifacts?.some((value) => !value)) return undefined
  return {
    stage,
    summary,
    error,
    baselineCommit,
    sourceCommit,
    tokenCount,
    requiresApproval,
    artifacts: artifacts as RunResult["artifacts"],
  }
}

function safeLogText(value: unknown, max: number) {
  const input = text(value, max)
  if (!input) return undefined
  return sanitizeLog(input)
}

function runLogs(value: unknown): RunLogInput[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return undefined
  const logs = value.map((value) => {
    const input = record(value)
    if (!input) return undefined
    const stage = typeof input.stage === "string" && stages.includes(input.stage as never)
      ? input.stage as RunLogInput["stage"]
      : undefined
    const kind = typeof input.kind === "string" && logKinds.includes(input.kind as never)
      ? input.kind as RunLogInput["kind"]
      : undefined
    const level = typeof input.level === "string" && logLevels.includes(input.level as never)
      ? input.level as RunLogInput["level"]
      : undefined
    const message = safeLogText(input.message, 1_200)
    const summary = input.summary === undefined ? undefined : safeLogText(input.summary, 4_000)
    const detail = input.detail === undefined ? undefined : safeLogText(input.detail, 8_000)
    if (
      !stage
      || !kind
      || !level
      || !message
      || (input.summary !== undefined && !summary)
      || (input.detail !== undefined && !detail)
    ) return undefined
    return { stage, kind, level, message, summary, detail }
  })
  if (logs.some((log) => !log)) return undefined
  return logs as RunLogInput[]
}

function params(request: FastifyRequest) {
  return record(request.params)
}

function query(request: FastifyRequest) {
  return record(request.query)
}

function worker(request: FastifyRequest, expected: string) {
  const header = request.headers.authorization
  if (!header?.startsWith("Bearer ")) return false
  return safeEqual(header.slice(7), expected)
}

export async function build(options: AppOptions) {
  if (options.workerToken.length < 32) throw new Error("CHIPMATE_WORKER_TOKEN 至少需要 32 个字符")
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: "127.0.0.1",
  })
  const hub = new Hub()

  await app.register(cookie)
  await app.register(rateLimit, { global: false })

  async function auth(request: FastifyRequest, reply: FastifyReply, allowed: Role[] = [...roles]) {
    const raw = request.cookies[cookieName]
    if (!raw) {
      await reply.code(401).send({ error: "需要登录" })
      return undefined
    }
    const hash = digest(raw)
    const session = options.store.session(hash)
    if (!session || session.disabled_at || !allowed.includes(session.role)) {
      await reply.code(403).send({ error: "没有访问权限" })
      return undefined
    }
    return {
      id: session.user_id,
      username: session.username,
      role: session.role,
      csrf: session.csrf,
      hash,
    } satisfies Auth
  }

  async function mutation(request: FastifyRequest, reply: FastifyReply, allowed?: Role[]) {
    const user = await auth(request, reply, allowed)
    if (!user) return undefined
    if (request.headers["x-csrf-token"] !== user.csrf) {
      await reply.code(403).send({ error: "CSRF 校验失败" })
      return undefined
    }
    return user
  }

  function establishSession(reply: FastifyReply, user: User) {
    const raw = token()
    const csrf = token()
    const expires = new Date(Date.now() + 7 * day)
    options.store.createSession(user.id, digest(raw), csrf, expires.toISOString())
    reply.setCookie(cookieName, raw, {
      path: "/bugs/",
      httpOnly: true,
      secure: options.secureCookie ?? true,
      sameSite: "strict",
      expires,
    })
    return { user: { id: user.id, username: user.username, role: user.role }, csrf }
  }

  app.get("/api/health", async () => ({ status: "ok", service: "chipmate-bug-manager" }))

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = record(request.body)
      const username = text(input?.username, 80)
      const password = text(input?.password, 256)
      if (!username || !password) return reply.code(400).send({ error: "用户名或密码格式错误" })
      const user = options.store.userByName(username)
      const valid = user && !user.disabled_at ? await verifyPassword(password, user.password_hash) : false
      if (!user || !valid) return reply.code(401).send({ error: "用户名或密码错误" })
      options.store.audit("user", String(user.id), "auth.login", "user", String(user.id), {})
      return establishSession(reply, user)
    },
  )

  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 6, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = record(request.body)
      const username = registrationUsername(input?.username)
      const secret = password(input?.password)
      const code = normalizedInvite(input?.inviteCode)
      if (!username || !secret || !code) {
        return reply.code(400).send({
          error: "请使用 3–32 位用户名、至少 12 位密码和有效邀请码",
        })
      }
      try {
        const user = options.store.registerWithInvite(username, await hashPassword(secret), digest(code))
        return reply.code(201).send(establishSession(reply, user))
      } catch (err) {
        if (err instanceof Error && err.message === "INVITE_INVALID") {
          return reply.code(403).send({ error: "邀请码无效或名额已用完" })
        }
        if (err instanceof Error && /UNIQUE constraint failed: users\.username/.test(err.message)) {
          return reply.code(409).send({ error: "用户名已存在" })
        }
        throw err
      }
    },
  )

  app.post("/api/auth/logout", async (request, reply) => {
    const user = await mutation(request, reply)
    if (!user) return
    options.store.deleteSession(user.hash)
    reply.clearCookie(cookieName, { path: "/bugs/" })
    return { ok: true }
  })

  app.get("/api/auth/me", async (request, reply) => {
    const user = await auth(request, reply)
    if (!user) return
    return { user: { id: user.id, username: user.username, role: user.role }, csrf: user.csrf }
  })

  app.get("/api/invites/mine", async (request, reply) => {
    const user = await auth(request, reply)
    if (!user) return
    const invite = options.store.inviteForCreator(user.id)
    return { invite: invite ? visibleInvite(invite) : null }
  })

  app.get("/api/runner/status", async (request, reply) => {
    const user = await auth(request, reply)
    if (!user) return
    return hub.status(options.store.queued().length)
  })

  app.get("/api/events", async (request, reply) => {
    const user = await auth(request, reply)
    if (!user) return
    reply.hijack()
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    })
    const send = (event: Event) => {
      reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
    }
    const client = {
      canRead: (bugId: number) => {
        const bug = options.store.bug(bugId)
        return Boolean(bug && canReadBug(user.role, user.id, bug))
      },
      send,
      user: user.id,
    }
    hub.viewers.add(client)
    send({ id: `ready-${user.id}`, type: "stream.ready", data: {} })
    const timer = setInterval(() => reply.raw.write(": 心跳\n\n"), 20_000)
    request.raw.once("close", () => {
      clearInterval(timer)
      hub.viewers.delete(client)
    })
  })

  app.post("/api/invites", async (request, reply) => {
    const user = await mutation(request, reply)
    if (!user) return
    if (options.store.inviteForCreator(user.id)) {
      return reply.code(409).send({ error: "每个用户只能生成一个邀请码" })
    }
    const code = inviteCode()
    try {
      const invite = options.store.createInvite(user.id, digest(code), code.slice(0, 7))
      return reply.code(201).send({ invite: { ...visibleInvite(invite), code } })
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
        return reply.code(409).send({ error: "每个用户只能生成一个邀请码" })
      }
      throw err
    }
  })

  app.get("/api/bugs", async (request, reply) => {
    const user = await auth(request, reply)
    if (!user) return
    return { bugs: options.store.bugs(user.role, user.id) }
  })

  app.post("/api/bugs", async (request, reply) => {
    const user = await mutation(request, reply)
    if (!user) return
    const input = bugInput(request.body)
    if (!input) return reply.code(400).send({ error: "Bug 信息不完整或超过长度限制" })
    const created = options.store.createBugAndTrigger(input, user.id)
    hub.emit("run.queued", { runId: created.run.id, bugId: created.bug.id })
    hub.emitViewers("run.updated", { runId: created.run.id, bugId: created.bug.id, stage: created.run.stage })
    return reply.code(201).send(created)
  })

  app.get("/api/bugs/:id", async (request, reply) => {
    const user = await auth(request, reply)
    if (!user) return
    const bugId = id(params(request)?.id)
    const bug = bugId ? options.store.bug(bugId) : undefined
    if (!bug) return reply.code(404).send({ error: "Bug 不存在" })
    if (!canReadBug(user.role, user.id, bug)) return reply.code(403).send({ error: "没有访问权限" })
    const runs = options.store.runsForBug(bug.id).map((run) => ({
      ...run,
      artifacts: options.store.artifacts(run.id),
      logs: options.store.runLogs(run.id),
    }))
    return { bug, runs, audits: options.store.audits("bug", String(bug.id)) }
  })

  app.post("/api/bugs/:id/trigger", async (request, reply) => {
    const user = await mutation(request, reply, ["maintainer", "admin"])
    if (!user) return
    const bugId = id(params(request)?.id)
    if (!bugId || !options.store.bug(bugId)) return reply.code(404).send({ error: "Bug 不存在" })
    try {
      const run = options.store.trigger(bugId, user.id)
      if (!run) return reply.code(409).send({ error: "无法创建修复任务" })
      hub.emit("run.queued", { runId: run.id, bugId })
      hub.emitViewers("run.updated", { runId: run.id, bugId, stage: run.stage })
      return reply.code(202).send({ run })
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
        return reply.code(409).send({ error: "该 Bug 已有进行中的任务" })
      }
      throw err
    }
  })

  app.post("/api/runs/:id/approve", async (request, reply) => {
    const user = await mutation(request, reply, ["admin"])
    if (!user) return
    const runId = id(params(request)?.id)
    const run = runId ? options.store.approve(runId, user.id) : undefined
    if (!run) return reply.code(409).send({ error: "任务不处于等待审批状态" })
    hub.emit("run.packaging", { runId: run.id, bugId: run.bug_id })
    hub.emitViewers("run.updated", { runId: run.id, bugId: run.bug_id, stage: run.stage })
    return { run }
  })

  app.post("/api/runs/:id/cancel", async (request, reply) => {
    const user = await mutation(request, reply, ["maintainer", "admin"])
    if (!user) return
    const runId = id(params(request)?.id)
    const run = runId ? options.store.cancel(runId, user.id) : undefined
    if (!run) return reply.code(409).send({ error: "任务不能取消" })
    hub.emit("run.cancelled", { runId: run.id, bugId: run.bug_id })
    hub.emitViewers("run.updated", { runId: run.id, bugId: run.bug_id, stage: run.stage })
    return { run }
  })

  app.get("/api/worker/events", async (request, reply) => {
    if (!worker(request, options.workerToken)) return reply.code(401).send({ error: "Worker Token 无效" })
    const input = query(request)
    const owner = text(input?.owner, 120) ?? "unknown-worker"
    const mode = typeof input?.mode === "string" && ["monitor", "shadow", "release"].includes(input.mode)
      ? input.mode as RunnerMode
      : "monitor"
    reply.hijack()
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    })
    const send = (event: Event) => {
      reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
    }
    const client = { send, owner, mode, connectedAt: new Date().toISOString() }
    hub.clients.add(client)
    for (const run of options.store.queued()) {
      send({
        id: `snapshot-${run.id}`,
        type: run.stage === "packaging" ? "run.packaging" : "run.queued",
        data: { runId: run.id, bugId: run.bug_id },
      })
    }
    const timer = setInterval(() => reply.raw.write(": 心跳\n\n"), 20_000)
    request.raw.once("close", () => {
      clearInterval(timer)
      hub.clients.delete(client)
    })
  })

  app.get("/api/worker/runs/:id", async (request, reply) => {
    if (!worker(request, options.workerToken)) return reply.code(401).send({ error: "Worker Token 无效" })
    const runId = id(params(request)?.id)
    const run = runId ? options.store.run(runId) : undefined
    const bug = run ? options.store.bug(run.bug_id) : undefined
    if (!run || !bug) return reply.code(404).send({ error: "任务不存在" })
    return { run, bug, artifacts: options.store.artifacts(run.id) }
  })

  app.post("/api/worker/runs/:id/lease", async (request, reply) => {
    if (!worker(request, options.workerToken)) return reply.code(401).send({ error: "Worker Token 无效" })
    const input = record(request.body)
    const owner = text(input?.owner, 120)
    const runId = id(params(request)?.id)
    if (!owner || !runId) return reply.code(400).send({ error: "租约参数无效" })
    const run = options.store.lease(runId, owner, 120_000)
    if (!run) return reply.code(409).send({ error: "任务已经被领取" })
    return { run }
  })

  app.post("/api/worker/runs/:id/heartbeat", async (request, reply) => {
    if (!worker(request, options.workerToken)) return reply.code(401).send({ error: "Worker Token 无效" })
    const input = record(request.body)
    const owner = text(input?.owner, 120)
    const runId = id(params(request)?.id)
    if (!owner || !runId) return reply.code(400).send({ error: "心跳参数无效" })
    if (!options.store.heartbeat(runId, owner, 120_000)) {
      return reply.code(409).send({ error: "租约已经失效" })
    }
    return { ok: true }
  })

  app.post("/api/worker/runs/:id/result", async (request, reply) => {
    if (!worker(request, options.workerToken)) return reply.code(401).send({ error: "Worker Token 无效" })
    const input = record(request.body)
    const owner = text(input?.owner, 120)
    const result = runResult(input?.result)
    const runId = id(params(request)?.id)
    if (!owner || !runId || !result) return reply.code(400).send({ error: "任务结果格式无效" })
    if (result.stage === "released") {
      const platforms = new Set(result.artifacts?.map((artifact) => artifact.platform))
      if (!platforms.has("win32-x64-baseline") || !platforms.has("linux-x64-baseline")) {
        return reply.code(400).send({ error: "发布结果必须同时包含 Windows 和 Linux 包" })
      }
    }
    try {
      const run = options.store.updateRun(runId, owner, result)
      if (!run) throw new Error("RUN_NOT_FOUND")
      hub.emitViewers("run.updated", { runId: run.id, bugId: run.bug_id, stage: run.stage })
      return { run }
    } catch (err) {
      if (err instanceof Error) {
        if (["RUN_NOT_FOUND", "LEASE_MISMATCH"].includes(err.message)) {
          return reply.code(409).send({ error: "任务租约无效" })
        }
        if (err.message === "INVALID_TRANSITION") {
          return reply.code(409).send({ error: "任务状态迁移无效" })
        }
        if (err.message === "APPROVAL_REQUIRED") {
          return reply.code(409).send({ error: "关键任务尚未获得管理员批准" })
        }
        if (err.message === "ARTIFACTS_INVALID") {
          return reply.code(400).send({ error: "发布产物与任务版本或平台不一致" })
        }
      }
      throw err
    }
  })

  app.post("/api/worker/runs/:id/logs", async (request, reply) => {
    if (!worker(request, options.workerToken)) return reply.code(401).send({ error: "Worker Token 无效" })
    const input = record(request.body)
    const owner = text(input?.owner, 120)
    const logs = runLogs(input?.logs)
    const runId = id(params(request)?.id)
    if (!owner || !runId || !logs) return reply.code(400).send({ error: "执行日志格式无效" })
    try {
      const inserted = options.store.appendRunLogs(runId, owner, logs)
      const run = options.store.run(runId)
      if (run && inserted.length > 0) {
        hub.emitViewers("run.log", {
          runId,
          bugId: run.bug_id,
          lastLogId: inserted.at(-1)!.id,
        })
      }
      return { logs: inserted }
    } catch (err) {
      if (err instanceof Error && ["RUN_NOT_FOUND", "LEASE_MISMATCH"].includes(err.message)) {
        return reply.code(409).send({ error: "任务租约无效" })
      }
      throw err
    }
  })

  const root = options.webRoot ?? resolve(process.cwd(), "dist/web")
  if (existsSync(root)) {
    await app.register(statics, { root, wildcard: false })
    app.get("/*", async (request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "接口不存在" })
      return reply.sendFile("index.html")
    })
  }

  app.addHook("onClose", async () => {
    hub.clients.clear()
    hub.viewers.clear()
  })

  return app
}
