import { useEffect, useRef, useState, type FormEvent } from "react"
import { adminChanged, adminRequest } from "../admin-access"
import { InlineError } from "../shared"

interface Target {
  subject: string
  username: string
  displayName: string
  email?: string
  dn?: string
  userId?: string
}
interface Administrator extends Target { grantedAt: string; grantedBy: string }

export function Administrators(props: { csrf: string }) {
  const [items, setItems] = useState<Administrator[]>([])
  const [username, setUsername] = useState("")
  const [target, setTarget] = useState<Target>()
  const [pending, setPending] = useState<Administrator>()
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const sequence = useRef(0)
  const load = async () => {
    const result = await adminRequest<{ items: Administrator[] }>("/api/v1/admin/auth/admins")
    setItems(result.items)
    setLoaded(true)
  }
  useEffect(() => {
    void load().catch((err: unknown) => setError(message(err)))
    return () => { sequence.current++ }
  }, [])
  const resolve = async (event: FormEvent) => {
    event.preventDefault()
    const current = ++sequence.current
    setBusy(true); setError(""); setNotice(""); setTarget(undefined)
    try {
      const result = await adminRequest<Target>("/api/v1/admin/auth/admins/resolve", { method: "POST", csrf: props.csrf, body: { username } })
      if (current === sequence.current) setTarget(result)
    } catch (err) { setError(message(err)) }
    finally { setBusy(false) }
  }
  const change = async (value: Target, grant: boolean) => {
    setBusy(true); setError(""); setNotice("")
    try {
      await adminRequest(`/api/v1/admin/auth/admins${grant ? "" : `/${encodeURIComponent(value.subject)}`}`, {
        method: grant ? "POST" : "DELETE", csrf: props.csrf,
        ...(grant ? { body: { username: value.username, subject: value.subject } } : {}),
      })
      setTarget(undefined); setPending(undefined)
      setNotice(`${value.username} ${grant ? "已获授" : "已撤销"}管理员权限，相关旧会话已撤销，请该用户重新登录。`)
      await load()
      adminChanged()
    } catch (err) { setError(message(err)) }
    finally { setBusy(false) }
  }
  return <section className="glass-panel auth-mappings" aria-labelledby="administrators-title">
    <div><span className="eyebrow">Server 本地授权</span><h2 id="administrators-title">管理员管理</h2><p>LDAP 仅负责登录。管理员权限绑定不可变目录身份，不按姓名或市场账号 ID 判断。</p></div>
    {loaded && items.length === 0 && <p className="auth-warning">尚未设置管理员。请通过当前应急会话查询并明确授权首位管理员。</p>}
    {error && <InlineError message={error} />}
    {notice && <p className="auth-success" role="status">{notice}</p>}
    <form className="mapping-form" onSubmit={(event) => void resolve(event)}>
      <label>待授权 LDAP 用户名<input value={username} required disabled={busy} onChange={(event) => { sequence.current++; setUsername(event.target.value); setTarget(undefined) }} /></label>
      <button className="glass-button" disabled={busy || !username.trim()}>查询 LDAP 身份</button>
    </form>
    {target && <div className="admin-target">
      <h3>确认授权对象</h3><IdentityDetails value={target} />
      <button className="primary-button" disabled={busy || items.some((item) => item.subject === target.subject)} onClick={() => void change(target, true)}>{items.some((item) => item.subject === target.subject) ? "已是管理员" : "确认授予管理员"}</button>
    </div>}
    <div className="mapping-list">{items.map((item) => <article className="admin-row" key={item.subject}>
      <div><h3>{item.displayName} <small>（{item.username}）</small></h3><IdentityDetails value={item} /><p>授权时间：{new Date(item.grantedAt).toLocaleString("zh-CN")}</p></div>
      <button className="glass-button" disabled={busy || items.length === 1} onClick={() => setPending(item)}>{items.length === 1 ? "保留最后一位管理员" : "撤销管理员"}</button>
    </article>)}</div>
    {pending && <div className="admin-target" role="group" aria-label="确认撤销管理员">
      <p>确认撤销 {pending.username} 的管理员权限？其旧 Web 和设备凭据将失效，市场作品仍然保留。</p>
      <div className="auth-actions"><button className="glass-button" disabled={busy} onClick={() => setPending(undefined)}>取消</button><button className="primary-button" disabled={busy} onClick={() => void change(pending, false)}>确认撤销</button></div>
    </div>}
  </section>
}

function IdentityDetails(props: { value: Target }) {
  const value = props.value
  return <dl className="admin-identity"><dt>LDAP 用户名</dt><dd>{value.username}</dd><dt>邮箱</dt><dd>{value.email || "无邮箱"}</dd>
    {value.dn && <><dt>目录 DN</dt><dd>{value.dn}</dd></>}<dt>不可变身份（objectGUID 编码）</dt><dd><code>{value.subject}</code></dd>
    <dt>市场账号 ID</dt><dd><code>{value.userId || "尚未关联；授权不会创建或合并市场账号"}</code></dd></dl>
}
function message(err: unknown) { return err instanceof Error ? err.message : String(err) }

export function AdminLogin(props: { navigate(path: string): void; requestLogin(): void }) {
  const [key, setKey] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const unlock = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("")
    try {
      await adminRequest("/api/v1/admin/auth/session", { method: "POST", body: { key } })
      setKey(""); adminChanged(); props.navigate("/admin/auth")
    } catch (err) { setError(message(err)) }
    finally { setBusy(false) }
  }
  return <section className="page-width detail-page auth-page"><div className="glass-panel auth-unlock-card">
    <span className="eyebrow">应急管理入口</span><h1>管理员登录</h1><p>首次授权或恢复访问时使用 break-glass。已获授权的管理员可使用 LDAP 登录。</p>
    <form onSubmit={(event) => void unlock(event)}><label>Break-glass 密钥<input type="password" autoComplete="off" required value={key} onChange={(event) => setKey(event.target.value)} /></label>
      {error && <InlineError message={error} />}<button className="primary-button" disabled={busy}>{busy ? "正在验证…" : "进入应急管理"}</button></form>
    <button className="glass-button" onClick={props.requestLogin}>使用 LDAP 管理员登录</button>
  </div></section>
}
