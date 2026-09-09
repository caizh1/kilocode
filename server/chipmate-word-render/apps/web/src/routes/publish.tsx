import {
  ArrowClockwise,
  CheckCircle,
  FileArrowUp,
  FolderOpen,
  MagicWand,
  Package,
  ShieldWarning,
} from "@phosphor-icons/react"
import type { MarketUser, PublicationRun } from "@chipmate/market-contracts"
import { useRef, useState, type DragEvent, type FormEvent } from "react"
import { bytes, InlineError } from "../shared"
import { track } from "../analytics"
import { uuid } from "../id"
import { dropSkillFolder, packSkillFolder, scanSkillFolder, type SkillFolderScan } from "../skill-folder"

type Input = ({ kind: "archive"; file: File } | { kind: "folder"; scan: SkillFolderScan }) & { key: string }
type Progress = { stage: "packing" | "uploading" | "validating"; label: string; loaded: number; total: number }
type Issue = NonNullable<PublicationRun["report"]>["issues"][number]
type Group = { issue: Issue; files: string[]; count: number }

const labels: Record<PublicationRun["status"], string> = {
  VALIDATING: "正在校验",
  NEEDS_AUTHOR_FIX: "需要修改后重试",
  NEEDS_AI_CONFIRMATION: "需要确认修复",
  SECURITY_REJECTED: "存在严重风险，已阻止发布",
  PUBLISHING: "正在发布",
  PUBLISHED: "发布成功",
  UNPUBLISHED: "已下架",
  UNCHANGED: "内容未变化",
  FAILED: "发布失败",
}

