import * as vscode from "vscode"
import type { AutocompleteLanguageInfo } from "../autocomplete/continuedev/core/autocomplete/constants/AutocompleteLanguageInfo"
import { constructInitialPrefixSuffix } from "./constructPrefixSuffix"
import {
  prunePrefixSuffixWithTokenBudget,
  QWEN_CONTINUE_TOKEN_PRUNING_DEFAULTS,
  tokenizerSourceForModel,
  type QwenTokenPruningOptions,
  type QwenTokenizerSource,
} from "./tokenPruning"
import { qwenLanguage } from "./language"

export type QwenHelperOptions = QwenTokenPruningOptions & {
  modelName?: string
}

export type QwenAutocompleteHelperVars = {
  estimatedPrefixTokens: number
  estimatedPromptTokens: number
  estimatedSuffixTokens: number
  filepath: string
  fileContents: string
  fileLines: string[]
  fullPrefix: string
  fullSuffix: string
  helperParityMode: "continue-helpervars-token-budget"
  lang: AutocompleteLanguageInfo
  languageId: string
  pos: { line: number; character: number }
  prunedPrefix: string
  prunedCaretWindow: string
  prunedSuffix: string
  tokenizerSource: QwenTokenizerSource
  treePath: undefined
  workspaceUris: string[]
}

export const QWEN_HELPER_DEFAULTS = QWEN_CONTINUE_TOKEN_PRUNING_DEFAULTS

// Continue parity source:
// continuedev/continue@eaa23c5a9de86049dff765f635c18f61d1d043bb
// - core/autocomplete/util/HelperVars.ts
// - core/autocomplete/templating/constructPrefixSuffix.ts
// - core/llm/countTokens.ts
// qwen-direct keeps treePath undefined in Phase 2C so this does not introduce
// AST/snippets/context retrieval or wake the old autocomplete runtime.
export function createQwenAutocompleteHelper(
  document: vscode.TextDocument,
  position: vscode.Position,
  selected?: vscode.SelectedCompletionInfo,
  opts: QwenHelperOptions = QWEN_HELPER_DEFAULTS,
): QwenAutocompleteHelperVars {
  const model = opts.modelName ?? "qwen-coder-30b0"
  const fileContents = document.getText()
  const fileLines = fileContents.split("\n")
  const filepath = document.uri.fsPath || document.uri.path
  const parts = constructInitialPrefixSuffix({ document, position, selected })
  const pruned = prunePrefixSuffixWithTokenBudget(parts.prefix, parts.suffix, model, opts)
  return {
    estimatedPrefixTokens: pruned.estimatedPrefixTokens,
    estimatedPromptTokens: pruned.estimatedPromptTokens,
    estimatedSuffixTokens: pruned.estimatedSuffixTokens,
    filepath,
    fileContents,
    fileLines,
    fullPrefix: parts.prefix,
    fullSuffix: parts.suffix,
    helperParityMode: "continue-helpervars-token-budget",
    lang: qwenLanguage(filepath),
    languageId: document.languageId,
    pos: { line: position.line, character: position.character },
    prunedPrefix: pruned.prunedPrefix,
    prunedCaretWindow: pruned.prunedPrefix + pruned.prunedSuffix,
    prunedSuffix: pruned.prunedSuffix,
    tokenizerSource: tokenizerSourceForModel(model),
    treePath: undefined,
    workspaceUris: workspaceUris(),
  }
}

function workspaceUris(): string[] {
  return (
    vscode.workspace.workspaceFolders?.map((folder) => {
      const uri = folder.uri as vscode.Uri & { fsPath?: string; path?: string; toString?: () => string }
      if (uri.fsPath) return vscode.Uri.file(uri.fsPath).toString()
      if (uri.path) return vscode.Uri.file(uri.path).toString()
      if (typeof uri.toString === "function") return uri.toString()
      return ""
    }) ?? []
  ).filter((uri) => uri.length > 0)
}
