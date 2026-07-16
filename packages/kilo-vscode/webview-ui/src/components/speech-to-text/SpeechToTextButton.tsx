import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { onCleanup, type Component } from "solid-js"
import type { SpeechToText } from "./useSpeechToText"

type Props = {
  speech: SpeechToText
  disabled?: boolean
  start: () => void
  label: (key: string) => string
}

const unavailable = (speech: SpeechToText, disabled?: boolean) => !!disabled && speech.state() === "idle"

export const speechAction = {
  unavailable,
  locked(speech: SpeechToText, disabled?: boolean) {
    return unavailable(speech, disabled) || speech.state() === "starting"
  },
  busy(speech: SpeechToText) {
    return speech.state() === "starting" || speech.state() === "transcribing"
  },
  label(speech: SpeechToText, label: (key: string) => string) {
    if (speech.state() === "starting") return label("speechToText.tooltip.starting")
    if (speech.state() === "recording") return label("speechToText.tooltip.stop")
    if (speech.state() === "transcribing") return label("speechToText.tooltip.transcribing")
    if (speech.state() === "error") return speech.error() || label("speechToText.tooltip.error")
    return label("speechToText.tooltip.start")
  },
  run(speech: SpeechToText, disabled: boolean | undefined, start: () => void) {
    if (speech.state() === "starting") return
    if (speech.state() === "recording") {
      speech.stop()
      return
    }
    if (speech.state() === "transcribing") {
      speech.cancel()
      return
    }
    if (speech.state() === "error") {
      speech.clear()
      return
    }
    if (unavailable(speech, disabled)) return
    start()
  },
}

export const SpeechToTextButton: Component<Props> = (props) => {
  const locked = () => speechAction.locked(props.speech, props.disabled)
  const busy = () => speechAction.busy(props.speech)
  const label = () => speechAction.label(props.speech, props.label)

  onCleanup(() => {
    if (props.speech.active()) props.speech.cancel()
  })

  return (
    <Tooltip value={label()} placement="top">
      <Button
        variant="ghost"
        size="small"
        onClick={() => speechAction.run(props.speech, props.disabled, props.start)}
        disabled={locked()}
        aria-label={label()}
        aria-disabled={locked()}
        aria-busy={busy()}
        aria-pressed={props.speech.state() === "recording"}
        class={`prompt-speech-button prompt-speech-button--${props.speech.state()}`}
        data-ui="qa-action-speech"
      >
        {busy() ? (
          <Spinner style={{ width: "16px", height: "16px" }} />
        ) : (
          <span class="codicon codicon-mic prompt-speech-icon" aria-hidden="true" />
        )}
      </Button>
    </Tooltip>
  )
}
