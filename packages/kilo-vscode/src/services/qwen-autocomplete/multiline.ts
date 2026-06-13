import * as vscode from "vscode"
import type { QwenAutocompleteHelperVars } from "./helperVars"
import type { QwenMultilineCompletions } from "./types"

export type QwenMultilineInput = {
  helper: QwenAutocompleteHelperVars
  position: vscode.Position
  selected?: vscode.SelectedCompletionInfo
  multilineCompletions?: QwenMultilineCompletions
}

const COMMENT = "//"

// Continue parity source: commit eaa23c5a9de86049dff765f635c18f61d1d043bb
// - core/autocomplete/classification/shouldCompleteMultiline.ts
// - core/autocomplete/constants/AutocompleteLanguageInfo.ts
// qwen-direct only targets C/C++/headers, so this keeps the lightweight C/C++
// language info needed by shouldCompleteMultiline.
export function shouldCompleteMultilineQwen(input: QwenMultilineInput): boolean {
  const mode = input.multilineCompletions ?? "auto"
  if (mode === "always") return true
  if (mode === "never") return false
  if (input.selected) return true

  const line = input.helper.fullPrefix.split("\n").slice(-1)[0] ?? ""
  if (line.trimStart().startsWith(COMMENT)) return false

  return true
}
