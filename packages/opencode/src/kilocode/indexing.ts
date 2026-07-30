import z from "zod"
import path from "path"
import {
  CodeIndexAnalysisService,
  CodeIndexConfigManager,
  disabledCodeGraphSidecarStatus,
  type CodeGraphEvidenceQueryOptions,
  type CodeGraphSidecarStatus,
  type DocumentSearchOptions,
  type DocumentSearchResult,
  type IndexingTelemetryEvent,
  type QueryEvidenceResult,
  type VectorStoreSearchResult,
} from "@kilocode/kilo-indexing/engine"
import { Effect, Schema } from "effect"
import { toIndexingConfigInput, type IndexingConfig } from "@kilocode/kilo-indexing/config"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import {
  IndexingStatus,
  disabledIndexingStatus,
  type IndexingDiagnostic,
  type IndexingPipelineStatus,
} from "@kilocode/kilo-indexing/status"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { fetchKiloEmbeddingModelCatalog } from "@kilocode/kilo-gateway"
import { Instance } from "@/kilocode/instance"
import { Bus } from "@/bus"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Auth } from "@/auth"
import { makeRuntime } from "@/effect/run-service"
import { registerDisposer } from "@/effect/instance-registry"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import type { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Event as IndexingEvent, Warning as IndexingWarningEvent } from "./indexing-event"
import { indexingWarningKey, type IndexingWarning } from "./indexing-warning"
import { IndexingWorker } from "./indexing-worker-client"
import { LanceDBRuntime } from "./lancedb" // kilocode_change
import { indexingWithKiloDefault, resolveKiloIndexingAuth, type KiloIndexingAuth } from "./indexing-auth" // kilocode_change
import { applyInternalIndexingDefaults } from "./internal-offline" // kilocode_change
import { MemoryDebug } from "./memory-debug"
import { memoryExit } from "./indexing-memory"
import { worktreeRoots } from "./primary-worktree"

const log = Log.create({ service: "kilocode-indexing" })
const auth = makeRuntime(Auth.Service, Auth.defaultLayer)
const UNKNOWN_INITIALIZATION_ERROR = "Unknown indexing initialization error"
const missing = () => disabledIndexingStatus("Indexing plugin is not enabled for this workspace.")

function disabledByEnvironment(reason: string) {
  const detail = sanitizeDiagnosticMessage(reason) || "true"
  return disabledIndexingStatus(`Codebase indexing is disabled by KILO_DISABLE_CODEBASE_INDEXING (reason: ${detail}).`)
}

function disableReason(): string | undefined {
  const value = process.env["KILO_DISABLE_CODEBASE_INDEXING"]?.trim()
  if (!value || ["0", "false", "off", "no"].includes(value.toLowerCase())) return undefined
  return value
}

function emptyWorkspace(dir: string): boolean {
  const value = process.env["KILO_VSCODE_EMPTY_WORKSPACE_DIR"]?.trim()
  if (!value) return false
  return path.resolve(value) === path.resolve(dir)
}

function resolveConfig(config?: IndexingConfig, global?: IndexingConfig) {
  if (!config && !global) return applyInternalIndexingDefaults(undefined)

  const merged: IndexingConfig = {
    ...global,
    ...config,
    enabled: config?.enabled ?? global?.enabled,
  }
  const keys = [
    "documents",
    "kilo",
    "openai",
    "ollama",
    "openai-compatible",
    "gemini",
    "mistral",
    "vercel-ai-gateway",
    "bedrock",
    "openrouter",
    "voyage",
    "qdrant",
    "lancedb",
  ] as const
  for (const key of keys) {
    const parent = global?.[key]
    const child = config?.[key]
    if (!parent && !child) continue
    Object.assign(merged, { [key]: { ...parent, ...child } })
  }
  if (merged.documents) {
    merged.documents = {
      ...merged.documents,
      approvedExternalRoots: global?.documents?.approvedExternalRoots,
    }
  }
  return applyInternalIndexingDefaults(merged)
}

export const IndexingModelError = NamedError.create("IndexingModelError", {
  model: Schema.String,
})

