import { diagnostic } from "./diagnostics/record"
import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"

const CHANNEL = "ChipMate Memory Debug"
const LOG = "memory-debug-host.jsonl"
const LIMIT = 16 * 1024 * 1024
const LOGS = 10
const SECRET = /api.?key|authorization|token|secret|password|prompt|content|endpoint|url|header/i
const DEFER = "x-chipmate-defer-instance-dispose"

export type MemoryDebugEvent = {
  event: string
  runId?: string
  operationId?: string
  data?: Record<string, unknown>
}

let channel: vscode.OutputChannel | undefined
let dir: string | undefined
let queue = Promise.resolve()

export function initialize(context: vscode.ExtensionContext) {
  const root = context.globalStorageUri?.fsPath
  if (!root) return
  dir = path.join(root, "memory-debug")
  channel ??= vscode.window.createOutputChannel(CHANNEL)
  context.subscriptions.push(channel)
  void append({ event: "extension.memory-debug.ready", data: { directory: dir } })
}

export function directory() {
  return dir
}

export function runId() {
  return crypto.randomUUID()
}

export function header(operationId: string) {
  return { "x-chipmate-memory-operation": operationId }
}

/** Mark one custom-provider save so its server-side writes share a single final disposal. */
export function deferredHeader(operationId: string) {
  return { ...header(operationId), [DEFER]: "1" }
}

export function operation(kind: string, requestId?: string) {
  const suffix = requestId ? hash(requestId) : crypto.randomUUID().slice(0, 12)
  return `${kind}:${suffix}`
}

export function hash(value: string | undefined) {
  if (!value) return undefined
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)
}

export function append(input: MemoryDebugEvent) {
  diagnostic(input.event, { ...input.data, runId: input.runId, operationId: input.operationId }, /error|crash|fail/i.test(input.event) ? "ERROR" : "INFO", "extension.lifecycle")
  const item = {
    time: new Date().toISOString(),
    source: "extension",
    event: input.event,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.operationId ? { operationId: input.operationId } : {}),
    ...(input.data ? { data: redact(input.data) } : {}),
  }
  channel?.appendLine(JSON.stringify(item))
  if (!dir) return Promise.resolve()
  queue = queue.then(() => write(item)).catch(() => undefined)
  return queue
}

export function show() {
  channel?.show(true)
}

export function parseCrash(stderr: string[]) {
  const text = stderr.join("\n")
  const line = text.match(/Elapsed:\s*([^|]+)\|\s*User:\s*([^|]+)\|\s*Sys:\s*([^\n]+)/)
  const memory = text.match(/RSS:\s*([^|]+)\|\s*Peak:\s*([^|]+)\|\s*Commit:\s*([^|]+)/)
  return {
    ...(line ? { elapsed: line[1].trim(), user: line[2].trim(), sys: line[3].trim() } : {}),
    ...(memory ? { rss: memory[1].trim(), peak: memory[2].trim(), commit: memory[3].trim() } : {}),
  }
}

export function redact(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SECRET.test(key) || /config$/i.test(key)) continue
    if (typeof value === "string") {
      output[key] = redactText(value)
      continue
    }
    if (Array.isArray(value)) {
      output[key] = value.map((item) => (typeof item === "string" ? redactText(item) : item))
      continue
    }
    output[key] = value && typeof value === "object" ? redact(value as Record<string, unknown>) : value
  }
  return output
}

export function redactText(value: string) {
  return value
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/([?&](?:api_?key|token|secret|key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b[A-Za-z0-9._~+/=-]{32,}\b/g, "[redacted]")
    .slice(0, 4096)
}

async function write(item: Record<string, unknown>) {
  if (!dir) return
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, LOG)
  const stat = await fs.stat(file).catch(() => undefined)
  if (stat && stat.size >= LIMIT) {
    for (let index = LOGS - 1; index >= 1; index--) {
      const source = `${file}.${index}`
      const target = `${file}.${index + 1}`
      if (index === LOGS - 1) await fs.rm(target, { force: true })
      await fs.rename(source, target).catch(() => undefined)
    }
    await fs.rename(file, `${file}.1`)
  }
  await fs.appendFile(file, `${JSON.stringify(item)}\n`, "utf8")
}
