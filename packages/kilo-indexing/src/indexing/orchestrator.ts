import { stat } from "fs/promises"
import { createHash } from "crypto"
import path from "path"
import type { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager, type IndexingState } from "./state-manager"
import type { IFileWatcher, BatchProcessingSummary, ScanProgressEvent, WatcherSyntheticEvent } from "./interfaces"
import type {
  IndexingTelemetryEvent,
  IndexingTelemetryMeta,
  IndexingTelemetryMode,
  IndexingTelemetryPipeline,
  IndexingTelemetryReporter,
  IndexingTelemetrySource,
  IndexingTelemetryTrigger,
} from "./interfaces/telemetry"
import type { IVectorStore } from "./interfaces/vector-store"
import { DirectoryScanner } from "./processors"
import type { CacheManager } from "./cache-manager"
import type { Disposable } from "./runtime"
import { Log } from "../util/log"
import { sanitizeErrorMessage } from "./shared/validation-helpers"
import type { RagCheckpointMeta } from "./rag-checkpoint"
import { IndexingRunLock } from "./run-lock"
import type { IndexingCleanupSummary } from "./interfaces/cleanup"
import type { IndexingPressure } from "./memory"
import { DEFAULT_VECTOR_STORE } from "./constants"
import type { WorktreeOverlay } from "./worktree-overlay"

const log = Log.create({ service: "indexing-orchestrator" })
const LOCKED_MESSAGE = "Another indexing run is already active for this workspace."
const SYNTHETIC_EVENT_LIMIT = 1000
const LANCEDB_SCHEMA_MISMATCH_NOTICE =
  "检测到当前工作区的本地 RAG 索引格式来自旧版本，ChipMate 正在自动重建；CodeGraph 数据会保留。"
type ScanTarget = "all" | "codeGraph" | "rag"
type ScanSummary = {
  filesDiscovered: number
  filesIndexed: number
  totalBlocks: number
  batchErrors: number
  candidateFiles: string[]
  scanStartedAt: number
  target: ScanTarget
}

export class CodeIndexOrchestrator {
  private _fileWatcherSubscriptions: Disposable[] = []
  private _isProcessing = false
  private _cancelRequested = false
  private _lock: IndexingRunLock | undefined
  private _watcherStart: Promise<void> | undefined
  private _watcherReady = false
  private _watcherCollecting = false
  private _watcherFailed = false
  private _watcherToken = 0
  private _followUpScanRequested = false
  private _followUpScanScheduled = false
  private _active?: Promise<void>

  constructor(
    private readonly configManager: CodeIndexConfigManager,
    private readonly stateManager: CodeIndexStateManager,
    private readonly workspacePath: string,
    private readonly cacheManager: CacheManager,
    private readonly vectorStore: IVectorStore | undefined,
    private readonly scanner: DirectoryScanner,
    private readonly fileWatcher: IFileWatcher,
    private readonly cacheDirectory: string,
    private readonly ragMeta: RagCheckpointMeta,
    private readonly onTelemetry?: IndexingTelemetryReporter,
    private readonly overlay?: WorktreeOverlay,
  ) {}

  private getTelemetryMeta(): IndexingTelemetryMeta {
    const cfg = this.configManager.getConfig()
    return {
      provider: cfg.embedderProvider,
      vectorStore: cfg.vectorStoreProvider ?? DEFAULT_VECTOR_STORE,
      modelId: cfg.modelId,
    }
  }

  private emitTelemetry(event: IndexingTelemetryEvent): void {
    this.onTelemetry?.(event)
  }

  private emitError(
    location: string,
    err: unknown,
    source: IndexingTelemetrySource,
    trigger?: IndexingTelemetryTrigger,
    mode?: IndexingTelemetryMode,
    pipeline?: IndexingTelemetryPipeline,
  ): void {
    const msg = err instanceof Error ? err.message : String(err)
    this.emitTelemetry({
      ...this.getTelemetryMeta(),
      type: "error",
      source,
      location,
      trigger,
      mode,
      pipeline,
      error: sanitizeErrorMessage(msg),
      file: extractErrorFile(msg),
    })
  }

  public updateBatchSegmentThreshold(newThreshold: number): void {
    this.scanner.updateBatchSegmentThreshold(newThreshold)
    this.fileWatcher.updateBatchSegmentThreshold(newThreshold)
  }

  public setMemoryPressure(pressure: IndexingPressure): void {
    this.scanner.setMemoryPressure(pressure)
    this.fileWatcher.setMemoryPressure?.(pressure)
  }

