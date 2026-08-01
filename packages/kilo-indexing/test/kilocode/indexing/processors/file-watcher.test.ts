import { describe, test, expect } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { createHash } from "crypto"
import { v5 as uuidv5 } from "uuid"
import { CacheManager } from "../../../../src/indexing/cache-manager"
import type {
  IEmbedder,
  IndexingTelemetryEvent,
  IVectorStore,
  PointStruct,
  VectorStoreSearchResult,
} from "../../../../src/indexing/interfaces"
import { FileWatcher } from "../../../../src/indexing/processors/file-watcher"
import { CodeParser } from "../../../../src/indexing/processors/parser"
import { loadIgnore } from "../../../../src/indexing/shared/load-ignore"
import { CodeGraphJsonStorage, CodePostingsJsonStorage } from "../../../../src/indexing/codegraph/storage"
import { IndexingRunLock } from "../../../../src/indexing/run-lock"
import { WorktreeOverlay } from "../../../../src/indexing/worktree-overlay"

function createEmbedder(): IEmbedder {
  return {
    async createEmbeddings(texts) {
      return {
        embeddings: texts.map((_, index) => [index + 1]),
      }
    },
    async validateConfiguration() {
      return { valid: true }
    },
    get embedderInfo() {
      return { name: "openai" as const }
    },
  }
}

class RetryStore implements IVectorStore {
  public readonly points: PointStruct[] = []

  constructor(private readonly fail: number) {}

  private calls = 0

  async initialize(): Promise<boolean> {
    return false
  }

  async upsertPoints(points: PointStruct[]): Promise<void> {
    this.calls += 1
    if (this.calls <= this.fail) {
      throw new Error("watcher upsert failure for /tmp/watcher/path.ts")
    }
    this.points.push(...points)
  }

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
  async activateFileGeneration(_filePath: string, _generation: string, _runId: string): Promise<void> {}
  async deleteInactiveFilePoints(_filePath: string, _activeGeneration: string): Promise<void> {}
  getCollectionName(): string {
    return "test"
  }
  async clearCollection(): Promise<void> {}
  async deleteCollection(): Promise<void> {}
  async collectionExists(): Promise<boolean> {
    return true
  }
  async hasIndexedData(): Promise<boolean> {
    return false
  }
  async markIndexingComplete(): Promise<void> {}
  async markIndexingIncomplete(): Promise<void> {}
}

class RecordStore extends RetryStore {
  public points = 0
  public batches: number[] = []
  public activations = 0

  constructor() {
    super(0)
  }

  override async upsertPoints(points: PointStruct[]): Promise<void> {
    this.points += points.length
    this.batches.push(points.length)
  }

  override async activateFileGeneration(): Promise<void> {
    this.activations += 1
  }
}

