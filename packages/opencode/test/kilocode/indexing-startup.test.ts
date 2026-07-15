import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { CodeIndexAnalysisService, CodeIndexManager } from "@kilocode/kilo-indexing/engine"
import { normalizeIndexingStatus } from "@kilocode/kilo-indexing/status"
import type { Config } from "../../src/config/config"
import { GlobalBus } from "../../src/bus/global"
import { failed, KiloIndexing } from "../../src/kilocode/indexing"
import { IndexingWorker } from "../../src/kilocode/indexing-worker-client"
import { WithInstance } from "../../src/project/with-instance"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const fetch = global.fetch

const cfg: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    provider: "ollama",
    vectorStore: "qdrant",
    ollama: {
      baseUrl: "http://127.0.0.1:1",
    },
  },
}

const unset: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    provider: "ollama",
    vectorStore: "qdrant",
    ollama: {
      baseUrl: "http://127.0.0.1:1",
    },
  },
}
const inactive: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: false,
    provider: "ollama",
    vectorStore: "qdrant",
  },
}
const kilo: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    vectorStore: "qdrant",
  },
}
const implicitOpenAi: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    vectorStore: "qdrant",
    openai: {
      apiKey: "openai-token",
    },
  },
}
const staleKilo: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    provider: "kilo",
    model: "custom/model",
    dimension: 2048,
    vectorStore: "qdrant",
  },
}
const configDir = process.env["KILO_CONFIG_DIR"]
const disabled = process.env["KILO_DISABLE_CODEBASE_INDEXING"]
const error = new Error("test indexing initialization failed")

test("keeps initialization diagnostics non-empty", () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular

  const cases: Array<[unknown, string]> = [
    [new Error(""), ""],
    [{ error: "structured error" }, "structured error"],
    [{ data: { message: "nested data error" } }, "nested data error"],
    ["", "Unknown indexing initialization error"],
    [circular, "Unknown indexing initialization error"],
  ]

  for (const [input, expected] of cases) {
    const status = failed(input)
    const message = status.pipelines?.rag.recentErrors?.[0]?.message ?? ""

    expect(message.trim()).not.toBe("")
    if (expected) expect(message).toContain(expected)
  }
})

function inline(directory: string, root: string, hooks: IndexingWorker.Hooks): IndexingWorker.Driver {
  const manager = new CodeIndexManager(directory, root)
  const progress = manager.onProgressUpdate.on(() => hooks.status(normalizeIndexingStatus(manager)))
  const telemetry = manager.onTelemetry.on(hooks.telemetry)

  return {
    async init(input) {
      await manager.initialize(input)
      return normalizeIndexingStatus(manager)
    },
    async updateConfig(input) {
      await manager.handleSettingsChange(input)
      return normalizeIndexingStatus(manager)
    },
    search: (query, directoryPrefix) => manager.searchIndex(query, directoryPrefix),
    documentSearch: (query, options) => manager.searchDocuments(query, options),
    async rebuildDocuments() {
      await manager.rebuildDocuments()
      return normalizeIndexingStatus(manager)
    },
    queryEvidence: (query, options) => manager.queryEvidence(query, options),
    codeGraphStatus: () => Promise.resolve(manager.getCodeGraphStatus()),
    async dispose() {
      progress.dispose()
      telemetry.dispose()
      manager.dispose()
    },
  }
}

async function wait(read: () => Promise<KiloIndexing.Status>, state: KiloIndexing.Status["state"]) {
  for (const _ of Array.from({ length: 100 })) {
    const status = await read()
    if (status.state === state) return status
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`indexing did not reach ${state}`)
}

