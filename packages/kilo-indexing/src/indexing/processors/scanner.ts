import { stat, readFile, realpath } from "fs/promises"
import path from "path"
import { generateNormalizedAbsolutePath, generateRelativeFilePath } from "../shared/get-relative-path"
import type {
  CodeBlock,
  ICodeParser,
  IEmbedder,
  IVectorStore,
  IDirectoryScanner,
  ICacheManager,
  ScanProgressEvent,
  IndexingScanTarget,
} from "../interfaces"
import { createHash } from "crypto"
import pLimit, { type LimitFunction } from "p-limit"
import { Mutex } from "async-mutex"
import { CacheManager } from "../cache-manager"
import {
  MAX_FILE_SIZE_BYTES,
  BATCH_SEGMENT_THRESHOLD,
  MAX_BATCH_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  PARSING_CONCURRENCY,
  BATCH_PROCESSING_CONCURRENCY,
} from "../constants"
import { FileIgnore } from "../../file/ignore"
import { Log } from "../../util/log"
import { sanitizeErrorMessage } from "../shared/validation-helpers"
import type { IndexingTelemetryMeta, IndexingTelemetryMode, IndexingTelemetryReporter } from "../interfaces/telemetry"
import type { CodeGraphFileGraph, ICodeGraphStorage, ICodePostingsStorage } from "../codegraph"
import { emptyCleanupStats } from "../cleanup"
import type { IndexingCleanupStats, IndexingCleanupSummary, IndexingCompatibilityDecision } from "../interfaces/cleanup"
import { isCodeGraphSupportedPath } from "../codegraph/parser"
import { CodeGraphParserWorkerPool } from "../codegraph/parser/worker-pool"
import type { RagCheckpointMeta } from "../rag-checkpoint"
import { fallbackCheckpointMeta, generationForFile, pointForBlock, vectorContext } from "../rag-checkpoint"
import { discoverScanFiles, type DiscoveryResult } from "./discovery"
import { constrained, type IndexingPressure } from "../memory"
import type { IgnoreMatcher } from "../shared/load-ignore"
import { isBinary } from "../shared/is-binary"
import { scannerExtensions } from "../shared/supported-extensions"

const log = Log.create({ service: "indexing-scanner" })
const CODE_GRAPH_WORKER_CONCURRENCY = 2
const CODE_GRAPH_WORKER_MAX = 16
const GENERATION_FINALIZE_BATCH_SIZE = 64

type CodeGraphScanMetrics = {
  files: number
  reused: number
  parsed: number
  workerParsed: number
  fallbackParsed: number
  readHashMs: number
  lookupMs: number
  parseMs: number
  graphWriteMs: number
  postingsMs: number
}

type CodeGraphUpdateMetrics = {
  reused: boolean
  worker: boolean
  lookupMs: number
  parseMs: number
  graphWriteMs: number
  postingsMs: number
}

type LocalStorageLifecycle = {
  cleanupAbandonedArtifacts?: () => Promise<IndexingCleanupStats>
  ensureCompatible?: () => Promise<IndexingCompatibilityDecision>
}

type FileGeneration = {
  filePath: string
  generation: string
  runId: string
}

type GenerationFinalizer = {
  finalizeFileGenerations?: (files: readonly FileGeneration[]) => Promise<void>
}

export class DirectoryScanner implements IDirectoryScanner {
  private _cancelled = false
  private batchSegmentThreshold: number
  private maxBatchRetries: number
  private runId: string = globalThis.crypto.randomUUID()
  private ragMeta: RagCheckpointMeta | undefined
  private readonly writeCache: boolean
  private readonly graphPool = new CodeGraphParserWorkerPool()
  private pressure: IndexingPressure = "normal"
  private readonly limiters = new Set<{ limit: LimitFunction; kind: "parse" | "batch" }>()
  private readonly extensions: ReadonlySet<string>

  constructor(
    private readonly embedder: IEmbedder | undefined,
    private readonly vectorStore: IVectorStore | undefined,
    private readonly codeParser: ICodeParser,
    private readonly cacheManager: CacheManager,
    private readonly ignoreInstance: IgnoreMatcher,
    batchSegmentThreshold?: number,
    maxBatchRetries?: number,
    private readonly onTelemetry?: IndexingTelemetryReporter,
    private readonly telemetryMeta?: IndexingTelemetryMeta,
    private readonly graph?: ICodeGraphStorage,
    private readonly postings?: ICodePostingsStorage,
    opts: { writeCache?: boolean } = {},
    extensions: readonly string[] = scannerExtensions,
  ) {
    this.batchSegmentThreshold = batchSegmentThreshold ?? BATCH_SEGMENT_THRESHOLD
    this.maxBatchRetries = maxBatchRetries ?? MAX_BATCH_RETRIES
    this.writeCache = opts.writeCache ?? true
    this.extensions = new Set(extensions)
  }