describe("FileWatcher", () => {
  test("bounds watcher startup so a missing ready event cannot hang indexing", async () => {
    const old = process.env.KILO_INDEXING_WATCHER_READY_TIMEOUT_MS
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-ready-timeout-"))
    const cache = new CacheManager(path.join(root, ".cache"), root)
    await cache.initialize()
    const watcher = new FileWatcher(root, cache)
    process.env.KILO_INDEXING_WATCHER_READY_TIMEOUT_MS = "0"

    try {
      await expect(watcher.initialize()).rejects.toThrow("File watcher did not become ready within 0ms.")
    } finally {
      watcher.dispose()
      await rm(root, { recursive: true, force: true })
      if (old === undefined) delete process.env.KILO_INDEXING_WATCHER_READY_TIMEOUT_MS
      else process.env.KILO_INDEXING_WATCHER_READY_TIMEOUT_MS = old
    }
  })

  test("keeps runtime watcher errors handled after the ready event", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-runtime-error-"))
    const cache = new CacheManager(path.join(root, ".cache"), root)
    await cache.initialize()
    const watcher = new FileWatcher(root, cache)

    try {
      await watcher.initialize()
      const errors: Error[] = []
      watcher.onDidFinishBatchProcessing.on((summary) => {
        if (summary.batchError) errors.push(summary.batchError)
      })
      const native = (
        watcher as unknown as {
          watcher?: {
            emit: (event: string, err: Error) => boolean
            listenerCount: (event: string) => number
          }
        }
      ).watcher
      expect(native?.listenerCount("error")).toBeGreaterThan(0)
      expect(() => native?.emit("error", new Error("runtime watcher failure"))).not.toThrow()
      expect(native?.listenerCount("error")).toBeGreaterThan(0)
      expect(errors.map((err) => err.message)).toEqual(["runtime watcher failure"])
      expect(watcher.takeReconciliationRequest()).toBe(true)
    } finally {
      watcher.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("waits for the workspace lock before processing a watcher batch", async () => {
    const oldRetry = process.env.KILO_INDEXING_LOCK_RETRY_MS
    process.env.KILO_INDEXING_LOCK_RETRY_MS = "10"
    try {
      const root = await mkdtemp(path.join(tmpdir(), "file-watcher-lock-"))
      const cacheDir = path.join(root, ".cache")
      const file = path.join(root, "main.ts")

      await mkdir(cacheDir, { recursive: true })
      await writeFile(file, "export const value = 1\n")

      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const held = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
      expect(held.status).toBe("acquired")

      const watcher = new FileWatcher(
        root,
        cache,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { lockCacheDirectory: cacheDir },
      )
      let finished = false
      watcher.onDidFinishBatchProcessing.on(() => {
        finished = true
      })
      watcher.setCollecting(true)
      ;(
        watcher as unknown as { accumulatedEvents: Map<string, { path: string; type: "change" }> }
      ).accumulatedEvents.set(file, { path: file, type: "change" })

      const run = (watcher as unknown as { triggerBatchProcessing: () => Promise<void> }).triggerBatchProcessing()
      await new Promise((resolve) => setTimeout(resolve, 30))

      expect(finished).toBe(false)
      if (held.status === "acquired") await held.lock.release()
      await run
      expect(finished).toBe(true)

      const next = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
      expect(next.status).toBe("acquired")
      if (next.status === "acquired") await next.lock.release()
      watcher.dispose()
    } finally {
      if (oldRetry === undefined) delete process.env.KILO_INDEXING_LOCK_RETRY_MS
      else process.env.KILO_INDEXING_LOCK_RETRY_MS = oldRetry
    }
  })

  test("drains buffered events under the scan lock without reacquiring it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-owned-lock-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "main.ts")
    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, "export const value = 1\n")
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const held = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    expect(held.status).toBe("acquired")
    const watcher = new FileWatcher(
      root,
      cache,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { lockCacheDirectory: cacheDir },
    )
    watcher.setTarget("codeGraph")
    watcher.setCollecting(false)
    watcher.enqueueSyntheticEvents([{ path: file, type: "change" }])

    expect(await watcher.drainPending(1000, 2_000, true)).toBe(true)
    expect(watcher.getPendingEventCount()).toBe(0)

    if (held.status === "acquired") await held.lock.release()
    watcher.dispose()
    await rm(root, { recursive: true, force: true })
  })

  test("processFile preserves same-line segments during incremental updates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "oversized.ts")
    const line = "x".repeat(5000)

    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, line)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const watcher = new FileWatcher(root, cache, createEmbedder())
    const result = await watcher.processFile(file)

    expect(result.status).toBe("processed_for_batching")
    expect(result.pointsToUpsert).toBeDefined()

    const points = result.pointsToUpsert!
    expect(points.length).toBe(5)

    const ids = points.map((point) => point.id)
    expect(new Set(ids).size).toBe(points.length)

    const hashes = points.map((point) => point.payload.segmentHash)
    expect(new Set(hashes).size).toBe(points.length)

    points.forEach((point) => {
      expect(point.payload.startLine).toBe(1)
      expect(point.payload.endLine).toBe(1)
      expect(typeof point.payload.workspaceId).toBe("string")
      expect(point.payload.normalizedRoot).toBe(root)
      expect(point.payload.fileHash).toBe(result.newHash)
      expect(point.payload.chunkHash).toBe(point.payload.segmentHash)
      expect(point.payload.chunkRange).toBe("1:1")
      expect(point.payload.active).toBe(false)
      expect(typeof point.payload.generation).toBe("string")
    })
  })

  test("streams watcher embeddings in bounded batches before activating the file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-stream-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "large.ts")
    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, "x".repeat(8_000))
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const store = new RecordStore()
    const watcher = new FileWatcher(root, cache, createEmbedder(), store, undefined, 2, 1)
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }

    await data.processBatch(new Map([[file, { path: file, type: "create" }]]))

    expect(store.points).toBeGreaterThan(2)
    expect(Math.max(...store.batches)).toBeLessThanOrEqual(2)
    expect(store.activations).toBe(1)
    expect(cache.getHash(file)).toBeDefined()
  })

  test("does not call embeddings or vector storage in graph-only mode", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-graph-only-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "main.c")
    let embeddings = 0
    let vectors = 0
    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, "int main(void) { return 0; }\n")
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const tracked = {
      ...createEmbedder(),
      createEmbeddings: async (texts: string[]) => {
        embeddings += 1
        return { embeddings: texts.map(() => [0.1]) }
      },
    } satisfies IEmbedder
    const recorded = new RecordStore()
    recorded.upsertPoints = async () => {
      vectors += 1
    }
    const watcher = new FileWatcher(root, cache, tracked, recorded)
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }
    watcher.setTarget("codeGraph")

    await data.processBatch(new Map([[file, { path: file, type: "create" }]]))

    expect(embeddings).toBe(0)
    expect(vectors).toBe(0)
    watcher.dispose()
    await rm(root, { recursive: true, force: true })
  })

  test("caps pending watcher events and requests reconciliation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-cap-"))
    const cacheDir = path.join(root, ".cache")
    await mkdir(cacheDir, { recursive: true })
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const watcher = new FileWatcher(root, cache)
    watcher.setCollecting(false)
    watcher.enqueueSyntheticEvents(
      Array.from({ length: 1_100 }, (_, index) => ({
        path: path.join(root, `file-${index}.ts`),
        type: "change" as const,
      })),
    )

    expect(watcher.getPendingEventCount()).toBe(1_000)
    expect(await watcher.drainPending()).toBe(false)
    expect(watcher.takeReconciliationRequest()).toBe(true)
    expect(watcher.takeReconciliationRequest()).toBe(false)
    watcher.dispose()
  })

  test("waits for an in-flight batch before returning a drain timeout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-drain-timeout-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "main.ts")
    await mkdir(cacheDir, { recursive: true })
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const watcher = new FileWatcher(root, cache)
    const gate = Promise.withResolvers<void>()
    const data = watcher as unknown as {
      accumulatedEvents: Map<string, { path: string; type: "create" | "change" | "delete" }>
      drainTask?: Promise<void>
    }
    data.accumulatedEvents.set(file, { path: file, type: "change" })
    data.drainTask = gate.promise

    let returned = false
    const draining = watcher.drainPending(1000, 5, true).then((result) => {
      returned = true
      return result
    })
    await Bun.sleep(20)

    expect(returned).toBe(false)
    gate.resolve()
    expect(await draining).toBe(false)
    expect(watcher.takeReconciliationRequest()).toBe(true)

    watcher.dispose()
    await rm(root, { recursive: true, force: true })
  })

  test("emits retry telemetry for watcher upsert retries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "oversized.ts")
    const line = "x".repeat(5000)

    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, line)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: IndexingTelemetryEvent[] = []
    const watcher = new FileWatcher(
      root,
      cache,
      createEmbedder(),
      new RetryStore(1),
      undefined,
      1,
      2,
      (event) => events.push(event),
      {
        provider: "openai",
        vectorStore: "lancedb",
        modelId: "text-embedding-3-small",
      },
    )
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }

    await data.processBatch(
      new Map([
        [
          file,
          {
            path: file,
            type: "create",
          },
        ],
      ]),
    )

    const retry = events.find((event) => event.type === "batch_retry")
    expect(retry).toBeDefined()
    expect(retry?.type).toBe("batch_retry")
    expect(retry?.source).toBe("watcher")
    expect(retry?.attempt).toBe(1)
    expect(retry?.maxRetries).toBe(2)
    expect(retry?.error).toContain("[REDACTED_PATH]")
  })

  test("emits error telemetry when watcher retries are exhausted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "oversized.ts")
    const line = "x".repeat(5000)

    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, line)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: IndexingTelemetryEvent[] = []
    const watcher = new FileWatcher(
      root,
      cache,
      createEmbedder(),
      new RetryStore(10),
      undefined,
      1,
      2,
      (event) => events.push(event),
      {
        provider: "openai",
        vectorStore: "lancedb",
        modelId: "text-embedding-3-small",
      },
    )
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }

    await data.processBatch(
      new Map([
        [
          file,
          {
            path: file,
            type: "create",
          },
        ],
      ]),
    )

    const error = events.find(
      (event): event is Extract<IndexingTelemetryEvent, { type: "error" }> =>
        event.type === "error" && event.location === "file-watcher:upsert_retry_exhausted",
    )
    expect(error).toBeDefined()
    expect(error?.type).toBe("error")
    expect(error?.source).toBe("watcher")
    expect(error?.mode).toBe("incremental")
    expect(error?.retryCount).toBe(2)
    expect(error?.error).toContain("[REDACTED_PATH]")
    await expect(watcher.drainPending()).rejects.toThrow("watcher upsert failure")
    expect(watcher.takeReconciliationRequest()).toBe(true)
  })

  test("updates worktree shadows when a baseline file changes and reverts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "file.ts")
    const baseline = "export const baseline = '" + "x".repeat(100) + "'\n"
    const changed = "export const changed = '" + "y".repeat(100) + "'\n"
    const baselineHash = createHash("sha256").update(baseline).digest("hex")

    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, changed)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.seedHashes({ [file]: baselineHash })
    const overlay = new WorktreeOverlay(root, path.join(root, "baseline"), new Map([["file.ts", baselineHash]]))
    const store = new RetryStore(0)
    const watcher = new FileWatcher(root, cache, createEmbedder(), store)
    watcher.setOverlay(overlay)
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }

    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "change" }]]))

    expect(overlay.shadows.has("file.ts")).toBe(true)
    expect(overlay.blocked.has("file.ts")).toBe(false)
    expect(cache.getHash(file)).toBe(createHash("sha256").update(changed).digest("hex"))

    await writeFile(file, baseline)
    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "change" }]]))

    expect(overlay.shadows.has("file.ts")).toBe(false)
    expect(overlay.blocked.has("file.ts")).toBe(false)
    expect(cache.getHash(file)).toBe(baselineHash)
    expect(store.points.length).toBeGreaterThan(0)
    const count = store.points.length

    await writeFile(file, changed)
    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "change" }]]))
    await writeFile(file, baseline)
    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "change" }]]))

    expect(store.points).toHaveLength(count * 2)
  })

  test("reports unexpected drain failures for recovery", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "file.ts")
    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, "export const value = '" + "x".repeat(100) + "'\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.flush = async () => {
      throw new Error("cache flush failed")
    }
    const watcher = new FileWatcher(root, cache, createEmbedder(), new RetryStore(0))
    const summary = new Promise<{ batchError?: Error }>((resolve) => {
      watcher.onDidFinishBatchProcessing.on(resolve)
    })
    const data = watcher as unknown as {
      handleFileEvent(filePath: string, type: "create" | "change" | "delete"): void
    }

    watcher.setCollecting(true)
    data.handleFileEvent(file, "create")
    const result = await Promise.race([
      summary,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("watcher did not report failure")), 2000)),
    ])

    expect(result.batchError?.message).toBe("cache flush failed")
    await watcher.shutdown()
  })

  test("processFile skips files matched by .kilocodeignore during incremental updates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "secret.ts")

    await mkdir(cacheDir, { recursive: true })
    await writeFile(path.join(root, ".kilocodeignore"), "secret.ts\n")
    await writeFile(file, "export const secret = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const watcher = new FileWatcher(root, cache, createEmbedder(), undefined, await loadIgnore(root))
    const result = await watcher.processFile(file)

    expect(result.status).toBe("skipped")
    expect(result.reason).toBe("File is ignored by .gitignore or .kilocodeignore")
  })

  test("processFile skips plugin state directories under the workspace root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, ".kilo", "worktrees", "feature", "main.c")

    await mkdir(path.dirname(file), { recursive: true })
    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, "int main(void) { return 0; }\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const watcher = new FileWatcher(root, cache, createEmbedder())
    const result = await watcher.processFile(file)

    expect(result.status).toBe("skipped")
    expect(result.reason).toBe("File is in an ignored directory")
  })

  test("processFile indexes an explicitly opened worktree root", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const root = path.join(base, ".kilo", "worktrees", "feature")
    const cacheDir = path.join(base, ".cache")
    const file = path.join(root, "main.c")

    await mkdir(root, { recursive: true })
    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, "int main(void) { return 0; }\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const watcher = new FileWatcher(root, cache, createEmbedder())
    const result = await watcher.processFile(file)

    expect(result.status).toBe("processed_for_batching")
  })

  test("processBatch updates Code Graph before RAG embedding", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "main.c")

    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      file,
      [
        "int main(void) {",
        ...Array.from({ length: 20 }, (_, index) => `  int value${index} = ${index};`),
        "  return value0;",
        "}",
        "",
      ].join("\n"),
    )

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const graph = new CodeGraphJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const postings = new CodePostingsJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const store = new RecordStore()
    const watcher = new FileWatcher(
      root,
      cache,
      createEmbedder(),
      store,
      undefined,
      1,
      1,
      undefined,
      undefined,
      graph,
      postings,
    )
    const order: string[] = []
    const real = watcher.processFile.bind(watcher)
    watcher.processFile = async (filePath, target = "all") => {
      order.push(target)
      if (target !== "rag") return real(filePath, target)

      const data = await graph.getFileGraph(file)
      expect(data?.functions[0]?.name).toBe("main")
      return {
        path: filePath,
        status: "processed_for_batching" as const,
        newHash: "manual-rag-hash",
        pointsToUpsert: [
          {
            id: "manual-point",
            vector: [1],
            payload: {
              active: false,
              filePath,
              codeChunk: "int main(void)",
              startLine: 1,
              endLine: 1,
            },
          },
        ],
      }
    }
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }

    await data.processBatch(
      new Map([
        [
          file,
          {
            path: file,
            type: "create",
          },
        ],
      ]),
    )

    expect(order).toEqual(["codeGraph", "rag"])
    expect(store.points).toBeGreaterThan(0)
    expect(cache.getHash(file)).toBe("manual-rag-hash")
    expect((await graph.getFileGraph(file))?.functions[0]?.name).toBe("main")
    expect((await postings.search("main"))[0]?.filePath).toBe("main.c")
  })

  test("restores Code Graph evidence when a worktree file reverts to its baseline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-worktree-revert-"))
    const cacheDir = path.join(root, ".cache")
    const file = path.join(root, "main.c")
    const source = "int QA_BASELINE_RESTORED(void) { return 1; }\n"
    const hash = createHash("sha256").update(source).digest("hex")
    let embeddings = 0

    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, source)
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.seedHashes({ [file]: hash })
    const graph = new CodeGraphJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const postings = new CodePostingsJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const tracked = {
      ...createEmbedder(),
      createEmbeddings: async (texts: string[]) => {
        embeddings += texts.length
        return { embeddings: texts.map(() => [0.1]) }
      },
    } satisfies IEmbedder
    const watcher = new FileWatcher(
      root,
      cache,
      tracked,
      new RecordStore(),
      undefined,
      1,
      1,
      undefined,
      undefined,
      graph,
      postings,
    )
    const overlay = new WorktreeOverlay(root, path.join(root, "baseline"), new Map([["main.c", hash]]))
    const data = watcher as unknown as {
      processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
    }
    watcher.setOverlay(overlay)

    await rm(file)
    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "delete" }]]))
    expect(await graph.getFileGraph(file)).toBeUndefined()

    await writeFile(file, source)
    overlay.block(file)
    await data.processBatch(new Map([[file, { path: file, type: "create" }]]))

    expect((await graph.getFileGraph(file))?.functions[0]?.name).toBe("QA_BASELINE_RESTORED")
    expect((await postings.search("QA_BASELINE_RESTORED"))[0]?.filePath).toBe("main.c")
    expect(overlay.shadows.has("main.c")).toBe(false)
    expect(overlay.blocked.has("main.c")).toBe(false)
    expect(cache.getHash(file)).toBe(hash)
    expect(embeddings).toBe(0)
    watcher.dispose()
    await rm(root, { recursive: true, force: true })
  })

  test("processFile uses the configured extension allowlist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    const cacheDir = path.join(root, ".cache")
    const custom = path.join(root, "source.custom")
    const excluded = path.join(root, "source.ts")
    const content = "custom source content ".repeat(20)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(custom, content)
    await writeFile(excluded, content)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const watcher = new FileWatcher(
      root,
      cache,
      createEmbedder(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      [".custom"],
      new CodeParser([".custom"]),
    )

    const first = await watcher.processFile(custom)
    expect(first.status).toBe("processed_for_batching")
    if (first.status === "processed_for_batching" && first.newHash) cache.updateHash(custom, first.newHash)
    expect(await watcher.processFile(excluded)).toMatchObject({
      status: "skipped",
      reason: "File extension is not configured for indexing",
    })
    await writeFile(custom, new Uint8Array([0, 1, 2, 3]))
    expect(await watcher.processFile(custom)).toMatchObject({ status: "skipped", reason: "File is binary" })
    expect(cache.getHash(custom)).toBeUndefined()
    await writeFile(custom, content)
    expect((await watcher.processFile(custom)).status).toBe("processed_for_batching")
  })

  test("processFile skips files matched by nested .gitignore during incremental updates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "file-watcher-test-"))
    try {
      const cacheDir = path.join(root, ".cache")
      const dir = path.join(root, "pkg")
      const file = path.join(dir, "secret.ts")

      await mkdir(cacheDir, { recursive: true })
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, ".gitignore"), "secret.ts\n")
      await writeFile(file, "export const secret = 1\n")

      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()

      const watcher = new FileWatcher(root, cache, createEmbedder(), undefined, await loadIgnore(root))
      const result = await watcher.processFile(file)

      expect(result.status).toBe("skipped")
      expect(result.reason).toBe("File is ignored by .gitignore or .kilocodeignore")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
