import type { VectorStoreSearchResult } from "./interfaces"
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
import { INITIAL_MANAGER_RECOVERY_DELAY_MS, MAX_MANAGER_RECOVERY_ATTEMPTS } from "./constants"
import { CodeIndexStateManager } from "./state-manager"
import { CodeIndexServiceFactory } from "./service-factory"
import { CodeIndexSearchService } from "./search-service"
import { CodeIndexAnalysisService } from "./analysis"
import { CodeGraphSidecarLifecycle, disabledCodeGraphSidecarStatus } from "./codegraph"
import { CodeGraphJsonStorage, CodePostingsJsonStorage } from "./codegraph/storage"
import { CodeIndexOrchestrator } from "./orchestrator"
import { CacheManager } from "./cache-manager"
import { Emitter } from "./runtime"
import { Log } from "../util/log"
import { loadIgnoreWithFingerprint } from "./shared/load-ignore"
import { sanitizeErrorMessage } from "./shared/validation-helpers"
import type { IndexingDiagnostic, IndexingPipelineRecentErrors } from "../status"
import type { IndexingPressure } from "./memory"

const log = Log.create({ service: "indexing-manager" })
const MAX_RECENT_ERRORS = 5
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 500
const MAX_DIAGNOSTIC_FILE_LENGTH = 300

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
  private _orchestrator: CodeIndexOrchestrator | undefined
  private _searchService: CodeIndexSearchService | undefined
  private _documentService: DocumentIndexService | undefined
  private _documentToken = 0
  private _pressure: IndexingPressure = "normal"
  private readonly _analysisService: CodeIndexAnalysisService
  private readonly _graphStorage: CodeGraphJsonStorage
  private readonly _postingsStorage: CodePostingsJsonStorage
  private readonly _codeGraph: CodeGraphSidecarLifecycle
  private _cacheManager: CacheManager | undefined
  private _isRecoveringFromError = false
  private _retryTimer: ReturnType<typeof setTimeout> | undefined
  private _retryResolve: (() => void) | undefined
  private _retryTask: Promise<void> | undefined
  private _retryAttempt = 0
  private _retryMaxAttempts = MAX_MANAGER_RECOVERY_ATTEMPTS
  private _retryInitialDelayMs = INITIAL_MANAGER_RECOVERY_DELAY_MS
  private _disposed = false
  private readonly _recentErrors: IndexingPipelineRecentErrors = {}

  constructor(
    public readonly workspacePath: string,
    private readonly cacheDirectory: string,
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
      vectorStore: cfg.vectorStoreProvider ?? "lancedb",
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
    if (event.location !== "orchestrator:startIndexing") return
    if (!this.isFeatureEnabled || !this.isFeatureConfigured) return
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
      await this._recreateServices()
      if (this._disposed) return
      this.emitStart(trigger)
      await this._orchestrator!.startIndexing(trigger)
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
    try {
      this.assertInitialized()
      return true
    } catch (e) {
      log.warn(`CodeIndexManager not initialized: ${e}`)
      return false
    }
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

  public async initialize(input: IndexingConfigInput): Promise<{ requiresRestart: boolean }> {
    if (this._disposed) return { requiresRestart: false }

    if (!this._configManager) {
      this._configManager = new CodeIndexConfigManager(input)
      log.info("created indexing config manager", { workspacePath: this.workspacePath })
    }

    const { requiresRestart } = this._configManager.loadConfiguration(input)
    log.info("loaded indexing configuration", {
      workspacePath: this.workspacePath,
      featureEnabled: this.isFeatureEnabled,
      featureConfigured: this.isFeatureConfigured,
      requiresRestart,
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
      const reason = this.isFeatureEnabled ? "indexing-not-configured" : "indexing-disabled"
      const msg = this.isFeatureEnabled
        ? "RAG indexing is not configured. Code Graph is available."
        : "RAG indexing is disabled. Code Graph is available."
      log.info("starting code graph without RAG indexing", {
        workspacePath: this.workspacePath,
        reason,
        provider: this._configManager.currentEmbedderProvider,
      })
      await this._recreateGraphServices(reason)
      if (this._disposed) {
        this._orchestrator?.cancelIndexing()
        this._orchestrator = undefined
        this._searchService = undefined
        return { requiresRestart }
      }
      this._codeGraph.start("code-graph-default-enabled")
      this._stateManager.setSystemState("Standby", msg)
      const scan = this._orchestrator?.startIndexing("background") ?? Promise.resolve()
      await this.configureDocuments("background", { after: scan })
      return { requiresRestart }
    }

    const needsServiceRecreation = !this._serviceFactory || requiresRestart
    log.info("evaluated indexing service lifecycle", {
      needsServiceRecreation,
      requiresRestart,
      hasServiceFactory: !!this._serviceFactory,
    })

    if (needsServiceRecreation) {
      try {
        log.info("recreating indexing services", { workspacePath: this.workspacePath })
        await this._recreateServices()
        if (this._disposed) {
          this._orchestrator?.cancelIndexing()
          this._orchestrator = undefined
          this._searchService = undefined
          return { requiresRestart }
        }
        log.info("indexing services recreated", { workspacePath: this.workspacePath })
        this._codeGraph.start("indexing-services-initialized")
      } catch (err) {
        log.error("failed to recreate services", { err })
        this.emitError("manager:initialize", err, "background")
        this._stateManager.setSystemState(
          "Error",
          `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        )
        throw err
      }
    }

    const shouldStartOrRestart =
      requiresRestart || (needsServiceRecreation && (!this._orchestrator || this._orchestrator.state !== "Indexing"))

    if (shouldStartOrRestart && !this._disposed) {
      log.info("starting background indexing", {
        workspacePath: this.workspacePath,
        requiresRestart,
        orchestratorState: this._orchestrator?.state,
      })
      this.emitStart("background")
      // Fire and forget — indexing is a long-running background process
      const scan = this._orchestrator?.startIndexing("background") ?? Promise.resolve()
      await this.configureDocuments("background", { after: scan })
      return { requiresRestart }
    }

    await this.configureDocuments("background")
    return { requiresRestart }
  }

  public async startIndexing(): Promise<void> {
    if (this._disposed) return

    log.info("manual indexing start requested", { workspacePath: this.workspacePath })

    const currentStatus = this.getCurrentStatus()
    if (currentStatus.systemStatus === "Error") {
      log.info("recovering from indexing error state before restart", {
        workspacePath: this.workspacePath,
        message: currentStatus.message,
      })
      this.resetRetryState()
      await this.recoverFromError("manual")
      return
    }

    if (!this._orchestrator) return

    if (this.isFeatureEnabled && this.isFeatureConfigured) this.assertInitialized()
    if (this.isFeatureEnabled && this.isFeatureConfigured) this.emitStart("manual")
    log.info("delegating manual indexing start to orchestrator", { workspacePath: this.workspacePath })
    await this._orchestrator!.startIndexing("manual")
  }

  public stopWatcher(): void {
    this._orchestrator?.stopWatcher()
  }

  public cancelIndexing(): void {
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

    const attempt = this._retryAttempt + 1
    if (attempt > this._retryMaxAttempts) {
      log.warn("indexing recovery skipped: retry budget exhausted", {
        workspacePath: this.workspacePath,
        attempts: this._retryAttempt,
        maxAttempts: this._retryMaxAttempts,
      })
      return
    }

    const task = this.runRecovery(trigger, attempt).finally(() => {
      this._retryTask = undefined
      this._isRecoveringFromError = false
      this.clearRetryTimer()
    })
    this._retryTask = task
    await task
  }

  public dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.clearRetryTimer()
    this._retryTask = undefined
    // RATIONALE: cancelIndexing() sets _cancelRequested and calls stopWatcher() +
    // scanner.cancel(), which cooperatively aborts any in-flight scan. Using only
    // stopWatcher() left the orchestrator's _runScan() unaware it should exit.
    this._orchestrator?.cancelIndexing()
    this._documentService?.dispose()
    this._codeGraph.dispose("manager-disposed")
    this._stateManager.dispose()
    this._telemetry.dispose()
  }

  public checkpoint(): Promise<void> {
    return this._cacheManager?.checkpoint(true) ?? Promise.resolve()
  }

  public async clearIndexData(): Promise<void> {
    if (!this._orchestrator || !this._cacheManager) return
    await this._orchestrator!.clearIndexData()
    await this._cacheManager!.clearCacheFile()
    await this._graphStorage.clear()
    await this._postingsStorage.clear()
    await this._documentService?.rebuild("manual")
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
    if (this._documentService) return this._documentService.getStatus()
    if (!this._configManager) return documentDisabled("Document RAG is not initialized.")
    const cfg = this._configManager.currentDocuments
    if (!cfg.enabled) return documentDisabled("Document RAG disabled.")
    if (cfg.paths.length === 0) return documentStandby("No document folders configured.")
    if (!this.isFeatureConfigured) return documentError("Document RAG requires configured embeddings.")
    return documentStandby("Document RAG starting.")
  }

  public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    if (!this.isFeatureEnabled || !this.isFeatureConfigured) return []
    this.assertInitialized()
    return this._searchService!.searchIndex(query, directoryPrefix)
  }

  public async searchDocuments(query: string, options: DocumentSearchOptions = {}): Promise<DocumentSearchResult[]> {
    if (!this._documentService) return []
    return this._documentService.search(query, options)
  }

  public async rebuildDocuments(): Promise<void> {
    await this.configureDocuments("manual", { start: false })
    if (!this._documentService) return
    await this._documentService.rebuild("manual")
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

  private async _recreateGraphServices(reason: string): Promise<void> {
    log.info("starting code graph service recreation", { workspacePath: this.workspacePath, reason })
    this._orchestrator?.stopWatcher()
    this._orchestrator = undefined
    this._searchService = undefined
    this._codeGraph.stop("code-graph-services-recreating")

    const loaded = await loadIgnoreWithFingerprint(this.workspacePath)
    const ignoreInstance = loaded.ignore
    this._serviceFactory = new CodeIndexServiceFactory(
      this._configManager!,
      this.workspacePath,
      this._cacheManager!,
      this.cacheDirectory,
      loaded.fingerprint,
      (event) => this.handleTelemetry(event),
      this._graphStorage,
      this._postingsStorage,
    )

    const { scanner, fileWatcher, ragMeta } = this._serviceFactory.createGraphServices(
      this._cacheManager!,
      ignoreInstance,
    )
    this._orchestrator = new CodeIndexOrchestrator(
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
    this._orchestrator.setMemoryPressure(this._pressure)
    this._stateManager.setSystemState("Standby", "")
    log.info("code graph services are ready", { workspacePath: this.workspacePath, reason })
  }

  private async _recreateServices(): Promise<void> {
    log.info("starting indexing service recreation", { workspacePath: this.workspacePath })
    this._orchestrator?.stopWatcher()
    this._orchestrator = undefined
    this._searchService = undefined
    this._codeGraph.stop("indexing-services-recreating")

    const loaded = await loadIgnoreWithFingerprint(this.workspacePath)
    const ignoreInstance = loaded.ignore
    this._serviceFactory = new CodeIndexServiceFactory(
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
    const { embedder, vectorStore, scanner, fileWatcher, ragMeta } = this._serviceFactory.createServices(
      this._cacheManager!,
      ignoreInstance,
    )
    log.info("created indexing services", {
      workspacePath: this.workspacePath,
      provider: embedder.embedderInfo.name,
      vectorStore: config.vectorStoreProvider,
      model: config.modelId ?? "default",
    })

    const shouldValidate = embedder && embedder.embedderInfo.name === config.embedderProvider

    if (shouldValidate) {
      log.info("validating embedder configuration", {
        workspacePath: this.workspacePath,
        provider: embedder.embedderInfo.name,
      })
      const validationResult = await this._serviceFactory.validateEmbedder(embedder)
      if (!validationResult.valid) {
        const errorMessage = validationResult.error || "Embedder configuration validation failed"
        this._stateManager.setSystemState("Error", errorMessage)
        throw new Error(errorMessage)
      }
      log.info("embedder configuration validated", {
        workspacePath: this.workspacePath,
        provider: embedder.embedderInfo.name,
      })
    }

    this._orchestrator = new CodeIndexOrchestrator(
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
    )
    this._orchestrator.setMemoryPressure(this._pressure)

    this._searchService = new CodeIndexSearchService(this._configManager!, this._stateManager, embedder, vectorStore)

    this._stateManager.setSystemState("Standby", "")
    log.info("indexing services are ready", { workspacePath: this.workspacePath })
  }

  private async configureDocuments(
    trigger: IndexingTelemetryTrigger,
    opts: { start?: boolean; force?: boolean; after?: Promise<unknown> } = {},
  ): Promise<void> {
    const token = ++this._documentToken
    if (!this._configManager) return
    const cfg = this._configManager.currentDocuments
    if (!cfg.enabled) {
      this._documentService?.dispose()
      this._documentService = undefined
      this._stateManager.notify()
      return
    }

    await this.ensureCache()
    if (this._disposed) return

    if (!this.isFeatureConfigured) {
      this._documentService?.dispose()
      this._documentService = undefined
      this._stateManager.notify()
      return
    }

    const loaded = await loadIgnoreWithFingerprint(this.workspacePath)
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
    if (!this._serviceFactory) this._serviceFactory = factory

    const next = factory.createDocumentService(loaded.ignore, () => this._stateManager.notify())
    next.setMemoryPressure(this._pressure)
    this._documentService?.dispose()
    this._documentService = next
    this._stateManager.notify()

    if (opts.start === false) return
    const start = async () => {
      if (this._disposed || token !== this._documentToken) return
      await next.start(trigger, opts.force === true)
    }
    const task = opts.after ? opts.after.then(start) : start()
    void task.catch((err) => {
      log.error("failed to start document indexing", { err })
      this.emitError("documents:start", err, trigger, "documents")
      this._stateManager.notify()
    })
  }

  public async handleSettingsChange(input: IndexingConfigInput): Promise<void> {
    if (!this._configManager) return

    const { requiresRestart } = this._configManager.loadConfiguration(input)
    log.info("processed indexing settings change", {
      workspacePath: this.workspacePath,
      featureEnabled: this.isFeatureEnabled,
      featureConfigured: this.isFeatureConfigured,
      requiresRestart,
    })

    if (!this.isFeatureEnabled || !this.isFeatureConfigured) {
      const reason = this.isFeatureEnabled ? "indexing-not-configured" : "indexing-disabled"
      await this.ensureCache()
      if (this._disposed) return
      await this._recreateGraphServices(reason)
      this._codeGraph.start("code-graph-default-enabled")
      this._stateManager.setSystemState(
        "Standby",
        this.isFeatureEnabled
          ? "RAG indexing is not configured. Code Graph is available."
          : "RAG indexing is disabled. Code Graph is available.",
      )
      const scan = this._orchestrator?.startIndexing("background") ?? Promise.resolve()
      await this.configureDocuments("background", { after: scan })
      return
    }

    if (requiresRestart && this.isFeatureEnabled && this.isFeatureConfigured) {
      try {
        if (!this._cacheManager) {
          this._cacheManager = new CacheManager(this.cacheDirectory, this.workspacePath)
          await this._cacheManager.initialize()
        }
        log.info("recreating RAG services for indexing settings change", {
          workspacePath: this.workspacePath,
          ragOnly: true,
          codeGraphPreserved: true,
        })
        await this._recreateServices()
        if (this._disposed) return
        this._codeGraph.start("rag-settings-updated")
        this.emitStart("background")
        const scan =
          this._orchestrator?.startRagIndexing("background", "settings-change").catch((err) => {
            log.error("failed to start RAG-only indexing after settings change", { err })
            this.emitError("manager:handleSettingsChange", err, "background")
          }) ?? Promise.resolve()
        await this.configureDocuments("background", { force: true, after: scan })
      } catch (err) {
        log.error("failed to recreate services on settings change", { err })
        throw err
      }
      return
    }

    await this.configureDocuments("background", { force: true })
  }
}

function trimDiagnostic(message: string, max = MAX_DIAGNOSTIC_MESSAGE_LENGTH): string {
  const text = message.replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
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