async function inputFromConfig(cfg: Config.Info): Promise<ReturnType<typeof toIndexingConfigInput>> {
  const auth = await kiloAuth(cfg)
  const globalConfig = await AppRuntime.runPromise(Config.Service.use((svc) => svc.getGlobal()))
  const global = globalConfig.indexing
  const merged = indexingWithKiloDefault(resolveConfig(cfg.indexing, global), auth)
  const raw = toIndexingConfigInput({
    ...merged,
    enabled: merged?.enabled === true,
  })
  return model(enrichKilo(raw, auth), auth)
}
const baselineDirectory = Effect.fn("KiloIndexing.baselineDirectory")(function* (dir: string) {
  const directory = path.resolve(dir)
  const roots = yield* worktreeRoots(directory)
  if (!roots) {
    return {
      kind: "standalone" as const,
      checkout: undefined,
      primary: undefined,
      directory: undefined,
    }
  }
  if (roots.checkout === roots.primary) {
    return {
      kind: "primary" as const,
      checkout: roots.checkout,
      primary: roots.primary,
      directory: undefined,
    }
  }

  const scope = path.relative(roots.checkout, directory)
  const outside = scope === ".." || scope.startsWith(`..${path.sep}`) || path.isAbsolute(scope)
  if (outside) {
    return {
      kind: "linked" as const,
      checkout: roots.checkout,
      primary: roots.primary,
      directory: undefined,
    }
  }

  const baseline = path.resolve(roots.primary, scope)
  if (baseline === directory) {
    return {
      kind: "linked" as const,
      checkout: roots.checkout,
      primary: roots.primary,
      directory: undefined,
    }
  }
  return { kind: "linked" as const, checkout: roots.checkout, primary: roots.primary, directory: baseline }
})

export function failed(
  err: unknown,
  source = "indexing",
  location = "indexing:initialize",
): z.infer<typeof IndexingStatus> {
  const diagnosticItem = diagnostic(source, location, err)
  const message = IndexingModelError.isInstance(err)
    ? `Invalid indexing.model "${err.data.model}"`
    : diagnosticItem.message
  const item = { ...diagnosticItem, message }
  const text = message.startsWith("Failed to initialize:") ? message : `Failed to initialize: ${message}`

  return {
    state: "Error",
    message: text,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    pipelines: {
      codeGraph: inactivePipeline("Error", "Code Graph unavailable.", text, [item]),
      rag: inactivePipeline("Error", "RAG indexing unavailable.", text, [item]),
      documents: inactivePipeline("Error", "Document RAG unavailable.", text, [item]),
    },
  }
}

function pending(): z.infer<typeof IndexingStatus> {
  return {
    state: "In Progress",
    message: "Indexing is initializing.",
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    pipelines: {
      codeGraph: inactivePipeline("In Progress", "Code Graph initializing.", "Waiting for indexing worker."),
      rag: inactivePipeline("In Progress", "RAG indexing initializing.", "Waiting for indexing worker."),
      documents: inactivePipeline("In Progress", "Document RAG initializing.", "Waiting for indexing worker."),
    },
  }
}

function recovering(current: z.infer<typeof IndexingStatus>, err: unknown): z.infer<typeof IndexingStatus> {
  const item = diagnostic("worker", "worker:memory-recovery", err)
  const message = "Indexing worker is restarting in low-memory mode. Existing committed indexes remain available."
  const pipelines = current.pipelines ?? pending().pipelines!
  const pipeline = (value: IndexingPipelineStatus): IndexingPipelineStatus => {
    if (value.state === "Disabled" || value.state === "Complete") return value
    return {
      ...value,
      state: "In Progress",
      message,
      detail: item.message,
      recentErrors: [item, ...(value.recentErrors ?? [])].slice(0, 5),
    }
  }
  return {
    ...current,
    state: "In Progress",
    message,
    pipelines: {
      codeGraph: pipeline(pipelines.codeGraph),
      rag: pipeline(pipelines.rag),
      documents: pipeline(pipelines.documents),
    },
  }
}

function inactivePipeline(
  state: IndexingPipelineStatus["state"],
  message: string,
  detail: string,
  recentErrors?: IndexingDiagnostic[],
): IndexingPipelineStatus {
  return {
    state,
    message,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    detail,
    errorCount: state === "Error" ? 1 : 0,
    staleCount: 0,
    skippedCount: 0,
    recentErrors,
  }
}

