import { describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CacheManager } from "../../../src/indexing/cache-manager"
import { parseCodeGraphFile } from "../../../src/indexing/codegraph/parser"
import { CodeIndexConfigManager } from "../../../src/indexing/config-manager"
import { CodeIndexManager } from "../../../src/indexing/manager"
import { CodeIndexOrchestrator } from "../../../src/indexing/orchestrator"
import type { IndexingConfigInput } from "../../../src/indexing/config-manager"
import type { IndexingTelemetryEvent, IndexingTelemetryTrigger } from "../../../src/indexing/interfaces/telemetry"

function createInput(input: Partial<IndexingConfigInput> = {}): IndexingConfigInput {
  return {
    enabled: true,
    embedderProvider: "openai",
    vectorStoreProvider: "lancedb",
    ...input,
  }
}

let managerSequence = 0

function createManager(): CodeIndexManager {
  const root = join(tmpdir(), `chipmate-manager-unit-${process.pid}-${managerSequence++}`)
  return new CodeIndexManager(join(root, "workspace"), join(root, "cache"))
}

type Data = {
  _configManager: {
    isFeatureEnabled: boolean
    isFeatureConfigured: boolean
    getConfig(): {
      embedderProvider: "openai"
      vectorStoreProvider: "lancedb"
      modelId: string
    }
  }
  _orchestrator?: {
    state: string
    stopWatcher(): void
    startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
    startRagIndexing?(trigger: IndexingTelemetryTrigger, reason?: string): Promise<void>
  }
  _searchService?: {}
  _cacheManager: {}
  _stateManager: {
    setSystemState(state: "Standby" | "Indexing" | "Indexed" | "Error", message?: string): void
  }
  _retryTask?: Promise<void>
  _retryMaxAttempts: number
  _retryInitialDelayMs: number
  _recreateServices(): Promise<void>
  handleTelemetry(event: IndexingTelemetryEvent): void
}

function createData(mgr: CodeIndexManager): Data {
  const data = mgr as unknown as Data
  data._configManager = {
    isFeatureEnabled: true,
    isFeatureConfigured: true,
    getConfig() {
      return {
        embedderProvider: "openai",
        vectorStoreProvider: "lancedb",
        modelId: "text-embedding-3-small",
      }
    },
  }
  data._cacheManager = {}
  data._searchService = {}
  data._retryMaxAttempts = 1
  data._retryInitialDelayMs = 0
  return data
}

function createStartError(location = "orchestrator:startIndexing"): IndexingTelemetryEvent {
  return {
    type: "error",
    source: "scan",
    location,
    trigger: "background",
    error: "fail",
    provider: "openai",
    vectorStore: "lancedb",
    modelId: "text-embedding-3-small",
  }
}

