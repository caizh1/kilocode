import { createMemo, Match, Switch, type JSX } from "solid-js"
import { SplitBorder } from "@tui/ui/border"
import { useTheme } from "@tui/context/theme"
import { parseChipMateErrorCode, chipmateErrorTitle, chipmateErrorDescription } from "@/chipmate/chipmate-errors"
import type { AssistantMessage } from "@chipmate/sdk/v2"

interface ChipMateErrorBlockProps {
  error: NonNullable<AssistantMessage["error"]>
  fallback: JSX.Element
}

export function ChipMateErrorBlock(props: ChipMateErrorBlockProps) {
  const { theme } = useTheme()

  const chipmateErrorCode = createMemo(() => {
    return parseChipMateErrorCode(props.error)
  })

  const title = createMemo(() => {
    const code = chipmateErrorCode()
    return code ? chipmateErrorTitle(code) : undefined
  })

  const description = createMemo(() => {
    const code = chipmateErrorCode()
    return code ? chipmateErrorDescription(code) : undefined
  })

  return (
    <Switch fallback={props.fallback}>
      <Match when={chipmateErrorCode()}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.primary}
        >
          <text fg={theme.text}>{title()}</text>
          <text fg={theme.textMuted}>{description()}</text>
          <text fg={theme.primary}>{"Run /connect or `chipmate auth login` to connect to ChipMate Gateway"}</text>
        </box>
      </Match>
    </Switch>
  )
}
