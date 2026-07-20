import {
  ArrowRight,
  BookOpenText,
  CaretLeft,
  CaretRight,
  Code,
  DownloadSimple,
  FunnelSimple,
  Heart,
  MagnifyingGlass,
  Monitor,
  Moon,
  Package,
  Pause,
  Play,
  ShieldCheck,
  Sparkle,
  SquaresFour,
  Sun,
  UploadSimple,
  UserCircle,
  X,
  Wrench,
} from "@phosphor-icons/react"
import type { MarketCapabilities, MarketUser, SkillSummary } from "@chipmate/market-contracts"
import {
  lazy,
  StrictMode,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as Pointer,
  type ReactNode,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { compact, icon, InlineError, mutate, request, Skeleton, useApi } from "./shared"
import { image, repair } from "./icons"
import { track } from "./analytics"
import { RiskBadge } from "./risk"
import { next, previous, query, type Theme } from "./state"
import "./styles.css"

declare global {
  interface Window {
    __marketRoot?: Root
    __marketVitals: { cls: number; inp: number; lcp: number }
  }
}

interface Catalog {
  items: SkillSummary[]
  catalogVersion: string
  nextCursor?: string
}

interface Category {
  id: string
  name: string
  count: number
}

const hero = "/assets/spatial-hero.webp"
const Detail = lazy(() => import("./routes/detail").then((module) => ({ default: module.Detail })))
const StatusPage = lazy(() => import("./routes/status").then((module) => ({ default: module.StatusPage })))
const PublishPage = lazy(() => import("./routes/publish").then((module) => ({ default: module.PublishPage })))
const MePage = lazy(() => import("./routes/me").then((module) => ({ default: module.MePage })))
const AnalyticsPage = lazy(() => import("./routes/analytics").then((module) => ({ default: module.AnalyticsPage })))
const ExtensionHome = lazy(() => import("./routes/extensions").then((module) => ({ default: module.ExtensionHome })))
const ExtensionDetail = lazy(() =>
  import("./routes/extensions").then((module) => ({ default: module.ExtensionDetail })),
)
const ExtensionPublish = lazy(() =>
  import("./routes/extensions").then((module) => ({ default: module.ExtensionPublish })),
)
const ExtensionMe = lazy(() => import("./routes/extensions").then((module) => ({ default: module.ExtensionMe })))
const ExtensionAnalyticsPage = lazy(() =>
  import("./routes/extensions").then((module) => ({ default: module.ExtensionAnalyticsPage })),
)
const ExtensionUnavailable = lazy(() =>
  import("./routes/extensions").then((module) => ({ default: module.ExtensionUnavailable })),
)

collectVitals()

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("chipmate-market-theme")
    return saved === "light" || saved === "dark" ? saved : "system"
  })
  const [path, setPath] = useState(() => `${location.pathname}${location.search}`)
  const [user, setUser] = useState<MarketUser>()
  const [csrf, setCsrf] = useState(() => sessionStorage.getItem("chipmate-market-csrf") ?? "")
  const [login, setLogin] = useState(() => location.pathname === "/login")
  const [detailSync, setDetailSync] = useState(0)
  const [meSync, setMeSync] = useState(0)
  const [analyticsSync, setAnalyticsSync] = useState(0)
  const waiters = useRef<Array<(value: { user: MarketUser; csrf: string } | undefined) => void>>([])
  const capabilities = useApi<MarketCapabilities>("/api/v1/capabilities")

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme
      document.documentElement.dataset.themeChoice = theme
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])

  useEffect(() => {
    if (theme === "system") localStorage.removeItem("chipmate-market-theme")
    else localStorage.setItem("chipmate-market-theme", theme)
  }, [theme])

  useEffect(() => {
    const update = () => setPath(`${location.pathname}${location.search}`)
    addEventListener("popstate", update)
    return () => removeEventListener("popstate", update)
  }, [])

  useEffect(() => {
    if (user && csrf) track("market_impression", { context: { source: "web-app" } })
  }, [csrf, user])

  useEffect(() => {
    if (sessionStorage.getItem("chipmate-market-session-active") === "1") {
      request<MarketUser>("/api/v1/auth/me")
        .then(setUser)
        .catch(() => {
          sessionStorage.removeItem("chipmate-market-session-active")
          setUser(undefined)
        })
    }
    const version = sessionStorage.getItem("chipmate-market-catalog-version") ?? ""
    const stream = new EventSource(
      `/api/v1/market/stream${version ? `?catalogVersion=${encodeURIComponent(version)}` : ""}`,
    )
    stream.addEventListener("catalog.invalidated", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { catalogVersion?: unknown }
      if (typeof data.catalogVersion === "string")
        sessionStorage.setItem("chipmate-market-catalog-version", data.catalogVersion)
      setDetailSync((value) => value + 1)
    })
    const state = () => {
      setDetailSync((value) => value + 1)
      setMeSync((value) => value + 1)
    }
    stream.addEventListener("favorite.changed", state)
    stream.addEventListener("installation.changed", state)
    stream.addEventListener("publication.changed", () => setMeSync((value) => value + 1))
    stream.addEventListener("analytics.updated", () => setAnalyticsSync((value) => value + 1))
    return () => stream.close()
  }, [])

  const signedIn = (next: MarketUser, token: string) => {
    sessionStorage.setItem("chipmate-market-csrf", token)
    sessionStorage.setItem("chipmate-market-session-active", "1")
    setCsrf(token)
    setUser(next)
    setLogin(false)
    for (const resolve of waiters.current.splice(0)) resolve({ user: next, csrf: token })
    if (location.pathname === "/login") {
      const target = new URL(location.href).searchParams.get("return")
      const path = target?.startsWith("/") && !target.startsWith("//") ? target : "/"
      history.replaceState({}, "", path)
      setPath(path)
    }
    setDetailSync((value) => value + 1)
    setMeSync((value) => value + 1)
    setAnalyticsSync((value) => value + 1)
  }

  const signOut = async () => {
    await mutate<{ ok: true }>("/api/v1/auth/session", "DELETE", undefined, csrf)
    sessionStorage.removeItem("chipmate-market-csrf")
    sessionStorage.removeItem("chipmate-market-session-active")
    setCsrf("")
    setUser(undefined)
  }

  const navigate = (next: string) => {
    history.pushState({}, "", next)
    setPath(next)
    scrollTo({ top: 0, behavior: "smooth" })
  }

  const closeLogin = () => {
    setLogin(false)
    for (const resolve of waiters.current.splice(0)) resolve(undefined)
    if (location.pathname !== "/login") return
    const target = new URL(location.href).searchParams.get("return")
    navigate(target?.startsWith("/") && !target.startsWith("//") ? target : "/")
  }

  const requestLogin = (target: string) => {
    navigate(`/login?return=${encodeURIComponent(target)}`)
    setLogin(true)
  }

  const reauthenticate = () => {
    setLogin(true)
    return new Promise<{ user: MarketUser; csrf: string } | undefined>((resolve) => waiters.current.push(resolve))
  }

  const url = new URL(path, location.origin)
  const detail = url.pathname.match(/^\/skills\/([^/]+)$/)
  const extension = url.pathname.match(/^\/extensions\/([^/]+)$/)
  const extensionId =
    extension && !["publish", "me", "analytics"].includes(extension[1] ?? "") ? extension[1] : undefined
  const enabled = capabilities.data?.features.extensions === true
  const extensionPage = url.pathname.startsWith("/extensions")
  const plugin = capabilities.loading ? (
    <Skeleton label="正在检查插件市场能力" />
  ) : capabilities.error ? (
    <section className="page-width">
      <InlineError message={`无法读取插件市场能力：${capabilities.error}`} />
    </section>
  ) : !enabled ? (
    <ExtensionUnavailable navigate={navigate} />
  ) : url.pathname === "/extensions" ? (
    <ExtensionHome navigate={navigate} />
  ) : url.pathname === "/extensions/publish" ? (
    <ExtensionPublish
      user={user}
      csrf={csrf}
      requestLogin={() => requestLogin("/extensions/publish")}
      reauthenticate={reauthenticate}
    />
  ) : url.pathname === "/extensions/me" ? (
    <ExtensionMe navigate={navigate} user={user} csrf={csrf} requestLogin={() => requestLogin("/extensions/me")} />
  ) : url.pathname === "/extensions/analytics" ? (
    <ExtensionAnalyticsPage user={user} requestLogin={() => requestLogin("/extensions/analytics")} />
  ) : extensionId ? (
    <ExtensionDetail
      id={decodeURIComponent(extensionId)}
      navigate={navigate}
      user={user}
      csrf={csrf}
      requestLogin={() => requestLogin(url.pathname)}
    />
  ) : (
    <ExtensionHome navigate={navigate} />
  )
  const page = extensionPage ? (
    plugin
  ) : detail ? (
    <Detail
      key={detailSync}
      id={decodeURIComponent(detail[1] ?? "")}
      navigate={navigate}
      user={user}
      csrf={csrf}
      sync={detailSync}
      requestLogin={() => requestLogin(url.pathname)}
    />
  ) : url.pathname === "/skills" ? (
    <Directory url={url} navigate={navigate} />
  ) : url.pathname === "/status" ? (
    <StatusPage />
  ) : url.pathname === "/publish" ? (
    <PublishPage user={user} csrf={csrf} requestLogin={() => requestLogin("/publish")} />
  ) : url.pathname === "/me" ? (
    <MePage
      key={meSync}
      user={user}
      csrf={csrf}
      requestLogin={() => requestLogin("/me")}
      navigate={navigate}
      signOut={() => void signOut()}
    />
  ) : url.pathname === "/analytics" ? (
    <AnalyticsPage key={analyticsSync} user={user} requestLogin={() => requestLogin("/analytics")} />
  ) : (
    <Home navigate={navigate} />
  )

  return (
    <div className="app-shell">
      <Header
        path={url.pathname}
        extensions={enabled}
        navigate={navigate}
        theme={theme}
        setTheme={setTheme}
        user={user}
        signIn={() => requestLogin(url.pathname === "/login" ? "/" : `${url.pathname}${url.search}`)}
        signOut={() => void signOut()}
      />
      <div className="desktop-hint" role="note">
        建议使用宽度不低于 1024px 的桌面浏览器获得完整体验；当前仍可只读浏览。
      </div>
      <main>
        <Suspense
          fallback={
            <section className="page-width detail-page">
              <Skeleton label="正在载入页面" />
            </section>
          }
        >
          {page}
        </Suspense>
      </main>
      <Footer navigate={navigate} />
      <LoginDialog open={login} close={closeLogin} signedIn={signedIn} />
    </div>
  )
}

