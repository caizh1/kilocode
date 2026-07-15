import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import { writeHeapSnapshot } from "node:v8"
import { Global } from "@opencode-ai/core/global"

const SAMPLE_MS = 10_000
const LOG_LIMIT = 16 * 1024 * 1024
const LOGS = 10
const SNAPSHOTS = 12
const LIMITS = [2, 4, 8, 16].map((item) => item * 1024 * 1024 * 1024)
const SECRET = /api.?key|authorization|token|secret|password|prompt|content|endpoint|url|header/i

export namespace MemoryDebug {
  export type Event = {
    name: string
    operationId?: string
    data?: Record<string, unknown>
  }

  let timer: ReturnType<typeof setInterval> | undefined
  let queue = Promise.resolve()
  let started = false
  let sampling = false
  const hits = new Set<number>()

  export function enabled() {
    return process.env.KILO_MEMORY_DEBUG === "1"
  }

  export function directory() {
    return process.env.KILO_MEMORY_DEBUG_DIR || path.join(Global.Path.log, "memory-debug")
  }

  export function hash(value: string | undefined) {
    if (!value) return undefined
    return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)
  }

  export function operation(headers: Headers | Record<string, string | undefined>) {
    const value =
      headers instanceof Headers ? headers.get("x-kilo-memory-operation") : headers["x-kilo-memory-operation"]
    if (!value || value.length > 128) return undefined
    return value.replace(/[^a-zA-Z0-9._:-]/g, "") || undefined
  }

  export function nextThreshold(rss: number, seen: ReadonlySet<number>) {
    return LIMITS.find((item) => rss >= item && !seen.has(item))
  }

  export function start() {
    if (!enabled() || started) return
    started = true
    void event({ name: "cli.started", data: { pid: process.pid, runId: process.env.KILO_MEMORY_DEBUG_RUN_ID } })
    void sample()
    timer = setInterval(() => void sample(), SAMPLE_MS)
    timer.unref?.()
  }

  export function stop(reason: string) {
    if (timer) clearInterval(timer)
    timer = undefined
    started = false
    return event({ name: "cli.stopped", data: { reason } })
  }

  export function event(input: Event) {
    if (!enabled()) return Promise.resolve()
    const item = {
      time: new Date().toISOString(),
      source: "cli",
      runId: process.env.KILO_MEMORY_DEBUG_RUN_ID,
      pid: process.pid,
      event: input.name,
      ...(input.operationId ? { operationId: input.operationId } : {}),
      ...(input.data ? { data: sanitize(input.data) } : {}),
    }
    queue = queue.then(() => append(item)).catch(() => undefined)
    return queue
  }

  export function snapshot(reason = "manual") {
    const file = path.join(
      directory(),
      `heap-${process.env.KILO_MEMORY_DEBUG_RUN_ID ?? process.pid}-${reason}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
    )
    return fs
      .mkdir(directory(), { recursive: true })
      .then(() => {
        const result = writeHeapSnapshot(file)
        return event({ name: "heap.snapshot.written", data: { reason, file: path.basename(result) } }).then(
          () => result,
        )
      })
      .then(async (result) => {
        await prune("heap-", SNAPSHOTS)
        return result
      })
      .catch(async (err) => {
        await event({ name: "heap.snapshot.failed", data: { reason, error: message(err) } })
        throw err
      })
  }

  export async function sample() {
    if (!enabled() || sampling) return
    sampling = true
    try {
      const stat = process.memoryUsage()
      const detail = await proc()
      const data = {
        rss: stat.rss,
        heapTotal: stat.heapTotal,
        heapUsed: stat.heapUsed,
        external: stat.external,
        arrayBuffers: stat.arrayBuffers,
        ...detail,
      }
      await event({ name: "memory.sample", data })
      const limit = nextThreshold(stat.rss, hits)
      if (!limit) return
      hits.add(limit)
      await snapshot(`rss-${Math.round(limit / 1024 / 1024 / 1024)}g`)
    } finally {
      sampling = false
    }
  }

  async function append(item: Record<string, unknown>) {
    const dir = directory()
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `memory-debug-cli-${process.env.KILO_MEMORY_DEBUG_RUN_ID ?? process.pid}.jsonl`)
    await rotate(file)
    await fs.appendFile(file, `${JSON.stringify(item)}\n`, "utf8")
  }

  async function rotate(file: string) {
    const stat = await fs.stat(file).catch(() => undefined)
    if (!stat || stat.size < LOG_LIMIT) return
    for (let index = LOGS - 1; index >= 1; index--) {
      const source = `${file}.${index}`
      const target = `${file}.${index + 1}`
      if (index === LOGS - 1) await fs.rm(target, { force: true })
      await fs.rename(source, target).catch(() => undefined)
    }
    await fs.rename(file, `${file}.1`).catch(() => undefined)
  }

  async function prune(prefix: string, limit: number) {
    const dir = directory()
    const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    const list = await Promise.all(
      files
        .filter((item) => item.isFile() && item.name.startsWith(prefix))
        .map(async (item) => ({ name: item.name, stat: await fs.stat(path.join(dir, item.name)) })),
    )
    list.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
    await Promise.all(list.slice(limit).map((item) => fs.rm(path.join(dir, item.name), { force: true })))
  }
}

function proc() {
  if (process.platform !== "linux") return {}
  return Bun.file("/proc/self/status")
    .text()
    .then((text) => {
      const values = Object.fromEntries(
        text
          .split("\n")
          .map((line) => line.match(/^(VmRSS|VmHWM|Threads):\s+([^\s]+)/))
          .filter((item): item is RegExpMatchArray => !!item)
          .map((item) => [item[1], Number(item[2])]),
      )
      return { vmRssKb: values.VmRSS, vmHwmKb: values.VmHWM, threads: values.Threads }
    })
    .catch(() => ({}))
}

function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SECRET.test(key) || /config$/i.test(key)) continue
    if (typeof value === "string") {
      output[key] = SECRET.test(value) ? "[redacted]" : value.slice(0, 512)
      continue
    }
    if (Array.isArray(value)) {
      output[key] = value.map((item) => (typeof item === "string" ? item.slice(0, 128) : item))
      continue
    }
    output[key] = value && typeof value === "object" ? sanitize(value as Record<string, unknown>) : value
  }
  return output
}

function message(err: unknown) {
  if (err instanceof Error) return err.message.slice(0, 512)
  return String(err).slice(0, 512)
}
