import { ArrowClockwise, CheckCircle, Package, SquaresFour, Wrench } from "@phosphor-icons/react"
import { useState, type ReactNode } from "react"
import { InlineError, Skeleton, status, useApi } from "../shared"

interface MarketStatus {
  ok: boolean
  transport: "trusted-http" | "https"
  render: "ready" | "degraded" | "unavailable"
  market: "ready" | "degraded" | "unavailable"
  packages: "ready" | "degraded" | "unavailable"
  warnings?: string[]
}

export function StatusPage() {
  const [stamp, setStamp] = useState(0)
  const data = useApi<MarketStatus>(`/api/v1/status?refresh=${stamp}`)

  return (
    <section className="page-width status-page">
      <div className="page-heading status-heading">
        <div>
          <span className="eyebrow">运行透明度</span>
          <h1>服务状态</h1>
          <p>查看目录、渲染与离线包服务的当前可用性。</p>
        </div>
        <button className="secondary-button" onClick={() => setStamp(Date.now())}>
          <ArrowClockwise /> 刷新
        </button>
      </div>
      {data.loading && <Skeleton label="正在检查服务状态" />}
      {data.error && <InlineError message={data.error} />}
      {data.data && (
        <>
          <div className={`overall-status ${data.data.ok ? "ready" : "degraded"}`}>
            <CheckCircle weight="fill" />
            <div>
              <strong>{data.data.ok ? "所有核心服务正常" : "部分服务降级"}</strong>
              <span>传输模式：{data.data.transport}</span>
            </div>
          </div>
          <div className="status-grid">
            <Service icon={<SquaresFour />} title="技能目录" value={data.data.market} />
            <Service icon={<Wrench />} title="文档渲染" value={data.data.render} />
            <Service icon={<Package />} title="离线包服务" value={data.data.packages} />
          </div>
          {(data.data.warnings ?? []).map((warning) => (
            <InlineError key={warning} message={warning} />
          ))}
        </>
      )}
    </section>
  )
}

function Service(props: { icon: ReactNode; title: string; value: string }) {
  return (
    <article className="glass-panel service-card">
      <span className="service-icon">{props.icon}</span>
      <div>
        <strong>{props.title}</strong>
        <small>实时健康检查</small>
      </div>
      <span className={`status-pill ${props.value}`}>{status(props.value)}</span>
    </article>
  )
}
