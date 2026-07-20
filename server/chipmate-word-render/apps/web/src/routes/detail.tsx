import {
  ArrowRight,
  BookOpenText,
  ClockCounterClockwise,
  Code,
  DownloadSimple,
  FileCode,
  Heart,
  Package,
} from "@phosphor-icons/react"
import type {
  FavoriteState,
  InstallationState,
  MarketUser,
  SkillDetail,
  SkillSummary,
} from "@chipmate/market-contracts"
import { useEffect, useState } from "react"
import { bytes, compact, date, InlineError, mutate, request, Skeleton, useApi } from "../shared"
import { image, repair } from "../icons"
import { track } from "../analytics"
import { riskOf, RiskBadge, RiskDialog, RiskPanel } from "../risk"

interface FilePreview {
  file: SkillDetail["files"][number]
  text?: string
  dataUrl?: string
}

export function Detail(props: {
  id: string
  navigate(path: string): void
  user: MarketUser | undefined
  csrf: string
  sync: number
  requestLogin(): void
}) {
  const detail = useApi<SkillDetail>(`/api/v1/skills/${encodeURIComponent(props.id)}`)
  const [revision, setRevision] = useState("")
  const [preview, setPreview] = useState<FilePreview>()
  const [error, setError] = useState("")
  const [favorite, setFavorite] = useState(false)
  const [installation, setInstallation] = useState<InstallationState>()
  const [busy, setBusy] = useState<"favorite" | "install">()
  const [pending, setPending] = useState<"install" | "archive">()

  useEffect(() => {
    track("skill_open", { skillId: props.id })
  }, [props.id])

  useEffect(() => {
    if (!props.user) {
      setFavorite(false)
      setInstallation(undefined)
      return
    }
    const abort = new AbortController()
    Promise.all([
      request<SkillSummary[]>("/api/v1/me/favorites", abort.signal),
      request<InstallationState[]>("/api/v1/me/installations", abort.signal),
    ])
      .then(([favorites, installations]) => {
        setFavorite(favorites.some((item) => item.id === props.id))
        setInstallation(installations.find((item) => item.skillId === props.id && item.status !== "removed"))
      })
      .catch((err: unknown) => {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : String(err))
      })
    return () => abort.abort()
  }, [props.id, props.sync, props.user])

  const open = async (path: string) => {
    setError("")
    const params = revision ? `?revision=${revision}` : ""
    try {
      setPreview(
        await request<FilePreview>(
          `/api/v1/skills/${encodeURIComponent(props.id)}/files/${path.split("/").map(encodeURIComponent).join("/")}${params}`,
        ),
      )
      track("skill_file_preview", { skillId: props.id, ...(revision ? { revision: Number(revision) } : {}) })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleFavorite = async () => {
    if (!props.user) return props.requestLogin()
    setBusy("favorite")
    setError("")
    try {
      const state = await mutate<FavoriteState>(
        `/api/v1/favorites/${encodeURIComponent(props.id)}`,
        favorite ? "DELETE" : "PUT",
        undefined,
        props.csrf,
      )
      setFavorite(state.favorite)
      track("skill_favorite", { skillId: props.id, context: { action: state.favorite ? "add" : "remove" } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  const performInstall = async () => {
    if (!props.user) return props.requestLogin()
    setBusy("install")
    setError("")
    try {
      const intent = await mutate<{ token: string; expiresAt: string }>(
        `/api/v1/skills/${encodeURIComponent(props.id)}/install-intents`,
        "POST",
        revision ? { revision: Number(revision) } : {},
        props.csrf,
      )
      track("skill_install_intent", { skillId: props.id, ...(revision ? { revision: Number(revision) } : {}) })
      const deep = new URL("vscode://chipmate.chipmate/marketplace/install")
      deep.searchParams.set("origin", location.origin)
      deep.searchParams.set("token", intent.token)
      location.href = deep.toString()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(undefined)
    }
  }

  const selected = () =>
    detail.data?.releases.find((entry) => entry.revision === Number(revision || detail.data?.latestRevision))
  const acquire = (action: "install" | "archive") => {
    if (action === "install" && !props.user) return props.requestLogin()
    const item = selected()
    if (!item) return
    if (riskOf(item.report).level !== "none") {
      setPending(action)
      return
    }
    if (action === "install") void performInstall()
    else location.href = item.archiveUrl
  }

  const confirm = () => {
    const action = pending
    const item = selected()
    setPending(undefined)
    if (!action || !item) return
    if (action === "install") void performInstall()
    else location.href = item.archiveUrl
  }

  if (detail.loading)
    return (
      <section className="page-width detail-page">
        <Skeleton label="正在载入技能详情" />
      </section>
    )
  if (detail.error)
    return (
      <section className="page-width detail-page">
        <InlineError message={detail.error} />
      </section>
    )
  if (!detail.data) return null
  const item = detail.data
  const active =
    item.releases.find((entry) => entry.revision === Number(revision || item.latestRevision)) ?? item.releases[0]!

  return (
    <section className="page-width detail-page">
      <button className="back-link" onClick={() => props.navigate("/skills")}>
        技能目录 <ArrowRight /> {item.category}
      </button>
      <div className="detail-hero glass-panel">
        <img className="detail-icon" src={image(item)} alt="" onError={(event) => repair(event, item)} />
        <div className="detail-copy">
          <div className="title-row">
            <h1>{item.name}</h1>
            <RiskBadge risk={riskOf(active.report)} />
          </div>
          <p>{item.description}</p>
          <div className="meta-row">
            <span>由 {item.author.displayName} 发布</span>
            <span>
              <Package /> r{item.latestRevision}
            </span>
            <span>
              <DownloadSimple /> {compact(item.downloads)}
            </span>
            <span>
              <Heart /> {compact(item.favorites)}
            </span>
          </div>
          <div className="tag-row">
            {item.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
        <div className="detail-actions">
          <button className="primary-button" disabled={busy === "install"} onClick={() => acquire("install")}>
            <DownloadSimple />{" "}
            {busy === "install"
              ? "正在创建安装请求…"
              : installation
                ? `更新 r${installation.revision}`
                : "在 ChipMate 中安装"}
          </button>
          <button
            className={`secondary-button favorite-button ${favorite ? "active" : ""}`}
            disabled={busy === "favorite"}
            onClick={() => void toggleFavorite()}
          >
            <Heart weight={favorite ? "fill" : "regular"} /> {favorite ? "已收藏" : "收藏"}
          </button>
          <button className="secondary-button" onClick={() => acquire("archive")}>
            <DownloadSimple /> 下载归档
          </button>
          <small className="install-help">
            若浏览器未能打开 ChipMate，请下载归档并在 Marketplace 中选择同一安装范围。
          </small>
          {installation && (
            <span className="install-state">
              已同步：{installation.scope === "project" ? "项目" : "全局"} · r{installation.revision}
            </span>
          )}
          <span>SHA {item.sha256.slice(0, 12)}…</span>
        </div>
      </div>

      <RiskPanel report={active.report} />

      {item.gallery.length > 0 && (
        <div className="gallery-strip" aria-label="作者素材">
          {item.gallery.map((asset) => (
            <img
              key={asset.sha256}
              src={asset.url}
              width={asset.width}
              height={asset.height}
              alt={`${item.name} ${asset.type}`}
            />
          ))}
        </div>
      )}

      <div className="detail-grid">
        <article className="glass-panel prose-panel">
          <div className="panel-heading">
            <BookOpenText />
            <h2>技能说明</h2>
          </div>
          <pre>{item.markdown || "此技能尚未提供 SKILL.md 说明。"}</pre>
        </article>
        <aside className="detail-sidebar">
          <section className="glass-panel file-panel">
            <div className="panel-heading">
              <FileCode />
              <h2>文件预览</h2>
            </div>
            <label>
              选择版本
              <select
                value={revision}
                onChange={(event) => {
                  setRevision(event.target.value)
                  setPreview(undefined)
                }}
              >
                <option value="">最新版本</option>
                {item.releases.map((entry) => (
                  <option key={entry.revision} value={entry.revision}>
                    r{entry.revision}
                    {entry.semver ? ` · ${entry.semver}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="file-list">
              {item.files.map((file) => (
                <button key={file.path} disabled={!file.previewable} onClick={() => void open(file.path)}>
                  <FileCode />
                  <span>
                    {file.path}
                    <small>{bytes(file.size)}</small>
                  </span>
                  <ArrowRight />
                </button>
              ))}
            </div>
          </section>
          <section className="glass-panel version-panel">
            <div className="panel-heading">
              <ClockCounterClockwise />
              <h2>版本历史</h2>
            </div>
            {item.releases.map((entry) => (
              <div className="version-row" key={entry.revision}>
                <strong>r{entry.revision}</strong>
                <span>{entry.semver ?? "无语义版本"}</span>
                <small>{date(entry.publishedAt)}</small>
              </div>
            ))}
          </section>
        </aside>
      </div>

      {(preview || error) && (
        <section className="glass-panel preview-panel" aria-live="polite">
          <div className="panel-heading">
            <Code />
            <h2>{preview?.file.path ?? "预览失败"}</h2>
          </div>
          {error && <InlineError message={error} />}
          {preview?.text && <pre>{preview.text}</pre>}
          {preview?.dataUrl && <img src={preview.dataUrl} alt={`${preview.file.path} 预览`} />}
          {preview && !preview.text && !preview.dataUrl && <p>该二进制文件不支持在线预览。</p>}
        </section>
      )}
      {pending && (
        <RiskDialog
          report={active.report}
          action={pending === "install" ? "安装" : "下载"}
          close={() => setPending(undefined)}
          confirm={confirm}
        />
      )}
    </section>
  )
}
