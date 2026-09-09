import { Client, Filter } from "ldapts"

export type LdapSecurity = "unencrypted" | "starttls" | "ldaps"

export interface LdapConfig {
  enabled: boolean
  name: string
  host: string
  port: number
  security: LdapSecurity
  verifyCertificate: boolean
  bindDn: string
  userSearchBase: string
  userFilter: string
  adminFilter?: string
  restrictedFilter?: string
  usernameAttribute: string
  firstNameAttribute?: string
  surnameAttribute?: string
  emailAttribute: string
  attributesInBindContext: boolean
  group?: {
    enabled: boolean
    searchBase: string
    filter: string
    memberAttribute: string
    userAttribute: string
  }
  insecureAcknowledged: boolean
}

export interface LdapProfile {
  subject: string
  dn: string
  username: string
  displayName: string
  email?: string
  isAdmin: boolean
}

export class LdapError extends Error {
  constructor(
    readonly code:
      | "LDAP_CONFIG_INVALID"
      | "LDAP_UNAVAILABLE"
      | "LDAP_CREDENTIALS_INVALID"
      | "LDAP_USER_AMBIGUOUS"
      | "LDAP_USER_RESTRICTED",
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
  }
}

export interface LdapProvider {
  authenticate(config: LdapConfig, bindPassword: string, username: string, password: string): Promise<LdapProfile>
  lookup(config: LdapConfig, bindPassword: string, username: string): Promise<LdapProfile>
  test(config: LdapConfig, bindPassword: string, username?: string): Promise<LdapProfile | undefined>
}

export class LdapAuthenticator implements LdapProvider {
  async authenticate(config: LdapConfig, bindPassword: string, username: string, password: string) {
    if (!password) throw new LdapError("LDAP_CREDENTIALS_INVALID", "用户名或密码错误。")
    return this.withClient(config, async (client) => {
      await bindService(client, config, bindPassword)
      const profile = await searchProfile(client, config, username)
      try {
        await client.bind(profile.dn, password)
      } catch (err) {
        throw new LdapError("LDAP_CREDENTIALS_INVALID", "用户名或密码错误。", err)
      }
      if (!config.attributesInBindContext) return profile
      const rebound = await searchProfile(client, config, username)
      if (rebound.dn !== profile.dn || rebound.subject !== profile.subject) {
        throw new LdapError("LDAP_CREDENTIALS_INVALID", "LDAP 用户身份在 Bind 前后不一致。")
      }
      return rebound
    })
  }

  async lookup(config: LdapConfig, bindPassword: string, username: string) {
    return this.withClient(config, async (client) => {
      await bindService(client, config, bindPassword)
      return searchProfile(client, config, username)
    })
  }

  async test(config: LdapConfig, bindPassword: string, username?: string) {
    return this.withClient(config, async (client) => {
      await bindService(client, config, bindPassword)
      return username?.trim() ? searchProfile(client, config, username) : undefined
    })
  }

  private async withClient<T>(config: LdapConfig, run: (client: Client) => Promise<T>): Promise<T> {
    validateLdapConfig(config)
    const url = `${config.security === "ldaps" ? "ldaps" : "ldap"}://${host(config.host)}:${config.port}`
    const client = new Client({
      url,
      timeout: 10_000,
      connectTimeout: 5_000,
      // ldapts 8.2.0 即使使用 ldap://，只要提供 tlsOptions 也会直接启用 TLS。
      // 明文和 StartTLS 必须先建立普通连接；StartTLS 的选项仅交给 startTLS()。
      ...(config.security === "ldaps"
        ? { tlsOptions: { rejectUnauthorized: config.verifyCertificate, servername: config.host } }
        : {}),
    })
    try {
      if (config.security === "starttls") {
        await client.startTLS({ rejectUnauthorized: config.verifyCertificate, servername: config.host })
      }
      return await run(client)
    } catch (err) {
      if (err instanceof LdapError) throw err
      throw new LdapError("LDAP_UNAVAILABLE", "LDAP 目录当前不可用。", err)
    } finally {
      await client.unbind().catch(() => undefined)
    }
  }
}

export function validateLdapConfig(config: LdapConfig) {
  if (!config || typeof config !== "object") throw invalid("LDAP 配置无效。")
  if (!config.name.trim() || !config.host.trim()) throw invalid("名称和 Host 为必填项。")
  if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65_535) throw invalid("端口无效。")
  if (!["unencrypted", "starttls", "ldaps"].includes(config.security)) throw invalid("LDAP 加密方式无效。")
  if (config.security === "unencrypted" && !config.insecureAcknowledged) {
    throw invalid("使用未加密 LDAP 前必须明确确认风险。")
  }
  if (!config.userSearchBase.trim() || !config.userFilter.trim()) throw invalid("用户搜索基准和过滤器为必填项。")
  if (!/%(?:\[1\])?s/.test(config.userFilter)) throw invalid("用户过滤器必须包含 %s 或 %[1]s。")
  for (const attribute of [
    config.usernameAttribute,
    config.emailAttribute,
    config.firstNameAttribute,
    config.surnameAttribute,
    config.group?.memberAttribute,
    config.group?.userAttribute,
  ]) {
    if (attribute && !/^[A-Za-z][A-Za-z0-9;-]{0,63}$/.test(attribute)) throw invalid(`LDAP 属性名无效：${attribute}`)
  }
  if (config.group?.enabled && (!config.group.searchBase.trim() || !config.group.filter.trim())) {
    throw invalid("启用群组校验时必须填写群组搜索基准和过滤器。")
  }
}

