import { ChartLineUp, Funnel, LockKey } from "@phosphor-icons/react"
import type { AnalyticsSeries, MarketUser, PublicationRun } from "@chipmate/market-contracts"
import { useEffect, useState } from "react"
import { InlineError, request, useApi } from "../shared"

export function AnalyticsPage(props: { user: MarketUser | undefined; requestLogin(): void }) {
  if (!props.user) {
    return (
      <section className="page-width analytics-page">
        <div className="page-heading">
          <span className="eyebrow">聚合分析</span>
          <h1>市场与作者漏斗</h1>
        </div>
        <div className="glass-panel account-empty">
          <LockKey />
          <p>分析只对登录用户开放；不提供具体用户轨迹。</p>
          <button className="primary-button" onClick={props.requestLogin}>
            登录后查看
          </button>
        </div>
      </section>
    )
  }
  return <Analytics />
}

function Analytics() {
  const global = useApi<AnalyticsSeries[]>("/api/v1/analytics/overview")
  const publications = useApi<PublicationRun[]>("/api/v1/me/publications")
  const [author, setAuthor] = useState<Array<{ id: string; series: AnalyticsSeries[] }>>([])
  const [error, setError] = useState("")

  useEffect(() => {
    const ids = [...new Set((publications.data ?? []).flatMap((item) => (item.skillId ? [item.skillId] : [])))]
    if (ids.length === 0) return setAuthor([])
    Promise.all(
      ids.map(async (id) => ({
        id,
        series: await request<AnalyticsSeries[]>(`/api/v1/analytics/skills/${encodeURIComponent(id)}`),
      })),
    )
      .then(setAuthor)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [publications.data])

  return (
    <section className="page-width analytics-page">
      <div className="page-heading">
        <span className="eyebrow">聚合分析</span>
        <h1>市场与作者漏斗</h1>
        <p>原始事件仅保留 90 天，日聚合保留 1 年；作者只能查看自己的 Skill。</p>
      </div>
      {error && <InlineError message={error} />}
      <section className="glass-panel metric-panel">
        <div className="panel-heading">
          <ChartLineUp />
          <h2>全局聚合</h2>
        </div>
        <Series items={global.data ?? []} />
      </section>
      <section className="glass-panel metric-panel">
        <div className="panel-heading">
          <Funnel />
          <h2>我的 Skill 漏斗</h2>
        </div>
        {author.map((item) => (
          <article key={item.id}>
            <h3>{item.id}</h3>
            <Series items={item.series} />
          </article>
        ))}
        {author.length === 0 && <p>发布 Skill 后会显示作者漏斗。</p>}
      </section>
      <p className="privacy-note">
        <LockKey /> 仅显示按日聚合计数，不提供客户端、用户或工作区级查询。
      </p>
    </section>
  )
}

function Series(props: { items: AnalyticsSeries[] }) {
  return (
    <div className="metric-grid">
      {props.items.map((item) => (
        <div className="metric-card" key={`${item.scope}-${item.metric}`}>
          <strong>{label(item.metric)}</strong>
          <span>{item.points.reduce((sum, point) => sum + point.value, 0)}</span>
          <small>{item.points.length} 个统计日</small>
        </div>
      ))}
      {props.items.length === 0 && <p>暂无聚合事件。</p>}
    </div>
  )
}

function label(value: string) {
  return value.replaceAll("_", " ")
}
