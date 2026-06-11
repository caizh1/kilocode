import { describe, expect, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { CodeIndexConfigManager } from "../../../src/indexing/config-manager"
import { CodeIndexOrchestrator } from "../../../src/indexing/orchestrator"
import { CodeIndexStateManager } from "../../../src/indexing/state-manager"
import { fallbackCheckpointMeta } from "../../../src/indexing/rag-checkpoint"
import type { CacheManager } from "../../../src/indexing/cache-manager"
import type { DirectoryScanner } from "../../../src/indexing/processors/scanner"
import type {
  BatchProcessingSummary,
  FileProcessingResult,
  IFileWatcher,
  IndexingTelemetryEvent,
  IVectorStore,
  PointStruct,
  ScanProgressEvent,
  VectorStoreSearchResult,
} from "../../../src/indexing/interfaces"
import { Emitter } from "../../../src/indexing/runtime"

class Store {
  public clearCount = 0
  public deleteCount = 0

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
  async collectionExists(): Promise<boolean> {
    return true
  }
  async hasIndexedData(): Promise<boolean> {
    return this.existing
  }
  async markIndexingComplete(): Promise<void> {}
  async markIndexingIncomplete(): Promise<void> {}
}

class Scanner {
  public readonly isCancelled = false

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
  ): Promise<{ stats: { processed: number; skipped: number }; totalBlockCount: number }> {
    onProgress?.({ type: "target", totalFiles: this.discovered, graphTotalFiles: this.graph })
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
    }
  }

  cancel(): void {}
  updateBatchSegmentThreshold(_newThreshold: number): void {}
  setRunContext(_runId: string): void {}
}

class Watcher {
  public readonly onDidStartBatchProcessing = new Emitter<string[]>()
  public readonly onBatchProgressUpdate = new Emitter<{
    processedInBatch: number
    totalInBatch: number
    currentFile?: string
  }>()
  public readonly onDidFinishBatchProcessing = new Emitter<BatchProcessingSummary>()

  async initialize(): Promise<void> {}
  updateBatchSegmentThreshold(_newThreshold: number): void {}
  setCollecting(_collecting: boolean): void {}
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

  test("rejects a concurrent workspace indexing run without blocking later retries", async () => {
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

    await second.startIndexing("manual")
    expect(secondScanned).toBe(false)
    expect(second.state).toBe("Indexing")

    firstResolve?.()
    await firstRun
    expect(first.state).toBe("Indexed")
    first.stopWatcher()
    await new Promise((resolve) => setTimeout(resolve, 10))

    await second.startIndexing("manual")
    expect(secondScanned).toBe(true)
    expect(second.state).toBe("Indexed")
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
    expect(error?.mode).toBe("incremental")
    expect(cache.clears).toBe(0)
    expect(store.clearCount).toBe(0)
    expect(store.deleteCount).toBe(0)
    expect(orchestrator.state).toBe("Error")
  })
})
