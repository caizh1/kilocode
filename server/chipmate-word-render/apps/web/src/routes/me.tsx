import { Archive, BookOpenText, DownloadSimple, Heart, Package, UploadSimple } from "@phosphor-icons/react"
import type { InstallationState, MarketUser, PublicationRun, SkillSummary } from "@chipmate/market-contracts"
import { useMemo, useState } from "react"
import { InlineError, mutate, useApi } from "../shared"

export function MePage(props: {
  user: MarketUser | undefined
  csrf: string
  requestLogin(): void
  navigate(path: string): void
  signOut(): void
}) {
  if (!props.user) {
    return (
      <section className="page-width account-page">
        <div className="page-heading">
          <span className="eyebrow">个人工作台</span>
          <h1>收藏、安装与发布</h1>
        </div>
        <div className="glass-panel account-empty">
          <BookOpenText />
          <p>登录后查看跨 Web 与 ChipMate 同步的市场状态。</p>
          <button className="primary-button" onClick={props.requestLogin}>
            登录市场身份
          </button>
        </div>
      </section>
    )
  }
  return <Account csrf={props.csrf} navigate={props.navigate} signOut={props.signOut} />
}

function Account(props: { csrf: string; navigate(path: string): void; signOut(): void }) {
  const favorites = useApi<SkillSummary[]>("/api/v1/me/favorites")
  const installs = useApi<InstallationState[]>("/api/v1/me/installations")
  const publications = useApi<PublicationRun[]>("/api/v1/me/publications")
  const [pending, setPending] = useState("")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const latest = useMemo(() => {
    const result = new Map<string, string>()
    for (const run of [...(publications.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      if (run.skillId && !result.has(run.skillId)) result.set(run.skillId, run.id)
    }
    return result
  }, [publications.data])
  const active = (run: PublicationRun) =>
    Boolean(
      run.skillId && latest.get(run.skillId) === run.id && (run.status === "PUBLISHED" || run.status === "UNCHANGED"),
    )
  const unpublish = (id: string) => {
    setBusy(id)
    setError("")
    setNotice("")
    void mutate<PublicationRun>(`/api/v1/skills/${encodeURIComponent(id)}/unpublish`, "POST", undefined, props.csrf)
      .then(
        () => {
          setPending("")
          setNotice(`${id} 已下架；历史版本和审计记录仍然保留。`)
          publications.refresh()
        },
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setBusy(""))
  }
  return (
    <section className="page-width account-page">
      <div className="page-heading">
        <span className="eyebrow">个人工作台</span>
        <h1>我的市场状态</h1>
        <p>收藏、安装范围和不可变发布版本由服务端身份统一关联。</p>
        <button className="secondary-button" onClick={props.signOut}>
          退出登录
        </button>
      </div>
      <div className="account-grid">
        <section className="glass-panel account-list">
          <div className="panel-heading">
            <Heart />
            <h2>收藏</h2>
          </div>
          {(favorites.data ?? []).map((item) => (
            <button key={item.id} onClick={() => props.navigate(`/skills/${encodeURIComponent(item.id)}`)}>
              <span>
                <strong>{item.name}</strong>
                <small>{item.author.displayName}</small>
              </span>
              <Heart weight="fill" />
            </button>
          ))}
          {favorites.data?.length === 0 && <p>还没有收藏 Skill。</p>}
        </section>
        <section className="glass-panel account-list">
          <div className="panel-heading">
            <DownloadSimple />
            <h2>安装状态</h2>
          </div>
          {(installs.data ?? []).map((item) => (
            <button
              key={`${item.skillId}-${item.scope}`}
              onClick={() => props.navigate(`/skills/${encodeURIComponent(item.skillId)}`)}
            >
              <span>
                <strong>{item.skillId}</strong>
                <small>
                  {item.scope === "project" ? "项目" : "全局"} · {item.status}
                </small>
              </span>
              <Package /> r{item.revision}
            </button>
          ))}
          {installs.data?.length === 0 && <p>还没有同步安装。</p>}
        </section>
        <section className="glass-panel account-list publication-list">
          <div className="panel-heading">
            <UploadSimple />
            <h2>我的发布与版本</h2>
          </div>
          {error && <InlineError message={error} />}
          {notice && (
            <p className="publication-notice" role="status">
              {notice}
            </p>
          )}
          {(publications.data ?? []).map((item) => (
            <article className="publication-row" key={item.id}>
              <button
                className="publication-link"
                disabled={!item.skillId || item.status === "UNPUBLISHED"}
                onClick={() => item.skillId && props.navigate(`/skills/${encodeURIComponent(item.skillId)}`)}
              >
                <span>
                  <strong>{item.skillId ?? item.id}</strong>
                  <small>
                    {item.status === "UNPUBLISHED" ? "已下架" : item.status} · {item.updatedAt.slice(0, 10)}
                  </small>
                </span>
                <span>{item.release ? <>r{item.release.revision}</> : item.stage}</span>
              </button>
              {active(item) && pending !== item.skillId && (
                <button className="publication-unpublish" onClick={() => setPending(item.skillId ?? "")}>
                  <Archive />
                  下架
                </button>
              )}
              {active(item) && pending === item.skillId && (
                <div className="publication-confirm" role="group" aria-label={`确认下架 ${item.skillId}`}>
                  <span>下架后将从公开目录隐藏，历史版本仍会保留。</span>
                  <button className="secondary-button" disabled={busy === item.skillId} onClick={() => setPending("")}>
                    取消
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy === item.skillId}
                    onClick={() => item.skillId && unpublish(item.skillId)}
                  >
                    {busy === item.skillId ? "正在下架…" : "确认下架"}
                  </button>
                </div>
              )}
            </article>
          ))}
          {publications.data?.length === 0 && <p>还没有发布记录。</p>}
        </section>
      </div>
    </section>
  )
}
