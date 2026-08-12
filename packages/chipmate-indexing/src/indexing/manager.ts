import path from "path"
import { readFile } from "node:fs/promises"
import type { IVectorStore, VectorStoreSearchResult } from "./interfaces"
import type { IndexingState } from "./interfaces/manager"
import type {
  IndexingTelemetryEvent,
  IndexingTelemetryMeta,
  IndexingTelemetryPipeline,
  IndexingTelemetryTrigger,
} from "./interfaces/telemetry"
import type { CodeGraphEvidenceQueryOptions, QueryEvidenceResult } from "./analysis"
import type { CodeGraphSidecarStatus } from "./codegraph"
import type { DocumentIndexStatus, DocumentSearchOptions, DocumentSearchResult } from "./documents"
import { DocumentIndexService } from "./documents"
import { CodeIndexConfigManager, type IndexingConfigInput } from "./config-manager"
import { DEFAULT_VECTOR_STORE, INITIAL_MANAGER_RECOVERY_DELAY_MS, MAX_MANAGER_RECOVERY_ATTEMPTS } from "./constants"
import { CodeIndexStateManager } from "./state-manager"
import { CodeIndexServiceFactory } from "./service-factory"
import { CodeIndexSearchService } from "./search-service"
import { CodeIndexAnalysisService } from "./analysis"
import { CodeGraphSidecarLifecycle, disabledCodeGraphSidecarStatus } from "./codegraph"
import { CodeGraphJsonStorage, CodePostingsJsonStorage } from "./codegraph/storage"
import { CodeIndexOrchestrator, type IndexingRunOutcome } from "./orchestrator"
import { CacheManager } from "./cache-manager"
import { Emitter } from "./runtime"
import { Log } from "../util/log"
import { loadIgnoreWithFingerprint } from "./shared/load-ignore"
import { sanitizeErrorMessage } from "./shared/validation-helpers"
import type { IndexingDiagnostic, IndexingPipelineRecentErrors } from "../status"
import type { IndexingPressure } from "./memory"
import { WorktreeOverlay } from "./worktree-overlay"
import type { PreparedEmbeddingRuntime } from "./embedding-quality"

const log = Log.create({ service: "indexing-manager" })
const MAX_RECENT_ERRORS = 5
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 500
const MAX_DIAGNOSTIC_FILE_LENGTH = 300
const BASELINE_CHECK_INTERVAL = 1_000
const BASELINE_SIGNATURE_INTERVAL = 30_000
const BASELINE_PENDING = "Waiting for the primary worktree index to become available."

type Baseline = {
  store?: IVectorStore
  signature: string
  stamp?: string
  overlay?: WorktreeOverlay
}

type GraphScanState = "never" | "interrupted" | "complete" | "needs-rebuild"

/**
 * RATIONALE: Removed the static singleton Map and vscode.ExtensionContext.
 * The manager is now constructed directly with a workspace path and cache
 * directory. The host (CLI, extension) is responsible for managing instances
 * per workspace.
 */
export class CodeIndexManager {
  private _configManager: CodeIndexConfigManager | undefined
  private readonly _stateManager: CodeIndexStateManager
  private readonly _telemetry = new Emitter<IndexingTelemetryEvent>()
  private _serviceFactory: CodeIndexServiceFactory | undefined
  private _runtime: PreparedEmbeddingRuntime | undefined
  private _orchestrator: CodeIndexOrchestrator | undefined
  private _searchService: CodeIndexSearchService | undefined
  private _documentService: DocumentIndexService | undefined
  private _documentGate: DocumentIndexStatus | undefined
  private _documentStop: Promise<void> = Promise.resolve()
  private _generation = 0
  private _pressure: IndexingPressure = "normal"
  private readonly _analysisService: CodeIndexAnalysisService
  private readonly _graphStorage: CodeGraphJsonStorage
  private readonly _postingsStorage: CodePostingsJsonStorage
  private readonly _codeGraph: CodeGraphSidecarLifecycle
  private _cacheManager: CacheManager | undefined
  private _baselineStore: IVectorStore | undefined
  private _fallbackStore: IVectorStore | undefined
  private _baselineSignature: string | undefined
  private _baselineStamp: string | undefined
  private _baselineChecked = 0
  private _baselineSigned = 0
  private _baselineRefresh: Promise<void> | undefined
  private _baselineTimer: ReturnType<typeof setTimeout> | undefined
  private _baselineInitialDelay = BASELINE_CHECK_INTERVAL
  private _baselineDelay = BASELINE_CHECK_INTERVAL
  private _overlay: WorktreeOverlay | undefined
  private _isRecoveringFromError = false
  private _retryTimer: ReturnType<typeof setTimeout> | undefined
  private _retryResolve: (() => void) | undefined
  private _retryTask: Promise<void> | undefined
  private _retryAttempt = 0
  private _retryMaxAttempts = MAX_MANAGER_RECOVERY_ATTEMPTS
  private _retryInitialDelayMs = INITIAL_MANAGER_RECOVERY_DELAY_MS
  private _flow: Promise<void> = Promise.resolve()
  private _disposed = false
  private readonly _recentErrors: IndexingPipelineRecentErrors = {}

