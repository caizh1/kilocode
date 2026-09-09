import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { MarketDb } from "@chipmate/market-db"
import { AuthSecrets } from "../src/auth-secrets.ts"
import { applyUserFilter, validateLdapConfig, type LdapConfig } from "../src/ldap.ts"
import { build } from "../src/index.ts"
import { authentication, deviceTokens, webLogin } from "./auth-fixture.ts"

const ldap: LdapConfig = {
  enabled: true,
  name: "生产 AD",
  host: "ad.test",
  port: 389,
  security: "unencrypted",
  verifyCertificate: true,
  bindDn: "CN=ChipMate,OU=Service,DC=test,DC=local",
  userSearchBase: "DC=test,DC=local",
  userFilter: "(&(objectCategory=Person)(sAMAccountName=%s))",
  usernameAttribute: "sAMAccountName",
  firstNameAttribute: "givenName",
  surnameAttribute: "sn",
  emailAttribute: "mail",
  attributesInBindContext: false,
  insecureAcknowledged: true,
}

test("LDAP 过滤器输入会转义，未确认的明文连接不能保存", () => {
  assert.equal(
    applyUserFilter("(&(objectClass=user)(sAMAccountName=%s))", "alice*)(|(cn=*))"),
    "(&(objectClass=user)(sAMAccountName=alice\\2a\\29\\28|\\28cn=\\2a\\29\\29))",
  )
  assert.throws(
    () => validateLdapConfig({ ...ldap, insecureAcknowledged: false }),
    /必须明确确认风险/,
  )
})

test("Bind 密码只保存密文，配置读取不会返回明文", async () => {
  const fixture = await setup()
  try {
    const unlock = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/session",
      payload: { key: "break-glass-test-key" },
    })
    assert.equal(unlock.statusCode, 200)
    const settings = await fixture.app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/ldap",
      headers: { cookie: String(unlock.headers["set-cookie"]).split(";", 1)[0] },
    })
    assert.equal(settings.statusCode, 200)
    assert.equal(settings.json().config.hasBindPassword, true)
    assert.equal("bindPassword" in settings.json().config, false)
    const database = await readFile(join(fixture.dir, "db", "market.sqlite"))
    assert.equal(database.includes(Buffer.from("bind-password")), false)
  } finally {
    await fixture.close()
  }
})

test("设备码令牌支持单次刷新轮换，重放会撤销整个令牌族", async () => {
  const fixture = await setup()
  try {
    const first = await deviceTokens(fixture.app, "alice")
    const refreshed = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/auth/token/refresh",
      payload: { refreshToken: first.refreshToken },
    })
    assert.equal(refreshed.statusCode, 200, refreshed.body)
    assert.notEqual(refreshed.json().refreshToken, first.refreshToken)

    const replay = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/auth/token/refresh",
      payload: { refreshToken: first.refreshToken },
    })
    assert.equal(replay.statusCode, 401)

    const revoked = await fixture.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${refreshed.json().accessToken}` },
    })
    assert.equal(revoked.statusCode, 401)
  } finally {
    await fixture.close()
  }
})

test("用户可以显式拒绝设备码，拒绝后不能兑换令牌", async () => {
  const fixture = await setup()
  try {
    const login = await webLogin(fixture.app, "alice")
    const device = await fixture.app.inject({ method: "POST", url: "/api/v1/auth/device/code", headers: { host: "market.test" } })
    const denied = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/auth/device/deny",
      headers: { cookie: login.cookie, "x-csrf-token": login.csrf, host: "market.test", origin: "http://market.test" },
      payload: { userCode: device.json().userCode },
    })
    assert.equal(denied.statusCode, 200)
    const token = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/auth/device/token",
      payload: { deviceCode: device.json().deviceCode },
    })
    assert.equal(token.statusCode, 403)
    assert.equal(token.json().code, "DEVICE_CODE_INVALID")
  } finally {
    await fixture.close()
  }
})

test("更新 LDAP 配置会递增认证版本并撤销网页与插件会话", async () => {
  const fixture = await setup()
  try {
    const tokens = await deviceTokens(fixture.app, "alice")
    const unlock = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/session",
      payload: { key: "break-glass-test-key" },
    })
    const cookie = String(unlock.headers["set-cookie"]).split(";", 1)[0]
    const csrf = String(unlock.headers["x-csrf-token"])
    const saved = await fixture.app.inject({
      method: "PUT",
      url: "/api/v1/admin/auth/ldap",
      headers: { cookie, "x-csrf-token": csrf, host: "market.test", origin: "http://market.test" },
      payload: { config: { ...ldap, name: "生产 AD 2" }, bindPassword: "" },
    })
    assert.equal(saved.statusCode, 200, saved.body)
    assert.equal(saved.json().config.revision, 2)
    const revoked = await fixture.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    assert.equal(revoked.statusCode, 401)
  } finally {
    await fixture.close()
  }
})

test("安装器生成的换行 break-glass 文件可使用用户输入验证", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-auth-secret-"))
  try {
    const master = join(dir, "master.key")
    const emergency = join(dir, "break-glass.key")
    await writeFile(master, `${"a".repeat(48)}\n`)
    await writeFile(emergency, "emergency-key\n")
    const secrets = AuthSecrets.fromEnvironment({
      CHIPMATE_AUTH_MASTER_KEY_FILE: master,
      CHIPMATE_AUTH_BREAK_GLASS_KEY_FILE: emergency,
    })
    assert.equal(secrets.verifyBreakGlass("emergency-key"), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("LDAP 管理员标记不授予本地权限，网页复核和刷新不会恢复旧权限", async () => {
  let now = Date.parse("2026-09-03T00:00:00.000Z")
  const fixture = await setup(() => now)
  try {
    const login = await webLogin(fixture.app, "admin")
    const tokens = await deviceTokens(fixture.app, "admin")
    fixture.auth.ldap.setAdmin("admin", false)
    now += 15 * 60 * 1000

    const web = await fixture.app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/ldap",
      headers: { cookie: login.cookie },
    })
    assert.equal(web.statusCode, 403, web.body)

    const refreshed = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/auth/token/refresh",
      payload: { refreshToken: tokens.refreshToken },
    })
    assert.equal(refreshed.statusCode, 200, refreshed.body)
    const bearer = await fixture.app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/ldap",
      headers: { authorization: `Bearer ${refreshed.json().accessToken}` },
    })
    assert.equal(bearer.statusCode, 403, bearer.body)
  } finally {
    await fixture.close()
  }
})

async function setup(now?: () => number) {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-auth-test-"))
  const db = new MarketDb({ dir: join(dir, "db") })
  const auth = await authentication(db, now)
  const app = build(db, { auth })
  return {
    app,
    db,
    auth,
    dir,
    async close() {
      await app.close()
      await db.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
