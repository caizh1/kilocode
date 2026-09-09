import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { MarketDb, MIGRATIONS } from "@chipmate/market-db"
import { build } from "../src/index.ts"
import { LdapError } from "../src/ldap.ts"
import { authentication, deviceTokens, webLogin } from "./auth-fixture.ts"

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-admins-"))
  let now = Date.now()
  const db = new MarketDb({ dir: join(dir, "db") })
  const auth = await authentication(db, () => now)
  await mkdir(join(dir, "packages"))
  const app = build(db, { auth, extensionMarket: true, extensionRoot: join(dir, "extensions"), packageRoot: join(dir, "packages"), extensionScanMs: 60_000 })
  const unlock = await app.inject({ method: "POST", url: "/api/v1/admin/auth/session", payload: { key: "break-glass-test-key" } })
  assert.equal(unlock.statusCode, 200)
  const emergency = { cookie: String(unlock.headers["set-cookie"]).split(";", 1)[0], csrf: String(unlock.headers["x-csrf-token"]) }
  const headers = (credentials = emergency) => ({ cookie: credentials.cookie, "x-csrf-token": credentials.csrf, host: "market.test", origin: "http://market.test" })
  const grant = (username: string, credentials = emergency, subject = `guid-${username}`) => app.inject({
    method: "POST", url: "/api/v1/admin/auth/admins", headers: headers(credentials), payload: { username, subject },
  })
  const revoke = (username: string, credentials = emergency) => app.inject({ method: "DELETE", url: `/api/v1/admin/auth/admins/guid-${username}`, headers: headers(credentials) })
  return { app, db, auth, dir, emergency, headers, grant, revoke,
    advance(ms: number) { now += ms },
    async close() { await app.close(); await db.close(); await rm(dir, { recursive: true, force: true }) },
  }
}

test("未登录和普通用户无法读取设置、映射或管理员名单，LDAP 标记不能提权", async () => {
  const f = await setup()
  try {
    assert.deepEqual(await f.db.administrators(), [])
    const user = await webLogin(f.app, "admin")
    for (const url of ["session", "ldap", "identity-mappings", "admins"]) {
      assert.equal((await f.app.inject({ url: `/api/v1/admin/auth/${url}` })).statusCode, 401)
      assert.equal((await f.app.inject({ url: `/api/v1/admin/auth/${url}`, headers: { cookie: user.cookie, "x-is-admin": "true" } })).statusCode, 403)
    }
    assert.equal((await f.grant("admin", user)).statusCode, 403)
    assert.deepEqual(await f.db.administrators(), [])
  } finally { await f.close() }
})

test("应急首次授权不创建市场账号，新登录取得本地管理员权限并可授权他人", async () => {
  const f = await setup()
  try {
    const lookup = await f.app.inject({ method: "POST", url: "/api/v1/admin/auth/admins/resolve", headers: f.headers(), payload: { username: "alice" } })
    assert.equal(lookup.statusCode, 200)
    assert.equal(lookup.json().subject, "guid-alice")
    assert.equal(lookup.json().userId, undefined)
    assert.equal((await f.grant("alice")).statusCode, 200)
    assert.equal(await f.db.externalIdentity("ldap", "guid-alice"), undefined)
    const alice = await webLogin(f.app)
    const me = await f.app.inject({ url: "/api/v1/auth/me", headers: f.headers(alice) })
    assert.equal(me.json().isAdmin, true)
    assert.equal((await f.grant("bob", alice)).statusCode, 200)
    assert.equal((await f.db.administrators()).length, 2)
  } finally { await f.close() }
})

test("不能伪造确认身份，错误 CSRF 和跨来源授权会被拒绝", async () => {
  const f = await setup()
  try {
    assert.equal((await f.grant("alice", f.emergency, "guid-bob")).statusCode, 409)
    assert.equal((await f.grant("alice", { ...f.emergency, csrf: "wrong" })).statusCode, 403)
    const response = await f.app.inject({ method: "POST", url: "/api/v1/admin/auth/admins", headers: { ...f.headers(), origin: "https://other.test" }, payload: { username: "alice", subject: "guid-alice" } })
    assert.equal(response.statusCode, 403)
    assert.deepEqual(await f.db.administrators(), [])
  } finally { await f.close() }
})

