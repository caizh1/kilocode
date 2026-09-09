import { BasicTool } from "@chipmate/chipmate-ui/basic-tool"
import { Button } from "@chipmate/chipmate-ui/button"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { Markdown } from "@chipmate/chipmate-ui/markdown"
import { ToolRegistry, type ToolProps } from "@chipmate/chipmate-ui/message-part"
import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { useVSCode } from "../../context/vscode"
import { requestAgentSelection } from "../shared/ModeSwitcher"

type Finding = {
  id: string
  severity: "P0" | "P1" | "P2" | "P3" | "A1" | "A2"
  impact: string
  locations: Array<{ path: string; line?: number }>
}

type Lane = {
  id: string
  title: string
  status: "pending" | "running" | "complete" | "failed"
  attempts: number
  sessionID?: string
  reason?: string
}

type Report = {
  runId: string
  productStatus: "technical-preview"
  scopeLabel: string
  effort: string
  durationMs: number
  fingerprint: string
  finalFingerprint: string
  files: number
  additions: number
  deletions: number
  configuration: string[]
  verdict: "PASS" | "FAIL"
  architectureGate: "PASS" | "NEEDS REWORK"
  runStatus: "COMPLETE" | "LIMITED" | "INCOMPLETE" | "STALE" | "CANCELLED"
  approvable: boolean
  findings: Finding[]
  unverifiedRisks: string[]
  lanes: Lane[]
  model?: { providerID: string; modelID: string; variant?: string }
  usage: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
  filesRead: string[]
  validation: Array<{ argv: string[]; reason: string; status: string; exitCode?: number }>
}

type Metadata = {
  rejected?: boolean
  stage?: "scope" | "review" | "validation" | "adjudication" | "complete"
  report?: Report
  lanes?: Lane[]
  reason?: string
}

const stages = {
  scope: "固定审核范围",
  review: "专项并行审核",
  validation: "等待批量验证",
  adjudication: "对抗复核",
  complete: "审核完成",
} as const

function metadata(props: ToolProps): Metadata {
  const current = props.metadata as Metadata
  if (current.report || current.stage || current.reason) return current
  return (props.partMetadata ?? {}) as Metadata
}

