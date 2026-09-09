import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { AccessTokenItem, AdminActor, AdminTarget, MarketDb, MarketUserItem } from "@chipmate/market-db"
import { AuthSecrets } from "./auth-secrets.ts"
import {
  LdapAuthenticator,
  LdapError,
  validateLdapConfig,
  type LdapConfig,
  type LdapProfile,
  type LdapProvider,
} from "./ldap.ts"

const COOKIE = "chipmate_market_session"
const ADMIN_COOKIE = "chipmate_auth_admin_session"
const SOURCE = "ldap"
const IDLE = 2 * 60 * 60 * 1000
const ABSOLUTE = 8 * 60 * 60 * 1000
const REVERIFY = 15 * 60 * 1000
const ACCESS = 15 * 60 * 1000
const REFRESH = 30 * 24 * 60 * 60 * 1000
const DEVICE = 10 * 60 * 1000
const ADMIN = 15 * 60 * 1000
const POLL = 5

export interface IdentityOptions {
  ldap?: LdapProvider
  secrets?: AuthSecrets
  now?: () => number
}

export interface Principal {
  user: MarketUserItem
  mode: "bearer" | "session"
  sessionHash?: string
  csrfHash?: string
  familyId?: string
  authRevision: number
  subject: string
  isAdmin: boolean
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  tokenType: "Bearer"
  expiresIn: number
  refreshExpiresIn: number
  user: MarketUserItem
}

interface AdminSession {
  csrfHash: string
  csrf: string
  expiresAt: number
}

export interface AdminAuthorization extends AdminActor {
  mode: "ldap" | "break-glass"
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
  private readonly ldap: LdapProvider
  private readonly secrets: AuthSecrets | undefined
  private readonly now: () => number
  private readonly failures = new Map<string, { count: number; first: number; blockedUntil: number }>()
  private readonly admins = new Map<string, AdminSession>()

  constructor(
    private readonly db: MarketDb,
    opts: IdentityOptions = {},
  ) {
    this.ldap = opts.ldap ?? new LdapAuthenticator()
    this.secrets = opts.secrets
    this.now = opts.now ?? Date.now
  }

  async login(username: string, password: string, client = "unknown") {
    const normalized = username.trim().toLocaleLowerCase()
    if (!normalized || !password) throw invalidCredentials()
    const key = `${client}:${normalized}`
    this.checkRate(key)
    try {
      const loaded = await this.loadedSettings()
      const profile = await this.ldap.authenticate(loaded.config, loaded.password, username, password)
      const user = await this.bindProfile(profile)
      const isAdmin = await this.db.isAdministrator(profile.subject)
      const token = randomToken()
      const csrf = randomToken()
      const stamp = iso(this.now())
      await this.db.createSession({
        id: user.id,
        displayName: user.displayName,
        hash: hash(token),
        csrfHash: hash(csrf),
        idleExpiresAt: iso(this.now() + IDLE),
        absoluteExpiresAt: iso(this.now() + ABSOLUTE),
        authRevision: loaded.revision,
        subject: profile.subject,
        isAdmin,
        verifiedAt: stamp,
      })
      this.failures.delete(key)
      return { user, token, csrf, isAdmin }
    } catch (err) {
      this.recordFailure(key)
      throw identityFailure(err)
    }
  }

