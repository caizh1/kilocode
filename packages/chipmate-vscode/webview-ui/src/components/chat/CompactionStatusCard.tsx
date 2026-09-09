/** @jsxImportSource solid-js */
import { type Component, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { Progress } from "@chipmate/chipmate-ui/progress"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { compactionDisplayState, type CompactionStatus, type CompactionState } from "../../context/compaction-activity"
import { formatWorkingElapsed } from "../shared/working-indicator-utils"

interface CompactionStatusCardProps {
  status: CompactionStatus
}

export const CompactionStatusCard: Component<CompactionStatusCardProps> = (props) => {
  const language = useLanguage()
  const session = useSession()
  const [now, setNow] = createSignal(Date.now())

  createEffect(() => {
    if (props.status.state !== "running") return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => clearInterval(timer))
  })

  const state = createMemo(() => compactionDisplayState(props.status, session.statusInfo(), now()))
  const running = () => state() === "running"
  const retryingWithoutThinking = () =>
    running() && (props.status.phase === "retrying" || props.status.attemptMode === "none")
  const completed = () => props.status.completedUnits ?? 0
  const total = () => props.status.totalUnits ?? 0
  const determinate = () => running() && total() >= 2 && completed() <= total()
  const percent = () => (determinate() ? Math.min(100, Math.floor((completed() / total()) * 100)) : undefined)
  const elapsedSeconds = () => {
    const end = props.status.completedAt ?? now()
    return Math.max(0, Math.floor((end - props.status.startedAt) / 1_000))
  }
  const elapsed = () => formatWorkingElapsed(elapsedSeconds(), language.t)

  const title = () => {
    if (state() === "running") {
      if (retryingWithoutThinking()) return language.t("session.compaction.retryingWithoutThinking")
      if (session.statusInfo().type === "retry") return language.t("session.compaction.status.retrying")
      return language.t(
        props.status.source === "auto" ? "session.compaction.status.autoRunning" : "session.compaction.status.running",
      )
    }
    if (state() === "succeeded") {
      return language.t(
        props.status.source === "auto"
          ? "session.compaction.status.autoSucceeded"
          : "session.compaction.status.succeeded",
      )
    }
    if (state() === "interrupted") return language.t("session.compaction.status.interrupted")
    return language.t("session.compaction.status.failed")
  }

  const phaseDescription = () => {
    if (props.status.activity === "splitting") return language.t("session.compaction.phase.splitting")
    if (props.status.phase === "preparing") return language.t("session.compaction.phase.preparing")
    if (props.status.phase === "generating") return language.t("session.compaction.phase.generating")
    if (props.status.phase === "chunk") return language.t("session.compaction.phase.chunk")
    if (props.status.phase === "reduce")
      return language.t("session.compaction.phase.reduce", { depth: (props.status.reduceDepth ?? 0) + 1 })
    if (props.status.phase === "replay") return language.t("session.compaction.phase.replay")
    if (props.status.phase === "retrying") return language.t("session.compaction.phase.retrying")
    return language.t("session.compaction.phase.committing")
  }

  const description = () => {
    if (state() === "running") return phaseDescription()
    if (state() === "succeeded") return language.t("session.compaction.status.succeededDescription")
    if (state() === "interrupted") return language.t("session.compaction.status.interruptedDescription")
    return language.t("session.compaction.status.failedDescription")
  }

  const icon = (value: CompactionState) => {
    if (value === "succeeded") return "circle-check" as const
    if (value === "failed") return "circle-x" as const
    if (value === "interrupted") return "warning" as const
    return "layers" as const
  }

  const progressLabel = () => {
    if (!determinate()) return title()
    return language.t("session.compaction.progress.stage", {
      completed: completed(),
      total: total(),
      percent: percent() ?? 0,
    })
  }

  return (
    <div
      class="compaction-status-card"
      data-state={state()}
      data-source={props.status.source}
      role="status"
      aria-atomic="true"
    >
      <div class="compaction-status-title">
        <Icon name={icon(state())} size="small" />
        <span>{title()}</span>
      </div>
      <div class="compaction-status-description">{description()}</div>
      <div class="compaction-status-meta">
        <Show when={determinate()}>
          <span>{progressLabel()}</span>
        </Show>
        <span>
          {language.t(running() ? "session.compaction.elapsed.running" : "session.compaction.elapsed.completed", {
            duration: elapsed(),
          })}
        </span>
      </div>
      <Show when={running()}>
        <Progress
          class="compaction-status-progress"
          indeterminate={!determinate()}
          value={determinate() ? completed() : undefined}
          minValue={0}
          maxValue={determinate() ? total() : undefined}
          hideLabel
        >
          {progressLabel()}
        </Progress>
      </Show>
    </div>
  )
}
