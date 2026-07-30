import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { KilocodeBootstrap } from "../../src/kilocode/bootstrap"
import { KilocodeWatcher } from "../../src/kilocode/watcher"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { InstanceState } from "../../src/effect/instance-state"
import { KiloToolRegistry } from "../../src/kilocode/tool/registry"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "../../src/session/session"
import { SessionSummary } from "../../src/session/summary"
import { ToolRegistry } from "../../src/tool/registry"
import type * as Tool from "../../src/tool/tool"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(Agent.defaultLayer, ToolRegistry.defaultLayer, node))
const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
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
            expect(ids).not.toContain("codesearch")
            expect(ids).toContain("question")
            expect(ids).toContain("read")
            expect(ids).toContain("embedded_review_submit")
            expect(ids).toContain("suggest")
            expect(ids).toContain("validate_mermaid_diagram")
            expect(ids).toContain("render_mermaid_diagram")
            expect(ids).toContain("render_plantuml_diagram")
            expect(ids).toContain("extract_plantuml_source")
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

  it.live("registers semantic search from config even when readiness throws", () =>
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
      { git: true, config: { indexing: { enabled: true } } },
    ),
  )

  it.live("registers semantic search from config even when readiness rejects", () =>
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
      { git: true, config: { indexing: { enabled: true } } },
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
      { git: true, config: { indexing: { enabled: true } } },
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

  it.live("keeps indexing tools available without CodeGraph routing when indexing is ready", () =>
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
            expect(glob).not.toContain("codebase_analysis")
            expect(glob).toContain("semantic_search")
            expect(glob).toContain("document_search")
            expect(grep).not.toContain("codebase_analysis")
            expect(grep).toContain("semantic_search")
            expect(grep).toContain("document_search")
          } finally {
            ready.mockRestore()
            analysisReady.mockRestore()
            documentReady.mockRestore()
          }
        }),
      { git: true, config: { indexing: { enabled: true } } },
    ),
  )

  it.live("omits interactive_terminal from subagent definitions", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const prev = process.env["KILO_CLIENT"]
        process.env["KILO_CLIENT"] = "cli"
        return prev
      }),
      () =>
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              const agent = yield* Agent.Service
              const build = yield* agent.get("build")
              const explore = yield* agent.get("explore")
              const registry = yield* ToolRegistry.Service
              const primary = yield* registry.tools({ ...ref, agent: build })
              const subagent = yield* registry.tools({ ...ref, agent: explore })

              expect(primary.map((tool) => tool.id)).toContain("interactive_terminal")
              expect(subagent.map((tool) => tool.id)).not.toContain("interactive_terminal")
            }),
          {
            git: true,
            config: { permission: { interactive_terminal: "allow" } },
          },
        ),
      (prev) =>
        Effect.sync(() => {
          if (prev === undefined) delete process.env["KILO_CLIENT"]
          if (prev !== undefined) process.env["KILO_CLIENT"] = prev
        }),
    ),
  )

  test("enables semantic search from indexing configuration before the index is ready", () => {
    expect(
      KiloToolRegistry.indexing({
        indexing: { enabled: true },
      }),
    ).toBe(true)
    expect(
      KiloToolRegistry.indexing({
        indexing: { enabled: false },
      }),
    ).toBe(false)
    expect(KiloToolRegistry.indexing({}, { indexing: { enabled: true } })).toBe(true)
  })

  it.live("omits memory tools when project memory is disabled but keeps kilo_local_recall", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const build = yield* agent.get("build")
          const registry = yield* ToolRegistry.Service
          const tools = yield* registry.tools({ ...ref, agent: build })
          const ids = tools.map((tool) => tool.id)

          expect(ids).not.toContain("kilo_memory_recall")
          expect(ids).not.toContain("kilo_memory_save")
          // kilo_local_recall is a transcript-recall tool gated by `recall: "ask"` in agent
          // permissions; it must NOT be coupled to project-memory enablement.
          expect(ids).toContain("kilo_local_recall")
        }),
      { git: true },
    ),
  )

  it.live("memoryToolsEnabled coalesces consecutive probes within the TTL", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const probe = spyOn(KiloMemory, "toolEnabled")

          try {
            const a = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
            const b = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
            const c = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })

            expect([a, b, c]).toEqual([false, false, false])
            // Cache hit: only the first call should reach KiloMemory.toolEnabled.
            expect(probe).toHaveBeenCalledTimes(1)
          } finally {
            probe.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("memoryToolsEnabled reflects enable/disable immediately after invalidate", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const root = (yield* Effect.promise(() => KiloMemory.prepare({ ctx }))).toString()

          const first = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
          expect(first).toBe(false)

          yield* Effect.promise(() => KiloMemory.enable({ ctx }))

          // The bootstrap MemoryEvents subscriber invalidates on mutation; call it directly here.
          KiloToolRegistry.invalidateMemoryEnabled(root)
          const afterEnable = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
          expect(afterEnable).toBe(true)

          yield* Effect.promise(() => KiloMemory.disable({ ctx }))

          KiloToolRegistry.invalidateMemoryEnabled(root)
          const afterDisable = yield* KiloToolRegistry.memoryToolsEnabled({ ctx })
          expect(afterDisable).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("includes memory tools when project memory is enabled", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          yield* Effect.promise(() => KiloMemory.enable({ ctx }))

          const agent = yield* Agent.Service
          const build = yield* agent.get("build")
          const registry = yield* ToolRegistry.Service
          const tools = yield* registry.tools({ ...ref, agent: build })
          const ids = tools.map((tool) => tool.id)

          expect(ids).toContain("kilo_memory_recall")
          expect(ids).toContain("kilo_memory_save")
          expect(ids).toContain("kilo_local_recall")
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
        def("validate_word_document"),
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
      managerModels: def("agent_manager_models"),
      memory: def("kilo_memory_recall"),
      save: def("kilo_memory_save"),
      manager: def("agent_manager"),
      process: def("background_process"),
      image: def("generate_image"),
      terminal: def("interactive_terminal"),
      notify: def("notify_user"),
      notebookRead: def("notebook_read"),
      notebookEdit: def("notebook_edit"),
      notebookExecute: def("notebook_execute"),
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
        "validate_word_document",
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
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "background_process",
        "interactive_terminal",
        "notify_user",
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
          "validate_word_document",
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
          "kilo_memory_recall",
          "kilo_memory_save",
          "recall",
          "background_process",
          "interactive_terminal",
          "notify_user",
        ],
      )
      expect(
        KiloToolRegistry.extra(tools, { experimental: { codebase_search: true, image_generation: true } }).map(
          (tool) => tool.id,
        ),
      ).toEqual([
        "codebase_search",
        "codebase_analysis",
        "generate_image",
        "semantic_search",
        "document_search",
        "declare_artifact",
        "list_artifacts",
        "open_artifact",
        "export_artifact_diagnostics",
        "create_word_document",
        "inspect_word_document",
        "validate_word_document",
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
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "background_process",
        "interactive_terminal",
        "notify_user",
      ])

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
          "validate_word_document",
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
          "kilo_memory_recall",
          "kilo_memory_save",
          "recall",
          "background_process",
          "agent_manager_models",
          "agent_manager",
          "notify_user",
        ],
      )
      expect(
        KiloToolRegistry.extra(tools, {
          experimental: { codebase_search: true, native_notebook_tools: true },
        }).map((tool) => tool.id),
      ).toEqual([
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
        "validate_word_document",
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
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "background_process",
        "agent_manager_models",
        "agent_manager",
        "notebook_read",
        "notebook_edit",
        "notebook_execute",
        "notify_user",
      ])
      expect(KiloToolRegistry.extra({ ...tools, semantic: undefined }, {}).map((tool) => tool.id)).toEqual([
        "codebase_analysis",
        "document_search",
        "declare_artifact",
        "list_artifacts",
        "open_artifact",
        "export_artifact_diagnostics",
        "create_word_document",
        "inspect_word_document",
        "validate_word_document",
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
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "background_process",
        "agent_manager_models",
        "agent_manager",
        "notify_user",
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
        "validate_word_document",
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
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "notify_user",
      ])

      process.env["KILO_CLIENT"] = "run"
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
        "validate_word_document",
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
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "notify_user",
      ])

      process.env["KILO_CLIENT"] = "acp"
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
        "validate_word_document",
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
        "kilo_memory_recall",
        "kilo_memory_save",
        "recall",
        "notify_user",
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
      managerModels: info("agent_manager_models"),
      memory: info("kilo_memory_recall"),
      save: info("kilo_memory_save"),
      manager: info("agent_manager"),
      process: info("background_process"),
      image: info("generate_image"),
      notify: info("notify_user"),
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

  test("keeps public exact-search descriptions free of CodeGraph routing", () => {
    const def = (id: string): Tool.Def => ({
      id,
      description: id,
      parameters: Schema.String,
      execute: () => Effect.succeed({ title: id, output: id, metadata: {} }),
    })
    const tools = [def("glob"), def("grep"), def("read")]
    const result = KiloToolRegistry.describe(
      tools,
      {
        analysis: def("codebase_analysis"),
        semantic: def("semantic_search"),
        document: def("document_search"),
      },
      true,
    )

    expect(result.find((tool) => tool.id === "glob")?.description).not.toContain("codebase_analysis")
    expect(result.find((tool) => tool.id === "grep")?.description).not.toContain("codebase_analysis")
    expect(result.find((tool) => tool.id === "glob")?.description).toContain("semantic_search")
    expect(result.find((tool) => tool.id === "glob")?.description).toContain("approved external directory")
    expect(result.find((tool) => tool.id === "grep")?.description).toContain(
      "omit `path` to search every configured document root",
    )
    expect(result.find((tool) => tool.id === "read")?.description).toBe("read")
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
    expect(enabled.find((tool) => tool.id === "glob")?.description).not.toContain("codebase_analysis")
    expect(enabled.find((tool) => tool.id === "grep")?.description).not.toContain("codebase_analysis")
    expect(enabled.find((tool) => tool.id === "glob")?.description).toContain(
      "Use `Grep` for exact identifiers or text",
    )
    expect(enabled.find((tool) => tool.id === "glob")?.description).toContain("approved external documents")
    expect(enabled.find((tool) => tool.id === "grep")?.description).toContain(
      "omit `path` to search every configured document root",
    )
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
      KiloSessions.Service.of({
        init: () => Effect.sync(() => calls.push("sessions")),
        sendAgentNotification: () => Effect.succeed({ ok: false as const, reason: "not_connected" }),
      }),
    )
    const bus = Layer.succeed(
      Bus.Service,
      Bus.Service.of({
        publish: () => Effect.void,
        subscribe: () => Effect.succeed(Stream.empty),
        subscribeAll: () => Effect.succeed(Stream.empty),
        subscribeCallback: () => Effect.succeed(() => {}),
        subscribeAllCallback: () => Effect.succeed(() => {}),
      }),
    )
    const memory = Layer.succeed(MemoryService.Service, MemoryService.make())
    const session = Layer.succeed(Session.Service, {} as Session.Interface)
    const summary = Layer.succeed(SessionSummary.Service, {} as SessionSummary.Interface)
    const provider = Layer.succeed(Provider.Service, {} as Provider.Interface)
    const watcher = Layer.succeed(KilocodeWatcher.Service, KilocodeWatcher.Service.of({ init: () => Effect.void }))
    const indexing = spyOn(KiloIndexing, "init").mockRejectedValue(err)
    const warn = spyOn(logger, "warn").mockImplementation(() => {})

    try {
      await Effect.runPromise(
        KilocodeBootstrap.Service.use((svc) => svc.init()).pipe(
          Effect.provide(
            KilocodeBootstrap.layer.pipe(Layer.provide([sessions, bus, memory, session, summary, provider, watcher])),
          ),
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