  async principal(req: FastifyRequest): Promise<Principal> {
    const bearer = authorization(req.headers.authorization)
    if (bearer) {
      const token = await this.db.accessToken({ hash: hash(bearer), now: iso(this.now()) })
      if (!token) throw new IdentityError(401, "SESSION_EXPIRED", "访问令牌已过期。")
      return tokenPrincipal(token)
    }
    const token = cookies(req.headers.cookie)[COOKIE]
    if (!token) throw new IdentityError(401, "AUTH_REQUIRED", "需要登录。")
    const sessionHash = hash(token)
    const session = await this.db.getSession({
      hash: sessionHash,
      now: iso(this.now()),
      idleExpiresAt: iso(this.now() + IDLE),
    })
    if (!session || !session.subject) throw new IdentityError(401, "SESSION_EXPIRED", "会话已过期。")
    const settings = await this.db.authSettings()
    if (!settings || settings.revision !== session.authRevision) {
      await this.db.deleteSession(sessionHash)
      throw new IdentityError(401, "SESSION_EXPIRED", "认证配置已更新，请重新登录。")
    }
    if (!session.verifiedAt || this.now() - Date.parse(session.verifiedAt) >= REVERIFY) {
      await this.reverify(session.subject, sessionHash)
    }
    const isAdmin = await this.db.isAdministrator(session.subject)
    return {
      user: session.user,
      mode: "session",
      sessionHash,
      csrfHash: session.csrfHash,
      authRevision: session.authRevision,
      subject: session.subject,
      isAdmin,
    }
  }

  async write(req: FastifyRequest) {
    const principal = await this.principal(req)
    if (principal.mode === "bearer") return principal
    if (!sameOrigin(req)) throw new IdentityError(403, "ORIGIN_INVALID", "请求来源与 Server 不一致。")
    const csrf = text(req.headers["x-csrf-token"])
    if (!csrf || !equal(hash(csrf), principal.csrfHash ?? "")) {
      throw new IdentityError(403, "CSRF_INVALID", "CSRF 凭据无效。")
    }
    return principal
  }

  async logout(req: FastifyRequest) {
    const principal = await this.write(req)
    if (!principal.sessionHash) throw new IdentityError(400, "AUTH_INVALID", "必须使用网页会话退出。")
    await this.db.deleteSession(principal.sessionHash)
    const emergency = cookies(req.headers.cookie)[ADMIN_COOKIE]
    if (emergency) this.admins.delete(hash(emergency))
  }

  cookie(reply: FastifyReply, token: string, secure: boolean) {
    reply.header("set-cookie", cookie(COOKIE, token, ABSOLUTE, secure))
  }

  clear(reply: FastifyReply, secure: boolean) {
    reply.header("set-cookie", [cookie(COOKIE, "", 0, secure), cookie(ADMIN_COOKIE, "", 0, secure)])
  }

  async authStatus() {
    const item = await this.db.authSettings()
    if (!item) return { configured: false, mode: "ldap" as const, breakGlassAvailable: this.secrets?.hasBreakGlass() === true }
    const config = parseConfig(item.configJson)
    return {
      configured: true,
      mode: "ldap" as const,
      revision: item.revision,
      name: config.name,
      enabled: config.enabled,
      security: config.security,
      insecure: config.security === "unencrypted",
      breakGlassAvailable: this.secrets?.hasBreakGlass() === true,
    }
  }

  async config() {
    const item = await this.db.authSettings()
    if (!item) return undefined
    return {
      ...parseConfig(item.configJson),
      hasBindPassword: Boolean(item.bindPasswordCiphertext),
      revision: item.revision,
      updatedAt: item.updatedAt,
    }
  }

  async testConfig(config: LdapConfig, bindPassword: string, username?: string) {
    const password = await this.passwordFor(bindPassword)
    try {
      return await this.ldap.test(config, password, username)
    } catch (err) {
      throw identityFailure(err)
    }
  }

  async saveConfig(config: LdapConfig, bindPassword: string, actor: string, testUsername?: string) {
    const password = await this.passwordFor(bindPassword)
    try {
      await this.ldap.test(config, password, testUsername)
    } catch (err) {
      throw identityFailure(err)
    }
    const current = await this.db.authSettings()
    const updatedAt = iso(this.now())
    const saved = await this.db.putAuthSettings({
      revision: (current?.revision ?? 0) + 1,
      configJson: JSON.stringify(config),
      bindPasswordCiphertext: this.requireSecrets().encrypt(password),
      updatedAt,
      updatedBy: actor,
    })
    this.admins.clear()
    await this.db.authAudit({
      actor,
      action: "ldap.config.updated",
      details: { revision: saved.revision, security: config.security },
      occurredAt: updatedAt,
    })
    return { ...config, hasBindPassword: true, revision: saved.revision, updatedAt }
  }

