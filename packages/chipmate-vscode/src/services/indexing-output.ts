import * as vscode from "vscode"
import type { IndexingStatus } from "./cli-backend/types"

type IndexingPipelineStatus = NonNullable<NonNullable<IndexingStatus["pipelines"]>["rag"]>
type IndexingDiagnostic = NonNullable<IndexingPipelineStatus["recentErrors"]>[number]
type IndexingNotice = NonNullable<IndexingStatus["notices"]>[number]

const CHANNEL = "ChipMate Indexing"
const OPEN_INDEXING_OUTPUT = "Open Indexing Output"
const UNKNOWN = "Unknown indexing error"
const INDEXING_STDERR_PATTERN =
  /\b(indexing|embedder|embedding|code\s*graph|codegraph|rag|document|documents|pdf|docx|xlsx|ods|lancedb|tree-sitter|treesitter|ripgrep|rg(?:\.exe)?|file\s*watcher|watcher|indexing-worker|worker)\b/i

let channel: vscode.OutputChannel | undefined
let wired = false
let ready = false
const seen = new Set<string>()
const seenNotices = new Set<string>()

export function indexingOutput(context: vscode.ExtensionContext): vscode.OutputChannel {
  const output = channel ?? vscode.window.createOutputChannel(CHANNEL)
  channel = output
  if (!ready) {
    ready = true
    output.appendLine(
      `[${new Date().toISOString()}] ChipMate Indexing diagnostics ready. WARN/ERROR lines and cleanup summaries from indexing will appear here.`,
    )
  }
  if (!wired && context.subscriptions) {
    wired = true
    context.subscriptions.push({
      dispose() {
        output.dispose()
        if (channel === output) channel = undefined
        wired = false
        ready = false
        seen.clear()
        seenNotices.clear()
      },
    })
  }
  return output
}

export function isIndexingDiagnosticLine(line: string): boolean {
  return INDEXING_STDERR_PATTERN.test(stripAnsi(line))
}

export function appendIndexingStderr(context: vscode.ExtensionContext, output: string): void {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && isIndexingDiagnosticLine(line))
  if (lines.length === 0) return

  const out = indexingOutput(context)
  for (const line of lines) out.appendLine(line)
}

export function recordIndexingStatus(context: vscode.ExtensionContext, status: IndexingStatus): void {
  recordIndexingNotices(context, status)
  if (!hasIssue(status)) return

  const key = statusKey(status)
  if (seen.has(key)) return
  seen.add(key)

  const out = indexingOutput(context)
  for (const line of formatIndexingStatus(status)) out.appendLine(line)
}

function recordIndexingNotices(context: vscode.ExtensionContext, status: IndexingStatus): void {
  const notices = status.notices ?? []
  for (const notice of notices) {
    if (seenNotices.has(notice.id)) continue
    seenNotices.add(notice.id)

    const out = indexingOutput(context)
    out.appendLine(`[${new Date().toISOString()}] Indexing notice: ${notice.level} - ${notice.message}`)
    showNotice(context, notice)
  }
}

function showNotice(context: vscode.ExtensionContext, notice: IndexingNotice): void {
  if (notice.action === "openIndexingOutput") {
    const action = OPEN_INDEXING_OUTPUT
    const done = (choice: string | undefined) => {
      if (choice === action) indexingOutput(context).show(true)
    }
    if (notice.level === "warning") {
      void vscode.window.showWarningMessage(notice.message, action).then(done)
      return
    }
    void vscode.window.showInformationMessage(notice.message, action).then(done)
    return
  }
  if (notice.level === "warning") {
    void vscode.window.showWarningMessage(notice.message)
    return
  }
  void vscode.window.showInformationMessage(notice.message)
}

export function formatIndexingStatus(status: IndexingStatus): string[] {
  const lines = [
    `[${new Date().toISOString()}] Indexing status: ${status.state} - ${fallback(status.message, UNKNOWN)}`,
  ]
  const pipes = status.pipelines
  if (!pipes) return lines

  lines.push(...pipelineLines("Code Graph", pipes.codeGraph, status))
  lines.push(...pipelineLines("RAG", pipes.rag, status))
  if (pipes.documents) lines.push(...pipelineLines("Documents", pipes.documents, status))
  return lines
}

function pipelineLines(label: string, pipe: IndexingPipelineStatus, root: IndexingStatus): string[] {
  const detail = fallback(pipe.detail, pipe.message, root.message, UNKNOWN)
  const lines = [
    `${label}: ${pipe.state}; detail=${detail}; issues=${pipe.errorCount} errors, ${pipe.staleCount} stale, ${pipe.skippedCount} skipped`,
  ]
  const errors = pipe.recentErrors ?? []
  if (errors.length > 0) {
    lines.push(...errors.map((err) => `${label} recent error: ${formatDiagnostic(err, pipe, root)}`))
    return lines
  }
  if (pipe.state === "Error" || pipe.errorCount > 0) {
    lines.push(`${label} recent error: ${detail}`)
  }
  return lines
}

function formatDiagnostic(err: IndexingDiagnostic, pipe: IndexingPipelineStatus, root: IndexingStatus): string {
  const file = fallback(err.file)
  const loc = `${fallback(err.source, "indexing")}:${fallback(err.location, "unknown")}`
  const path = file ? ` file=${file}` : ""
  return `${fallback(err.time, new Date().toISOString())} ${loc}${path} - ${fallback(
    err.message,
    pipe.detail,
    pipe.message,
    root.message,
    UNKNOWN,
  )}`
}

function hasIssue(status: IndexingStatus): boolean {
  const pipes = status.pipelines
  if (status.state === "Error") return true
  return [pipes?.codeGraph, pipes?.rag, pipes?.documents].some(
    (pipe) =>
      pipe?.state === "Error" ||
      (pipe?.errorCount ?? 0) > 0 ||
      (pipe?.staleCount ?? 0) > 0 ||
      (pipe?.recentErrors?.length ?? 0) > 0,
  )
}

function statusKey(status: IndexingStatus): string {
  return JSON.stringify({
    state: status.state,
    message: fallback(status.message),
    codeGraph: pipelineKey(status.pipelines?.codeGraph, status),
    rag: pipelineKey(status.pipelines?.rag, status),
    documents: pipelineKey(status.pipelines?.documents, status),
  })
}

function pipelineKey(pipe: IndexingPipelineStatus | undefined, root: IndexingStatus) {
  if (!pipe) return undefined
  return {
    state: pipe.state,
    detail: fallback(pipe.detail, pipe.message, root.message),
    errorCount: pipe.errorCount,
    staleCount: pipe.staleCount,
    skippedCount: pipe.skippedCount,
    recentErrors: pipe.recentErrors?.map((err) => ({
      time: fallback(err.time),
      source: fallback(err.source),
      location: fallback(err.location),
      message: fallback(err.message, pipe.detail, pipe.message, root.message, UNKNOWN),
      file: fallback(err.file),
    })),
  }
}

function fallback(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? ""
}

function stripAnsi(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/g, "")
}