export function PublishPage(props: { user: MarketUser | undefined; csrf: string; requestLogin(): void }) {
  const [input, setInput] = useState<Input>()
  const [run, setRun] = useState<PublicationRun>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState<Progress>()
  const [drag, setDrag] = useState(false)
  const lock = useRef(false)

  const publish = async (event: FormEvent) => {
    event.preventDefault()
    if (!props.user) return props.requestLogin()
    if (!input || done || lock.current) return
    lock.current = true
    setBusy(true)
    setError("")
    track("publication_start", { context: { source: "web" } })
    try {
      const archive =
        input.kind === "archive"
          ? input.file
          : await packSkillFolder(input.scan, (value) =>
              setProgress({ stage: "packing", label: value.path, loaded: value.loaded, total: value.bytes }),
            )
      const result = await upload(archive, input.key, props.csrf, (value) => setProgress(value))
      const payload = result.payload
      if (result.status < 200 || result.status >= 300)
        throw new Error(payload.message ?? `发布失败（HTTP ${result.status}）`)
      setRun(payload)
      setDone(terminal(payload.status))
      track("publication_success", {
        ...(payload.skillId ? { skillId: payload.skillId } : {}),
        ...(payload.release ? { revision: payload.release.revision } : {}),
        context: { status: payload.status },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      track("publication_validation_failed", { context: { reason: "request-failed" } })
    } finally {
      lock.current = false
      setBusy(false)
      setProgress(undefined)
    }
  }

  const folder = (files: Iterable<File>) => {
    setError("")
    setRun(undefined)
    const scan = scanSkillFolder(files)
    setInput({ kind: "folder", scan, key: uuid() })
    setDone(false)
    setProgress(undefined)
  }

  const drop = async (event: DragEvent) => {
    event.preventDefault()
    setDrag(false)
    try {
      folder(await dropSkillFolder(event.dataTransfer))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
      context: { action: "open-chipmate" },
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
        <form
          className={`glass-panel publish-form ${drag ? "dragging" : ""}`}
          onSubmit={(event) => void publish(event)}
          onDragOver={(event) => {
            event.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(event) => void drop(event)}
        >
          <span className="publish-icon">
            <FileArrowUp />
          </span>
          <div>
            <h2>选择 Skill 归档或文件夹</h2>
            <p>支持单个 `.tar.gz` 或根目录含 SKILL.md 的文件夹；文件夹只在浏览器本地打包。</p>
          </div>
          <div className="skill-publish-pickers">
            <label className="primary-button">
              <FileArrowUp /> 选择 .tar.gz
              <input
                type="file"
                aria-label="Skill 归档"
                accept=".tar.gz,application/gzip"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    setInput({ kind: "archive", file, key: uuid() })
                    setRun(undefined)
                    setError("")
                    setDone(false)
                    setProgress(undefined)
                  }
                }}
              />
            </label>
            <label className="secondary-button">
              <FolderOpen /> 选择文件夹
              <input
                type="file"
                aria-label="Skill 文件夹"
                multiple
                {...{ webkitdirectory: "" }}
                onChange={(event) => {
                  try {
                    folder(event.target.files ?? [])
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  }
                }}
              />
            </label>
          </div>
          {input && (
            <div className="skill-upload-summary">
              <Package />
              <span>
                <strong>{input.kind === "archive" ? input.file.name : input.scan.root}</strong>
                <small>
                  {input.kind === "archive"
                    ? `${bytes(input.file.size)} · TAR.GZ 归档`
                    : `${input.scan.files.length} 个文件 · ${bytes(input.scan.bytes)} · 本地忽略 ${input.scan.ignored.length} 项`}
                </small>
              </span>
            </div>
          )}
          {progress && (
            <div className="skill-upload-progress" role="status">
              <span>
                <strong>
                  {progress.stage === "packing"
                    ? "正在打包文件夹"
                    : progress.stage === "uploading"
                      ? "正在上传"
                      : "服务端正在校验"}
                </strong>
                <small>{progress.label}</small>
              </span>
              <div>
                <i
                  style={{
                    width: `${progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 100}%`,
                  }}
                />
              </div>
              <b>
                {progress.stage === "validating"
                  ? "校验中"
                  : `${progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0}%`}
              </b>
            </div>
          )}
          {!props.user && (
            <button type="button" className="secondary-button" onClick={props.requestLogin}>
              先登录市场身份
            </button>
          )}
          <button className="primary-button" disabled={busy || !input || done}>
            {busy
              ? "正在执行权威校验…"
              : done && run?.status === "PUBLISHED"
                ? "发布成功"
                : done && run?.status === "UNCHANGED"
                  ? "已发布，无内容变化"
                  : done
                    ? "请重新选择修改后的 Skill"
                    : "校验并发布"}
          </button>
          <small>不会执行归档内 scripts/，不会保存 LDAP 密码，也不会修改你的本地目录。</small>
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
              {run.status === "PUBLISHED" && (
                <div className="publication-success" role="status">
                  <CheckCircle weight="fill" />
                  <span>
                    <strong>发布成功</strong>
                    <p>
                      {run.skillId ?? "Skill"}
                      {run.release ? ` · revision r${run.release.revision} · SHA ${run.release.sha256.slice(0, 16)}…` : ""}
                    </p>
                  </span>
                </div>
              )}
              {run.status === "UNCHANGED" && (
                <div className="publication-duplicate" role="status">
                  <CheckCircle weight="fill" />
                  <span>
                    <strong>内容未变化，已发布过</strong>
                    <p>{run.release ? `继续使用 revision r${run.release.revision}，未创建重复版本。` : "未创建重复版本。"}</p>
                  </span>
                </div>
              )}
              <div className={`publication-status status-${run.status.toLocaleLowerCase()}`}>
                <strong>{labels[run.status]}</strong>
                <span>
                  {run.status === "SECURITY_REJECTED"
                    ? "安全校验"
                    : run.status === "NEEDS_AUTHOR_FIX"
                      ? "格式校验"
                      : "发布流程"}
                </span>
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
              <Report run={run} />
              {run.status === "NEEDS_AI_CONFIRMATION" && (
                <aside className="manual-repair" role="note">
                  <strong>无法使用 ChipMate 时的手工修复</strong>
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

function upload(file: Blob, key: string, csrf: string, progress: (value: Progress) => void) {
  return new Promise<{ status: number; payload: PublicationRun & { message?: string } }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/v1/publications")
    xhr.setRequestHeader("accept", "application/json")
    xhr.setRequestHeader("content-type", "application/gzip")
    xhr.setRequestHeader("idempotency-key", key)
    xhr.setRequestHeader("x-csrf-token", csrf)
    xhr.upload.onprogress = (event) =>
      progress({
        stage: "uploading",
        label: `${bytes(event.loaded)} / ${bytes(event.total || file.size)}`,
        loaded: event.loaded,
        total: event.total || file.size,
      })
    xhr.upload.onload = () =>
      progress({ stage: "validating", label: "上传完成，正在执行权威校验", loaded: file.size, total: file.size })
    xhr.onerror = () => reject(new Error("上传连接中断，请检查网络后重试。"))
    xhr.onload = () => {
      const payload = JSON.parse(xhr.responseText || "{}") as PublicationRun & { message?: string }
      resolve({ status: xhr.status, payload })
    }
    xhr.send(file)
  })
}

function Report(props: { run: PublicationRun }) {
  const issues = props.run.report?.issues ?? []
  const groups = group(issues)
  const errors = groups.filter((item) => item.issue.severity === "error").length
  const warnings = groups.filter((item) => item.issue.severity === "warning").length
  const invalid = failed(props.run.status) && errors === 0
  if (!groups.length && !invalid) return null
  return (
    <div className="validation-report">
      <div className="validation-summary">
        <strong>校验报告</strong>
        <span className={errors ? "summary-error" : ""}>{errors} 类阻断错误</span>
        <span>{warnings} 类警告</span>
      </div>
      {invalid && (
        <div className="publication-protocol-error" role="alert">
          <ShieldWarning />
          <span>
            <strong>服务端返回失败，但没有提供可展示的阻断错误。</strong>
            <small>发布记录 {props.run.id}，请刷新状态或联系管理员检查服务端日志。</small>
          </span>
        </div>
      )}
      <div className="issue-list">
        {groups.map((item) => (
          <article className={`issue-${item.issue.severity}`} key={`${item.issue.severity}-${item.issue.code}-${item.issue.message}`}>
            <ShieldWarning weight={item.issue.severity === "error" ? "fill" : "regular"} />
            <span>
              <strong>
                <em>{item.issue.severity === "error" ? "阻止发布" : item.issue.severity === "warning" ? "警告" : "提示"}</em>
                {item.issue.code === "scripts-present"
                  ? `包含 ${item.count} 个脚本文件；市场服务不会执行这些脚本，使用前请自行审查。`
                  : item.issue.message}
              </strong>
              {item.files.length <= 1 && <small>{item.files[0] ?? item.issue.field ?? "归档"}</small>}
              {item.files.length > 1 && (
                <details>
                  <summary>查看 {item.files.length} 个文件</summary>
                  <ul>
                    {item.files.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                </details>
              )}
            </span>
          </article>
        ))}
      </div>
    </div>
  )
}

function group(issues: Issue[]): Group[] {
  const map = new Map<string, Group>()
  for (const issue of issues) {
    const key = `${issue.severity}\0${issue.code}`
    const current = map.get(key)
    if (current) {
      current.count += 1
      if (issue.file && !current.files.includes(issue.file)) current.files.push(issue.file)
      continue
    }
    map.set(key, { issue, files: issue.file ? [issue.file] : [], count: 1 })
  }
  return [...map.values()].sort((a, b) => rank(a.issue.severity) - rank(b.issue.severity))
}

function rank(value: string) {
  if (value === "error") return 0
  if (value === "warning") return 1
  return 2
}

function terminal(status: PublicationRun["status"]) {
  return status !== "VALIDATING" && status !== "PUBLISHING"
}

function failed(status: PublicationRun["status"]) {
  return ["NEEDS_AUTHOR_FIX", "NEEDS_AI_CONFIRMATION", "SECURITY_REJECTED", "FAILED"].includes(status)
}