  async createDevice(origin: string) {
    const deviceCode = randomToken()
    const userCode = `${code(4)}-${code(4)}`
    const createdAt = iso(this.now())
    const expiresAt = iso(this.now() + DEVICE)
    await this.db.createDeviceAuthorization({
      deviceHash: hash(deviceCode),
      userCode,
      intervalSeconds: POLL,
      expiresAt,
      createdAt,
    })
    return {
      deviceCode,
      userCode,
      verificationUri: `${origin}/device`,
      verificationUriComplete: `${origin}/device?user_code=${encodeURIComponent(userCode)}`,
      expiresIn: DEVICE / 1000,
      interval: POLL,
    }
  }

  async approveDevice(userCode: string, principal: Principal) {
    const approved = await this.db.approveDeviceAuthorization({
      userCode: normalizeCode(userCode),
      userId: principal.user.id,
      approvedAt: iso(this.now()),
      actor: { actor: principal.user.id, subject: principal.subject,
        ...(principal.sessionHash ? { sessionHash: principal.sessionHash } : {}),
        ...(principal.familyId ? { familyId: principal.familyId } : {}) },
    })
    if (!approved) throw new IdentityError(404, "DEVICE_CODE_INVALID", "设备码无效或已过期。")
  }

  async denyDevice(userCode: string) {
    const denied = await this.db.denyDeviceAuthorization(normalizeCode(userCode), iso(this.now()))
    if (!denied) throw new IdentityError(404, "DEVICE_CODE_INVALID", "设备码无效或已过期。")
  }

  async pollDevice(deviceCode: string): Promise<TokenPair | { state: string; interval?: number }> {
    const result = await this.db.pollDeviceAuthorization({ deviceHash: hash(deviceCode), now: iso(this.now()) })
    if (result.state !== "approved") {
      return { state: result.state, ...(result.state === "slow_down" ? { interval: POLL + 5 } : {}) }
    }
    const mapping = (await this.db.identityMappings()).find((item) => item.user.id === result.item.userId)
    if (!mapping?.external) throw new IdentityError(401, "AUTH_INVALID", "批准用户没有 LDAP 身份映射。")
    return this.issueTokens(mapping.user, mapping.external.subject, hash(deviceCode))
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const accessToken = randomToken()
    const nextRefresh = randomToken()
    const now = iso(this.now())
    const result = await this.db.rotateRefreshToken({
      hash: hash(refreshToken),
      now,
      nextAccessHash: hash(accessToken),
      nextAccessExpiresAt: iso(this.now() + ACCESS),
      nextRefreshHash: hash(nextRefresh),
      nextRefreshExpiresAt: iso(this.now() + REFRESH),
    })
    if (result.state !== "ok") {
      throw new IdentityError(401, "SESSION_EXPIRED", `刷新令牌不可用：${result.state}`)
    }
    try {
      await this.reverify(result.token.subject)
      await this.db.updateTokenFamilyAuthorization(result.token.familyId, await this.db.isAdministrator(result.token.subject))
    } catch (err) {
      await this.db.revokeTokenFamily(result.token.familyId, now)
      throw err
    }
    return pair(accessToken, nextRefresh, result.token.user)
  }

  async revoke(accessToken: string) {
    if (accessToken) await this.db.revokeAccessToken(hash(accessToken), iso(this.now()))
  }

  async breakGlassLogin(value: string) {
    if (!this.requireSecrets().verifyBreakGlass(value)) {
      throw new IdentityError(401, "AUTH_INVALID", "应急管理密钥无效。")
    }
    const token = randomToken()
    const csrf = randomToken()
    for (const [key, session] of this.admins) if (session.expiresAt <= this.now()) this.admins.delete(key)
    this.admins.set(hash(token), { csrfHash: hash(csrf), csrf, expiresAt: this.now() + ADMIN })
    return { token, csrf }
  }

  adminCookie(reply: FastifyReply, token: string, secure: boolean) {
    reply.header("set-cookie", cookie(ADMIN_COOKIE, token, ADMIN, secure))
  }