test("授权与撤权立即撤销 Web、访问令牌、刷新令牌以及未兑换的设备授权", async () => {
  const f = await setup()
  try {
    const first = await webLogin(f.app)
    const tokens = await deviceTokens(f.app)
    const device = await f.app.inject({ method: "POST", url: "/api/v1/auth/device/code", headers: { host: "market.test" } })
    await f.app.inject({ method: "POST", url: "/api/v1/auth/device/approve", headers: f.headers(first), payload: { userCode: device.json().userCode } })
    assert.equal((await f.grant("alice")).statusCode, 200)
    assert.equal((await f.app.inject({ url: "/api/v1/auth/me", headers: f.headers(first) })).statusCode, 401)
    assert.equal((await f.app.inject({ url: "/api/v1/auth/me", headers: { authorization: `Bearer ${tokens.accessToken}` } })).statusCode, 401)
    assert.equal((await f.app.inject({ method: "POST", url: "/api/v1/auth/token/refresh", payload: { refreshToken: tokens.refreshToken } })).statusCode, 401)
    assert.notEqual((await f.app.inject({ method: "POST", url: "/api/v1/auth/device/token", payload: { deviceCode: device.json().deviceCode } })).statusCode, 200)
    await f.grant("bob")
    const administrator = await webLogin(f.app)
    const authorized = await deviceTokens(f.app)
    assert.equal((await f.revoke("alice")).statusCode, 200)
    assert.equal((await f.app.inject({ url: "/api/v1/admin/auth/ldap", headers: f.headers(administrator) })).statusCode, 401)
    assert.equal((await f.app.inject({ url: "/api/v1/admin/auth/ldap", headers: { authorization: `Bearer ${authorized.accessToken}` } })).statusCode, 401)
    const ordinary = await webLogin(f.app)
    assert.equal((await f.app.inject({ url: "/api/v1/auth/me", headers: f.headers(ordinary) })).json().isAdmin, false)
  } finally { await f.close() }
})

test("并发撤权仍保留最后一位管理员，拒绝操作进入审计", async () => {
  const f = await setup()
  try {
    await f.grant("alice"); await f.grant("bob")
    const results = await Promise.all([f.revoke("alice"), f.revoke("bob")])
    assert.deepEqual(results.map((item) => item.statusCode).sort(), [200, 409])
    assert.equal((await f.db.administrators()).length, 1)
    const db = new DatabaseSync(join(f.dir, "db", "market.sqlite"), { readOnly: true })
    try {
      const events = db.prepare("SELECT action,details_json FROM auth_audit_events WHERE action='server.admin.denied'").all()
      assert.ok(events.some((event) => String(event.details_json).includes("LAST_ADMIN_REQUIRED")))
    } finally { db.close() }
  } finally { await f.close() }
})