async function waitFor(
  read: () => Promise<KiloIndexing.Status>,
  check: (status: KiloIndexing.Status) => boolean,
  label: string,
) {
  let last: KiloIndexing.Status | undefined
  for (const _ of Array.from({ length: 300 })) {
    last = await read()
    if (check(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`${label} did not settle: ${JSON.stringify(last)}`)
}

async function called(init: ReturnType<typeof spyOn<CodeIndexManager, "initialize">>) {
  for (const _ of Array.from({ length: 100 })) {
    if (init.mock.calls.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("indexing initialization did not start")
}

beforeEach(() => {
  IndexingWorker.override(inline)
})

afterEach(async () => {
  IndexingWorker.override()
  if (configDir === undefined) delete process.env["KILO_CONFIG_DIR"]
  else process.env["KILO_CONFIG_DIR"] = configDir
  if (disabled === undefined) delete process.env["KILO_DISABLE_CODEBASE_INDEXING"]
  else process.env["KILO_DISABLE_CODEBASE_INDEXING"] = disabled
  global.fetch = fetch
  await disposeAllInstances()
})

describe("indexing startup degradation", () => {
  test("keeps server routes alive when indexing initialization fails", async () => {
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockRejectedValue(error)

    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    try {
      const app = Server.Default().app

      const config = await app.request("/config", {
        headers: {
          "x-kilo-directory": tmp.path,
        },
      })
      expect(config.status).toBe(200)

      const body = await wait(async () => {
        const status = await app.request("/indexing/status", {
          headers: {
            "x-kilo-directory": tmp.path,
          },
        })
        expect(status.status).toBe(200)
        return status.json()
      }, "Error")

      expect(body).toMatchObject({
        state: "Error",
        pipelines: {
          codeGraph: { state: "Error" },
          rag: { state: "Error" },
        },
      })
      expect(body.message).toContain("Failed to initialize: test indexing initialization failed")
    } finally {
      init.mockRestore()
    }
  })

  test("reports routes as in progress while initialization is in flight", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const gate = Promise.withResolvers<{ requiresRestart: boolean }>()
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockImplementation(() => gate.promise)

    try {
      const app = Server.Default().app

      const config = await app.request("/config", {
        headers: {
          "x-kilo-directory": tmp.path,
        },
      })
      expect(config.status).toBe(200)
      await called(init)

      const status = await app.request("/indexing/status", {
        headers: {
          "x-kilo-directory": tmp.path,
        },
      })
      expect(status.status).toBe(200)

      const body = await status.json()
      expect(body).toMatchObject({
        state: "In Progress",
        message: "Indexing is initializing.",
        pipelines: {
          codeGraph: { state: "In Progress" },
          rag: { state: "In Progress" },
        },
      })
    } finally {
      gate.resolve({ requiresRestart: false })
      init.mockRestore()
    }
  })

  test("does not publish initialized status after in-flight startup is disposed", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const gate = Promise.withResolvers<{ requiresRestart: boolean }>()
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockImplementation(() => gate.promise)
    const events: KiloIndexing.Status[] = []
    const on = (data: {
      directory?: string
      payload?: { type?: string; properties?: { status?: KiloIndexing.Status } }
    }) => {
      if (data.directory !== tmp.path) return
      if (data.payload?.type !== KiloIndexing.Event.type) return
      if (data.payload.properties?.status) events.push(data.payload.properties.status)
    }
    GlobalBus.on("event", on)

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect((await KiloIndexing.current()).state).toBe("In Progress")
        },
      })

      await disposeAllInstances()
      gate.resolve({ requiresRestart: false })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(events.some((status) => status.state === "Complete" || status.state === "Standby")).toBe(false)
    } finally {
      GlobalBus.off("event", on)
      gate.resolve({ requiresRestart: false })
      init.mockRestore()
    }
  })

  test("keeps degraded indexing queryable but releases its failed engine", async () => {
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockRejectedValue(error)
    const dispose = spyOn(CodeIndexManager.prototype, "dispose")

    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          const status = await wait(() => KiloIndexing.current(), "Error")

          expect(status.state).toBe("Error")
          expect(status.message).toContain("Failed to initialize: test indexing initialization failed")
          expect(await KiloIndexing.available()).toBe(false)
          expect(KiloIndexing.ready()).toBe(false)
          expect(await KiloIndexing.search("boot failure")).toEqual([])
          expect(dispose).toHaveBeenCalledTimes(1)
        },
      })
    } finally {
      dispose.mockRestore()
      init.mockRestore()
    }
  })

  test("routes queryEvidence through the initialized indexing driver", async () => {
    const calls: Array<{ query: string; options: unknown }> = []
    const statuses: string[] = []
    const done: KiloIndexing.Status = {
      state: "Complete",
      message: "Indexing complete.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 100,
    }
    IndexingWorker.override(() => ({
      async init() {
        return done
      },
      async updateConfig() {
        return done
      },
      async search() {
        return []
      },
      async documentSearch() {
        return []
      },
      async rebuildDocuments() {
        return done
      },
      async queryEvidence(query, options = {}) {
        calls.push({ query, options })
        return CodeIndexAnalysisService.createStub(query, options)
      },
      async codeGraphStatus() {
        statuses.push("called")
        return {
          state: "container_ready",
          enabled: true,
          evidenceAvailable: false,
          detail: "test sidecar container",
          workspacePath: tmp.path,
          snippetLimit: 240,
          transitions: [
            {
              state: "container_ready",
              reason: "test",
              timestamp: 1,
            },
          ],
        }
      },
      async dispose() {},
    }))

    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        await wait(() => KiloIndexing.current(), "Complete")

        const result = await KiloIndexing.queryEvidence("find callers", {
          retrievalMode: "graph-only",
          maxEvidenceItems: 2,
        })

        const graph = await KiloIndexing.codeGraphStatus()

        expect(calls).toEqual([
          {
            query: "find callers",
            options: {
              retrievalMode: "graph-only",
              maxEvidenceItems: 2,
            },
          },
        ])
        expect(statuses).toEqual(["called"])
        expect(result.trace.retrievalMode).toBe("graph-only")
        expect(graph).toMatchObject({
          state: "container_ready",
          evidenceAvailable: false,
        })
      },
    })
  })

  test("reports not ready while initialization is in flight", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const gate = Promise.withResolvers<{ requiresRestart: boolean }>()
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockImplementation(() => gate.promise)

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)

          expect(init).toHaveBeenCalled()
          expect(KiloIndexing.ready()).toBe(false)
          expect(await KiloIndexing.available()).toBe(false)
          expect(await KiloIndexing.search("boot failure")).toEqual([])
          expect(await KiloIndexing.codeGraphStatus()).toMatchObject({
            state: "disabled",
            evidenceAvailable: false,
          })
        },
      })
    } finally {
      gate.resolve({ requiresRestart: false })
      init.mockRestore()
    }
  })

  test("keeps Code Graph enabled when RAG indexing enablement is unset", async () => {
    await using tmp = await tmpdir({ git: true, config: unset })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const init = spyOn(CodeIndexManager.prototype, "initialize")

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          const status = await waitFor(
            () => KiloIndexing.current(),
            (item) =>
              item.state !== "Error" &&
              item.pipelines?.rag.state === "Disabled" &&
              item.pipelines?.codeGraph.state !== "Disabled" &&
              item.pipelines?.codeGraph.state !== "Error",
            "graph-only indexing",
          )

          expect(status.state).not.toBe("Error")
          expect(status.pipelines?.codeGraph.state).not.toBe("Disabled")
          expect(status.pipelines?.rag.state).toBe("Disabled")
          expect(await KiloIndexing.available()).toBe(false)
          expect(KiloIndexing.ready()).toBe(false)
          expect(KiloIndexing.analysisReady()).toBe(true)
          expect(await KiloIndexing.search("disabled")).toEqual([])
          expect(await KiloIndexing.codeGraphStatus()).toMatchObject({
            state: "container_ready",
            enabled: true,
            evidenceAvailable: false,
          })
          expect(init).toHaveBeenCalled()
        },
      })
    } finally {
      init.mockRestore()
    }
  })

  test("allocates a graph-only engine when RAG indexing is disabled", async () => {
    const created: string[] = []
    IndexingWorker.override((directory, root, hooks) => {
      created.push(directory)
      return inline(directory, root, hooks)
    })

    await using tmp = await tmpdir({ git: true, config: inactive })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const status = await waitFor(
          () => KiloIndexing.current(),
          (item) =>
            item.state !== "Error" &&
            item.pipelines?.rag.state === "Disabled" &&
            item.pipelines?.codeGraph.state !== "Disabled" &&
            item.pipelines?.codeGraph.state !== "Error",
          "graph-only indexing",
        )

        expect(status.state).not.toBe("Error")
        expect(status.pipelines?.codeGraph.state).not.toBe("Disabled")
        expect(status.pipelines?.rag.state).toBe("Disabled")
        expect(await KiloIndexing.available()).toBe(false)
        expect(KiloIndexing.ready()).toBe(false)
        expect(KiloIndexing.analysisReady()).toBe(true)
        expect(await KiloIndexing.search("disabled")).toEqual([])
        expect(created).toEqual([tmp.path])
      },
    })
  })

  test("restarts a failed indexing process in forced low-memory mode", async () => {
    const modes: boolean[] = []
    IndexingWorker.override((directory, root, hooks, options) => {
      const driver = inline(directory, root, hooks)
      modes.push(options?.forcedLow === true)
      if (modes.length !== 1) return driver
      return {
        ...driver,
        async init(input) {
          const status = await driver.init(input)
          setTimeout(() => {
            void driver.dispose().finally(() => {
              hooks.failure(new Error("Indexing process requested a memory rollover"))
            })
          }, 0)
          return status
        },
      }
    })

    await using tmp = await tmpdir({ git: true, config: inactive })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const status = await waitFor(
          () => KiloIndexing.current(),
          (item) => modes.length >= 2 && item.state !== "Error",
          "low-memory indexing recovery",
        )
        expect(modes.slice(0, 2)).toEqual([false, true])
        expect(status.pipelines?.codeGraph.state).not.toBe("Error")
      },
    })
  })

  test("enriches Kilo provider config from env auth", async () => {
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            defaultModel: "mistralai/mistral-embed-2312",
            models: [
              { id: "mistralai/mistral-embed-2312", name: "Mistral Embed 2312", dimension: 1024, scoreThreshold: 0.35 },
            ],
            aliases: {},
          }),
        ),
      )) as unknown as typeof global.fetch
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY
    const org = process.env.KILO_ORG_ID

    await using tmp = await tmpdir({ git: true, config: kilo })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"
    process.env.KILO_ORG_ID = "org_123"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({
            embedderProvider: "kilo",
            kiloApiKey: "kilo-token",
            kiloOrganizationId: "org_123",
            modelId: "mistralai/mistral-embed-2312",
            modelDimension: 1024,
            searchMinScore: 0.35,
          })
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      if (org === undefined) delete process.env.KILO_ORG_ID
      else process.env.KILO_ORG_ID = org
      init.mockRestore()
    }
  })

  test("falls back from unsupported stored Kilo models to the hosted default", async () => {
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            defaultModel: "mistralai/mistral-embed-2312",
            models: [
              { id: "mistralai/mistral-embed-2312", name: "Mistral Embed 2312", dimension: 1024, scoreThreshold: 0.35 },
            ],
            aliases: {},
          }),
        ),
      )) as unknown as typeof global.fetch
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY

    await using tmp = await tmpdir({ git: true, config: staleKilo })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({
            embedderProvider: "kilo",
            modelId: "mistralai/mistral-embed-2312",
            modelDimension: 1024,
            searchMinScore: 0.35,
          })
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      init.mockRestore()
    }
  })

  test("keeps configured dimensions for supported Kilo models", async () => {
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            defaultModel: "mistralai/mistral-embed-2312",
            models: [
              { id: "mistralai/mistral-embed-2312", name: "Mistral Embed 2312", dimension: 1024, scoreThreshold: 0.35 },
              {
                id: "openai/text-embedding-3-small",
                name: "OpenAI Text Embedding 3 Small",
                dimension: 1536,
                scoreThreshold: 0.4,
              },
            ],
            aliases: {},
          }),
        ),
      )) as unknown as typeof global.fetch
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY
    const config: Partial<Config.Info> = {
      ...staleKilo,
      indexing: {
        ...staleKilo.indexing,
        model: "openai/text-embedding-3-small",
        dimension: 256,
      },
    }

    await using tmp = await tmpdir({ git: true, config })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({
            embedderProvider: "kilo",
            modelId: "openai/text-embedding-3-small",
            modelDimension: 256,
          })
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      init.mockRestore()
    }
  })

  test("does not execute stored Kilo models when the hosted catalog is unavailable", async () => {
    global.fetch = (() => Promise.resolve(new Response(undefined, { status: 500 }))) as unknown as typeof global.fetch
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY

    await using tmp = await tmpdir({ git: true, config: staleKilo })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({ embedderProvider: "kilo" })
          expect(init.mock.calls[0]?.[0].modelId).toBeUndefined()
          expect(init.mock.calls[0]?.[0].modelDimension).toBeUndefined()
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      init.mockRestore()
    }
  })

  test("does not default to Kilo when an existing provider config is present", async () => {
    const init = spyOn(CodeIndexManager.prototype, "initialize").mockResolvedValue({ requiresRestart: false })
    const key = process.env.KILO_API_KEY

    await using tmp = await tmpdir({ git: true, config: implicitOpenAi })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env.KILO_API_KEY = "kilo-token"

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await called(init)
          expect(init.mock.calls[0]?.[0]).toMatchObject({
            embedderProvider: "openai",
            openAiKey: "openai-token",
          })
        },
      })
    } finally {
      if (key === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = key
      init.mockRestore()
    }
  })

  test("stays disabled when VS Code starts without a workspace folder", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    process.env["KILO_DISABLE_CODEBASE_INDEXING"] = "vscode-no-workspace"
    const init = spyOn(CodeIndexManager.prototype, "initialize")

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          const status = await KiloIndexing.current()

          expect(status).toMatchObject({
            state: "Disabled",
            message: "Codebase indexing is disabled because no workspace folder is open in VS Code.",
          })
          expect(await KiloIndexing.available()).toBe(false)
          expect(KiloIndexing.ready()).toBe(false)
          expect(await KiloIndexing.search("no workspace")).toEqual([])
          expect(init).not.toHaveBeenCalled()
        },
      })
    } finally {
      init.mockRestore()
    }
  })
})