  private installWatcherSubscriptions(): void {
    if (this._fileWatcherSubscriptions.length > 0) return

    this._fileWatcherSubscriptions = [
      this.fileWatcher.onDidStartBatchProcessing.on((paths) => {
        log.info("file watcher batch started", {
          workspacePath: this.workspacePath,
          filesInBatch: paths.length,
        })
        if (this.stateManager.state !== "Indexing") {
          this.stateManager.setSystemState("Indexing", "Processing file changes...")
        }
      }),
      this.fileWatcher.onBatchProgressUpdate.on(({ processedInBatch, totalInBatch, currentFile }) => {
        this.stateManager.reportFileQueueProgress(
          processedInBatch,
          totalInBatch,
          currentFile ? path.basename(currentFile) : undefined,
        )
        if (processedInBatch === totalInBatch) {
          log.info("file watcher batch completed", {
            workspacePath: this.workspacePath,
            totalInBatch,
          })
          if (this.stateManager.state === "Error") return
          if (totalInBatch > 0) {
            this.stateManager.setSystemState("Indexed", "File changes processed. Index up-to-date.")
          } else if (this.stateManager.state === "Indexing") {
            this.stateManager.setSystemState("Indexed", "Index up-to-date. File queue empty.")
          }
        }
      }),
      this.fileWatcher.onDidFinishBatchProcessing.on((summary: BatchProcessingSummary) => {
        if (summary.batchError) {
          log.error("batch processing failed", { err: summary.batchError })
          this.overlay?.prepare()
          this.stateManager.setSystemState("Error", `Failed to process file changes: ${summary.batchError.message}`)
          this.emitError("orchestrator:watcher", summary.batchError, "watcher")
        }
        if (!this.fileWatcher.takeReconciliationRequest?.()) return
        this._followUpScanRequested = true
        if (!this._isProcessing) this.scheduleFollowUpScan("background")
      }),
    ]
  }

  private startWatcherInBackground(reason: string, trigger: IndexingTelemetryTrigger): void {
    if (this._watcherStart || this._watcherReady || this._watcherFailed) return

    const token = ++this._watcherToken
    log.info("file watcher starting after scan", {
      visible: true,
      workspacePath: this.workspacePath,
      reason,
      blocking: false,
      pendingWatcherEvents: this.fileWatcher.getPendingEventCount?.() ?? 0,
    })
    this._watcherStart = this.startWatcher(token, reason, trigger)
  }

  private async startWatcher(token: number, reason: string, trigger: IndexingTelemetryTrigger): Promise<void> {
    if (this.vectorStore && !this.configManager.isFeatureConfigured) {
      log.warn("file watcher skipped: service not configured", {
        visible: true,
        workspacePath: this.workspacePath,
        reason,
      })
      return
    }

    this.installWatcherSubscriptions()
    this.fileWatcher.setCollecting(false)
    log.info("starting file watcher", {
      visible: true,
      workspacePath: this.workspacePath,
      reason,
      blocking: false,
      pendingWatcherEvents: this.fileWatcher.getPendingEventCount?.() ?? 0,
    })

    try {
      await this.fileWatcher.initialize()
      if (token !== this._watcherToken) return

      this._watcherReady = true
      this.fileWatcher.setCollecting(this._watcherCollecting)
      log.info("file watcher initialized in async mode", {
        visible: true,
        workspacePath: this.workspacePath,
        reason,
        collecting: this._watcherCollecting,
        pendingWatcherEvents: this.fileWatcher.getPendingEventCount?.() ?? 0,
      })
      if (this._watcherCollecting && this.stateManager.state === "Indexed") {
        this.stateManager.setSystemState("Indexed", this.watcherReadyMessage())
      }
    } catch (err) {
      if (token !== this._watcherToken) return

      this._watcherFailed = true
      log.warn("file watcher initialization failed; indexing will continue without incremental watcher", {
        visible: true,
        workspacePath: this.workspacePath,
        reason,
        error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
      })
      this.emitError("orchestrator:startWatcher", err, "watcher", trigger)
    }
  }

  private enableWatcherCollection(trigger: IndexingTelemetryTrigger): void {
    this._watcherCollecting = true
    if (!this._watcherStart && !this._watcherFailed) this.startWatcherInBackground("scan-finished", trigger)

    if (this._watcherReady) {
      log.info("file watcher collection resumed after scan", {
        visible: true,
        workspacePath: this.workspacePath,
        pendingWatcherEvents: this.fileWatcher.getPendingEventCount?.() ?? 0,
      })
      this.fileWatcher.setCollecting(true)
      return
    }

    log.info("watcher collection deferred until ready", {
      visible: true,
      workspacePath: this.workspacePath,
      pendingWatcherEvents: this.fileWatcher.getPendingEventCount?.() ?? 0,
      failed: this._watcherFailed,
    })
  }