  clearAdmin(reply: FastifyReply, secure: boolean) {
    reply.header("set-cookie", cookie(ADMIN_COOKIE, "", 0, secure))
  }

  async admin(req: FastifyRequest, write = false): Promise<AdminAuthorization> {
    const token = cookies(req.headers.cookie)[ADMIN_COOKIE]
    const session = token ? this.admins.get(hash(token)) : undefined
    if (session && session.expiresAt > this.now()) {
      if (write) {
        const csrf = text(req.headers["x-csrf-token"])
        if (!sameOrigin(req) || !csrf || !equal(hash(csrf), session.csrfHash)) {
          throw new IdentityError(403, "CSRF_INVALID", "管理员 CSRF 凭据无效。")
        }
      }
      return { actor: "break-glass", mode: "break-glass", expiresAt: iso(session.expiresAt) }
    }
    const principal = write ? await this.write(req) : await this.principal(req)
    if (!principal.isAdmin) throw new IdentityError(403, "ADMIN_REQUIRED", "当前用户没有 Server 管理员权限。")
    return {
      actor: principal.user.id, mode: "ldap", subject: principal.subject,
      ...(principal.sessionHash ? { sessionHash: principal.sessionHash } : {}),
      ...(principal.familyId ? { familyId: principal.familyId } : {}),
    }
  }

  async adminStatus(req: FastifyRequest, reply: FastifyReply) {
    const admin = await this.admin(req)
    reply.header("cache-control", "no-store")
    const token = cookies(req.headers.cookie)[ADMIN_COOKIE]
    const session = token ? this.admins.get(hash(token)) : undefined
    if (admin.mode === "break-glass" && session) reply.header("x-csrf-token", session.csrf)
    return { mode: admin.mode, ...(admin.expiresAt ? { expiresAt: admin.expiresAt } : {}),
      ...(admin.subject ? { subject: admin.subject, userId: admin.actor } : {}) }
  }

  async adminLogout(req: FastifyRequest) {
    await this.admin(req, true)
    const token = cookies(req.headers.cookie)[ADMIN_COOKIE]
    if (token) this.admins.delete(hash(token))
  }

  async resolveAdministrator(username: string) {
    const loaded = await this.loadedSettings()
    try {
      const profile = await this.ldap.lookup(loaded.config, loaded.password, username)
      const mapped = await this.db.externalIdentity(SOURCE, profile.subject)
      return {
        subject: profile.subject, username: profile.username, displayName: profile.displayName,
        dn: profile.dn, ...(profile.email ? { email: profile.email } : {}),
        ...(mapped ? { userId: mapped.userId } : {}),
      }
    } catch (err) {
      if (err instanceof LdapError && err.code !== "LDAP_UNAVAILABLE" && err.code !== "LDAP_CONFIG_INVALID") {
        throw new IdentityError(400, "ADMIN_TARGET_INVALID", "未找到唯一且允许登录的 LDAP 用户，请检查用户名。")
      }
      throw identityFailure(err)
    }
  }

  async changeAdministrator(req: FastifyRequest, target: AdminTarget, grant: boolean) {
    await this.admin(req, true)
    const resolved = grant ? await this.resolveAdministrator(target.username) : target
    if (resolved.subject !== target.subject) throw new IdentityError(409, "IDENTITY_CHANGED", "LDAP 身份已变化，请重新查询后确认。")
    // LDAP 查询结束后再次验证会话，并在数据库事务内复核授权，避免异步查询期间被撤权。
    const actor = await this.admin(req, true)
    const result = await this.db.changeAdministrator({ actor, target: resolved, grant, now: iso(this.now()) })
    if (!result.ok) throw new IdentityError(result.code === "LAST_ADMIN_REQUIRED" ? 409 : 403, result.code,
      result.code === "LAST_ADMIN_REQUIRED" ? "不能撤销最后一位管理员，请先授权另一位管理员。" : "管理员权限已失效。")
    return { ok: true, changed: result.changed, sessionsRevoked: result.changed }
  }

