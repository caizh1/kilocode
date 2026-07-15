import path from "node:path"
import {
  languageForFilepath,
  type AutocompleteLanguageInfo,
} from "../autocomplete/continuedev/core/autocomplete/constants/AutocompleteLanguageInfo"

const SHELL: AutocompleteLanguageInfo = {
  name: "Shell",
  topLevelKeywords: ["function"],
  singleLineComment: "#",
  endOfLine: [";;"],
}

export function qwenLanguage(file: string): AutocompleteLanguageInfo {
  if (path.extname(file).toLowerCase() === ".sh") return SHELL
  return languageForFilepath(file)
}

export function qwenLanguageId(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".c" || ext === ".h") return "c"
  if (ext === ".py" || ext === ".pyi") return "python"
  if (ext === ".sh") return "shellscript"
  if (ext === ".yml" || ext === ".yaml") return "yaml"
  return "cpp"
}
