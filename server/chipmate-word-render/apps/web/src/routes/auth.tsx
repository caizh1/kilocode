import { useEffect, useState, type FormEvent } from "react"
import type { MarketUser } from "@chipmate/market-contracts"
import { InlineError, Skeleton } from "../shared"
import { adminChanged, adminRequest, type AdminAccess } from "../admin-access"
import { Administrators } from "./admins"

type Security = "unencrypted" | "starttls" | "ldaps"

interface LdapConfig {
  enabled: boolean
  name: string
  host: string
  port: number
  security: Security
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
  insecureAcknowledged: boolean
  group?: {
    enabled: boolean
    searchBase: string
    filter: string
    memberAttribute: string
    userAttribute: string
  }
}

interface Mapping {
  user: MarketUser
  external?: {
    subject: string
    username: string
    email?: string
    displayName: string
    isAdmin: boolean
  }
}

const empty: LdapConfig = {
  enabled: true,
  name: "Microsoft Active Directory",
  host: "",
  port: 389,
  security: "unencrypted",
  verifyCertificate: true,
  bindDn: "",
  userSearchBase: "",
  userFilter: "(&(objectCategory=Person)(sAMAccountName=%s))",
  adminFilter: "",
  restrictedFilter: "",
  usernameAttribute: "sAMAccountName",
  firstNameAttribute: "givenName",
  surnameAttribute: "sn",
  emailAttribute: "userPrincipalName",
  attributesInBindContext: false,
  insecureAcknowledged: false,
  group: { enabled: false, searchBase: "", filter: "", memberAttribute: "member", userAttribute: "dn" },
}