  private watcherReadyMessage(): string {
    return this.vectorStore
      ? "File watcher started. Index up-to-date."
      : "Code Graph watcher started. Code Graph up-to-date."
  }

  private watcherPendingMessage(): string {
    if (this._watcherFailed) return "Index up-to-date. File watcher unavailable; changes will be picked up next scan."
    return this.vectorStore
      ? "Index up-to-date. File watcher starting."
      : "Code Graph up-to-date. File watcher starting."
  }

  private deferWatcherCollection(reason: string): void {
    this._watcherCollecting = false
    if (this._watcherReady) this.fileWatcher.setCollecting(false)
    log.info("file watcher deferred until scan complete", {
      visible: true,
      workspacePath: this.workspacePath,
      reason,
      ready: this._watcherReady,
      started: !!this._watcherStart,
      pendingWatcherEvents: this.fileWatcher.getPendingEventCount?.() ?? 0,
    })
  }

  private notifyVectorCompatibility(): void {
    const decision = this.vectorStore?.getLastCompatibilityDecision?.()
    if (decision?.action !== "rebuild" || decision.reason !== "vector schema mismatch") return
    const hash = createHash("sha256").update(this.workspacePath).digest("hex").slice(0, 16)
    const id = `rag-lancedb-schema-mismatch-${hash}`
    this.stateManager.upsertNotice({
      id,
      level: "warning",
      message: LANCEDB_SCHEMA_MISMATCH_NOTICE,
      action: "openIndexingOutput",
    })
    log.warn("LanceDB compatibility decision", {
      visible: true,
      workspacePath: this.workspacePath,
      action: "notice",
      reason: decision.reason,
      noticeId: id,
    })
  }

  public startIndexing(trigger: IndexingTelemetryTrigger = "background"): Promise<void> {
    if (this._active) return this._active
    const task = this.runIndexing(trigger).finally(() => {
      if (this._active === task) this._active = undefined
    })
    this._active = task
    return task
  }