export function applyUserFilter(filter: string, username: string) {
  const escaped = Filter.escape(username.trim())
  return filter.replaceAll("%[1]s", escaped).replaceAll("%s", escaped)
}

async function bindService(client: Client, config: LdapConfig, password: string) {
  if (!config.bindDn.trim()) return
  try {
    await client.bind(config.bindDn, password)
  } catch (err) {
    throw new LdapError("LDAP_UNAVAILABLE", "LDAP Bind DN 验证失败。", err)
  }
}

async function searchProfile(client: Client, config: LdapConfig, login: string): Promise<LdapProfile> {
  const username = login.trim()
  if (!username) throw new LdapError("LDAP_CREDENTIALS_INVALID", "用户名或密码错误。")
  const attributes = new Set([
    "objectGUID",
    "userAccountControl",
    config.usernameAttribute,
    config.emailAttribute,
    config.firstNameAttribute,
    config.surnameAttribute,
    config.group?.userAttribute,
  ])
  const result = await client.search(config.userSearchBase, {
    scope: "sub",
    filter: applyUserFilter(config.userFilter, username),
    attributes: [...attributes].filter((value): value is string => Boolean(value)),
    sizeLimit: 2,
  })
  if (result.searchEntries.length !== 1) {
    if (result.searchEntries.length > 1) throw new LdapError("LDAP_USER_AMBIGUOUS", "LDAP 用户过滤器返回多个结果。")
    throw new LdapError("LDAP_CREDENTIALS_INVALID", "用户名或密码错误。")
  }
  const entry = result.searchEntries[0] as Record<string, unknown> & { dn: string }
  const control = Number(first(entry.userAccountControl))
  if (Number.isFinite(control) && (control & 2) === 2) {
    throw new LdapError("LDAP_USER_RESTRICTED", "当前账户不允许登录。")
  }
  if (config.restrictedFilter && (await matches(client, entry.dn, config.restrictedFilter))) {
    throw new LdapError("LDAP_USER_RESTRICTED", "当前账户不允许登录。")
  }
  const group = config.group
  if (group?.enabled) {
    const value = group.userAttribute.toLowerCase() === "dn" ? entry.dn : first(entry[group.userAttribute])
    const allowed = value
      ? await client.search(group.searchBase, {
          scope: "sub",
          filter: `(&${group.filter}(${group.memberAttribute}=${Filter.escape(String(value))}))`,
          attributes: ["dn"],
          sizeLimit: 1,
        })
      : undefined
    if (!allowed || allowed.searchEntries.length === 0) {
      throw new LdapError("LDAP_USER_RESTRICTED", "当前账户不在允许的 LDAP 群组中。")
    }
  }
  const subject = binary(entry.objectGUID)
  if (!subject) throw new LdapError("LDAP_CONFIG_INVALID", "LDAP 用户缺少 objectGUID。")
  const resolvedUsername = first(entry[config.usernameAttribute]) || username
  const firstName = config.firstNameAttribute ? first(entry[config.firstNameAttribute]) : ""
  const surname = config.surnameAttribute ? first(entry[config.surnameAttribute]) : ""
  const displayName = [firstName, surname].filter(Boolean).join(" ") || resolvedUsername
  return {
    subject,
    dn: entry.dn,
    username: resolvedUsername,
    displayName,
    ...(first(entry[config.emailAttribute]) ? { email: first(entry[config.emailAttribute]) } : {}),
    // 仅为旧配置保留 adminFilter；目录属性不再授予 Server 管理权限。
    isAdmin: false,
  }
}

async function matches(client: Client, dn: string, filter: string) {
  const result = await client.search(dn, { scope: "base", filter, attributes: ["dn"], sizeLimit: 1 })
  return result.searchEntries.length === 1
}

function first(value: unknown): string {
  if (Array.isArray(value)) return first(value[0])
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim()
  return typeof value === "string" ? value.trim() : ""
}

function binary(value: unknown): string | undefined {
  const item = Array.isArray(value) ? value[0] : value
  if (Buffer.isBuffer(item)) return item.toString("base64url")
  const text = typeof item === "string" ? item.trim() : ""
  return text ? Buffer.from(text).toString("base64url") : undefined
}

function host(value: string) {
  const text = value.trim()
  return text.includes(":") && !text.startsWith("[") ? `[${text}]` : text
}

function invalid(message: string) {
  return new LdapError("LDAP_CONFIG_INVALID", message)
}