  constructor(
    public readonly workspacePath: string,
    private readonly cacheDirectory: string,
    public readonly baselinePath?: string,
  ) {
    this._stateManager = new CodeIndexStateManager()
    this._graphStorage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    this._postingsStorage = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })
    this._analysisService = new CodeIndexAnalysisService(
      this._graphStorage,
      this._postingsStorage,
      (query, options) => {
        if (!this._searchService) throw new Error("vector-search-unavailable")
        return this._searchService.searchIndexForEvidence(query, options.directoryPrefix, {
          maxResults: options.maxResults,
        })
      },
    )
    this._codeGraph = new CodeGraphSidecarLifecycle({ workspacePath, cacheDirectory, storage: this._graphStorage })
  }

  public get onProgressUpdate() {
    return this._stateManager.onProgressUpdate
  }

  public get onTelemetry() {
    return this._telemetry
  }

  private getTelemetryMeta(): IndexingTelemetryMeta | undefined {
    if (!this._configManager) {
      return undefined
    }
    const cfg = this._configManager.getConfig()
    return {
      provider: cfg.embedderProvider,
      vectorStore: cfg.vectorStoreProvider ?? DEFAULT_VECTOR_STORE,
      modelId: cfg.modelId,
    }
  }

  private emitStart(trigger: IndexingTelemetryTrigger): void {
    const meta = this.getTelemetryMeta()
    if (!meta) {
      return
    }
    this._telemetry.fire({
      ...meta,
      type: "started",
      source: "scan",
      trigger,
    })
  }

  private emitError(
    location: string,
    err: unknown,
    trigger?: IndexingTelemetryTrigger,
    pipeline?: IndexingTelemetryPipeline,
  ): void {
    const meta = this.getTelemetryMeta()
    if (!meta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this._telemetry.fire({
      ...meta,
      type: "error",
      source: "scan",
      location,
      trigger,
      pipeline,
      error: sanitizeErrorMessage(msg),
    })
  }

  private clearRetryTimer(): void {
    if (!this._retryTimer) {
      this._retryResolve = undefined
      return
    }
    clearTimeout(this._retryTimer)
    this._retryTimer = undefined
    this._retryResolve?.()
    this._retryResolve = undefined
  }

  private resetRetryState(): void {
    this._retryAttempt = 0
    this.clearRetryTimer()
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const task = this._flow.then(run, run)
    this._flow = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private stopDocuments(): Promise<void> {
    const service = this._documentService
    this._documentService = undefined
    this._documentGate = undefined
    if (!service) return this._documentStop
    const stop = service.dispose().catch((err) => {
      log.warn("failed while stopping Document RAG", { workspacePath: this.workspacePath, err })
    })
    const task = Promise.all([this._documentStop, stop]).then(() => {
      if (this._stateManager.getCurrentStatus().activePipeline === "documents") {
        this._stateManager.setActivePipeline(undefined)
        this._stateManager.notify()
      }
    })
    this._documentStop = task
    return task
  }

  private async nextGeneration(stopDocuments = true): Promise<number> {
    this._generation += 1
    const generation = this._generation
    if (stopDocuments) await this.stopDocuments()
    return generation
  }

  private current(generation: number): boolean {
    return !this._disposed && generation === this._generation
  }

  private graphScanState(): GraphScanState {
    const states = [this._graphStorage.getScanState(), this._postingsStorage.getScanState()]
    if (states.includes("needs-rebuild")) return "needs-rebuild"
    if (states.includes("interrupted")) return "interrupted"
    if (states.every((state) => state === "complete")) return "complete"
    return "never"
  }

  private waiting(): boolean {
    if (!this.baselinePath || this._baselineStore) return false
    this._stateManager.setSystemState("Standby", BASELINE_PENDING)
    if (this._configManager?.currentDocuments?.enabled && this._documentGate?.message !== BASELINE_PENDING) {
      this._documentGate = documentStandby(BASELINE_PENDING)
      this._stateManager.notify()
    }
    this.scheduleBaselineRetry()
    return true
  }

  private async waitWithGraph(generation: number, trigger: IndexingTelemetryTrigger): Promise<void> {
    await this._recreateGraphServices("worktree-baseline-wait", generation)
    if (!this.current(generation)) return
    this._codeGraph.start("worktree-baseline-wait")
    const scan = this._orchestrator?.startIndexing(trigger)
    await this.configureDocuments(trigger, { start: false, generation })
    this.waiting()
    void scan?.finally(() => {
      if (this.current(generation) && !this._baselineStore) this.waiting()
    })
  }

  private async graphFallback(err: unknown, trigger: IndexingTelemetryTrigger, reason: string): Promise<void> {
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err))
    const graphReady = this.graphScanState() === "complete"
    const generation = await this.nextGeneration()
    if (!this.current(generation)) return
    await this._recreateGraphServices(reason, generation)
    if (!this.current(generation)) return
    const fallback = await this._serviceFactory?.prepareLastKnownGoodRuntime().catch((cause) => {
      log.warn("last-known-good embedding runtime validation failed", {
        workspacePath: this.workspacePath,
        err: cause,
      })
      return undefined
    })
    const restored = fallback ? await this.restoreLastKnownGood(fallback, generation) : false
    if (!this.current(generation)) return
    this._codeGraph.start(reason)
    if (graphReady) {
      log.info("preserved completed Code Graph after RAG validation failure", {
        workspacePath: this.workspacePath,
        reason,
      })
    } else {
      await this._orchestrator?.startIndexing(trigger)
    }
    if (!this.current(generation)) return
    const hint = this._configManager?.currentDimensionMode === "fixed" ? " 清空 embedding 维度可恢复自动探测。" : ""
    this._stateManager.upsertNotice({
      id: "embedding-config-unapplied",
      level: "warning",
      message: `Embedding 配置未应用：${message}.${hint}${
        restored ? " 已继续使用已验证的上一版向量索引。" : ""
      }`.replace("..", "."),
      action: "openIndexingOutput",
    })
    this._stateManager.setSystemState(
      restored ? "Indexed" : "Error",
      `Embedding 配置未应用：${message}.${hint}${restored ? " 正在使用已验证的上一版向量索引。" : ""}`.replace(
        "..",
        ".",
      ),
    )
    if (this._configManager?.currentDocuments?.enabled) {
      this._documentGate = documentStandby("Document RAG blocked because Code RAG did not complete.")
      this._stateManager.notify()
    }
    this._stateManager.setActivePipeline(restored ? undefined : "rag")
  }

  private async restoreLastKnownGood(runtime: PreparedEmbeddingRuntime, generation: number): Promise<boolean> {
    if (!this.current(generation) || !this._serviceFactory || !this._configManager) return false
    if (this.baselinePath) {
      log.info("last-known-good vector fallback skipped for a worktree overlay", {
        workspacePath: this.workspacePath,
        baselinePath: this.baselinePath,
      })
      return false
    }

    const store = this._serviceFactory.createVectorStore(this.workspacePath, runtime.profile)
    try {
      if (!store.openExisting) return false
      await store.openExisting()
      if (!(await store.hasIndexedData())) {
        await store.close?.()
        return false
      }
    } catch (cause) {
      await store.close?.()
      log.info("last-known-good code index is unavailable", {
        workspacePath: this.workspacePath,
        err: cause,
      })
      return false
    }
    if (!this.current(generation)) {
      await store.close?.()
      return false
    }

    this._fallbackStore = store
    this._runtime = runtime
    this._searchService = new CodeIndexSearchService(this._configManager, this._stateManager, runtime.embedder, store)

    if (!this._configManager.currentDocuments.enabled) return true
    await (async () => {
      const loaded = await loadIgnoreWithFingerprint(this.workspacePath)
      const documents = this._serviceFactory!.createDocumentVectorStore(runtime.profile)
      try {
        if (!documents.openExisting) return
        await documents.openExisting()
        if (!(await documents.hasIndexedData())) {
          await documents.close?.()
          return
        }
        if (!this.current(generation)) {
          await documents.close?.()
          return
        }
        this._documentService = this._serviceFactory!.createDocumentService(
          loaded.ignore,
          () => this._stateManager.notify(),
          runtime,
          documents,
        )
        this._documentService.setMemoryPressure(this._pressure)
      } catch (cause) {
        await documents.close?.()
        throw cause
      }
    })().catch((cause) => {
      log.info("last-known-good document index is unavailable", {
        workspacePath: this.workspacePath,
        err: cause,
      })
    })
    return true
  }

  private scheduleBaselineRetry(): void {
    if (!this.baselinePath || this._baselineStore || this._baselineTimer || this._disposed) return
    this._baselineTimer = setTimeout(() => {
      this._baselineTimer = undefined
      void this.refreshBaseline()
        .catch((err) => {
          log.warn("failed to refresh shared indexing baseline", { workspacePath: this.workspacePath, err })
        })
        .finally(() => {
          if (this._baselineStore) return
          this._baselineDelay = Math.min(this._baselineDelay * 2, BASELINE_SIGNATURE_INTERVAL)
          this.scheduleBaselineRetry()
        })
    }, this._baselineDelay)
    this._baselineTimer.unref?.()
  }

  private clearBaselineRetry(): void {
    if (!this._baselineTimer) return
    clearTimeout(this._baselineTimer)
    this._baselineTimer = undefined
  }

  private resetBaselineRetry(): void {
    this.clearBaselineRetry()
    this._baselineDelay = this._baselineInitialDelay
  }

  private async waitForRetry(delay: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this._retryResolve = resolve
      this._retryTimer = setTimeout(() => {
        this._retryTimer = undefined
        this._retryResolve = undefined
        resolve()
      }, delay)
    })
  }

  private handleTelemetry(event: IndexingTelemetryEvent): void {
    if (event.type === "error") this.recordError(event)
    this._telemetry.fire(event)

    if (event.type === "completed") {
      this.resetRetryState()
      return
    }

    if (event.type !== "error") return
    if (
      event.location !== "orchestrator:startIndexing" &&
      event.location !== "orchestrator:startRagIndexing" &&
      event.location !== "orchestrator:watcher"
    )
      return
    if (!this.isFeatureEnabled || !this.isFeatureConfigured) return
    if (event.pipeline === "rag" && nonRetryableEmbeddingFailure(event.error)) {
      log.info("indexing recovery skipped for non-retryable embedding configuration failure", {
        workspacePath: this.workspacePath,
        location: event.location,
      })
      return
    }
    if (this._retryTask || this._isRecoveringFromError) return

    if (this._retryAttempt >= this._retryMaxAttempts) {
      log.warn("indexing recovery retries exhausted", {
        workspacePath: this.workspacePath,
        attempts: this._retryAttempt,
        maxAttempts: this._retryMaxAttempts,
      })
      return
    }

    void this.recoverFromError(event.trigger ?? "background")
  }

  private recordError(event: Extract<IndexingTelemetryEvent, { type: "error" }>): void {
    const item = {
      time: new Date().toISOString(),
      source: event.source,
      location: event.location,
      message: trimDiagnostic(sanitizeErrorMessage(event.error)),
      ...(event.file ? { file: trimDiagnostic(event.file, MAX_DIAGNOSTIC_FILE_LENGTH) } : {}),
    }
    for (const key of errorPipelines(event)) {
      const list = this._recentErrors[key] ?? []
      list.unshift(item)
      list.splice(MAX_RECENT_ERRORS)
      this._recentErrors[key] = list
    }
  }

  private clearErrors(pipeline: keyof IndexingPipelineRecentErrors): void {
    if (!this._recentErrors[pipeline]?.length) return
    delete this._recentErrors[pipeline]
    this._stateManager.notify()
  }

  private async runRecovery(trigger: IndexingTelemetryTrigger, attempt: number): Promise<void> {
    if (this._disposed) return

    this._isRecoveringFromError = true
    this._retryAttempt = attempt

    log.info("starting indexing error recovery attempt", {
      workspacePath: this.workspacePath,
      attempt,
      maxAttempts: this._retryMaxAttempts,
      trigger,
    })

    if (!this._configManager || !this._cacheManager) {
      log.warn("indexing recovery skipped: manager not initialized", {
        workspacePath: this.workspacePath,
      })
      this._isRecoveringFromError = false
      return
    }

    this._stateManager.setSystemState("Standby", "")

    try {
      const generation = await this.nextGeneration()
      if (!this.current(generation)) {
        this._isRecoveringFromError = false
        return
      }
      await this._recreateServices(undefined, generation)
      if (!this.current(generation)) {
        this._isRecoveringFromError = false
        return
      }
      if (this.baselinePath && !this._baselineStore) {
        await this.waitWithGraph(generation, trigger)
        this.resetRetryState()
        this._isRecoveringFromError = false
        return
      }
      this._codeGraph.start("indexing-recovery")
      this.emitStart(trigger)
      const scan = this._orchestrator!.startIndexing(trigger)
      await this.configureDocuments(trigger, { after: scan, generation, wait: true })
      if (this._disposed) return
    } catch (err) {
      if (this._disposed) return
      log.error("indexing recovery attempt failed", {
        err,
        attempt,
      })
      this.emitError("manager:recoverFromError", err, trigger)
      this._stateManager.setSystemState(
        "Error",
        `Failed during recovery: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    const failed = this._orchestrator?.state === "Error" || this.getCurrentStatus().systemStatus === "Error"
    if (!failed) {
      this.resetRetryState()
      this._isRecoveringFromError = false
      log.info("completed indexing error recovery", {
        workspacePath: this.workspacePath,
        attempt,
      })
      return
    }

    if (attempt >= this._retryMaxAttempts) {
      this._isRecoveringFromError = false
      log.warn("indexing recovery reached max attempts", {
        workspacePath: this.workspacePath,
        attempts: attempt,
        maxAttempts: this._retryMaxAttempts,
      })
      return
    }

    const delay = this._retryInitialDelayMs * Math.pow(2, attempt - 1)
    await this.waitForRetry(delay)
    if (this._disposed) return
    this._isRecoveringFromError = false
    return this.runRecovery(trigger, attempt + 1)
  }

  private assertInitialized() {
    if (!this._configManager || !this._orchestrator || !this._searchService || !this._cacheManager) {
      throw new Error("CodeIndexManager not initialized. Call initialize() first.")
    }
  }

  public get state(): IndexingState {
    if (!this.isFeatureEnabled) return "Standby"
    return this._orchestrator?.state ?? this._stateManager.state
  }

  public get isFeatureEnabled(): boolean {
    return this._configManager?.isFeatureEnabled ?? false
  }

  public get isFeatureConfigured(): boolean {
    return this._configManager?.isFeatureConfigured ?? false
  }

  public get isInitialized(): boolean {
    return !!this._configManager && !!this._orchestrator && !!this._cacheManager
  }

  public getRecentErrors(): IndexingPipelineRecentErrors {
    return {
      codeGraph: this._recentErrors.codeGraph?.slice(),
      rag: this._recentErrors.rag?.slice(),
      documents: this._recentErrors.documents?.slice(),
    }
  }

  public setMemoryPressure(pressure: IndexingPressure): void {
    this._pressure = pressure
    this._orchestrator?.setMemoryPressure(pressure)
    this._documentService?.setMemoryPressure(pressure)
  }

  private async ensureCache(): Promise<CacheManager | undefined> {
    if (this._cacheManager) return this._cacheManager
    log.info("initializing indexing cache", { cacheDirectory: this.cacheDirectory })
    this._cacheManager = new CacheManager(this.cacheDirectory, this.workspacePath)
    await this._cacheManager.initialize()
    if (this._disposed) return
    log.info("indexing cache initialized", { cacheDirectory: this.cacheDirectory })
    return this._cacheManager
  }

  public initialize(input: IndexingConfigInput): Promise<{ requiresRestart: boolean }> {
    return this.enqueue(() => this.init(input))
  }

  private async init(input: IndexingConfigInput): Promise<{ requiresRestart: boolean }> {
    if (this._disposed) return { requiresRestart: false }

    if (!this._configManager) {
      this._configManager = new CodeIndexConfigManager(input)
      log.info("created indexing config manager", { workspacePath: this.workspacePath })
    }

    const { requiresRestart, requiresServiceRecreation, requiresIndexRebuild } =
      this._configManager.loadConfiguration(input)
    log.info("loaded indexing configuration", {
      workspacePath: this.workspacePath,
      featureEnabled: this.isFeatureEnabled,
      featureConfigured: this.isFeatureConfigured,
      requiresRestart,
      requiresServiceRecreation,
      requiresIndexRebuild,
      provider: this._configManager.currentEmbedderProvider,
      vectorStore: this._configManager.getConfig().vectorStoreProvider,
    })

    if (!this.workspacePath) {
      log.info("indexing unavailable: no workspace path")
      this._stateManager.setSystemState("Standby", "No workspace folder open")
      return { requiresRestart }
    }

    await this.ensureCache()
    if (this._disposed) return { requiresRestart }

    if (!this.isFeatureEnabled || !this.isFeatureConfigured) {
      const generation = await this.nextGeneration()
      if (!this.current(generation)) return { requiresRestart }
      const reason = this.isFeatureEnabled ? "indexing-not-configured" : "indexing-disabled"
      const msg = this.isFeatureEnabled
        ? "RAG indexing is not configured. Code Graph is available."
        : "RAG indexing is disabled. Code Graph is available."
      log.info("starting code graph without RAG indexing", {
        workspacePath: this.workspacePath,
        reason,
        provider: this._configManager.currentEmbedderProvider,
      })
      await this._recreateGraphServices(reason, generation)
      if (!this.current(generation)) {
        this._orchestrator?.cancelIndexing()
        return { requiresRestart }
      }
      this._codeGraph.start("code-graph-default-enabled")
      this._stateManager.setSystemState("Standby", msg)
      const scan = this._orchestrator?.startIndexing("background")
      await this.configureDocuments("background", { after: scan, generation })
      return { requiresRestart }
    }

    const needsServiceRecreation = !this._serviceFactory || requiresServiceRecreation || Boolean(this._fallbackStore)
    log.info("evaluated indexing service lifecycle", {
      needsServiceRecreation,
      requiresRestart,
      requiresServiceRecreation,
      requiresIndexRebuild,
      hasServiceFactory: !!this._serviceFactory,
    })

    if (needsServiceRecreation) {
      try {
        const graphReady = this.graphScanState() === "complete"
        const generation = await this.nextGeneration()
        if (!this.current(generation)) return { requiresRestart }
        log.info("recreating indexing services", { workspacePath: this.workspacePath })
        await this._recreateServices(undefined, generation)
        if (!this.current(generation)) {
          this._orchestrator?.cancelIndexing()
          return { requiresRestart }
        }
        log.info("indexing services recreated", { workspacePath: this.workspacePath })
        if (this.baselinePath && !this._baselineStore) {
          await this.waitWithGraph(generation, "background")
          return { requiresRestart }
        }
        this._codeGraph.start(
          graphReady ? "indexing-services-recreated-code-graph-preserved" : "indexing-services-initialized",
        )
        this.emitStart("background")
        const scan = graphReady
          ? (this._orchestrator?.startRagIndexing("background", "service-recreation") ?? Promise.resolve())
          : (this._orchestrator?.startIndexing("background") ?? Promise.resolve())
        await this.configureDocuments("background", { after: scan, generation })
        return { requiresRestart }
      } catch (err) {
        log.error("failed to recreate services", { err })
        this.emitError("manager:initialize", err, "background")
        await this.graphFallback(err, "background", "rag-validation-failed")
        return { requiresRestart }
      }
    }

    if (this.waiting()) return { requiresRestart }

    const shouldStartOrRestart =
      requiresServiceRecreation ||
      this.graphScanState() !== "complete" ||
      this._orchestrator?.state === "Standby" ||
      this._orchestrator?.state === "Error" ||
      (needsServiceRecreation && (!this._orchestrator || this._orchestrator.state !== "Indexing"))

    if (shouldStartOrRestart && !this._disposed) {
      const generation = await this.nextGeneration()
      if (!this.current(generation)) return { requiresRestart }
      log.info("starting background indexing", {
        workspacePath: this.workspacePath,
        requiresRestart,
        orchestratorState: this._orchestrator?.state,
      })
      this.emitStart("background")
      // Fire and forget — indexing is a long-running background process
      const scan = this._orchestrator?.startIndexing("background") ?? Promise.resolve()
      await this.configureDocuments("background", { after: scan, generation })
      return { requiresRestart }
    }

    if (this._orchestrator?.state === "Indexing") {
      const generation = await this.nextGeneration()
      if (!this.current(generation)) return { requiresRestart }
      const scan = this._orchestrator.startIndexing("background")
      await this.configureDocuments("background", { after: scan, generation })
      return { requiresRestart }
    }

    await this.configureDocuments("background")
    return { requiresRestart }
  }

  public startIndexing(): Promise<void> {
    return this.enqueue(() => this.start())
  }

  private async start(): Promise<void> {
    if (this._disposed) return

    await this.refresh()
    if (this.waiting()) return

    log.info("manual indexing start requested", { workspacePath: this.workspacePath })

    const currentStatus = this.getCurrentStatus()
    if (currentStatus.systemStatus === "Error") {
      log.info("recovering from indexing error state before restart", {
        workspacePath: this.workspacePath,
        message: currentStatus.message,
      })
      this.resetRetryState()
      await this.recover("manual")
      return
    }

    if (!this._orchestrator) return

    if (this.isFeatureEnabled && this.isFeatureConfigured) this.assertInitialized()
    if (this.isFeatureEnabled && this.isFeatureConfigured) this.emitStart("manual")
    log.info("delegating manual indexing start to orchestrator", { workspacePath: this.workspacePath })
    const generation = await this.nextGeneration()
    if (!this.current(generation)) return
    const scan = this._orchestrator!.startIndexing("manual")
    await this.configureDocuments("manual", { after: scan, generation, wait: true })
  }

  public stopWatcher(): void {
    this._orchestrator?.stopWatcher()
  }

  public cancelIndexing(): void {
    this._generation += 1
    void this.stopDocuments()
    this._orchestrator?.cancelIndexing()
  }

  public updateBatchSegmentThreshold(newThreshold: number): void {
    this._orchestrator?.updateBatchSegmentThreshold(newThreshold)
  }

  public async recoverFromError(trigger: IndexingTelemetryTrigger = "background"): Promise<void> {
    if (this._disposed) return
    if (this._retryTask) {
      await this._retryTask
      return
    }

    const task = this.enqueue(() => this.recover(trigger)).finally(() => {
      this._retryTask = undefined
      this._isRecoveringFromError = false
      this.clearRetryTimer()
    })
    this._retryTask = task
    await task
  }

  private async recover(trigger: IndexingTelemetryTrigger): Promise<void> {
    const attempt = this._retryAttempt + 1
    if (attempt > this._retryMaxAttempts) {
      log.warn("indexing recovery skipped: retry budget exhausted", {
        workspacePath: this.workspacePath,
        attempts: this._retryAttempt,
        maxAttempts: this._retryMaxAttempts,
      })
      return
    }
    await this.runRecovery(trigger, attempt)
  }

  public async dispose(): Promise<void> {
    if (this._disposed) return
    this._disposed = true
    this._generation += 1
    this.clearRetryTimer()
    this.clearBaselineRetry()
    this._retryTask = undefined
    await Promise.all([
      this._orchestrator?.shutdown?.(),
      this._baselineStore?.close?.(),
      this._fallbackStore?.close?.(),
      this.stopDocuments(),
    ])
    this._codeGraph.dispose("manager-disposed")
    this._stateManager.dispose()
    this._telemetry.dispose()
  }

  public checkpoint(): Promise<void> {
    return this._cacheManager?.checkpoint(true) ?? Promise.resolve()
  }

  public clearIndexData(): Promise<void> {
    return this.enqueue(() => this.clear())
  }

  private async clear(): Promise<void> {
    if (!this._orchestrator || !this._cacheManager) return
    const generation = await this.nextGeneration()
    if (!this.current(generation)) return
    await this._orchestrator!.clearIndexData()
    await this._cacheManager!.clearCacheFile()
    await this._graphStorage.clear()
    await this._postingsStorage.clear()
    if (!this.current(generation)) return
    this._codeGraph.start("index-data-cleared")
    const scan = this._orchestrator.startIndexing("manual")
    await this.configureDocuments("manual", { after: scan, force: true, generation, wait: true })
  }

  public clearErrorState(): void {
    this._stateManager.setSystemState("Standby", "")
  }

  public getCurrentStatus() {
    const status = this._stateManager.getCurrentStatus()
    return { ...status, workspacePath: this.workspacePath }
  }

  public getCodeGraphStatus(): CodeGraphSidecarStatus {
    if (this._disposed) return this._codeGraph.status()
    if (!this._configManager) {
      return disabledCodeGraphSidecarStatus({
        workspacePath: this.workspacePath,
        reason: "indexing-not-initialized",
      })
    }
    return this._codeGraph.status()
  }

  public getCodeGraphProgress() {
    return this._stateManager.getCodeGraphProgress()
  }

  public getDocumentStatus(): DocumentIndexStatus {
    if (this._documentGate) return this._documentGate
    if (this._documentService) return this._documentService.getStatus()
    if (!this._configManager) return documentDisabled("Document RAG is not initialized.")
    const cfg = this._configManager.currentDocuments
    if (!cfg.enabled) return documentDisabled("Document RAG disabled.")
    if (!this.isFeatureEnabled) return documentDisabled("Document RAG disabled because Code RAG is disabled.")
    if (!this.isFeatureConfigured) return documentStandby("Document RAG blocked: embeddings are not configured.")
    return documentStandby("Document RAG starting.")
  }

  public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    if (!this.isFeatureEnabled || !this.isFeatureConfigured) return []
    await this.refreshBaseline()
    if (this.waiting()) return []
    this.assertInitialized()
    const results = await this._searchService!.searchIndex(query, directoryPrefix)
    const token = query.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) return results

    try {
      const max = this._configManager!.currentSearchMaxResults
      const hits = await this._postingsStorage.search(token, {
        directoryPrefix,
        maxResults: Math.max(max, Math.min(max * 16, 1000)),
      })
      const exact = hits
        .filter(
          (item) =>
            item.displayName === token &&
            item.fields.some((field) => field === "symbol" || field === "macro" || field === "type"),
        )
        .sort((left, right) => {
          const body = (item: (typeof hits)[number]) => Number(item.shortSnippet?.includes("{ ... }") ?? false)
          return body(right) - body(left) || right.score - left.score
        })
      if (!exact.length) return results

      const points = await Promise.all(
        exact.map(async (item) => {
          const file = path.join(this.workspacePath, item.filePath)
          const text = await readFile(file, "utf8").catch((err) => {
            log.warn("failed to read exact symbol source", { workspacePath: this.workspacePath, file, err })
            return item.shortSnippet ?? item.displayName
          })
          const lines = text.split(/\r?\n/)
          const chunk = lines.slice(Math.max(0, item.startLine - 1), item.endLine).join("\n")
          return {
            id: `codegraph:${item.filePath}:${item.startLine}:${item.endLine}:${item.displayName}`,
            score: Math.max(results[0]?.score ?? 0, 1),
            payload: {
              filePath: item.filePath,
              codeChunk: chunk || item.shortSnippet || item.displayName,
              startLine: item.startLine,
              endLine: item.endLine,
              source: "codegraph",
            },
          } satisfies VectorStoreSearchResult
        }),
      )
      const merged = new Map<string, VectorStoreSearchResult>()
      const key = (item: VectorStoreSearchResult) =>
        [item.payload?.filePath, item.payload?.startLine, item.payload?.endLine].join("\0")
      for (const item of points) merged.set(key(item), item)
      for (const item of results) if (!merged.has(key(item))) merged.set(key(item), item)
      return [...merged.values()].slice(0, max)
    } catch (err) {
      log.warn("failed to merge exact symbol evidence into semantic search", {
        workspacePath: this.workspacePath,
        query: token,
        err,
      })
      return results
    }
  }

  public async searchDocuments(query: string, options: DocumentSearchOptions = {}): Promise<DocumentSearchResult[]> {
    if (!this._documentService) return []
    return this._documentService.search(query, options)
  }

  public rebuildDocuments(): Promise<void> {
    return this.enqueue(() => this.rebuild())
  }

  private async rebuild(): Promise<void> {
    if (this.graphScanState() !== "complete" || this.getCurrentStatus().systemStatus !== "Indexed") {
      await this.start()
      return
    }
    const generation = await this.nextGeneration()
    if (!this.current(generation)) return
    await this.configureDocuments("manual", { start: false, generation })
    if (!this._documentService) return
    this._stateManager.setActivePipeline("documents")
    await this._documentService.rebuild("manual")
    if (!this.current(generation)) return
    this._stateManager.setActivePipeline(undefined)
    this._stateManager.notify()
  }

  public async queryEvidence(query: string, options: CodeGraphEvidenceQueryOptions = {}): Promise<QueryEvidenceResult> {
    return this._analysisService.queryEvidence(query, options, {
      reason: this.evidenceReason(),
    })
  }

  private evidenceReason(): string {
    if (!this._configManager) return "indexing-not-initialized"
    if (this._codeGraph.status().enabled) return "phase-0-stub"
    if (!this.isFeatureEnabled) return "indexing-disabled"
    if (!this.isFeatureConfigured) return "indexing-not-configured"
    if (!this._orchestrator || !this._searchService || !this._cacheManager) return "indexing-not-initialized"
    return "phase-0-stub"
  }

  private async _recreateGraphServices(reason: string, generation = this._generation): Promise<void> {
    log.info("starting code graph service recreation", { workspacePath: this.workspacePath, reason })
    const previous = this._orchestrator
    const store = this._baselineStore
    const fallback = this._fallbackStore
    previous?.stopWatcher()
    this._codeGraph.stop("code-graph-services-recreating")

    const loaded = await loadIgnoreWithFingerprint(this.workspacePath)
    const ignoreInstance = loaded.ignore
    const factory = new CodeIndexServiceFactory(
      this._configManager!,
      this.workspacePath,
      this._cacheManager!,
      this.cacheDirectory,
      loaded.fingerprint,
      (event) => this.handleTelemetry(event),
      this._graphStorage,
      this._postingsStorage,
    )

    const { scanner, fileWatcher, ragMeta } = factory.createGraphServices(this._cacheManager!, ignoreInstance)
    const orchestrator = new CodeIndexOrchestrator(
      this._configManager!,
      this._stateManager,
      this.workspacePath,
      this._cacheManager!,
      undefined,
      scanner,
      fileWatcher,
      this.cacheDirectory,
      ragMeta,
      (event) => this.handleTelemetry(event),
    )
    orchestrator.setMemoryPressure(this._pressure)
    try {
      await previous?.shutdown?.()
      await store?.close?.()
      await fallback?.close?.()
    } catch (err) {
      await orchestrator.shutdown()
      throw err
    }
    if (!this.current(generation)) {
      await orchestrator.shutdown()
      if (this._orchestrator === previous) this._orchestrator = undefined
      this._serviceFactory = undefined
      this._searchService = undefined
      if (this._baselineStore === store) this._baselineStore = undefined
      if (this._fallbackStore === fallback) this._fallbackStore = undefined
      return
    }

    this._serviceFactory = factory
    this._runtime = undefined
    this._orchestrator = orchestrator
    this._searchService = undefined
    this._baselineStore = undefined
    this._fallbackStore = undefined
    this._baselineSignature = undefined
    this._baselineStamp = undefined
    this._overlay = undefined
    this._stateManager.setSystemState("Standby", "")
    log.info("code graph services are ready", { workspacePath: this.workspacePath, reason })
  }

  private refreshBaseline(): Promise<void> {
    return this.enqueue(() => this.refresh())
  }

  private async refresh(): Promise<void> {
    if (!this.baselinePath || this._disposed) return
    if (this._baselineRefresh) return this._baselineRefresh
    const now = Date.now()
    if (now - this._baselineChecked < BASELINE_CHECK_INTERVAL) return
    this._baselineChecked = now
    const baselinePath = this.baselinePath

    const task = (async () => {
      const cache = new CacheManager(this.cacheDirectory, baselinePath)
      const stamp = await cache.stamp()
      const force = now - this._baselineSigned >= BASELINE_SIGNATURE_INTERVAL
      if (!force && stamp === this._baselineStamp) return

      await cache.initialize()
      const signature = cache.signature()
      this._baselineStamp = stamp
      this._baselineSigned = now
      if (signature === this._baselineSignature && this._baselineStore) return

      const baseline = await this.createBaseline(this._serviceFactory!, this._runtime)
      this._baselineStamp = baseline?.stamp ?? stamp
      this._baselineSigned = now
      if (!baseline?.store) {
        if (!this._baselineStore) this._baselineSignature = signature
        this.waiting()
        return
      }

      this.resetBaselineRetry()
      log.info("shared indexing baseline changed; rebuilding worktree delta", {
        workspacePath: this.workspacePath,
        baselinePath,
      })
      const generation = await this.nextGeneration()
      if (!this.current(generation)) return
      await this._recreateServices(baseline, generation)
      if (!this.current(generation)) return
      this._codeGraph.start("worktree-baseline-ready")
      this.emitStart("background")
      const scan = this._orchestrator?.startIndexing("background")
      await this.configureDocuments("background", { after: scan, generation })
    })().finally(() => {
      this._baselineRefresh = undefined
    })
    this._baselineRefresh = task
    return task
  }

  private async createBaseline(
    factory: CodeIndexServiceFactory,
    runtime?: PreparedEmbeddingRuntime,
  ): Promise<Baseline | undefined> {
    if (!this.baselinePath) return

    const cache = new CacheManager(this.cacheDirectory, this.baselinePath)
    await cache.initialize()
    const signature = cache.signature()
    const stamp = await cache.stamp()
    const hashes = new Map<string, string>()
    for (const [filePath, hash] of Object.entries(cache.getAllHashes())) {
      const rel = path.relative(this.baselinePath, filePath)
      if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue
      hashes.set(rel.replaceAll("\\", "/"), hash)
    }

    const store = factory.createVectorStore(this.baselinePath, runtime?.profile)
    try {
      if (!store.openExisting) throw new Error("The configured vector store cannot open a shared baseline")
      // Validate compatibility without keeping every worktree baseline connection open.
      await store.openExisting()
      await store.close?.()
      return {
        store,
        signature,
        stamp,
        overlay: new WorktreeOverlay(this.workspacePath, this.baselinePath, hashes),
      }
    } catch (err) {
      await store.close?.()
      log.info("shared indexing baseline is unavailable; waiting for the primary worktree index", {
        workspacePath: this.workspacePath,
        baselinePath: this.baselinePath,
        err,
      })
      return { signature, stamp }
    }
  }

  private async _recreateServices(prepared?: Baseline, generation = this._generation): Promise<void> {
    log.info("starting indexing service recreation", { workspacePath: this.workspacePath })
    const previous = this._orchestrator
    const store = this._baselineStore
    const fallback = this._fallbackStore

    const loaded = await loadIgnoreWithFingerprint(this.workspacePath)
    const ignoreInstance = loaded.ignore
    const factory = new CodeIndexServiceFactory(
      this._configManager!,
      this.workspacePath,
      this._cacheManager!,
      this.cacheDirectory,
      loaded.fingerprint,
      (event) => this.handleTelemetry(event),
      this._graphStorage,
      this._postingsStorage,
    )
    const config = this._configManager!.getConfig()
    const runtime = factory.usesAdaptiveEmbedding() ? await factory.prepareEmbeddingRuntime() : undefined
    const baseline = prepared ?? (await this.createBaseline(factory, runtime))
    const { embedder, vectorStore, scanner, fileWatcher, ragMeta } = factory.createServices(
      this._cacheManager!,
      ignoreInstance,
      runtime,
    )
    fileWatcher.setOverlay?.(baseline?.overlay)
    log.info("created indexing services", {
      workspacePath: this.workspacePath,
      provider: embedder.embedderInfo.name,
      vectorStore: config.vectorStoreProvider,
      model: config.modelId ?? "default",
    })

    let validated = runtime !== undefined
    if (previous && !validated) {
      log.info("validating replacement embedder before service swap", {
        workspacePath: this.workspacePath,
        provider: embedder.embedderInfo.name,
      })
      const result = await factory.validateEmbedder(embedder)
      if (!result.valid) {
        const model = config.modelId ?? "default"
        const dimension = config.modelDimension ?? "default"
        throw new Error(
          `Embedder validation failed (provider=${embedder.embedderInfo.name}, model=${model}, dimensions=${dimension}): ${
            result.error || "configuration validation returned no error message"
          }`,
        )
      }
      validated = true
      this.clearErrors("rag")
    }

    const orchestrator = new CodeIndexOrchestrator(
      this._configManager!,
      this._stateManager,
      this.workspacePath,
      this._cacheManager!,
      vectorStore,
      scanner,
      fileWatcher,
      this.cacheDirectory,
      ragMeta,
      (event) => this.handleTelemetry(event),
      baseline?.overlay,
      async () => {
        if (validated) return
        log.info("validating embedder configuration at RAG boundary", {
          workspacePath: this.workspacePath,
          provider: embedder.embedderInfo.name,
        })
        const result = await factory.validateEmbedder(embedder)
        if (!result.valid) {
          const model = config.modelId ?? "default"
          const dimension = config.modelDimension ?? "default"
          throw new Error(
            `Embedder validation failed (provider=${embedder.embedderInfo.name}, model=${model}, dimensions=${dimension}): ${
              result.error || "configuration validation returned no error message"
            }`,
          )
        }
        validated = true
        this.clearErrors("rag")
      },
    )
    const search = new CodeIndexSearchService(
      this._configManager!,
      this._stateManager,
      embedder,
      vectorStore,
      baseline?.store && baseline.overlay ? { store: baseline.store, overlay: baseline.overlay } : undefined,
    )
    orchestrator.setMemoryPressure(this._pressure)

    previous?.stopWatcher()
    this._codeGraph.stop("indexing-services-recreating")
    try {
      await previous?.shutdown?.()
      await store?.close?.()
      await fallback?.close?.()
    } catch (err) {
      await orchestrator.shutdown()
      await baseline?.store?.close?.()
      throw err
    }
    if (!this.current(generation)) {
      await orchestrator.shutdown()
      await baseline?.store?.close?.()
      if (this._orchestrator === previous) this._orchestrator = undefined
      this._serviceFactory = undefined
      this._searchService = undefined
      if (this._baselineStore === store) this._baselineStore = undefined
      if (this._fallbackStore === fallback) this._fallbackStore = undefined
      return
    }

    this._serviceFactory = factory
    this._runtime = runtime
    this._orchestrator = orchestrator
    this._searchService = search
    this._baselineStore = baseline?.store
    this._fallbackStore = undefined
    this._baselineSignature = baseline?.signature
    this._baselineStamp = baseline?.stamp
    this._baselineSigned = Date.now()
    this._overlay = baseline?.overlay
    this._stateManager.setSystemState("Standby", "")
    log.info("indexing services are ready", { workspacePath: this.workspacePath })
  }

  private async configureDocuments(
    trigger: IndexingTelemetryTrigger,
    opts: {
      start?: boolean
      force?: boolean
      after?: Promise<IndexingRunOutcome | void>
      generation?: number
      wait?: boolean
    } = {},
  ): Promise<void> {
    const generation = opts.generation ?? (await this.nextGeneration())
    if (!this.current(generation)) return
    if (!this._configManager) return
    const cfg = this._configManager.currentDocuments
    if (!cfg) return
    if (!cfg.enabled) {
      await this.stopDocuments()
      if (!this.current(generation)) return
      this._documentGate = undefined
      this._stateManager.notify()
      return
    }

    if (!this.isFeatureEnabled) {
      await this.stopDocuments()
      if (!this.current(generation)) return
      this._documentGate = documentDisabled("Document RAG disabled because Code RAG is disabled.")
      this._stateManager.notify()
      return
    }

    await this.ensureCache()
    if (!this.current(generation)) return

    if (!this.isFeatureConfigured) {
      await this.stopDocuments()
      if (!this.current(generation)) return
      this._documentGate = documentStandby("Document RAG blocked: embeddings are not configured.")
      this._stateManager.notify()
      return
    }

    const loaded = await loadIgnoreWithFingerprint(this.workspacePath)
    if (!this.current(generation)) return
    const factory = new CodeIndexServiceFactory(
      this._configManager,
      this.workspacePath,
      this._cacheManager!,
      this.cacheDirectory,
      loaded.fingerprint,
      (event) => this.handleTelemetry(event),
      this._graphStorage,
      this._postingsStorage,
    )
    const runtime =
      this._runtime ?? (factory.usesAdaptiveEmbedding() ? await factory.prepareEmbeddingRuntime() : undefined)
    const next = factory.createDocumentService(loaded.ignore, () => this._stateManager.notify(), runtime)
    next.setMemoryPressure(this._pressure)
    await this.stopDocuments()
    if (!this.current(generation)) {
      await next.dispose()
      return
    }
    if (!this._serviceFactory) this._serviceFactory = factory
    if (!this._runtime) this._runtime = runtime
    this._documentService = next
    this._documentGate = opts.after
      ? documentStandby("Document RAG waiting for Code Graph and Code RAG to finish.")
      : undefined
    this._stateManager.notify()

    if (opts.start === false) return
    const start = async () => {
      const outcome = await opts.after?.catch((err) => {
        log.warn("preceding code indexing failed; keeping Document RAG blocked", {
          workspacePath: this.workspacePath,
          err,
        })
        return { state: "failed", pipeline: "rag" } as const
      })
      if (!this.current(generation)) return
      if (outcome && outcome.state !== "completed") {
        this._documentGate = documentStandby(
          `Document RAG blocked because ${outcome.pipeline === "codeGraph" ? "Code Graph" : "Code RAG"} did not complete.`,
        )
        this._stateManager.setActivePipeline(undefined)
        this._stateManager.notify()
        return
      }
      this._documentGate = undefined
      this._stateManager.setActivePipeline("documents")
      await next.start(trigger, opts.force === true)
      if (!this.current(generation)) return
      this._stateManager.setActivePipeline(undefined)
      this._stateManager.notify()
    }
    const task = start().catch((err) => {
      if (!this.current(generation)) return
      log.error("failed to start document indexing", { err })
      this.emitError("documents:start", err, trigger, "documents")
      this._documentGate = documentError(err instanceof Error ? err.message : String(err))
      this._stateManager.setActivePipeline(undefined)
      this._stateManager.notify()
    })
    if (opts.wait) await task
    else void task
  }

  public handleSettingsChange(input: IndexingConfigInput): Promise<void> {
    return this.enqueue(() => this.settings(input))
  }

  private async settings(input: IndexingConfigInput): Promise<void> {
    if (!this._configManager) return

    this.resetBaselineRetry()
    const documents = JSON.stringify(this._configManager.currentDocuments)
    const { requiresRestart, requiresServiceRecreation, requiresIndexRebuild } =
      this._configManager.loadConfiguration(input)
    const documentsChanged = documents !== JSON.stringify(this._configManager.currentDocuments)
    log.info("processed indexing settings change", {
      workspacePath: this.workspacePath,
      featureEnabled: this.isFeatureEnabled,
      featureConfigured: this.isFeatureConfigured,
      requiresRestart,
      requiresServiceRecreation,
      requiresIndexRebuild,
      documentsChanged,
    })

    if (!requiresServiceRecreation && !documentsChanged) {
      log.info("indexing settings change does not require a lifecycle update", {
        workspacePath: this.workspacePath,
      })
      return
    }

    if (!requiresServiceRecreation && documentsChanged) {
      if (this._fallbackStore) {
        log.info("document settings remain unapplied while the desired embedding profile is invalid", {
          workspacePath: this.workspacePath,
        })
        return
      }
      const generation = await this.nextGeneration()
      if (!this.current(generation)) return
      const ready = this.graphScanState() === "complete" && this.getCurrentStatus().systemStatus === "Indexed"
      if (ready) {
        await this.configureDocuments("background", { force: true, generation })
        return
      }

      this._codeGraph.start("document-settings-waiting-for-index")
      const scan = this._orchestrator?.startIndexing("background")
      await this.configureDocuments("background", { force: true, after: scan, generation })
      return
    }

    if (!this.isFeatureEnabled || !this.isFeatureConfigured) {
      const generation = await this.nextGeneration()
      if (!this.current(generation)) return
      const reason = this.isFeatureEnabled ? "indexing-not-configured" : "indexing-disabled"
      await this.ensureCache()
      if (this._disposed) return
      await this._recreateGraphServices(reason, generation)
      if (!this.current(generation)) return
      this._codeGraph.start("code-graph-default-enabled")
      this._stateManager.setSystemState(
        "Standby",
        this.isFeatureEnabled
          ? "RAG indexing is not configured. Code Graph is available."
          : "RAG indexing is disabled. Code Graph is available.",
      )
      const scan = this._orchestrator?.startIndexing("background")
      await this.configureDocuments("background", { after: scan, generation })
      return
    }

    if (requiresServiceRecreation && this.isFeatureEnabled && this.isFeatureConfigured) {
      try {
        const graphReady = this.graphScanState() === "complete"
        const generation = await this.nextGeneration(false)
        if (!this.current(generation)) return
        if (!this._cacheManager) {
          this._cacheManager = new CacheManager(this.cacheDirectory, this.workspacePath)
          await this._cacheManager.initialize()
        }
        log.info("recreating RAG services for indexing settings change", {
          workspacePath: this.workspacePath,
          ragOnly: graphReady,
          codeGraphPreserved: true,
          reason: graphReady ? "completed Code Graph can be reused" : "Code Graph is incomplete",
        })
        await this._recreateServices(undefined, generation)
        if (!this.current(generation)) return
        if (this.baselinePath && !this._baselineStore) {
          await this.waitWithGraph(generation, "background")
          return
        }
        this._codeGraph.start(graphReady ? "rag-settings-updated-code-graph-preserved" : "rag-settings-updated")
        this.emitStart("background")
        const scan = graphReady
          ? this._orchestrator?.startRagIndexing("background", "settings-change")
          : this._orchestrator?.startIndexing("background")
        await this.configureDocuments("background", {
          force: requiresIndexRebuild || documentsChanged,
          after: scan,
          generation,
        })
      } catch (err) {
        log.error("failed to recreate services on settings change", { err })
        this.emitError("manager:settings", err, "background", "rag")
        const meta = this.getTelemetryMeta()
        if (meta) {
          this.recordError({
            ...meta,
            type: "error",
            source: "scan",
            location: "manager:settings",
            trigger: "background",
            pipeline: "rag",
            error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
          })
        }
        if (this._orchestrator && this._searchService) {
          const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err))
          this._stateManager.upsertNotice({
            id: "embedding-config-unapplied",
            level: "warning",
            message: `Embedding 配置未应用：${message}。已继续使用上一版有效索引。`,
            action: "openIndexingOutput",
          })
          this._stateManager.setSystemState(
            "Indexed",
            `Embedding 配置未应用：${message}。正在使用已验证的上一版向量索引。`,
          )
          this._stateManager.setActivePipeline(undefined)
          return
        }
        await this.graphFallback(err, "background", "rag-settings-unapplied")
      }
      return
    }
  }
}

function trimDiagnostic(message: string, max = MAX_DIAGNOSTIC_MESSAGE_LENGTH): string {
  const text = message.replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}

function nonRetryableEmbeddingFailure(message: string): boolean {
  return (
    /authentication failed/i.test(message) ||
    /HTTP 40[134]\b/i.test(message) ||
    /embedding service rejected the request \(HTTP 40[134]\)/i.test(message)
  )
}

function errorPipelines(
  event: Extract<IndexingTelemetryEvent, { type: "error" }>,
): Array<keyof IndexingPipelineRecentErrors> {
  if (event.pipeline) return [event.pipeline]
  const location = event.location.toLowerCase()
  if (location.includes("document")) return ["documents"]
  if (location.includes("graph") || location.includes("posting")) return ["codeGraph"]
  if (
    location.includes("batch") ||
    location.includes("upsert") ||
    location.includes("vector") ||
    location.includes("lancedb")
  ) {
    return ["rag"]
  }
  return ["codeGraph", "rag"]
}

function documentDisabled(message: string): DocumentIndexStatus {
  return {
    state: "Disabled",
    message,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    detail: message,
    errorCount: 0,
    staleCount: 0,
    skippedCount: 0,
  }
}

function documentStandby(message: string): DocumentIndexStatus {
  return {
    ...documentDisabled(message),
    state: "Standby",
  }
}

function documentError(message: string): DocumentIndexStatus {
  return {
    ...documentDisabled(message),
    state: "Error",
    errorCount: 1,
  }
}