  private async runIndexing(trigger: IndexingTelemetryTrigger): Promise<void> {
    log.info("indexing start requested", {
      workspacePath: this.workspacePath,
      state: this.stateManager.state,
      featureConfigured: this.configManager.isFeatureConfigured,
      trigger,
    })

    if (!this.workspacePath) {
      this.stateManager.setSystemState("Error", "Indexing requires a workspace folder.")
      log.warn("start rejected: no workspace path")
      return
    }

    if (this.vectorStore && !this.configManager.isFeatureConfigured) {
      this.stateManager.setSystemState("Standby", "Missing configuration. Save your settings to start indexing.")
      log.warn("start rejected: missing configuration")
      return
    }

    const status = this.stateManager.getCurrentStatus()
    const lockedElsewhere = status.systemStatus === "Indexing" && status.message === LOCKED_MESSAGE
    if (
      this._isProcessing ||
      (!lockedElsewhere &&
        this.stateManager.state !== "Standby" &&
        this.stateManager.state !== "Error" &&
        this.stateManager.state !== "Indexed")
    ) {
      log.warn("start rejected", { state: this.stateManager.state })
      return
    }

    this._cancelRequested = false
    this._isProcessing = true
    this.stateManager.setSystemState("Indexing", "Initializing services...")

    let started = false
    let source: IndexingTelemetrySource = "watcher"
    let mode: IndexingTelemetryMode | undefined
    let pipeline: IndexingTelemetryPipeline | undefined

    try {
      if (!(await this.acquireLock())) {
        return
      }
      const lock = this._lock
      if (!lock) throw new Error("Indexing lock acquisition did not return a lock.")
      this.scanner.setRunContext(lock.runId, this.ragMeta)
      this.fileWatcher.setRunContext?.(lock.runId, this.ragMeta)
      await this.ensureCompatible("startup")
      this.overlay?.prepare()

      if (this._cancelRequested) {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
        await this.releaseLock()
        return
      }
      this.deferWatcherCollection("scan-start")

      source = "scan"

      if (!this.vectorStore) {
        mode = "full"
        pipeline = "codeGraph"
        started = true
        log.info("starting graph-only workspace scan", { workspacePath: this.workspacePath })
        this.stateManager.setActivePipeline("codeGraph")
        this.stateManager.setSystemState("Indexing", "Starting Code Graph indexing...")
        const summary = await this._runScan(mode, trigger, "codeGraph")
        if (!summary) return
        await this.cleanupArtifacts("after-codegraph", { local: true })
        await this.finishScan(summary, mode, trigger)
        return
      }

      mode = "full"
      pipeline = "codeGraph"
      started = true
      log.info("starting graph-only scan before RAG indexing", { workspacePath: this.workspacePath })
      this.stateManager.setActivePipeline("codeGraph")
      this.stateManager.setSystemState("Indexing", "Starting Code Graph indexing before RAG...")
      const graph = await this._runScan(mode, trigger, "codeGraph")
      if (!graph) return
      await this.cleanupArtifacts("after-codegraph", { local: true })

      this.stateManager.clearCodeGraphProgress()
      this.stateManager.setActivePipeline("rag")
      this.stateManager.setSystemState("Indexing", "Code Graph complete. Starting RAG indexing...")
      log.info("graph-only scan complete; starting RAG scan", {
        workspacePath: this.workspacePath,
        filesDiscovered: graph.filesDiscovered,
        totalBlocks: graph.totalBlocks,
      })

      pipeline = "rag"
      const collectionCreated = await this.vectorStore.initialize()
      this.notifyVectorCompatibility()
      log.info("vector store initialized", { workspacePath: this.workspacePath, collectionCreated })
      await this.cleanupArtifacts("after-vector-init", { local: false, vector: true })

      if (this._cancelRequested) {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
        await this.releaseLock()
        return
      }

      if (this.overlay) {
        if (!collectionCreated) await this.vectorStore.clearCollection()
        await this.cacheManager.clearCacheFile()
        this.cacheManager.seedHashes(this.overlay.seed())
        await this.cacheManager.flush?.()
        log.info("seeded worktree index from shared baseline", {
          workspacePath: this.workspacePath,
          baselinePath: this.overlay.baselinePath,
          files: this.overlay.baseline.size,
        })
      }

      const hasExistingData = this.overlay ? false : await this.vectorStore.hasIndexedData()
      if (!this.overlay && !hasExistingData) {
        if (!collectionCreated) await this.vectorStore.clearCollection()
        await this.cacheManager.clearCacheFile()
        log.info("cleared indexing cache before full scan", {
          workspacePath: this.workspacePath,
          collectionCreated,
        })
      }
      log.info("checked vector store indexed data", {
        workspacePath: this.workspacePath,
        hasExistingData,
        collectionCreated,
      })

      if (this._cancelRequested) {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
        await this.releaseLock()
        return
      }

      mode = hasExistingData && !collectionCreated ? "incremental" : "full"

      if (mode === "incremental") {
        log.info("collection has existing data, running incremental scan")

        this.stateManager.setSystemState("Indexing", "Checking for new or modified files...")
        await this.vectorStore.markIndexingIncomplete()
      } else {
        log.info("running full scan", {
          workspacePath: this.workspacePath,
          hasExistingData,
          collectionCreated,
        })
        this.stateManager.setSystemState("Indexing", "Services ready. Starting workspace scan...")
        await this.vectorStore.markIndexingIncomplete()
      }
      const rag = await this._runScan(mode, trigger, "rag")
      if (!rag) return
      await this.finishScan(rag, mode, trigger)
    } catch (err) {
      log.error("error during indexing", { err })
      this.emitError("orchestrator:startIndexing", err, source, trigger, mode, pipeline)

      if (started) {
        log.info("indexing failed after starting; preserving cache for retry")
      } else {
        log.info("failed to connect to vector store; preserving cache for future incremental scan")
      }

      const msg = err instanceof Error ? err.message : "Unknown error"
      this.stateManager.setSystemState("Error", `Failed during initial scan: ${msg}`)
      this.stopWatcher()
      await this.releaseLock()
    } finally {
      this._isProcessing = false
      log.info("indexing start flow finished", {
        workspacePath: this.workspacePath,
        state: this.stateManager.state,
      })
    }
  }

