import { watch as chokidarWatch, type FSWatcher as ChokidarFSWatcher } from "chokidar"
import { stat, readFile } from "fs/promises"
import { createHash } from "crypto"
import path from "path"
import { Emitter, type Disposable } from "../runtime"
import { MAX_FILE_SIZE_BYTES, BATCH_SEGMENT_THRESHOLD, MAX_BATCH_RETRIES, INITIAL_RETRY_DELAY_MS } from "../constants"
import { scannerExtensions } from "../shared/supported-extensions"
import {
  type IFileWatcher,
  type WatcherSyntheticEvent,
  type ICodeParser,
  type FileProcessingResult,
  type IEmbedder,
  type IndexingScanTarget,
  type IVectorStore,
  type PointStruct,
  type BatchProcessingSummary,
  type ICacheManager,
} from "../interfaces"
import type { IndexingTelemetryMeta, IndexingTelemetryReporter } from "../interfaces/telemetry"
import type { CodeGraphFileGraph, ICodeGraphStorage, ICodePostingsStorage } from "../codegraph"
import { codeParser } from "./parser"
import { isCodeGraphSupportedPath, parseCodeGraphFile } from "../codegraph/parser"
import { CacheManager } from "../cache-manager"
import {
  generateNormalizedAbsolutePath,
  generateRelativeFilePath,
  generateRelativeIgnorePath,
} from "../shared/get-relative-path"
import { FileIgnore } from "../../file/ignore"
import { Log } from "../../util/log"
import type { WorktreeOverlay } from "../worktree-overlay"
import { sanitizeErrorMessage } from "../shared/validation-helpers"
import type { RagCheckpointMeta } from "../rag-checkpoint"
import { fallbackCheckpointMeta, generationForFile, pointForBlock, vectorContext } from "../rag-checkpoint"
import { IndexingRunLock } from "../run-lock"
import { constrained, type IndexingPressure } from "../memory"
import type { IgnoreMatcher } from "../shared/load-ignore"
import { isBinary } from "../shared/is-binary"

const log = Log.create({ service: "file-watcher" })
const WATCHER_READY_TIMEOUT_MS = 30_000
const GENERATION_FINALIZE_BATCH_SIZE = 64

/**
 * Implementation of the file watcher interface.
 *
 * RATIONALE: Uses chokidar instead of vscode.workspace.createFileSystemWatcher
 * so the watcher works outside VS Code (CLI, tests, headless).
 */
export class FileWatcher implements IFileWatcher {
  private ignoreInstance?: IgnoreMatcher
  private watcher?: ChokidarFSWatcher
  private accumulatedEvents: Map<string, { path: string; type: "create" | "change" | "delete" }> = new Map()
  private batchProcessDebounceTimer?: NodeJS.Timeout
  private readonly BATCH_DEBOUNCE_DELAY_MS = 500
  private readonly BATCH_MAX_LATENCY_MS = 2_000
  private readonly MAX_PENDING_EVENTS = 1_000
  private batchSegmentThreshold: number
  private maxBatchRetries: number
  private collecting = false
  private draining = false
  private pressure: IndexingPressure = "normal"
  private reconcile = false
  private batchStartedAt: number | undefined
  private drainTask?: Promise<void>
  private ready?: Promise<void>
  private cancelReady?: (err: Error) => void
  private runId: string = globalThis.crypto.randomUUID()
  private ragMeta: RagCheckpointMeta | undefined
  private readonly writeCache: boolean
  private overlay?: WorktreeOverlay
  private readonly extensions: ReadonlySet<string>

  public readonly onDidStartBatchProcessing = new Emitter<string[]>()
  public readonly onBatchProgressUpdate = new Emitter<{
    processedInBatch: number
    totalInBatch: number
    currentFile?: string
  }>()
  public readonly onDidFinishBatchProcessing = new Emitter<BatchProcessingSummary>()

  constructor(
    private workspacePath: string,
    private readonly cacheManager: CacheManager,
    private embedder?: IEmbedder,
    private vectorStore?: IVectorStore,
    ignoreInstance?: IgnoreMatcher,
    batchSegmentThreshold?: number,
    maxBatchRetries?: number,
    private readonly onTelemetry?: IndexingTelemetryReporter,
    private readonly telemetryMeta?: IndexingTelemetryMeta,
    private readonly graph?: ICodeGraphStorage,
    private readonly postings?: ICodePostingsStorage,
    opts: { writeCache?: boolean; lockCacheDirectory?: string } = {},
    extensions: readonly string[] = scannerExtensions,
    private readonly parser: ICodeParser = codeParser,
  ) {
    if (ignoreInstance) {
      this.ignoreInstance = ignoreInstance
    }
    this.batchSegmentThreshold = batchSegmentThreshold ?? BATCH_SEGMENT_THRESHOLD
    this.maxBatchRetries = maxBatchRetries ?? MAX_BATCH_RETRIES
    this.writeCache = opts.writeCache ?? true
    this.lockCacheDirectory = opts.lockCacheDirectory
    this.extensions = new Set(extensions)
  }

  private checkpointCache(): Promise<void> {
    const cache: ICacheManager = this.cacheManager
    if (cache.checkpoint) return cache.checkpoint()
    if (cache.flush) return cache.flush()
    return Promise.resolve()
  }

  private readonly lockCacheDirectory?: string
  private target: IndexingScanTarget = "all"
  private ownsLock = false
  private batchError?: Error