describe("CodeIndexManager", () => {
  test("waits for an active Document RAG generation before starting a new scan", async () => {
    const mgr = createManager()
    const gate = Promise.withResolvers<void>()
    const events: string[] = []
    const data = createData(mgr) as Data & {
      _documentService?: { dispose(): Promise<void> }
      _orchestrator: {
        state: string
        startIndexing(): Promise<{ state: "completed"; pipeline: "rag" }>
      }
    }
    data._documentService = {
      dispose() {
        events.push("document-stop")
        return gate.promise
      },
    }
    data._orchestrator = {
      state: "Standby",
      async startIndexing() {
        events.push("scan-start")
        return { state: "completed", pipeline: "rag" }
      },
    }

    const task = mgr.startIndexing()
    await Bun.sleep(0)
    expect(events).toEqual(["document-stop"])

    gate.resolve()
    await task
    expect(events).toEqual(["document-stop", "scan-start"])
    await mgr.dispose()
  })

  test("serializes initialization and settings service recreation", async () => {
    const mgr = createManager()
    const gate = Promise.withResolvers<void>()
    const events: string[] = []
    const data = mgr as unknown as {
      _cacheManager: {}
      _serviceFactory?: {}
      _orchestrator?: {
        state: string
        startIndexing(): Promise<{ state: "completed"; pipeline: "rag" }>
      }
      _searchService?: {}
      _configManager?: CodeIndexConfigManager
      _recreateServices(): Promise<void>
    }
    let active = 0
    let peak = 0
    let calls = 0
    data._cacheManager = {}
    data._recreateServices = async () => {
      calls += 1
      const id = calls
      active += 1
      peak = Math.max(peak, active)
      events.push(`start:${id}`)
      if (id === 1) await gate.promise
      events.push(`end:${id}`)
      active -= 1
      data._serviceFactory = {}
      data._orchestrator = {
        state: "Standby",
        async startIndexing() {
          this.state = "Indexed"
          return { state: "completed", pipeline: "rag" }
        },
      }
      data._searchService = {}
    }

    const first = mgr.initialize(createInput({ openAiKey: "sk-test", modelId: "text-embedding-3-small" }))
    await Bun.sleep(0)
    const second = mgr.handleSettingsChange(createInput({ openAiKey: "sk-test", modelId: "text-embedding-ada-002" }))
    await Bun.sleep(0)

    expect(events).toEqual(["start:1"])
    expect(peak).toBe(1)
    gate.resolve()
    await Promise.all([first, second])

    expect(events).toEqual(["start:1", "end:1", "start:2", "end:2"])
    expect(peak).toBe(1)
    expect(data._configManager?.currentModelId).toBe("text-embedding-ada-002")
    await mgr.dispose()
  })

  test("does not commit services created by a cancelled generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "chipmate-manager-generation-"))
    const mgr = new CodeIndexManager(root, join(root, "cache"))
    const data = mgr as unknown as {
      _configManager: CodeIndexConfigManager
      _cacheManager: CacheManager
      _generation: number
      _orchestrator?: CodeIndexOrchestrator
      _recreateServices(prepared: undefined, generation: number): Promise<void>
    }
    data._configManager = new CodeIndexConfigManager(createInput({ openAiKey: "sk-test" }))
    data._cacheManager = new CacheManager(join(root, "cache"), root)
    await data._cacheManager.initialize()
    data._generation = 1
    const shutdown = spyOn(CodeIndexOrchestrator.prototype, "shutdown")

    try {
      const task = data._recreateServices(undefined, 1)
      mgr.cancelIndexing()
      await task

      expect(shutdown).toHaveBeenCalledTimes(1)
      expect(data._orchestrator).toBeUndefined()
    } finally {
      shutdown.mockRestore()
      await mgr.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("keeps Document RAG blocked when the preceding RAG generation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "chipmate-manager-doc-gate-"))
    const mgr = new CodeIndexManager(root, join(root, "cache"))
    const data = mgr as unknown as {
      _configManager: CodeIndexConfigManager
      _cacheManager: CacheManager
      _generation: number
      configureDocuments(
        trigger: IndexingTelemetryTrigger,
        opts: {
          after: Promise<{ state: "failed"; pipeline: "rag" }>
          generation: number
          wait: boolean
        },
      ): Promise<void>
    }
    data._configManager = new CodeIndexConfigManager(
      createInput({ openAiKey: "sk-test", documents: { enabled: true } }),
    )
    data._cacheManager = new CacheManager(join(root, "cache"), root)
    data._generation = 1

    await data.configureDocuments("background", {
      after: Promise.resolve({ state: "failed", pipeline: "rag" }),
      generation: 1,
      wait: true,
    })

    expect(mgr.getDocumentStatus()).toMatchObject({
      state: "Standby",
      message: "Document RAG blocked because Code RAG did not complete.",
    })
    expect(mgr.getDocumentStatus().lastFullScanAt).toBeUndefined()
    await mgr.dispose()
    await rm(root, { recursive: true, force: true })
  })

  test("does not start Document RAG from a stale generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "chipmate-manager-doc-generation-"))
    const mgr = new CodeIndexManager(root, join(root, "cache"))
    const gate = Promise.withResolvers<{ state: "completed"; pipeline: "rag" }>()
    const data = mgr as unknown as {
      _configManager: CodeIndexConfigManager
      _cacheManager: CacheManager
      _generation: number
      _documentService?: { getStatus(): { state: string; message: string; lastFullScanAt?: string } }
      configureDocuments(
        trigger: IndexingTelemetryTrigger,
        opts: {
          after: Promise<{ state: "completed"; pipeline: "rag" }>
          generation: number
        },
      ): Promise<void>
    }
    data._configManager = new CodeIndexConfigManager(
      createInput({ openAiKey: "sk-test", documents: { enabled: true } }),
    )
    data._cacheManager = new CacheManager(join(root, "cache"), root)
    data._generation = 1

    await data.configureDocuments("background", { after: gate.promise, generation: 1 })
    const service = data._documentService
    data._generation = 2
    gate.resolve({ state: "completed", pipeline: "rag" })
    await Bun.sleep(0)

    expect(service?.getStatus()).toMatchObject({ state: "Standby", message: "Document RAG ready." })
    expect(service?.getStatus().lastFullScanAt).toBeUndefined()
    await mgr.dispose()
    await rm(root, { recursive: true, force: true })
  })

  test("retries a waiting worktree baseline once and stops after it becomes ready", async () => {
    const mgr = new CodeIndexManager("/tmp/worktree", "/tmp/cache", "/tmp/main")
    const data = mgr as unknown as {
      _baselineInitialDelay: number
      _baselineDelay: number
      _baselineStore?: {}
      waiting(): boolean
      refreshBaseline(): Promise<void>
    }
    let refreshes = 0
    data._baselineInitialDelay = 1
    data._baselineDelay = 1
    data.refreshBaseline = async () => {
      refreshes += 1
      data._baselineStore = {}
    }

    expect(data.waiting()).toBe(true)
    expect(data.waiting()).toBe(true)
    await Bun.sleep(10)

    expect(refreshes).toBe(1)
    expect(data.waiting()).toBe(false)
    await mgr.dispose()
  })

  test("starts worktree Code Graph before waiting for the primary RAG baseline", async () => {
    const mgr = new CodeIndexManager("/tmp/worktree", "/tmp/cache", "/tmp/main")
    const events: string[] = []
    const scan = Promise.withResolvers<{ state: "completed"; pipeline: "codeGraph" }>()
    const data = mgr as unknown as {
      _generation: number
      _baselineStore?: {}
      _codeGraph: { start(reason: string): void; dispose(reason: string): void }
      _orchestrator?: {
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<{ state: "completed"; pipeline: "codeGraph" }>
      }
      _recreateGraphServices(reason: string, generation: number): Promise<void>
      configureDocuments(trigger: IndexingTelemetryTrigger, opts: { start: boolean; generation: number }): Promise<void>
      waiting(): boolean
      waitWithGraph(generation: number, trigger: IndexingTelemetryTrigger): Promise<void>
    }
    data._generation = 1
    data._recreateGraphServices = async (reason, generation) => {
      events.push(`services:${reason}:${generation}`)
      data._orchestrator = {
        startIndexing(trigger) {
          events.push(`scan:${trigger}`)
          return scan.promise
        },
      }
    }
    data._codeGraph = {
      start(reason) {
        events.push(`graph:${reason}`)
      },
      dispose() {},
    }
    data.configureDocuments = async (trigger, opts) => {
      events.push(`documents:${trigger}:${opts.start}:${opts.generation}`)
    }
    data.waiting = () => {
      events.push("baseline:waiting")
      return true
    }

    await data.waitWithGraph(1, "background")

    expect(events).toEqual([
      "services:worktree-baseline-wait:1",
      "graph:worktree-baseline-wait",
      "scan:background",
      "documents:background:false:1",
      "baseline:waiting",
    ])
    scan.resolve({ state: "completed", pipeline: "codeGraph" })
    await Bun.sleep(0)
    expect(events.at(-1)).toBe("baseline:waiting")
    await mgr.dispose()
  })

  test("backs off repeated worktree baseline checks", async () => {
    const mgr = new CodeIndexManager("/tmp/worktree", "/tmp/cache", "/tmp/main")
    const data = mgr as unknown as {
      _baselineInitialDelay: number
      _baselineDelay: number
      waiting(): boolean
      refreshBaseline(): Promise<void>
    }
    let refreshes = 0
    data._baselineInitialDelay = 10
    data._baselineDelay = 10
    data.refreshBaseline = async () => {
      refreshes += 1
    }

    expect(data.waiting()).toBe(true)
    await Bun.sleep(15)

    expect(refreshes).toBe(1)
    expect(data._baselineDelay).toBe(20)
    await mgr.dispose()
  })

  test("falls back when the shared baseline is not ready", async () => {
    const mgr = new CodeIndexManager("/tmp/worktree", "/tmp/cache", "/tmp/main")
    let closed = 0
    const data = mgr as unknown as {
      createBaseline(factory: { createVectorStore(): unknown }): Promise<{ store?: unknown }>
    }
    const baseline = await data.createBaseline({
      createVectorStore() {
        return {
          async openExisting() {
            throw new Error("baseline rebuilding")
          },
          async close() {
            closed += 1
          },
        }
      },
    })

    expect(baseline.store).toBeUndefined()
    expect(closed).toBe(1)
  })

  test("throttles unchanged baseline cache checks between searches", async () => {
    const mgr = new CodeIndexManager("/tmp/worktree", "/tmp/cache", "/tmp/main")
    const data = createData(mgr) as Data & {
      _baselineStamp: string
      _baselineSigned: number
      _orchestrator: { state: string }
      _searchService: { searchIndex(): Promise<[]> }
    }
    data._baselineStamp = "same"
    data._baselineSigned = Date.now()
    data._orchestrator = { state: "Indexed" }
    data._searchService = {
      async searchIndex() {
        return []
      },
    }
    const stamp = spyOn(CacheManager.prototype, "stamp").mockResolvedValue("same")
    const initialize = spyOn(CacheManager.prototype, "initialize").mockResolvedValue()

    try {
      await mgr.searchIndex("first")
      await mgr.searchIndex("second")
      expect(stamp).toHaveBeenCalledTimes(1)
      expect(initialize).not.toHaveBeenCalled()
    } finally {
      stamp.mockRestore()
      initialize.mockRestore()
    }
  })

  test("promotes an exact graph definition ahead of vector-only declarations", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "index-manager-exact-"))
    const cache = join(workspace, ".cache")
    const file = join(workspace, "ftl_config.c")
    const source = ["void InitFTL(void)", "{", "  const int ready = 1;", "  (void)ready;", "}", ""].join("\n")
    await Bun.write(file, source)

    const mgr = new CodeIndexManager(workspace, cache)
    const data = createData(mgr) as Data & {
      _configManager: Data["_configManager"] & { currentSearchMaxResults: number }
      _orchestrator: {
        state: string
        stopWatcher(): void
        startIndexing(): Promise<void>
      }
      _searchService: {
        searchIndex(): Promise<
          Array<{
            id: string
            score: number
            payload: {
              filePath: string
              codeChunk: string
              startLine: number
              endLine: number
            }
          }>
        >
      }
      _postingsStorage: {
        beginFullScan(): Promise<void>
        upsertFilePostings(
          filePath: string,
          fileHash: string,
          graph: ReturnType<typeof parseCodeGraphFile>,
          input: { content: string },
        ): Promise<void>
        markFullScanComplete(): Promise<void>
      }
    }
    Object.defineProperty(data._configManager, "currentSearchMaxResults", { value: 10 })
    data._orchestrator = {
      state: "Indexed",
      stopWatcher() {},
      async startIndexing() {},
    }
    data._searchService = {
      async searchIndex() {
        return [
          {
            id: "vector-header",
            score: 0.92,
            payload: {
              filePath: "ftl_config.h",
              codeChunk: "void InitFTL(void);",
              startLine: 22,
              endLine: 22,
            },
          },
        ]
      },
    }
    const graph = parseCodeGraphFile({
      workspacePath: workspace,
      filePath: "ftl_config.c",
      content: source,
      fileHash: "ftl-config-hash",
      updatedAt: "2026-07-29T00:00:00.000Z",
    })
    await data._postingsStorage.beginFullScan()
    await data._postingsStorage.upsertFilePostings(file, graph.fileHash, graph, { content: source })
    await data._postingsStorage.markFullScanComplete()

    try {
      const results = await mgr.searchIndex("InitFTL")
      expect(results[0]).toMatchObject({
        payload: {
          filePath: "ftl_config.c",
          startLine: 1,
          endLine: 5,
          source: "codegraph",
        },
      })
      expect(results[0]?.payload?.codeChunk).toContain("const int ready = 1")
      expect(results[1]?.payload?.filePath).toBe("ftl_config.h")
    } finally {
      await mgr.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test("returns standby state before services are initialized", () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _configManager: {
        isFeatureEnabled: boolean
      }
    }

    data._configManager = {
      isFeatureEnabled: true,
    }

    expect(() => mgr.state).not.toThrow()
    expect(mgr.state).toBe("Standby")
  })

  test("does not throw when indexing is enabled but not configured", async () => {
    const mgr = createManager()

    try {
      await mgr.initialize(createInput({ openAiKey: undefined }))

      expect(mgr.isFeatureEnabled).toBe(true)
      expect(mgr.isFeatureConfigured).toBe(false)
      expect(mgr.getCurrentStatus().systemStatus).not.toBe("Error")
      expect(mgr.getCodeGraphStatus()).toMatchObject({
        state: "container_ready",
        enabled: true,
        evidenceAvailable: false,
      })
    } finally {
      mgr.dispose()
    }
  })

  test("starts code graph sidecar when RAG indexing is disabled", async () => {
    const mgr = createManager()

    try {
      await mgr.initialize(createInput({ enabled: false, openAiKey: "sk-test" }))

      expect(mgr.isFeatureEnabled).toBe(false)
      expect(mgr.getCurrentStatus().systemStatus).not.toBe("Error")
      expect(mgr.getCodeGraphStatus()).toMatchObject({
        state: "container_ready",
        enabled: true,
        evidenceAvailable: false,
      })
    } finally {
      mgr.dispose()
    }
  })

  test("does not start Document RAG when top-level RAG indexing is disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "chipmate-manager-rag-disabled-"))
    const mgr = new CodeIndexManager(root, join(root, "cache"))

    try {
      await mgr.initialize(
        createInput({
          enabled: false,
          openAiKey: "sk-test",
          documents: { enabled: true, paths: ["."] },
        }),
      )

      expect(mgr.getDocumentStatus()).toMatchObject({
        state: "Disabled",
        message: "Document RAG disabled because Code RAG is disabled.",
      })
    } finally {
      await mgr.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("starts code graph sidecar container after services initialize", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {}
      _orchestrator?: {
        state: string
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
      }
      _searchService?: {}
      _recreateServices(): Promise<void>
    }

    data._cacheManager = {}
    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        async startIndexing() {},
      }
      data._searchService = {}
    }

    await mgr.initialize(createInput({ openAiKey: "sk-test" }))

    const status = mgr.getCodeGraphStatus()
    expect(status).toMatchObject({
      state: "container_ready",
      enabled: true,
      evidenceAvailable: false,
      workspacePath: mgr.workspacePath,
      cacheDirectory: join(mgr.workspacePath, "..", "cache"),
    })
    expect(status.detail).toContain("graph evidence")
    expect(status.storage).toMatchObject({
      recordCount: 0,
      validFileCount: 0,
      parseErrorCount: 0,
      unsupportedCount: 0,
      staleCount: 0,
      evidenceAvailable: false,
    })
    expect(status.transitions.at(-1)).toMatchObject({
      state: "container_ready",
      reason: "indexing-services-initialized",
    })

    const result = await mgr.queryEvidence("find real code graph evidence")
    expect(result.answerPolicy.mode).toBe("conservative")
    expect(result.evidenceRefs).toEqual([])
    expect(result.formattedPackText).toContain("No file path and line-number evidence was returned.")
    expect(result.formattedPackText).not.toContain("container_ready")
    expect(result.formattedPackText).not.toContain("<evidence-ref")
  })

  test("initializes an unauthenticated OpenAI-compatible endpoint without auth headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "chipmate-keyless-indexing-"))
    const workspace = join(root, "workspace")
    const cache = join(root, "cache")
    const requests: Array<{ authorization: string | null; apiKey: string | null }> = []
    await Bun.write(join(workspace, ".gitkeep"), "")
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        requests.push({
          authorization: req.headers.get("authorization"),
          apiKey: req.headers.get("api-key"),
        })
        return Response.json({
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
          model: "fixture-model",
          usage: { prompt_tokens: 1, total_tokens: 1 },
        })
      },
    })

    try {
      const script = `
        import { CodeIndexManager } from "./src/indexing/manager.ts"
        import { normalizeIndexingStatus } from "./src/status.ts"
        const mgr = new CodeIndexManager(${JSON.stringify(workspace)}, ${JSON.stringify(cache)})
        try {
          await mgr.initialize({
            enabled: true,
            embedderProvider: "openai-compatible",
            vectorStoreProvider: "lancedb",
            modelId: "fixture-model",
            modelDimension: 3,
            openAiCompatibleBaseUrl: ${JSON.stringify(`http://127.0.0.1:${server.port}/v1`)},
          })
          const deadline = Date.now() + 5_000
          while (mgr.state === "Indexing" && Date.now() < deadline) {
            await Bun.sleep(10)
          }
          if (!mgr.isInitialized) throw new Error("Manager did not initialize")
          if (mgr.state === "Error") throw new Error(mgr.getCurrentStatus().message)
          if (normalizeIndexingStatus(mgr).state === "Disabled") throw new Error("Indexing remained disabled")
        } finally {
          await mgr.dispose()
        }
      `
      const child = Bun.spawn([process.execPath, "-e", script], {
        cwd: join(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      })
      const gate = Promise.withResolvers<never>()
      const timeout = setTimeout(() => {
        child.kill()
        gate.reject(new Error("Indexing subprocess timed out"))
      }, 10_000)
      const [exit, stderr] = await Promise.race([
        Promise.all([child.exited, new Response(child.stderr).text()]),
        gate.promise,
      ]).finally(() => clearTimeout(timeout))
      if (exit !== 0) throw new Error(stderr)

      expect(requests).toEqual([{ authorization: null, apiKey: null }])
    } finally {
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  })

  test("clears prior RAG diagnostics after live embedder validation recovers", async () => {
    const root = await mkdtemp(join(tmpdir(), "chipmate-rag-diagnostics-recovery-"))
    const workspace = join(root, "workspace")
    const cache = join(root, "cache")
    const requests: Array<string | null> = []
    await Bun.write(join(workspace, ".gitkeep"), "")
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const auth = req.headers.get("authorization")
        requests.push(auth)
        if (auth !== "Bearer valid-key") {
          return Response.json(
            { error: { message: "Invalid API key", type: "invalid_request_error", code: "invalid_api_key" } },
            { status: 401 },
          )
        }
        return Response.json({
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
          model: "fixture-model",
          usage: { prompt_tokens: 1, total_tokens: 1 },
        })
      },
    })

    try {
      const script = `
        import { CodeIndexManager } from "./src/indexing/manager.ts"
        const mgr = new CodeIndexManager(${JSON.stringify(workspace)}, ${JSON.stringify(cache)})
        const data = mgr as unknown as {
          _retryMaxAttempts: number
          handleTelemetry(event: {
            type: "error"
            source: "scan"
            location: string
            error: string
            provider: "openai-compatible"
            vectorStore: "lancedb"
            modelId: string
            pipeline: "codeGraph" | "documents"
          }): void
        }
        data._retryMaxAttempts = 0
        const input = (apiKey?: string) => ({
          enabled: true,
          embedderProvider: "openai-compatible" as const,
          vectorStoreProvider: "lancedb" as const,
          modelId: "fixture-model",
          modelDimension: 3,
          openAiCompatibleBaseUrl: ${JSON.stringify(`http://127.0.0.1:${server.port}/v1`)},
          openAiCompatibleApiKey: apiKey,
        })
        const wait = async (check: () => boolean, message: string) => {
          const deadline = Date.now() + 10_000
          while (!check() && Date.now() < deadline) await Bun.sleep(10)
          if (!check()) throw new Error(message)
        }
        try {
          await mgr.initialize(input())
          await wait(
            () => mgr.state === "Error" && (mgr.getRecentErrors().rag?.length ?? 0) > 0,
            "Initial authentication failure was not recorded",
          )
          const count = mgr.getRecentErrors().rag?.length ?? 0
          if (!mgr.getRecentErrors().rag?.[0]?.message.includes("Authentication failed")) {
            throw new Error("Initial RAG diagnostic did not preserve the authentication failure")
          }
          if (
            !mgr
              .getRecentErrors()
              .rag?.[0]?.message.includes(
                "Embedder validation failed (provider=openai-compatible, model=fixture-model, dimensions=3)",
              )
          ) {
            throw new Error("Initial RAG diagnostic did not preserve the embedder configuration context")
          }

          await mgr.handleSettingsChange(input("wrong-key"))
          await wait(
            () => mgr.state === "Error" && (mgr.getRecentErrors().rag?.length ?? 0) > count,
            "Failed revalidation cleared or failed to append RAG diagnostics",
          )

          data.handleTelemetry({
            type: "error",
            source: "scan",
            location: "test:codeGraph",
            error: "graph failure",
            provider: "openai-compatible",
            vectorStore: "lancedb",
            modelId: "fixture-model",
            pipeline: "codeGraph",
          })
          data.handleTelemetry({
            type: "error",
            source: "scan",
            location: "test:documents",
            error: "document failure",
            provider: "openai-compatible",
            vectorStore: "lancedb",
            modelId: "fixture-model",
            pipeline: "documents",
          })

          await mgr.handleSettingsChange(input("valid-key"))
          await wait(
            () => (mgr.getRecentErrors().rag?.length ?? 0) === 0,
            "Successful live validation did not clear prior RAG diagnostics",
          )
          const errors = mgr.getRecentErrors()
          if ((errors.codeGraph?.length ?? 0) !== 1) throw new Error("Code Graph diagnostics were cleared")
          if ((errors.documents?.length ?? 0) !== 1) throw new Error("Document diagnostics were cleared")
        } finally {
          await mgr.dispose()
        }
        process.exit(0)
      `
      const child = Bun.spawn([process.execPath, "-e", script], {
        cwd: join(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      })
      const gate = Promise.withResolvers<never>()
      const timeout = setTimeout(() => {
        child.kill()
        gate.reject(new Error("Indexing recovery subprocess timed out"))
      }, 20_000)
      const [exit, stderr] = await Promise.race([
        Promise.all([child.exited, new Response(child.stderr).text()]),
        gate.promise,
      ]).finally(() => clearTimeout(timeout))
      if (exit !== 0) throw new Error(stderr)

      expect(requests).toContain(null)
      expect(requests).toContain("Bearer wrong-key")
      expect(requests).toContain("Bearer valid-key")
    } finally {
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  })

  test("cancels active indexing when configuration is removed", async () => {
    const mgr = createManager()
    let stop = 0
    let cancel = 0
    const data = mgr as unknown as {
      _orchestrator?: {
        stopWatcher(): void
        cancelIndexing(): void
      }
    }

    data._orchestrator = {
      stopWatcher() {
        stop += 1
      },
      cancelIndexing() {
        cancel += 1
      },
    }

    await mgr.initialize(createInput({ openAiKey: undefined }))

    expect(cancel).toBe(0)
    expect(stop).toBe(1)
  })

  test("emits manual indexing start telemetry", async () => {
    const mgr = createManager()
    const events: IndexingTelemetryEvent[] = []
    const data = mgr as unknown as {
      _configManager: {
        isFeatureEnabled: boolean
        isFeatureConfigured: boolean
        getConfig(): {
          embedderProvider: "openai"
          vectorStoreProvider: "lancedb"
          modelId: string
        }
      }
      _orchestrator: {
        state: string
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
      }
      _searchService: {}
      _cacheManager: {}
    }

    let trigger: IndexingTelemetryTrigger | undefined
    data._configManager = {
      isFeatureEnabled: true,
      isFeatureConfigured: true,
      getConfig() {
        return {
          embedderProvider: "openai",
          vectorStoreProvider: "lancedb",
          modelId: "text-embedding-3-small",
        }
      },
    }
    data._orchestrator = {
      state: "Standby",
      async startIndexing(value: IndexingTelemetryTrigger) {
        trigger = value
      },
    }
    data._searchService = {}
    data._cacheManager = {}

    const sub = mgr.onTelemetry.on((event) => events.push(event))
    await mgr.startIndexing()
    sub.dispose()

    const started = events.find((event) => event.type === "started")
    expect(trigger).toBe("manual")
    expect(started).toBeDefined()
    expect(started?.type).toBe("started")
    expect(started?.trigger).toBe("manual")
    expect(started?.source).toBe("scan")
  })

  test("emits background indexing start telemetry", async () => {
    const mgr = createManager()
    const events: IndexingTelemetryEvent[] = []
    const data = mgr as unknown as {
      _cacheManager: {
        clearCacheFile(): Promise<void>
      }
      _orchestrator?: {
        state: string
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
      }
      _searchService?: {}
      _recreateServices(): Promise<void>
    }

    let trigger: IndexingTelemetryTrigger | undefined
    data._cacheManager = {
      async clearCacheFile() {},
    }
    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        async startIndexing(value: IndexingTelemetryTrigger) {
          trigger = value
        },
      }
      data._searchService = {}
    }

    const sub = mgr.onTelemetry.on((event) => events.push(event))
    await mgr.initialize(createInput({ openAiKey: "sk-test" }))
    sub.dispose()

    const started = events.find((event) => event.type === "started")
    expect(trigger).toBe("background")
    expect(started).toBeDefined()
    expect(started?.type).toBe("started")
    expect(started?.trigger).toBe("background")
    expect(started?.source).toBe("scan")
  })

  test("starts a standby manager when Code Graph has never completed", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {}
      _serviceFactory: {}
      _orchestrator: {
        state: string
        startIndexing(): Promise<{ state: "completed"; pipeline: "rag" }>
      }
      _searchService: {}
    }
    let starts = 0
    data._cacheManager = {}
    data._serviceFactory = {}
    data._orchestrator = {
      state: "Standby",
      async startIndexing() {
        starts += 1
        this.state = "Indexed"
        return { state: "completed", pipeline: "rag" }
      },
    }
    data._searchService = {}

    await mgr.initialize(createInput({ openAiKey: "sk-test" }))

    expect(starts).toBe(1)
  })

  test("preserves a completed Code Graph when embedding settings change", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {}
      _orchestrator?: {
        state: string
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
        startRagIndexing(trigger: IndexingTelemetryTrigger, reason?: string): Promise<void>
      }
      _searchService?: {}
      _recreateServices(): Promise<void>
    }
    let full = 0
    let rag = 0

    data._cacheManager = {}
    const storage = mgr as unknown as {
      _graphStorage: { getScanState(): string }
      _postingsStorage: { getScanState(): string }
    }
    storage._graphStorage.getScanState = () => "complete"
    storage._postingsStorage.getScanState = () => "complete"
    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        async startIndexing() {
          full += 1
          this.state = "Indexed"
        },
        async startRagIndexing(_trigger, value) {
          rag += 1
          void value
        },
      }
      data._searchService = {}
    }

    await mgr.initialize(createInput({ openAiKey: "sk-test", modelId: "text-embedding-3-small" }))
    full = 0
    rag = 0

    await mgr.handleSettingsChange(createInput({ openAiKey: "sk-test", modelId: "text-embedding-ada-002" }))

    expect(full).toBe(0)
    expect(rag).toBe(1)
  })

  test("reruns Code Graph when postings are interrupted before an embedding settings change", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {}
      _graphStorage: { getScanState(): string }
      _postingsStorage: { getScanState(): string }
      _orchestrator?: {
        state: string
        startIndexing(): Promise<void>
        startRagIndexing(): Promise<void>
      }
      _searchService?: {}
      _recreateServices(): Promise<void>
    }
    let full = 0
    let rag = 0
    data._cacheManager = {}
    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        async startIndexing() {
          full += 1
          this.state = "Indexed"
        },
        async startRagIndexing() {
          rag += 1
        },
      }
      data._searchService = {}
    }

    await mgr.initialize(createInput({ openAiKey: "sk-test", modelId: "text-embedding-3-small" }))
    full = 0
    data._graphStorage.getScanState = () => "complete"
    data._postingsStorage.getScanState = () => "interrupted"

    await mgr.handleSettingsChange(createInput({ openAiKey: "sk-test", modelId: "text-embedding-ada-002" }))

    expect(full).toBe(1)
    expect(rag).toBe(0)
  })

  test("does not restart indexing when only search tuning changes", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {}
      _orchestrator?: {
        state: string
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
        startRagIndexing(trigger: IndexingTelemetryTrigger, reason?: string): Promise<void>
      }
      _searchService?: {}
      _recreateServices(): Promise<void>
    }
    let restarts = 0

    data._cacheManager = {}
    data._recreateServices = async () => {
      restarts += 1
      data._orchestrator = {
        state: "Standby",
        async startIndexing() {},
        async startRagIndexing() {},
      }
      data._searchService = {}
    }

    await mgr.initialize(createInput({ openAiKey: "sk-test", searchMinScore: 0.4 }))
    restarts = 0
    await mgr.handleSettingsChange(createInput({ openAiKey: "sk-test", searchMinScore: 0.5 }))

    expect(restarts).toBe(0)
  })

  test("does not rescan or recreate services for repeated and runtime-only configuration events", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {}
      _orchestrator?: {
        state: string
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
      }
      _searchService?: {}
      _recreateServices(): Promise<void>
    }
    let recreates = 0
    let scans = 0

    data._cacheManager = {}
    data._recreateServices = async () => {
      recreates += 1
      data._orchestrator = {
        state: "Standby",
        async startIndexing() {
          scans += 1
          this.state = "Indexed"
        },
      }
      data._searchService = {}
    }

    const input = createInput({ openAiKey: "sk-test", searchMinScore: 0.4 })
    await mgr.initialize(input)
    recreates = 0
    scans = 0

    await mgr.handleSettingsChange(structuredClone(input))
    await mgr.handleSettingsChange(structuredClone(input))
    await mgr.handleSettingsChange(
      createInput({
        openAiKey: "sk-test",
        searchMinScore: 0.7,
        searchMaxResults: 40,
        embeddingBatchSize: 8,
        scannerMaxBatchRetries: 5,
      }),
    )
    await mgr.handleSettingsChange(structuredClone(input))

    expect(recreates).toBe(0)
    expect(scans).toBe(0)
  })

  test("does not rescan Code Graph for repeated configuration events while RAG is disabled", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {}
      _orchestrator?: {
        state: string
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
      }
      _recreateGraphServices(reason: string, generation: number): Promise<void>
    }
    let recreates = 0
    let scans = 0

    data._cacheManager = {}
    data._recreateGraphServices = async () => {
      recreates += 1
      data._orchestrator = {
        state: "Indexed",
        async startIndexing() {
          scans += 1
        },
      }
    }

    const input = createInput({ enabled: false, searchMinScore: 0.4 })
    await mgr.initialize(input)
    recreates = 0
    scans = 0

    await mgr.handleSettingsChange(structuredClone(input))
    await mgr.handleSettingsChange(createInput({ enabled: false, searchMinScore: 0.7 }))
    await mgr.handleSettingsChange(structuredClone(input))

    expect(recreates).toBe(0)
    expect(scans).toBe(0)
  })

  test("rebuilds only Document RAG for document-only configuration changes", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {}
      _orchestrator?: {
        state: string
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
      }
      _searchService?: {}
      _recreateServices(): Promise<void>
      _generation: number
      configureDocuments(
        trigger: IndexingTelemetryTrigger,
        opts: { force?: boolean; generation: number },
      ): Promise<void>
    }
    let recreates = 0
    let scans = 0
    let documents = 0

    data._cacheManager = {}
    data._recreateServices = async () => {
      recreates += 1
      data._orchestrator = {
        state: "Indexed",
        async startIndexing() {
          scans += 1
        },
      }
      data._searchService = {}
    }
    const original = data.configureDocuments.bind(mgr)
    data.configureDocuments = async (_trigger, opts) => {
      if (documents > 0) expect(opts.force).toBe(true)
      documents += 1
    }

    const base = createInput({
      openAiKey: "sk-test",
      documents: { enabled: true, paths: ["docs"], include: ["**/*.md"] },
    })
    await mgr.initialize(base)
    recreates = 0
    scans = 0
    documents = 1
    const storage = mgr as unknown as {
      _graphStorage: { getScanState(): string }
      _postingsStorage: { getScanState(): string }
    }
    storage._graphStorage.getScanState = () => "complete"
    storage._postingsStorage.getScanState = () => "complete"
    ;(mgr as unknown as { _stateManager: { setSystemState(state: "Indexed"): void } })._stateManager.setSystemState(
      "Indexed",
    )

    try {
      await mgr.handleSettingsChange(
        createInput({
          openAiKey: "sk-test",
          documents: { enabled: true, paths: ["docs", "specs"], include: ["**/*.md", "**/*.txt"] },
        }),
      )

      expect(recreates).toBe(0)
      expect(scans).toBe(0)
      expect(documents).toBe(2)
    } finally {
      data.configureDocuments = original
    }
  })

  test("preserves Code Graph for document-only changes while Code RAG is disabled", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {}
      _orchestrator?: {
        state: string
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
      }
      _recreateGraphServices(reason: string, generation: number): Promise<void>
      configureDocuments(
        trigger: IndexingTelemetryTrigger,
        opts: { force?: boolean; generation: number },
      ): Promise<void>
    }
    let recreates = 0
    let scans = 0
    let documents = 0

    data._cacheManager = {}
    data._recreateGraphServices = async () => {
      recreates += 1
      data._orchestrator = {
        state: "Indexed",
        async startIndexing() {
          scans += 1
        },
      }
    }
    const original = data.configureDocuments.bind(mgr)
    data.configureDocuments = async (_trigger, opts) => {
      if (documents > 0) expect(opts.force).toBe(true)
      documents += 1
    }

    const base = createInput({
      enabled: false,
      documents: { enabled: false, paths: ["docs"], include: ["**/*.md"] },
    })
    await mgr.initialize(base)
    recreates = 0
    scans = 0
    documents = 1
    const storage = mgr as unknown as {
      _graphStorage: { getScanState(): string }
      _postingsStorage: { getScanState(): string }
      _stateManager: { setSystemState(state: "Indexed"): void }
    }
    storage._graphStorage.getScanState = () => "complete"
    storage._postingsStorage.getScanState = () => "complete"
    storage._stateManager.setSystemState("Indexed")

    try {
      await mgr.handleSettingsChange(
        createInput({
          enabled: false,
          documents: { enabled: true, paths: ["docs", "specs"], include: ["**/*.md", "**/*.txt"] },
        }),
      )

      expect(recreates).toBe(0)
      expect(scans).toBe(0)
      expect(documents).toBe(2)
    } finally {
      data.configureDocuments = original
    }
  })

  test("schedules auto-recovery for orchestrator start failures", async () => {
    const mgr = createManager()
    const data = createData(mgr)
    let calls = 0

    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        stopWatcher() {},
        async startIndexing() {
          calls += 1
          this.state = "Indexed"
          data._stateManager.setSystemState("Indexed", "done")
        },
      }
      data._searchService = {}
    }

    data.handleTelemetry(createStartError())
    await data._retryTask

    expect(calls).toBe(1)
  })

  test("schedules auto-recovery for watcher failures", async () => {
    const mgr = createManager()
    const data = createData(mgr)
    let calls = 0

    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        stopWatcher() {},
        async startIndexing() {
          calls += 1
          this.state = "Indexed"
          data._stateManager.setSystemState("Indexed", "done")
        },
      }
      data._searchService = {}
    }

    data.handleTelemetry(createStartError("orchestrator:watcher"))
    await data._retryTask

    expect(calls).toBe(1)
  })

  test.each([401, 403, 404])(
    "does not auto-recover non-retryable HTTP %d embedding validation failures",
    async (status) => {
      const mgr = createManager()
      const data = createData(mgr)
      let calls = 0

      data._recreateServices = async () => {
        calls += 1
        data._searchService = {}
      }

      data.handleTelemetry({
        ...createStartError(),
        location: "OpenAICompatibleEmbedder:validateConfiguration",
        error: `HTTP ${status}: rejected`,
      })
      await Bun.sleep(0)

      expect(calls).toBe(0)
      expect(data._retryTask).toBeUndefined()
    },
  )

  test("ignores non-orchestrator telemetry errors for auto-recovery", async () => {
    const mgr = createManager()
    const data = createData(mgr)
    let calls = 0

    data._recreateServices = async () => {
      calls += 1
      data._searchService = {}
    }

    data.handleTelemetry(createStartError("manager:initialize"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toBe(0)
  })

  test("retains recent RAG telemetry errors for indexing status diagnostics", () => {
    const mgr = createManager()
    const data = createData(mgr)

    data.handleTelemetry({
      ...createStartError("scanner:batch"),
      error: String.raw`failed to parse C:\Users\test\repo\src\main.c`,
      file: String.raw`C:\Users\test\repo\src\main.c`,
    })

    const errors = mgr.getRecentErrors()
    expect(errors.rag?.[0]).toMatchObject({
      source: "scan",
      location: "scanner:batch",
      file: String.raw`C:\Users\test\repo\src\main.c`,
    })
    expect(errors.rag?.[0]?.message).toContain("[REDACTED_PATH]")
    expect(errors.codeGraph).toBeUndefined()
  })

  test("routes recent Code Graph telemetry errors to the Code Graph pipeline", () => {
    const mgr = createManager()
    const data = createData(mgr)

    data.handleTelemetry({
      ...createStartError("scanner:updateFileGraph"),
      error: "tree-sitter failed",
      file: "src/main.c",
    })

    const errors = mgr.getRecentErrors()
    expect(errors.codeGraph?.[0]).toMatchObject({
      source: "scan",
      location: "scanner:updateFileGraph",
      file: "src/main.c",
      message: "tree-sitter failed",
    })
    expect(errors.rag).toBeUndefined()
  })

  test("runs only one recovery loop for duplicate error telemetry", async () => {
    const mgr = createManager()
    const data = createData(mgr)
    let calls = 0
    const gate = {} as {
      done: Promise<void>
      wake: () => void
    }

    gate.done = new Promise<void>((resolve) => {
      gate.wake = resolve
    })

    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        stopWatcher() {},
        async startIndexing() {
          calls += 1
          this.state = "Indexed"
          await gate.done
          data._stateManager.setSystemState("Indexed", "done")
        },
      }
      data._searchService = {}
    }

    data.handleTelemetry(createStartError())
    data.handleTelemetry(createStartError())

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)

    gate.wake()
    await data._retryTask
  })

  test("startIndexing restarts from Error state in one call", async () => {
    const mgr = createManager()
    const data = createData(mgr)
    let calls = 0

    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        stopWatcher() {},
        async startIndexing() {
          calls += 1
          this.state = "Indexed"
          data._stateManager.setSystemState("Indexed", "done")
        },
      }
      data._searchService = {}
    }

    data._stateManager.setSystemState("Error", "failed")
    await mgr.startIndexing()

    expect(calls).toBe(1)
    expect(mgr.getCurrentStatus().systemStatus).toBe("Indexed")
  })

  test("keeps last-known-good vector search available when desired settings remain unapplied", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _serviceFactory: {
        prepareLastKnownGoodRuntime(): Promise<object>
      }
      _orchestrator: {
        startIndexing(): Promise<void>
      }
      _codeGraph: {
        start(reason: string): void
        dispose(reason: string): void
      }
      _recreateGraphServices(reason: string, generation: number): Promise<void>
      restoreLastKnownGood(runtime: object, generation: number): Promise<boolean>
      graphFallback(err: unknown, trigger: IndexingTelemetryTrigger, reason: string): Promise<void>
    }
    data._serviceFactory = {
      async prepareLastKnownGoodRuntime() {
        return {}
      },
    }
    data._orchestrator = {
      async startIndexing() {},
    }
    data._codeGraph = {
      start() {},
      dispose() {},
    }
    data._recreateGraphServices = async () => {}
    data.restoreLastKnownGood = async () => true

    await data.graphFallback(new Error("fixed dimension rejected"), "background", "test")

    const status = mgr.getCurrentStatus()
    expect(status.systemStatus).toBe("Indexed")
    expect(status.activePipeline).toBeUndefined()
    expect(status.notices?.[0]?.message).toContain("上一版向量索引")
    await mgr.dispose()
  })

  test("dispose waits for orchestrator shutdown", async () => {
    const mgr = createManager()
    let shutdown = 0
    let closed = 0
    const data = mgr as unknown as {
      _orchestrator?: {
        shutdown(): Promise<void>
      }
      _fallbackStore?: {
        close(): Promise<void>
      }
    }

    data._orchestrator = {
      async shutdown() {
        shutdown += 1
      },
    }
    data._fallbackStore = {
      async close() {
        closed += 1
      },
    }

    await mgr.dispose()

    expect(shutdown).toBe(1)
    expect(closed).toBe(1)
  })

  test("dispose during service recreation cancels the recreated orchestrator", async () => {
    const mgr = createManager()
    const data = mgr as unknown as {
      _cacheManager: {
        clearCacheFile(): Promise<void>
      }
      _orchestrator?: {
        state: string
        cancelIndexing(): void
        startIndexing(trigger: IndexingTelemetryTrigger): Promise<void>
      }
      _searchService?: {}
      _recreateServices(): Promise<void>
    }
    const gate = Promise.withResolvers<void>()
    let cancel = 0
    let start = 0

    data._cacheManager = {
      async clearCacheFile() {},
    }
    data._recreateServices = async () => {
      await gate.promise
      data._orchestrator = {
        state: "Standby",
        cancelIndexing() {
          cancel += 1
        },
        async startIndexing() {
          start += 1
        },
      }
      data._searchService = {}
    }

    const init = mgr.initialize(createInput({ openAiKey: "sk-test" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await mgr.dispose()
    gate.resolve()
    await init

    expect(cancel).toBe(1)
    expect(start).toBe(0)
  })

  test("dispose during recovery prevents restart after service recreation", async () => {
    const mgr = createManager()
    const data = createData(mgr)
    const gate = Promise.withResolvers<void>()
    let start = 0

    data._recreateServices = async () => {
      await gate.promise
      data._orchestrator = {
        state: "Standby",
        stopWatcher() {},
        async startIndexing() {
          start += 1
        },
      }
      data._searchService = {}
    }

    const task = data.handleTelemetry(createStartError())
    await new Promise((resolve) => setTimeout(resolve, 0))
    await mgr.dispose()
    gate.resolve()
    await data._retryTask

    expect(task).toBeUndefined()
    expect(start).toBe(0)
  })

  test("retry exhaustion keeps Error and stops future retries", async () => {
    const mgr = createManager()
    const data = createData(mgr)
    data._retryMaxAttempts = 2
    let calls = 0

    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        stopWatcher() {},
        async startIndexing() {
          calls += 1
          this.state = "Error"
          data._stateManager.setSystemState("Error", "failed")
        },
      }
      data._searchService = {}
    }

    data.handleTelemetry(createStartError())
    await data._retryTask

    expect(calls).toBe(2)
    expect(mgr.getCurrentStatus().systemStatus).toBe("Error")

    data.handleTelemetry(createStartError())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(2)
  })
})