  public async startRagIndexing(
    trigger: IndexingTelemetryTrigger = "background",
    reason = "settings-change",
  ): Promise<void> {
    log.info("rag-only indexing start requested", {
      visible: true,
      workspacePath: this.workspacePath,
      state: this.stateManager.state,
      featureConfigured: this.configManager.isFeatureConfigured,
      trigger,
      reason,
      ragOnly: true,
      codeGraphPreserved: true,
    })

    if (!this.workspacePath) {
      this.stateManager.setSystemState("Error", "Indexing requires a workspace folder.")
      log.warn("rag-only start rejected: no workspace path")
      return
    }

    if (!this.vectorStore || !this.configManager.isFeatureConfigured) {
      this.stateManager.setSystemState("Standby", "Missing configuration. Save your settings to start RAG indexing.")
      log.warn("rag-only start rejected: missing configuration")
      return
    }

    if (this._isProcessing) {
      log.warn("rag-only start rejected", { state: this.stateManager.state })
      return
    }

    this._cancelRequested = false
    this._isProcessing = true
    this.stateManager.clearCodeGraphProgress()
    this.stateManager.setActivePipeline("rag")
    this.stateManager.setSystemState("Indexing", "Embedding settings changed. Starting RAG indexing...")

    let mode: IndexingTelemetryMode = "full"

    try {
      if (!(await this.acquireLock())) return
      const lock = this._lock
      if (!lock) throw new Error("Indexing lock acquisition did not return a lock.")
      this.scanner.setRunContext(lock.runId, this.ragMeta)
      this.fileWatcher.setRunContext?.(lock.runId, this.ragMeta)
      this.deferWatcherCollection("rag-only-scan-start")

      const collectionCreated = await this.vectorStore.initialize()
      this.notifyVectorCompatibility()
      log.info("vector store initialized for rag-only scan", {
        visible: true,
        workspacePath: this.workspacePath,
        collectionCreated,
        reason,
        ragOnly: true,
        codeGraphPreserved: true,
      })
      await this.cleanupArtifacts("rag-only-after-vector-init", { local: false, vector: true })

      if (this._cancelRequested) {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
        await this.releaseLock()
        return
      }

      if (collectionCreated) {
        await this.cacheManager.clearCacheFile()
        log.info("cleared indexing cache after rag-only collection creation", {
          workspacePath: this.workspacePath,
          reason,
        })
      }

      const hasExistingData = await this.vectorStore.hasIndexedData()
      mode = hasExistingData && !collectionCreated ? "incremental" : "full"
      log.info("running rag-only scan", {
        visible: true,
        workspacePath: this.workspacePath,
        mode,
        hasExistingData,
        collectionCreated,
        reason,
        ragOnly: true,
        codeGraphPreserved: true,
      })
      await this.vectorStore.markIndexingIncomplete()

      const summary = await this._runScan(mode, trigger, "rag")
      if (!summary) return
      await this.finishScan(summary, mode, trigger)
    } catch (err) {
      log.error("error during rag-only indexing", { err })
      this.emitError("orchestrator:startRagIndexing", err, "scan", trigger, mode, "rag")
      const msg = err instanceof Error ? err.message : "Unknown error"
      this.stateManager.setSystemState("Error", `Failed during RAG scan: ${msg}`)
      this.stopWatcher()
      await this.releaseLock()
    } finally {
      this._isProcessing = false
      log.info("rag-only indexing flow finished", {
        workspacePath: this.workspacePath,
        state: this.stateManager.state,
        reason,
      })
    }
  }

