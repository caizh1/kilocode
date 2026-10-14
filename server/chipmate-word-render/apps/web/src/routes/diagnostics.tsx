import { useEffect, useRef, useState, type FormEvent } from "react"
import { request, InlineError } from "../shared"
import "./diagnostics.css"
interface Bundle {
  id: string
  ownerName: string
  createdAt: string
  expiresAt: string
  version: string
  platform: string
  size: number
  sha256: string
  summary: string
  partial: boolean
  sources: { name: string; status: string; message?: string }[]
  status?: string
}
export function DiagnosticsPage(props: { authenticated: boolean; requestLogin: () => void }) {
  const generation = useRef(0)
  const details = useRef(0)
  const [items, setItems] = useState<Bundle[]>([])
  const [selected, setSelected] = useState<Bundle>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState<string>()
  async function load(append = false) {
    const current = ++generation.current
    setLoading(true)
    setError("")
    try {
      const result = await request<{ items: Bundle[]; nextCursor?: string }>(
        `/api/v1/diagnostics/bundles?${query}${append && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      )
      if (current !== generation.current) return
      setItems((current) => (append ? [...current, ...result.items] : result.items))
      setCursor(result.nextCursor)
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : "无法读取诊断记录")
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }
  async function detail(id: string) {
    const current = ++details.current
    setError("")
    try {
      const result = await request<Bundle>(`/api/v1/diagnostics/bundles/${encodeURIComponent(id)}`)
      if (current === details.current) setSelected(result)
    } catch (error) {
      if (current === details.current) setError(error instanceof Error ? error.message : "无法读取诊断摘要")
    }
  }
  useEffect(() => {
    if (props.authenticated) {
      void load()
      const id = new URLSearchParams(location.search).get("id")
      if (id) void detail(id)
    } else {
      setItems([])
      setSelected(undefined)
    }
    return () => {
      generation.current++
      details.current++
    }
  }, [props.authenticated, query])
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const params = new URLSearchParams()
    for (const [key, value] of values.entries())
      if (value)
        params.set(key, key === "after" || key === "before" ? new Date(String(value)).toISOString() : String(value))
    setSelected(undefined)
    setQuery(params.toString())
  }
  return (
    <section className="page-width diagnostic-page">
      <h1>诊断日志</h1>
      <p>仅本人和管理员可查看。日志包和摘要保留 7 天，到期后不可访问。</p>
      {!props.authenticated ? (
        <button className="primary-button" onClick={props.requestLogin}>
          登录后查看
        </button>
      ) : (
        <>
          <form className="diagnostic-filters glass-panel" onSubmit={filter}>
            <label>
              编号或提交人
              <input name="q" maxLength={128} placeholder="搜索诊断编号或姓名" />
            </label>
            <label>
              版本
              <input name="version" maxLength={128} />
            </label>
            <label>
              平台
              <input name="platform" maxLength={128} placeholder="例如 win32-x64" />
            </label>
            <label>
              起始时间
              <input type="datetime-local" name="after" />
            </label>
            <label>
              结束时间
              <input type="datetime-local" name="before" />
            </label>
            <button className="primary-button" disabled={loading}>
              筛选
            </button>
          </form>
          {error && <InlineError message={error} />}
          <div role="status" aria-live="polite">
            {loading ? "正在读取…" : `已显示 ${items.length} 条记录`}
          </div>
          <div className="diagnostic-list">
            {items.map((item) => (
              <button key={item.id} className="glass-panel diagnostic-row" onClick={() => void detail(item.id)}>
                <strong>{item.id}</strong>
                <span>
                  {item.ownerName} · {item.version} · {item.platform}
                </span>
                <span>
                  {new Date(item.createdAt).toLocaleString()} · {(item.size / 1024 / 1024).toFixed(2)} MiB ·{" "}
                  {item.partial ? "部分资料未采集" : "采集完成"}
                </span>
              </button>
            ))}
          </div>
          {cursor && (
            <button className="secondary-button" disabled={loading} onClick={() => void load(true)}>
              加载更多
            </button>
          )}
          {selected && (
            <article className="glass-panel diagnostic-detail">
              <h2>诊断摘要</h2>
              <p>编号：{selected.id}</p>
              <p>到期：{new Date(selected.expiresAt).toLocaleString()}</p>
              <pre>{selected.summary}</pre>
              <ul>
                {selected.sources?.map((source, index) => (
                  <li key={index}>
                    {source.name}：
                    {source.status === "ok" ? "已收集" : source.status === "partial" ? "部分收集" : "未收集"}{" "}
                    {source.message}
                  </li>
                ))}
              </ul>
              <p className="diagnostic-hash">SHA-256：{selected.sha256}</p>
              <a
                className="primary-button"
                href={`/api/v1/diagnostics/bundles/${encodeURIComponent(selected.id)}/archive`}
              >
                下载日志包
              </a>
            </article>
          )}
        </>
      )}
    </section>
  )
}
