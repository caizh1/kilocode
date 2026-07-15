import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "../../src/agent/agent"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { KilocodeBootstrap } from "../../src/kilocode/bootstrap"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { KiloToolRegistry } from "../../src/kilocode/tool/registry"
import { Config } from "../../src/config/config"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ToolRegistry } from "../../src/tool/registry"
import type * as Tool from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(Agent.defaultLayer, ToolRegistry.defaultLayer, node))
const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("kilocode tool registry indexing", () => {
  const logger = Log.create({ service: "kilocode-tool-registry" })

  it.live("omits indexing tools without waiting for slow indexing startup", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const avail = spyOn(KiloIndexing, "available").mockImplementation(() => new Promise<boolean>(() => {}))

          try {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()

            expect(ids).not.toContain("codebase_analysis")
            expect(ids).not.toContain("semantic_search")
            expect(ids).not.toContain("document_search")
            expect(ids).toContain("question")
            expect(ids).toContain("read")
            expect(ids).toContain("suggest")
            expect(ids).toContain("validate_mermaid_diagram")
            expect(ids).toContain("render_mermaid_diagram")
            expect(ids).toContain("save_mermaid_artifact")
            expect(ids).toContain("insert_mermaid_into_word")
            expect(avail).not.toHaveBeenCalled()
          } finally {
            avail.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("keeps non-indexing tools when indexing readiness throws", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const err = new Error("ready failed")
          const ready = spyOn(KiloIndexing, "ready").mockImplementation(() => {
            throw err
          })
          const warn = spyOn(logger, "warn").mockImplementation(() => {})

          try {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()

            expect(ids).not.toContain("codebase_analysis")
            expect(ids).not.toContain("semantic_search")
            expect(ids).not.toContain("document_search")
            expect(ids).toContain("question")
            expect(ids).toContain("read")
            expect(ids).toContain("suggest")
            expect(warn.mock.calls[0]?.[0]).toBe("indexing tools unavailable")
            expect(warn.mock.calls[0]?.[1]?.err).toBeDefined()
          } finally {
            ready.mockRestore()
            warn.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("keeps non-indexing tools when indexing readiness rejects", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const err = new Error("ready rejected")
          const ready = spyOn(KiloIndexing, "ready").mockImplementation(() => Promise.reject(err) as unknown as boolean)
          const warn = spyOn(logger, "warn").mockImplementation(() => {})

          try {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()

            expect(ids).not.toContain("codebase_analysis")
            expect(ids).not.toContain("semantic_search")
            expect(ids).not.toContain("document_search")
            expect(ids).toContain("question")
            expect(ids).toContain("read")
            expect(ids).toContain("suggest")
            expect(warn.mock.calls[0]?.[0]).toBe("indexing tools unavailable")
            expect(warn.mock.calls[0]?.[1]?.err).toBeDefined()
          } finally {
            ready.mockRestore()
            warn.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("registers indexing tools when indexing is ready", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ready = spyOn(KiloIndexing, "ready").mockReturnValue(true)
          const analysisReady = spyOn(KiloIndexing, "analysisReady").mockReturnValue(true)
          const documentReady = spyOn(KiloIndexing, "documentReady").mockReturnValue(true)

          try {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()

            expect(ids).toContain("codebase_analysis")
            expect(ids).toContain("semantic_search")
            expect(ids).toContain("document_search")
          } finally {
            ready.mockRestore()
            analysisReady.mockRestore()
            documentReady.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("omits semantic_search hint from glob and grep descriptions when indexing is not ready", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ready = spyOn(KiloIndexing, "ready").mockReturnValue(false)

          try {
            const agent = yield* Agent.Service
            const build = yield* agent.get("build")
            const registry = yield* ToolRegistry.Service
            const tools = yield* registry.tools({ ...ref, agent: build })
            const glob = tools.find((tool) => tool.id === "glob")?.description ?? ""
            const grep = tools.find((tool) => tool.id === "grep")?.description ?? ""

            expect(glob).not.toContain("codebase_analysis")
            expect(glob).not.toContain("semantic_search")
            expect(glob).not.toContain("document_search")
            expect(grep).not.toContain("codebase_analysis")
            expect(grep).not.toContain("semantic_search")
            expect(grep).not.toContain("document_search")
          } finally {
            ready.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("includes indexing tool hints in glob and grep descriptions when indexing is ready", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ready = spyOn(KiloIndexing, "ready").mockReturnValue(true)
          const analysisReady = spyOn(KiloIndexing, "analysisReady").mockReturnValue(true)
          const documentReady = spyOn(KiloIndexing, "documentReady").mockReturnValue(true)

          try {
            const agent = yield* Agent.Service
            const build = yield* agent.get("build")
            const registry = yield* ToolRegistry.Service
            const tools = yield* registry.tools({ ...ref, agent: build })
            const ids = tools.map((tool) => tool.id)
            const glob = tools.find((tool) => tool.id === "glob")?.description ?? ""
            const grep = tools.find((tool) => tool.id === "grep")?.description ?? ""

            expect(ids).toContain("codebase_analysis")
            expect(ids).toContain("semantic_search")
            expect(ids).toContain("document_search")
            expect(glob).toContain("codebase_analysis")
            expect(glob).toContain("semantic_search")
            expect(glob).toContain("document_search")
            expect(grep).toContain("codebase_analysis")
            expect(grep).toContain("semantic_search")
            expect(grep).toContain("document_search")
          } finally {
            ready.mockRestore()
            analysisReady.mockRestore()
            documentReady.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  test("conditionally includes Kilo registry extras", () => {
    const prev = process.env["KILO_CLIENT"]
    const def = (id: string): Tool.Def => ({
      id,
      description: id,
      parameters: Schema.String,
      execute: () => Effect.succeed({ title: id, output: id, metadata: {} }),
    })
    const tools = {
      codebase: def("codebase_search"),
      analysis: def("codebase_analysis"),
      semantic: def("semantic_search"),
      document: def("document_search"),
      artifacts: [
        def("declare_artifact"),
        def("list_artifacts"),
        def("open_artifact"),
        def("export_artifact_diagnostics"),
      ],
      word: [
        def("create_word_document"),
        def("inspect_word_document"),
        def("apply_word_document_edits"),
        def("apply_word_template_styles"),
        def("materialize_word_fields"),
        def("merge_word_documents"),
        def("diff_word_documents"),
        def("normalize_word_table_spec"),
        def("render_word_document"),
      ],
      mermaid: [
        def("validate_mermaid_diagram"),
        def("render_mermaid_diagram"),
        def("save_mermaid_artifact"),
        def("insert_mermaid_into_word"),
      ],
      recall: def("recall"),
      manager: def("agent_manager"),
      process: def("background_process"),
    }

    try {
      process.env["KILO_CLIENT"] = "cli"
      expect(KiloToolRegistry.extra(tools, {}).map((tool) => tool.id)).toEqual([
        "codebase_analysis",
        "semantic_search",
        "document_search",
        "declare_artifact",
        "list_artifacts",
        "open_artifact",
        "export_artifact_diagnostics",
        "create_word_document",
        "inspect_word_document",
        "apply_word_document_edits",
        "apply_word_template_styles",
        "materialize_word_fields",
        "merge_word_documents",
        "diff_word_documents",
        "normalize_word_table_spec",
        "render_word_document",
        "validate_mermaid_diagram",
        "render_mermaid_diagram",
        "save_mermaid_artifact",
        "insert_mermaid_into_word",
        "recall",
        "background_process",
      ])
      expect(KiloToolRegistry.extra(tools, { experimental: { codebase_search: true } }).map((tool) => tool.id)).toEqual(
        [
          "codebase_search",
          "codebase_analysis",
          "semantic_search",
          "document_search",
          "declare_artifact",
          "list_artifacts",
          "open_artifact",
          "export_artifact_diagnostics",
          "create_word_document",
          "inspect_word_document",
          "apply_word_document_edits",
          "apply_word_template_styles",
          "materialize_word_fields",
          "merge_word_documents",
          "diff_word_documents",
          "normalize_word_table_spec",
          "render_word_document",
          "validate_mermaid_diagram",
          "render_mermaid_diagram",
          "save_mermaid_artifact",
          "insert_mermaid_into_word",
          "recall",
          "background_process",
        ],
      )

      process.env["KILO_CLIENT"] = "vscode"
      expect(KiloToolRegistry.extra(tools, { experimental: { codebase_search: true } }).map((tool) => tool.id)).toEqual(
        [
          "codebase_search",
          "codebase_analysis",
          "semantic_search",
          "document_search",
          "declare_artifact",
          "list_artifacts",
          "open_artifact",
          "export_artifact_diagnostics",
          "create_word_document",
          "inspect_word_document",
          "apply_word_document_edits",
          "apply_word_template_styles",
          "materialize_word_fields",
          "merge_word_documents",
          "diff_word_documents",
          "normalize_word_table_spec",
          "render_word_document",
          "validate_mermaid_diagram",
          "render_mermaid_diagram",
          "save_mermaid_artifact",
          "insert_mermaid_into_word",
          "recall",
          "background_process",
          "agent_manager",
        ],
      )
      expect(KiloToolRegistry.extra({ ...tools, semantic: undefined }, {}).map((tool) => tool.id)).toEqual([
        "codebase_analysis",
        "document_search",
        "declare_artifact",
        "list_artifacts",
        "open_artifact",
        "export_artifact_diagnostics",
        "create_word_document",
        "inspect_word_document",
        "apply_word_document_edits",
        "apply_word_template_styles",
        "materialize_word_fields",
        "merge_word_documents",
        "diff_word_documents",
        "normalize_word_table_spec",
        "render_word_document",
        "validate_mermaid_diagram",
        "render_mermaid_diagram",
        "save_mermaid_artifact",
        "insert_mermaid_into_word",
        "recall",
        "background_process",
        "agent_manager",
      ])

      process.env["KILO_CLIENT"] = "desktop"
      expect(KiloToolRegistry.extra(tools, {}).map((tool) => tool.id)).toEqual([
        "codebase_analysis",
        "semantic_search",
        "document_search",
        "declare_artifact",
        "list_artifacts",
        "open_artifact",
        "export_artifact_diagnostics",
        "create_word_document",
        "inspect_word_document",
        "apply_word_document_edits",
        "apply_word_template_styles",
        "materialize_word_fields",
        "merge_word_documents",
        "diff_word_documents",
        "normalize_word_table_spec",
        "render_word_document",
        "validate_mermaid_diagram",
        "render_mermaid_diagram",
        "save_mermaid_artifact",
        "insert_mermaid_into_word",
        "recall",
      ])
    } finally {
      if (prev === undefined) delete process.env["KILO_CLIENT"]
      if (prev !== undefined) process.env["KILO_CLIENT"] = prev
    }
  })

  test("preloads internal retrieval tools without consulting runtime readiness", async () => {
    const info = (id: string): Tool.Info => ({
      id,
      init: () =>
        Effect.succeed({
          description: id,
          parameters: Schema.String,
          execute: () => Effect.succeed({ title: id, output: id, metadata: {} }),
        }),
    })
    const defs = {
      codebase: info("codebase_search"),
      recall: info("recall"),
      manager: info("agent_manager"),
      process: info("background_process"),
    }
    const deps = {
      agent: {} as Agent.Interface,
      truncate: {} as import("../../src/tool/truncate").Interface,
      internal: true,
    }
    const calls: string[] = []

    const result = await Effect.runPromise(
      KiloToolRegistry.build(defs, deps, {
        indexing: async () => {
          calls.push("indexing")
          return new Promise<never>(() => {})
        },
        analysis: async () => ({ CodebaseAnalysisTool: Effect.succeed(info("codebase_analysis")) }) as never,
        semantic: async () => ({ SemanticSearchTool: Effect.succeed(info("semantic_search")) }) as never,
        document: async () => ({ DocumentSearchTool: Effect.succeed(info("document_search")) }) as never,
      }),
    )

    expect(calls).toEqual([])
    expect(result.analysis?.id).toBe("codebase_analysis")
    expect(result.semantic?.id).toBe("semantic_search")
    expect(result.document?.id).toBe("document_search")
  })

  test("resolves internal retrieval visibility from fresh effective config on each model step", async () => {
    const def = (id: string): Tool.Def => ({
      id,
      description: id,
      parameters: Schema.String,
      execute: () => Effect.succeed({ title: id, output: id, metadata: {} }),
    })
    const tools = [
      def("glob"),
      def("grep"),
      def("read"),
      def("codebase_analysis"),
      def("semantic_search"),
      def("document_search"),
    ]
    const state = {
      cfg: {
        plugin: ["@kilocode/kilo-indexing"],
      } as Config.Info,
      reads: 0,
    }
    const source = {
      get: () =>
        Effect.sync(() => {
          state.reads++
          return state.cfg
        }),
      getGlobal: () =>
        Effect.sync(() => {
          state.reads++
          return {} as Config.Info
        }),
    }

    const publicTools = await Effect.runPromise(KiloToolRegistry.resolve(tools, source, false))
    expect(publicTools).toBe(tools)
    expect(state.reads).toBe(0)

    const enabled = await Effect.runPromise(KiloToolRegistry.resolve(tools, source, true))
    expect(enabled.map((tool) => tool.id)).toEqual([
      "glob",
      "grep",
      "read",
      "codebase_analysis",
      "semantic_search",
      "document_search",
    ])
    expect(enabled.find((tool) => tool.id === "glob")?.description).toContain("use `codebase_analysis` first")
    expect(enabled.find((tool) => tool.id === "grep")?.description).toContain("do not repeatedly retry")

    state.cfg = {
      plugin: ["@kilocode/kilo-indexing"],
      indexing: {
        enabled: false,
        documents: { enabled: false },
      },
    } as Config.Info
    const disabled = await Effect.runPromise(KiloToolRegistry.resolve(tools, source, true))
    expect(disabled.map((tool) => tool.id)).toEqual(["glob", "grep", "read", "codebase_analysis"])
    expect(disabled.find((tool) => tool.id === "glob")?.description).not.toContain("semantic_search")
    expect(disabled.find((tool) => tool.id === "glob")?.description).not.toContain("document_search")

    state.cfg = { indexing: { enabled: true, documents: { enabled: true } } } as Config.Info
    const missing = await Effect.runPromise(KiloToolRegistry.resolve(tools, source, true))
    expect(missing.map((tool) => tool.id)).toEqual(["glob", "grep", "read", "semantic_search", "document_search"])
  })

  test("logs indexing bootstrap failures without blocking session bootstrap", async () => {
    const logger = Log.create({ service: "kilocode-bootstrap" })
    const err = new Error("indexing init failed")
    const calls: string[] = []
    const sessions = Layer.succeed(
      KiloSessions.Service,
      KiloSessions.Service.of({ init: () => Effect.sync(() => calls.push("sessions")) }),
    )
    const indexing = spyOn(KiloIndexing, "init").mockRejectedValue(err)
    const warn = spyOn(logger, "warn").mockImplementation(() => {})

    try {
      await Effect.runPromise(
        KilocodeBootstrap.Service.use((svc) => svc.init()).pipe(
          Effect.provide(KilocodeBootstrap.layer.pipe(Layer.provide(sessions))),
          Effect.scoped,
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(calls).toEqual(["sessions"])
      expect(indexing).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith("indexing bootstrap failed", { err })
    } finally {
      indexing.mockRestore()
      warn.mockRestore()
    }
  })
})
