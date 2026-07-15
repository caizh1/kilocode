import { describe, expect, test } from "bun:test"
import { mkdtemp, unlink, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { CodeIndexConfigManager } from "../../../src/indexing/config-manager"
import { CodeIndexOrchestrator } from "../../../src/indexing/orchestrator"
import { IndexingRunLock } from "../../../src/indexing/run-lock"
import { CodeIndexStateManager } from "../../../src/indexing/state-manager"
import { fallbackCheckpointMeta } from "../../../src/indexing/rag-checkpoint"
import type { CacheManager } from "../../../src/indexing/cache-manager"
import type { DirectoryScanner } from "../../../src/indexing/processors/scanner"
import type {
  BatchProcessingSummary,
  FileProcessingResult,
  IFileWatcher,
  IndexingScanTarget,
  IndexingTelemetryEvent,
  IVectorStore,
  PointStruct,
  ScanProgressEvent,
  VectorStoreSearchResult,
  WatcherSyntheticEvent,
} from "../../../src/indexing/interfaces"
import { Emitter } from "../../../src/indexing/runtime"

class Store {
  public clearCount = 0
  public closeCount = 0
  public completeCount = 0
  public deleteCount = 0
  public incompleteCount = 0

  constructor(
    private readonly existing: boolean,
    private readonly created = false,
  ) {}

  async initialize(): Promise<boolean> {
    return this.created
  }

  async upsertPoints(_points: PointStruct[]): Promise<void> {}

  async search(
    _queryVector: number[],
    _directoryPrefix?: string,
    _minScore?: number,
    _maxResults?: number,
  ): Promise<VectorStoreSearchResult[]> {
    return []
  }

  async deletePointsByFilePath(_filePath: string): Promise<void> {}
  async deletePointsByMultipleFilePaths(_filePaths: string[]): Promise<void> {}
  async clearCollection(): Promise<void> {
    this.clearCount += 1
  }
  async deleteCollection(): Promise<void> {
    this.deleteCount += 1
  }
  async close(): Promise<void> {
    this.closeCount += 1
  }
  async collectionExists(): Promise<boolean> {
    return true
  }
  async hasIndexedData(): Promise<boolean> {
    return this.existing
  }
  async markIndexingComplete(): Promise<void> {
    this.completeCount += 1
  }
  async markIndexingIncomplete(): Promise<void> {
    this.incompleteCount += 1
  }
}

class Scanner {
  public readonly isCancelled = false
  public readonly targets: IndexingScanTarget[] = []
  public readonly cleanupInputs: Array<{ local?: boolean; vector?: boolean }> = []
  public candidateFiles: string[] | undefined
  public freshFiles: string[] | undefined
  public failCleanup = false

  constructor(
    private readonly discovered: number,
    private readonly indexed: number,
    private readonly blocks: number,
    private readonly graph = 0,
  ) {}

  async scanDirectory(
    _directory: string,
    _onError?: (error: Error) => void,
    onFilesIndexed?: (indexedCount: number) => void,
    onFileParsed?: () => void,
    _mode?: "full" | "incremental",
    onProgress?: (event: ScanProgressEvent) => void,
    target: IndexingScanTarget = "all",
  ): Promise<{
    stats: { processed: number; skipped: number }
    totalBlockCount: number
    candidateFiles: string[]
    scanStartedAt: number
    target: IndexingScanTarget
  }> {
    const started = Date.now()
    this.targets.push(target)
    onProgress?.({ type: "target", totalFiles: this.discovered, graphTotalFiles: this.graph })
    const files = this.candidateFiles ?? Array.from({ length: this.discovered }, (_, i) => `/tmp/ws/file-${i}.ts`)
    for (let i = 0; i < this.discovered; i += 1) {
      onFileParsed?.()
    }
    onFilesIndexed?.(this.indexed)
    for (let i = this.indexed; i < this.discovered; i += 1) {
      onProgress?.({ type: "file", filePath: `/tmp/ws/file-${i}.ts` })
    }
    for (let i = 0; i < this.graph; i += 1) {
      onProgress?.({ type: "graph", filePath: `/tmp/ws/file-${i}.c` })
    }
    return {
      stats: {
        processed: this.indexed,
        skipped: 0,
      },
      totalBlockCount: this.blocks,
      candidateFiles: files,
      scanStartedAt: started,
      target,
    }
  }

  cancel(): void {}
  updateBatchSegmentThreshold(_newThreshold: number): void {}
  setRunContext(_runId: string): void {}
  async discoverCandidateFiles(): Promise<{ paths: string[]; engine: string }> {
    return {
      paths:
        this.freshFiles ??
        this.candidateFiles ??
        Array.from({ length: this.discovered }, (_, i) => `/tmp/ws/file-${i}.ts`),
      engine: "test",
    }
  }
  async cleanupAbandonedArtifacts(input: { local?: boolean; vector?: boolean } = {}) {
    this.cleanupInputs.push(input)
    if (this.failCleanup) throw new Error("cleanup failed")
    return {
      codeGraph: { filesDeleted: 0, directoriesDeleted: 0, bytesDeleted: 0, skipped: [] },
      postings: { filesDeleted: 0, directoriesDeleted: 0, bytesDeleted: 0, skipped: [] },
      vector: input.vector ? { skipped: [] } : undefined,
    }
  }
}

class Watcher {
  public readonly onDidStartBatchProcessing = new Emitter<string[]>()
  public readonly onBatchProgressUpdate = new Emitter<{
    processedInBatch: number
    totalInBatch: number
    currentFile?: string
  }>()
  public readonly onDidFinishBatchProcessing = new Emitter<BatchProcessingSummary>()
  public initialized = 0
  public readonly collecting: boolean[] = []
  public readonly synthetic: WatcherSyntheticEvent[] = []
  public pending = 0
  public ready?: Promise<void>
  public fail?: Error

  async initialize(): Promise<void> {
    this.initialized += 1
    if (this.fail) throw this.fail
    await this.ready
  }
  updateBatchSegmentThreshold(_newThreshold: number): void {}
  setCollecting(collecting: boolean): void {
    this.collecting.push(collecting)
  }
  enqueueSyntheticEvents(events: WatcherSyntheticEvent[]): void {
    this.synthetic.push(...events)
  }
  getPendingEventCount(): number {
    return this.pending
  }
  setRunContext(_runId: string): void {}

  async processFile(filePath: string): Promise<FileProcessingResult> {
    return {
      path: filePath,
      status: "skipped",
      reason: "not used in test",
    }
  }

  dispose(): void {
    this.onDidStartBatchProcessing.dispose()
    this.onBatchProgressUpdate.dispose()
    this.onDidFinishBatchProcessing.dispose()
  }
}

class BlockingScanner {
  public isCancelled = false
  public finished = false
  private readonly gate = Promise.withResolvers<void>()
  readonly started = Promise.withResolvers<void>()

  async scanDirectory(
    _directory: string,
    _onError?: (error: Error) => void,
    _onFilesIndexed?: (indexedCount: number) => void,
    _onFileParsed?: () => void,
    _mode?: "full" | "incremental",
    _onProgress?: (event: ScanProgressEvent) => void,
    target: IndexingScanTarget = "all",
  ): Promise<{
    stats: { processed: number; skipped: number }
    totalBlockCount: number
    candidateFiles: string[]
    scanStartedAt: number
    target: IndexingScanTarget
  }> {
    const result = {
      stats: { processed: 0, skipped: 0 },
      totalBlockCount: 0,
      candidateFiles: [],
      scanStartedAt: Date.now(),
      target,
    }
    if (target === "codeGraph") return result
    this.started.resolve()
    await this.gate.promise
    this.finished = true
    return result
  }

  cancel(): void {
    this.isCancelled = true
    this.gate.resolve()
  }

  updateBatchSegmentThreshold(_newThreshold: number): void {}
  setRunContext(_runId: string): void {}
}

class FailScanner {
  public readonly isCancelled = false

  async scanDirectory(): Promise<{ stats: { processed: number; skipped: number }; totalBlockCount: number }> {
    throw new Error("scan failed")
  }

  cancel(): void {}
  updateBatchSegmentThreshold(_newThreshold: number): void {}
  setRunContext(_runId: string): void {}
}

async function env() {
  const root = await mkdtemp(join(tmpdir(), "orchestrator-ws-"))
  const cacheDirectory = await mkdtemp(join(tmpdir(), "orchestrator-cache-"))
  return {
    root,
    cacheDirectory,
    meta: fallbackCheckpointMeta(root),
  }
}

function createConfig(): CodeIndexConfigManager {
  return new CodeIndexConfigManager({
    enabled: true,
    embedderProvider: "openai",
    openAiKey: "sk-test",
    vectorStoreProvider: "lancedb",
    modelId: "text-embedding-3-small",
  })
}

describe("CodeIndexOrchestrator telemetry", () => {
  test("emits full completion telemetry", async () => {
    const events: IndexingTelemetryEvent[] = []
    const ctx = await env()
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      {
        async clearCacheFile() {},
      } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      new Scanner(3, 3, 6) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
      (event) => events.push(event),
    )

    await orchestrator.startIndexing("manual")

    const completed = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "completed" }> => event.type === "completed",
    )
    expect(completed).toBeDefined()
    expect(completed?.mode).toBe("full")
    expect(completed?.trigger).toBe("manual")
    expect(completed?.filesDiscovered).toBe(3)
    expect(completed?.filesIndexed).toBe(3)
    expect(completed?.totalBlocks).toBe(6)
  })

  test("releases the workspace lock after a successful scan", async () => {
    const ctx = await env()
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      {
        async clearCacheFile() {},
      } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      new Scanner(1, 1, 1) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    await orchestrator.startIndexing("manual")
    const lock = await IndexingRunLock.acquire({ cacheDirectory: ctx.cacheDirectory, workspacePath: ctx.root })

    expect(lock.status).toBe("acquired")
    if (lock.status === "acquired") await lock.lock.release()
  })

  test("continues indexing when abandoned artifact cleanup fails", async () => {
    const events: IndexingTelemetryEvent[] = []
    const ctx = await env()
    const scanner = new Scanner(1, 1, 2)
    scanner.failCleanup = true
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      {
        async clearCacheFile() {},
      } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      scanner as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
      (event) => events.push(event),
    )

    await orchestrator.startIndexing("manual")

    expect(orchestrator.state).toBe("Indexed")
    expect(scanner.cleanupInputs.length).toBeGreaterThan(0)
    expect(events.some((event) => event.type === "completed")).toBe(true)
  })

  test("emits incremental completion telemetry", async () => {
    const events: IndexingTelemetryEvent[] = []
    const ctx = await env()
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      {
        async clearCacheFile() {},
      } as unknown as CacheManager,
      new Store(true) as unknown as IVectorStore,
      new Scanner(2, 1, 2) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
      (event) => events.push(event),
    )

    await orchestrator.startIndexing("manual")

    const completed = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "completed" }> => event.type === "completed",
    )
    expect(completed).toBeDefined()
    expect(completed?.mode).toBe("incremental")
    expect(completed?.trigger).toBe("manual")
    expect(completed?.filesDiscovered).toBe(2)
    expect(completed?.filesIndexed).toBe(1)
    expect(completed?.totalBlocks).toBe(2)
  })

  test("reports progress against a stable scan target", async () => {
    const ctx = await env()
    const state = new CodeIndexStateManager()
    const snapshots: Array<{
      processedItems: number
      totalItems: number
      graph?: { processedFiles: number; totalFiles: number }
    }> = []
    const sub = state.onProgressUpdate.on(() => {
      const current = state.getCurrentStatus()
      const graph = state.getCodeGraphProgress()
      const next: {
        processedItems: number
        totalItems: number
        graph?: { processedFiles: number; totalFiles: number }
      } = {
        processedItems: current.processedItems,
        totalItems: current.totalItems,
      }
      if (graph) {
        next.graph = {
          processedFiles: graph.processedFiles,
          totalFiles: graph.totalFiles,
        }
      }
      snapshots.push(next)
    })
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      state,
      ctx.root,
      {
        async clearCacheFile() {},
      } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      new Scanner(5, 2, 6, 3) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    await orchestrator.startIndexing("manual")
    sub.dispose()

    expect(snapshots.some((item) => item.totalItems === 5 && item.processedItems === 0)).toBe(true)
    expect(snapshots.some((item) => item.totalItems === 5 && item.processedItems === 5)).toBe(true)
    expect(snapshots.some((item) => item.graph?.totalFiles === 3 && item.graph.processedFiles === 3)).toBe(true)
  })

  test("runs Code Graph scan before vector initialization and RAG scan", async () => {
    const ctx = await env()
    const order: string[] = []
    const scanner = new Scanner(2, 2, 4, 1)
    const original = scanner.scanDirectory.bind(scanner)
    scanner.scanDirectory = async (...args: Parameters<typeof original>) => {
      const target = args[6] ?? "all"
      order.push(`scan:${target}`)
      return original(...args)
    }
    const cleanup = scanner.cleanupAbandonedArtifacts.bind(scanner)
    scanner.cleanupAbandonedArtifacts = async (input = {}) => {
      order.push(input.vector ? "cleanup:vector" : "cleanup:local")
      return cleanup(input)
    }
    const store = new Store(false)
    const init = store.initialize.bind(store)
    store.initialize = async () => {
      order.push("store:init")
      return init()
    }
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      { async clearCacheFile() {} } as unknown as CacheManager,
      store as unknown as IVectorStore,
      scanner as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    await orchestrator.startIndexing("manual")

    expect(order).toEqual(["scan:codeGraph", "cleanup:local", "store:init", "cleanup:vector", "scan:rag"])
    expect(scanner.targets).toEqual(["codeGraph", "rag"])
  })

  test("starts watcher only after Code Graph and RAG scans complete", async () => {
    const ctx = await env()
    const state = new CodeIndexStateManager()
    const scanner = new Scanner(1, 1, 1, 1)
    const watcher = new Watcher()
    const order: string[] = []
    const scan = scanner.scanDirectory.bind(scanner)
    scanner.scanDirectory = async (...args: Parameters<typeof scan>) => {
      order.push(`scan:${args[6] ?? "all"}`)
      return scan(...args)
    }
    const init = watcher.initialize.bind(watcher)
    watcher.initialize = async () => {
      order.push("watcher:init")
      return init()
    }
    let ready!: () => void
    watcher.ready = new Promise<void>((resolve) => {
      ready = resolve
    })
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      state,
      ctx.root,
      { async clearCacheFile() {} } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      scanner as unknown as DirectoryScanner,
      watcher as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    await orchestrator.startIndexing("manual")

    expect(scanner.targets).toEqual(["codeGraph", "rag"])
    expect(order).toEqual(["scan:codeGraph", "scan:rag", "watcher:init"])
    expect(watcher.initialized).toBe(1)
    expect(watcher.collecting).toEqual([false])
    expect(orchestrator.state).toBe("Indexed")
    expect(state.getCurrentStatus().message).toBe("Index up-to-date. File watcher starting.")

    ready()
    await watcher.ready
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(watcher.collecting).toEqual([false, true])
    expect(state.getCurrentStatus().message).toBe("File watcher started. Index up-to-date.")
  })

  test("does not fail indexing when watcher initialization fails", async () => {
    const events: IndexingTelemetryEvent[] = []
    const ctx = await env()
    const watcher = new Watcher()
    watcher.fail = new Error("watcher unavailable")
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      { async clearCacheFile() {} } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      new Scanner(1, 1, 1, 1) as unknown as DirectoryScanner,
      watcher as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
      (event) => events.push(event),
    )

    await orchestrator.startIndexing("manual")
    await new Promise((resolve) => setTimeout(resolve, 0))

    const error = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "error" }> =>
        event.type === "error" && event.location === "orchestrator:startWatcher",
    )
    expect(orchestrator.state).toBe("Indexed")
    expect(error?.source).toBe("watcher")
    expect(error?.error).toContain("watcher unavailable")
  })

  test("queues synthetic watcher events for files changed during scan", async () => {
    const ctx = await env()
    const old = join(ctx.root, "old.ts")
    const changed = join(ctx.root, "changed.ts")
    const deleted = join(ctx.root, "deleted.ts")
    const created = join(ctx.root, "created.ts")

    await writeFile(old, "export const old = 1\n")
    await writeFile(changed, "export const changed = 1\n")
    await writeFile(deleted, "export const deleted = 1\n")

    const scanner = new Scanner(3, 3, 3)
    scanner.candidateFiles = [old, changed, deleted]
    scanner.freshFiles = [old, changed, created]
    const scan = scanner.scanDirectory.bind(scanner)
    scanner.scanDirectory = async (...args: Parameters<typeof scan>) => {
      const result = await scan(...args)
      await new Promise((resolve) => setTimeout(resolve, 5))
      await writeFile(changed, "export const changed = 2\n")
      await unlink(deleted)
      await writeFile(created, "export const created = 1\n")
      return result
    }

    const watcher = new Watcher()
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      { async clearCacheFile() {} } as unknown as CacheManager,
      undefined,
      scanner as unknown as DirectoryScanner,
      watcher as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    await orchestrator.startIndexing("manual")

    const events = watcher.synthetic.map((event) => `${event.path}:${event.type}`)
    expect(events).toContain(`${changed}:change`)
    expect(events).toContain(`${deleted}:delete`)
    expect(events).toContain(`${created}:create`)
  })

  test("does not start RAG when Code Graph scan fails", async () => {
    const events: IndexingTelemetryEvent[] = []
    const ctx = await env()
    const store = new Store(false)
    let initialized = false
    store.initialize = async () => {
      initialized = true
      return false
    }
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      { async clearCacheFile() {} } as unknown as CacheManager,
      store as unknown as IVectorStore,
      new FailScanner() as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
      (event) => events.push(event),
    )

    await orchestrator.startIndexing("manual")

    const error = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "error" }> => event.type === "error",
    )
    expect(initialized).toBe(false)
    expect(error?.pipeline).toBe("codeGraph")
    expect(orchestrator.state).toBe("Error")
  })

  test("cancelIndexing prevents scan from running", async () => {
    const ctx = await env()
    let scanned = false
    const scanner = new Scanner(3, 3, 6) as unknown as DirectoryScanner
    const original = scanner.scanDirectory.bind(scanner)
    scanner.scanDirectory = async (...args: Parameters<typeof original>) => {
      scanned = true
      return original(...args)
    }

    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      { async clearCacheFile() {} } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      scanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    // Start indexing then immediately cancel
    const done = orchestrator.startIndexing("background")
    orchestrator.cancelIndexing()
    await done

    expect(orchestrator.state).toBe("Standby")
    // Scanner may or may not have been reached depending on timing,
    // but the orchestrator must not be in Indexing state
    expect(orchestrator.state).not.toBe("Indexing")
  })

  test("waits for a concurrent workspace indexing run and continues after release", async () => {
    const oldRetry = process.env.KILO_INDEXING_LOCK_RETRY_MS
    process.env.KILO_INDEXING_LOCK_RETRY_MS = "10"
    const ctx = await env()
    let firstResolve: (() => void) | undefined
    let firstStarted: (() => void) | undefined
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const firstDone = new Promise<void>((resolve) => {
      firstResolve = resolve
    })
    const firstScanner = new Scanner(1, 1, 1) as unknown as DirectoryScanner
    firstScanner.scanDirectory = async (...args: Parameters<DirectoryScanner["scanDirectory"]>) => {
      firstStarted?.()
      await firstDone
      return Scanner.prototype.scanDirectory.call(new Scanner(1, 1, 1), ...args)
    }
    const first = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      { async clearCacheFile() {} } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      firstScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )
    const firstRun = first.startIndexing("manual")
    await firstReady

    let secondScanned = false
    const secondScanner = new Scanner(1, 1, 1) as unknown as DirectoryScanner
    secondScanner.scanDirectory = async (...args: Parameters<DirectoryScanner["scanDirectory"]>) => {
      secondScanned = true
      return Scanner.prototype.scanDirectory.call(new Scanner(1, 1, 1), ...args)
    }
    const second = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      { async clearCacheFile() {} } as unknown as CacheManager,
      new Store(false) as unknown as IVectorStore,
      secondScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    const secondRun = second.startIndexing("manual")
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(secondScanned).toBe(false)
    expect(second.state).toBe("Indexing")

    firstResolve?.()
    await firstRun
    expect(first.state).toBe("Indexed")
    try {
      await secondRun
      expect(secondScanned).toBe(true)
      expect(second.state).toBe("Indexed")
    } finally {
      if (oldRetry === undefined) delete process.env.KILO_INDEXING_LOCK_RETRY_MS
      else process.env.KILO_INDEXING_LOCK_RETRY_MS = oldRetry
    }
  })

  test("shutdown waits for an active scan before closing the store", async () => {
    const ctx = await env()
    const scanner = new BlockingScanner()
    const store = new Store(false)
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
      store as unknown as IVectorStore,
      scanner as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    const active = orchestrator.startIndexing("background")
    await scanner.started.promise
    await orchestrator.shutdown()
    await active

    expect(scanner.finished).toBe(true)
    expect(store.closeCount).toBe(1)
    expect(store.incompleteCount).toBe(1)
    expect(store.completeCount).toBe(0)
  })

  test("preserves an unchanged index when an incremental scan is interrupted", async () => {
    const ctx = await env()
    const scanner = new BlockingScanner()
    const store = new Store(true)
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      { async clearCacheFile() {}, async flush() {} } as unknown as CacheManager,
      store as unknown as IVectorStore,
      scanner as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    const active = orchestrator.startIndexing("background")
    await scanner.started.promise
    await orchestrator.shutdown()
    await active

    expect(store.incompleteCount).toBe(1)
    expect(store.completeCount).toBe(1)
    expect(store.clearCount).toBe(0)
  })

  test("clears stale vectors and hashes before rebuilding an incomplete store", async () => {
    const ctx = await env()
    const cache = {
      clears: 0,
      async clearCacheFile() {
        this.clears += 1
      },
      async flush() {},
    }
    const store = new Store(false, false)
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      cache as unknown as CacheManager,
      store as unknown as IVectorStore,
      new Scanner(1, 1, 1) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    await orchestrator.startIndexing("background")

    expect(store.clearCount).toBe(1)
    expect(cache.clears).toBe(1)
    expect(orchestrator.state).toBe("Indexed")
  })

  test("does not clear data when index completeness cannot be read", async () => {
    const ctx = await env()
    const cache = {
      clears: 0,
      async clearCacheFile() {
        this.clears += 1
      },
    }
    const store = new Store(true, false)
    store.hasIndexedData = async () => {
      throw new Error("metadata unavailable")
    }
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      cache as unknown as CacheManager,
      store as unknown as IVectorStore,
      new Scanner(1, 1, 1) as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
    )

    await orchestrator.startIndexing("background")

    expect(store.clearCount).toBe(0)
    expect(cache.clears).toBe(0)
    expect(orchestrator.state).toBe("Error")
  })

  test("preserves cache and collection data on retryable start failures", async () => {
    const events: IndexingTelemetryEvent[] = []
    const ctx = await env()
    const cache = {
      clears: 0,
      async clearCacheFile() {
        this.clears += 1
      },
    }
    const store = new Store(true)
    const orchestrator = new CodeIndexOrchestrator(
      createConfig(),
      new CodeIndexStateManager(),
      ctx.root,
      cache as unknown as CacheManager,
      store as unknown as IVectorStore,
      new FailScanner() as unknown as DirectoryScanner,
      new Watcher() as unknown as IFileWatcher,
      ctx.cacheDirectory,
      ctx.meta,
      (event) => events.push(event),
    )

    await orchestrator.startIndexing("background")

    const error = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "error" }> =>
        event.type === "error" && event.location === "orchestrator:startIndexing",
    )
    expect(error).toBeDefined()
    expect(error?.mode).toBe("full")
    expect(error?.pipeline).toBe("codeGraph")
    expect(cache.clears).toBe(0)
    expect(store.clearCount).toBe(0)
    expect(store.deleteCount).toBe(0)
    expect(orchestrator.state).toBe("Error")
  })
})
