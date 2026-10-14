import { constants } from "node:fs"
import { mkdir, readdir, lstat, open, unlink, rename } from "node:fs/promises"
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
  truncated?: boolean
  dropped?: number
}
export interface DiagnosticContext {
  root: string
  source: string
  workspace: string
  salt: string
  runId?: string
}

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
    this.runId =
      context.runId && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(context.runId)
        ? context.runId
        : randomUUID()
    this.workspaceId = anonymous(context.workspace, context.salt)
  }
  append(event: string, data?: unknown, level: DiagnosticRecord["level"] = "INFO", source = this.context.source) {
    const record: DiagnosticRecord = {
      time: new Date().toISOString(),
      source: source.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64),
      level,
      event: diagnosticMessage(event, this.context.salt),
      runId: this.runId,
      workspaceId:
        data && typeof data === "object" && "workspaceId" in data && typeof data.workspaceId === "string" && /^[a-f0-9]{16}$/.test(data.workspaceId)
          ? data.workspaceId
          : data && typeof data === "object" && "directory" in data && typeof data.directory === "string"
          ? anonymous(data.directory, this.context.salt)
          : this.workspaceId,
      data: sanitize(data, this.context.salt),
    }
    record.truncated = /已截断|"truncated":/.test(JSON.stringify(record))
    record.dropped = this.dropped
    const line = JSON.stringify(record) + "\n"
    const size = Buffer.byteLength(line)
    if (this.pending + size > 4 * 1024 * 1024 || size > CHUNK) {
      this.dropped++
      return
    }
    this.pending += size
    this.queue = this.queue
      .then(async () => {
        await mkdir(this.context.root, { recursive: true, mode: 0o700 })
        const directory = await lstat(this.context.root)
        if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("诊断目录不可为链接")
        await locked(this.context.root, async () => {
          await prune(this.context.root, Date.now(), size + 4096)
          if (!this.initialized || this.bytes + size > CHUNK) {
            if (this.initialized) this.chunk++
            this.bytes = 0
            this.initialized = true
          }
          const file = join(this.context.root, `${this.runId}-${process.pid}-${this.chunk}.jsonl`)
          const handle = await open(
            file,
            constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
            0o600,
          )
          try {
            await handle.writeFile(line)
            this.bytes += size
          } finally {
            await handle.close()
          }
        })
      })
      .catch((err: unknown) => {
        this.failure = diagnosticMessage(err instanceof Error ? err.message : String(err))
        this.dropped++
      })
      .finally(() => {
        this.pending -= size
      })
  }
  async flush() {
    await this.queue
    return { dropped: this.dropped, error: this.failure }
  }
}

export async function prune(root: string, now = Date.now(), reserve = CHUNK) {
  const entries = await files(root)
  let removed = 0
  let removedBytes = 0
  let bytes = entries.reduce((sum, item) => sum + item.size, 0)
  for (const item of entries.sort((a, b) => a.time - b.time)) {
    if (item.time >= now - RETENTION && bytes <= STORE_LIMIT - reserve) break
    await unlink(join(root, item.name)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err
    })
    bytes -= item.size
    removed++
    removedBytes += item.size
  }
  if (removed) {
    const previous = await retention(root)
    const handle = await open(
      join(root, ".retention.tmp"),
      constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    try {
      await handle.writeFile(
        JSON.stringify({
          files: (previous?.files ?? 0) + removed,
          bytes: (previous?.bytes ?? 0) + removedBytes,
          lastPrunedAt: now,
        }),
      )
    } finally {
      await handle.close()
    }
    await rename(join(root, ".retention.tmp"), join(root, ".retention.json"))
  }
}

async function files(root: string) {
  const names = await readdir(root).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return []
    throw err
  })
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
    if (file.size > CHUNK + 65536 || bytes + file.size > STORE_LIMIT) {
      malformed++
      continue
    }
    const handle = await open(join(root, file.name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
      () => undefined,
    )
    if (!handle) {
      malformed++
      continue
    }
    try {
      const text = await handle.readFile("utf8")
      bytes += Buffer.byteLength(text)
      for (const line of text.split("\n")) {
        if (!line) continue
        try {
          const record: unknown = JSON.parse(line)
          if (!validRecord(record)) {
            malformed++
            continue
          }
          const time = Date.parse(record.time)
          if (record.workspaceId !== workspaceId || !Number.isFinite(time) || time < from || time > to) continue
          if (
            !["INFO", "WARN", "ERROR"].includes(record.level) ||
            typeof record.source !== "string" ||
            typeof record.event !== "string"
          ) {
            malformed++
            continue
          }
          records.push(record)
        } catch {
          malformed++
        }
      }
    } finally {
      await handle.close()
    }
  }
  return { records: records.sort((a, b) => a.time.localeCompare(b.time)), malformed }
}

// 同一 Profile 的多个进程共享写入预算，避免轮转和追加互相删除或超额。
async function locked<T>(root: string, action: () => Promise<T>): Promise<T> {
  const path = join(root, ".write-lock")
  const deadline = Date.now() + 1500
  while (true) {
    const handle = await open(path, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return undefined
      throw error
    })
    if (handle) {
      try {
        await handle.writeFile(String(process.pid))
        return await action()
      } finally {
        await handle.close()
        await unlink(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error
        })
      }
    }
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (stat?.isSymbolicLink()) throw new Error("诊断写锁不可为链接")
    if (stat?.isFile()) {
      const lock = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined
          throw error
        },
      )
      if (lock) {
        let pid = 0
        try {
          if (stat.size < 32) pid = Number(await lock.readFile("utf8"))
        } finally {
          await lock.close()
        }
        let stale = !pid && Date.now() - stat.mtimeMs > 30000
        if (Number.isSafeInteger(pid) && pid > 0)
          try {
            process.kill(pid, 0)
          } catch (error) {
            stale = Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH")
          }
        if (stale) {
          await unlink(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error
          })
          continue
        }
      }
    }
    if (Date.now() >= deadline) throw new Error("诊断写入繁忙，本条记录已计为缺失")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export async function retention(
  root: string,
): Promise<{ files: number; bytes: number; lastPrunedAt: number } | undefined> {
  const handle = await open(join(root, ".retention.json"), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    },
  )
  if (!handle) return undefined
  try {
    if ((await handle.stat()).size > 4096) throw new Error("诊断轮转记录格式无效")
    const value: unknown = JSON.parse(await handle.readFile("utf8"))
    if (!value || typeof value !== "object" || !("files" in value) || !("bytes" in value) || !("lastPrunedAt" in value))
      throw new Error("诊断轮转记录格式无效")
    if (
      typeof value.files !== "number" ||
      typeof value.bytes !== "number" ||
      typeof value.lastPrunedAt !== "number" ||
      ![value.files, value.bytes, value.lastPrunedAt].every((item) => Number.isSafeInteger(item) && item >= 0)
    )
      throw new Error("诊断轮转记录格式无效")
    return { files: value.files, bytes: value.bytes, lastPrunedAt: value.lastPrunedAt }
  } finally {
    await handle.close()
  }
}

function validRecord(value: unknown): value is DiagnosticRecord {
  if (!value || typeof value !== "object") return false
  return (
    "time" in value &&
    typeof value.time === "string" &&
    "source" in value &&
    typeof value.source === "string" &&
    "event" in value &&
    typeof value.event === "string" &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "workspaceId" in value &&
    typeof value.workspaceId === "string" &&
    "level" in value &&
    (value.level === "INFO" || value.level === "WARN" || value.level === "ERROR")
  )
}