const UfsReviewRenderer: Component<ToolProps> = (props) => {
  const vscode = useVSCode()
  const data = createMemo(() => metadata(props))
  const report = createMemo(() => data().report)
  const lanes = createMemo(() => report()?.lanes ?? data().lanes ?? [])
  const running = createMemo(() => props.status === "running" || (data().stage && data().stage !== "complete"))
  const [selected, setSelected] = createSignal<Set<string>>(new Set())

  const selectedIDs = () => {
    const chosen = selected()
    if (chosen.size) return [...chosen]
    return (
      report()
        ?.findings.filter((item) => ["P0", "P1", "A1"].includes(item.severity))
        .map((item) => item.id) ?? []
    )
  }

  const toggle = (id: string) => {
    const next = new Set(selected())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const openLane = (lane: Lane) => {
    if (!lane.sessionID) return
    vscode.postMessage({ type: "openSubAgentViewer", sessionID: lane.sessionID, title: lane.title })
  }

  const fix = () => {
    const current = report()
    if (!current) return
    const ids = selectedIDs()
    const chosen = ids.length ? ids.join("、") : "报告中的全部可执行问题"
    requestAgentSelection("code")
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("prefillPrompt", {
          detail: {
            text: [
              `请修复当前会话 Reviewer 报告 ${current.runId} 中的以下问题：${chosen}。`,
              "以 ufs_review 工具冻结报告中的位置、证据、修复方向和复核方式为准。",
              "修复后运行相关验证，但不要改变未选择问题的语义；完成后我会切回 Reviewer 重新审核。",
            ].join("\n"),
          },
        }),
      )
    })
  }

  const trigger = () => (
    <div class="ufs-review-card__trigger">
      <span>Reviewer</span>
      <Show when={report()} fallback={<span>{stages[data().stage ?? "scope"]}</span>}>
        {(item) => (
          <span>
            {item().verdict} · {item().runStatus}
          </span>
        )}
      </Show>
    </div>
  )

  return (
    <div data-component="tool-part-wrapper" class="ufs-review-card">
      <BasicTool
        icon="shield"
        status={props.status}
        tool={props.tool}
        partID={props.partID}
        trigger={trigger()}
        defaultOpen={running()}
        forceOpen={props.forceOpen}
      >
        <div class="ufs-review-card__body">
          <Show
            when={report()}
            fallback={<p class="ufs-review-card__progress">{data().reason ?? stages[data().stage ?? "scope"]}</p>}
          >
            {(item) => (
              <>
                <div class="ufs-review-card__gates">
                  <span data-tone={item().verdict === "PASS" ? "pass" : "fail"}>VERDICT {item().verdict}</span>
                  <span data-tone={item().architectureGate === "PASS" ? "pass" : "warn"}>
                    ARCH {item().architectureGate}
                  </span>
                  <span data-tone={item().runStatus === "COMPLETE" ? "pass" : "warn"}>{item().runStatus}</span>
                  <span>技术预览</span>
                </div>
                <div class="ufs-review-card__facts">
                  <span>{item().scopeLabel}</span>
                  <span>{item().files} 个文件</span>
                  <span>
                    +{item().additions}/-{item().deletions}
                  </span>
                  <span>{item().effort}</span>
                  <span title={item().fingerprint}>指纹 {item().fingerprint.slice(0, 12)}</span>
                  <Show when={item().configuration.length > 0}>
                    <span title={item().configuration.join("、")}>配置 {item().configuration.length}</span>
                  </Show>
                  <span>{(item().durationMs / 1000).toFixed(1)} 秒</span>
                  <Show when={item().model}>
                    {(model) => (
                      <span title={`${model().providerID}/${model().modelID}`}>
                        {model().modelID}
                        {model().variant ? ` · ${model().variant}` : ""}
                      </span>
                    )}
                  </Show>
                  <span>Token {item().usage.input + item().usage.output + item().usage.reasoning}</span>
                </div>
                <div class="ufs-review-card__lanes">
                  <For each={lanes()}>
                    {(lane) => (
                      <button
                        type="button"
                        class="ufs-review-card__lane"
                        disabled={!lane.sessionID}
                        onClick={() => openLane(lane)}
                        aria-label={`${lane.title}，${lane.status}`}
                      >
                        <Icon
                          name={lane.status === "complete" ? "pass" : lane.status === "failed" ? "error" : "loading"}
                          size="small"
                        />
                        <span>{lane.title}</span>
                        <small>
                          {lane.status}
                          {lane.attempts > 1 ? ` · ${lane.attempts}次` : ""}
                        </small>
                      </button>
                    )}
                  </For>
                </div>
                <Show when={item().findings.length > 0}>
                  <div class="ufs-review-card__findings" role="group" aria-label="选择要交给 Code Agent 修复的问题">
                    <For each={item().findings}>
                      {(finding) => (
                        <label>
                          <input
                            type="checkbox"
                            checked={selected().has(finding.id)}
                            onChange={() => toggle(finding.id)}
                          />
                          <strong>
                            {finding.id} · {finding.severity}
                          </strong>
                          <span>{finding.impact}</span>
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={item().unverifiedRisks.length > 0}>
                  <div class="ufs-review-card__risks">
                    <strong>未验证风险 {item().unverifiedRisks.length}</strong>
                    <For each={item().unverifiedRisks}>{(risk) => <span>{risk}</span>}</For>
                  </div>
                </Show>
                <Show when={item().filesRead.length > 0 || item().validation.length > 0}>
                  <details class="ufs-review-card__trace">
                    <summary>
                      审核轨迹 · {item().filesRead.length} 个已读文件 · {item().validation.length} 条验证命令
                    </summary>
                    <Show when={item().filesRead.length > 0}>
                      <div>
                        <strong>已读取文件</strong>
                        <For each={item().filesRead}>{(file) => <code>{file}</code>}</For>
                      </div>
                    </Show>
                    <Show when={item().validation.length > 0}>
                      <div>
                        <strong>验证命令与结果</strong>
                        <For each={item().validation}>
                          {(command) => (
                            <code>
                              {command.status} · {command.argv.join(" ")}
                            </code>
                          )}
                        </For>
                      </div>
                    </Show>
                  </details>
                </Show>
                <Show when={props.output}>
                  <div class="ufs-review-card__report">
                    <Markdown text={props.output ?? ""} />
                  </div>
                </Show>
                <div class="ufs-review-card__actions">
                  <Button size="small" variant="secondary" onClick={fix} disabled={item().findings.length === 0}>
                    切换到 Code 并修复
                  </Button>
                </div>
              </>
            )}
          </Show>
        </div>
      </BasicTool>
    </div>
  )
}

export function registerUfsReviewTool() {
  ToolRegistry.register({ name: "ufs_review", render: UfsReviewRenderer })
}
