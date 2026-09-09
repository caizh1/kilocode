import { acquireAppearanceApi } from "../appearance/api"
/** @jsxImportSource solid-js */

import { Button } from "@chipmate/chipmate-ui/button"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import type { PatentRadarRun, PatentRadarWebviewMessage } from "../../src/patent-radar/types"

interface VSCodeAPI {
  postMessage(message: PatentRadarWebviewMessage): void
}


const vscode: VSCodeAPI = acquireAppearanceApi()
const labels: Record<string, string> = {
  "review-ready": "建议人工检索",
  "continue-human-review": "继续人工检索",
  "single-reference-conflict": "单篇文献冲突",
  "combination-risk": "组合文献风险",
  "cn-claim-risk": "中国权利要求风险",
  observation: "观察项",
  "insufficient-evidence": "证据不足",
}

export function PatentRadarApp() {
  const [run, setRun] = createSignal<PatentRadarRun>()
  const [runs, setRuns] = createSignal<PatentRadarRun[]>([])
  const [historyKind, setHistoryKind] = createSignal<"workspace" | "module">("workspace")
  const [busy, setBusy] = createSignal(false)
  const [notes, setNotes] = createSignal<Record<string, string>>({})
  const listener = (event: MessageEvent<{ type?: string; run?: PatentRadarRun; runs?: PatentRadarRun[]; value?: boolean }>) => {
    if (event.data.type === "patentRadar.state") {
      setRun(event.data.run)
      if (event.data.run) setHistoryKind(event.data.run.scope.kind)
      if (event.data.runs) setRuns(event.data.runs)
    }
    if (event.data.type === "patentRadar.busy") setBusy(Boolean(event.data.value))
  }
  onMount(() => {
    window.addEventListener("message", listener)
    vscode.postMessage({ type: "patentRadar.ready" })
  })
  onCleanup(() => window.removeEventListener("message", listener))

  const review = (candidateId: string, decision: "worthy" | "reject" | "needs-arbitration") => {
    const current = run()
    if (!current) return
    vscode.postMessage({
      type: "patentRadar.review",
      runId: current.id,
      candidateId,
      decision,
      note: notes()[candidateId] ?? "",
    })
  }

  return (
    <main class="patent-radar-shell">
      <Show
        when={run()}
        fallback={
          <section class="empty glass">
            <h1>Patent Radar</h1>
            <p>尚无扫描结果。请在 ChipMate 设置的“专利中心”中扫描当前工作区。</p>
          </section>
        }
      >
        {(current) => (
          <>
            <header class="summary glass">
              <div class="history-toolbar">
                <div class="history-filters" role="group" aria-label="扫描历史类型">
                  <Button variant={historyKind() === "workspace" ? "primary" : "secondary"} onClick={() => setHistoryKind("workspace")}>全仓历史</Button>
                  <Button variant={historyKind() === "module" ? "primary" : "secondary"} onClick={() => setHistoryKind("module")}>模块历史</Button>
                </div>
                <select
                  aria-label="选择扫描历史"
                  value={current().id}
                  onChange={(event) => vscode.postMessage({ type: "patentRadar.selectRun", runId: event.currentTarget.value })}
                >
                  <For each={runs().filter((item) => item.scope.kind === historyKind())}>
                    {(item) => <option value={item.id}>{item.scope.kind === "module" ? item.scope.name ?? "临时模块" : "完整工作区"} · {new Date(item.createdAt).toLocaleString()} · {item.status}</option>}
                  </For>
                </select>
              </div>
              <div class="summary-title">
                <div>
                  <h1>
                    Patent Radar
                    {current().scope.kind === "module" ? ` · ${current().scope.name ?? "临时模块"}（范围扫描）` : ""}
                  </h1>
                  <p>
                    {new Date(current().createdAt).toLocaleString()} · {current().status}
                  </p>
                </div>
                <span class="count">{current().candidates.length} 个候选</span>
              </div>
              <div class="fingerprints">
                <span>源码 {current().sourceFingerprint.slice(0, 12)}</span>
                <span>语料 {current().corpus?.generation ?? "未检索"}</span>
                <span>截止 {current().cutoffDate}</span>
                <span>
                  覆盖 {current().coverage?.analyzedFiles ?? 0}/{current().coverage?.supportedFiles ?? 0}
                </span>
                <span>混合召回 · 无 Rerank</span>
                <Show when={current().scope.kind === "module"}>
                  <span>
                    模块证据 {current().scopeCoverage?.selectedEvidence ?? 0}/{current().scopeCoverage?.workspaceEvidence ?? 0} ·
                    全仓占比 {((current().scopeCoverage?.workspacePercent ?? 0) * 100).toFixed(1)}%
                  </span>
                </Show>
              </div>
              <div class="actions">
                <Button
                  disabled={busy()}
                  onClick={() => vscode.postMessage({ type: "patentRadar.research", runId: current().id })}
                >
                  重新检索
                </Button>
                <Button
                  disabled={busy()}
                  variant="secondary"
                  onClick={() => vscode.postMessage({ type: "patentRadar.export", runId: current().id })}
                >
                  导出证据包
                </Button>
              </div>
              <p class="boundary">
                {current().scope.kind === "module"
                  ? `当前仅扫描模块核心路径及自动纳入的确定性关系${current().scopeCoverage?.closureComplete ? "闭包" : "均衡范围"}，不能代表完成全仓扫描。`
                  : ""}
                当前为实验性技术发现；真实 gold set
                验收完成前不代表已达到高质量门槛。本结果仅用于现有技术和权利要求风险预检，不代表“可以授权”“没有冲突”或“不侵权”。
              </p>
            </header>
            <Show when={current().warnings.length}>
              <section class="warnings glass">
                <h2>覆盖提醒</h2>
                <ul>
                  <For each={current().warnings}>{(warning) => <li>{warning}</li>}</For>
                </ul>
              </section>
            </Show>
            <section class="candidate-list">
              <For each={current().candidates} fallback={<div class="empty glass">未提取到证据完整的创新候选。</div>}>
                {(candidate, index) => {
                  const assessment = () => current().assessments.find((item) => item.candidateId === candidate.id)
                  const sources = () =>
                    candidate.evidenceIds.flatMap((id) => current().sources.filter((item) => item.id === id))
                  const reviews = () => current().reviews[candidate.id] ?? []
                  const conflicted = () => {
                    const decisions = new Set(reviews().map((item) => item.decision))
                    return decisions.has("needs-arbitration") || (decisions.has("worthy") && decisions.has("reject"))
                  }
                  return (
                    <article class="candidate glass">
                      <div class="candidate-heading">
                        <div>
                          <span class="ordinal">候选 {index() + 1}</span>
                          <h2>{candidate.title}</h2>
                          <span>
                            {candidate.discoveryTier === "review-ready"
                              ? current().scope.kind === "module" ? "模块范围内建议人工检索" : "建议人工检索"
                              : candidate.discoveryTier === "technical-candidate"
                                ? "技术候选"
                                : "观察项"}{" "}
                            · {candidate.origin === "cross-file" ? "跨文件" : "单文件"} · 效果证据{" "}
                            {candidate.effectEvidenceLevel}
                          </span>
                        </div>
                        <span class={`verdict verdict-${assessment()?.verdict ?? "observation"}`}>
                          {labels[assessment()?.verdict ?? "observation"]}
                        </span>
                      </div>
                      <p class="reason">{assessment()?.reason ?? "已提取候选，尚未执行专利检索。"}</p>
                      <div class="facts">
                        <div>
                          <h3>技术问题</h3>
                          <p>{candidate.technicalProblem}</p>
                        </div>
                        <div>
                          <h3>实现手段</h3>
                          <p>{candidate.implementation}</p>
                        </div>
                        <div>
                          <h3>技术效果</h3>
                          <p>{candidate.technicalEffect}</p>
                        </div>
                      </div>
                      <h3>必要技术特征</h3>
                      <ol class="features">
                        <For each={candidate.features.filter((item) => item.necessary)}>
                          {(feature) => (
                            <li>
                              <code>{feature.id}</code>
                              {feature.text}
                            </li>
                          )}
                        </For>
                      </ol>
                      <Show when={candidate.relationIds.length}>
                        <details>
                          <summary>跨文件确定性关系（{candidate.relationIds.length}）</summary>
                          <div class="references">
                            <For each={candidate.relationIds}>
                              {(id) => {
                                const relation = current().relations.find((item) => item.relationId === id)
                                return (
                                  <Show when={relation}>
                                    {(edge) => (
                                      <span>
                                        {edge().locations[0]?.file} → {edge().locations[1]?.file} · {edge().kind} ·{" "}
                                        {edge().resolution}/{edge().strength} ·{" "}
                                        {edge().variantIds.join(", ") || "Variant 未确定"}
                                      </span>
                                    )}
                                  </Show>
                                )
                              }}
                            </For>
                          </div>
                        </details>
                      </Show>
                      <Show when={assessment()?.references.length}>
                        <h3>重点专利</h3>
                        <div class="references">
                          <For each={assessment()?.references.slice(0, 8)}>
                            {(reference) => (
                              <span>
                                {reference.publicationNumber}
                                {reference.title ? ` · ${reference.title}` : ""}
                              </span>
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={assessment()?.matrix.length}>
                        <details>
                          <summary>必要特征 × 专利证据矩阵（{assessment()?.matrix.length}）</summary>
                          <div class="matrix">
                            <div class="matrix-head">
                              <span>特征</span>
                              <span>公开号</span>
                              <span>覆盖</span>
                              <span>证据位置、原文与理由</span>
                            </div>
                            <For each={assessment()?.matrix}>
                              {(cell) => (
                                <div>
                                  <code>{cell.featureId}</code>
                                  <span>{cell.publicationNumber}</span>
                                  <strong>{cell.covered ? "是" : "否"}</strong>
                                  <span>
                                    {cell.locator ?? "无明确原文"}
                                    {cell.quote ? ` · “${cell.quote}”` : ""} · {cell.rationale}
                                  </span>
                                </div>
                              )}
                            </For>
                          </div>
                        </details>
                      </Show>
                      <details>
                        <summary>本地证据（{sources().length}）</summary>
                        <div class="evidence">
                          <For each={sources()}>
                            {(source) => (
                              <div>
                                <strong>
                                  {source.location.file}
                                  {source.location.page
                                    ? `#page=${source.location.page}`
                                    : `:${source.location.lineStart}-${source.location.lineEnd}`}
                                </strong>
                                <small>SHA-256 {source.location.sha256}</small>
                                <pre>{source.excerpt.slice(0, 1800)}</pre>
                              </div>
                            )}
                          </For>
                        </div>
                      </details>
                      <div class="review">
                        <Show when={reviews().length}>
                          <div class="review-history">
                            <div class="review-summary">
                              <strong>已有评审 {reviews().length} 条</strong>
                              <Show when={conflicted()}>
                                <span class="arbitration">存在分歧，需仲裁</span>
                              </Show>
                            </div>
                            <ul>
                              <For each={reviews()}>
                                {(item) => (
                                  <li>
                                    {item.reviewer} · {item.decision}
                                    {item.blind ? " · 盲审" : ""}
                                    {item.note ? `：${item.note}` : ""}
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        </Show>
                        <label>
                          评审备注
                          <input
                            value={notes()[candidate.id] ?? ""}
                            onInput={(event) =>
                              setNotes((value) => ({ ...value, [candidate.id]: event.currentTarget.value }))
                            }
                            placeholder="记录进入或不进入正式检索的理由"
                          />
                        </label>
                        <div class="review-actions">
                          <Button disabled={busy()} onClick={() => review(candidate.id, "worthy")}>
                            值得正式检索
                          </Button>
                          <Button disabled={busy()} variant="secondary" onClick={() => review(candidate.id, "reject")}>
                            暂不进入
                          </Button>
                          <Button
                            disabled={busy()}
                            variant="secondary"
                            onClick={() => review(candidate.id, "needs-arbitration")}
                          >
                            需要仲裁
                          </Button>
                        </div>
                      </div>
                    </article>
                  )
                }}
              </For>
            </section>
          </>
        )}
      </Show>
    </main>
  )
}
