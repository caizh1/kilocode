import { describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CacheManager } from "../../../src/indexing/cache-manager"
import { CodeIndexManager } from "../../../src/indexing/manager"
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

  test("returns standby state before services are initialized", () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")

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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")

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

  test("starts code graph sidecar container after services initialize", async () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
      workspacePath: "/tmp/ws",
      cacheDirectory: "/tmp/cache",
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
    const root = await mkdtemp(join(tmpdir(), "kilo-keyless-indexing-"))
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
          if (!mgr.isInitialized) throw new Error("Manager did not initialize")
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

  test("cancels active indexing when configuration is removed", async () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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

  test("restarts RAG only when embedding settings change", async () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    let reason: string | undefined

    data._cacheManager = {}
    data._recreateServices = async () => {
      data._orchestrator = {
        state: "Standby",
        async startIndexing() {
          full += 1
        },
        async startRagIndexing(_trigger, value) {
          rag += 1
          reason = value
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
    expect(reason).toBe("settings-change")
  })

  test("does not restart indexing when only search tuning changes", async () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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

  test("schedules auto-recovery for orchestrator start failures", async () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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

  test("ignores non-orchestrator telemetry errors for auto-recovery", async () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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

  test("dispose waits for orchestrator shutdown", async () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
    let shutdown = 0
    const data = mgr as unknown as {
      _orchestrator?: {
        shutdown(): Promise<void>
      }
    }

    data._orchestrator = {
      async shutdown() {
        shutdown += 1
      },
    }

    await mgr.dispose()

    expect(shutdown).toBe(1)
  })

  test("dispose during service recreation cancels the recreated orchestrator", async () => {
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
    const mgr = new CodeIndexManager("/tmp/ws", "/tmp/cache")
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
