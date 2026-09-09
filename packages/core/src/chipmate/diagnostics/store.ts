import { constants } from "node:fs"
import { appendFile, mkdir, readdir, lstat, open, unlink } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { anonymous, diagnosticMessage, sanitize } from "./redact"

export const RETENTION = 7 * 86400_000
export const STORE_LIMIT = 100 * 1024 * 1024
const CHUNK = 2 * 1024 * 1024
export interface DiagnosticRecord {
  time: string
  source: string
  level: "INFO" | "WARN" | "ERROR"
  event: string
  runId: string
  workspaceId: string
  data?: unknown
}
export interface DiagnosticContext { root: string; source: string; workspace: string; salt: string; runId?: string }

export class DiagnosticStore {
  readonly runId: string
  readonly workspaceId: string
  private queue = Promise.resolve()
  private pending = 0
  private bytes = 0
  private chunk = 0
  private dropped = 0
  private failure?: string
  private initialized = false
  constructor(readonly context: DiagnosticContext) {
    this.runId = context.runId ?? randomUUID()
    this.workspaceId = anonymous(context.workspace, context.salt)
  }
  append(event: string, data?: unknown, level: DiagnosticRecord["level"] = "INFO", source = this.context.source) {
    const record: DiagnosticRecord = {
      time: new Date().toISOString(), source: source.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64), level,
      event: diagnosticMessage(event, this.context.salt), runId: this.runId, workspaceId: this.workspaceId,
      data: sanitize(data, this.context.salt),
    }
    const line = JSON.stringify(record) + "\n"
    const size = Buffer.byteLength(line)
    if (this.pending + size > 4 * 1024 * 1024 || size > CHUNK) { this.dropped++; return }
    this.pending += size
    this.queue = this.queue.then(async () => {
      await mkdir(this.context.root, { recursive: true, mode: 0o700 })
      const directory = await lstat(this.context.root)
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("诊断目录不可为链接")
      if (!this.initialized || this.bytes + size > CHUNK) {
        await prune(this.context.root)
        if (this.initialized) this.chunk++
        this.bytes = 0
        this.initialized = true
      }
      const file = join(this.context.root, `${this.runId}-${process.pid}-${this.chunk}.jsonl`)
      const handle = await open(file, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600)
      try { await handle.writeFile(line); this.bytes += size } finally { await handle.close() }
    }).catch((err: unknown) => { this.failure = diagnosticMessage(err instanceof Error ? err.message : String(err)); this.dropped++ })
      .finally(() => { this.pending -= size })
  }
  async flush() { await this.queue; return { dropped: this.dropped, error: this.failure } }
}

export async function prune(root: string, now = Date.now()) {
  const entries = await files(root)
  let bytes = entries.reduce((sum, item) => sum + item.size, 0)
  for (const item of entries.sort((a, b) => a.time - b.time)) {
    if (item.time >= now - RETENTION && bytes <= STORE_LIMIT - CHUNK) break
    await unlink(join(root, item.name)).catch((err: NodeJS.ErrnoException) => { if (err.code !== "ENOENT") throw err })
    bytes -= item.size
  }
}

async function files(root: string) {
  const names = await readdir(root).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return []; throw err })
  const result: { name: string; time: number; size: number }[] = []
  for (const name of names) {
    if (!/^[a-f0-9-]+-\d+-\d+\.jsonl$/.test(name)) continue
    const stat = await lstat(join(root, name)).catch(() => undefined)
    if (stat?.isFile() && !stat.isSymbolicLink()) result.push({ name, time: stat.mtimeMs, size: stat.size })
  }
  return result
}

export async function snapshot(root: string, workspaceId: string, from: number, to: number, signal: AbortSignal) {
  const records: DiagnosticRecord[] = []
  let malformed = 0
  let bytes = 0
  for (const file of (await files(root)).sort((a, b) => b.time - a.time)) {
    signal.throwIfAborted()
    if (file.time < from) continue
    if (file.size > CHUNK + 65536 || bytes + file.size > STORE_LIMIT) { malformed++; continue }
    const handle = await open(join(root, file.name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => undefined)
    if (!handle) { malformed++; continue }
    try {
      const text = await handle.readFile("utf8")
      bytes += Buffer.byteLength(text)
      for (const line of text.split("\n")) {
        if (!line) continue
        try {
          const record = JSON.parse(line) as DiagnosticRecord
          const time = Date.parse(record.time)
          if (record.workspaceId !== workspaceId || !Number.isFinite(time) || time < from || time > to) continue
          if (!["INFO", "WARN", "ERROR"].includes(record.level) || typeof record.source !== "string" || typeof record.event !== "string") { malformed++; continue }
          records.push(record)
        } catch { malformed++ }
      }
    } finally { await handle.close() }
  }
  return { records: records.sort((a, b) => a.time.localeCompare(b.time)), malformed }
}