function Header(props: {
  path: string
  extensions: boolean
  navigate(path: string): void
  theme: Theme
  setTheme(value: Theme): void
  user: MarketUser | undefined
  signIn(): void
  signOut(): void
}) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => props.navigate("/")} aria-label="返回首页">
        <img src={icon} alt="" />
        <span>
          <strong>ChipMate Market</strong>
          <small>团队可信赖的 AI 能力与开发工具市场</small>
        </span>
      </button>
      <nav aria-label="主要导航">
        <ThemeButton theme={props.theme} setTheme={props.setTheme} />
        <NavButton
          active={!props.path.startsWith("/extensions") && props.path !== "/status"}
          onClick={() => props.navigate("/")}
          icon={<SquaresFour />}
        >
          技能市场
        </NavButton>
        {props.extensions && (
          <NavButton
            active={props.path.startsWith("/extensions")}
            onClick={() => props.navigate("/extensions")}
            icon={<Code />}
          >
            VS Code 插件
          </NavButton>
        )}
        <NavButton active={props.path === "/status"} onClick={() => props.navigate("/status")} icon={<ShieldCheck />}>
          服务状态
        </NavButton>
        {props.user && !props.path.startsWith("/extensions") && (
          <NavButton
            active={props.path === "/analytics"}
            onClick={() => props.navigate("/analytics")}
            icon={<FunnelSimple />}
          >
            分析
          </NavButton>
        )}
        {props.extensions && props.path.startsWith("/extensions") && (
          <NavButton
            active={props.path === "/extensions/analytics"}
            onClick={() => props.navigate("/extensions/analytics")}
            icon={<FunnelSimple />}
          >
            分析
          </NavButton>
        )}
        {props.user ? (
          <button
            className="glass-button account-button"
            onClick={() => props.navigate(props.path.startsWith("/extensions") ? "/extensions/me" : "/me")}
            title="打开个人工作台"
          >
            <UserCircle />
            <span>{props.user.displayName}</span>
          </button>
        ) : (
          <button className="glass-button account-button" onClick={props.signIn}>
            <UserCircle />
            <span>登录</span>
          </button>
        )}
        <button
          className="glass-button"
          onClick={() => props.navigate(props.path.startsWith("/extensions") ? "/extensions/publish" : "/publish")}
        >
          <UploadSimple /> {props.path.startsWith("/extensions") ? "发布插件" : "发布技能"}
        </button>
      </nav>
    </header>
  )
}

