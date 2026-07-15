import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import type { Component } from "solid-js"
import type { SpeechToText } from "./useSpeechToText"

type Props = {
  speech: SpeechToText
  disabled?: boolean
  start: () => void
  label: (key: string) => string
}

export const SpeechToTextButton: Component<Props> = (props) => {
  const disabled = () => !!props.disabled
  const label = () => {
    if (props.speech.state() === "recording") return props.label("speechToText.tooltip.stop")
    if (props.speech.state() === "transcribing") return props.label("speechToText.tooltip.transcribing")
    if (props.speech.state() === "error") return props.speech.error() || props.label("speechToText.tooltip.error")
    return props.label("speechToText.tooltip.start")
  }

  const click = () => {
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
    if (disabled()) return
    props.start()
  }

  return (
    <Tooltip value={label()} placement="top">
      <Button
        variant="ghost"
        size="small"
        onClick={click}
        disabled={disabled()}
        aria-label={label()}
        aria-pressed={props.speech.state() === "recording"}
        class={`prompt-speech-button prompt-speech-button--${props.speech.state()}`}
      >
        {props.speech.state() === "transcribing" ? (
          <Spinner style={{ width: "16px", height: "16px" }} />
        ) : (
          <span class="codicon codicon-mic prompt-speech-icon" aria-hidden="true" />
        )}
      </Button>
    </Tooltip>
  )
}