  async auditAdminDenied(req: FastifyRequest, action: string, err: unknown) {
    if (!(err instanceof IdentityError)) return
    await this.db.authAudit({ actor: "unauthorized", action: "server.admin.denied",
      details: { operation: action, code: err.code, method: req.method }, occurredAt: iso(this.now()) })
  }

  async mapIdentity(username: string, userId: string, actor: string) {
    const loaded = await this.loadedSettings()
    let profile: LdapProfile
    try {
      profile = await this.ldap.lookup(loaded.config, loaded.password, username)
    } catch (err) {
      throw identityFailure(err)
    }
    const target = (await this.db.identityMappings()).find((item) => item.user.id === userId)
    if (!target) throw new IdentityError(404, "NOT_FOUND", "历史用户不存在。")
    const existing = await this.db.externalIdentity(SOURCE, profile.subject)
    if ((existing && existing.userId !== userId) || (target.external && target.external.subject !== profile.subject)) {
      throw new IdentityError(409, "IDENTITY_ALREADY_MAPPED", "LDAP 身份或历史用户已经绑定到其他映射，请先解除原映射。")
    }
    const mapped = await this.db.putExternalIdentity({
      sourceId: SOURCE,
      subject: profile.subject,
      userId,
      username: profile.username,
      ...(profile.email ? { email: profile.email } : {}),
      displayName: profile.displayName,
      isAdmin: await this.db.isAdministrator(profile.subject),
      verifiedAt: iso(this.now()),
    })
    await this.db.authAudit({
      actor,
      action: "ldap.identity.mapped",
      details: { userId, username: profile.username },
      occurredAt: iso(this.now()),
    })
    return mapped
  }

  async unmapIdentity(subject: string, actor: string) {
    const removed = await this.db.deleteExternalIdentity(SOURCE, subject)
    if (removed) {
      await this.db.authAudit({
        actor,
        action: "ldap.identity.unmapped",
        details: { subjectHash: hash(subject) },
        occurredAt: iso(this.now()),
      })
    }
    return removed
  }

  private async issueTokens(user: MarketUserItem, subject: string, deviceHash: string) {
    const settings = await this.db.authSettings()
    if (!settings) throw new IdentityError(503, "AUTH_NOT_CONFIGURED", "LDAP 尚未配置。")
    const accessToken = randomToken()
    const refreshToken = randomToken()
    const createdAt = iso(this.now())
    const issued = await this.db.createTokenPair({
      deviceHash,
      familyId: randomUUID(),
      userId: user.id,
      authRevision: settings.revision,
      subject,
      isAdmin: await this.db.isAdministrator(subject),
      familyExpiresAt: iso(this.now() + REFRESH),
      accessHash: hash(accessToken),
      accessExpiresAt: iso(this.now() + ACCESS),
      refreshHash: hash(refreshToken),
      refreshExpiresAt: iso(this.now() + REFRESH),
      createdAt,
    })
    if (!issued) throw new IdentityError(401, "SESSION_EXPIRED", "设备授权已失效，请重新登录。")
    return pair(accessToken, refreshToken, user)
  }

  private async bindProfile(profile: LdapProfile) {
    const existing = await this.db.externalIdentity(SOURCE, profile.subject)
    const userId = existing?.userId ?? `ldap-${hash(`${SOURCE}:${profile.subject}`).slice(0, 40)}`
    return (
      await this.db.putExternalIdentity({
        sourceId: SOURCE,
        subject: profile.subject,
        userId,
        username: profile.username,
        ...(profile.email ? { email: profile.email } : {}),
        displayName: profile.displayName,
        isAdmin: await this.db.isAdministrator(profile.subject),
        verifiedAt: iso(this.now()),
      })
    ).user
  }