function LoginDialog(props: { open: boolean; close(): void; signedIn(user: MarketUser, csrf: string): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [key, setKey] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (props.open && !dialog.current?.open) dialog.current?.showModal()
    if (!props.open && dialog.current?.open) dialog.current.close()
  }, [props.open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = key
    setKey("")
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/v1/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ apiKey: value }),
      })
      const payload = (await response.json()) as MarketUser & { message?: string }
      if (!response.ok) throw new Error(payload.message ?? `登录失败（HTTP ${response.status}）`)
      const csrf = response.headers.get("x-csrf-token")
      if (!csrf) throw new Error("服务器未返回 CSRF 会话凭据。")
      props.signedIn(payload, csrf)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} className="login-dialog" onClose={props.close}>
      <form method="dialog" className="dialog-close">
        <button aria-label="关闭登录" onClick={props.close}>
          <X />
        </button>
      </form>
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <span className="dialog-icon">
          <UserCircle />
        </span>
        <div>
          <span className="eyebrow">统一市场身份</span>
          <h2>登录 ChipMate Market</h2>
        </div>
        <p>
          使用现有 New API key 完成一次身份解析。原始 key 会在本次请求后立即从输入框清除，浏览器仅保留服务端随机会话。
        </p>
        <label>
          New API key
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            required
          />
        </label>
        {error && <InlineError message={error} />}
        <button className="primary-button" disabled={busy}>
          {busy ? "正在验证…" : "安全登录"}
        </button>
      </form>
    </dialog>
  )
}