export function AuthSettingsPage(props: { user?: MarketUser; csrf: string; requestLogin(): void; access: AdminAccess }) {
  const [config, setConfig] = useState<LdapConfig>(empty)
  const [bindPassword, setBindPassword] = useState("")
  const [testUsername, setTestUsername] = useState("")
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [mapUserId, setMapUserId] = useState("")
  const [mapUsername, setMapUsername] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const credential = props.access.csrf

  const load = async () => {
    setLoading(true)
    setError("")
    try {
      const [settings, identities] = await Promise.all([
        api<{ config?: LdapConfig }>("/api/v1/admin/auth/ldap"),
        api<{ items: Mapping[] }>("/api/v1/admin/auth/identity-mappings"),
      ])
      if (settings.config) setConfig({ ...empty, ...settings.config, group: { ...empty.group!, ...settings.config.group } })
      setMappings(identities.items)
    } catch (err) {
      setError(text(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [props.user?.id, credential])

  const submit = async (mode: "test" | "save") => {
    setError("")
    setMessage("")
    try {
      const path = mode === "test" ? "/api/v1/admin/auth/ldap/test" : "/api/v1/admin/auth/ldap"
      const body = mode === "test"
        ? { config, bindPassword, username: testUsername || undefined }
        : { config, bindPassword, testUsername: testUsername || undefined }
      await api(path, { method: mode === "test" ? "POST" : "PUT", csrf: credential, body })
      setMessage(mode === "test" ? "LDAP 连接与查询测试通过。" : "LDAP 配置已启用，旧会话和令牌已撤销。")
      if (mode === "save") {
        dispatchEvent(new Event("chipmate-admin-invalid"))
        adminChanged()
      }
    } catch (err) {
      setError(text(err))
    }
  }

  const map = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    try {
      await api("/api/v1/admin/auth/identity-mappings", {
        method: "POST",
        csrf: credential,
        body: { username: mapUsername, userId: mapUserId },
      })
      setMapUsername("")
      await load()
      setMessage("历史身份映射已保存，业务数据主键未改变。")
    } catch (err) {
      setError(text(err))
    }
  }

  const unmap = async (subject: string) => {
    setError("")
    try {
      await api(`/api/v1/admin/auth/identity-mappings/${encodeURIComponent(subject)}`, {
        method: "DELETE",
        csrf: credential,
      })
      await load()
      setMessage("LDAP 身份映射已解除，历史业务数据保持不变。")
    } catch (err) {
      setError(text(err))
    }
  }

  if (loading) return <section className="page-width detail-page"><Skeleton label="正在读取认证配置" /></section>
  if (!credential) {
    return (
      <section className="page-width detail-page auth-page">
        <div className="glass-panel auth-unlock-card">
          <span className="eyebrow">认证管理</span>
          <h1>请重新验证管理员登录</h1>
          <p>当前操作凭据缺失，请重新登录以安全修改设置。</p>
          <button className="glass-button" onClick={props.requestLogin}>使用 LDAP 管理员登录</button>
        </div>
      </section>
    )
  }

  const update = <K extends keyof LdapConfig>(key: K, value: LdapConfig[K]) => setConfig((current) => ({ ...current, [key]: value }))
  const group = config.group ?? empty.group!
  return (
    <section className="page-width detail-page auth-page">
      <div className="auth-heading">
        <div><span className="eyebrow">Gitea BindDN 兼容字段</span><h1>LDAP 认证设置</h1></div>
        <span className={`auth-security ${config.security === "unencrypted" ? "warning" : "safe"}`}>{config.security}</span>
      </div>
      {props.access.mode === "break-glass" && <div className="auth-actions"><p>当前为应急管理会话，有效期至 {new Date(props.access.expiresAt!).toLocaleTimeString("zh-CN")}。</p><button className="glass-button" onClick={() => {
        void adminRequest("/api/v1/admin/auth/session", { method: "DELETE", csrf: credential }).then(() => { dispatchEvent(new Event("chipmate-admin-invalid")); adminChanged() }, (err: unknown) => setError(text(err)))
      }}>退出应急管理</button></div>}
      <Administrators csrf={credential} />
      {config.security === "unencrypted" && <div className="auth-warning" role="alert">当前为未加密 LDAP。Bind DN 密码和用户密码会以明文经过 Server 与域控之间的网络。</div>}
      {error && <InlineError message={error} />}
      {message && <p className="auth-success" role="status">{message}</p>}
      <div className="glass-panel auth-form">
        <Check label="启用此 LDAP 认证源" checked={config.enabled} set={(value) => update("enabled", value)} />
        <Field label="认证名称" value={config.name} set={(value) => update("name", value)} />
        <Field label="Host" value={config.host} set={(value) => update("host", value)} />
        <Field label="Port" type="number" value={String(config.port)} set={(value) => update("port", Number(value))} />
        <label>加密方式<select value={config.security} onChange={(event) => update("security", event.target.value as Security)}><option value="unencrypted">Unencrypted</option><option value="starttls">STARTTLS</option><option value="ldaps">LDAPS</option></select></label>
        <Check label="验证服务器证书" checked={config.verifyCertificate} set={(value) => update("verifyCertificate", value)} />
        <Field label="Bind DN" value={config.bindDn} set={(value) => update("bindDn", value)} />
        <Field label="Bind Password（留空保留原值）" type="password" value={bindPassword} set={setBindPassword} />
        <Field label="User Search Base" value={config.userSearchBase} set={(value) => update("userSearchBase", value)} />
        <Field label="User Filter" value={config.userFilter} set={(value) => update("userFilter", value)} />
        <label>Admin Filter（旧配置，仅保留）<input value={config.adminFilter ?? ""} readOnly aria-describedby="admin-filter-note" /><small id="admin-filter-note">不再用于授予管理员权限，请使用上方“管理员管理”。</small></label>
        <Field label="Restricted Filter" value={config.restrictedFilter ?? ""} set={(value) => update("restrictedFilter", value)} />
        <Field label="Username Attribute" value={config.usernameAttribute} set={(value) => update("usernameAttribute", value)} />
        <Field label="First Name Attribute" value={config.firstNameAttribute ?? ""} set={(value) => update("firstNameAttribute", value)} />
        <Field label="Surname Attribute" value={config.surnameAttribute ?? ""} set={(value) => update("surnameAttribute", value)} />
        <Field label="Email Attribute" value={config.emailAttribute} set={(value) => update("emailAttribute", value)} />
        <Check label="在用户 Bind 上下文读取属性" checked={config.attributesInBindContext} set={(value) => update("attributesInBindContext", value)} />
        <Check label="启用 LDAP 群组校验" checked={group.enabled} set={(value) => update("group", { ...group, enabled: value })} />
        {group.enabled && <>
          <Field label="Group Search Base DN" value={group.searchBase} set={(value) => update("group", { ...group, searchBase: value })} />
          <Field label="Group Filter" value={group.filter} set={(value) => update("group", { ...group, filter: value })} />
          <Field label="Group Member Attribute" value={group.memberAttribute} set={(value) => update("group", { ...group, memberAttribute: value })} />
          <Field label="User Attribute in Group" value={group.userAttribute} set={(value) => update("group", { ...group, userAttribute: value })} />
        </>}
        {config.security === "unencrypted" && <Check label="我确认接受未加密 LDAP 389 风险" checked={config.insecureAcknowledged} set={(value) => update("insecureAcknowledged", value)} />}
        <Field label="测试用户名（可选）" value={testUsername} set={setTestUsername} />
        <div className="auth-actions"><button className="glass-button" onClick={() => void submit("test")}>测试连接</button><button className="primary-button" onClick={() => void submit("save")}>测试并启用</button></div>
      </div>
      <div className="glass-panel auth-mappings">
        <div><span className="eyebrow">历史数据连续性</span><h2>LDAP 身份映射</h2><p>映射只绑定外部 objectGUID，不改变现有用户主键或作品归属。</p></div>
        <form onSubmit={(event) => void map(event)} className="mapping-form">
          <label>历史用户<select value={mapUserId} onChange={(event) => setMapUserId(event.target.value)} required><option value="">请选择</option>{mappings.filter((item) => !item.external).map((item) => <option key={item.user.id} value={item.user.id}>{item.user.displayName} · {item.user.id} · 未映射</option>)}</select></label>
          <Field label="对应 LDAP 用户名" value={mapUsername} set={setMapUsername} />
          <button className="primary-button">确认映射</button>
        </form>
        <div className="mapping-list">
          {mappings.filter((item) => item.external).map((item) => <div className="mapping-row" key={item.external!.subject}>
            <span><strong>{item.user.displayName}</strong><small>{item.external!.username} · {item.external!.email ?? "无邮箱"}</small><code>{item.user.id}</code></span>
            <button className="glass-button" onClick={() => void unmap(item.external!.subject)}>解除映射</button>
          </div>)}
        </div>
      </div>
    </section>
  )
}

export function DeviceApprovalPage(props: { user?: MarketUser; csrf: string; requestLogin(): void }) {
  const [code, setCode] = useState(() => new URL(location.href).searchParams.get("user_code") ?? "")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const approve = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    try {
      await api("/api/v1/auth/device/approve", { method: "POST", csrf: props.csrf, body: { userCode: code } })
      setMessage("设备已获授权，可以返回 VS Code。")
    } catch (err) {
      setError(text(err))
    }
  }
  const deny = async () => {
    setError("")
    try {
      await api("/api/v1/auth/device/deny", { method: "POST", csrf: props.csrf, body: { userCode: code } })
      setMessage("已拒绝此设备，可以关闭页面。")
    } catch (err) {
      setError(text(err))
    }
  }
  return (
    <section className="page-width detail-page auth-page"><div className="glass-panel auth-unlock-card">
      <span className="eyebrow">VS Code 设备登录</span><h1>授权 ChipMate 市场</h1>
      {!props.user ? <><p>先使用 LDAP 登录，再确认设备码。</p><button className="primary-button" onClick={props.requestLogin}>登录 LDAP</button></> :
        <form onSubmit={(event) => void approve(event)}><p>当前用户：{props.user.displayName}</p><Field label="设备码" value={code} set={setCode} />{error && <InlineError message={error} />}{message ? <p className="auth-success">{message}</p> : <div className="auth-actions"><button type="button" className="glass-button" onClick={() => void deny()}>拒绝</button><button className="primary-button">授权此设备</button></div>}</form>}
    </div></section>
  )
}

function Field(props: { label: string; value: string; set(value: string): void; type?: string }) {
  return <label>{props.label}<input type={props.type ?? "text"} value={props.value} onChange={(event) => props.set(event.target.value)} /></label>
}

function Check(props: { label: string; checked: boolean; set(value: boolean): void }) {
  return <label className="auth-check"><input type="checkbox" checked={props.checked} onChange={(event) => props.set(event.target.checked)} /><span>{props.label}</span></label>
}

async function api<T = unknown>(path: string, options: { method?: string; csrf?: string; body?: unknown } = {}) {
  if (path.startsWith("/api/v1/admin/")) return adminRequest<T>(path, options)
  const response = await fetch(path, { method: options.method ?? "GET", credentials: "same-origin", headers: { accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...(options.csrf ? { "x-csrf-token": options.csrf } : {}) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message ?? `请求失败（HTTP ${response.status}）`)
  return payload as T
}

function text(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
