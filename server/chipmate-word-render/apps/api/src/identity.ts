import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { createRequire } from "node:module"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { MarketDb, MarketUserItem } from "@chipmate/market-db"

const require = createRequire(import.meta.url)
const legacy = require("../../../server.js") as {
  resolveNewApiUser(
    key: string,
  ): Promise<
    | { ok: true; user: { name: string; tokenName?: string }; status: number }
    | { ok: false; code: string; status: number; retryAfter?: string }
  >
}

const COOKIE = "chipmate_market_session"
const IDLE = 2 * 60 * 60 * 1000
const ABSOLUTE = 8 * 60 * 60 * 1000

export type ResolveUser = typeof legacy.resolveNewApiUser

export interface Principal {
  user: MarketUserItem
  mode: "bearer" | "session"
  sessionHash?: string
  csrfHash?: string
}

export class IdentityError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: string,
  ) {
    super(message)
  }
}

export class Identity {
  constructor(
    private readonly db: MarketDb,
    private readonly resolve: ResolveUser = legacy.resolveNewApiUser,
    private readonly now: () => number = Date.now,
  ) {}

  async login(key: string) {
    const result = await this.resolve(key)
    if (!result.ok) throw failure(result)
    const user = await this.db.identity(identity(result.user.name))
    const token = randomBytes(32).toString("base64url")
    const csrf = randomBytes(32).toString("base64url")
    const now = this.now()
    await this.db.createSession({
      id: user.id,
      displayName: user.displayName,
      hash: hash(token),
      csrfHash: hash(csrf),
      idleExpiresAt: new Date(now + IDLE).toISOString(),
      absoluteExpiresAt: new Date(now + ABSOLUTE).toISOString(),
    })
    return { user, token, csrf }
  }

  cookie(reply: FastifyReply, token: string, secure: boolean) {
    const attrs = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${ABSOLUTE / 1000}`]
    if (secure) attrs.push("Secure")
    reply.header("set-cookie", attrs.join("; "))
  }

  clear(reply: FastifyReply, secure: boolean) {
    const attrs = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"]
    if (secure) attrs.push("Secure")
    reply.header("set-cookie", attrs.join("; "))
  }

  async principal(req: FastifyRequest): Promise<Principal> {
    const bearer = authorization(req.headers.authorization)
    if (bearer) {
      const result = await this.resolve(bearer)
      if (!result.ok) throw failure(result)
      return { user: await this.db.identity(identity(result.user.name)), mode: "bearer" }
    }
    const token = cookies(req.headers.cookie)[COOKIE]
    if (!token) throw new IdentityError(401, "AUTH_REQUIRED", "Authentication is required.")
    const now = this.now()
    const sessionHash = hash(token)
    const session = await this.db.getSession({
      hash: sessionHash,
      now: new Date(now).toISOString(),
      idleExpiresAt: new Date(now + IDLE).toISOString(),
    })
    if (!session) throw new IdentityError(401, "SESSION_EXPIRED", "Session expired.")
    return { user: session.user, mode: "session", sessionHash, csrfHash: session.csrfHash }
  }

  async write(req: FastifyRequest) {
    const principal = await this.principal(req)
    if (principal.mode === "bearer") return principal
    if (!sameOrigin(req)) throw new IdentityError(403, "ORIGIN_INVALID", "Origin does not match Host.")
    const csrf = text(req.headers["x-csrf-token"])
    if (!csrf || !equal(hash(csrf), principal.csrfHash ?? "")) {
      throw new IdentityError(403, "CSRF_INVALID", "CSRF token is invalid.")
    }
    return principal
  }

  async logout(req: FastifyRequest) {
    const principal = await this.write(req)
    if (!principal.sessionHash) throw new IdentityError(400, "AUTH_INVALID", "Cookie session required.")
    await this.db.deleteSession(principal.sessionHash)
  }
}

export function sendIdentityError(reply: FastifyReply, err: unknown) {
  if (err instanceof IdentityError) {
    if (err.retryAfter) reply.header("retry-after", err.retryAfter)
    return reply.code(err.status).send({ ok: false, code: err.code, message: err.message })
  }
  throw err
}

export function isSecure(req: FastifyRequest) {
  return req.protocol === "https"
}

function identity(name: string) {
  const displayName = name.trim()
  return { id: `market-${hash(displayName.toLocaleLowerCase()).slice(0, 40)}`, displayName }
}

function failure(result: { code: string; status: number; retryAfter?: string }): IdentityError {
  const limited = result.status === 429 || result.code === "new-api-rate-limited"
  const retryAfter = limited ? retry(result.retryAfter) : undefined
  return new IdentityError(result.status, limited ? "RATE_LIMITED" : "AUTH_INVALID", result.code, retryAfter)
}

function retry(value: string | undefined): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  if (/^\d{1,10}$/.test(text)) return text
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toUTCString() : undefined
}

function authorization(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ""
}

function cookies(value: string | undefined) {
  return Object.fromEntries(
    (value ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((part) => part.length === 2 && part[0])
      .map(([key, val]) => [key, decodeURIComponent(val ?? "")]),
  )
}

function sameOrigin(req: FastifyRequest) {
  const origin = text(req.headers.origin)
  const host = text(req.headers.host)
  if (!origin || !host) return false
  try {
    const url = new URL(origin)
    return url.host === host && url.protocol === `${req.protocol}:`
  } catch {
    return false
  }
}

function text(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0]?.trim() ?? "") : (value?.trim() ?? "")
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function equal(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
