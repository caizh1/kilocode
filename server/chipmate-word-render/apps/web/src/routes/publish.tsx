import { ArrowClockwise, CheckCircle, FileArrowUp, MagicWand, ShieldWarning } from "@phosphor-icons/react"
import type { MarketUser, PublicationRun } from "@chipmate/market-contracts"
import { useState, type FormEvent } from "react"
import { InlineError } from "../shared"
import { track } from "../analytics"
import { uuid } from "../id"

export function PublishPage(props: { user: MarketUser | undefined; csrf: string; requestLogin(): void }) {
  const [file, setFile] = useState<File>()
  const [run, setRun] = useState<PublicationRun>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const publish = async (event: FormEvent) => {
    event.preventDefault()
    if (!props.user) return props.requestLogin()
    if (!file) return
    setBusy(true)
    setError("")
    track("publication_start", { context: { source: "web" } })
    try {
      const response = await fetch("/api/v1/publications", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/gzip",
          "idempotency-key": uuid(),
          "x-csrf-token": props.csrf,
        },
        body: file,
      })
      const payload = (await response.json()) as PublicationRun & { message?: string }
      if (!response.ok) throw new Error(payload.message ?? `发布失败（HTTP ${response.status}）`)
      setRun(payload)
      track("publication_success", {
        ...(payload.skillId ? { skillId: payload.skillId } : {}),
        ...(payload.release ? { revision: payload.release.revision } : {}),
        context: { status: payload.status },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      track("publication_validation_failed", { context: { reason: "request-failed" } })
    } finally {
      setBusy(false)
    }
  }

  const refresh = async () => {
    if (!run) return
    setBusy(true)
    try {
      const response = await fetch(`/api/v1/publications/${encodeURIComponent(run.id)}`, { credentials: "same-origin" })
      if (!response.ok) throw new Error(`刷新失败（HTTP ${response.status}）`)
      setRun((await response.json()) as PublicationRun)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const repair = () => {
    if (!run) return
    track("publication_ai_repair", {
      ...(run.skillId ? { skillId: run.skillId } : {}),
      context: { action: "open-kilo" },
    })
    const url = new URL("vscode://chipmate.chipmate/marketplace/repair")
    url.searchParams.set("origin", location.origin)
    url.searchParams.set("runId", run.id)
    location.href = url.toString()
  }

  return (
    <section className="page-width publish-page">
      <div className="page-heading">
        <span className="eyebrow">统一发布流水线</span>
        <h1>校验并发布 Skill</h1>
        <p>Web 与 ChipMate 使用同一份服务端校验报告；自动修复只作用于上传快照。</p>
      </div>
      <div className="publish-grid">
        <form className="glass-panel publish-form" onSubmit={(event) => void publish(event)}>
          <span className="publish-icon">
            <FileArrowUp />
          </span>
          <div>
            <h2>选择 Skill 归档</h2>
            <p>支持单个 `.tar.gz`，压缩前请确认根目录内包含 SKILL.md。</p>
          </div>
          <label>
            Skill 归档
            <input
              type="file"
              accept=".tar.gz,application/gzip"
              onChange={(event) => setFile(event.target.files?.[0])}
              required
            />
          </label>
          {!props.user && (
            <button type="button" className="secondary-button" onClick={props.requestLogin}>
              先登录市场身份
            </button>
          )}
          <button className="primary-button" disabled={busy || !file}>
            {busy ? "正在执行权威校验…" : "校验并发布"}
          </button>
          <small>不会执行归档内 scripts/，不会保存 New API key，也不会修改你的本地目录。</small>
        </form>
        <section className="glass-panel publication-result" aria-live="polite">
          <div className="panel-heading">
            <CheckCircle />
            <h2>发布结果</h2>
          </div>
          {!run && !error && <p>提交后会在这里显示状态、revision、SHA-256 和逐项 ValidationReport。</p>}
          {error && <InlineError message={error} />}
          {run && (
            <>
              <div className={`publication-status status-${run.status.toLocaleLowerCase()}`}>
                <strong>{run.status}</strong>
                <span>{run.stage}</span>
              </div>
              {run.release && (
                <p>
                  已生成不可变 revision <strong>r{run.release.revision}</strong>，SHA {run.release.sha256.slice(0, 16)}…
                </p>
              )}
              {run.report?.changed && (
                <p>
                  <MagicWand /> 确定性修复仅应用到上传快照：已执行{" "}
                  {run.patches.filter((patch) => patch.kind === "deterministic").flatMap((patch) => patch.files).length}{" "}
                  项；本地文件未改变。
                </p>
              )}
              <div className="issue-list">
                {(run.report?.issues ?? []).map((issue) => (
                  <article key={`${issue.code}-${issue.file ?? ""}`}>
                    <ShieldWarning />
                    <span>
                      <strong>{issue.code}</strong>
                      <small>{issue.file ?? issue.field ?? "归档"}</small>
                      <p>{issue.message}</p>
                    </span>
                  </article>
                ))}
              </div>
              {run.status === "NEEDS_AI_CONFIRMATION" && (
                <aside className="manual-repair" role="note">
                  <strong>无法使用 Kilo 时的手工修复</strong>
                  <ol>
                    <li>在本地副本中打开报告标明的文件，不要修改服务端上传快照。</li>
                    <li>按 issue code 和说明补足语义内容，并保留已规范化的 frontmatter。</li>
                    <li>
                      重新打包根目录含 SKILL.md 的 `.tar.gz`，回到本页再次提交；服务端会重新执行全部格式与安全校验。
                    </li>
                  </ol>
                </aside>
              )}
              <div className="action-row">
                <button className="secondary-button" disabled={busy} onClick={() => void refresh()}>
                  <ArrowClockwise /> 刷新状态
                </button>
                {run.status === "NEEDS_AI_CONFIRMATION" && (
                  <button className="primary-button" onClick={repair}>
                    <MagicWand /> 在 ChipMate 中使用 AI 修复
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  )
}
