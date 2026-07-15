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

export const SpeechToTextButton: Component<Props> = (props) => {
  const unavailable = () => !!props.disabled && props.speech.state() === "idle"
  const locked = () => unavailable() || props.speech.state() === "starting"
  const busy = () => props.speech.state() === "starting" || props.speech.state() === "transcribing"
  const label = () => {
    if (props.speech.state() === "starting") return props.label("speechToText.tooltip.starting")
    if (props.speech.state() === "recording") return props.label("speechToText.tooltip.stop")
    if (props.speech.state() === "transcribing") return props.label("speechToText.tooltip.transcribing")
    if (props.speech.state() === "error") return props.speech.error() || props.label("speechToText.tooltip.error")
    return props.label("speechToText.tooltip.start")
  }

  const click = () => {
    if (props.speech.state() === "starting") return
    if (props.speech.state() === "recording") {
      props.speech.stop()
      return
    }
    if (props.speech.state() === "transcribing") {
      props.speech.cancel()
      return
    }
    if (props.speech.state() === "error") {
      props.speech.clear()
      return
    }
    if (unavailable()) return
    props.start()
  }

  onCleanup(() => {
    if (props.speech.active()) props.speech.cancel()
  })

  return (
    <Tooltip value={label()} placement="top">
      <Button
        variant="ghost"
        size="small"
        onClick={click}
        disabled={locked()}
        aria-label={label()}
        aria-disabled={locked()}
        aria-busy={busy()}
        aria-pressed={props.speech.state() === "recording"}
        class={`prompt-speech-button prompt-speech-button--${props.speech.state()}`}
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
