import type { FastifyInstance } from "fastify"
import type { MarketDb } from "@chipmate/market-db"
import { AuthSecrets } from "../src/auth-secrets.ts"
import { Identity } from "../src/identity.ts"
import { LdapError, type LdapConfig, type LdapProfile, type LdapProvider } from "../src/ldap.ts"

const config: LdapConfig = {
  enabled: true,
  name: "测试目录",
  host: "ad.test",
  port: 389,
  security: "unencrypted",
  verifyCertificate: true,
  bindDn: "CN=ChipMate,OU=Service,DC=test,DC=local",
  userSearchBase: "DC=test,DC=local",
  userFilter: "(sAMAccountName=%s)",
  usernameAttribute: "sAMAccountName",
  firstNameAttribute: "givenName",
  surnameAttribute: "sn",
  emailAttribute: "mail",
  attributesInBindContext: false,
  insecureAcknowledged: true,
}

class TestLdap implements LdapProvider {
  private readonly adminOverrides = new Map<string, boolean>()
  private readonly profiles = new Map<string, Partial<LdapProfile>>()

  setProfile(username: string, value: Partial<LdapProfile>) { this.profiles.set(normalize(username), value) }

  setAdmin(username: string, isAdmin: boolean) {
    this.adminOverrides.set(normalize(username), isAdmin)
  }

  async authenticate(_config: LdapConfig, _bindPassword: string, username: string, password: string) {
    if (password !== "password") throw new LdapError("LDAP_CREDENTIALS_INVALID", "用户名或密码错误。")
    return this.profile(username)
  }

  async lookup(_config: LdapConfig, _bindPassword: string, username: string) {
    return this.profile(username)
  }

  async test(_config: LdapConfig, _bindPassword: string, username?: string) {
    return username ? this.profile(username) : undefined
  }

  private profile(username: string) {
    const result = profile(username)
    return { ...result, isAdmin: this.adminOverrides.get(normalize(username)) ?? result.isAdmin, ...this.profiles.get(normalize(username)) }
  }
}

export async function authentication(db: MarketDb, now?: () => number) {
  const ldap = new TestLdap()
  const secrets = new AuthSecrets(Buffer.alloc(32, 7), "break-glass-test-key")
  const identity = new Identity(db, { ldap, secrets, ...(now ? { now } : {}) })
  await identity.saveConfig(config, "bind-password", "test-bootstrap")
  return { ldap, secrets, ...(now ? { now } : {}) }
}

export async function webLogin(app: FastifyInstance, username = "alice") {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/session",
    payload: { username: normalize(username), password: "password" },
  })
  if (response.statusCode !== 200) throw new Error(`测试 LDAP 登录失败：${response.statusCode} ${response.body}`)
  return {
    cookie: String(response.headers["set-cookie"] ?? "").split(";", 1)[0],
    csrf: String(response.headers["x-csrf-token"] ?? ""),
  }
}

export async function accessToken(app: FastifyInstance, username = "alice") {
  return (await deviceTokens(app, username)).accessToken
}

export async function deviceTokens(app: FastifyInstance, username = "alice") {
  const login = await webLogin(app, username)
  const device = await app.inject({ method: "POST", url: "/api/v1/auth/device/code", headers: { host: "market.test" } })
  if (device.statusCode !== 200) throw new Error(`测试设备码申请失败：${device.statusCode} ${device.body}`)
  const approved = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/approve",
    headers: {
      cookie: login.cookie,
      "x-csrf-token": login.csrf,
      host: "market.test",
      origin: "http://market.test",
    },
    payload: { userCode: device.json().userCode },
  })
  if (approved.statusCode !== 200) throw new Error(`测试设备码批准失败：${approved.statusCode} ${approved.body}`)
  const token = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: { deviceCode: device.json().deviceCode },
  })
  if (token.statusCode !== 200) throw new Error(`测试设备码兑换失败：${token.statusCode} ${token.body}`)
  return token.json() as {
    accessToken: string
    refreshToken: string
    expiresIn: number
    refreshExpiresIn: number
    user: { id: string; displayName: string }
  }
}

function normalize(value: string) {
  return value.replace(/-(?:key|token)$/, "")
}

function profile(username: string): LdapProfile {
  const name = normalize(username)
  return {
    subject: `guid-${name}`,
    dn: `CN=${name},OU=Users,DC=test,DC=local`,
    username: name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    email: `${name}@test.local`,
    isAdmin: name === "admin",
  }
}
