import {
  ArrowRight,
  ChartLineUp,
  CheckCircle,
  Clock,
  Code,
  DownloadSimple,
  FileArrowUp,
  Heart,
  LockKey,
  MagnifyingGlass,
  Package,
  ShieldWarning,
  Sparkle,
  Star,
  Trash,
  UploadSimple,
  UserCircle,
  Warning,
  X,
} from "@phosphor-icons/react"
import type {
  ExtensionAnalytics,
  ExtensionArtifact,
  ExtensionDetail as DetailData,
  ExtensionPublicationRun,
  ExtensionReview,
  ExtensionSummary,
  MarketUser,
} from "@chipmate/market-contracts"
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react"
import { bytes, compact, date, InlineError, mutate, Skeleton, useApi } from "../shared"
import { uuid } from "../id"
import { trend } from "../trend"
import {
  dropInputs,
  listInputs,
  materialize,
  partition,
  scanInputs,
  type BatchInput,
  type BatchItem,
  type BatchScan,
} from "../extension-batch"

interface Catalog {
  items: ExtensionSummary[]
  nextCursor?: string
}

interface Shared {
  navigate(path: string): void
  user: MarketUser | undefined
  csrf: string
  requestLogin(): void
}

export function ExtensionHome(props: Pick<Shared, "navigate">) {
  const [query, setQuery] = useState("")
  const [target, setTarget] = useState("")
  const [category, setCategory] = useState("")
  const [sort, setSort] = useState("downloads")
  const [search, setSearch] = useState("")
  const path = useMemo(() => {
    const params = new URLSearchParams({ sort, limit: "40" })
    if (search) params.set("q", search)
    if (target) params.set("target", target)
    if (category) params.set("category", category)
    return `/api/v1/extensions?${params}`
  }, [category, search, sort, target])
  const catalog = useApi<Catalog>(path)
  const downloads = useApi<Catalog>("/api/v1/extensions?sort=downloads&limit=5")
  const ratings = useApi<Catalog>("/api/v1/extensions?sort=rating&limit=5")
  const favorites = useApi<Catalog>("/api/v1/extensions?sort=favorites&limit=5")
  const updated = useApi<Catalog>("/api/v1/extensions?sort=updated&limit=5")
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSearch(query.trim())
  }
  return (
    <section className="extension-home page-width">
      <div className="extension-hero">
        <div className="extension-hero-copy">
          <span className="eyebrow">
            <Sparkle /> CHIPMATE VS CODE 插件库
          </span>
          <h1>发现团队可信赖的<br />VS Code 插件</h1>
          <p>浏览、比较并下载 VSIX 到本地，再由你在 VS Code 中显式安装。</p>
          <form className="search-bar extension-search" onSubmit={submit}>
            <MagnifyingGlass />
            <label className="sr-only" htmlFor="extension-query">搜索插件</label>
            <input
              id="extension-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索插件，例如：ESLint、Prettier、GitLens…"
            />
            <button>搜索</button>
          </form>
          <div className="extension-filters" aria-label="插件筛选">
            <label>分类
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">全部</option>
                <option value="Programming Languages">编程语言</option>
                <option value="Linters">代码检查</option>
                <option value="Formatters">格式化</option>
                <option value="Other">其他</option>
              </select>
            </label>
            <label>目标平台
              <select value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="">全部</option>
                <option value="universal">Universal</option>
                <option value="win32-x64">Windows x64</option>
                <option value="linux-x64">Linux x64</option>
                <option value="darwin-arm64">macOS ARM64</option>
              </select>
            </label>
            <label>排序
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="downloads">下载最多</option>
                <option value="rating">评分最高</option>
                <option value="favorites">收藏最多</option>
                <option value="updated">最近更新</option>
              </select>
            </label>
          </div>
        </div>
        <div className="extension-hero-art" aria-hidden="true">
          <div className="vscode-glass-mark"><Code weight="duotone" /></div>
          <span className="glass-orbit" />
        </div>
      </div>

      {catalog.loading && <Skeleton label="正在载入插件目录" />}
      {catalog.error && <InlineError message={catalog.error} />}
      {catalog.data && (
        <section className="extension-featured glass-panel">
          <div className="panel-heading"><Package /><h2>{search ? `“${search}”的结果` : "精选推荐"}</h2></div>
          <div className="extension-card-grid">
            {catalog.data.items.slice(0, 5).map((item) => (
              <ExtensionCard key={item.id} item={item} open={() => {
                rememberSource(search ? "search" : "home")
                props.navigate(`/extensions/${encodeURIComponent(item.id)}`)
              }} />
            ))}
          </div>
          {catalog.data.items.length === 0 && <p className="extension-empty">暂时没有匹配的插件。</p>}
        </section>
      )}

      <div className="extension-board-grid">
        <Board title="下载最多" icon={<DownloadSimple />} data={downloads.data} navigate={props.navigate} />
        <Board title="高评分" icon={<Star />} data={ratings.data} navigate={props.navigate} />
        <Board title="收藏最多" icon={<Heart />} data={favorites.data} navigate={props.navigate} />
        <Board title="最近更新" icon={<Clock />} data={updated.data} navigate={props.navigate} />
      </div>
      <p className="extension-audit-note"><ShieldWarning /> 平台仅校验 VSIX 结构，不进行代码、签名或病毒审计。</p>
    </section>
  )
}

function ExtensionCard(props: { item: ExtensionSummary; open(): void }) {
  return (
    <button className="extension-card" onClick={props.open}>
      <span className="extension-icon">
        {props.item.iconData ? <img src={props.item.iconData} alt="" /> : <Code weight="duotone" />}
      </span>
      <span className="extension-card-copy">
        <strong>{props.item.displayName}</strong>
        <small>{props.item.id}</small>
        <span className="extension-card-meta">v{props.item.version} · {props.item.uploader}</span>
        <span className="extension-targets">{props.item.targets.map((value) => <em key={value}>{value}</em>)}</span>
        <span className="extension-stats">
          <span><DownloadSimple /> {compact(props.item.downloads)}</span>
          <span><Star weight="fill" /> {props.item.rating.toFixed(1)}</span>
        </span>
      </span>
      {props.item.systemPlugin && <span className="system-plugin">系统插件</span>}
    </button>
  )
}