  private async _runScan(
    mode: IndexingTelemetryMode,
    trigger: IndexingTelemetryTrigger,
    target: ScanTarget = "all",
  ): Promise<ScanSummary | undefined> {
    if (this._cancelRequested) {
      log.info("scan skipped: cancellation was requested", { workspacePath: this.workspacePath, mode, target })
      if (mode === "incremental") await this.vectorStore?.markIndexingComplete()
      this.stateManager.setSystemState("Standby", "Indexing cancelled.")
      return
    }

    log.info("starting workspace scan", { workspacePath: this.workspacePath, mode, target })
    let cumulativeFilesIndexed = 0
    let cumulativeFilesFound = 0
    let cumulativeFilesProcessed = 0
    let totalFiles = 0
    let graphFilesProcessed = 0
    let graphTotalFiles = 0
    const batchErrors: Error[] = []

    const reportFileProgress = (filePath?: string) => {
      this.stateManager.reportFileProgress(
        cumulativeFilesProcessed,
        totalFiles,
        filePath ? path.basename(filePath) : undefined,
      )
    }

    const reportGraphProgress = (filePath?: string) => {
      this.stateManager.reportCodeGraphProgress(
        graphFilesProcessed,
        graphTotalFiles,
        filePath ? path.basename(filePath) : undefined,
      )
    }

    const handleFileParsed = () => {
      cumulativeFilesFound += 1
    }

    const handleFilesIndexed = (indexedCount: number) => {
      cumulativeFilesIndexed += indexedCount
      if (target === "codeGraph") return
      cumulativeFilesProcessed += indexedCount
      if (totalFiles > 0 && cumulativeFilesProcessed > totalFiles) cumulativeFilesProcessed = totalFiles
      reportFileProgress()
    }

    const handleScanProgress = (event: ScanProgressEvent) => {
      if (event.type === "target") {
        totalFiles = event.totalFiles
        graphTotalFiles = event.graphTotalFiles
        if (target !== "codeGraph") reportFileProgress()
        if (target !== "rag") reportGraphProgress()
        return
      }

      if (event.type === "file") {
        if (target === "codeGraph") return
        cumulativeFilesProcessed += 1
        if (totalFiles > 0 && cumulativeFilesProcessed > totalFiles) cumulativeFilesProcessed = totalFiles
        reportFileProgress(event.filePath)
        return
      }

      if (target === "rag") return
      graphFilesProcessed += 1
      if (graphTotalFiles > 0 && graphFilesProcessed > graphTotalFiles) graphFilesProcessed = graphTotalFiles
      reportGraphProgress(event.filePath)
    }

    const result = await this.scanner
      .scanDirectory(
        this.workspacePath,
        (batchError: Error) => {
          log.error(`error during ${mode} scan batch`, { err: batchError })
          batchErrors.push(batchError)
        },
        handleFilesIndexed,
        handleFileParsed,
        mode,
        handleScanProgress,
        target,
      )
      .finally(() => this.scanner.disposeGraphWorkers?.())

    log.info("workspace scan completed", {
      workspacePath: this.workspacePath,
      mode,
      target,
      filesDiscovered: cumulativeFilesFound,
      filesIndexed: cumulativeFilesIndexed,
      scanProcessed: result.stats.processed,
      scanSkipped: result.stats.skipped,
      totalBlocks: result.totalBlockCount,
      batchErrorCount: batchErrors.length,
    })

    if (this._cancelRequested || this.scanner.isCancelled) {
      if (mode === "incremental" && result.stats.processed === 0 && batchErrors.length === 0) {
        await this.vectorStore?.markIndexingComplete()
        log.info("preserved unchanged index after cancelled scan", { workspacePath: this.workspacePath })
      }
      this._isProcessing = false
      if (this.stateManager.state !== "Error") {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
      }
      await this.releaseLock()
      log.info("workspace scan cancelled", { workspacePath: this.workspacePath, mode, target })
      return
    }

    if (this.overlay && batchErrors.length > 0) {
      throw batchErrors[0]
    }

    if (this.vectorStore && target === "rag" && mode === "full") {
      // Validate full scan results
      if (cumulativeFilesIndexed === 0 && cumulativeFilesFound > 0) {
        const first = batchErrors.at(0)
        const msg = first ? first.message : "No blocks were indexed"
        throw new Error(`Indexing failed: ${msg}`)
      }

      if (batchErrors.length > 0) {
        const failureRate = (cumulativeFilesFound - cumulativeFilesIndexed) / cumulativeFilesFound
        if (failureRate > 0.1) {
          const first = batchErrors.at(0)
          const msg = first ? first.message : "Unknown batch error"
          throw new Error(
            `Indexing partially failed: Only ${cumulativeFilesIndexed} of ${cumulativeFilesFound} files were indexed. ${msg}`,
          )
        }
      }
    }

    if (totalFiles > 0 && cumulativeFilesProcessed < totalFiles) {
      cumulativeFilesProcessed = totalFiles
      if (target !== "codeGraph") reportFileProgress()
    }
    this.overlay?.reconcile(this.cacheManager.getAllHashes())
    await this.cacheManager.flush?.()

    if (graphTotalFiles > 0 && graphFilesProcessed < graphTotalFiles) {
      graphFilesProcessed = graphTotalFiles
      if (target !== "rag") reportGraphProgress()
    }

    return {
      filesDiscovered: cumulativeFilesFound,
      filesIndexed: cumulativeFilesIndexed,
      totalBlocks: result.totalBlockCount,
      batchErrors: batchErrors.length,
      candidateFiles: result.candidateFiles ?? [],
      scanStartedAt: result.scanStartedAt ?? Date.now(),
      target,
    }
  }

