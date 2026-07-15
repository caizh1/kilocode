import path from "node:path"
import os from "node:os"
import * as vscode from "vscode"

const EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".py", ".pyi", ".sh"])
const HEADER_EXTENSIONS = new Set([".h", ".hpp"])
const WORKFLOW_EXTENSIONS = new Set([".yml", ".yaml"])
const NON_CODE_LANGUAGE_IDS = new Set(["markdown", "json", "jsonc", "log", "txt"])

export type QwenPrefilterReason =
  | "none"
  | "empty-document"
  | "empty-untitled"
  | "non-file-scheme"
  | "unsupported-extension"
  | "workflow-outside-gitea"
  | "unsupported-language"
  | "plaintext-non-header"
  | "continue-config"

export type QwenPrefilterDecision = {
  extension: string
  languageId: string
  prefiltered: boolean
  reason: QwenPrefilterReason
}

export const QWEN_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { scheme: "file", language: "c" },
  { scheme: "file", language: "cpp" },
  { scheme: "file", pattern: "**/*.c" },
  { scheme: "file", pattern: "**/*.cc" },
  { scheme: "file", pattern: "**/*.cpp" },
  { scheme: "file", pattern: "**/*.cxx" },
  { scheme: "file", pattern: "**/*.h" },
  { scheme: "file", pattern: "**/*.hpp" },
  { scheme: "file", pattern: "**/*.py" },
  { scheme: "file", pattern: "**/*.pyi" },
  { scheme: "file", pattern: "**/*.sh" },
  { scheme: "file", pattern: "**/.gitea/workflows/*.yml" },
  { scheme: "file", pattern: "**/.gitea/workflows/*.yaml" },
  { scheme: "file", pattern: "**/.gitea/workflows/**/*.yml" },
  { scheme: "file", pattern: "**/.gitea/workflows/**/*.yaml" },
]

export function isQwenSupportedDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== "file") return false
  const file = document.uri.fsPath || document.uri.path
  const ext = path.extname(file).toLowerCase()
  if (!EXTENSIONS.has(ext) && !(WORKFLOW_EXTENSIONS.has(ext) && isGiteaWorkflow(file))) return false
  if (NON_CODE_LANGUAGE_IDS.has(document.languageId)) return false
  if (document.languageId === "plaintext" && !HEADER_EXTENSIONS.has(ext)) return false
  return true
}

export function shouldPrefilterQwenDocument(document: vscode.TextDocument): boolean {
  return decideQwenPrefilter(document).prefiltered
}

export function decideQwenPrefilter(document: vscode.TextDocument): QwenPrefilterDecision {
  const ext = path.extname(document.uri.fsPath || document.uri.path).toLowerCase()
  const reason = prefilterReason(document, ext)
  return {
    extension: ext,
    languageId: document.languageId,
    prefiltered: reason !== "none",
    reason,
  }
}

function prefilterReason(document: vscode.TextDocument, ext: string): QwenPrefilterReason {
  if (isContinueConfigJson(document)) return "continue-config"
  if (document.uri.scheme !== "file") {
    if (document.uri.scheme === "untitled" && empty(document)) return "empty-untitled"
    return "non-file-scheme"
  }
  if (empty(document)) return "empty-document"
  if (!EXTENSIONS.has(ext) && !WORKFLOW_EXTENSIONS.has(ext)) return "unsupported-extension"
  if (WORKFLOW_EXTENSIONS.has(ext) && !isGiteaWorkflow(document.uri.fsPath || document.uri.path)) {
    return "workflow-outside-gitea"
  }
  if (NON_CODE_LANGUAGE_IDS.has(document.languageId)) return "unsupported-language"
  if (document.languageId === "plaintext" && !HEADER_EXTENSIONS.has(ext)) return "plaintext-non-header"
  return "none"
}

function isGiteaWorkflow(file: string): boolean {
  const parts = file.replaceAll("\\", "/").toLowerCase().split("/")
  return parts.some((part, index) => part === ".gitea" && parts[index + 1] === "workflows" && index + 2 < parts.length)
}

function isContinueConfigJson(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== "file") return false
  return path.resolve(document.uri.fsPath) === continueConfigJsonPath()
}

function continueConfigJsonPath(): string {
  const dir = process.env.CONTINUE_GLOBAL_DIR
  const root = dir ? path.resolve(dir) : path.join(os.homedir(), ".continue")
  return path.resolve(root, "config.json")
}

function empty(document: vscode.TextDocument): boolean {
  const count = document.lineCount
  if (count <= 0) return true
  return count === 1 && document.lineAt(0).text.trim() === ""
}
