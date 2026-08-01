import {
  ArrowClockwiseIcon as ArrowClockwise,
  BugIcon as Bug,
  CheckCircleIcon as CheckCircle,
  ClockCountdownIcon as ClockCountdown,
  CodeIcon as Code,
  CopyIcon as Copy,
  LockKeyIcon as LockKey,
  PaperPlaneTiltIcon as PaperPlaneTilt,
  PlayIcon as Play,
  PlusIcon as Plus,
  ShieldCheckIcon as ShieldCheck,
  SignOutIcon as SignOut,
  SparkleIcon as Sparkle,
  TicketIcon as Ticket,
  UserPlusIcon as UserPlus,
  WarningCircleIcon as WarningCircle,
  XCircleIcon as XCircle,
} from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { createRoot } from "react-dom/client"
import { runProgress, runStageLabels, type RunnerMode } from "./run-progress"
import "./styles.css"

type Role = "reporter" | "maintainer" | "admin"
type Severity = "low" | "medium" | "high" | "critical"

interface Auth {
  user: {
    id: number
    username: string
    role: Role
  }
  csrf: string
}

interface InviteView {
  id: number
  codePrefix: string
  maxUses: number
  usedCount: number
  createdAt: string
  exhaustedAt: string | null
  code?: string
}

interface RunnerState {
  online: boolean
  mode: RunnerMode
  workers: number
  queued: number
  connectedAt: string | null
}

interface BugRow {
  id: number
  title: string
  description: string
  reproduction: string
  expected: string
  actual: string
  environment: string
  component: string
  severity: Severity
  status: string
  reporter: string
  created_at: string
  updated_at: string
}

interface Artifact {
  id: number
  version: string
  platform: string
  name: string
  size: number
  sha256: string
  url: string
}

interface Run {
  id: number
  bug_id: number
  stage: string
  requires_approval: number
  attempts: number
  summary: string | null
  error: string | null
  token_count: number
  created_at: string
  updated_at: string
  artifacts: Artifact[]
  logs: RunLog[]
}

interface RunLog {
  id: number
  stage: string
  kind: "system" | "codex" | "command" | "test" | "review" | "package" | "qa" | "publish"
  level: "info" | "success" | "warning" | "error"
  message: string
  summary: string | null
  detail: string | null
  created_at: string
}

interface Detail {
  bug: BugRow
  runs: Run[]
}

interface Draft {
  title: string
  description: string
  reproduction: string
  expected: string
  actual: string
  environment: string
  component: string
  severity: Severity
}

const empty: Draft = {
  title: "",
  description: "",
  reproduction: "",
  expected: "",
  actual: "",
  environment: "",
  component: "",
  severity: "medium",
}

const labels: Record<string, string> = {
  triage: "待分诊",
  queued: "已排队",
  diagnosing: "诊断中",
  fixing: "修复中",
  testing: "测试中",
  reviewing: "审查中",
  approval_wait: "等待审批",
  packaging: "打包中",
  validating: "验收中",
  publishing: "发布中",
  released: "已发布",
  failed: "失败",
  cancelled: "已取消",
  revoked: "已撤回",
}

