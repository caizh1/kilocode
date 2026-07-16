import { ArrowClockwise, CheckCircle, Code, Package, SquaresFour, Wrench } from "@phosphor-icons/react"
import { useState, type ReactNode } from "react"
import { InlineError, Skeleton, status, useApi } from "../shared"

interface MarketStatus {
  ok: boolean
  transport: "trusted-http" | "https"
  render: "ready" | "degraded" | "unavailable"
  market: "ready" | "degraded" | "unavailable"
  packages: "ready" | "degraded" | "unavailable"
  extensions?: {
    enabled: boolean
    database: "ready" | "degraded"
    scanner: "starting" | "scanning" | "ready"
    drop?: boolean
    artifacts?: boolean
    temporary?: boolean
    warnings?: string[]
  }
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
            {data.data.extensions && (
              <Service
                icon={<Code />}
                title="VS Code 插件市场"
                value={extensionStatus(data.data.extensions)}
              />
            )}
          </div>
          {data.data.extensions && <ExtensionRuntimeStatus value={data.data.extensions} />}
          {(data.data.warnings ?? []).map((warning) => (
            <InlineError key={warning} message={warning} />
          ))}
          {(data.data.extensions?.warnings ?? []).map((warning) => (
            <InlineError key={warning} message={`插件导入：${warning}`} />
          ))}
        </>
      )}
    </section>
  )
}

function extensionStatus(value: NonNullable<MarketStatus["extensions"]>) {
  if (value.database !== "ready" || !value.drop || !value.artifacts || !value.temporary || value.warnings?.length) return "degraded"
  return value.scanner === "starting" ? "degraded" : "ready"
}

function ExtensionRuntimeStatus(props: { value: NonNullable<MarketStatus["extensions"]> }) {
  const items = [
    ["插件数据库", props.value.database === "ready"],
    ["目录导入扫描器", props.value.scanner === "ready" || props.value.scanner === "scanning"],
    ["drop 导入目录", props.value.drop === true],
    ["artifacts 产物目录", props.value.artifacts === true],
    [".tmp 临时目录", props.value.temporary === true],
  ] as const
  return (
    <section className="glass-panel extension-runtime-status" aria-label="插件市场运行状态">
      <strong>插件市场运行面</strong>
      <div>
        {items.map(([label, ready]) => (
          <span className={ready ? "ready" : "degraded"} key={label}>
            <CheckCircle weight="fill" /> {label} · {ready ? "正常" : "降级"}
          </span>
        ))}
      </div>
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
