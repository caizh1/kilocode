import { once } from "node:events"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import type {
  CodeGraphSidecarStatus,
  DocumentSearchResult,
  IndexingConfigInput,
  IndexingTelemetryEvent,
  QueryEvidenceResult,
  VectorStoreSearchResult,
} from "@kilocode/kilo-indexing/engine"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"
import { withTimeout } from "@/util/timeout"
import { Process } from "@/util/process"
import { MemoryDebug } from "./memory-debug"
import { indexingBudget } from "./indexing-memory"
import {
  INDEXING_PROCESS_PREFIX,
  isIndexingMessage,
  type DocumentSearchInput,
  type QueryEvidenceInput,
  type Request,
  type Result,
} from "./indexing-worker-protocol"

declare global {
  const KILO_INDEXING_PROCESS_PATH: string
}

export namespace IndexingWorker {
  export type Hooks = {
    status(status: IndexingStatus): void
    telemetry(event: IndexingTelemetryEvent): void
    failure(err: unknown): void
  }

  export type Driver = {
    init(input: IndexingConfigInput): Promise<IndexingStatus>
    updateConfig(input: IndexingConfigInput): Promise<IndexingStatus>
    search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]>
    documentSearch(query: string, options?: Omit<DocumentSearchInput, "query">): Promise<DocumentSearchResult[]>
    rebuildDocuments(): Promise<IndexingStatus>
    queryEvidence(query: string, options?: Omit<QueryEvidenceInput, "query">): Promise<QueryEvidenceResult>
    codeGraphStatus(): Promise<CodeGraphSidecarStatus>
    dispose(): Promise<void>
  }

  export type Options = { forcedLow?: boolean }

  export type Factory = (directory: string, root: string, hooks: Hooks, options?: Options) => Driver

  const worker = (directory: string, root: string, hooks: Hooks, options: Options = {}): Driver => {
    const budget = indexingBudget()
    const task = Process.spawn(command(), {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        KILO_INDEXING_SOFT_RSS_BYTES: String(budget.soft),
        KILO_INDEXING_CRITICAL_RSS_BYTES: String(budget.critical),
        KILO_INDEXING_HARD_RSS_BYTES: String(budget.hard),
        KILO_INDEXING_RECOVERY_RSS_BYTES: String(budget.recovery),
        KILO_INDEXING_FORCED_LOW: options.forcedLow ? "1" : "0",
      },
    })
    if (!task.stdin || !task.stdout || !task.stderr) throw new Error("Indexing process pipes are unavailable.")

    const stdin = task.stdin
    const stdout = task.stdout
    const stderr = task.stderr
    const lines = createInterface({ input: stdout, crlfDelay: Infinity })
    const pending = new Map<number, { resolve(message: Result): void; reject(err: unknown): void }>()
    const workspace = MemoryDebug.hash(directory)
    let id = 0
    let stopped = false
    let stopping = false
    let warned = false
    let rss = 0
    let writes = Promise.resolve()

    stderr.on("data", (chunk) => process.stderr.write(chunk))
    void MemoryDebug.event({
      name: "indexing.worker.created",
      data: { workspace, transport: "process", pid: task.pid },
    })

    const reject = (err: unknown) => {
      for (const item of pending.values()) item.reject(err)
      pending.clear()
    }

    const fail = (err: unknown) => {
      if (stopped || stopping) return
      stopped = true
      reject(err)
      lines.close()
      task.kill()
      void MemoryDebug.event({
        name: "indexing.worker.failed",
        data: { workspace, transport: "process", pid: task.pid, rss, error: message(err) },
      })
      hooks.failure(err)
    }

    lines.on("line", (line) => {
      if (!line.startsWith(INDEXING_PROCESS_PREFIX)) {
        process.stderr.write(`${line}\n`)
        return
      }
      try {
        const value: unknown = JSON.parse(line.slice(INDEXING_PROCESS_PREFIX.length))
        if (!isIndexingMessage(value)) throw new Error("Invalid indexing process response.")
        if (value.type === "event") {
          if (stopping || stopped) return
          if (value.event === "status") hooks.status(value.data)
          if (value.event === "telemetry") hooks.telemetry(value.data)
          if (value.event !== "resource") return
          rss = value.data.rss
          if (rss >= budget.soft && !warned) {
            warned = true
            void MemoryDebug.event({
              name: "indexing.worker.memory-soft-limit",
              data: { workspace, transport: "process", pid: task.pid, rss, limit: budget.soft },
            })
          }
          if (rss < budget.recovery) warned = false
          return
        }

        const request = pending.get(value.id)
        if (!request) return
        pending.delete(value.id)
        if (value.ok) {
          request.resolve(value)
          return
        }
        request.reject(new Error(value.error))
      } catch (err) {
        fail(err)
      }
    })

    void task.exited.then((code) => {
      if (stopped || stopping) return
      if (code === 86) {
        fail(new Error(`Indexing process exceeded RSS limit: ${rss} >= ${budget.hard}`))
        return
      }
      if (code === 87) {
        fail(new Error(`Indexing process requested a memory rollover: ${rss} >= ${budget.critical}`))
        return
      }
      fail(new Error(`Indexing process exited with code ${code}.`))
    }, fail)

    const send = (request: Request, allowStopping = false) => {
      const next = writes.then(async () => {
        if (stopped || (stopping && !allowStopping)) throw new Error("Indexing process is disposed.")
        if (stdin.write(`${JSON.stringify(request)}\n`)) return
        await once(stdin, "drain")
      })
      writes = next.catch(() => undefined)
      return next
    }

    const call = <T>(request: Request, read: (message: Result) => T, allowStopping = false) => {
      if (stopped || (stopping && !allowStopping)) return Promise.reject(new Error("Indexing process is disposed."))
      return new Promise<T>((resolve, reject) => {
        pending.set(request.id, {
          resolve(message) {
            try {
              resolve(read(message))
            } catch (err) {
              reject(err)
            }
          },
          reject,
        })
        void send(request, allowStopping).catch(fail)
      })
    }

    return {
      init(config) {
        const request: Request = {
          type: "request",
          id: id++,
          method: "init",
          input: { directory, root, config, lancedbPath: process.env.KILO_LANCEDB_PATH },
        }
        return call(request, (result) => {
          if (result.ok && result.method === "init") return result.value
          throw new Error("Unexpected indexing process init response.")
        })
      },
      updateConfig(config) {
        const request: Request = { type: "request", id: id++, method: "updateConfig", input: config }
        return call(request, (result) => {
          if (result.ok && result.method === "updateConfig") return result.value
          throw new Error("Unexpected indexing process updateConfig response.")
        })
      },
      search(query, directoryPrefix) {
        const request: Request = { type: "request", id: id++, method: "search", input: { query, directoryPrefix } }
        return call(request, (result) => {
          if (result.ok && result.method === "search") return result.value
          throw new Error("Unexpected indexing process search response.")
        })
      },
      documentSearch(query, options = {}) {
        const request: Request = {
          type: "request",
          id: id++,
          method: "documentSearch",
          input: { query, ...options },
        }
        return call(request, (result) => {
          if (result.ok && result.method === "documentSearch") return result.value
          throw new Error("Unexpected indexing process documentSearch response.")
        })
      },
      rebuildDocuments() {
        const request: Request = { type: "request", id: id++, method: "rebuildDocuments", input: undefined }
        return call(request, (result) => {
          if (result.ok && result.method === "rebuildDocuments") return result.value
          throw new Error("Unexpected indexing process rebuildDocuments response.")
        })
      },
      queryEvidence(query, options = {}) {
        const request: Request = {
          type: "request",
          id: id++,
          method: "queryEvidence",
          input: { query, ...options },
        }
        return call(request, (result) => {
          if (result.ok && result.method === "queryEvidence") return result.value
          throw new Error("Unexpected indexing process queryEvidence response.")
        })
      },
      codeGraphStatus() {
        const request: Request = { type: "request", id: id++, method: "codeGraphStatus", input: undefined }
        return call(request, (result) => {
          if (result.ok && result.method === "codeGraphStatus") return result.value
          throw new Error("Unexpected indexing process codeGraphStatus response.")
        })
      },
      async dispose() {
        if (stopped || stopping) return
        stopping = true
        const request: Request = { type: "request", id: id++, method: "dispose", input: undefined }
        await withTimeout(
          call(
            request,
            (result) => {
              if (result.ok && result.method === "dispose") return result.value
              throw new Error("Unexpected indexing process dispose response.")
            },
            true,
          ),
          1_000,
          "Indexing process shutdown timed out",
        ).catch(() => undefined)
        stdin.end()
        await withTimeout(task.exited, 1_000, "Indexing process exit timed out").catch(async () => {
          task.kill()
          await withTimeout(task.exited, 1_000, "Indexing process kill timed out").catch(() => undefined)
        })
        stopped = true
        lines.close()
        reject(new Error("Indexing process is disposed."))
        void MemoryDebug.event({
          name: "indexing.worker.terminated",
          data: { workspace, transport: "process", pid: task.pid, rss },
        })
      },
    }
  }

  let factory: Factory = worker

  export function create(directory: string, root: string, hooks: Hooks, options?: Options) {
    return factory(directory, root, hooks, options)
  }

  export function override(next?: Factory) {
    factory = next ?? worker
  }
}

function command(): string[] {
  if (typeof KILO_INDEXING_PROCESS_PATH === "undefined") {
    return [process.execPath, fileURLToPath(new URL("./indexing-process.ts", import.meta.url))]
  }
  const file = path.isAbsolute(KILO_INDEXING_PROCESS_PATH)
    ? KILO_INDEXING_PROCESS_PATH
    : path.join(path.dirname(process.execPath), KILO_INDEXING_PROCESS_PATH)
  return [file]
}

function message(err: unknown) {
  if (err instanceof Error) return err.message.slice(0, 512)
  return String(err).slice(0, 512)
}
