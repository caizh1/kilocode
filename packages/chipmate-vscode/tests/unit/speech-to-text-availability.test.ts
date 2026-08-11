import { describe, expect, it } from "bun:test"
import {
  canUseSpeechToText,
  selectedSpeechToTextModel,
} from "../../webview-ui/src/components/speech-to-text/availability"
import { DEFAULT_SPEECH_TO_TEXT_MODEL } from "../../src/speech-to-text/models"

describe("speech-to-text availability", () => {
  it("shows speech input for stored ChipMate credentials", () => {
    expect(canUseSpeechToText({}, { chipmate: "oauth" })).toBe(true)
    expect(canUseSpeechToText({}, { chipmate: "api" })).toBe(true)
  })

  it("hides speech input without usable ChipMate credentials", () => {
    expect(canUseSpeechToText({}, {})).toBe(false)
    expect(canUseSpeechToText({}, { chipmate: "wellknown" })).toBe(false)
  })

  it("honors enabled and disabled provider configuration", () => {
    expect(canUseSpeechToText({ disabled_providers: ["chipmate"] }, { chipmate: "oauth" })).toBe(false)
    expect(canUseSpeechToText({ enabled_providers: ["openai"] }, { chipmate: "oauth" })).toBe(false)
    expect(canUseSpeechToText({ enabled_providers: ["chipmate"] }, { chipmate: "oauth" })).toBe(true)
  })

  it("normalizes configured and unknown transcription models", () => {
    expect(selectedSpeechToTextModel({ experimental: { speech_to_text_model: "google/chirp-3" } })).toBe(
      "google/chirp-3",
    )
    expect(selectedSpeechToTextModel({ experimental: { speech_to_text_model: "unknown/model" } })).toBe(
      DEFAULT_SPEECH_TO_TEXT_MODEL.id,
    )
  })
})