  private async reverify(subject: string, sessionHash?: string) {
    const identity = await this.db.externalIdentity(SOURCE, subject)
    if (!identity) throw new IdentityError(401, "SESSION_EXPIRED", "LDAP 身份映射不存在。")
    const loaded = await this.loadedSettings()
    try {
      const profile = await this.ldap.lookup(loaded.config, loaded.password, identity.username)
      if (profile.subject !== subject) throw invalidCredentials()
      await this.bindProfile(profile)
      if (sessionHash) await this.db.touchSessionVerification(sessionHash, iso(this.now()), await this.db.isAdministrator(subject))
      return profile
    } catch (err) {
      throw identityFailure(err)
    }
  }

  private async loadedSettings() {
    const item = await this.db.authSettings()
    if (!item) throw new IdentityError(503, "AUTH_NOT_CONFIGURED", "LDAP 尚未配置。")
    const config = parseConfig(item.configJson)
    if (!config.enabled) throw new IdentityError(503, "AUTH_NOT_CONFIGURED", "LDAP 认证当前未启用。")
    return {
      revision: item.revision,
      config,
      password: this.requireSecrets().decrypt(item.bindPasswordCiphertext),
    }
  }

  private async passwordFor(candidate: string) {
    if (candidate) return candidate
    const current = await this.db.authSettings()
    if (!current) return ""
    return this.requireSecrets().decrypt(current.bindPasswordCiphertext)
  }

  private requireSecrets() {
    if (!this.secrets) throw new IdentityError(503, "AUTH_SECRET_UNAVAILABLE", "认证密钥文件未配置。")
    return this.secrets
  }

  private checkRate(key: string) {
    const entry = this.failures.get(key)
    if (entry && entry.blockedUntil > this.now()) {
      throw new IdentityError(
        429,
        "RATE_LIMITED",
        "登录尝试过多，请稍后重试。",
        String(Math.ceil((entry.blockedUntil - this.now()) / 1000)),
      )
    }
  }

  private recordFailure(key: string) {
    const current = this.failures.get(key)
    const fresh = !current || this.now() - current.first > 5 * 60 * 1000
    const count = fresh ? 1 : current.count + 1
    this.failures.set(key, {
      count,
      first: fresh ? this.now() : current.first,
      blockedUntil: count >= 5 ? this.now() + 10 * 60 * 1000 : 0,
    })
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

function parseConfig(value: string): LdapConfig {
  let config: LdapConfig
  try {
    config = JSON.parse(value) as LdapConfig
  } catch {
    throw new IdentityError(503, "AUTH_CONFIG_INVALID", "LDAP 配置无效。")
  }
  try {
    validateLdapConfig(config)
  } catch (err) {
    throw identityFailure(err)
  }
  return config
}

function identityFailure(err: unknown) {
  if (err instanceof IdentityError) return err
  if (err instanceof LdapError) {
    if (err.code === "LDAP_UNAVAILABLE" || err.code === "LDAP_CONFIG_INVALID") {
      return new IdentityError(503, err.code, err.message)
    }
    return invalidCredentials()
  }
  return new IdentityError(500, "INTERNAL_ERROR", "认证服务发生内部错误。")
}

function invalidCredentials() {
  return new IdentityError(401, "AUTH_INVALID", "用户名或密码错误。")
}

function tokenPrincipal(item: AccessTokenItem): Principal {
  return {
    user: item.user,
    mode: "bearer",
    familyId: item.familyId,
    authRevision: item.authRevision,
    subject: item.subject,
    isAdmin: item.isAdmin,
  }
}

function pair(accessToken: string, refreshToken: string, user: MarketUserItem): TokenPair {
  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: ACCESS / 1000,
    refreshExpiresIn: REFRESH / 1000,
    user,
  }
}

function cookie(name: string, value: string, maxAge: number, secure: boolean) {
  const attrs = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge / 1000}`]
  if (secure) attrs.push("Secure")
  return attrs.join("; ")
}

function randomToken() {
  return randomBytes(32).toString("base64url")
}

function code(length: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return Array.from(randomBytes(length), (value) => alphabet[value % alphabet.length]).join("")
}

function normalizeCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .replace(/^(.{4})(.{4})$/, "$1-$2")
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

function iso(value: number) {
  return new Date(value).toISOString()
}