test("LDAP 查询期间被撤权的管理员不能继续授权", async () => {
  const f = await setup()
  try {
    await f.grant("alice"); await f.grant("bob")
    const alice = await webLogin(f.app)
    const original = f.auth.ldap.lookup.bind(f.auth.ldap)
    const entered = deferred()
    const release = deferred()
    f.auth.ldap.lookup = async (...args) => { entered.resolve(); await release.promise; return original(...args) }
    const pending = f.grant("charlie", alice)
    await entered.promise
    assert.equal((await f.revoke("alice")).statusCode, 200)
    release.resolve()
    assert.equal((await pending).statusCode, 401)
    assert.equal(await f.db.isAdministrator("guid-charlie"), false)
  } finally { await f.close() }
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

test("目标 LDAP 用户无效不会使有效管理会话退出", async () => {
  const f = await setup()
  try {
    f.auth.ldap.lookup = async () => { throw new LdapError("LDAP_CREDENTIALS_INVALID", "无匹配用户") }
    const result = await f.app.inject({ method: "POST", url: "/api/v1/admin/auth/admins/resolve", headers: f.headers(), payload: { username: "missing" } })
    assert.equal(result.statusCode, 400)
    assert.equal(result.json().code, "ADMIN_TARGET_INVALID")
    assert.equal((await f.app.inject({ url: "/api/v1/admin/auth/session", headers: f.headers() })).statusCode, 200)
  } finally { await f.close() }
})

test("数据库事务拒绝已经撤权的旧授权者证明", async () => {
  const f = await setup()
  try {
    await f.grant("alice"); await f.grant("bob")
    const alice = await webLogin(f.app)
    assert.ok(alice.cookie)
    const token = decodeURIComponent(alice.cookie.slice(alice.cookie.indexOf("=") + 1))
    const actor = { actor: (await f.db.externalIdentity("ldap", "guid-alice"))!.userId, subject: "guid-alice", sessionHash: createHash("sha256").update(token).digest("hex") }
    await f.revoke("alice")
    const result = await f.db.changeAdministrator({ actor, target: { subject: "guid-charlie", username: "charlie", displayName: "Charlie" }, grant: true, now: new Date().toISOString() })
    assert.deepEqual(result, { ok: false, code: "ADMIN_REQUIRED" })
    assert.equal(await f.db.isAdministrator("guid-charlie"), false)
  } finally { await f.close() }
})

test("设备码消费后、令牌落盘前发生撤权，不得重新发证", async () => {
  const f = await setup()
  try {
    await f.grant("alice"); await f.grant("bob")
    const alice = await webLogin(f.app)
    const device = await f.app.inject({ method: "POST", url: "/api/v1/auth/device/code", headers: { host: "market.test" } })
    const approved = await f.app.inject({ method: "POST", url: "/api/v1/auth/device/approve", headers: f.headers(alice), payload: { userCode: device.json().userCode } })
    assert.equal(approved.statusCode, 200)
    const original = f.db.createTokenPair.bind(f.db)
    const entered = deferred(), release = deferred()
    f.db.createTokenPair = async (input) => { entered.resolve(); await release.promise; return original(input) }
    const pending = f.app.inject({ method: "POST", url: "/api/v1/auth/device/token", payload: { deviceCode: device.json().deviceCode } })
    await entered.promise
    await f.revoke("alice")
    release.resolve()
    assert.equal((await pending).statusCode, 401)
    const check = new DatabaseSync(join(f.dir, "db", "market.sqlite"), { readOnly: true })
    try { assert.equal(check.prepare("SELECT COUNT(*) AS count FROM token_families").get()?.count, 0) }
    finally { check.close() }
  } finally { await f.close() }
})

test("同名不同 GUID 不共享权限，重新映射保留角色与历史上传并撤销旧会话", async () => {
  const f = await setup()
  try {
    f.auth.ldap.setProfile("bob", { displayName: "Alice" })
    await f.grant("alice")
    const alice = await webLogin(f.app)
    const bob = await webLogin(f.app, "bob")
    assert.equal((await f.app.inject({ url: "/api/v1/auth/me", headers: f.headers(bob) })).json().isAdmin, false)
    await f.db.identity({ id: "market-historical", displayName: "Alice" })
    const artifact = { id: "historic-artifact", sha256: "a".repeat(64), size: 1, path: join(f.dir, "old.vsix"), filename: "old.vsix", uploaderId: "market-historical", uploaderName: "Alice", sourceKey: "web:historical", sourceKind: "web" as const,
      manifest: { id: "test.history", publisher: "test", name: "history", displayName: "历史插件", description: "历史归属验证", version: "1.0.0", target: "universal", engineVscode: "*", categories: [], keywords: [], dependencies: [], prerelease: false, systemPlugin: false, readme: "" }, publishedAt: new Date().toISOString() }
    await f.db.publishExtension(artifact)
    const before = await f.db.extensionUploads("market-historical")
    assert.equal((await f.app.inject({ method: "DELETE", url: "/api/v1/admin/auth/identity-mappings/guid-alice", headers: f.headers() })).statusCode, 200)
    assert.equal((await f.app.inject({ method: "POST", url: "/api/v1/admin/auth/identity-mappings", headers: f.headers(), payload: { username: "alice", userId: "market-historical" } })).statusCode, 200)
    assert.equal((await f.app.inject({ url: "/api/v1/auth/me", headers: f.headers(alice) })).statusCode, 401)
    const mapped = await webLogin(f.app)
    const me = (await f.app.inject({ url: "/api/v1/auth/me", headers: f.headers(mapped) })).json()
    assert.equal(me.id, "market-historical"); assert.equal(me.isAdmin, true)
    assert.deepEqual(await f.db.extensionUploads("market-historical"), before)
    await f.grant("bob")
    const bobAdmin = await webLogin(f.app, "bob")
    assert.equal((await f.app.inject({ method: "DELETE", url: "/api/v1/extension-artifacts/historic-artifact", headers: f.headers(bobAdmin) })).statusCode, 403)
    await f.revoke("bob")
    for (const subject of ["guid-alice", "guid-bob"]) {
      assert.equal((await f.app.inject({ method: "DELETE", url: `/api/v1/admin/auth/identity-mappings/${subject}`, headers: f.headers() })).statusCode, 200)
    }
    assert.equal((await f.app.inject({ method: "POST", url: "/api/v1/admin/auth/identity-mappings", headers: f.headers(), payload: { username: "bob", userId: "market-historical" } })).statusCode, 200)
    const replacement = await webLogin(f.app, "bob")
    const replacementUser = (await f.app.inject({ url: "/api/v1/auth/me", headers: f.headers(replacement) })).json()
    assert.equal(replacementUser.id, "market-historical")
    assert.equal(replacementUser.isAdmin, false)
    assert.equal(await f.db.isAdministrator("guid-alice"), true)
    assert.deepEqual(await f.db.extensionUploads("market-historical"), before)
  } finally { await f.close() }
})

test("应急状态由服务端验证，过期和退出后原凭据不能再管理", async () => {
  const f = await setup()
  try {
    const status = await f.app.inject({ url: "/api/v1/admin/auth/session", headers: f.headers() })
    assert.equal(status.json().mode, "break-glass")
    assert.equal(status.headers["cache-control"], "no-store")
    assert.equal(status.headers["x-csrf-token"], f.emergency.csrf)
    assert.equal((await f.app.inject({ method: "DELETE", url: "/api/v1/admin/auth/session", headers: f.headers() })).statusCode, 200)
    assert.equal((await f.grant("alice")).statusCode, 401)
    const unlock = await f.app.inject({ method: "POST", url: "/api/v1/admin/auth/session", payload: { key: "break-glass-test-key" } })
    const cookie = String(unlock.headers["set-cookie"]).split(";", 1)[0]
    f.advance(15 * 60 * 1000)
    assert.equal((await f.app.inject({ url: "/api/v1/admin/auth/session", headers: { cookie } })).statusCode, 401)
    const renewed = await f.app.inject({ method: "POST", url: "/api/v1/admin/auth/session", payload: { key: "break-glass-test-key" } })
    const emergencyCookie = String(renewed.headers["set-cookie"]).split(";", 1)[0]
    const ordinary = await webLogin(f.app)
    const logout = await f.app.inject({ method: "DELETE", url: "/api/v1/auth/session", headers: { ...f.headers(ordinary), cookie: `${ordinary.cookie}; ${emergencyCookie}` } })
    assert.equal(logout.statusCode, 200)
    assert.equal((await f.app.inject({ url: "/api/v1/admin/auth/session", headers: { cookie: emergencyCookie } })).statusCode, 401)
  } finally { await f.close() }
})

test("v10 升级不继承旧管理员标记，并保留用户及外部身份", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-admin-migration-"))
  const path = join(root, "market.sqlite")
  try {
    const legacy = new DatabaseSync(path)
    legacy.exec("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)")
    const now = new Date().toISOString()
    for (const migration of MIGRATIONS.slice(0, 10)) {
      legacy.exec(migration.sql)
      legacy.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(migration.version, migration.name, now)
    }
    legacy.prepare("INSERT INTO users VALUES(?,?,?,?)").run("market-old", "历史用户", now, now)
    legacy.prepare("INSERT INTO external_identities VALUES(?,?,?,?,?,?,?,?)").run("ldap", "old-guid", "market-old", "alice", null, "历史用户", 1, now)
    legacy.prepare("INSERT INTO sessions(hash,user_id,idle_expires_at,absolute_expires_at,created_at,last_seen_at,auth_revision,subject,is_admin) VALUES(?,?,?,?,?,?,?,?,?)").run("old-session", "market-old", now, now, now, now, 1, "old-guid", 1)
    legacy.close()
    const db = new MarketDb({ dir: root })
    try {
      assert.equal((await db.health()).schemaVersion, 11)
      assert.deepEqual(await db.administrators(), [])
      assert.equal((await db.externalIdentity("ldap", "old-guid"))?.userId, "market-old")
      assert.equal(await db.isAdministrator("old-guid"), false)
    } finally { await db.close() }
    const check = new DatabaseSync(path, { readOnly: true })
    try { assert.equal(check.prepare("SELECT COUNT(*) AS count FROM sessions").get()?.count, 0) }
    finally { check.close() }
  } finally { await rm(root, { recursive: true, force: true }) }
})