  private emitRetry(attempt: number, batchSize: number, err: unknown): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "batch_retry",
      source: "watcher",
      mode: "incremental",
      attempt,
      maxRetries: this.maxBatchRetries,
      batchSize,
      error: sanitizeErrorMessage(msg),
    })
  }

  private emitError(location: string, err: unknown, retryCount?: number, file?: string): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "error",
      source: "watcher",
      mode: "incremental",
      location,
      error: sanitizeErrorMessage(msg),
      file,
      retryCount,
      maxRetries: this.maxBatchRetries,
    })
  }

  /**
   * Initializes the file watcher using chokidar.
   *
   * RATIONALE: chokidar watches the filesystem directly using native OS events,
   * removing the dependency on VS Code's file system watcher API.
   */
  async initialize(): Promise<void> {
    if (this.ready) {
      await this.ready
      return
    }

    const started = Date.now()
    const pending = this.accumulatedEvents.size
    log.info("initializing file watcher", {
      visible: true,
      workspacePath: this.workspacePath,
      blocking: false,
      ignoredRoots: FileIgnore.FOLDERS,
      pendingBeforeReady: pending,
    })

    const watcher = chokidarWatch(this.workspacePath, {
      ignored: (filePath: string) => {
        const relativeFilePath = generateRelativeIgnorePath(filePath, this.workspacePath)
        if (!relativeFilePath) return false
        if (FileIgnore.match(relativeFilePath)) return true
        return this.ignoreInstance?.ignores(relativeFilePath) ?? false
      },
      persistent: true,
      ignoreInitial: true,
    })
    this.watcher = watcher

    watcher.on("add", (filePath) => this.handleFileEvent(filePath, "create"))
    watcher.on("change", (filePath) => this.handleFileEvent(filePath, "change"))
    watcher.on("unlink", (filePath) => this.handleFileEvent(filePath, "delete"))
    const value = Number(process.env.CHIPMATE_INDEXING_WATCHER_READY_TIMEOUT_MS)
    const timeout = Number.isFinite(value) && value >= 0 ? value : WATCHER_READY_TIMEOUT_MS
    if (timeout === 0) {
      this.watcher = undefined
      void watcher.close().catch((err) => {
        log.warn("failed to close unavailable file watcher", {
          workspacePath: this.workspacePath,
          err,
        })
      })
      throw new Error("File watcher did not become ready within 0ms.")
    }
    this.ready = new Promise((resolve, reject) => {
      let pending = true
      const clean = () => {
        clearTimeout(timer)
        watcher.off("ready", pass)
        watcher.off("error", fail)
        this.cancelReady = undefined
      }
      const pass = () => {
        pending = false
        clearTimeout(timer)
        watcher.off("ready", pass)
        this.cancelReady = undefined
        resolve()
      }
      const fail = (err: unknown) => {
        if (!pending) {
          const error = err instanceof Error ? err : new Error(String(err))
          log.warn("file watcher runtime error; requesting index recovery", {
            visible: true,
            workspacePath: this.workspacePath,
            err: error,
          })
          this.batchError = error
          this.reconcile = true
          this.onDidFinishBatchProcessing.fire({
            processedFiles: [],
            batchError: error,
          })
          return
        }
        pending = false
        clean()
        reject(err)
      }
      const timer = setTimeout(() => fail(new Error(`File watcher did not become ready within ${timeout}ms.`)), timeout)
      this.cancelReady = (err) => fail(err)
      watcher.once("ready", pass)
      watcher.on("error", fail)
    })
    const ready = this.ready
    await ready.catch((err) => {
      if (this.ready === ready) {
        this.ready = undefined
        this.watcher = undefined
      }
      void watcher.close().catch((close) => {
        log.warn("failed to close unavailable file watcher", {
          workspacePath: this.workspacePath,
          err: close,
        })
      })
      throw err
    })
    if (this.ready === ready) this.ready = undefined
    log.info("file watcher ready", {
      visible: true,
      workspacePath: this.workspacePath,
      blocking: false,
      readyMs: Date.now() - started,
      pendingBeforeReady: pending,
      pendingAfterReady: this.accumulatedEvents.size,
      ignoredRoots: FileIgnore.FOLDERS,
    })
  }

  getPendingEventCount(): number {
    return this.accumulatedEvents.size
  }

  takeReconciliationRequest(): boolean {
    const value = this.reconcile
    this.reconcile = false
    return value
  }

  setMemoryPressure(pressure: IndexingPressure): void {
    this.pressure = pressure
  }

  setOverlay(overlay?: WorktreeOverlay): void {
    this.overlay = overlay
  }

  setCollecting(collecting: boolean): void {
    this.collecting = collecting
    if (!collecting && this.batchProcessDebounceTimer) {
      clearTimeout(this.batchProcessDebounceTimer)
      this.batchProcessDebounceTimer = undefined
    }
    log.info("updated watcher collection mode", {
      workspacePath: this.workspacePath,
      collecting,
      pendingEvents: this.accumulatedEvents.size,
    })
    if (collecting) this.scheduleBatchProcessing()
  }

  enqueueSyntheticEvents(events: WatcherSyntheticEvent[]): void {
    let queued = 0
    for (const event of events) {
      if (!this.shouldIndex(event.path)) continue
      if (this.queue(event)) queued += 1
    }
    log.info("queued synthetic watcher events", {
      visible: true,
      workspacePath: this.workspacePath,
      queued,
      pendingEvents: this.accumulatedEvents.size,
      collecting: this.collecting,
    })
    if (this.collecting) this.scheduleBatchProcessing()
  }

  /**
   * Updates the batch segment threshold.
   */
  updateBatchSegmentThreshold(newThreshold: number): void {
    this.batchSegmentThreshold = newThreshold
  }

  setRunContext(runId: string, meta: RagCheckpointMeta): void {
    this.runId = runId
    this.ragMeta = meta
  }

  setTarget(target: IndexingScanTarget): void {
    this.target = target
  }

  async drainPending(limit = 1000, timeout = 30_000, ownsLock = false): Promise<boolean> {
    this.throwBatchError()
    if (this.accumulatedEvents.size > limit || this.reconcile) {
      this.reconcile = true
      return false
    }
    this.ownsLock = ownsLock
    try {
      this.setCollecting(true)
      const started = Date.now()
      let timedOut = false
      while (this.accumulatedEvents.size > 0 || this.drainTask || this.batchProcessDebounceTimer) {
        if (this.accumulatedEvents.size > limit || Date.now() - started >= timeout) {
          timedOut = true
          break
        }
        const task = this.drainTask
        if (task) {
          const remaining = Math.max(0, timeout - (Date.now() - started))
          if (!(await settlesWithin(task, remaining))) {
            timedOut = true
            break
          }
        } else {
          await delay(10)
        }
        this.throwBatchError()
      }
      if (timedOut) {
        this.reconcile = true
        this.setCollecting(false)
        log.warn("file watcher drain soft deadline exceeded", {
          workspacePath: this.workspacePath,
          timeout,
          pendingEvents: this.accumulatedEvents.size,
          inFlight: Boolean(this.drainTask),
        })

        // Never let the caller release the workspace lock while a timed-out
        // batch can still mutate the candidate index.
        await this.drainTask
        this.throwBatchError()
        return false
      }
      this.throwBatchError()
      return !this.reconcile
    } finally {
      this.ownsLock = false
    }
  }

  private throwBatchError(): void {
    const err = this.batchError
    this.batchError = undefined
    if (err) throw err
  }

  /**
   * Disposes the file watcher and cleans up resources.
   */
  async shutdown(): Promise<void> {
    this.collecting = false
    if (this.batchProcessDebounceTimer) clearTimeout(this.batchProcessDebounceTimer)
    this.batchProcessDebounceTimer = undefined
    await this.watcher?.close()
    await this.drainTask
    this.dispose()
  }

  dispose(): void {
    this.collecting = false
    const err = new Error("File watcher disposed before becoming ready.")
    err.name = "AbortError"
    this.cancelReady?.(err)
    void this.watcher?.close()
    if (this.batchProcessDebounceTimer) clearTimeout(this.batchProcessDebounceTimer)
    this.batchProcessDebounceTimer = undefined
    this.onDidStartBatchProcessing.dispose()
    this.onBatchProgressUpdate.dispose()
    this.onDidFinishBatchProcessing.dispose()
    this.accumulatedEvents.clear()
    this.ready = undefined
  }

  /**
   * Handles a file event from chokidar by accumulating it and scheduling batch processing.
   */
  private handleFileEvent(filePath: string, type: "create" | "change" | "delete"): void {
    if (!this.shouldIndex(filePath)) return
    this.overlay?.block(filePath)
    this.queue({ path: filePath, type })
    if (!this.collecting) return
    this.scheduleBatchProcessing()
  }

  /**
   * Schedules batch processing with debounce.
   */
  private scheduleBatchProcessing(): void {
    if (!this.collecting || this.drainTask) return
    if (this.batchProcessDebounceTimer) {
      clearTimeout(this.batchProcessDebounceTimer)
    }
    const now = Date.now()
    this.batchStartedAt ??= now
    const left = Math.max(0, this.BATCH_MAX_LATENCY_MS - (now - this.batchStartedAt))
    const wait = this.accumulatedEvents.size >= this.sliceSize() ? 0 : Math.min(this.BATCH_DEBOUNCE_DELAY_MS, left)
    this.batchProcessDebounceTimer = setTimeout(() => {
      this.batchProcessDebounceTimer = undefined
      const task = this.triggerBatchProcessing().catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err))
        this.collecting = false
        this.onDidFinishBatchProcessing.fire({ processedFiles: [], batchError: error })
      })
      this.drainTask = task.finally(() => {
        this.drainTask = undefined
        if (this.collecting && this.accumulatedEvents.size > 0) this.scheduleBatchProcessing()
      })
    }, wait)
  }

  /**
   * Triggers processing of accumulated events.
   */
  private async triggerBatchProcessing(): Promise<void> {
    if (this.draining || this.accumulatedEvents.size === 0 || !this.collecting) {
      return
    }

    this.draining = true
    log.info("starting watcher event drain", {
      workspacePath: this.workspacePath,
      pendingEvents: this.accumulatedEvents.size,
    })

    try {
      while (this.collecting && this.accumulatedEvents.size > 0) {
        const events = new Map<string, { path: string; type: "create" | "change" | "delete" }>()
        for (const [file, event] of this.accumulatedEvents) {
          events.set(file, event)
          this.accumulatedEvents.delete(file)
          if (events.size >= this.sliceSize()) break
        }

        const filePathsInBatch = Array.from(events.keys())
        const lock = await this.acquireBatchLock()
        if (this.lockCacheDirectory && !lock && !this.ownsLock) {
          for (const [file, event] of events) {
            if (!this.accumulatedEvents.has(file)) this.accumulatedEvents.set(file, event)
          }
          break
        }
        this.onDidStartBatchProcessing.fire(filePathsInBatch)
        try {
          await this.processBatch(events)
        } finally {
          await lock?.release()
        }
        await delay(0)
      }
    } finally {
      this.draining = false
      this.batchStartedAt = this.accumulatedEvents.size > 0 ? Date.now() : undefined
      if (this.collecting && this.accumulatedEvents.size > 0) this.scheduleBatchProcessing()
      log.info("completed watcher event drain", { workspacePath: this.workspacePath })
    }
  }

  private queue(event: { path: string; type: "create" | "change" | "delete" }): boolean {
    if (!this.accumulatedEvents.has(event.path) && this.accumulatedEvents.size >= this.MAX_PENDING_EVENTS) {
      this.reconcile = true
      return false
    }
    this.accumulatedEvents.set(event.path, event)
    return true
  }

  private sliceSize(): number {
    return constrained(this.pressure) ? 1 : 16
  }

  private concurrency(): number {
    return constrained(this.pressure) ? 1 : 2
  }

  private segmentThreshold(): number {
    return Math.max(1, Math.min(this.batchSegmentThreshold, constrained(this.pressure) ? 16 : 60))
  }

  private async acquireBatchLock(): Promise<IndexingRunLock | undefined> {
    if (!this.lockCacheDirectory || this.ownsLock) return undefined

    while (this.collecting) {
      const result = await IndexingRunLock.acquire({
        cacheDirectory: this.lockCacheDirectory,
        workspacePath: this.workspacePath,
      })
      if (result.status === "acquired") return result.lock

      log.warn("watcher batch waiting for indexing lock", {
        visible: true,
        workspacePath: this.workspacePath,
        reason: result.reason,
        ownerPid: result.owner?.pid,
        ownerRunId: result.owner?.runId,
        retryAfterMs: result.retryAfterMs,
      })
      await delay(result.retryAfterMs)
    }

    return undefined
  }

  private shouldIndex(filePath: string) {
    const relativeFilePath = generateRelativeIgnorePath(filePath, this.workspacePath)
    if (!relativeFilePath) return false
    const ext = path.extname(filePath).toLowerCase()
    if (FileIgnore.match(relativeFilePath)) return false
    if (this.ignoreInstance?.ignores(relativeFilePath)) return false
    return this.extensions.has(ext)
  }

  /**
   * Handles deletion phase of batch processing.
   *
   * Deletes vector store points for explicitly deleted files and for files
   * that changed (old points are cleared before re-upserting new ones).
   */
  private async _handleBatchDeletions(
    batchResults: FileProcessingResult[],
    processedCountInBatch: number,
    totalFilesInBatch: number,
    pathsToExplicitlyDelete: string[],
    filesToUpsertDetails: Array<{ path: string; originalType: "create" | "change" }>,
  ): Promise<{ overallBatchError?: Error; clearedPaths: Set<string>; processedCount: number }> {
    let overallBatchError: Error | undefined
    const allPathsToClearFromDB = new Set<string>(pathsToExplicitlyDelete)

    for (const filePath of pathsToExplicitlyDelete) {
      await this.removeFileGraph(filePath)
    }

    for (const fileDetail of filesToUpsertDetails) {
      if (fileDetail.originalType === "change") continue
    }

    if (allPathsToClearFromDB.size > 0 && !this.vectorStore) {
      for (const path of pathsToExplicitlyDelete) {
        if (this.writeCache) {
          this.cacheManager.deleteHash(path)
          await this.checkpointCache()
        }
        batchResults.push({ path, status: "success" })
        processedCountInBatch++
        this.onBatchProgressUpdate.fire({
          processedInBatch: processedCountInBatch,
          totalInBatch: totalFilesInBatch,
          currentFile: path,
        })
      }
      return { overallBatchError, clearedPaths: allPathsToClearFromDB, processedCount: processedCountInBatch }
    }

    if (allPathsToClearFromDB.size > 0 && this.vectorStore) {
      try {
        await this.vectorStore.deletePointsByMultipleFilePaths(Array.from(allPathsToClearFromDB))

        for (const path of pathsToExplicitlyDelete) {
          if (this.writeCache) {
            this.cacheManager.deleteHash(path)
            await this.checkpointCache()
          }
          batchResults.push({ path, status: "success" })
          processedCountInBatch++
          this.onBatchProgressUpdate.fire({
            processedInBatch: processedCountInBatch,
            totalInBatch: totalFilesInBatch,
            currentFile: path,
          })
        }
      } catch (error: any) {
        const errorStatus = error?.status || error?.response?.status || error?.statusCode
        const errorMessage = error instanceof Error ? error.message : String(error)

        log.error("batch deletion failed", {
          error: sanitizeErrorMessage(errorMessage),
          location: "deletePointsByMultipleFilePaths",
          errorType: "deletion_error",
          errorStatus,
        })
        this.emitError("file-watcher:deletePointsByMultipleFilePaths", error)

        overallBatchError = error as Error
        for (const path of pathsToExplicitlyDelete) {
          batchResults.push({ path, status: "error", error: error as Error })
          processedCountInBatch++
          this.onBatchProgressUpdate.fire({
            processedInBatch: processedCountInBatch,
            totalInBatch: totalFilesInBatch,
            currentFile: path,
          })
        }
      }
    }

    return { overallBatchError, clearedPaths: allPathsToClearFromDB, processedCount: processedCountInBatch }
  }

  /**
   * Processes individual files, parses them, creates embeddings, and collects
   * the resulting points for a later batch upsert.
   */
  private async _processFilesAndPrepareUpserts(
    filesToUpsertDetails: Array<{ path: string; originalType: "create" | "change" }>,
    batchResults: FileProcessingResult[],
    processedCountInBatch: number,
    totalFilesInBatch: number,
    pathsToExplicitlyDelete: string[],
    target: IndexingScanTarget = "all",
    overallBatchError?: Error,
  ): Promise<{
    overallBatchError?: Error
    processedCount: number
  }> {
    const filesToProcessConcurrently = [...filesToUpsertDetails]
    const prepared: Array<{ path: string; newHash?: string; points: PointStruct[] }> = []

    for (let i = 0; i < filesToProcessConcurrently.length; i += this.concurrency()) {
      const chunkToProcess = filesToProcessConcurrently.slice(i, i + this.concurrency())

      const chunkProcessingPromises = chunkToProcess.map(async (fileDetail) => {
        this.onBatchProgressUpdate.fire({
          processedInBatch: processedCountInBatch,
          totalInBatch: totalFilesInBatch,
          currentFile: fileDetail.path,
        })
        try {
          const result = await this.processFile(fileDetail.path, target, true)
          return { path: fileDetail.path, result: result, error: undefined }
        } catch (e) {
          const error = e as Error
          log.error(`unhandled exception processing file ${fileDetail.path}`, { error })
          return { path: fileDetail.path, result: undefined, error: error }
        }
      })

      const settledChunkResults = await Promise.allSettled(chunkProcessingPromises)

      for (const settledResult of settledChunkResults) {
        let resultPath: string | undefined

        if (settledResult.status === "fulfilled") {
          const { path, result, error: directError } = settledResult.value
          resultPath = path

          if (directError) {
            batchResults.push({ path, status: "error", error: directError })
          } else if (result) {
            if (result.status === "skipped" || result.status === "local_error") {
              batchResults.push(result)
            } else if (result.status === "processed_for_batching" && result.pointsToUpsert) {
              prepared.push({
                path: result.path,
                newHash: result.newHash,
                points: result.pointsToUpsert,
              })
            } else {
              batchResults.push({
                path,
                status: "error",
                error: new Error(`Unexpected result status from processFile: ${result.status} for file ${path}`),
              })
            }
          } else {
            batchResults.push({
              path,
              status: "error",
              error: new Error(`Fulfilled promise with no result or error for file ${path}`),
            })
          }
        } else {
          const error = settledResult.reason as Error
          const rejectedPath = (settledResult.reason as any)?.path || "unknown"
          log.error("a file processing promise was rejected", { error })
          batchResults.push({
            path: rejectedPath,
            status: "error",
            error: error,
          })
        }

        if (!pathsToExplicitlyDelete.includes(resultPath || "")) {
          processedCountInBatch++
        }
        this.onBatchProgressUpdate.fire({
          processedInBatch: processedCountInBatch,
          totalInBatch: totalFilesInBatch,
          currentFile: resultPath,
        })
      }
    }

    for (let index = 0; index < prepared.length; index += GENERATION_FINALIZE_BATCH_SIZE) {
      const group = prepared.slice(index, index + GENERATION_FINALIZE_BATCH_SIZE)
      overallBatchError = await this._executeBatchUpsertOperations(
        group.flatMap((item) => item.points),
        group.map(({ path, newHash }) => ({ path, newHash })),
        batchResults,
        overallBatchError,
      )
    }

    return {
      overallBatchError,
      processedCount: processedCountInBatch,
    }
  }

  private async _processGraphUpdates(
    filesToUpsertDetails: Array<{ path: string; originalType: "create" | "change" }>,
    batchResults: FileProcessingResult[],
    processedCountInBatch: number,
    totalFilesInBatch: number,
  ): Promise<{ failed: Set<string>; processedCount: number }> {
    const failed = new Set<string>()
    if (!this.graph || filesToUpsertDetails.length === 0) return { failed, processedCount: processedCountInBatch }

    for (let i = 0; i < filesToUpsertDetails.length; i += this.concurrency()) {
      const chunk = filesToUpsertDetails.slice(i, i + this.concurrency())
      const settled = await Promise.allSettled(chunk.map((item) => this.processFile(item.path, "codeGraph")))

      for (let index = 0; index < settled.length; index += 1) {
        const file = chunk[index]!.path
        const item = settled[index]!
        if (item.status === "rejected") {
          const err = item.reason instanceof Error ? item.reason : new Error(String(item.reason))
          failed.add(file)
          batchResults.push({ path: file, status: "error", error: err })
          this.emitError("file-watcher:graphPhase", err, undefined, file)
        } else if (item.value.status === "error" || item.value.status === "local_error") {
          failed.add(file)
          batchResults.push(item.value)
          if (item.value.error) this.emitError("file-watcher:graphPhase", item.value.error, undefined, file)
        }

        processedCountInBatch += failed.has(file) ? 1 : 0
        this.onBatchProgressUpdate.fire({
          processedInBatch: processedCountInBatch,
          totalInBatch: totalFilesInBatch,
          currentFile: file,
        })
      }
    }

    return { failed, processedCount: processedCountInBatch }
  }

  /**
   * Executes batch upsert operations against the vector store with retry logic.
   */
  private async _executeBatchUpsertOperations(
    pointsForBatchUpsert: PointStruct[],
    successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }>,
    batchResults: FileProcessingResult[],
    overallBatchError?: Error,
  ): Promise<Error | undefined> {
    if (overallBatchError) {
      for (const { path } of successfullyProcessedForUpsert) {
        batchResults.push({ path, status: "error", error: overallBatchError })
      }
      return overallBatchError
    }

    try {
      if (pointsForBatchUpsert.length > 0 && this.vectorStore) {
        for (let i = 0; i < pointsForBatchUpsert.length; i += this.segmentThreshold()) {
          await this.upsert(pointsForBatchUpsert.slice(i, i + this.segmentThreshold()))
        }
      }

      const generations = successfullyProcessedForUpsert.flatMap(({ path, newHash }) =>
        newHash
          ? [
              {
                filePath: path,
                generation: this.fileGeneration(path, newHash),
                runId: this.runId,
              },
            ]
          : [],
      )
      if (this.vectorStore && generations.length > 0) {
        const store = this.vectorStore as IVectorStore & {
          finalizeFileGenerations?: (
            files: readonly { filePath: string; generation: string; runId: string }[],
          ) => Promise<void>
        }
        if (store.finalizeFileGenerations) {
          await store.finalizeFileGenerations(generations)
        } else {
          if (!store.activateFileGeneration || !store.deleteInactiveFilePoints) {
            throw new Error("Vector store does not support active generation checkpoints")
          }
          for (const file of generations) {
            await store.activateFileGeneration(file.filePath, file.generation, file.runId)
            await store.deleteInactiveFilePoints(file.filePath, file.generation)
          }
        }
      }
      if (this.writeCache) {
        for (const { path, newHash } of successfullyProcessedForUpsert) {
          if (newHash) this.cacheManager.updateHash(path, newHash)
        }
        await this.checkpointCache()
      }
      for (const { path } of successfullyProcessedForUpsert) {
        batchResults.push({ path, status: "success" })
      }
    } catch (error) {
      const err = error as Error
      overallBatchError = err
      this.emitError("file-watcher:batch_upsert_error", err)
      log.error("batch upsert error", {
        error: sanitizeErrorMessage(err.message),
        location: "executeBatchUpsertOperations",
        errorType: "batch_upsert_error",
        affectedFiles: successfullyProcessedForUpsert.length,
      })
      for (const { path } of successfullyProcessedForUpsert) {
        batchResults.push({ path, status: "error", error: err })
      }
    }

    return overallBatchError
  }

  /**
   * Processes a batch of accumulated events through three phases:
   * 1. Handle deletions (remove old points from vector store)
   * 2. Process files and prepare upserts (parse, embed)
   * 3. Execute batch upsert operations
   */
  private async processBatch(
    eventsToProcess: Map<string, { path: string; type: "create" | "change" | "delete" }>,
  ): Promise<void> {
    if (this.target === "codeGraph") {
      await this.processGraphBatch(eventsToProcess)
      return
    }
    const batchResults: FileProcessingResult[] = []
    let processedCountInBatch = 0
    const totalFilesInBatch = eventsToProcess.size
    let overallBatchError: Error | undefined

    // Initial progress update
    this.onBatchProgressUpdate.fire({
      processedInBatch: 0,
      totalInBatch: totalFilesInBatch,
      currentFile: undefined,
    })

    // Categorize events
    const pathsToExplicitlyDelete: string[] = []
    const filesToUpsertDetails: Array<{ path: string; originalType: "create" | "change" }> = []
    const reverts = new Map<string, string>()

    for (const event of eventsToProcess.values()) {
      if (event.type === "delete") {
        pathsToExplicitlyDelete.push(event.path)
        continue
      }

      const cached = this.cacheManager.getHash(event.path)
      const hash = await readFile(event.path, "utf-8")
        .then((content) => createHash("sha256").update(content).digest("hex"))
        .catch(() => undefined)
      if (cached && hash === cached) {
        batchResults.push({ path: event.path, status: "success", newHash: cached })
        processedCountInBatch++
        continue
      }
      if (hash && hash === this.overlay?.baselineHash(event.path)) {
        pathsToExplicitlyDelete.push(event.path)
        reverts.set(event.path, hash)
        if (this.graph) {
          filesToUpsertDetails.push({
            path: event.path,
            originalType: event.type,
          })
        }
        continue
      }

      filesToUpsertDetails.push({
        path: event.path,
        originalType: event.type,
      })
    }

    log.info("processing file watcher batch", {
      workspacePath: this.workspacePath,
      batchSize: totalFilesInBatch,
      deletes: pathsToExplicitlyDelete.length,
      upserts: filesToUpsertDetails.length,
    })

    // Phase 1: Handle deletions
    const { overallBatchError: deletionError, processedCount: deletionCount } = await this._handleBatchDeletions(
      batchResults,
      processedCountInBatch,
      totalFilesInBatch,
      pathsToExplicitlyDelete,
      filesToUpsertDetails,
    )
    overallBatchError = deletionError
    processedCountInBatch = deletionCount
    if (!deletionError) {
      for (const [filePath, hash] of reverts) this.cacheManager.updateHash(filePath, hash)
    }

    // Phase 2: Process files and prepare upserts
    const split = !!this.graph && !!this.embedder && !!this.vectorStore
    const graph = split
      ? await this._processGraphUpdates(filesToUpsertDetails, batchResults, processedCountInBatch, totalFilesInBatch)
      : { failed: new Set<string>(), processedCount: processedCountInBatch }
    processedCountInBatch = graph.processedCount
    const ragFiles = split
      ? filesToUpsertDetails.filter((item) => !graph.failed.has(item.path) && !reverts.has(item.path))
      : filesToUpsertDetails

    const rag = await this._processFilesAndPrepareUpserts(
      ragFiles,
      batchResults,
      processedCountInBatch,
      totalFilesInBatch,
      pathsToExplicitlyDelete,
      split ? "rag" : "all",
      overallBatchError,
    )
    processedCountInBatch = rag.processedCount
    overallBatchError = rag.overallBatchError

    const resultError = batchResults.find((item) => item.status === "error" || item.status === "local_error")?.error
    overallBatchError ??= resultError
    if (overallBatchError) {
      this.batchError = overallBatchError
      this.reconcile = true
    }
    await this.cacheManager.flush()

    for (const event of eventsToProcess.values()) {
      const result = batchResults.findLast((item) => item.path === event.path)
      if (result?.status !== "success") continue
      this.overlay?.settle(event.path, this.cacheManager.getHash(event.path), this.accumulatedEvents.has(event.path))
    }

    // Finalize
    this.onDidFinishBatchProcessing.fire({
      processedFiles: batchResults,
      batchError: overallBatchError,
    })

    const successCount = batchResults.filter((item) => item.status === "success").length
    const skippedCount = batchResults.filter((item) => item.status === "skipped").length
    const errorCount = batchResults.filter((item) => item.status === "error" || item.status === "local_error").length

    log.info("completed file watcher batch", {
      workspacePath: this.workspacePath,
      batchSize: totalFilesInBatch,
      successCount,
      skippedCount,
      errorCount,
      hasBatchError: !!overallBatchError,
    })

    this.onBatchProgressUpdate.fire({
      processedInBatch: totalFilesInBatch,
      totalInBatch: totalFilesInBatch,
    })

    if (this.accumulatedEvents.size === 0) {
      this.onBatchProgressUpdate.fire({
        processedInBatch: 0,
        totalInBatch: 0,
        currentFile: undefined,
      })
    }
  }

  private async processGraphBatch(
    events: Map<string, { path: string; type: "create" | "change" | "delete" }>,
  ): Promise<void> {
    const results: FileProcessingResult[] = []
    const paths = [...events.values()]
    this.onBatchProgressUpdate.fire({ processedInBatch: 0, totalInBatch: paths.length })

    for (const [index, event] of paths.entries()) {
      try {
        if (event.type === "delete") {
          await this.removeFileGraph(event.path)
          results.push({ path: event.path, status: "success" })
        } else {
          results.push(await this.processFile(event.path, "codeGraph"))
        }
      } catch (err) {
        results.push({
          path: event.path,
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        })
      }
      this.onBatchProgressUpdate.fire({
        processedInBatch: index + 1,
        totalInBatch: paths.length,
        currentFile: event.path,
      })
    }

    const error = results.find((item) => item.status === "error" || item.status === "local_error")?.error
    if (error) {
      this.batchError = error
      this.reconcile = true
    }
    this.onDidFinishBatchProcessing.fire({ processedFiles: results, batchError: error })
  }

  /**
   * Processes a single file: checks ignore rules, reads content, computes hash,
   * parses code blocks, creates embeddings, and returns points for batch upsert.
   */
  async processFile(
    filePath: string,
    target: IndexingScanTarget = "all",
    stream = false,
  ): Promise<FileProcessingResult> {
    try {
      const graphEnabled = target !== "rag"
      const ragEnabled = target !== "codeGraph"
      if (!this.extensions.has(path.extname(filePath).toLowerCase())) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File extension is not configured for indexing",
        }
      }

      // Check if file is in an ignored directory
      const relativeFilePath = generateRelativeIgnorePath(filePath, this.workspacePath)
      if (!relativeFilePath) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File path is outside workspace",
        }
      }

      if (FileIgnore.match(relativeFilePath)) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File is in an ignored directory",
        }
      }

      // Check if file should be ignored by root .gitignore / .chipmateignore rules.
      if (this.ignoreInstance && this.ignoreInstance.ignores(relativeFilePath)) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File is ignored by .gitignore or .chipmateignore",
        }
      }

      // Check file size
      const fileStat = await stat(filePath)
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File is too large",
        }
      }

      // Read file content
      const bytes = await readFile(filePath)
      if (isBinary(bytes)) {
        this.cacheManager.deleteHash(filePath)
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File is binary",
        }
      }
      const content = bytes.toString("utf-8")

      // Calculate hash
      const newHash = createHash("sha256").update(content).digest("hex")

      // Check if file has changed
      if (this.cacheManager.getHash(filePath) === newHash) {
        if (graphEnabled) await this.updateFileGraph(filePath, content, newHash)
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File has not changed",
        }
      }

      if (graphEnabled) await this.updateFileGraph(filePath, content, newHash)

      if (!ragEnabled) {
        return {
          path: filePath,
          status: "success" as const,
          newHash,
        }
      }

      // Parse file
      const blocks = await this.parser.parseFile(filePath, { content, fileHash: newHash })

      // Prepare points for batch processing
      const pointsToUpsert: PointStruct[] = []
      if (this.embedder && blocks.length > 0) {
        for (let index = 0; index < blocks.length; index += this.segmentThreshold()) {
          const slice = blocks.slice(index, index + this.segmentThreshold())
          const { embeddings } = await this.embedder.createEmbeddings(
            slice.map((block) => block.content),
            undefined,
            "document",
          )
          if (embeddings.length !== slice.length) {
            return {
              path: filePath,
              status: "local_error" as const,
              error: new Error(
                `Embedding count mismatch for ${filePath}: expected ${slice.length}, got ${embeddings.length}`,
              ),
            }
          }
          const points = slice.map((block, offset) => {
            const vector = embeddings[offset]!
            const normalizedAbsolutePath = generateNormalizedAbsolutePath(block.file_path, this.workspacePath)
            const relativeFilePath = generateRelativeFilePath(normalizedAbsolutePath, this.workspacePath)
            const generation = this.fileGeneration(relativeFilePath, newHash)
            return pointForBlock({ block, vector, workspace: this.workspacePath, ctx: this.ragContext(), generation })
          })
          if (stream && this.vectorStore) await this.upsert(points)
          else pointsToUpsert.push(...points)
        }
      }

      return {
        path: filePath,
        status: "processed_for_batching" as const,
        newHash,
        pointsToUpsert,
      }
    } catch (error) {
      return {
        path: filePath,
        status: "local_error" as const,
        error: error as Error,
      }
    }
  }

  private ragContext() {
    return vectorContext(this.workspacePath, this.runId, this.ragMeta ?? fallbackCheckpointMeta(this.workspacePath))
  }

  private async upsert(points: PointStruct[]): Promise<void> {
    if (!this.vectorStore || points.length === 0) return
    let retryCount = 0
    while (retryCount < this.maxBatchRetries) {
      try {
        await this.vectorStore.upsertPoints(points)
        return
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        retryCount++
        if (retryCount === this.maxBatchRetries) {
          log.error("upsert retry exhausted", {
            error: sanitizeErrorMessage(error.message),
            location: "upsertPoints",
            errorType: "upsert_retry_exhausted",
            retryCount: this.maxBatchRetries,
          })
          this.emitError("file-watcher:upsert_retry_exhausted", error, this.maxBatchRetries)
          throw new Error(`Failed to upsert batch after ${this.maxBatchRetries} retries: ${error.message}`)
        }
        this.emitRetry(retryCount, points.length, error)
        await delay(INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1))
      }
    }
  }

  private fileGeneration(filePath: string, fileHash: string): string {
    const meta = this.ragMeta ?? fallbackCheckpointMeta(this.workspacePath)
    const normalizedAbsolutePath = generateNormalizedAbsolutePath(filePath, this.workspacePath)
    const relativeFilePath = generateRelativeFilePath(normalizedAbsolutePath, this.workspacePath)
    return generationForFile(meta, relativeFilePath, fileHash)
  }

  private async updateFileGraph(filePath: string, content: string, fileHash: string): Promise<void> {
    if (!this.graph) return
    if (!isCodeGraphSupportedPath(filePath)) return

    try {
      const existing = await this.graph.getFileGraph(filePath)
      if (existing?.fileHash === fileHash) {
        await this.graph.upsertFileGraph(filePath, fileHash, existing)
        await this.updateFilePostings(filePath, fileHash, existing, content)
        return
      }
      const normalizedAbsolutePath = generateNormalizedAbsolutePath(filePath, this.workspacePath)
      const relativeFilePath = generateRelativeFilePath(normalizedAbsolutePath, this.workspacePath)
      const graph = parseCodeGraphFile({
        workspacePath: this.workspacePath,
        filePath: relativeFilePath,
        content,
        fileHash,
      })
      await this.graph.upsertFileGraph(filePath, fileHash, graph)
      await this.updateFilePostings(filePath, fileHash, graph, content)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn("code graph file update failed", {
        filePath,
        error: sanitizeErrorMessage(msg),
      })
      this.emitError("file-watcher:updateFileGraph", err, undefined, filePath)
      try {
        await this.graph.markFileGraphStatus(filePath, "parse_error", {
          fileHash,
          error: sanitizeErrorMessage(msg),
        })
        await this.postings?.markFilePostingsStatus(filePath, "parse_error", {
          fileHash,
          error: sanitizeErrorMessage(msg),
        })
      } catch (mark) {
        log.warn("code graph parse_error marker failed", {
          filePath,
          error: sanitizeErrorMessage(mark instanceof Error ? mark.message : String(mark)),
        })
        this.emitError("file-watcher:markFileGraphStatus", mark, undefined, filePath)
      }
    }
  }

  private async removeFileGraph(filePath: string): Promise<void> {
    if (!this.graph) return
    try {
      await this.graph.removeFileGraph(filePath)
      await this.postings?.removeFilePostings(filePath)
    } catch (err) {
      log.warn("code graph file removal failed", {
        filePath,
        error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
      })
      this.emitError("file-watcher:removeFileGraph", err, undefined, filePath)
    }
  }

  private async updateFilePostings(
    filePath: string,
    fileHash: string,
    graph: CodeGraphFileGraph,
    content: string,
  ): Promise<void> {
    if (!this.postings) return
    try {
      await this.postings.upsertFilePostings(filePath, fileHash, graph, { content })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn("code postings file update failed", {
        filePath,
        error: sanitizeErrorMessage(msg),
      })
      this.emitError("file-watcher:updateFilePostings", err, undefined, filePath)
      try {
        await this.postings.markFilePostingsStatus(filePath, "postings_error", {
          fileHash,
          error: sanitizeErrorMessage(msg),
        })
      } catch (mark) {
        log.warn("code postings error marker failed", {
          filePath,
          error: sanitizeErrorMessage(mark instanceof Error ? mark.message : String(mark)),
        })
        this.emitError("file-watcher:markFilePostingsStatus", mark, undefined, filePath)
      }
    }
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function settlesWithin(task: Promise<void>, timeout: number): Promise<boolean> {
  if (timeout <= 0) return false

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeout)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