function ThemeButton(props: { theme: Theme; setTheme(value: Theme): void }) {
  const value = next(props.theme)
  const label = props.theme === "system" ? "跟随系统" : props.theme === "dark" ? "深色" : "浅色"
  return (
    <button
      className="theme-button"
      onClick={() => props.setTheme(value)}
      aria-label={`主题：${label}`}
      title={`当前主题：${label}`}
    >
      {props.theme === "system" ? <Monitor /> : props.theme === "dark" ? <Moon /> : <Sun />}
    </button>
  )
}

function NavButton(props: { active: boolean; onClick(): void; icon: ReactNode; children: ReactNode }) {
  return (
    <button className={`nav-button ${props.active ? "active" : ""}`} onClick={props.onClick}>
      {props.icon}
      <span>{props.children}</span>
    </button>
  )
}

function Home(props: { navigate(path: string): void }) {
  const catalog = useApi<Catalog>("/api/v1/skills?sort=downloads&limit=10")
  const categories = useApi<Category[]>("/api/v1/categories")
  const featured = catalog.data?.items ?? []

  return (
    <>
      <section className="hero-section">
        <div className="trust-line">
          <ShieldCheck /> 技能发布前会自动扫描，风险结果请以版本详情为准
        </div>
        <div className="hero-grid page-width">
          <div className="hero-copy">
            <span className="eyebrow">
              <Sparkle /> ChipMate 精选技能库
            </span>
            <h1>
              找到可信赖的技能，
              <br />
              提升工程效率
            </h1>
            <p>从真实源码证据到高质量工程文档，让经过验证的技能成为团队可复用的能力。</p>
            <Search navigate={props.navigate} />
            <div className="quick-links" aria-label="热门搜索">
              <span>热门：</span>
              {["源码证据", "详细设计", "文档生成"].map((value) => (
                <button key={value} onClick={() => props.navigate(`/skills?q=${encodeURIComponent(value)}`)}>
                  {value}
                </button>
              ))}
            </div>
          </div>
          <img className="hero-art" src={hero} alt="ChipMate 三维玻璃标志与环形展台" fetchPriority="high" />
        </div>
      </section>

      <section className="featured-section" aria-labelledby="featured-title">
        <div className="page-width featured-shell">
          <div className="section-heading featured-heading">
            <div>
              <span className="eyebrow">下载榜 · TOP 10</span>
              <h2 id="featured-title">值得带进下一个项目的技能</h2>
            </div>
          </div>
          {catalog.loading && <Skeleton label="正在载入下载榜技能" />}
          {catalog.error && <InlineError message={catalog.error} />}
          {featured.length > 0 && <Featured items={featured} navigate={props.navigate} />}
          {!catalog.loading && !catalog.error && featured.length === 0 && (
            <Empty title="目录还是空的" body="首个技能发布后会出现在这里。" />
          )}
        </div>
      </section>

      <section className="page-width category-section" aria-labelledby="category-title">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">浏览路径</span>
            <h2 id="category-title">精选分类</h2>
          </div>
        </div>
        <div className="category-grid">
          {(categories.data ?? []).map((item, index) => (
            <button
              className="category-card"
              key={item.id}
              onClick={() => props.navigate(`/skills?category=${encodeURIComponent(item.id)}`)}
            >
              <span className="category-icon">{categoryIcon(index)}</span>
              <span>
                <strong>{label(item.name)}</strong>
                <small>{item.count} 个技能</small>
              </span>
              <ArrowRight />
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

function Search(props: { navigate(path: string): void; initial?: string }) {
  const [query, setQuery] = useState(props.initial ?? "")
  useEffect(() => setQuery(props.initial ?? ""), [props.initial])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    track("market_search", { context: { hasQuery: Boolean(query.trim()), queryLength: query.trim().length } })
    props.navigate(query.trim() ? `/skills?q=${encodeURIComponent(query.trim())}` : "/skills")
  }
  return (
    <form className="search-bar" onSubmit={submit} role="search">
      <MagnifyingGlass aria-hidden="true" />
      <label className="sr-only" htmlFor="market-search">
        搜索技能
      </label>
      <input
        id="market-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索技能，例如：源码分析、API 文档生成…"
      />
      <button type="submit">搜索</button>
    </form>
  )
}

function Featured(props: { items: SkillSummary[]; navigate(path: string): void }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
  const drag = useRef({ id: -1, x: 0, y: 0 })
  const count = props.items.length
  const blocked = paused || hover || focus || hidden || reduced
  const active = props.items[index] ?? props.items[0]
  const before = count > 0 ? (index - 1 + count) % count : 0
  const after = count > 0 ? (index + 1) % count : 0
  const layout = count === 1 ? "single" : count === 2 ? "pair" : ""

  useEffect(() => {
    if (index < count) return
    setIndex(0)
  }, [count, index])

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    const update = () => setHidden(document.hidden)
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])

  useEffect(() => {
    if (count < 2 || blocked) return
    const timer = setTimeout(() => setIndex((value) => (value + 1) % count), 6_000)
    return () => clearTimeout(timer)
  }, [blocked, count, index])

  if (!active) return null

  const shift = (step: number) => setIndex((value) => (value + step + count) % count)
  const start = (event: Pointer<HTMLDivElement>) => {
    if ((event.target as Element).closest("button")) return
    event.preventDefault()
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const finish = (event: Pointer<HTMLDivElement>) => {
    if (drag.current.id !== event.pointerId) return
    const x = event.clientX - drag.current.x
    const y = event.clientY - drag.current.y
    drag.current.id = -1
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (Math.abs(x) < 48 || Math.abs(x) <= Math.abs(y)) return
    shift(x < 0 ? 1 : -1)
  }
  const cancel = (event: Pointer<HTMLDivElement>) => {
    if (drag.current.id !== event.pointerId) return
    drag.current.id = -1
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      className="featured-carousel"
      role="region"
      aria-roledescription="轮播"
      aria-label="下载量最高的技能"
      data-autoplay={blocked ? "paused" : "running"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocus(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocus(false)
      }}
      onKeyDown={(event) => {
        if (count < 2) return
        if (event.key === "ArrowLeft") shift(-1)
        else if (event.key === "ArrowRight") shift(1)
        else if (event.key === "Home") setIndex(0)
        else if (event.key === "End") setIndex(count - 1)
        else return
        event.preventDefault()
      }}
    >
      <div className={`featured-stage ${layout}`} onPointerDown={start} onPointerUp={finish} onPointerCancel={cancel}>
        {count > 2 && (
          <Peek item={props.items[before]!} rank={before} side="previous" select={() => setIndex(before)} />
        )}
        {count > 1 && (
          <button
            className="carousel-button stage-button"
            data-side="previous"
            aria-label="卡片左侧：上一个技能"
            onClick={() => shift(-1)}
          >
            <CaretLeft />
          </button>
        )}
        <article
          key={active.id}
          className="featured-card"
          aria-roledescription="幻灯片"
          aria-label={`第 ${index + 1} 名：${active.name}`}
        >
          <div className="rank-badge" aria-hidden="true">
            <strong>#{rank(index)}</strong>
            <span>下载榜</span>
          </div>
          <div className="feature-content">
            <div className="skill-mark">
              <img src={image(active)} alt="" draggable={false} onError={(event) => repair(event, active)} />
            </div>
            <div className="feature-copy">
              <div className="title-row">
                <h3>{active.name}</h3>
                <RiskBadge risk={active.risk} />
              </div>
              <p>{active.description}</p>
              <div className="meta-row">
                <span>
                  <Package /> r{active.latestRevision}
                </span>
                <span className="download-total">
                  <DownloadSimple /> {compact(active.downloads)}
                </span>
                <span>
                  <Heart /> {compact(active.favorites)}
                </span>
                <span>由 {active.author.displayName} 发布</span>
              </div>
            </div>
            <div className="action-row">
              <button
                className="primary-button"
                onClick={() => props.navigate(`/skills/${encodeURIComponent(active.id)}`)}
              >
                查看技能 <ArrowRight />
              </button>
            </div>
          </div>
          <img
            className="feature-art"
            src={image(active)}
            alt=""
            draggable={false}
            onError={(event) => repair(event, active)}
          />
        </article>
        {count > 1 && (
          <button
            className="carousel-button stage-button"
            data-side="next"
            aria-label="卡片右侧：下一个技能"
            onClick={() => shift(1)}
          >
            <CaretRight />
          </button>
        )}
        {count > 1 && <Peek item={props.items[after]!} rank={after} side="next" select={() => setIndex(after)} />}
      </div>

      {count > 1 && (
        <div className="carousel-controls">
          <button className="carousel-button" aria-label="上一个技能" onClick={() => shift(-1)}>
            <CaretLeft />
          </button>
          <div className="rank-rail" role="group" aria-label="选择下载榜排名">
            {props.items.map((item, value) => (
              <button
                className={value === index ? "active" : ""}
                aria-label={`查看第 ${value + 1} 名：${item.name}`}
                aria-current={value === index ? "true" : undefined}
                key={item.id}
                onClick={() => setIndex(value)}
              >
                {rank(value)}
              </button>
            ))}
          </div>
          <button className="carousel-button" aria-label="下一个技能" onClick={() => shift(1)}>
            <CaretRight />
          </button>
          <button
            className="carousel-button pause-button"
            aria-label={reduced ? "系统已减少动态效果" : paused ? "继续自动轮播" : "暂停自动轮播"}
            aria-pressed={paused}
            disabled={reduced}
            onClick={() => setPaused((value) => !value)}
          >
            {paused || reduced ? <Play /> : <Pause />}
          </button>
          <div className="carousel-progress" aria-label={`第 ${index + 1} 张，共 ${count} 张`}>
            <progress max={count} value={index + 1} />
            <span>
              {index + 1} / {count}
            </span>
          </div>
        </div>
      )}
      <p className="sr-only" aria-live={blocked ? "polite" : "off"}>
        当前为第 {index + 1} 名，{active.name}
      </p>
    </div>
  )
}

function Peek(props: { item: SkillSummary; rank: number; side: "previous" | "next"; select(): void }) {
  return (
    <button
      className="peek-card"
      data-side={props.side}
      aria-label={`切换到第 ${props.rank + 1} 名：${props.item.name}`}
      onClick={props.select}
    >
      {props.side === "next" && (
        <>
          <span className="peek-rank">
            <strong>#{rank(props.rank)}</strong>
            <small>下载榜</small>
          </span>
          <img src={image(props.item)} alt="" draggable={false} onError={(event) => repair(event, props.item)} />
        </>
      )}
    </button>
  )
}

function rank(value: number) {
  return String(value + 1).padStart(2, "0")
}

function Directory(props: { url: URL; navigate(path: string): void }) {
  const q = props.url.searchParams.get("q") ?? ""
  const category = props.url.searchParams.get("category") ?? ""
  const cursor = props.url.searchParams.get("cursor") ?? ""
  const [filters, setFilters] = useState(Boolean(category))
  const [sort, setSort] = useState(props.url.searchParams.get("sort") ?? "updated")
  const params = query(props.url, sort)
  const catalog = useApi<Catalog>(`/api/v1/skills?${params}`)
  const categories = useApi<Category[]>("/api/v1/categories")

  useEffect(() => {
    if (!category && sort === "updated") return
    track("market_filter", { context: { category: category || "all", sort } })
  }, [category, sort])

  const updateSort = (value: string) => {
    setSort(value)
    const next = new URLSearchParams(props.url.searchParams)
    next.set("sort", value)
    props.navigate(`/skills?${next}`)
  }
  const page = (next: string) => {
    const query = new URLSearchParams(props.url.searchParams)
    if (next) query.set("cursor", next)
    else query.delete("cursor")
    props.navigate(`/skills?${query}`)
  }

  return (
    <section className="page-width directory-page">
      <div className="page-heading">
        <span className="eyebrow">可信目录</span>
        <h1>探索工程技能</h1>
        <p>按领域、作者或关键词找到经过校验的可复用能力。</p>
      </div>
      <div className="directory-tools">
        <Search navigate={props.navigate} initial={q} />
        <button
          className={`filter-button ${filters ? "active" : ""}`}
          onClick={() => setFilters((value) => !value)}
          aria-expanded={filters}
        >
          <FunnelSimple /> 筛选
        </button>
        <label className="sort-control">
          排序
          <select value={sort} onChange={(event) => updateSort(event.target.value)}>
            <option value="updated">最近更新</option>
            <option value="downloads">下载最多</option>
            <option value="favorites">收藏最多</option>
            <option value="name">名称</option>
          </select>
        </label>
      </div>
      {filters && (
        <div className="filter-panel">
          <span>分类</span>
          <button className={!category ? "selected" : ""} onClick={() => props.navigate("/skills")}>
            全部
          </button>
          {(categories.data ?? []).map((item) => (
            <button
              className={category === item.id ? "selected" : ""}
              key={item.id}
              onClick={() => props.navigate(`/skills?category=${encodeURIComponent(item.id)}`)}
            >
              {label(item.name)} <small>{item.count}</small>
            </button>
          ))}
        </div>
      )}
      <div className="result-heading">
        <strong>{catalog.data?.items.length ?? 0} 个结果</strong>
        {q && <span>关键词“{q}”</span>}
      </div>
      {catalog.loading && <Skeleton label="正在搜索技能" />}
      {catalog.error && <InlineError message={catalog.error} />}
      <div className="skill-grid">
        {(catalog.data?.items ?? []).map((item) => (
          <SkillCard key={item.id} item={item} navigate={props.navigate} />
        ))}
      </div>
      {(cursor || catalog.data?.nextCursor) && (
        <nav className="pagination" aria-label="目录分页">
          <button
            className="secondary-button"
            disabled={!cursor}
            onClick={() => {
              page(previous(cursor))
            }}
          >
            上一页
          </button>
          <span>第 {Math.floor(Number(cursor || 0) / 24) + 1} 页</span>
          <button
            className="secondary-button"
            disabled={!catalog.data?.nextCursor}
            onClick={() => page(catalog.data?.nextCursor ?? "")}
          >
            下一页
          </button>
        </nav>
      )}
      {!catalog.loading && !catalog.error && catalog.data?.items.length === 0 && (
        <Empty title="没有找到匹配技能" body="试试更短的关键词，或清除分类筛选。" />
      )}
    </section>
  )
}

function SkillCard(props: { item: SkillSummary; navigate(path: string): void }) {
  return (
    <button className="skill-card" onClick={() => props.navigate(`/skills/${encodeURIComponent(props.item.id)}`)}>
      <span className="card-top">
        <img src={image(props.item)} alt="" onError={(event) => repair(event, props.item)} />
        <RiskBadge risk={props.item.risk} />
      </span>
      <span className="card-copy">
        <strong>{props.item.name}</strong>
        <small>{props.item.description}</small>
      </span>
      <span className="tag-row">
        {props.item.tags.slice(0, 3).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </span>
      <span className="card-footer">
        <span>
          <DownloadSimple /> {compact(props.item.downloads)}
        </span>
        <span>r{props.item.latestRevision}</span>
        <ArrowRight />
      </span>
    </button>
  )
}

function Footer(props: { navigate(path: string): void }) {
  return (
    <footer className="footer">
      <div className="page-width">
        <span>
          <img src={icon} alt="" /> ChipMate Market
        </span>
        <nav>
          <button onClick={() => props.navigate("/skills")}>技能目录</button>
          <button onClick={() => props.navigate("/status")}>服务状态</button>
        </nav>
        <small>可信技能，清晰证据，稳定交付。</small>
      </div>
    </footer>
  )
}

function Empty(props: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <MagnifyingGlass />
      <strong>{props.title}</strong>
      <span>{props.body}</span>
    </div>
  )
}

function categoryIcon(index: number) {
  const icons = [<BookOpenText key="docs" />, <Code key="code" />, <Wrench key="tools" />, <ShieldCheck key="safe" />]
  return icons[index % icons.length]
}

function label(value: string) {
  return (
    (
      { documents: "文档与知识", development: "代码生成", testing: "测试与质量", operations: "运维与工具" } as Record<
        string,
        string
      >
    )[value] ?? value
  )
}

function collectVitals() {
  window.__marketVitals = { cls: 0, inp: 0, lcp: 0 }
  document.documentElement.dataset.cls = "0"
  document.documentElement.dataset.inp = "0"
  document.documentElement.dataset.lcp = "0"
  if (!("PerformanceObserver" in window)) return
  type Entry = PerformanceEntry & {
    duration?: number
    hadRecentInput?: boolean
    interactionId?: number
    startTime: number
    value?: number
  }
  const observe = (type: string, read: (entry: Entry) => void) => {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => read(entry as Entry)))
    try {
      observer.observe({ type, buffered: true })
    } catch (err) {
      console.warn(`[chipmate-market] ${type} metric unavailable`, err)
    }
  }
  observe("largest-contentful-paint", (entry) => {
    window.__marketVitals.lcp = Math.max(window.__marketVitals.lcp, entry.startTime)
    document.documentElement.dataset.lcp = window.__marketVitals.lcp.toFixed(2)
  })
  observe("layout-shift", (entry) => {
    if (!entry.hadRecentInput) window.__marketVitals.cls += entry.value ?? 0
    document.documentElement.dataset.cls = window.__marketVitals.cls.toFixed(4)
  })
  observe("event", (entry) => {
    if ((entry.interactionId ?? 0) > 0)
      window.__marketVitals.inp = Math.max(window.__marketVitals.inp, entry.duration ?? 0)
    document.documentElement.dataset.inp = window.__marketVitals.inp.toFixed(2)
  })
}

const root = document.getElementById("root")
if (!root) throw new Error("root element is missing")

window.__marketRoot ??= createRoot(root)
window.__marketRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