  private async cleanupArtifacts(stage: string, input: { local?: boolean; vector?: boolean }): Promise<void> {
    try {
      if (typeof this.scanner.cleanupAbandonedArtifacts !== "function") return
      const summary = await this.scanner.cleanupAbandonedArtifacts(input)
      log.info("indexing cleanup complete", {
        visible: true,
        workspacePath: this.workspacePath,
        stage,
        reason: stage,
        ...cleanupFields(summary),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn("indexing cleanup failed", {
        workspacePath: this.workspacePath,
        stage,
        error: sanitizeErrorMessage(msg),
      })
    }
  }

  private async ensureCompatible(stage: string): Promise<void> {
    const scanner = this.scanner as DirectoryScanner & {
      ensureCompatible?: () => Promise<{
        codeGraph?: { action: "reuse" | "rebuild"; reason: string }
        postings?: { action: "reuse" | "rebuild"; reason: string }
      }>
    }
    if (typeof scanner.ensureCompatible !== "function") return

    const decision = await scanner.ensureCompatible()
    log.info("indexing compatibility decision", {
      visible: true,
      workspacePath: this.workspacePath,
      stage,
      codeGraphAction: decision.codeGraph?.action,
      codeGraphReason: decision.codeGraph?.reason,
      postingsAction: decision.postings?.action,
      postingsReason: decision.postings?.reason,
    })
  }

  private async acquireLock(): Promise<boolean> {
    while (!this._cancelRequested) {
      const result = await IndexingRunLock.acquire({
        cacheDirectory: this.cacheDirectory,
        workspacePath: this.workspacePath,
      })
      if (result.status === "acquired") {
        this._lock = result.lock
        if (result.staleRemoved) {
          log.warn("stale indexing lock removed before scan", {
            visible: true,
            workspacePath: this.workspacePath,
            reason: result.staleReason,
            ownerPid: result.previous?.pid,
            ownerRunId: result.previous?.runId,
          })
        }
        return true
      }

      this.stateManager.setSystemState("Indexing", `${LOCKED_MESSAGE} Retrying automatically...`)
      log.warn("waiting for existing indexing lock", {
        visible: true,
        workspacePath: this.workspacePath,
        reason: result.reason,
        ownerPid: result.owner?.pid,
        ownerRunId: result.owner?.runId,
        retryAfterMs: result.retryAfterMs,
      })
      await delay(result.retryAfterMs)
    }

    this.stateManager.setSystemState("Standby", "Indexing cancelled.")
    return false
  }

  private async sweepGap(summary: ScanSummary): Promise<void> {
    if (typeof this.fileWatcher.enqueueSyntheticEvents !== "function") {
      log.info("gap sweep skipped: watcher does not support synthetic events", {
        workspacePath: this.workspacePath,
        target: summary.target,
      })
      return
    }

    const started = Date.now()
    const before = new Set(summary.candidateFiles)
    const events: WatcherSyntheticEvent[] = []
    let changed = 0
    let deleted = 0
    let created = 0
    let skipped = 0

    for (const file of summary.candidateFiles) {
      try {
        const info = await stat(file)
        if (info.mtimeMs > summary.scanStartedAt) {
          events.push({ path: file, type: "change" })
          changed += 1
        }
      } catch (err) {
        if (missing(err)) {
          events.push({ path: file, type: "delete" })
          deleted += 1
          continue
        }
        skipped += 1
      }
    }

    const scanner = this.scanner as DirectoryScanner & {
      discoverCandidateFiles?: (directory: string, target: ScanTarget) => Promise<{ paths: string[]; engine: string }>
    }
    let engine: string | undefined
    if (typeof scanner.discoverCandidateFiles === "function") {
      try {
        const fresh = await scanner.discoverCandidateFiles(this.workspacePath, summary.target)
        engine = fresh.engine
        for (const file of fresh.paths) {
          if (before.has(file)) continue
          events.push({ path: file, type: "create" })
          created += 1
        }
      } catch (err) {
        skipped += 1
        log.warn("gap sweep rediscovery failed", {
          visible: true,
          workspacePath: this.workspacePath,
          target: summary.target,
          error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
        })
      }
    }

    if (events.length > SYNTHETIC_EVENT_LIMIT) {
      this._followUpScanRequested = true
      log.warn("gap sweep exceeded synthetic event limit; scheduling follow-up indexing scan", {
        visible: true,
        workspacePath: this.workspacePath,
        target: summary.target,
        events: events.length,
        limit: SYNTHETIC_EVENT_LIMIT,
        changed,
        deleted,
        created,
        skipped,
        discoveryEngine: engine,
        elapsedMs: Date.now() - started,
      })
      return
    }

    this.fileWatcher.enqueueSyntheticEvents(events)
    log.info("gap sweep complete", {
      visible: true,
      workspacePath: this.workspacePath,
      target: summary.target,
      queued: events.length,
      changed,
      deleted,
      created,
      skipped,
      discoveryEngine: engine,
      elapsedMs: Date.now() - started,
    })
  }

  private scheduleFollowUpScan(trigger: IndexingTelemetryTrigger): void {
    if (!this._followUpScanRequested || this._followUpScanScheduled) return

    this._followUpScanRequested = false
    this._followUpScanScheduled = true
    log.warn("follow-up indexing scan scheduled after large gap sweep", {
      visible: true,
      workspacePath: this.workspacePath,
    })
    setTimeout(() => {
      this._followUpScanScheduled = false
      void this.startIndexing(trigger).catch((err) => {
        log.warn("follow-up indexing scan failed", {
          visible: true,
          workspacePath: this.workspacePath,
          error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
        })
      })
    }, 0)
  }

  private async finishScan(
    summary: ScanSummary,
    mode: IndexingTelemetryMode,
    trigger: IndexingTelemetryTrigger,
  ): Promise<void> {
    await this.vectorStore?.markIndexingComplete()
    await this.sweepGap(summary)
    await this.releaseLock()
    this.enableWatcherCollection(trigger)
    this.stateManager.setSystemState(
      "Indexed",
      this._watcherReady ? this.watcherReadyMessage() : this.watcherPendingMessage(),
    )
    log.info("workspace scan finalized", {
      workspacePath: this.workspacePath,
      mode,
      filesIndexed: summary.filesIndexed,
      filesDiscovered: summary.filesDiscovered,
    })
    this.scheduleFollowUpScan(trigger)

    this.emitTelemetry({
      ...this.getTelemetryMeta(),
      type: "completed",
      source: "scan",
      trigger,
      mode,
      filesIndexed: summary.filesIndexed,
      filesDiscovered: summary.filesDiscovered,
      totalBlocks: summary.totalBlocks,
      batchErrors: summary.batchErrors,
    })
  }

  public async shutdown(): Promise<void> {
    this._cancelRequested = true
    this.scanner.cancel()
    this.fileWatcher.setCollecting(false)
    await this._active
    for (const sub of this._fileWatcherSubscriptions) sub.dispose()
    this._fileWatcherSubscriptions = []
    if (this.fileWatcher.shutdown) await this.fileWatcher.shutdown()
    else this.fileWatcher.dispose()
    await this.vectorStore?.close?.()
    this._isProcessing = false
  }

  public stopWatcher(): void {
    log.info("stopping file watcher", { workspacePath: this.workspacePath })
    this._watcherToken += 1
    this._watcherStart = undefined
    this._watcherReady = false
    this._watcherCollecting = false
    this._watcherFailed = false
    this.fileWatcher.dispose()
    this.scanner.cancel()
    for (const sub of this._fileWatcherSubscriptions) sub.dispose()
    this._fileWatcherSubscriptions = []

    if (this.stateManager.state !== "Error") {
      this.stateManager.setSystemState("Standby", "File watcher stopped.")
    }
    this._isProcessing = false
    void this.releaseLock()
    log.info("file watcher stopped", { workspacePath: this.workspacePath, state: this.stateManager.state })
  }

  public cancelIndexing(): void {
    log.info("cancelling indexing", { workspacePath: this.workspacePath })
    this._cancelRequested = true
    this.scanner.cancel()
    this.stopWatcher()
    this.stateManager.setSystemState("Standby", "Indexing cancelled.")
    this._isProcessing = false
    void this.releaseLock()
    log.info("indexing cancelled", { workspacePath: this.workspacePath })
  }

  public async clearIndexData(): Promise<void> {
    this._isProcessing = true
    log.info("clearing index data", { workspacePath: this.workspacePath })

    try {
      this.stopWatcher()

      try {
        if (this.vectorStore && this.configManager.isFeatureConfigured) {
          await this.vectorStore.deleteCollection()
        } else {
          log.warn("service not configured, skipping vector collection clear")
        }
      } catch (err: any) {
        log.error("failed to clear vector collection", { err })
        this.stateManager.setSystemState("Error", `Failed to clear vector collection: ${err.message}`)
      }

      await this.cacheManager.clearCacheFile()

      if (this.stateManager.state !== "Error") {
        this.stateManager.setSystemState("Standby", "Index data cleared successfully.")
      }
    } finally {
      this._isProcessing = false
      await this.releaseLock()
      log.info("finished clearing index data", {
        workspacePath: this.workspacePath,
        state: this.stateManager.state,
      })
    }
  }

  public get state(): IndexingState {
    return this.stateManager.state
  }

  private async releaseLock(): Promise<void> {
    const lock = this._lock
    this._lock = undefined
    await lock?.release()
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function extractErrorFile(message: string): string | undefined {
  const match = message.match(/(?:^|[,(]\s*File:\s*)([^,)]+)/i)
  return match?.[1]?.trim()
}

function missing(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT"
}

function cleanupFields(summary: IndexingCleanupSummary): Record<string, unknown> {
  return {
    codeGraphFilesDeleted: summary.codeGraph.filesDeleted,
    codeGraphDirectoriesDeleted: summary.codeGraph.directoriesDeleted,
    codeGraphBytesDeleted: summary.codeGraph.bytesDeleted,
    codeGraphSkipped: summary.codeGraph.skipped,
    postingsFilesDeleted: summary.postings.filesDeleted,
    postingsDirectoriesDeleted: summary.postings.directoriesDeleted,
    postingsBytesDeleted: summary.postings.bytesDeleted,
    postingsSkipped: summary.postings.skipped,
    vectorPointsDeleted: summary.vector?.pointsDeleted,
    vectorSkipped: summary.vector?.skipped ?? [],
  }
}
