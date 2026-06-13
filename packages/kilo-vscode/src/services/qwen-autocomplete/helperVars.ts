import * as vscode from "vscode"
import { constructInitialPrefixSuffix } from "./constructPrefixSuffix"
import {
  prunePrefixSuffixWithApproximateTokens,
  QWEN_APPROXIMATE_TOKEN_PRUNING_DEFAULTS,
  type QwenApproximateTokenPruningOptions,
} from "./tokenPruning"

export type QwenAutocompleteHelperVars = {
  filepath: string
  fileContents: string
  fileLines: string[]
  fullPrefix: string
  fullSuffix: string
  prunedPrefix: string
  prunedSuffix: string
}

export const QWEN_HELPER_DEFAULTS = QWEN_APPROXIMATE_TOKEN_PRUNING_DEFAULTS

// HelperVars-lite for current-file qwen-direct only. This ports Continue's
// constructInitialPrefixSuffix + HelperVars.prunePrefixSuffix flow, but token
// counting is the local approximation from tokenPruning.ts. No
// AST/treePath/snippets/context retrieval/cache are included in this phase.
export function createQwenAutocompleteHelper(
  document: vscode.TextDocument,
  position: vscode.Position,
  selected?: vscode.SelectedCompletionInfo,
  opts: QwenApproximateTokenPruningOptions = QWEN_HELPER_DEFAULTS,
): QwenAutocompleteHelperVars {
  const fileContents = document.getText()
  const fileLines = fileContents.split("\n")
  const parts = constructInitialPrefixSuffix({ document, position, selected })
  const pruned = prunePrefixSuffixWithApproximateTokens(parts.prefix, parts.suffix, opts)
  return {
    filepath: document.uri.fsPath || document.uri.path,
    fileContents,
    fileLines,
    fullPrefix: parts.prefix,
    fullSuffix: parts.suffix,
    prunedPrefix: pruned.prunedPrefix,
    prunedSuffix: pruned.prunedSuffix,
  }
}