function Board(props: { title: string; icon: ReactNode; data: Catalog | undefined; navigate(path: string): void }) {
  return (
    <section className="glass-panel extension-board">
      <div className="panel-heading">{props.icon}<h2>{props.title}</h2></div>
      {(props.data?.items ?? []).map((item, index) => (
        <button key={item.id} onClick={() => props.navigate(`/extensions/${encodeURIComponent(item.id)}`)}>
          <span className="board-rank">{index + 1}</span>
          <span className="mini-extension-icon">{item.iconData ? <img src={item.iconData} alt="" /> : <Code />}</span>
          <span><strong>{item.displayName}</strong><small>{item.id}</small></span>
          <em>{props.title === "高评分" ? item.rating.toFixed(2) : compact(props.title === "收藏最多" ? item.favorites : item.downloads)}</em>
        </button>
      ))}
    </section>
  )
}

export function ExtensionDetail(props: Shared & { id: string }) {
  const detail = useApi<DetailData>(`/api/v1/extensions/${encodeURIComponent(props.id)}`)
  const reviews = useApi<ExtensionReview[]>(`/api/v1/extensions/${encodeURIComponent(props.id)}/review`)
  const favorites = useApi<ExtensionSummary[]>(props.user ? "/api/v1/me/extensions/favorites" : undefined)
  const [version, setVersion] = useState("")
  const [target, setTarget] = useState("")
  const [favorite, setFavorite] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [selected, setSelected] = useState("")
  const [agreed, setAgreed] = useState(false)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")
  const [error, setError] = useState("")
  const item = detail.data
  useEffect(() => {
    if (item && !version) setVersion(item.version)
  }, [item, version])
  useEffect(() => {
    setFavorite(Boolean(favorites.data?.some((entry) => entry.id === props.id)))
  }, [favorites.data, props.id])
  useEffect(() => {
    const own = reviews.data?.find((entry) => entry.userId === props.user?.id)
    if (!own) return
    setRating(own.rating)
    setComment(own.comment)
  }, [props.user?.id, reviews.data])
  if (detail.loading) return <section className="page-width"><Skeleton label="正在载入插件详情" /></section>
  if (detail.error) return <section className="page-width"><InlineError message={detail.error} /></section>
  if (!item) return null
  const versions = item.artifacts.filter((artifact) => artifact.version === version)
  const targets = [...new Set(versions.map((artifact) => artifact.target))]
  const candidates = versions.filter((artifact) => artifact.target === target)
  const chosen = candidates.find((artifact) => artifact.id === selected)
  const download = () => {
    if (!target) return setError("请先明确选择目标平台。")
    if (candidates.length === 0) return setError("所选版本没有该平台构建。")
    if (candidates.length > 1) {
      setSelected("")
      setAgreed(false)
      setConflict(true)
      return
    }
    location.href = `${candidates[0]!.downloadUrl}?source=${takeSource()}`
  }
  const toggle = async () => {
    if (!props.user) return props.requestLogin()
    try {
      const state = await mutate<{ favorite: boolean }>(
        `/api/v1/extension-favorites/${encodeURIComponent(item.id)}`,
        favorite ? "DELETE" : "PUT",
        undefined,
        props.csrf,
      )
      setFavorite(state.favorite)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const review = async (event: FormEvent) => {
    event.preventDefault()
    if (!props.user) return props.requestLogin()
    try {
      await mutate(
        `/api/v1/extensions/${encodeURIComponent(item.id)}/review`,
        "PUT",
        { rating, comment, ...(chosen ? { artifactId: chosen.id } : {}) },
        props.csrf,
      )
      setComment("")
      reviews.refresh()
      detail.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <section className="extension-detail page-width">
      <button className="back-link" onClick={() => props.navigate("/extensions")}>VS Code 插件 <ArrowRight /> 详情</button>
      <div className="extension-detail-grid">
        <article className="glass-panel extension-detail-hero">
          <span className="detail-extension-icon">{item.iconData ? <img src={item.iconData} alt="" /> : <Code weight="duotone" />}</span>
          <div className="extension-detail-copy">
            <div className="title-row"><h1>{item.displayName}</h1>{item.prerelease && <span className="preview-pill">预发布</span>}{item.systemPlugin && <span className="system-plugin">系统插件</span>}</div>
            <p>{item.description}</p>
            <div className="extension-identity"><span>发布者 {item.uploader}</span><span>扩展 ID {item.id}</span><span>最新版本 {item.version}</span></div>
            <div className="extension-pickers">
              <label>版本<select value={version} onChange={(event) => { setVersion(event.target.value); setTarget("") }}>
                {item.versions.map((value) => <option key={value}>{value}</option>)}
              </select></label>
              <label>目标平台<select value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="">请选择目标平台</option>{targets.map((value) => <option key={value}>{value}</option>)}
              </select></label>
            </div>
            {error && <InlineError message={error} />}
            <div className="extension-detail-actions">
              <button className="primary-button" onClick={download}><DownloadSimple /> 下载 VSIX</button>
              <button className={`secondary-button ${favorite ? "active" : ""}`} onClick={() => void toggle()}><Heart weight={favorite ? "fill" : "regular"} /> {favorite ? "已收藏" : "收藏"}</button>
            </div>
            <p className="compatibility-note"><ShieldWarning /> VS Code 引擎要求 {item.engineVscode}；兼容性提示不会阻止下载。</p>
            {target && !compatible(target) && <p className="compatibility-note warning"><Warning /> 当前浏览器设备可能与 {target} 不兼容，但仍可手动下载。</p>}
          </div>
        </article>
        <aside className="extension-score glass-panel">
          <span>评分总览</span><strong>{item.rating.toFixed(1)}<small>/5</small></strong>
          <div className="stars" aria-label={`${item.rating.toFixed(1)} 分`}>{[1, 2, 3, 4, 5].map((value) => <Star key={value} weight={value <= Math.round(item.rating) ? "fill" : "regular"} />)}</div>
          <p>基于 {item.ratingCount} 条评价</p>
          <div className="score-stats"><span><DownloadSimple /> {compact(item.downloads)} 下载</span><span><Heart /> {compact(item.favorites)} 收藏</span></div>
        </aside>
      </div>
      <div className="extension-content-grid">
        <article className="glass-panel extension-readme"><div className="panel-heading"><Package /><h2>概览</h2></div><pre>{item.readme || "此插件没有提供 README。"}</pre></article>
        <aside className="glass-panel extension-reviews">
          <div className="panel-heading"><Star /><h2>用户评价</h2></div>
          {(reviews.data ?? []).slice(0, 5).map((entry) => <article key={entry.userId}><div><strong>{entry.userName}</strong><span>{"★".repeat(entry.rating)}</span></div><p>{entry.comment || "仅评分"}</p><small>{date(entry.updatedAt)}</small></article>)}
          <form onSubmit={(event) => void review(event)}>
            <label>评分<select value={rating} onChange={(event) => setRating(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} 星</option>)}</select></label>
            <label>评论（可选）<textarea maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
            <button className="secondary-button">保存评价</button>
          </form>
        </aside>
      </div>
      {conflict && (
        <dialog className="extension-conflict-dialog" open>
          <div className="conflict-heading"><Warning /><div><h2>检测到同版本不同 SHA</h2><p>版本 {version}、平台 {target} 存在多个构建，请核对来源后选择。</p></div><button aria-label="关闭" onClick={() => setConflict(false)}><X /></button></div>
          <div className="conflict-builds">{candidates.map((artifact, index) => <label key={artifact.id} className={selected === artifact.id ? "selected" : ""}><input type="radio" name="artifact" value={artifact.id} checked={selected === artifact.id} onChange={() => setSelected(artifact.id)} /><span><strong>构建 {String.fromCharCode(65 + index)}</strong><small>上传者 {artifact.uploader.displayName}</small><small>{date(artifact.publishedAt)} · {bytes(artifact.size)} · {compact(artifact.downloads)} 次下载</small><code>{artifact.sha256}</code><em>{artifact.source === "system" ? "系统导入" : "Web 上传"}</em></span></label>)}</div>
          <p className="conflict-warning"><ShieldWarning /> 不同 SHA 可能代表内容、依赖或安全行为存在差异。</p>
          <label className="risk-confirm"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />我已了解风险，并确认从可信来源获取该扩展</label>
          <div className="dialog-actions"><button className="secondary-button" onClick={() => setConflict(false)}>取消</button><button className="primary-button" disabled={!chosen || !agreed} onClick={() => { if (chosen) location.href = `${chosen.downloadUrl}?source=${takeSource()}` }}><DownloadSimple /> 下载所选 VSIX</button></div>
        </dialog>
      )}
    </section>
  )
}

type UploadState = "READY" | "EXTRACTING" | "PAUSED" | ExtensionPublicationRun["status"]
type PublicationConflict = {
  extensionId: string
  version: string
  target: string
  existing: { id: string; filename: string; sha256: string; publishedAt: string; source: "system" | "web"; canDelete: boolean }
  incoming: { filename: string; sha256: string }
}
type UploadItem = BatchItem & { selected: boolean; status: UploadState; loaded: number; error: string | undefined; warning: string | undefined; conflict: PublicationConflict | undefined; runId: string | undefined; batch: number | undefined }
type Auth = { user: MarketUser; csrf: string }
type Counts = Record<UploadState, number>

const TERMINAL = new Set<UploadState>(["PUBLISHED", "DUPLICATE", "FAILED", "CANCELLED"])
const ROW = 112
const AUTH_ERRORS = new Set(["AUTH_REQUIRED", "AUTH_INVALID", "SESSION_EXPIRED", "CSRF_INVALID"])

export function ExtensionPublish(props: Pick<Shared, "user" | "csrf" | "requestLogin"> & { reauthenticate(): Promise<Auth | undefined> }) {
  const [scan, setScan] = useState<BatchScan>()
  const [status, setStatus] = useState<"idle" | "scanning" | "ready" | "uploading" | "paused" | "complete">("idle")
  const [progress, setProgress] = useState({ path: "", loaded: 0, total: 0, percent: 0, speed: 0, eta: 0 })
  const [selection, setSelection] = useState({ count: 0, bytes: 0 })
  const [counts, setCounts] = useState<Partial<Counts>>({})
  const [error, setError] = useState("")
  const [drag, setDrag] = useState(false)
  const [, setRevision] = useState(0)
  const [scroll, setScroll] = useState(0)
  const [groups, setGroups] = useState(0)
  const [planned, setPlanned] = useState(0)
  const table = useRef(new Map<string, UploadItem>())
  const order = useRef<string[]>([])
  const runs = useRef(new Map<string, string>())
  const queue = useRef(new Set<string>())
  const request = useRef<XMLHttpRequest | undefined>(undefined)
  const current = useRef<{ id: string; body: boolean; reconciling: boolean } | undefined>(undefined)
  const cancelled = useRef(false)
  const resume = useRef<(() => void) | undefined>(undefined)
  const auth = useRef<{ user: MarketUser | undefined; csrf: string }>({ user: props.user, csrf: props.csrf })
  const frame = useRef<number | undefined>(undefined)
  const pending = useRef<typeof progress | undefined>(undefined)
  const active = status === "uploading" || status === "paused"
  const completed = (counts.PUBLISHED ?? 0) + (counts.DUPLICATE ?? 0) + (counts.FAILED ?? 0) + (counts.CANCELLED ?? 0)
  const start = Math.max(0, Math.floor(scroll / ROW) - 4)
  const end = Math.min(order.current.length, start + 16)
  const visible = order.current.slice(start, end).map((id) => table.current.get(id)).filter((item): item is UploadItem => Boolean(item))
  const conflicts = order.current.map((id) => table.current.get(id)).filter((item): item is UploadItem => Boolean(item?.conflict))

  useEffect(() => {
    auth.current = { user: props.user, csrf: props.csrf }
  }, [props.csrf, props.user])

  const render = () => setRevision((value) => value + 1)
  const update = (id: string, patch: Partial<UploadItem>) => {
    const item = table.current.get(id)
    if (!item) return
    const previous = item.status
    Object.assign(item, patch)
    if (patch.status && patch.status !== previous && item.selected) {
      setCounts((value) => ({
        ...value,
        ...(TERMINAL.has(previous) ? { [previous]: Math.max(0, (value[previous] ?? 0) - 1) } : {}),
        ...(TERMINAL.has(patch.status!) ? { [patch.status!]: (value[patch.status!] ?? 0) + 1 } : {}),
      }))
    }
    render()
  }

  useEffect(() => {
    const stream = new EventSource("/api/v1/market/stream")
    const receive = (event: Event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as ExtensionPublicationRun & { runId?: string }
      const id = data.runId ? runs.current.get(data.runId) : undefined
      if (!id) return
      if (data.status === "VALIDATING" || data.status === "PUBLISHING") {
        if (current.current?.id === id) current.current.body = false
      }
      update(id, { status: data.status, error: data.error })
      if (TERMINAL.has(data.status)) runs.current.delete(data.runId!)
    }
    stream.addEventListener("extension.publication.changed", receive)
    return () => {
      stream.close()
      request.current?.abort()
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [])

  const report = (value: typeof progress) => {
    pending.current = value
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      if (pending.current) setProgress(pending.current)
    })
  }

  const prepare = async (inputs: BatchInput[]) => {
    setError("")
    setScan(undefined)
    table.current.clear()
    order.current = []
    setSelection({ count: 0, bytes: 0 })
    setPlanned(0)
    setCounts({})
    setStatus("scanning")
    setProgress({ path: "", loaded: 0, total: 0, percent: 0, speed: 0, eta: 0 })
    try {
      const result = await scanInputs(inputs, (path, loaded, size) => {
        report({ path, loaded, total: size, percent: size ? Math.min(100, Math.round((loaded / size) * 100)) : 0, speed: 0, eta: 0 })
      })
      for (const item of result.items) table.current.set(item.id, { ...item, selected: true, status: "READY", loaded: 0, error: undefined, warning: undefined, conflict: undefined, runId: undefined, batch: undefined })
      order.current = result.items.map((item) => item.id)
      setScan(result)
      setSelection({ count: result.items.length, bytes: result.items.reduce((sum, item) => sum + item.size, 0) })
      setPlanned(partition(result.items).length)
      setStatus("ready")
      render()
      if (!result.items.length) setError("所选内容中没有可上传的 VSIX。")
    } catch (reason) {
      setStatus("ready")
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const credentials = async () => {
    if (auth.current.user && auth.current.csrf) return auth.current as Auth
    const next = await props.reauthenticate()
    if (next) auth.current = next
    return next
  }

  const reconcile = async (id: string, runId: string) => {
    const state = { missing: 0 }
    while (true) {
      try {
        const response = await fetch(`/api/v1/extension-publications/${encodeURIComponent(runId)}`, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        })
        const payload = parseRun(await response.text())
        if (response.status === 404) {
          state.missing += 1
          if (state.missing < 30) {
            await delay(1_000)
            continue
          }
          update(id, { status: "CANCELLED", error: "上传在服务器创建发布任务前已取消" })
          runs.current.delete(runId)
          return
        }
        if (AUTH_ERRORS.has(payload.code ?? "")) {
          const next = await props.reauthenticate()
          if (next) {
            auth.current = next
            continue
          }
          update(id, { status: "FAILED", error: "无法登录以核对服务器最终状态" })
          runs.current.delete(runId)
          return
        }
        if (!response.ok || !payload.status) {
          update(id, { status: "PAUSED", error: "暂时无法核对服务器最终状态，正在重试" })
          await delay(1_000)
          continue
        }
        state.missing = 0
        update(id, {
          status: payload.status,
          error: payload.error,
          warning:
            payload.artifact && !payload.artifact.releaseNotesAvailable
              ? "已发布，但 VSIX 未包含 RELEASE_NOTES.md；客户端将显示“暂无更新说明”。"
              : undefined,
        })
        if (TERMINAL.has(payload.status)) {
          runs.current.delete(runId)
          return
        }
      } catch {
        update(id, { status: "PAUSED", error: "网络中断，正在核对服务器最终状态" })
      }
      await delay(1_000)
    }
  }

  const send = (item: UploadItem, blob: Blob, runId: string, key: string, clock: { time: number; completed: number; high: number; speed: number }, total: number) =>
    new Promise<{ status: number; payload: ReturnType<typeof parseRun>; aborted: boolean }>((resolve) => {
      const xhr = new XMLHttpRequest()
      const local = { loaded: 0 }
      request.current = xhr
      current.current = { id: item.id, body: true, reconciling: false }
      xhr.open("POST", "/api/v1/extension-publications")
      xhr.setRequestHeader("content-type", "application/vnd.microsoft.vscode.vsix")
      xhr.setRequestHeader("x-csrf-token", auth.current.csrf)
      xhr.setRequestHeader("x-publication-run-id", runId)
      xhr.setRequestHeader("idempotency-key", key)
      xhr.setRequestHeader("x-vsix-filename", encodeURIComponent(item.name))
      xhr.upload.onload = () => { if (current.current?.id === item.id) current.current.body = false }
      xhr.upload.onprogress = (event) => {
        const time = performance.now()
        const seconds = Math.max(0.001, (time - clock.time) / 1_000)
        const delta = Math.max(0, event.loaded - local.loaded)
        const speed = delta / seconds
        clock.speed = clock.speed ? clock.speed * 0.7 + speed * 0.3 : speed
        clock.time = time
        clock.high = Math.max(clock.high, event.loaded)
        local.loaded = event.loaded
        const loaded = clock.completed + clock.high
        report({ path: item.path, loaded, total, percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : 0, speed: clock.speed, eta: clock.speed ? Math.max(0, (total - loaded) / clock.speed) : 0 })
      }
      xhr.onload = () => resolve({ status: xhr.status, payload: parseRun(xhr.responseText), aborted: false })
      xhr.onerror = () => resolve({ status: 0, payload: { message: "上传连接中断，请检查网络后重试。" }, aborted: false })
      xhr.onabort = () => resolve({ status: 0, payload: {}, aborted: true })
      xhr.send(blob)
    })

  const uploadOne = async (item: UploadItem, blob: Blob, clock: { time: number; completed: number; high: number; speed: number }, total: number) => {
    const runId = uuid()
    const key = uuid()
    runs.current.set(runId, item.id)
    update(item.id, { status: "UPLOADING", loaded: 0, runId, error: undefined, warning: undefined, conflict: undefined })
    clock.high = 0
    while (!cancelled.current) {
      const result = await send(item, blob, runId, key, clock, total)
      request.current = undefined
      if (result.aborted) {
        if (current.current?.id === item.id) current.current.reconciling = true
        await reconcile(item.id, runId)
        return
      }
      if (result.status === 0) {
        if (current.current?.id === item.id) current.current.reconciling = true
        update(item.id, { status: "PAUSED", error: result.payload.message ?? "连接中断，正在核对服务器最终状态" })
        await reconcile(item.id, runId)
        return
      }
      if (result.status === 503 && result.payload.code === "PUBLICATION_BUSY") {
        update(item.id, { status: "PAUSED", error: "服务繁忙，5 秒后自动重试" })
        await delay(5_000 + Math.floor(Math.random() * 1_001))
        if (!cancelled.current) update(item.id, { status: "UPLOADING", error: undefined })
        continue
      }
      if (result.status === 507 && result.payload.code === "STORAGE_PRESSURE") {
        update(item.id, { status: "PAUSED", error: "存储空间不足，清理服务端空间后手动继续" })
        setStatus("paused")
        await new Promise<void>((resolve) => { resume.current = resolve })
        resume.current = undefined
        if (!cancelled.current) {
          setStatus("uploading")
          update(item.id, { status: "UPLOADING", error: undefined })
        }
        continue
      }
      if (AUTH_ERRORS.has(result.payload.code ?? "")) {
        update(item.id, { status: "PAUSED", error: "会话已失效，请重新登录后继续" })
        const next = await props.reauthenticate()
        if (next) {
          auth.current = next
          update(item.id, { status: "UPLOADING", error: undefined })
          continue
        }
        update(item.id, { status: "FAILED", error: "登录已取消" })
        cancelled.current = true
        return
      }
      if (result.payload.code === "ORIGIN_INVALID") {
        update(item.id, { status: "FAILED", error: result.payload.message ?? "请求来源校验失败" })
        setError("请求来源校验失败，批量上传已停止。")
        cancelled.current = true
        return
      }
      if (result.status < 200 || result.status >= 300) {
        update(item.id, {
          status: "FAILED",
          error: result.payload.message ?? `上传失败（HTTP ${result.status}）`,
          conflict: result.payload.conflict,
        })
        return
      }
      update(item.id, {
        status: result.payload.status ?? "FAILED",
        loaded: item.size,
        error: result.payload.error,
        warning:
          result.payload.artifact && !result.payload.artifact.releaseNotesAvailable
            ? "已发布，但 VSIX 未包含 RELEASE_NOTES.md；客户端将显示“暂无更新说明”。"
            : undefined,
      })
      clock.completed += item.size
      clock.high = 0
      return
    }
  }

  const cancelFuture = (issue: string) => {
    for (const id of queue.current) {
      if (id === current.current?.id) continue
      const item = table.current.get(id)
      if (item && (item.status === "READY" || item.status === "EXTRACTING")) update(id, { status: "CANCELLED", error: issue })
    }
  }

  const upload = async (only?: UploadItem[]) => {
    if (!scan || !(await credentials())) return
    const items = only ?? scan.items.map((item) => table.current.get(item.id)).filter((item): item is UploadItem => Boolean(item?.selected))
    if (!items.length) return
    const batches = partition(items)
    for (const batch of batches) for (const item of batch.items) update(item.id, { batch: batch.index, status: "READY", loaded: 0, error: undefined, warning: undefined })
    queue.current = new Set(items.map((item) => item.id))
    cancelled.current = false
    setGroups(batches.length)
    setError("")
    setStatus("uploading")
    const total = items.reduce((sum, item) => sum + item.size, 0)
    const clock = { time: performance.now(), completed: 0, high: 0, speed: 0 }
    const sources = new Map(scan.sources.map((source) => [source.path, source.id]))
    const members = new Map<string, UploadItem[]>()
    const extracting = new Set<string>()
    for (const item of items) {
      const group = members.get(item.sourceId) ?? []
      group.push(item)
      members.set(item.sourceId, group)
    }
    setProgress({ path: "", loaded: 0, total, percent: 0, speed: 0, eta: 0 })
    await materialize(
      scan,
      items,
      async (entry, blob) => {
        const item = table.current.get(entry.id)
        if (item) await uploadOne(item, blob, clock, total)
        current.current = undefined
      },
      (entry, issue) => update(entry.id, { status: "FAILED", error: issue }),
      (path) => {
        const source = sources.get(path)
        if (!source || extracting.has(source)) return
        extracting.add(source)
        for (const item of members.get(source) ?? []) if (item.status === "READY") update(item.id, { status: "EXTRACTING" })
      },
      () => cancelled.current,
    )
    if (cancelled.current) cancelFuture("批量上传已停止")
    setStatus("complete")
    current.current = undefined
    setProgress((value) => ({ ...value, percent: cancelled.current ? value.percent : 100, loaded: cancelled.current ? value.loaded : value.total, eta: 0 }))
  }

  const cancel = () => {
    cancelled.current = true
    cancelFuture("批量上传已取消")
    const item = current.current ? table.current.get(current.current.id) : undefined
    if (item?.status === "PAUSED") {
      if (current.current?.reconciling) {
        setError("仍在核对服务器最终状态，不能提前把当前文件标记为取消。")
        return
      }
      update(item.id, { status: "CANCELLED", error: "批量上传已取消" })
      resume.current?.()
      return
    }
    if (current.current?.body) {
      setError("正在终止当前文件并向服务器核对最终状态…")
      request.current?.abort()
      return
    }
    setError("当前文件已进入校验或发布阶段；完成当前文件后停止剩余队列。")
  }

  const toggle = (item: UploadItem, selected: boolean) => {
    item.selected = selected
    setSelection((value) => ({ count: value.count + (selected ? 1 : -1), bytes: value.bytes + (selected ? item.size : -item.size) }))
    setPlanned(partition(scan?.items.filter((entry) => table.current.get(entry.id)?.selected) ?? []).length)
    render()
  }

  const drop = async (event: DragEvent) => {
    event.preventDefault()
    setDrag(false)
    await prepare(await dropInputs(event.dataTransfer))
  }

  return (
    <section className="extension-publish page-width">
      <div className="page-heading"><span className="eyebrow">VS CODE 插件发布</span><h1>上传 VS Code 插件</h1><p>只需上传各平台 VSIX。Server 会自动校验、归档并刷新更新清单；官方 ChipMate 包上传成功后立即进入客户端自动更新通道。</p></div>
      {(active || status === "complete") && <div className="glass-panel extension-progress-card extension-batch-progress">
        <div className="extension-progress-heading"><span className="upload-file-mark"><Code weight="duotone" /></span><div><h2>{status === "paused" ? "批量上传已暂停" : active ? "正在批量发布" : "批量发布完成"}</h2><p>{completed} / {selection.count} 个已处理 · {groups} 个逻辑批次 · {bytes(selection.bytes)}</p></div></div>
        <div className="prominent-progress"><div style={{ width: `${progress.percent}%` }}><strong>{progress.percent}%</strong></div></div>
        <div className="progress-metrics"><span><Package /> {bytes(progress.loaded)} / {bytes(progress.total || selection.bytes)}</span><span><ChartLineUp /> {progress.speed ? `${bytes(progress.speed)}/s` : "等待数据"}</span><span><Clock /> {progress.eta ? `预计剩余 ${Math.ceil(progress.eta)} 秒` : current.current ? `第 ${table.current.get(current.current.id)?.batch ?? 1} / ${groups} 组` : "处理完成"}</span></div>
        {active && <div className="progress-footer"><p><Warning /> 上传中的文件会终止并核对服务端状态；已进入校验的文件会完成后再停止。</p><div>{status === "paused" && <button className="secondary-button" onClick={() => resume.current?.()}>重新检查并继续</button>}<button className="danger-outline" onClick={cancel}>停止剩余上传</button></div></div>}
        {status === "complete" && <div className="batch-result"><span className="publication-success"><CheckCircle weight="fill" /><strong>{counts.PUBLISHED ?? 0} 个发布成功</strong></span><span>{counts.DUPLICATE ?? 0} 个已存在</span><span>{counts.FAILED ?? 0} 个失败</span><span>{counts.CANCELLED ?? 0} 个取消</span><span>{scan?.ignored ?? 0} 个忽略</span></div>}
      </div>}
      <div className="extension-upload-grid">
        <div className={`glass-panel extension-drop ${drag ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(event) => void drop(event)}>
          <span className="upload-glass-icon"><FileArrowUp /></span><h2>拖入 VSIX、归档或文件夹</h2><p>无关内容只在本地忽略，不会发送到服务器</p>
          <div className="extension-picker-actions">
            <label className="primary-button extension-file-button"><UploadSimple /> 选择文件<input type="file" multiple accept=".vsix,.zip,.tar.gz,.tgz" onChange={(event) => void prepare(listInputs(event.target.files ?? []))} /></label>
            <label className="secondary-button extension-file-button"><Package /> 选择文件夹<input type="file" multiple {...{ webkitdirectory: "" }} onChange={(event) => void prepare(listInputs(event.target.files ?? []))} /></label>
          </div>
          <small><ShieldWarning /> 选择总数不限；自动按最多 20 个 / 10 GiB 分组，单个 VSIX 最大 512 MiB</small>
          {status === "scanning" && <div className="extension-scan-progress"><strong>正在本地扫描</strong><span>{progress.path || "正在读取所选内容"}</span><div><i style={{ width: `${progress.percent}%` }} /></div></div>}
          {error && <InlineError message={error} />}
          {scan && status !== "scanning" && <div className="extension-batch-review">
            <div className="batch-summary"><span><strong>{selection.count}</strong> 个待上传</span><span><strong>{bytes(selection.bytes)}</strong> 合计</span><span><strong>{planned}</strong> 个逻辑批次</span><span><strong>{scan.ignored}</strong> 个已忽略</span><span><strong>{scan.errors.length}</strong> 个扫描错误</span></div>
            <div className="extension-batch-list virtual-batch-list" onScroll={(event) => setScroll(event.currentTarget.scrollTop)}>
              <div style={{ paddingTop: start * ROW, paddingBottom: Math.max(0, (order.current.length - end) * ROW) }}>
                {visible.map((item) => <div key={item.id} className={`batch-item ${item.status.toLocaleLowerCase()}`}><input type="checkbox" aria-label={`选择 ${item.name}`} checked={item.selected} disabled={active} onChange={(event) => toggle(item, event.target.checked)} /><span><strong>{item.name}</strong><small>{item.path}</small><small>{bytes(item.size)} · {sourceLabel(item.kind)}{item.batch ? ` · 第 ${item.batch} 组` : ""}</small>{item.error && <em>{item.error}</em>}{item.warning && <em className="batch-warning">{item.warning}</em>}</span><b>{stateLabel(item.status)}</b>{item.status === "FAILED" && item.selected && !active && <button type="button" onClick={() => void upload([item])}>重试</button>}</div>)}
              </div>
            </div>
            {conflicts.map((item) => <PublicationConflictCard key={item.id} conflict={item.conflict!} />)}
            {(scan.notes.length > 0 || scan.errors.length > 0) && <details className="batch-notes"><summary>查看忽略与扫描明细</summary>{[...scan.errors, ...scan.notes].map((item, index) => <p key={`${item.path}-${index}`}><strong>{item.path}</strong><span>{item.reason}</span></p>)}</details>}
            {!active && status !== "complete" && <button className="primary-button publish-vsix" disabled={!selection.count} onClick={() => void upload()}>开始批量上传</button>}
          </div>}
        </div>
        <div className="glass-panel extension-upload-rules"><h2>上传说明</h2><Rule icon={<Package />} title="上传即发布">文件夹和归档只在浏览器本地扫描；VSIX 上传成功后由 Server 自动维护产物和动态 manifest。</Rule><Rule icon={<CheckCircle />} title="自动进入更新通道">官方 ChipMate 包会按内部 target 自动进入客户端更新候选，无需复制文件、编辑 manifest 或重启服务。</Rule><Rule icon={<UserCircle />} title="首次发布绑定 owner">扩展 ID 首次成功上传后归当前账号所有，后续只有原始发布者可以发布或下架。</Rule><Rule icon={<Clock />} title="冲突不自动覆盖">同版本、同平台但 SHA 不同的包会被拒绝；请提升版本，或先由 owner 下架原包后重试。</Rule></div>
      </div>
    </section>
  )
}

function Rule(props: { icon: ReactNode; title: string; children: ReactNode }) { return <div className="upload-rule"><span>{props.icon}</span><div><strong>{props.title}</strong><p>{props.children}</p></div></div> }
function PublicationConflictCard(props: { conflict: PublicationConflict }) {
  const value = props.conflict
  return <section className="publication-conflict" aria-label={`${value.extensionId} 发布冲突`}>
    <header><span><Warning weight="fill" /></span><div><h3>同版本构建冲突</h3><p>{value.extensionId} · v{value.version} · {value.target}</p></div></header>
    <div className="conflict-files"><article><small>服务器现有文件</small><strong>{value.existing.filename}</strong><code>{value.existing.sha256}</code></article><ArrowRight /><article><small>本次上传文件</small><strong>{value.incoming.filename}</strong><code>{value.incoming.sha256}</code></article></div>
    <ol><li><strong>提升版本后重新打包上传（推荐）</strong><span>保持已发布版本不可变，客户端会正常识别为新更新。</span></li><li><strong>{value.existing.canDelete ? "在“我的插件”下架原版本后重试" : "联系管理员处理旧系统包后重试"}</strong><span>{value.existing.canDelete ? "下架是明确的人工操作，Server 不会自动覆盖或删除旧包。" : "旧 /packages 系统包不能从上传页删除。"}</span></li></ol>
  </section>
}
function sourceLabel(value: BatchItem["kind"]) { return value === "folder" ? "文件夹" : value === "zip" ? "ZIP" : value === "tar" ? "TAR.GZ" : "本地文件" }
function stateLabel(value: UploadState) { return value === "READY" ? "等待上传" : value === "EXTRACTING" ? "正在提取" : value === "PAUSED" ? "已暂停" : value === "UPLOADING" ? "上传中" : value === "VALIDATING" ? "校验中" : value === "PUBLISHING" ? "发布中" : value === "PUBLISHED" ? "已发布" : value === "DUPLICATE" ? "已存在" : value === "CANCELLED" ? "已取消" : "失败" }
function parseRun(value: string): Partial<ExtensionPublicationRun> & { code?: string; message?: string; conflict?: PublicationConflict } {
  try {
    return JSON.parse(value || "{}") as Partial<ExtensionPublicationRun> & { code?: string; message?: string; conflict?: PublicationConflict }
  } catch (err) {
    console.error("Invalid extension publication response", err)
    return {}
  }
}

function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)) }

export function ExtensionMe(props: Shared) {
  const [tab, setTab] = useState<"uploads" | "favorites" | "reviews">("uploads")
  const uploads = useApi<ExtensionArtifact[]>("/api/v1/me/extensions/uploads")
  const favorites = useApi<ExtensionSummary[]>("/api/v1/me/extensions/favorites")
  const reviews = useApi<ExtensionReview[]>("/api/v1/me/extensions/reviews")
  const [pending, setPending] = useState<ExtensionArtifact>()
  const [error, setError] = useState("")
  if (!props.user) return <LoginRequired title="我的插件中心" login={props.requestLogin} />
  const remove = async () => {
    if (!pending) return
    try {
      await mutate(`/api/v1/extension-artifacts/${encodeURIComponent(pending.id)}`, "DELETE", undefined, props.csrf)
      setPending(undefined)
      uploads.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const removeReview = async (id: string) => {
    try {
      await mutate(`/api/v1/extensions/${encodeURIComponent(id)}/review`, "DELETE", undefined, props.csrf)
      reviews.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  return <section className="extension-me page-width">
    <div className="page-heading"><span className="eyebrow">个人工作台</span><h1>我的插件中心</h1><p>管理上传、收藏与评价的 VS Code 插件。</p></div>
    <div className="extension-me-stats"><Metric icon={<UploadSimple />} label="上传构建总数" value={uploads.data?.length ?? 0} /><Metric icon={<Heart />} label="收藏总数" value={favorites.data?.length ?? 0} /><Metric icon={<Star />} label="评价总数" value={reviews.data?.length ?? 0} /></div>
    <div className="extension-tabs"><button className={tab === "uploads" ? "active" : ""} onClick={() => setTab("uploads")}>我的上传</button><button className={tab === "favorites" ? "active" : ""} onClick={() => setTab("favorites")}>我的收藏</button><button className={tab === "reviews" ? "active" : ""} onClick={() => setTab("reviews")}>我的评价</button></div>
    {error && <InlineError message={error} />}
    <div className="glass-panel extension-table">
      {tab === "uploads" && (uploads.data ?? []).map((item) => <div key={item.id}><span className="mini-extension-icon"><Code /></span><span><strong>{item.extensionId} {item.conflict && <em className="conflict-pill">冲突构建</em>}</strong><small>v{item.version} · {item.target}<br />SHA {item.sha256.slice(0, 16)}…</small></span><span>{date(item.publishedAt)}</span><span>{compact(item.downloads)} 下载</span><button className="secondary-button" onClick={() => props.navigate(`/extensions/${encodeURIComponent(item.extensionId)}`)}>打开详情</button>{item.status === "published" && <button className="danger-outline" onClick={() => setPending(item)}><Trash /> 下架</button>}</div>)}
      {tab === "favorites" && (favorites.data ?? []).map((item) => <button className="favorite-row" key={item.id} onClick={() => props.navigate(`/extensions/${encodeURIComponent(item.id)}`)}><span className="mini-extension-icon">{item.iconData ? <img src={item.iconData} alt="" /> : <Code />}</span><span><strong>{item.displayName}</strong><small>{item.id}</small></span><ArrowRight /></button>)}
      {tab === "reviews" && (reviews.data ?? []).map((item) => <div key={item.extensionId}><span className="mini-extension-icon"><Star /></span><span><strong>{item.extensionId}</strong><small>{"★".repeat(item.rating)} · {item.comment || "仅评分"}</small></span><span>{date(item.updatedAt)}</span><span /><button className="secondary-button" onClick={() => props.navigate(`/extensions/${encodeURIComponent(item.extensionId)}`)}>修改</button><button className="danger-outline" onClick={() => void removeReview(item.extensionId)}>删除</button></div>)}
    </div>
    {pending && <dialog className="extension-delete-dialog" open><div className="delete-warning"><Warning weight="fill" /><div><h2>确认下架此插件？</h2><p>下架后将立即删除 VSIX，且无法恢复。</p></div></div><dl><dt>文件名</dt><dd>{pending.filename}</dd><dt>SHA-256</dt><dd>{pending.sha256}</dd></dl><div className="dialog-actions"><button className="secondary-button" onClick={() => setPending(undefined)}>取消</button><button className="danger-button" onClick={() => void remove()}>确认删除</button></div></dialog>}
  </section>
}

export function ExtensionAnalyticsPage(props: Pick<Shared, "user" | "requestLogin">) {
  const data = useApi<ExtensionAnalytics>("/api/v1/analytics/extensions/overview")
  const uploads = useApi<ExtensionArtifact[]>(props.user ? "/api/v1/me/extensions/uploads" : undefined)
  const first = props.user ? uploads.data?.[0] : undefined
  const sources = useApi<Array<{ source: string; value: number }>>(first ? `/api/v1/analytics/extension-artifacts/${encodeURIComponent(first.id)}/sources` : undefined)
  if (data.loading) return <section className="page-width"><Skeleton label="正在载入插件市场分析" /></section>
  if (data.error || !data.data) return <section className="page-width"><InlineError message={data.error || "暂无分析数据"} /></section>
  const item = data.data
  const chart = trend(item.trend)
  return <section className="extension-analytics page-width">
    <div className="analytics-heading"><div><span className="eyebrow">公开聚合数据</span><h1>插件市场分析</h1><p>洞察市场趋势，发现增长机会。</p></div><span className="analytics-range">30 天</span></div>
    <div className="extension-kpis"><Metric icon={<DownloadSimple />} label="总下载量" value={item.totals.downloads} /><Metric icon={<Heart />} label="总收藏数" value={item.totals.favorites} /><Metric icon={<Star />} label="平均评分" value={item.totals.rating.toFixed(2)} /><Metric icon={<Package />} label="活跃插件数" value={item.totals.active} /><Metric icon={<ChartLineUp />} label="30 天增长" value={`${item.totals.growth30d >= 0 ? "+" : ""}${item.totals.growth30d.toFixed(1)}%`} /></div>
    <div className="analytics-grid">
      <section className="glass-panel trend-panel">
        <div className="panel-heading"><ChartLineUp /><h2>下载趋势</h2>{chart.total > 0 && <span className="trend-peak">峰值 <strong>{chart.peak}</strong></span>}</div>
        {chart.total === 0 ? <div className="trend-empty"><p>近30天暂无下载</p><span>产生下载后会在这里形成趋势。</span></div> : <>
          <div className="bar-trend" role="list" aria-label={`最近30天下载趋势，合计 ${chart.total} 次，单日峰值 ${chart.peak} 次`}>
            {chart.points.map((point) => <span className="trend-bar" role="listitem" aria-label={`${point.date}，${point.downloads} 次下载`} key={point.date} style={{ height: `${point.height}%` }} title={`${point.date}：${point.downloads} 次下载`} />)}
          </div>
          <div className="trend-axis"><time dateTime={chart.points[0]?.date}>{chart.points[0]?.date}</time><span>近30天合计 {chart.total}</span><time dateTime={chart.points.at(-1)?.date}>{chart.points.at(-1)?.date}</time></div>
        </>}
      </section>
      <Ranking title="下载排行榜" items={item.downloads} />
      <Ranking title="高评分排行榜" items={item.ratings} />
      <section className="glass-panel target-panel"><div className="panel-heading"><Package /><h2>平台分布</h2></div>{item.targets.map((target) => <div key={target.target}><span>{target.target}</span><progress max={Math.max(...item.targets.map((entry) => entry.value), 1)} value={target.value} /><strong>{target.value}</strong></div>)}</section>
      <section className="glass-panel private-source"><div className="panel-heading"><LockKey /><h2>我的包级来源明细</h2></div>{!props.user && <><p>仅上传者可查看详细来源数据。</p><button className="secondary-button" onClick={props.requestLogin}>前往登录</button></>}{props.user && !first && <p>上传插件后可查看来源分布。</p>}{props.user && first && <><strong>{first.extensionId} · {first.target}</strong>{(sources.data ?? []).map((source) => <div key={source.source}><span>{source.source}</span><progress max={Math.max(...(sources.data ?? []).map((entry) => entry.value), 1)} value={source.value} /><em>{source.value}</em></div>)}</>}</section>
      <section className="glass-panel activity-panel"><div className="panel-heading"><Clock /><h2>最近动态</h2></div>{item.activity.map((entry) => <div key={`${entry.extensionId}-${entry.at}`}><span className="mini-extension-icon"><Code /></span><span><strong>{entry.name}</strong><small>{entry.extensionId} 发布了新构建</small></span><em>{date(entry.at)}</em></div>)}{item.activity.length === 0 && <p>发布插件后会在这里显示动态。</p>}</section>
    </div>
  </section>
}

function Metric(props: { icon: ReactNode; label: string; value: string | number }) { return <article className="glass-panel extension-metric"><span>{props.icon}</span><div><small>{props.label}</small><strong>{typeof props.value === "number" ? props.value.toLocaleString("zh-CN") : props.value}</strong></div></article> }
function Ranking(props: { title: string; items: Array<{ id: string; name: string; value: number }> }) { return <section className="glass-panel ranking-panel"><div className="panel-heading"><Star /><h2>{props.title}</h2></div>{props.items.slice(0, 5).map((item, index) => <div key={item.id}><span>{index + 1}</span><strong>{item.name}</strong><em>{Number.isInteger(item.value) ? compact(item.value) : item.value.toFixed(2)}</em></div>)}</section> }
function LoginRequired(props: { title: string; login(): void }) { return <section className="page-width"><div className="page-heading"><h1>{props.title}</h1></div><div className="glass-panel account-empty"><LockKey /><p>登录后可以管理你的插件市场数据。</p><button className="primary-button" onClick={props.login}>登录</button></div></section> }

function compatible(target: string) {
  if (target === "universal") return true
  const agent = navigator.userAgent.toLocaleLowerCase()
  if (target.startsWith("win32")) return agent.includes("windows")
  if (target.startsWith("darwin")) return agent.includes("mac os")
  if (target.startsWith("linux")) return agent.includes("linux")
  return true
}

function rememberSource(fallback: "home" | "search") {
  const query = new URLSearchParams(location.search).get("source")
  const source = query === "vscode" || query === "external" ? query : fallback
  sessionStorage.setItem("chipmate-extension-download-source", source)
}

function takeSource() {
  const query = new URLSearchParams(location.search).get("source")
  const stored = sessionStorage.getItem("chipmate-extension-download-source")
  const allowed = new Set(["home", "search", "detail", "external", "vscode"])
  const source = allowed.has(query ?? "") ? query! : allowed.has(stored ?? "") ? stored! : "detail"
  sessionStorage.removeItem("chipmate-extension-download-source")
  return encodeURIComponent(source)
}

export function ExtensionUnavailable(props: { navigate(path: string): void }) { return <section className="page-width"><div className="glass-panel extension-unavailable"><ShieldWarning /><h1>VS Code 插件市场尚未启用</h1><p>当前部署仍保持 Skill Market 与渲染服务正常运行。</p><button className="secondary-button" onClick={() => props.navigate("/")}>返回技能市场</button></div></section> }
