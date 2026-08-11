// chipmate_change - new file

/**
 * ChipMateClaw Setup Dialog
 *
 * Shown when the user has no ChipMateClaw instance provisioned.
 * Provides links to set up an instance and learn more.
 */

import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { Link } from "@tui/ui/link"

export function DialogClawSetup(props: { orgId?: string | null }) {
  const { theme } = useTheme()
  const dialog = useDialog()

  const url = props.orgId ? `https://app.chipmate.ai/organizations/${props.orgId}/claw` : "https://app.chipmate.ai/claw"

  useKeyboard((evt: any) => {
    if (evt.name === "return") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          ChipMateClaw
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <box paddingBottom={1} gap={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Personal AI for everyday life
        </text>

        <text fg={theme.textMuted} wrapMode="word">
          ChipMateClaw gives you a personal AI that reads email, manages your calendar, monitors your projects, and lives in
          Telegram, Slack — whatever you already use.
        </text>

        <text fg={theme.textMuted} wrapMode="word">
          No app to install. No new interface to learn. Just message it like a friend.
        </text>

        <box flexDirection="row" marginTop={1}>
          <Link href="https://chipmate.ai/chipmateclaw" fg={theme.text}>
            Learn more
          </Link>
        </box>
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} flexDirection="row">
          <text fg={theme.text}>{"🦀 "}</text>
          <Link href={url} fg={theme.selectedListItemText}>
            Try ChipMateClaw
          </Link>
        </box>
      </box>
    </box>
  )
}
