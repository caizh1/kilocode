import { Worker } from "node:worker_threads"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { CodeGraphFileGraph } from "../types"
import { parseCodeGraphFile } from "./cpp"

declare global {
  const CHIPMATE_CODEGRAPH_WORKER_PATH: string | undefined
}

type ParseInput = Parameters<typeof parseCodeGraphFile>[0]

type Pending = {
  timer: ReturnType<typeof setTimeout>
  resolve(value: unknown): void
  reject(err: Error): void
}

type Slot = {
  worker: Worker
  active: number
  healthy: boolean
  pending: Map<number, Pending>
}

type Result = {
  graph: CodeGraphFileGraph
  worker: boolean
}

export type CodeGraphParserWorkerHealth = {
  healthy: boolean
  workers: number
  path: string
  mode: "source" | "absolute" | "packaged"
  error?: string
}

export type CodeGraphParserWorkerPath = {
  target: string | URL
  path: string
  mode: CodeGraphParserWorkerHealth["mode"]
  exists?: boolean
}

type Opts = {
  workerPath?: string
  baseDir?: string
  timeoutMs?: number
}

const timeout = 5_000

export function resolveCodeGraphParserWorkerPath(opts: Opts = {}): CodeGraphParserWorkerPath {
  const value = opts.workerPath ?? defined()
  if (!value) {
    const url = new URL("./worker.ts", import.meta.url)
    return {
      target: url,
      path: url.href,
      mode: "source",
    }
  }

  if (path.isAbsolute(value)) {
    return {
      target: pathToFileURL(value),
      path: value,
      mode: "absolute",
      exists: existsSync(value),
    }
  }

  const base = opts.baseDir ?? binDir()
  const file = path.resolve(base, value)
  return {
    target: pathToFileURL(file),
    path: file,
    mode: "packaged",
    exists: existsSync(file),
  }
}

export class CodeGraphParserWorkerPool {
  private readonly slots: Slot[] = []
  private id = 0
  private disabled = ""
  private reported = false
  private readonly opts: Opts

  constructor(opts: Opts = {}) {
    this.opts = opts
  }

  public async parse(input: ParseInput, size = 4): Promise<Result> {
    if (size <= 0) return this.local(input)
    try {
      this.ensure(size)
      const slot = this.next()
      if (!slot) return this.local(input)
      const graph = (await this.request(slot, "parse", { input })) as CodeGraphFileGraph
      return { graph, worker: true }
    } catch (err) {
      this.disabled ||= err instanceof Error ? err.message : String(err)
      return this.local(input)
    }
  }

  public async health(size = 4): Promise<CodeGraphParserWorkerHealth> {
    const info = resolveCodeGraphParserWorkerPath(this.opts)
    if (size <= 0) {
      return {
        healthy: true,
        workers: 0,
        path: info.path,
        mode: info.mode,
      }
    }
    try {
      this.ensure(size)
      if (this.slots.length === 0) {
        return {
          healthy: false,
          workers: 0,
          path: info.path,
          mode: info.mode,
          error: this.disabled || "No code graph parser workers available.",
        }
      }

      const checks = await Promise.all(this.slots.map((slot) => this.request(slot, "health", {})))
      const ok = checks.every((item) => Boolean((item as { healthy?: boolean }).healthy))
      return {
        healthy: ok,
        workers: this.slots.length,
        path: info.path,
        mode: info.mode,
        ...(ok ? {} : { error: "Code graph parser worker health check failed." }),
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.disabled ||= msg
      return {
        healthy: false,
        workers: this.slots.length,
        path: info.path,
        mode: info.mode,
        error: msg,
      }
    }
  }

  public takeFallbackReason(): string | undefined {
    if (!this.disabled || this.reported) return undefined
    this.reported = true
    return this.disabled
  }

  public dispose(): void {
    for (const slot of this.slots) {
      for (const item of slot.pending.values()) item.reject(new Error("Code graph parser worker pool disposed."))
      for (const item of slot.pending.values()) clearTimeout(item.timer)
      slot.pending.clear()
      void slot.worker.terminate()
    }
    this.slots.splice(0)
  }

  private local(input: ParseInput): Result {
    return { graph: parseCodeGraphFile(input), worker: false }
  }

  private ensure(target: number): void {
    if (this.disabled) return
    const size = Math.max(1, Math.min(16, target))
    while (this.slots.length < size) {
      try {
        const info = resolveCodeGraphParserWorkerPath(this.opts)
        if (info.exists === false) throw new Error(`Code graph parser worker not found: ${info.path}`)
        const worker = new Worker(info.target)
        worker.unref?.()
        const slot: Slot = { worker, active: 0, healthy: true, pending: new Map() }
        worker.on("message", (msg: { id?: number; ok?: boolean; data?: unknown; error?: string }) => {
          if (typeof msg.id !== "number") return
          const item = slot.pending.get(msg.id)
          if (!item) return
          slot.pending.delete(msg.id)
          clearTimeout(item.timer)
          slot.active = Math.max(0, slot.active - 1)
          if (msg.ok) {
            item.resolve(msg.data)
            return
          }
          item.reject(new Error(msg.error || "Code graph parser worker request failed."))
        })
        worker.on("error", (err) => {
          slot.healthy = false
          for (const item of slot.pending.values()) {
            clearTimeout(item.timer)
            item.reject(err)
          }
          slot.pending.clear()
        })
        worker.on("exit", (code) => {
          slot.healthy = false
          if (code === 0) return
          const err = new Error(`Code graph parser worker exited with ${code}.`)
          for (const item of slot.pending.values()) {
            clearTimeout(item.timer)
            item.reject(err)
          }
          slot.pending.clear()
        })
        this.slots.push(slot)
      } catch (err) {
        this.disabled = err instanceof Error ? err.message : String(err)
        break
      }
    }
  }

  private next(): Slot | undefined {
    return this.slots.filter((slot) => slot.healthy).sort((left, right) => left.active - right.active)[0]
  }

  private request(slot: Slot, type: "parse" | "health", body: Record<string, unknown>): Promise<unknown> {
    const id = ++this.id
    slot.active++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        slot.pending.delete(id)
        slot.active = Math.max(0, slot.active - 1)
        reject(new Error(`Code graph parser worker ${type} request timed out.`))
      }, this.opts.timeoutMs ?? timeout)
      timer.unref?.()
      slot.pending.set(id, { timer, resolve, reject })
      slot.worker.postMessage({ id, type, ...body })
    })
  }
}

function defined(): string | undefined {
  return typeof CHIPMATE_CODEGRAPH_WORKER_PATH !== "undefined" ? CHIPMATE_CODEGRAPH_WORKER_PATH : undefined
}

function binDir(): string {
  const file = globalThis.process?.execPath
  if (!file) return globalThis.process?.cwd() ?? "."
  return path.dirname(file)
}
