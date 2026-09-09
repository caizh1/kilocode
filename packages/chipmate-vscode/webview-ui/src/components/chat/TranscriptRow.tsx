import { TurnChangesCard } from "./TurnChangesCard"
import { type Component, Show, createEffect } from "solid-js"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { useI18n } from "@chipmate/chipmate-ui/context/i18n"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart } from "@chipmate/sdk/v2"
import type { TranscriptRow } from "../../context/transcript-rows"
import type { TimelineHighlight } from "../../utils/timeline/highlight"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useFeedback } from "../../context/feedback"
import { AssistantMessage } from "./AssistantMessage"
import { ErrorDisplay, type ErrorDisplayProps } from "./ErrorDisplay"
import { VscodeUserMessage } from "./VscodeUserMessage"
import { CompactionStatusCard } from "./CompactionStatusCard"

interface TranscriptRowViewProps {
  row: TranscriptRow
  index?: number
  onForkMessage?: (sessionId: string, messageId: string) => void
  forkState?: { sessionID: string; afterMessageID?: string; state: "pending" | "slow" }
  readonly?: boolean
  /** Part behind the currently hovered/focused task-timeline bar, if any. */
  highlight?: () => TimelineHighlight | undefined
  activeSearch?: boolean
  activeNavigation?: boolean
  /** id of the part (tool call/reasoning block) containing the current chat
   * search match within this row, if any. */
  activeSearchPartID?: string
  /** For a multi-file apply_patch match, the specific file within that part. */
  activeSearchPartFile?: string
}

export const TranscriptRowView: Component<TranscriptRowViewProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const feedback = useFeedback()
  const i18n = useI18n()

  createEffect(() => session.hydrateParts([props.row.message.id]))

  const formatCompletionDuration = (elapsed: number) => {
    const seconds = Math.floor(elapsed / 1_000)
    const minutes = Math.floor(seconds / 60)
    if (minutes === 0) return language.t("session.turn.duration.seconds", { seconds })
    return language.t("session.turn.duration.minutes", { minutes, seconds: seconds % 60 })
  }

  return (
    <div
      class="vscode-session-turn"
      data-message={props.row.message.id}
      data-row={props.row.type}
      data-row-key={props.row.key}
      data-row-index={props.index}
      data-turn={props.row.turn}
      data-session-id={props.row.message.sessionID}
      data-live={props.row.live ? "" : undefined}
      data-search-active={props.activeSearch ? "" : undefined}
      data-navigation-active={props.activeNavigation ? "" : undefined}
      tabIndex={props.activeNavigation ? -1 : undefined}
    >
      <Show when={props.row.type === "user" ? props.row : undefined}>
        {(row) => (
          <div
            class="vscode-session-turn-user"
            data-revert-disabled={row().answered && session.status() !== "idle" ? "" : undefined}
            title={row().answered && session.status() !== "idle" ? language.t("revert.disabled.agentBusy") : undefined}
          >
            <VscodeUserMessage
              message={row().message}
              parts={row().parts}
              interrupted={row().interrupted}
              queued={row().queued}
              onDelete={
                row().queued ? () => session.deleteQueuedMessage(row().message.sessionID, row().message.id) : undefined
              }
              onRevert={
                row().answered
                  ? () => {
                      if (session.status() !== "idle") return
                      session.revertSession(row().message.id)
                    }
                  : undefined
              }
            />
          </div>
        )}
      </Show>

      <Show when={props.row.type === "assistant" ? props.row : undefined}>
        {(row) => (
          <div class="vscode-session-turn-assistant">
            <AssistantMessage
              message={row().message as unknown as SDKAssistantMessage}
              parts={row().parts as unknown as SDKPart[]}
              showAssistantCopyPartID={row().copy}
              performance={row().performance}
              fork={
                row().forkAfterMessageID && props.onForkMessage
                  ? {
                      onSelect: () => props.onForkMessage?.(row().message.sessionID, row().forkAfterMessageID!),
                      disabled:
                        props.readonly ||
                        !server.isConnected() ||
                        session.status() !== "idle" ||
                        props.forkState?.sessionID === row().message.sessionID,
                      pending:
                        props.forkState?.sessionID === row().message.sessionID &&
                        props.forkState.afterMessageID === row().forkAfterMessageID,
                      slow: props.forkState?.state === "slow",
                      title:
                        props.forkState?.sessionID === row().message.sessionID
                          ? props.forkState.state === "slow"
                            ? "仍在复制会话，请稍候"
                            : "正在创建分支"
                          : props.readonly
                            ? "只读会话不能创建分支"
                            : !server.isConnected()
                              ? "连接恢复后可创建分支"
                              : session.status() !== "idle"
                                ? "回答仍在生成，完成后可创建分支"
                                : i18n.t("ui.message.forkMessageDescription"),
                    }
                  : undefined
              }
              completion={() => {
                const elapsed = row().completionElapsed
                if (elapsed === undefined) return undefined
                return (
                  <span
                    data-component="turn-completion-duration"
                    data-agent={row().completionAgent?.trim().toLowerCase() || "default"}
                  >
                    <Icon name="circle-check" size="normal" />
                    <span data-slot="turn-completion-duration-label">
                      {language.t("session.turn.completedDuration", {
                        duration: formatCompletionDuration(elapsed),
                      })}
                    </span>
                  </span>
                )
              }}
              forceOpenPartID={props.activeSearchPartID}
              forceOpenFile={props.activeSearchPartFile}
              highlight={props.highlight}
              feedback={{
                enabled: feedback.telemetryEnabled(),
                rating: feedback.getRating(row().message.id),
                onRate: (next) =>
                  feedback.rate({
                    messageID: row().message.id,
                    sessionID: row().message.sessionID,
                    parentMessageID: row().message.parentID ?? "",
                    providerID: row().message.providerID ?? row().message.model?.providerID ?? "",
                    modelID: row().message.modelID ?? row().message.model?.modelID ?? "",
                    variant: row().message.model?.variant,
                    next,
                  }),
              }}
            />
          </div>
        )}
      </Show>

      <Show when={props.row.type === "diff" ? props.row : undefined}>
        {(row) => (
          <TurnChangesCard sessionID={row().message.sessionID} messageID={row().message.id} live={row().live} readonly={props.readonly} legacy={row().diffs.length} />
        )}
      </Show>

      <Show when={props.row.type === "error" ? props.row : undefined}>
        {(row) => <ErrorDisplay error={row().error as ErrorDisplayProps["error"]} onLogin={server.goToLogin} />}
      </Show>

      <Show when={props.row.type === "compaction" ? props.row : undefined}>
        {(row) => <CompactionStatusCard status={row().status} />}
      </Show>
    </div>
  )
}
