import { Button } from "@chipmate/chipmate-ui/button"
import { Dialog } from "@chipmate/chipmate-ui/dialog"
import { useDialog } from "@chipmate/chipmate-ui/context/dialog"
import type { Accessor, Component } from "solid-js"
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { PatentRadarRun } from "../../../../src/patent-radar/types"

interface Props {
  run: Accessor<PatentRadarRun | null>
  loading: Accessor<boolean>
  cancelling: Accessor<boolean>
  error: Accessor<string | undefined>
  model: Accessor<string>
  onCancel: (runId: string) => void
  onRestart: () => void
  onRetry: () => void
  onOpenCandidates: () => void
}

const PatentRadarProgressDialog: Component<Props> = (props) => {
  const dialog = useDialog()
  const [clock, setClock] = createSignal(Date.now())
  const timer = window.setInterval(() => setClock(Date.now()), 1000)
  onCleanup(() => window.clearInterval(timer))
  const progress = () => props.run()?.progress
  const percent = createMemo(() => {
    const value = progress()
    return value?.totalUnits ? Math.min(100, Math.round((value.completedUnits / value.totalUnits) * 100)) : 0
  })
  const events = createMemo(() => progress()?.events.slice(-7).reverse() ?? [])
  const latest = createMemo(() => props.run()?.candidates.at(-1))
  const active = () => props.run()?.status === "SCANNING" || props.loading()
  const summary = () => statusSummary(props.error(), props.loading(), active(), progress()?.phase, props.run()?.status)
  const fallback = () => emptyMessage(props.error(), props.loading(), props.run()?.status)

  return (
    <Dialog title="专利扫描进度" size="x-large" transition>
      <div class="patent-radar-dialog" data-ui="patent-radar-progress-dialog">
        <div class="patent-radar-dialog-summary">
          <div class="patent-radar-dialog-state">
            <span class={`patent-radar-live-dot${active() ? " is-active" : ""}`} aria-hidden="true" />
            <div>
              <strong>{summary()}</strong>
              <span>{props.model() || "正在解析所选模型"}</span>
            </div>
          </div>
        </div>
        <div class="patent-radar-dialog-stats">
          <div>
            <i class="codicon codicon-package" aria-hidden="true" />
            <span>
              <small>模型</small>
              {props.model() || "正在解析所选模型"}
            </span>
          </div>
          <div>
            <i class="codicon codicon-clock" aria-hidden="true" />
            <span>
              <small>已运行</small>
              {elapsed(progress()?.startedAt, clock())}
            </span>
          </div>
          <div>
            <i class="codicon codicon-database" aria-hidden="true" />
            <span>
              <small>证据批次</small>
              {progress()?.completedUnits ?? 0} / {progress()?.totalUnits ?? "—"}
            </span>
          </div>
          <div>
            <i class="codicon codicon-pulse" aria-hidden="true" />
            <span>
              <small>当前阶段</small>
              {phaseShortLabel(progress()?.phase)}
            </span>
          </div>
        </div>

        <div class="patent-radar-dialog-progress-value">
          <div>
            <div
              class="patent-radar-progress-track"
              role="progressbar"
              aria-valuenow={percent()}
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span style={{ width: `${percent()}%` }} />
            </div>
            <strong>{percent()}%</strong>
          </div>
        </div>

        <div class="patent-radar-dialog-grid">
          <section class="patent-radar-timeline" aria-label="扫描步骤">
            <div class="patent-radar-section-title">扫描步骤</div>
            <Show
              when={!props.error() && events().length}
              fallback={
                <div class="patent-radar-empty">
                  {fallback()}
                </div>
              }
            >
              <For each={events()}>
                {(event, index) => (
                  <div class="patent-radar-timeline-item">
                    <span
                      class={`patent-radar-step-marker${index() === 0 && active() ? " is-active" : ""}`}
                      aria-hidden="true"
                    >
                      <i
                        class={`codicon codicon-${index() === 0 && active() ? "loading codicon-modifier-spin" : "check"}`}
                      />
                    </span>
                    <div>
                      <strong>{event.message}</strong>
                      <span>{new Date(event.at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </section>

          <section class="patent-radar-latest" aria-label="最新候选">
            <div class="patent-radar-section-title">最新候选</div>
            <Show when={latest()} fallback={<div class="patent-radar-empty">候选通过结构校验后会显示在这里。</div>}>
              {(candidate) => (
                <div class="patent-radar-candidate-card">
                  <h4>{candidate().title}</h4>
                  <p>{candidate().technicalProblem}</p>
                  <div class="patent-radar-candidate-tags">
                    <span>{tierLabel(candidate().discoveryTier)}</span>
                    <span>{candidate().origin === "cross-file" ? "跨文件" : "单文件"}</span>
                    <span>{candidate().features.length} 项必要技术特征</span>
                    <span>{candidate().evidenceIds.length} 处证据</span>
                  </div>
                  <Show when={candidate().origin === "cross-file" && candidate().coreSourceFiles.length > 1}>
                    <div class="patent-radar-relation-chain" aria-label="跨文件证据链">
                      <i class="codicon codicon-link" aria-hidden="true" />
                      <For each={candidate().coreSourceFiles}>
                        {(file, index) => (
                          <span>
                            {index() ? "→ " : ""}
                            {file}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </section>
        </div>

        <div class="patent-radar-dialog-footer">
          <span>关闭弹窗后任务仍会继续，并在下次打开时恢复进度。</span>
          <div>
            <Button variant="secondary" onClick={() => dialog.close()}>
              后台运行
            </Button>
            <Button
              variant="secondary"
              disabled={!props.run() || props.run()?.status !== "SCANNING" || props.cancelling()}
              onClick={() => props.run() && props.onCancel(props.run()!.id)}
            >
              {props.cancelling() ? "正在取消…" : "取消扫描"}
            </Button>
            <Show when={props.run()?.status === "CANCELLED" || props.run()?.status === "FAILED"}>
              <Button variant="primary" onClick={props.onRestart}>
                重新开始扫描
              </Button>
            </Show>
            <Show when={props.error()}>
              <Button variant="secondary" onClick={props.onRetry}>
                重新读取状态
              </Button>
            </Show>
            <Button variant="primary" disabled={!props.run()?.candidates.length} onClick={props.onOpenCandidates}>
              查看候选
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

function statusSummary(
  error: string | undefined,
  loading: boolean,
  active: boolean,
  phase: NonNullable<PatentRadarRun["progress"]>["phase"] | undefined,
  status: PatentRadarRun["status"] | undefined,
) {
  if (error) return "无法读取扫描状态"
  if (loading) return "正在连接并启动后台扫描"
  if (active) return `${phaseLabel(phase)} · 后台运行中`
  return statusLabel(status)
}

function emptyMessage(error: string | undefined, loading: boolean, status: PatentRadarRun["status"] | undefined) {
  if (error) return error
  if (loading) return "正在连接 ChipMate 后台并确认扫描任务…"
  if (status === "SCANNING") return "正在等待后台写入首个进度事件…"
  return "当前没有正在运行的扫描。"
}

function phaseLabel(phase: NonNullable<PatentRadarRun["progress"]>["phase"] | undefined) {
  if (phase === "workspace-scan") return "正在清点工作区"
  if (phase === "scope-resolution") return "正在计算模块闭包"
  if (phase === "mechanism-distillation") return "正在提炼局部机制"
  if (phase === "relation-building") return "正在构建确定性关系"
  if (phase === "bridge-discovery") return "正在发现跨文件组合"
  if (phase === "bridge-verification") return "正在回查原文与关系"
  if (phase === "patent-research") return "正在检索现有技术"
  if (phase === "complete") return "扫描已完成"
  return "正在准备扫描"
}

function phaseShortLabel(phase: NonNullable<PatentRadarRun["progress"]>["phase"] | undefined) {
  if (phase === "workspace-scan") return "工作区扫描"
  if (phase === "scope-resolution") return "模块闭包"
  if (phase === "mechanism-distillation") return "机制提炼"
  if (phase === "relation-building") return "关系构建"
  if (phase === "bridge-discovery") return "跨文件组合"
  if (phase === "bridge-verification") return "原文复核"
  if (phase === "patent-research") return "专利检索"
  if (phase === "complete") return "已完成"
  return "准备中"
}

function tierLabel(tier: PatentRadarRun["candidates"][number]["discoveryTier"]) {
  if (tier === "review-ready") return "建议人工检索"
  if (tier === "technical-candidate") return "技术候选"
  return "观察项"
}

function elapsed(start: string | undefined, now: number) {
  if (!start) return "0 分 00 秒"
  const seconds = Math.max(0, Math.floor((now - new Date(start).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const tail = String(seconds % 60).padStart(2, "0")
  return `${hours ? `${hours} 小时 ` : ""}${minutes} 分 ${tail} 秒`
}

function statusLabel(status: PatentRadarRun["status"] | undefined) {
  if (status === "EXTRACTED" || status === "RESEARCHED") return "扫描已完成"
  if (status === "CANCELLED") return "扫描已取消"
  if (status === "FAILED") return "扫描失败"
  return "正在准备扫描"
}

export default PatentRadarProgressDialog
