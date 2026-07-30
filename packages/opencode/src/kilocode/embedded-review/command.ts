import type { Command } from "@/command"
import { KilocodeSystemPrompt } from "@/kilocode/system-prompt"
import PROMPT from "./embedded-review.txt"

export const name = "embedded-review"

export function embeddedReviewCommand(): Command.Info {
  return {
    name,
    description: "审查 C/C++ 固件变更 [uncommitted|commit]",
    template: KilocodeSystemPrompt.brand(PROMPT),
    hints: ["$ARGUMENTS"],
  }
}

export function isEmbeddedReviewCommand(command: string | undefined) {
  return command === name
}