export function diagnostic(source: string, location: string, err: unknown): IndexingDiagnostic {
  const msg = diagnosticMessage(err)
  const message = sanitizeDiagnosticMessage(msg) || UNKNOWN_INITIALIZATION_ERROR
  return {
    time: new Date().toISOString(),
    source,
    location,
    message,
    ...(extractDiagnosticFile(msg) ? { file: extractDiagnosticFile(msg) } : {}),
  }
}

function diagnosticMessage(err: unknown, seen = new Set<object>()): string {
  if (typeof err === "string") return err
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") return String(err)
  if (!err) return UNKNOWN_INITIALIZATION_ERROR

  if (err instanceof Error) {
    if (seen.has(err)) return UNKNOWN_INITIALIZATION_ERROR
    seen.add(err)
    const message = err.message.trim()
    if (message) return message
    if (err.cause) {
      const cause = diagnosticMessage(err.cause, seen).trim()
      if (cause) return cause
    }
    const stack = err.stack
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && line !== "Error" && line !== err.name)
    if (stack) return stack
    return err.name && err.name !== "Error" ? err.name : UNKNOWN_INITIALIZATION_ERROR
  }

  if (typeof err !== "object") return String(err)
  if (seen.has(err)) return UNKNOWN_INITIALIZATION_ERROR
  seen.add(err)

  const obj = err as Record<string, unknown>
  const keyed = ["message", "error", "reason", "detail", "data"]
    .map((key) => diagnosticMessage(obj[key], seen).trim())
    .find((value) => value && value !== UNKNOWN_INITIALIZATION_ERROR)
  if (keyed) return keyed

  const json = safeJson(err)
  return json && json !== "{}" ? json : UNKNOWN_INITIALIZATION_ERROR
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch (err) {
    log.warn("failed to stringify indexing diagnostic error", { err })
    return undefined
  }
}