function endpoint(path: string) {
  return new URL(`api/${path}`, document.baseURI)
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(endpoint(path), {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `请求失败（${response.status}）`)
  return body
}

function format(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

function duration(start: string, end: number) {
  const seconds = Math.max(0, Math.round((end - new Date(start).getTime()) / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

function StatusIcon({ status }: { status: string }) {
  if (status === "released") return <CheckCircle weight="duotone" />
  if (["failed", "cancelled", "revoked"].includes(status)) return <XCircle weight="duotone" />
  if (status === "approval_wait") return <ShieldCheck weight="duotone" />
  if (status === "triage") return <WarningCircle weight="duotone" />
  return <ClockCountdown weight="duotone" />
}

function Status({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      <StatusIcon status={status} />
      {labels[status] ?? status}
    </span>
  )
}

function Authentication({ onAuthenticated }: { onAuthenticated: (auth: Auth) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [invite, setInvite] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mode === "register" && password !== confirmation) {
      setError("两次输入的密码不一致")
      return
    }
    setBusy(true)
    setError("")
    try {
      onAuthenticated(await request<Auth>(mode === "login" ? "auth/login" : "auth/register", {
        method: "POST",
        body: JSON.stringify(mode === "login"
          ? { username, password }
          : { username, password, inviteCode: invite }),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "login" ? "登录失败" : "注册失败")
    } finally {
      setBusy(false)
    }
  }

  function selectMode(next: "login" | "register") {
    setMode(next)
    setError("")
    setPassword("")
    setConfirmation("")
  }

  return (
    <main className="login-shell">
      <section className="login-card glass">
        <div className="brand-mark">
          <Bug weight="duotone" />
        </div>
        <div className="eyebrow"><Sparkle weight="fill" /> 自动修复中心</div>
        <h1>ChipMate Bug 管理</h1>
        <p>{mode === "login"
          ? "提交问题、跟踪 Codex 修复、完成验收并生成新版本。"
          : "使用团队邀请码创建报告者账号，每个邀请码最多邀请 3 人。"}</p>
        <div className="auth-switch" role="tablist" aria-label="账号入口">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => selectMode("login")}
          >
            <LockKey weight="duotone" />登录
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => selectMode("register")}
          >
            <UserPlus weight="duotone" />邀请码注册
          </button>
        </div>
        <form onSubmit={submit}>
          <label>
            用户名
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              minLength={mode === "register" ? 3 : undefined}
              maxLength={mode === "register" ? 32 : 80}
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "register" ? 12 : undefined}
              required
            />
          </label>
          {mode === "register" && (
            <>
              <label>
                确认密码
                <input
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
              <label>
                邀请码
                <input
                  value={invite}
                  onChange={(event) => setInvite(event.target.value)}
                  autoComplete="off"
                  placeholder="CM-…"
                  required
                />
              </label>
            </>
          )}
          {error && <div className="notice error"><WarningCircle weight="duotone" />{error}</div>}
          <button className="primary wide" disabled={busy}>
            {mode === "login" ? <LockKey weight="duotone" /> : <UserPlus weight="duotone" />}
            {busy
              ? mode === "login" ? "正在登录…" : "正在创建账号…"
              : mode === "login" ? "安全登录" : "创建并登录"}
          </button>
        </form>
      </section>
    </main>
  )
}

function InvitePanel({ csrf }: { csrf: string }) {
  const [invite, setInvite] = useState<InviteView | null>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    request<{ invite: InviteView | null }>("invites/mine")
      .then((body) => setInvite(body.invite))
      .catch((err) => setError(err instanceof Error ? err.message : "邀请码状态加载失败"))
  }, [])

  async function create() {
    setBusy(true)
    setError("")
    try {
      const body = await request<{ invite: InviteView }>("invites", {
        method: "POST",
        headers: { "x-csrf-token": csrf },
        body: "{}",
      })
      setInvite(body.invite)
    } catch (err) {
      setError(err instanceof Error ? err.message : "邀请码生成失败")
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!invite?.code) return
    try {
      await navigator.clipboard.writeText(invite.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError("浏览器未允许复制，请手动选择邀请码")
    }
  }

  return (
    <section className="invite-panel glass">
      <div className="section-heading">
        <span className="icon-well"><Ticket weight="duotone" /></span>
        <div>
          <h2>邀请团队成员</h2>
          <p>每个账号只能生成 1 个邀请码，最多成功注册 3 人。</p>
        </div>
      </div>
      {invite === undefined && <span className="invite-loading">正在读取邀请码状态…</span>}
      {invite === null && (
        <button className="primary" disabled={busy} onClick={() => void create()}>
          <UserPlus weight="duotone" />{busy ? "正在生成…" : "生成我的邀请码"}
        </button>
      )}
      {invite && (
        <div className="invite-content">
          <div className="invite-code">
            <span>{invite.code ? "邀请码（仅本次显示）" : "邀请码已安全生成"}</span>
            <code>{invite.code ?? `${invite.codePrefix}••••••••••••••••••••`}</code>
          </div>
          {invite.code && (
            <button className="copy-button" onClick={() => void copy()}>
              {copied ? <CheckCircle weight="duotone" /> : <Copy weight="duotone" />}
              {copied ? "已复制" : "复制邀请码"}
            </button>
          )}
          <div className="invite-usage">
            <strong>{invite.usedCount} / {invite.maxUses}</strong>
            <span>{invite.exhaustedAt ? "名额已用完，邀请码已失效" : `还可邀请 ${invite.maxUses - invite.usedCount} 人`}</span>
          </div>
        </div>
      )}
      {error && <div className="notice error"><WarningCircle weight="duotone" />{error}</div>}
    </section>
  )
}

function RunnerBanner({ state }: { state?: RunnerState }) {
  const mode = state?.mode
  const tone = !state?.online ? "offline" : mode === "monitor" ? "monitor" : "online"
  const title = !state
    ? "正在检查自动执行器"
    : !state.online
      ? "自动执行器离线"
      : mode === "monitor"
        ? "自动执行器在线 · 监控模式"
        : mode === "shadow"
          ? "自动执行器在线 · 影子修复"
          : "自动执行器在线 · 正式发布"
  const description = !state
    ? "正在同步执行器连接状态。"
    : !state.online
      ? `当前有 ${state.queued} 个任务等待领取；执行器连接前不会开始修复。`
      : mode === "monitor"
        ? `连接正常，但不会领取 ${state.queued} 个排队任务；切换到影子模式后才会开始诊断。`
        : mode === "shadow"
          ? "会自动领取、诊断、修复、测试和审查，但禁止打包发布。"
          : "会自动执行完整修复、双平台验收和受保护发布流程。"
  return (
    <section className={`runner-banner glass runner-${tone}`} aria-live="polite">
      <span className="runner-symbol">
        {state?.online ? <CheckCircle weight="duotone" /> : <WarningCircle weight="duotone" />}
      </span>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <span className="runner-count">{state?.workers ?? 0} 个执行器</span>
    </section>
  )
}

function CreateBug({
  csrf,
  onCreated,
}: {
  csrf: string
  onCreated: (bug: BugRow) => void
}) {
  const [draft, setDraft] = useState(empty)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const body = await request<{ bug: BugRow }>("bugs", {
        method: "POST",
        headers: { "x-csrf-token": csrf },
        body: JSON.stringify(draft),
      })
      setDraft(empty)
      onCreated(body.bug)
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="composer glass">
      <div className="section-heading">
        <span className="icon-well"><Plus weight="bold" /></span>
        <div>
          <h2>提交新 Bug</h2>
          <p>信息越完整，自动修复成功率越高。</p>
        </div>
      </div>
      <form onSubmit={submit} className="bug-form">
        <label className="span-2">
          标题
          <input value={draft.title} onChange={(event) => field("title", event.target.value)} required maxLength={160} />
        </label>
        <label>
          模块
          <input
            value={draft.component}
            onChange={(event) => field("component", event.target.value)}
            placeholder="例如：RAG、更新、Agent Manager"
            required
          />
        </label>
        <label>
          严重度
          <select value={draft.severity} onChange={(event) => field("severity", event.target.value as Severity)}>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="critical">严重</option>
          </select>
        </label>
        <label className="span-2">
          问题描述
          <textarea value={draft.description} onChange={(event) => field("description", event.target.value)} required />
        </label>
        <label className="span-2">
          复现步骤
          <textarea value={draft.reproduction} onChange={(event) => field("reproduction", event.target.value)} required />
        </label>
        <label>
          预期结果
          <textarea value={draft.expected} onChange={(event) => field("expected", event.target.value)} required />
        </label>
        <label>
          实际结果
          <textarea value={draft.actual} onChange={(event) => field("actual", event.target.value)} required />
        </label>
        <label className="span-2">
          环境
          <textarea
            value={draft.environment}
            onChange={(event) => field("environment", event.target.value)}
            placeholder="系统、VS Code 版本、插件版本、工作模式"
            required
          />
        </label>
        {error && <div className="notice error span-2"><WarningCircle weight="duotone" />{error}</div>}
        <div className="form-actions span-2">
          <button className="primary" disabled={busy}>
            <PaperPlaneTilt weight="duotone" />
            {busy ? "正在提交并排队…" : "提交并自动修复"}
          </button>
        </div>
      </form>
    </section>
  )
}

function BugDetail({
  detail,
  role,
  csrf,
  runnerMode,
  onRefresh,
}: {
  detail: Detail
  role: Role
  csrf: string
  runnerMode: RunnerMode
  onRefresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [clock, setClock] = useState(Date.now())
  const run = detail.runs[0]
  const canTrigger = role !== "reporter" && (!run || ["released", "failed", "cancelled", "revoked"].includes(run.stage))

  useEffect(() => {
    if (!run || ["released", "failed", "cancelled", "revoked"].includes(run.stage)) return
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [run?.id, run?.stage])

  async function action(path: string) {
    setBusy(true)
    setError("")
    try {
      await request(path, { method: "POST", headers: { "x-csrf-token": csrf }, body: "{}" })
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  function elapsed(run: Run) {
    const terminal = ["released", "failed", "cancelled", "revoked"].includes(run.stage)
    const end = terminal ? new Date(run.updated_at).getTime() : Date.now()
    const start = run.logs[0]?.created_at ?? run.created_at
    return duration(start, terminal ? end : clock)
  }

  return (
    <section className="detail glass">
      <div className="detail-head">
        <div>
          <div className="eyebrow">BUG #{detail.bug.id} · {detail.bug.component}</div>
          <h2>{detail.bug.title}</h2>
        </div>
        <Status status={detail.bug.status} />
      </div>
      <div className="detail-grid">
        <article><h3>问题描述</h3><p>{detail.bug.description}</p></article>
        <article><h3>复现步骤</h3><p>{detail.bug.reproduction}</p></article>
        <article><h3>预期结果</h3><p>{detail.bug.expected}</p></article>
        <article><h3>实际结果</h3><p>{detail.bug.actual}</p></article>
        <article className="span-2"><h3>运行环境</h3><p>{detail.bug.environment}</p></article>
      </div>
      {run && (
        <div className="run-card">
          <div className="run-head">
            <div className="icon-well"><Code weight="duotone" /></div>
            <div>
              <strong>自动修复任务 #{run.id}</strong>
              <span>{run.attempts} 次领取 · {run.token_count.toLocaleString()} Token</span>
            </div>
            <Status status={run.stage} />
          </div>
          <RunProgress run={run} mode={runnerMode} elapsed={elapsed(run)} />
          <RunActivity run={run} />
          {run.error && <div className="notice error"><WarningCircle weight="duotone" />{run.error}</div>}
          {run.artifacts.length > 0 && (
            <div className="artifacts">
              {run.artifacts.map((artifact) => (
                <a href={artifact.url} key={artifact.id}>
                  <Code weight="duotone" />
                  <span>{artifact.platform}<small>{artifact.name}</small></span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <div className="notice error"><WarningCircle weight="duotone" />{error}</div>}
      <div className="detail-actions">
        {canTrigger && (
          <button className="primary" disabled={busy} onClick={() => void action(`bugs/${detail.bug.id}/trigger`)}>
            <Play weight="duotone" />重新启动自动修复
          </button>
        )}
        {role === "admin" && run?.stage === "approval_wait" && (
          <button className="primary" disabled={busy} onClick={() => void action(`runs/${run.id}/approve`)}>
            <ShieldCheck weight="duotone" />批准打包
          </button>
        )}
        {role !== "reporter" && run && !["released", "failed", "cancelled", "revoked"].includes(run.stage) && (
          <button className="danger" disabled={busy} onClick={() => void action(`runs/${run.id}/cancel`)}>
            <XCircle weight="duotone" />取消任务
          </button>
        )}
      </div>
    </section>
  )
}

function LogIcon({ level }: { level: RunLog["level"] }) {
  if (level === "success") return <CheckCircle weight="duotone" />
  if (level === "warning" || level === "error") return <WarningCircle weight="duotone" />
  return <ClockCountdown weight="duotone" />
}

function RunActivity({ run }: { run: Run }) {
  const stream = useRef<HTMLDivElement>(null)
  const summary = [...run.logs].reverse().find((log) => log.summary)?.summary
  const active = !["released", "failed", "cancelled", "revoked", "approval_wait"].includes(run.stage)

  useEffect(() => {
    const element = stream.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" })
  }, [run.logs.at(-1)?.id])

  return (
    <section className="run-activity" aria-label="实时执行信息">
      <div className={`current-step ${active ? "current-step-live" : "current-step-stopped"}`}>
        <span className="live-indicator" aria-hidden="true" />
        <div>
          <span>当前步骤</span>
          <strong>{labels[run.stage] ?? run.stage}</strong>
          <p>{run.summary ?? "等待执行器回传当前工作内容。"}</p>
        </div>
      </div>
      <div className="codex-summary">
        <div className="activity-title">
          <Sparkle weight="duotone" />
          <span>Codex 输出摘要</span>
        </div>
        <p>{summary ?? "Codex 开始分析后，这里会显示经过脱敏和限长的最新摘要。"}</p>
      </div>
      <div className="activity-title">
        <Code weight="duotone" />
        <span>Codex 实时执行流</span>
        <small>命令与输出已脱敏 · 最多 500 条</small>
      </div>
      <div className="run-log-stream" ref={stream} aria-live="polite" aria-relevant="additions">
        {run.logs.map((log) => (
          <div className={`run-log run-log-${log.level}`} key={log.id}>
            <div className="run-log-heading">
              <span className="run-log-icon"><LogIcon level={log.level} /></span>
              <span className="run-log-copy">
                <strong>{log.message}</strong>
                <small>
                  {runStageLabels[log.stage as keyof typeof runStageLabels] ?? labels[log.stage] ?? log.stage}
                  <span aria-hidden="true"> · </span>
                  {log.kind === "codex" ? "Codex" : log.kind === "command" ? "命令" : log.kind}
                </small>
              </span>
              <time dateTime={log.created_at}>{formatTime(log.created_at)}</time>
            </div>
            {(log.detail || log.summary) && (
              <details className="run-log-detail">
                <summary>{log.detail ? "查看命令与输出" : "查看 Codex 输出"}</summary>
                <pre>{log.detail ?? log.summary}</pre>
              </details>
            )}
          </div>
        ))}
        {run.logs.length === 0 && (
          <div className="run-log-empty">
            <ClockCountdown weight="duotone" />
            <span>等待执行器发送第一条日志</span>
          </div>
        )}
      </div>
    </section>
  )
}

function RunProgress({ run, mode, elapsed }: { run: Run; mode: RunnerMode; elapsed: string }) {
  const progress = runProgress(run.stage, mode)
  const stageText = progress.terminal
    ? progress.label
    : `阶段 ${progress.activeIndex + 1}/${progress.stages.length}`
  return (
    <div className={`run-progress ${progress.terminal ? "run-progress-terminal" : ""}`}>
      <div className="run-progress-heading">
        <div>
          <span>自动修复进度</span>
          <strong>{progress.label}</strong>
        </div>
        <span>{stageText}</span>
      </div>
      <div
        className="run-progress-track"
        role="progressbar"
        aria-label="自动修复进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percentage}
        aria-valuetext={progress.label}
      >
        <span className="run-progress-fill" style={{ width: `${progress.percentage}%` }} />
      </div>
      <div
        className="run-progress-stages"
        style={{ gridTemplateColumns: `repeat(${progress.stages.length}, minmax(62px, 1fr))` }}
      >
        {progress.stages.map((stage, index) => (
          <span
            className={[
              "run-progress-stage",
              !progress.terminal && index <= progress.activeIndex ? "done" : "",
              !progress.terminal && index === progress.activeIndex ? "current" : "",
            ].filter(Boolean).join(" ")}
            key={stage}
          >
            <span className="run-progress-dot" />
            <small>{runStageLabels[stage]}</small>
          </span>
        ))}
      </div>
      <div className="run-progress-meta">
        <span>{run.stage === "queued" ? "已等待" : "已运行"} {elapsed}</span>
        <span>实时同步 · 30 秒轮询兜底</span>
      </div>
    </div>
  )
}

function Dashboard({ auth, onLogout }: { auth: Auth; onLogout: () => void }) {
  const [bugs, setBugs] = useState<BugRow[]>([])
  const [selected, setSelected] = useState<number>()
  const [detail, setDetail] = useState<Detail>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [runner, setRunner] = useState<RunnerState>()

  const active = useMemo(() => bugs.filter((bug) => !["released", "cancelled", "revoked"].includes(bug.status)).length, [bugs])

  async function refresh(id?: number) {
    setError("")
    try {
      const list = await request<{ bugs: BugRow[] }>("bugs")
      setBugs(list.bugs)
      const target = id ?? selected
      if (target) setDetail(await request<Detail>(`bugs/${target}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [selected])

  useEffect(() => {
    const source = new EventSource(endpoint("events"))
    let timer: number | undefined
    const sync = (event: Event) => {
      const message = event as MessageEvent<string>
      try {
        const data = JSON.parse(message.data) as { bugId?: number }
        if (selected && data.bugId && data.bugId !== selected) return
      } catch {
        // 无法解析的事件仍通过下一次合并刷新恢复一致状态。
      }
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => void refresh(selected), 250)
    }
    for (const type of ["run.updated", "run.log"]) source.addEventListener(type, sync)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      source.close()
    }
  }, [selected])

  useEffect(() => {
    const sync = () => {
      void request<RunnerState>("runner/status").then(setRunner).catch(() => setRunner(undefined))
    }
    sync()
    const timer = window.setInterval(sync, 10_000)
    return () => window.clearInterval(timer)
  }, [])

  async function choose(id: number) {
    setSelected(id)
    setDetail(await request<Detail>(`bugs/${id}`))
  }

  async function logout() {
    await request("auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": auth.csrf },
      body: "{}",
    })
    onLogout()
  }

  return (
    <main className="app-shell">
      <header className="topbar glass">
        <div className="brand">
          <span className="brand-mark small"><Bug weight="duotone" /></span>
          <div><strong>ChipMate</strong><span>Bug 自动修复中心</span></div>
        </div>
        <div className="toolbar">
          <div className="user-chip"><ShieldCheck weight="duotone" /><span>{auth.user.username}<small>{auth.user.role}</small></span></div>
          <button className="icon-button" aria-label="刷新" onClick={() => void refresh()}><ArrowClockwise weight="bold" /></button>
          <button className="icon-button" aria-label="退出" onClick={() => void logout()}><SignOut weight="bold" /></button>
        </div>
      </header>

      <section className="metrics">
        <article className="glass metric"><Bug weight="duotone" /><span><strong>{bugs.length}</strong>全部 Bug</span></article>
        <article className="glass metric"><ClockCountdown weight="duotone" /><span><strong>{active}</strong>处理中</span></article>
        <article className="glass metric"><CheckCircle weight="duotone" /><span><strong>{bugs.length - active}</strong>已闭环</span></article>
      </section>

      {error && <div className="notice error"><WarningCircle weight="duotone" />{error}</div>}

      <RunnerBanner state={runner} />

      <InvitePanel csrf={auth.csrf} />

      <section className="workspace">
        <aside className="bug-list glass">
          <div className="section-heading compact">
            <span className="icon-well"><Bug weight="duotone" /></span>
            <div><h2>问题列表</h2><p>{loading ? "正在同步…" : `${bugs.length} 条记录`}</p></div>
          </div>
          <div className="list-scroll">
            {bugs.map((bug) => (
              <button className={`bug-row ${selected === bug.id ? "selected" : ""}`} key={bug.id} onClick={() => void choose(bug.id)}>
                <span className={`severity severity-${bug.severity}`}></span>
                <span className="bug-copy">
                  <strong>{bug.title}</strong>
                  <small>#{bug.id} · {bug.component} · {format(bug.updated_at)}</small>
                </span>
                <StatusIcon status={bug.status} />
              </button>
            ))}
            {!loading && bugs.length === 0 && <div className="empty"><Sparkle weight="duotone" />还没有 Bug</div>}
          </div>
        </aside>
        <div className="main-column">
          {detail
            ? <BugDetail
                detail={detail}
                role={auth.user.role}
                csrf={auth.csrf}
                runnerMode={runner?.mode ?? null}
                onRefresh={() => refresh(detail.bug.id)}
              />
            : <CreateBug
                csrf={auth.csrf}
                onCreated={(bug) => {
                  setSelected(bug.id)
                  void refresh(bug.id)
                }}
              />}
          {detail && (
            <CreateBug
              csrf={auth.csrf}
              onCreated={(bug) => {
                setSelected(bug.id)
                void refresh(bug.id)
              }}
            />
          )}
        </div>
      </section>
    </main>
  )
}

function App() {
  const [auth, setAuth] = useState<Auth>()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    request<Auth>("auth/me").then(setAuth).catch(() => undefined).finally(() => setReady(true))
  }, [])

  if (!ready) {
    return <main className="loading"><span className="brand-mark"><Bug weight="duotone" /></span><p>正在连接 ChipMate…</p></main>
  }
  if (!auth) return <Authentication onAuthenticated={setAuth} />
  return <Dashboard auth={auth} onLogout={() => setAuth(undefined)} />
}

createRoot(document.getElementById("root")!).render(<App />)
