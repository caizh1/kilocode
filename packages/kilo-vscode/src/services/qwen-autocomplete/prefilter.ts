import path from "node:path"
import * as vscode from "vscode"

const EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"])
const HEADER_EXTENSIONS = new Set([".h", ".hpp"])
const NON_CODE_LANGUAGE_IDS = new Set(["markdown", "json", "jsonc", "log", "txt"])

export const QWEN_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { scheme: "file", language: "c" },
  { scheme: "file", language: "cpp" },
  { scheme: "file", pattern: "**/*.c" },
  { scheme: "file", pattern: "**/*.cc" },
  { scheme: "file", pattern: "**/*.cpp" },
  { scheme: "file", pattern: "**/*.cxx" },
  { scheme: "file", pattern: "**/*.h" },
  { scheme: "file", pattern: "**/*.hpp" },
]

export function isQwenSupportedDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== "file") return false
  const ext = path.extname(document.uri.fsPath).toLowerCase()
  if (!EXTENSIONS.has(ext)) return false
  if (NON_CODE_LANGUAGE_IDS.has(document.languageId)) return false
  if (document.languageId === "plaintext" && !HEADER_EXTENSIONS.has(ext)) return false
  return true
}

export function shouldPrefilterQwenDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme === "untitled" && document.getText().trim() === "") return true
  return !isQwenSupportedDocument(document)
}
