import { type Component, For, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { recentSessions } from "../../context/session-utils"
import { formatRelativeDate } from "../../utils/date"
import { FeedbackDialog } from "./FeedbackDialog"
import { ChipMateLogo } from "../shared/ChipMateLogo"

interface WelcomeEmptyStateProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
}

export const WelcomeEmptyState: Component<WelcomeEmptyStateProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const dialog = useDialog()
  const recent = () => recentSessions(session.sessions())

  return (
    <div class="message-list-empty">
      <ChipMateLogo class="kilo-logo" welcome />
      <h1 class="kilo-product-title">ChipMate</h1>
      <p class="kilo-about-text">{language.t("session.messages.welcome")}</p>
      <Show when={recent().length > 0 && props.onSelectSession}>
        <div class="recent-sessions">
          <span class="recent-sessions-label">{language.t("session.recent")}</span>
          <div class="recent-session-list">
            <For each={recent()}>
              {(item) => (
                <button class="recent-session-item" onClick={() => props.onSelectSession?.(item.id)}>
                  <span class="recent-session-title" dir="auto">
                    {item.title || language.t("session.untitled")}
                  </span>
                  <span class="recent-session-date">{formatRelativeDate(item.updatedAt)}</span>
                </button>
              )}
            </For>
            <Show when={props.onShowHistory}>
              <button class="show-history-btn" onClick={() => props.onShowHistory?.()}>
                <Icon name="history" size="small" />
                {language.t("session.showHistory")}
              </button>
            </Show>
          </div>
        </div>
      </Show>
      <button class="feedback-button" onClick={() => dialog.show(() => <FeedbackDialog />)}>
        <Icon name="bubble-5" size="small" />
        {language.t("feedback.button")}
      </button>
    </div>
  )
}