function sanitizeDiagnosticMessage(message: string): string {
  const redacted = message
    .replace(/(?:https?|ftp|file):\/\/[^\s)"']+/gi, "[REDACTED_URL]")
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, "[REDACTED_EMAIL]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")
    .replace(/\b(?:api[_-]?key|token|password|authorization)\b\s*[=:]\s*["']?[^"',\s)]+/gi, "$1=[REDACTED]")
    .replace(/"[^"]*(?:\/|\\)[^"]*"/g, '"[REDACTED_PATH]"')
    .replace(/(?:\/[\w.-]+)+(?:\/[\w.\-\s]*)*|(?:[A-Za-z]:\\[\w.\-\\\s]+)/g, "[REDACTED_PATH]")
    .replace(/\s+/g, " ")
    .trim()

  if (redacted.length <= 500) return redacted
  return `${redacted.slice(0, 497)}...`
}

function extractDiagnosticFile(message: string): string | undefined {
  const match = message.match(/(?:^|[,(]\s*File:\s*)([^,)]+)/i)
  return match?.[1]?.trim()
}

async function kiloAuth(cfg: Config.Info): Promise<KiloIndexingAuth> {
  const info = await auth.runPromise((svc) => svc.get("kilo"))
  return resolveKiloIndexingAuth({ config: cfg, auth: info })
}

function enrichKilo(input: ReturnType<typeof toIndexingConfigInput>, auth: KiloIndexingAuth) {
  if (input.embedderProvider !== "kilo") return input

  return {
    ...input,
    kiloApiKey: input.kiloApiKey ?? auth.apiKey,
    kiloBaseUrl: input.kiloBaseUrl ?? auth.baseUrl,
    kiloOrganizationId: input.kiloOrganizationId ?? auth.organizationId,
  }
}

async function model(input: ReturnType<typeof toIndexingConfigInput>, auth: KiloIndexingAuth) {
  if (input.embedderProvider !== "kilo" || !input.enabled) return input

  const catalog = await fetchKiloEmbeddingModelCatalog({ baseURL: auth.baseUrl, token: auth.apiKey })

  if (input.modelId) {
    const id = catalog.aliases[input.modelId] ?? input.modelId
    const chosen = catalog.models.find((item) => item.id === id)
    if (catalog.models.length > 0 && !chosen) {
      throw new IndexingModelError({ model: input.modelId })
    }
    if (chosen) {
      return {
        ...input,
        modelId: chosen.id,
        modelDimension: chosen.dimension,
        searchMinScore: input.searchMinScore ?? chosen.scoreThreshold,
      }
    }
  }

  const fallback = catalog.aliases[catalog.defaultModel] ?? catalog.defaultModel
  const found = catalog.models.find((item) => item.id === fallback)
  if (!found) {
    if (input.modelId || input.modelDimension) {
      log.warn("ignoring unsupported Kilo embedding model configuration", { model: input.modelId })
    }
    return { ...input, modelId: undefined, modelDimension: undefined }
  }

  return {
    ...input,
    modelId: found.id,
    modelDimension: found.dimension,
    searchMinScore: input.searchMinScore ?? found.scoreThreshold,
  }
}

function trackTelemetry(event: IndexingTelemetryEvent): void {
  if (event.type === "started") {
    Telemetry.trackIndexingStarted({
      trigger: event.trigger,
      source: event.source,
      mode: event.mode,
      provider: event.provider,
      vectorStore: event.vectorStore,
      modelId: event.modelId,
    })
    return
  }

  if (event.type === "completed") {
    Telemetry.trackIndexingCompleted({
      trigger: event.trigger,
      source: event.source,
      mode: event.mode,
      provider: event.provider,
      vectorStore: event.vectorStore,
      modelId: event.modelId,
      filesIndexed: event.filesIndexed,
      filesDiscovered: event.filesDiscovered,
      totalBlocks: event.totalBlocks,
      batchErrors: event.batchErrors,
    })
    return
  }

  if (event.type === "file_count") {
    Telemetry.trackIndexingFileCount({
      source: event.source,
      mode: event.mode,
      provider: event.provider,
      vectorStore: event.vectorStore,
      modelId: event.modelId,
      discovered: event.discovered,
      candidate: event.candidate,
    })
    return
  }

  if (event.type === "batch_retry") {
    Telemetry.trackIndexingBatchRetry({
      source: event.source,
      mode: event.mode,
      provider: event.provider,
      vectorStore: event.vectorStore,
      modelId: event.modelId,
      attempt: event.attempt,
      maxRetries: event.maxRetries,
      batchSize: event.batchSize,
      error: event.error,
    })
    return
  }

  Telemetry.trackIndexingError({
    source: event.source,
    trigger: event.trigger,
    mode: event.mode,
    provider: event.provider,
    vectorStore: event.vectorStore,
    modelId: event.modelId,
    location: event.location,
    error: event.error,
    retryCount: event.retryCount,
    maxRetries: event.maxRetries,
  })
}

function needsVectorRuntime(cfg: CodeIndexConfigManager): boolean {
  const info = cfg.getConfig()
  const docs = info.documents?.enabled === true
  return info.vectorStoreProvider === "lancedb" && cfg.isFeatureConfigured && (cfg.isFeatureEnabled || docs)
}

export namespace KiloIndexing {
  export const Status = IndexingStatus
  export type Status = z.infer<typeof Status>

  export function input(config?: IndexingConfig, global?: IndexingConfig) {
    const merged = resolveConfig(config, global)
    return toIndexingConfigInput({
      ...merged,
      enabled: merged?.enabled === true,
    })
  }

  type Entry = {
    engine?: IndexingWorker.Driver
    initialized?: boolean
    current(): Status
    warnings(): IndexingWarning[]
    scope(workspace: WorkspaceV2.ID | undefined): void
    publish(): Promise<void>
    dispose(): Promise<void>
    refreshConfig?(): Promise<void>
  }

  type Cache = {
    promise: Promise<Entry>
    ready: Promise<Entry>
    resolve(entry: Entry): void
    reject(err: unknown): void
    entry?: Entry
    disposed?: boolean
  }

  export const Event = IndexingEvent
  export const Warning = IndexingWarningEvent

  const cache = new Map<string, Cache>()

  function track(hit: Cache, entry: Entry) {
    if (!hit.entry) hit.resolve(entry)
    hit.entry = entry
    if (hit.disposed) void entry.dispose()
    return entry
  }

  const boot = async (hit: Cache): Promise<Entry> => {
    const ctx = Instance.current
    const bind =
      <Args extends unknown[], Result>(fn: (...args: Args) => Result) =>
      (...args: Args): Result =>
        Instance.restore(ctx, () => fn(...args))
    const dir = Instance.directory
    void MemoryDebug.event({ name: "indexing.boot.begin", data: { workspace: MemoryDebug.hash(dir) } })
    const worktree = emptyWorkspace(dir)
      ? {
          kind: "standalone" as const,
          checkout: undefined,
          primary: undefined,
          directory: undefined,
        }
      : await AppRuntime.runPromise(baselineDirectory(dir))
    const baseline = worktree.directory

    log.info("initializing project indexing", {
      workspacePath: dir,
      worktreeClassification: worktree.kind,
      checkoutPath: worktree.checkout,
      primaryPath: worktree.primary,
      baselineDirectory: baseline,
    })
    const root = path.join(Global.Path.state, "indexing")
    const workspaces = new Set<WorkspaceV2.ID | undefined>([WorkspaceContext.workspaceID])
    const box = { status: pending() }
    const warnings = new Map<string, IndexingWarning>()
    const delivery = {
      last: undefined as Status | undefined,
      task: Promise.resolve(),
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      time: 0,
    }
    const current = () => box.status
    let disposed = false
    let refreshTask: Promise<void> | undefined
    let revision = 0
    let applied = 0
    let serial = 0
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined
    let recoveryAttempt = 0
    let forcedLow = false
    let base: Entry

    const same = (left: Status | undefined, right: Status) =>
      left !== undefined && JSON.stringify(left) === JSON.stringify(right)
    const report = bind((next: Status = current()) => {
      delivery.task = delivery.task
        .then(async () => {
          if (disposed || same(delivery.last, next)) return
          await Bus.publish(Instance.current, Event, { status: next })
          delivery.last = next
        })
        .catch((err) => {
          log.error("failed to publish indexing status", { err })
        })
      return delivery.task
    })
    const clear = () => {
      if (!delivery.timer) return
      clearTimeout(delivery.timer)
      delivery.timer = undefined
    }
    const status = bind((next: Status) => {
      if (disposed) return
      serial += 1
      const previous = current()
      box.status = next
      if (next.state === "Complete") recoveryAttempt = 0
      if (same(previous, next)) return
      const immediate = previous.state !== next.state || next.state !== "In Progress"
      if (immediate) {
        clear()
        delivery.time = Date.now()
        void report(next)
        return
      }
      if (delivery.timer) return
      const delay = Math.max(0, 250 - (Date.now() - delivery.time))
      if (delay === 0) {
        delivery.time = Date.now()
        void report(next)
        return
      }
      delivery.timer = setTimeout(
        bind(() => {
          delivery.timer = undefined
          delivery.time = Date.now()
          void report()
        }),
        delay,
      )
    })
    const telemetry = bind((event: IndexingTelemetryEvent) => {
      if (disposed) return
      trackTelemetry(event)
    })
    const scheduleRecovery = bind(() => {
      if (disposed || recoveryTimer) return
      const delays = [1_000, 2_000, 5_000, 10_000, 30_000]
      const delay = delays[Math.min(recoveryAttempt, delays.length - 1)]!
      recoveryAttempt += 1
      recoveryTimer = setTimeout(() => {
        recoveryTimer = undefined
        void refresh()
      }, delay)
    })
    const failure = bind((err: unknown) => {
      if (disposed) return
      base.initialized = false
      const msg = err instanceof Error ? err.message : String(err)
      if (memoryExit(null, msg)) {
        forcedLow = true
        base.engine = undefined
        box.status = recovering(box.status, err)
        log.warn("project indexing worker is recovering from memory pressure", {
          err,
          workspacePath: dir,
          attempt: recoveryAttempt + 1,
        })
        void report()
        scheduleRecovery()
        return
      }
      box.status = failed(err, "worker", "worker:failure")
      log.error("project indexing worker failed", { err, workspacePath: dir })
      void report()
    })
    const suspend = bind(async (next: Status) => {
      const engine = base.engine
      base.engine = undefined
      base.initialized = false
      await engine?.dispose().catch((err) => {
        log.warn("failed to dispose inactive project indexing worker", { err, workspacePath: dir })
      })
      box.status = next
      await report()
    })
    const apply = bind(async () => {
      try {
        const nextConfig = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
        const reason = disableReason()
        if (reason) {
          await suspend(disabledByEnvironment(reason))
          return
        }
        if (emptyWorkspace(dir)) {
          await suspend(disabledIndexingStatus("Indexing is waiting for a workspace folder."))
          return
        }
        if (!hasIndexingPlugin(nextConfig.plugin)) {
          await suspend(missing())
          return
        }

        const nextInput = await inputFromConfig(nextConfig)
        const nextRag = new CodeIndexConfigManager(nextInput)
        if (needsVectorRuntime(nextRag)) await LanceDBRuntime.ensure(nextRag.getConfig().vectorStoreProvider)
        const stamp = serial
        const next = await (async () => {
          if (base.engine) return base.engine.updateConfig(nextInput)

          const engine = IndexingWorker.create(
            dir,
            root,
            { status, telemetry, warning, log: output, failure },
            { forcedLow },
          )
          base.engine = engine
          return engine.init(nextInput, baseline)
        })()
        const regressed = serial !== stamp && current().state !== "In Progress" && next.state === "In Progress"
        if (!regressed) status(next)
        base.initialized = true
        await report()
      } catch (err) {
        if (IndexingModelError.isInstance(err)) log.warn("indexing model resolution failed", { err })
        const engine = base.engine
        base.engine = undefined
        base.initialized = false
        await engine?.dispose().catch((disposeErr) => {
          log.warn("failed to dispose failed project indexing worker", { err: disposeErr, workspacePath: dir })
        })
        failure(err)
      }
    })
    const drain = bind(async () => {
      while (!disposed && applied < revision) {
        const target = revision
        await apply()
        applied = target
      }
    })
    const refresh = bind(async () => {
      if (disposed) return
      revision += 1
      while (!disposed && applied < revision) {
        if (!refreshTask) {
          const task = drain()
          refreshTask = task
          try {
            await task
          } finally {
            if (refreshTask === task) refreshTask = undefined
          }
          continue
        }
        await refreshTask
      }
    })
    const onConfig = (event: GlobalEvent) => {
      if (disposed) return
      if (event.payload?.type !== "global.config.updated") return
      if (event.directory && event.directory !== "global" && event.directory !== dir) return
      void refresh()
    }
    const warning = bind((item: IndexingWarning) => {
      if (disposed) return
      const key = indexingWarningKey(item)
      if (warnings.has(key)) return
      warnings.set(key, item)
      void Promise.all(
        [...workspaces].map((workspaceID) =>
          WorkspaceContext.provide({
            workspaceID,
            fn: () => Bus.publish(Instance.current, Warning, item),
          }),
        ),
      ).catch((err) => {
        log.error("failed to publish indexing warning", { err, workspacePath: dir })
      })
    })
    const output = bind((event: Parameters<IndexingWorker.Hooks["log"]>[0]) => {
      if (disposed) return
      log[event.level](event.message, { source: "worker", workspacePath: dir })
    })
    base = {
      current,
      refreshConfig: refresh,
      warnings: () => [...warnings.values()],
      scope: (workspaceID) => workspaces.add(workspaceID),
      publish: () => report(),
      async dispose() {
        if (disposed) return
        disposed = true
        if (recoveryTimer) clearTimeout(recoveryTimer)
        recoveryTimer = undefined
        void MemoryDebug.event({ name: "indexing.dispose.begin", data: { workspace: MemoryDebug.hash(dir) } })
        GlobalBus.off("event", onConfig)
        clear()
        base.initialized = false
        await base.engine?.dispose().catch((err) => {
          log.warn("failed to dispose project indexing worker", { err, workspacePath: dir })
        })
        void MemoryDebug.event({ name: "indexing.dispose.end", data: { workspace: MemoryDebug.hash(dir) } })
      },
    }
    GlobalBus.on("event", onConfig)
    track(hit, base)
    await report()

    if (hit.disposed) return base

    await refresh()
    if (hit.disposed) return base

    log.info("project indexing initialized", {
      workspacePath: dir,
      state: current().state,
    })
    await report()

    return base
  }

  const hit = () => {
    const dir = Instance.directory
    const existing = cache.get(dir)
    if (existing) return existing

    const gate = Promise.withResolvers<Entry>()
    const next = {
      ready: gate.promise,
      resolve: gate.resolve,
      reject: gate.reject,
    } as Cache
    next.promise = boot(next)
      .then(async (entry) => {
        if (next.disposed) {
          await entry.dispose()
          return entry
        }
        next.entry = entry
        return entry
      })
      .catch((err) => {
        next.reject(err)
        if (cache.get(dir) === next) cache.delete(dir)
        throw err
      })
    cache.set(dir, next)
    return next
  }

  registerDisposer(async (dir) => {
    const hit = cache.get(dir)
    cache.delete(dir)
    if (hit) hit.disposed = true
    if (hit?.entry) {
      await hit.entry.dispose()
      return
    }
  })

  export async function init() {
    const current = hit()
    void current.promise.catch((err) => {
      log.error("failed to initialize indexing", { err })
    })
    await current.ready
  }

  export async function current(): Promise<Status> {
    const entry = await hit().ready
    entry.scope(WorkspaceContext.workspaceID)
    return entry.current()
  }

  export async function models() {
    try {
      const cfg = await AppRuntime.runPromise(Config.Service.use((svc) => svc.getGlobal()))
      const auth = await kiloAuth(cfg)
      const catalog = await fetchKiloEmbeddingModelCatalog({ baseURL: auth.baseUrl, token: auth.apiKey })
      if (catalog.models.length > 0 || (!auth.baseUrl && !auth.apiKey)) return catalog
      const fallback = await fetchKiloEmbeddingModelCatalog()
      return fallback.models.length > 0 ? fallback : catalog
    } catch (err) {
      log.warn("falling back to public Kilo embedding model catalog", { err })
      return fetchKiloEmbeddingModelCatalog()
    }
  }

  export async function warnings(): Promise<IndexingWarning[]> {
    const entry = await hit().ready
    entry.scope(WorkspaceContext.workspaceID)
    return entry.warnings()
  }

  function rag(status: Status): boolean {
    return status.pipelines?.rag.state !== "Disabled" && status.state !== "Disabled"
  }

  function graph(status: Status): boolean {
    return status.pipelines?.codeGraph.state !== "Disabled"
  }

  function documents(status: Status): boolean {
    return status.pipelines?.documents.state !== "Disabled" && status.pipelines?.documents.state !== "Error"
  }

  export function ready(): boolean {
    const entry = cache.get(Instance.directory)?.entry
    if (!entry?.initialized) return false
    return rag(entry.current())
  }

  export function analysisReady(): boolean {
    const entry = cache.get(Instance.directory)?.entry
    if (!entry?.initialized || !entry.engine) return false
    return graph(entry.current())
  }

  export function documentReady(): boolean {
    const entry = cache.get(Instance.directory)?.entry
    if (!entry?.initialized || !entry.engine) return false
    return documents(entry.current())
  }

  export async function available(): Promise<boolean> {
    const entry = await hit().ready
    entry.scope(WorkspaceContext.workspaceID)
    if (!entry.initialized) return false
    return rag(entry.current())
  }

  export async function search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    const entry = await hit().ready
    entry.scope(WorkspaceContext.workspaceID)
    if (!entry.initialized || !rag(entry.current()) || !entry.engine) return []
    return entry.engine.search(query, directoryPrefix)
  }

  export async function searchDocuments(
    query: string,
    options: DocumentSearchOptions = {},
  ): Promise<DocumentSearchResult[]> {
    const entry = await hit().ready
    if (!entry.initialized || !documents(entry.current()) || !entry.engine) return []
    return entry.engine.documentSearch(query, options)
  }

  export async function rebuildDocuments(): Promise<Status> {
    const entry = await hit().ready
    if (!entry.initialized || !entry.engine) return entry.current()
    const status = await entry.engine.rebuildDocuments()
    await entry.publish()
    return status
  }

  export async function queryEvidence(
    query: string,
    options: CodeGraphEvidenceQueryOptions = {},
  ): Promise<QueryEvidenceResult> {
    const entry = await hit().ready
    if (!entry.initialized || !graph(entry.current()) || !entry.engine) {
      return CodeIndexAnalysisService.createStub(query, options, "indexing-not-ready")
    }
    return entry.engine.queryEvidence(query, options)
  }

  export async function codeGraphStatus(): Promise<CodeGraphSidecarStatus> {
    const entry = await hit().ready
    if (!entry.initialized || !entry.engine) {
      return disabledCodeGraphSidecarStatus({
        workspacePath: Instance.directory,
        reason: "indexing-not-active",
      })
    }
    return entry.engine.codeGraphStatus()
  }
}