  private checkpointCache(): Promise<void> {
    const cache: ICacheManager = this.cacheManager
    if (cache.checkpoint) return cache.checkpoint()
    if (cache.flush) return cache.flush()
    return Promise.resolve()
  }

  private flushCache(): Promise<void> {
    const cache: ICacheManager = this.cacheManager
    if (cache.flush) return cache.flush()
    if (cache.checkpoint) return cache.checkpoint()
    return Promise.resolve()
  }

  private emitFileCount(mode: IndexingTelemetryMode, discovered: number, candidate: number): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "file_count",
      source: "scan",
      mode,
      discovered,
      candidate,
    })
  }

  private emitRetry(mode: IndexingTelemetryMode, attempt: number, batchSize: number, err: unknown): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "batch_retry",
      source: "scan",
      mode,
      attempt,
      maxRetries: this.maxBatchRetries,
      batchSize,
      error: sanitizeErrorMessage(msg),
    })
  }

  private emitError(
    mode: IndexingTelemetryMode,
    location: string,
    err: unknown,
    retryCount?: number,
    file?: string,
  ): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "error",
      source: "scan",
      mode,
      location,
      error: sanitizeErrorMessage(msg),
      file,
      retryCount,
      maxRetries: this.maxBatchRetries,
    })
  }

  /**
   * Request cooperative cancellation of any in-flight scanning work.
   * The scanDirectory and batch operations periodically check this flag
   * and will exit as soon as practical.
   */
  public cancel(): void {
    this._cancelled = true
    this.graphPool.dispose()
  }

  public disposeGraphWorkers(): void {
    this.graphPool.dispose()
  }

  public get isCancelled(): boolean {
    return this._cancelled
  }

  public setRunContext(runId: string, meta: RagCheckpointMeta): void {
    this.runId = runId
    this.ragMeta = meta
  }

  public async cleanupAbandonedArtifacts(
    input: { local?: boolean; vector?: boolean } = {},
  ): Promise<IndexingCleanupSummary> {
    const local = input.local !== false
    const graph = this.graph as (ICodeGraphStorage & LocalStorageLifecycle) | undefined
    const postings = this.postings as (ICodePostingsStorage & LocalStorageLifecycle) | undefined
    const codeGraph =
      local && graph?.cleanupAbandonedArtifacts ? await graph.cleanupAbandonedArtifacts() : emptyCleanupStats()
    const sidecar =
      local && postings?.cleanupAbandonedArtifacts ? await postings.cleanupAbandonedArtifacts() : emptyCleanupStats()
    const vector = input.vector ? await this.vectorStore?.cleanupInactivePoints?.() : undefined
    return { codeGraph, postings: sidecar, vector }
  }

  public async ensureCompatible(): Promise<{
    codeGraph?: IndexingCompatibilityDecision
    postings?: IndexingCompatibilityDecision
  }> {
    const graph = this.graph as (ICodeGraphStorage & LocalStorageLifecycle) | undefined
    const sidecar = this.postings as (ICodePostingsStorage & LocalStorageLifecycle) | undefined
    const codeGraph = graph?.ensureCompatible ? await graph.ensureCompatible() : undefined
    const postings = sidecar?.ensureCompatible ? await sidecar.ensureCompatible() : undefined
    return { codeGraph, postings }
  }

  /**
   * Updates the batch segment threshold
   * @param newThreshold New batch segment threshold value
   */
  public updateBatchSegmentThreshold(newThreshold: number): void {
    this.batchSegmentThreshold = newThreshold
  }

  public setMemoryPressure(pressure: IndexingPressure): void {
    this.pressure = pressure
    for (const item of this.limiters) {
      item.limit.concurrency = item.kind === "parse" ? this.parseConcurrency("all") : this.batchConcurrency()
    }
    if (constrained(pressure)) this.graphPool.dispose()
  }

  private parseConcurrency(target: IndexingScanTarget): number {
    if (constrained(this.pressure)) return 1
    const value = target === "codeGraph" ? codeGraphWorkerConcurrency() : PARSING_CONCURRENCY
    return Math.max(1, Math.min(4, value))
  }

  private batchConcurrency(): number {
    return constrained(this.pressure) ? 1 : Math.max(1, Math.min(2, BATCH_PROCESSING_CONCURRENCY))
  }

  private pendingBatches(): number {
    return constrained(this.pressure) ? 1 : 2
  }

  private segmentThreshold(): number {
    return Math.max(1, Math.min(this.batchSegmentThreshold, constrained(this.pressure) ? 16 : 60))
  }

  private windowSize(target: IndexingScanTarget): number {
    return constrained(this.pressure) ? 1 : this.parseConcurrency(target) * 2
  }

  private graphWorkers(): number {
    return constrained(this.pressure) ? 0 : codeGraphWorkerConcurrency()
  }

  public async discoverCandidateFiles(directory: string, target: IndexingScanTarget): Promise<DiscoveryResult> {
    return discoverScanFiles({
      directoryPath: directory,
      workspacePath: directory,
      target,
      ignoreInstance: this.ignoreInstance,
      extensions: this.extensions,
    })
  }

  /**
   * Recursively scans a directory for code blocks in supported files.
   * @param directoryPath The directory to scan
   * @param onError Optional error handler callback
   * @param onBlocksIndexed Optional callback when blocks are indexed
   * @param onFileParsed Optional callback when a file is parsed
   * @returns Promise with processing stats and total block count
   */
  public async scanDirectory(
    directory: string,
    onError?: (error: Error) => void,
    onFilesIndexed?: (indexedCount: number) => void,
    onFileParsed?: () => void,
    mode: IndexingTelemetryMode = "full",
    onProgress?: (event: ScanProgressEvent) => void,
    target: IndexingScanTarget = "all",
  ): Promise<{
    stats: { processed: number; skipped: number }
    totalBlockCount: number
    candidateFiles: string[]
    scanStartedAt: number
    target: IndexingScanTarget
  }> {
    // reset cooperative cancel flag on new full scan
    this._cancelled = false
    const graphEnabled = target !== "rag"
    const ragEnabled = target !== "codeGraph" && !!this.embedder && !!this.vectorStore
    const started = Date.now()
    const graphMetrics: CodeGraphScanMetrics = {
      files: 0,
      reused: 0,
      parsed: 0,
      workerParsed: 0,
      fallbackParsed: 0,
      readHashMs: 0,
      lookupMs: 0,
      parseMs: 0,
      graphWriteMs: 0,
      postingsMs: 0,
    }

    const directoryPath = directory
    // Use the directory path directly as the workspace root
    const scanWorkspace = directoryPath
    const boundary = await realpath(scanWorkspace).catch(() => path.resolve(scanWorkspace))
    log.info("starting directory scan", { workspacePath: scanWorkspace, target })
    if (graphEnabled) {
      const health = await this.graphPool.health(this.graphWorkers())
      log.warn("code graph parser worker health", {
        visible: true,
        workspacePath: scanWorkspace,
        healthy: health.healthy,
        workers: health.workers,
        path: health.path,
        mode: health.mode,
        error: health.error ? sanitizeErrorMessage(health.error) : undefined,
      })
      await this.beginGraphScan()
    }

    const discovery = await this.discoverCandidateFiles(directoryPath, target)
    const supportedPaths = discovery.paths
    log.info("discovered candidate files for indexing", {
      visible: true,
      workspacePath: scanWorkspace,
      target,
      discoveryEngine: discovery.engine,
      discoveryMs: discovery.discoveryMs,
      discoveredFiles: discovery.rawFiles,
      supportedFiles: supportedPaths.length,
      patterns: discovery.patterns,
      fallbackReason: discovery.fallbackReason,
      ignoredRoots: FileIgnore.FOLDERS,
    })
    this.emitFileCount(mode, discovery.rawFiles, supportedPaths.length)
    onProgress?.({
      type: "target",
      totalFiles: supportedPaths.length,
      graphTotalFiles: graphEnabled
        ? supportedPaths.filter((filePath) => isCodeGraphSupportedPath(filePath)).length
        : 0,
    })

    // Initialize tracking variables
    const processedFiles = new Set<string>()
    let processedCount = 0
    let skippedCount = 0

    // Initialize parallel processing tools
    const parseLimiter = pLimit(this.parseConcurrency(target))
    const batchLimiter = pLimit(this.batchConcurrency())
    this.limiters.clear()
    this.limiters.add({ limit: parseLimiter, kind: "parse" })
    this.limiters.add({ limit: batchLimiter, kind: "batch" })
    const mutex = new Mutex()

    // Shared batch accumulators (protected by mutex)
    let currentBatchBlocks: CodeBlock[] = []
    let currentBatchTexts: string[] = []
    let currentBatchFileInfos: { filePath: string; fileHash: string; isNew: boolean }[] = []
    let failed = false
    const activeBatchPromises = new Set<Promise<void>>()
    let pendingBatchCount = 0
    let batchFailure: Error | undefined
    const buffered = new Set<string>()
    const jobs = new Map<
      string,
      {
        filePath: string
        fileHash: string
        generation: string
        pending: number
        parsed: boolean
        failed: boolean
        finalizing: boolean
        completed: boolean
      }
    >()

    // Initialize block counter
    let totalBlockCount = 0

    const ctx = () => {
      return vectorContext(scanWorkspace, this.runId, this.ragMeta ?? fallbackCheckpointMeta(scanWorkspace))
    }

    const trackGraph = (item: CodeGraphUpdateMetrics | undefined) => {
      if (!item) return
      graphMetrics.files += 1
      graphMetrics.lookupMs += item.lookupMs
      graphMetrics.parseMs += item.parseMs
      graphMetrics.graphWriteMs += item.graphWriteMs
      graphMetrics.postingsMs += item.postingsMs
      if (item.reused) {
        graphMetrics.reused += 1
        return
      }
      graphMetrics.parsed += 1
      if (item.worker) graphMetrics.workerParsed += 1
      else graphMetrics.fallbackParsed += 1
    }

    const fileGeneration = (filePath: string, fileHash: string): string => {
      const meta = this.ragMeta ?? fallbackCheckpointMeta(scanWorkspace)
      const normalizedAbsolutePath = generateNormalizedAbsolutePath(filePath, scanWorkspace)
      const relativeFilePath = generateRelativeFilePath(normalizedAbsolutePath, scanWorkspace)
      return generationForFile(meta, relativeFilePath, fileHash)
    }

    const ensureJob = (filePath: string, fileHash: string) => {
      const existing = jobs.get(filePath)
      if (existing) return existing
      const job = {
        filePath,
        fileHash,
        generation: fileGeneration(filePath, fileHash),
        pending: 0,
        parsed: false,
        failed: false,
        finalizing: false,
        completed: false,
      }
      jobs.set(filePath, job)
      return job
    }

    const readyJobs = () =>
      [...jobs.values()].filter(
        (job) =>
          job.parsed &&
          job.pending === 0 &&
          !job.failed &&
          !job.finalizing &&
          !job.completed &&
          !buffered.has(job.filePath),
      )

    const completeReadyJobs = async () => {
      const ready = readyJobs()
      for (const job of ready) job.finalizing = true

      for (let index = 0; index < ready.length; index += GENERATION_FINALIZE_BATCH_SIZE) {
        const group = ready.slice(index, index + GENERATION_FINALIZE_BATCH_SIZE)
        const store = this.vectorStore
        if (!store) throw new Error("Vector store is unavailable while finalizing file generations")

        try {
          const finalizer = store as IVectorStore & GenerationFinalizer
          if (finalizer.finalizeFileGenerations) {
            await finalizer.finalizeFileGenerations(
              group.map((job) => ({
                filePath: job.filePath,
                generation: job.generation,
                runId: this.runId,
              })),
            )
          } else {
            if (!store.activateFileGeneration || !store.deleteInactiveFilePoints) {
              throw new Error("Vector store does not support active generation checkpoints")
            }
            for (const job of group) {
              await store.activateFileGeneration(job.filePath, job.generation, this.runId)
              await store.deleteInactiveFilePoints(job.filePath, job.generation)
            }
          }

          if (this.writeCache) {
            for (const job of group) this.cacheManager.updateHash(job.filePath, job.fileHash)
            await this.checkpointCache()
          }
          for (const job of group) {
            job.completed = true
            jobs.delete(job.filePath)
            onProgress?.({ type: "file", filePath: job.filePath })
          }
          onFilesIndexed?.(group.length)
        } catch (error) {
          for (const job of group) {
            job.finalizing = false
            job.failed = true
          }
          throw error
        }
      }
    }

    const batchFiles = (blocks: CodeBlock[]) => {
      const files = new Map<string, string>()
      for (const block of blocks) files.set(block.file_path, block.fileHash)
      return files
    }

    const queueBatch = async (
      batchBlocks: CodeBlock[],
      batchTexts: string[],
      batchFileInfos: { filePath: string; fileHash: string; isNew: boolean }[],
    ): Promise<void> => {
      const files = batchFiles(batchBlocks)
      for (const [filePath, fileHash] of files) {
        const job = ensureJob(filePath, fileHash)
        job.pending += 1
        buffered.delete(filePath)
      }

      while (!this._cancelled) {
        const release = await mutex.acquire()
        let wait: Promise<void> | null = null

        try {
          if (pendingBatchCount < this.pendingBatches()) {
            pendingBatchCount++

            const batchPromise = batchLimiter(async () => {
              try {
                const ok = await this.processBatch(
                  batchBlocks,
                  batchTexts,
                  batchFileInfos,
                  scanWorkspace,
                  mode,
                  onError,
                  () => {
                    failed = true
                  },
                  ctx(),
                )
                for (const [filePath] of files) {
                  const job = jobs.get(filePath)
                  if (!job) continue
                  job.pending = Math.max(0, job.pending - 1)
                  if (!ok) job.failed = true
                }
                await completeReadyJobs()
              } catch (err) {
                failed = true
                batchFailure = err instanceof Error ? err : new Error(String(err))
                for (const [filePath] of files) {
                  const job = jobs.get(filePath)
                  if (!job) continue
                  job.pending = Math.max(0, job.pending - 1)
                  job.failed = true
                }
              }
            })
            activeBatchPromises.add(batchPromise)

            // Clean up completed promises to prevent memory accumulation
            batchPromise.finally(() => {
              activeBatchPromises.delete(batchPromise)
              pendingBatchCount--
            })

            return
          }

          wait = activeBatchPromises.size > 0 ? Promise.race(activeBatchPromises) : Promise.resolve()
        } finally {
          release()
        }

        await wait
      }
    }

    const parseFile = (filePath: string) =>
      parseLimiter(async () => {
        // Early exit if cancellation requested
        if (this._cancelled) {
          return
        }

        const graphSupported = graphEnabled && isCodeGraphSupportedPath(filePath)
        let deferred = false
        let graphed = false
        const reportGraph = () => {
          if (!graphSupported || graphed) return
          graphed = true
          onProgress?.({ type: "graph", filePath })
        }

        try {
          const readStarted = graphSupported ? Date.now() : 0
          const canonical = await realpath(filePath)
          const relative = path.relative(boundary, canonical)
          if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            skippedCount++
            log.warn("skipping indexing candidate outside workspace boundary", {
              workspacePath: scanWorkspace,
              filePath,
            })
            return
          }
          // Check file size
          const stats = await stat(filePath)
          if (this._cancelled) {
            return
          }

          if (stats.size > MAX_FILE_SIZE_BYTES) {
            skippedCount++ // Skip large files
            return
          }

          // Read file content using fs/promises
          const bytes = await readFile(filePath)
          if (isBinary(bytes)) {
            skippedCount++
            return
          }
          const content = bytes.toString("utf-8")

          if (this._cancelled) {
            return
          }

          // Calculate current hash
          const currentFileHash = createHash("sha256").update(content).digest("hex")
          if (graphSupported) graphMetrics.readHashMs += Date.now() - readStarted
          processedFiles.add(filePath)

          // Check against cache
          const cachedFileHash = this.cacheManager.getHash(filePath)
          const isNewFile = !cachedFileHash
          if (cachedFileHash === currentFileHash) {
            // File is unchanged
            if (graphEnabled) {
              trackGraph(await this.updateFileGraph(scanWorkspace, filePath, content, currentFileHash, mode))
            }
            reportGraph()
            skippedCount++
            return
          }

          if (graphEnabled) {
            trackGraph(await this.updateFileGraph(scanWorkspace, filePath, content, currentFileHash, mode))
          }
          reportGraph()

          if (!ragEnabled) {
            processedCount++
            onFileParsed?.()
            if (target === "all" && this.writeCache) {
              this.cacheManager.updateHash(filePath, currentFileHash)
              await this.checkpointCache()
            }
            return
          }

          // File is new or changed - parse it using the injected parser function
          const blocks = await this.codeParser.parseFile(filePath, { content, fileHash: currentFileHash })

          if (this._cancelled) {
            return
          }

          const fileBlockCount = blocks.length
          onFileParsed?.()
          processedCount++

          // Process embeddings if configured
          if (ragEnabled && blocks.length > 0) {
            // Add to batch accumulators
            let addedBlocksFromFile = false
            let queued = false
            const info = {
              filePath,
              fileHash: currentFileHash,
              isNew: true,
            }
            for (const block of blocks) {
              if (this._cancelled) break
              const trimmedContent = block.content.trim()
              if (trimmedContent) {
                const nextBatch = await (async () => {
                  const release = await mutex.acquire()
                  try {
                    if (this._cancelled) {
                      // Abort adding more items if cancelled
                      return null
                    }

                    currentBatchBlocks.push(block)
                    currentBatchTexts.push(trimmedContent)
                    addedBlocksFromFile = true
                    deferred = true
                    buffered.add(filePath)

                    // Check if batch threshold is met
                    if (currentBatchBlocks.length < this.segmentThreshold()) {
                      return null
                    }

                    // Copy current batch data and clear accumulators
                    const batchBlocks = [...currentBatchBlocks]
                    const batchTexts = [...currentBatchTexts]
                    // RATIONALE: Include the current file metadata before the flush snapshot
                    // so threshold-triggered batches still run delete updates for this file.
                    const batchFileInfos = queued ? [...currentBatchFileInfos] : [...currentBatchFileInfos, info]
                    queued = true
                    currentBatchBlocks = []
                    currentBatchTexts = []
                    currentBatchFileInfos = []

                    return {
                      batchBlocks,
                      batchTexts,
                      batchFileInfos,
                    }
                  } finally {
                    release()
                  }
                })()

                if (!nextBatch) {
                  continue
                }

                await queueBatch(nextBatch.batchBlocks, nextBatch.batchTexts, nextBatch.batchFileInfos)
              }
            }

            // Add file info once per file (outside the block loop)
            if (addedBlocksFromFile) {
              const release = await mutex.acquire()
              try {
                totalBlockCount += fileBlockCount
                const job = ensureJob(filePath, currentFileHash)
                job.parsed = true
                if (!queued) {
                  currentBatchFileInfos.push(info)
                  queued = true
                }
              } finally {
                release()
              }
            }
          } else {
            // Only update hash if not being processed in a batch
            if (this.writeCache) {
              this.cacheManager.updateHash(filePath, currentFileHash)
              await this.checkpointCache()
            }
          }
        } catch (error) {
          log.error(`Error processing file ${filePath} in workspace ${scanWorkspace}`, {
            error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
            stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
            location: "scanDirectory:processFile",
          })
          if (onError) {
            onError(
              error instanceof Error
                ? new Error(`${error.message} (Workspace: ${scanWorkspace}, File: ${filePath})`)
                : new Error(`Unknown error processing file ${filePath} (Workspace: ${scanWorkspace})`),
            )
          }
        } finally {
          if (!this._cancelled) {
            reportGraph()
            if (!deferred) {
              onProgress?.({ type: "file", filePath })
            }
          }
        }
      })

    for (let index = 0; index < supportedPaths.length; index += this.windowSize(target)) {
      const window = supportedPaths.slice(index, index + this.windowSize(target))
      await Promise.all(window.map(parseFile))
      await Promise.resolve()
    }
    log.info("finished parsing scan candidates", {
      workspacePath: scanWorkspace,
      processedCount,
      skippedCount,
      pendingBatches: pendingBatchCount,
      cancelled: this._cancelled,
      target,
    })

    // Process any remaining items in batch
    const finalBatch = await (async () => {
      const release = await mutex.acquire()
      try {
        if (this._cancelled || currentBatchBlocks.length === 0) {
          return null
        }

        // Copy current batch data and clear accumulators
        const batchBlocks = [...currentBatchBlocks]
        const batchTexts = [...currentBatchTexts]
        const batchFileInfos = [...currentBatchFileInfos]
        currentBatchBlocks = []
        currentBatchTexts = []
        currentBatchFileInfos = []

        return {
          batchBlocks,
          batchTexts,
          batchFileInfos,
        }
      } finally {
        release()
      }
    })()

    if (finalBatch) {
      await queueBatch(finalBatch.batchBlocks, finalBatch.batchTexts, finalBatch.batchFileInfos)
    }

    // Short-circuit if cancelled before handling deletions
    if (this._cancelled) {
      this.limiters.clear()
      log.info("directory scan cancelled", {
        workspacePath: scanWorkspace,
        processedCount,
        skippedCount,
        totalBlockCount,
      })
      return {
        stats: {
          processed: processedCount,
          skipped: skippedCount,
        },
        totalBlockCount,
        candidateFiles: supportedPaths,
        scanStartedAt: started,
        target,
      }
    } else {
      await Promise.all(activeBatchPromises)
    }

    if (batchFailure) throw batchFailure

    await completeReadyJobs()

    const incomplete = [...jobs.values()].filter((job) => !job.completed)
    if (failed && incomplete.length > 0) {
      log.warn("skipping cache hash updates for incomplete vector files", {
        workspacePath: scanWorkspace,
        affectedFiles: incomplete.length,
      })
    }

    // Handle deleted files
    const oldHashes = this.cacheManager.getAllHashes()
    for (const cachedFilePath of Object.keys(oldHashes)) {
      if (!processedFiles.has(cachedFilePath)) {
        // File was deleted or is no longer supported/indexed
        if (graphEnabled) await this.removeFileGraph(cachedFilePath)
        if (ragEnabled && this.vectorStore) {
          try {
            await this.vectorStore.deletePointsByFilePath(cachedFilePath)
            if (this.writeCache) {
              this.cacheManager.deleteHash(cachedFilePath)
              await this.checkpointCache()
            }
          } catch (error: any) {
            const errorStatus = error?.status || error?.response?.status || error?.statusCode
            const errorMessage = error instanceof Error ? error.message : String(error)

            log.error(`Failed to delete points for ${cachedFilePath} in workspace ${scanWorkspace}`, {
              error: sanitizeErrorMessage(errorMessage),
              stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
              location: "scanDirectory:deleteRemovedFiles",
              errorStatus,
            })

            if (onError) {
              // Report error to error handler
              onError(
                error instanceof Error
                  ? new Error(`${error.message} (Workspace: ${scanWorkspace}, File: ${cachedFilePath})`)
                  : new Error(`Unknown error deleting points for ${cachedFilePath} (Workspace: ${scanWorkspace})`),
              )
            }
          }
        }
      }
    }

    if (this.writeCache) await this.flushCache()

    if (graphEnabled) {
      await this.finishGraphScan()
      this.logGraphMetrics(scanWorkspace, target, Date.now() - started, graphMetrics)
    }

    log.info("directory scan complete", {
      workspacePath: scanWorkspace,
      processedCount,
      skippedCount,
      totalBlockCount,
      target,
    })

    this.limiters.clear()
    return {
      stats: {
        processed: processedCount,
        skipped: skippedCount,
      },
      totalBlockCount,
      candidateFiles: supportedPaths,
      scanStartedAt: started,
      target,
    }
  }

  private async beginGraphScan(): Promise<void> {
    if (!this.graph) return
    await this.graph.beginFullScan()
    await this.postings?.beginFullScan()
  }

  private async finishGraphScan(): Promise<void> {
    if (!this.graph) return
    await this.graph.markFullScanComplete()
    await this.postings?.markFullScanComplete()
  }

  private async updateFileGraph(
    workspace: string,
    filePath: string,
    content: string,
    fileHash: string,
    mode: IndexingTelemetryMode,
  ): Promise<CodeGraphUpdateMetrics | undefined> {
    if (!this.graph) return undefined
    if (!isCodeGraphSupportedPath(filePath)) return undefined

    try {
      const lookupStarted = Date.now()
      const existing = await this.graph.getFileGraph(filePath)
      const lookupMs = Date.now() - lookupStarted
      if (existing?.fileHash === fileHash) {
        const graphStarted = Date.now()
        await this.graph.upsertFileGraph(filePath, fileHash, existing)
        const graphWriteMs = Date.now() - graphStarted
        const postingsStarted = Date.now()
        await this.updateFilePostings(filePath, fileHash, existing, content, mode)
        return {
          reused: true,
          worker: false,
          lookupMs,
          parseMs: 0,
          graphWriteMs,
          postingsMs: Date.now() - postingsStarted,
        }
      }
      const normalizedAbsolutePath = generateNormalizedAbsolutePath(filePath, workspace)
      const relativeFilePath = generateRelativeFilePath(normalizedAbsolutePath, workspace)
      const input = {
        workspacePath: workspace,
        filePath: relativeFilePath,
        content,
        fileHash,
      }
      const parseStarted = Date.now()
      const parsed = await this.graphPool.parse(input, this.graphWorkers())
      const parseMs = Date.now() - parseStarted
      const reason = this.graphPool.takeFallbackReason()
      if (reason) {
        log.warn("code graph parser worker fallback active", { error: sanitizeErrorMessage(reason) })
      }
      const graphStarted = Date.now()
      const graph = parsed.graph
      await this.graph.upsertFileGraph(filePath, fileHash, graph)
      const graphWriteMs = Date.now() - graphStarted
      const postingsStarted = Date.now()
      await this.updateFilePostings(filePath, fileHash, graph, content, mode)
      return {
        reused: false,
        worker: parsed.worker,
        lookupMs,
        parseMs,
        graphWriteMs,
        postingsMs: Date.now() - postingsStarted,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn("code graph file update failed", {
        filePath,
        error: sanitizeErrorMessage(msg),
      })
      this.emitError(mode, "scanner:updateFileGraph", err, undefined, filePath)
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
        this.emitError(mode, "scanner:markFileGraphStatus", mark, undefined, filePath)
      }
      return undefined
    }
  }

  private logGraphMetrics(
    workspacePath: string,
    target: IndexingScanTarget,
    totalMs: number,
    metrics: CodeGraphScanMetrics,
  ): void {
    if (metrics.files === 0) return
    const filesPerSecond = Math.round((metrics.files / Math.max(1, totalMs)) * 1000 * 10) / 10
    log.warn("code graph scan performance summary", {
      workspacePath,
      target,
      totalMs,
      files: metrics.files,
      reused: metrics.reused,
      parsed: metrics.parsed,
      workerParsed: metrics.workerParsed,
      fallbackParsed: metrics.fallbackParsed,
      filesPerSecond,
      readHashMs: metrics.readHashMs,
      lookupMs: metrics.lookupMs,
      parseMs: metrics.parseMs,
      graphWriteMs: metrics.graphWriteMs,
      postingsMs: metrics.postingsMs,
    })
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
    }
  }

  private async updateFilePostings(
    filePath: string,
    fileHash: string,
    graph: CodeGraphFileGraph,
    content: string,
    mode: IndexingTelemetryMode,
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
      this.emitError(mode, "scanner:updateFilePostings", err, undefined, filePath)
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
        this.emitError(mode, "scanner:markFilePostingsStatus", mark, undefined, filePath)
      }
    }
  }

  private async processBatch(
    batchBlocks: CodeBlock[],
    batchTexts: string[],
    _batchFileInfos: { filePath: string; fileHash: string; isNew: boolean }[],
    scanWorkspace: string,
    mode: IndexingTelemetryMode,
    onError?: (error: Error) => void,
    onBatchFailed?: () => void,
    ctx?: ReturnType<typeof vectorContext>,
  ): Promise<boolean> {
    // Respect cooperative cancellation
    if (this._cancelled || batchBlocks.length === 0) return false
    if (!this.embedder || !this.vectorStore) return false

    if (batchBlocks.length === 0) {
      log.debug("Skipping empty batch processing")
      return false
    }

    if (!ctx) throw new Error("RAG vector context is not configured")
    const meta = this.ragMeta ?? fallbackCheckpointMeta(scanWorkspace)

    log.debug(`Starting to process batch of ${batchBlocks.length} blocks in workspace ${scanWorkspace}`)

    let attempts = 0
    let success = false
    let lastError: Error | null = null

    while (attempts < this.maxBatchRetries && !success) {
      attempts++

      if (this._cancelled) return false

      log.debug(`Processing batch attempt ${attempts}/${this.maxBatchRetries} for ${batchBlocks.length} blocks`)

      try {
        // Create embeddings for batch
        if (this._cancelled) return false

        log.debug(`Creating embeddings for ${batchTexts.length} texts`)

        const { embeddings } = await this.embedder.createEmbeddings(batchTexts, undefined, "document")
        log.debug(`Successfully created ${embeddings.length} embeddings`)

        // Prepare points for Qdrant
        log.debug("Preparing points for Qdrant upsert")
        const points = batchBlocks.map((block, index) => {
          const vector = embeddings[index]
          if (!vector) {
            throw new Error(`Missing embedding for block at index ${index}`)
          }

          const normalizedAbsolutePath = generateNormalizedAbsolutePath(block.file_path, scanWorkspace)
          const relativeFilePath = generateRelativeFilePath(normalizedAbsolutePath, scanWorkspace)
          const generation = generationForFile(meta, relativeFilePath, block.fileHash)
          return pointForBlock({ block, vector, workspace: scanWorkspace, ctx, generation })
        })
        log.debug(`Prepared ${points.length} points for Qdrant`)

        // Upsert points to Qdrant
        if (this._cancelled) return false

        log.debug("Starting Qdrant upsert")

        await this.vectorStore.upsertPoints(points)
        log.debug("Completed Qdrant upsert")
        success = true
        log.debug(`Successfully processed batch of ${batchBlocks.length} blocks after ${attempts} attempt(s)`)
      } catch (error) {
        lastError = error as Error
        log.error(`Error processing batch (attempt ${attempts}) in workspace ${scanWorkspace}`, {
          error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
          stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
          location: "processBatch:retry",
          attemptNumber: attempts,
          batchSize: batchBlocks.length,
        })

        if (attempts < this.maxBatchRetries) {
          this.emitRetry(mode, attempts, batchBlocks.length, error)
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempts - 1)
          log.debug(`Retrying batch in ${delay}ms`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    if (!success && lastError) {
      log.error(`Failed to process batch after ${this.maxBatchRetries} attempts`)
      this.emitError(mode, "scanner:processBatch", lastError, this.maxBatchRetries)
      onBatchFailed?.()
      if (onError) {
        // Preserve the original error message from embedders which now have detailed messages
        const errorMessage = lastError.message || "Unknown error"

        onError(new Error(`Failed to process batch after ${this.maxBatchRetries} retries: ${errorMessage}`))
      }
    }
    return success
  }
}

function codeGraphWorkerConcurrency(): number {
  const raw = globalThis.process?.env?.KILO_CODEGRAPH_WORKER_CONCURRENCY
  const value = raw ? Number(raw) : CODE_GRAPH_WORKER_CONCURRENCY
  if (!Number.isFinite(value)) return CODE_GRAPH_WORKER_CONCURRENCY
  return Math.max(1, Math.min(CODE_GRAPH_WORKER_MAX, Math.floor(value)))
}
