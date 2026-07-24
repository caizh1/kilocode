import { CheckCircle, Question, ShieldWarning, X } from "@phosphor-icons/react"
import type { SkillRiskSummary, ValidationReport } from "@chipmate/market-contracts"
import { useState, type ReactNode } from "react"

const unknown: SkillRiskSummary = { level: "unknown", issueCount: 0 }

export function riskOf(report: ValidationReport) {
  return report.risk ?? unknown
}

export function RiskBadge(props: { risk?: SkillRiskSummary }) {
  const risk = props.risk ?? unknown
  const text =
    risk.level === "none"
      ? "未发现风险"
      : risk.level === "medium"
        ? `存在风险 · ${risk.issueCount} 类`
        : risk.level === "critical"
          ? "严重风险"
          : "未评估"
  return (
    <span className={`skill-risk-badge risk-${risk.level}`}>
      {risk.level === "none" ? (
        <CheckCircle weight="fill" />
      ) : risk.level === "unknown" ? (
        <Question />
      ) : (
        <ShieldWarning weight="fill" />
      )}
      {text}
    </span>
  )
}

export function RiskPanel(props: { report: ValidationReport }) {
  const risk = riskOf(props.report)
  const issues = (props.report.issues ?? []).filter(
    (item) => item.riskLevel === "medium" || item.riskLevel === "critical",
  )
  const unassessed = risk.level === "unknown"
  return (
    <section className={`glass-panel skill-risk-panel risk-${risk.level}`} role="note">
      <div className="panel-heading">
        {risk.level === "none" ? (
          <CheckCircle weight="fill" />
        ) : unassessed ? (
          <Question />
        ) : (
          <ShieldWarning weight="fill" />
        )}
        <h2>
          {risk.level === "none"
            ? "自动扫描未发现风险"
            : unassessed
              ? "此版本尚未评估"
              : `发现 ${risk.issueCount} 类风险`}
        </h2>
      </div>
      <p>
        {risk.level === "none"
          ? "该结果仅代表当前自动规则未命中风险，不构成安全保证。"
          : unassessed
            ? "此历史版本没有使用当前风险规则扫描，下载或安装前请自行审查。"
            : "该 Skill 可以发布，但可能包含脚本、凭据或外部链接，使用前请逐项确认。"}
      </p>
      {issues.length > 0 && (
        <div className="skill-risk-list">
          {issues.map((item, index) => (
            <article key={`${item.code}-${item.file ?? index}`}>
              <ShieldWarning />
              <span>
                <strong>{item.message}</strong>
                <small>{item.file ?? item.field ?? "Skill 归档"}</small>
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function RiskDialog(props: {
  report: ValidationReport
  action: string
  children?: ReactNode
  close(): void
  confirm(): void
}) {
  const [agreed, setAgreed] = useState(false)
  const risk = riskOf(props.report)
  const medium = risk.level === "medium"
  const issues = (props.report.issues ?? []).filter(
    (item) => item.riskLevel === "medium" || item.riskLevel === "critical",
  )
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.close()
      }}
    >
      <section
        className={`glass-panel skill-risk-dialog risk-${risk.level}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-risk-dialog-title"
      >
        <div className="risk-dialog-head">
          <span className="dialog-mark">
            <ShieldWarning weight="fill" />
          </span>
          <button className="dialog-close" aria-label="关闭风险提示" onClick={props.close}>
            <X />
          </button>
        </div>
        <h2 id="skill-risk-dialog-title">{medium ? "此 Skill 存在风险隐患" : "此 Skill 尚未评估"}</h2>
        <p>
          {medium
            ? `继续${props.action}前，请确认你已阅读以下风险。`
            : `该历史版本未按当前规则扫描，确认后仍可继续${props.action}。`}
        </p>
        {issues.length > 0 && (
          <div className="skill-risk-list">
            {issues.map((item, index) => (
              <article key={`${item.code}-${item.file ?? index}`}>
                <ShieldWarning />
                <span>
                  <strong>{item.message}</strong>
                  <small>{item.file ?? item.field ?? "Skill 归档"}</small>
                </span>
              </article>
            ))}
          </div>
        )}
        {props.children}
        {medium && (
          <label className="risk-agreement">
            <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
            我已了解上述风险，并决定继续
          </label>
        )}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={props.close}>
            取消
          </button>
          <button className="primary-button" disabled={medium && !agreed} onClick={props.confirm}>
            继续{props.action}
          </button>
        </div>
      </section>
    </div>
  )
}
