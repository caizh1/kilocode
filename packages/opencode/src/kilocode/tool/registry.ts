// kilocode_change - new file
import { CodebaseSearchTool } from "../../tool/warpgrep"
import { RecallTool } from "../../tool/recall"
import { AgentManagerTool } from "./agent-manager"
import { BackgroundProcessTool } from "./background-process"
import * as Tool from "../../tool/tool"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "@/agent/agent"
import * as Truncate from "@/tool/truncate"
import type { Config } from "@/config/config"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import { applyInternalIndexingDefaults, isInternalOffline } from "../internal-offline"

const log = Log.create({ service: "kilocode-tool-registry" })
type Deps = { agent: Agent.Interface; truncate: Truncate.Interface; internal?: boolean }
type ConfigSource = Pick<Config.Interface, "get" | "getGlobal">
type Loaders = {
  indexing?: () => Promise<{
    KiloIndexing: { ready: () => boolean; analysisReady?: () => boolean; documentReady?: () => boolean }
  }>
  semantic?: () => Promise<Pick<typeof import("@/kilocode/tool/semantic-search"), "SemanticSearchTool">>
  analysis?: () => Promise<Pick<typeof import("@/kilocode/tool/codebase-analysis"), "CodebaseAnalysisTool">>
  document?: () => Promise<Pick<typeof import("@/kilocode/tool/document-search"), "DocumentSearchTool">>
  artifact?: () => Promise<Pick<typeof import("@/kilocode/tool/document-artifacts"), "DocumentArtifactTools">>
  word?: () => Promise<Pick<typeof import("@/kilocode/tool/word-documents"), "WordDocumentTools">>
  mermaid?: () => Promise<Pick<typeof import("@/kilocode/tool/mermaid-documents"), "MermaidDocumentTools">>
}

export namespace KiloToolRegistry {
  const hint = [
    "- For C/C++ symbols, callers/callees/call chains, macro/register/MMIO usage, state machines, error paths, cleanup paths, module flow, or impact analysis, use the `codebase_analysis` tool first.",
    "- For configured workspace PDF, DOCX, XLSX, ODS, Markdown, CSV, TSV, RST, or text documents, use the `document_search` tool before answering document-grounded questions.",
    "- When you are doing an open-ended conceptual search where you do not know the exact symbol name, use the `semantic_search` tool first to narrow down the search scope, then follow up with `Grep` and/or `Read`.",
  ].join("\n")

  const route = (ids: Set<string>) =>
    [
      ids.has("codebase_analysis")
        ? "- For C/C++ symbols, call chains, state machines, registers, MMIO, or impact analysis, use `codebase_analysis` first."
        : undefined,
      ids.has("document_search")
        ? "- For questions grounded in workspace documents, use `document_search` first."
        : undefined,
      ids.has("semantic_search")
        ? "- For unfamiliar code concepts without an exact identifier, use `semantic_search` first."
        : undefined,
      "- Use `Grep` for exact identifiers or text, `Glob` for filenames, and `Read` to verify retrieved evidence.",
      "- If an index reports that it is not ready, use the exact-search tools for this request and do not repeatedly retry the retrieval tool.",
    ]
      .filter((item): item is string => item !== undefined)
      .join("\n")

  export function internal(): boolean {
    return isInternalOffline()
  }

  /** Resolve Kilo-specific tool Infos outside any InstanceState, so their Truncate/Agent deps are
   * satisfied at the outer registry scope instead of leaking into InstanceState's Effect. */
  export function infos() {
    return Effect.gen(function* () {
      const codebase = yield* CodebaseSearchTool
      const recall = yield* RecallTool
      const manager = yield* AgentManagerTool
      const process = yield* BackgroundProcessTool
      return { codebase, recall, manager, process }
    })
  }

  /** Finalize Kilo-specific tools into Tool.Defs. Call this inside the InstanceState state Effect —
   * it has no Service deps beyond what Tool.init itself needs. */
  export function build(
    tools: { codebase: Tool.Info; recall: Tool.Info; manager: Tool.Info; process: Tool.Info },
    deps: Deps,
    loaders: Loaders = {},
  ) {
    return Effect.gen(function* () {
      const base = yield* Effect.all({
        codebase: Tool.init(tools.codebase),
        recall: Tool.init(tools.recall),
        manager: Tool.init(tools.manager),
        process: Tool.init(tools.process),
      })
      const ready =
        (deps.internal ?? internal())
          ? { analysis: true, semantic: true, document: true }
          : yield* indexingReady(loaders)
      const analysis = yield* analysisTool(deps, loaders, ready.analysis)
      const semantic = yield* semanticTool(deps, loaders, ready.semantic)
      const document = yield* documentTool(deps, loaders, ready.document)
      const artifacts = yield* artifactTools(deps, loaders)
      const word = yield* wordTools(deps, loaders)
      const mermaid = yield* mermaidTools(deps, loaders)
      return { ...base, analysis, semantic, document, artifacts, word, mermaid }
    })
  }

  function indexingReady(loaders: Loaders) {
    return Effect.gen(function* () {
      const indexing = loaders.indexing ?? (() => import("@/kilocode/indexing"))
      const ready = yield* Effect.tryPromise(() =>
        indexing().then(async (mod) => {
          const semantic = await Promise.resolve(mod.KiloIndexing.ready())
          const analysis = mod.KiloIndexing.analysisReady
            ? await Promise.resolve(mod.KiloIndexing.analysisReady())
            : semantic
          const document = mod.KiloIndexing.documentReady
            ? await Promise.resolve(mod.KiloIndexing.documentReady())
            : false
          return { analysis, semantic, document }
        }),
      ).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("indexing tools unavailable", { err })
            return { analysis: false, semantic: false, document: false }
          }),
        ),
      )
      return ready
    })
  }

  function analysisTool(deps: Deps, loaders: Loaders, ready: boolean) {
    return Effect.gen(function* () {
      if (!ready) return undefined

      const analysis = loaders.analysis ?? (() => import("@/kilocode/tool/codebase-analysis"))
      const mod = yield* Effect.tryPromise(() => analysis()).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("codebase analysis tool unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return undefined

      const info = yield* mod.CodebaseAnalysisTool.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      if (!info) return undefined
      return yield* Tool.init(info)
    })
  }

  function semanticTool(deps: Deps, loaders: Loaders, ready: boolean) {
    return Effect.gen(function* () {
      if (!ready) return undefined

      const semantic = loaders.semantic ?? (() => import("@/kilocode/tool/semantic-search"))
      const mod = yield* Effect.tryPromise(() => semantic()).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("semantic search tool unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return undefined

      const info = yield* mod.SemanticSearchTool.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      if (!info) return undefined
      return yield* Tool.init(info)
    })
  }

  function documentTool(deps: Deps, loaders: Loaders, ready: boolean) {
    return Effect.gen(function* () {
      if (!ready) return undefined

      const document = loaders.document ?? (() => import("@/kilocode/tool/document-search"))
      const mod = yield* Effect.tryPromise(() => document()).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("document search tool unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return undefined

      const info = yield* mod.DocumentSearchTool.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      if (!info) return undefined
      return yield* Tool.init(info)
    })
  }

  function artifactTools(deps: Deps, loaders: Loaders) {
    return Effect.gen(function* () {
      const artifact = loaders.artifact ?? (() => import("@/kilocode/tool/document-artifacts"))
      const mod = yield* Effect.tryPromise(() => artifact()).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("document artifact tools unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return []

      const infos = yield* mod.DocumentArtifactTools.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      return yield* Effect.all([
        Tool.init(infos.declare),
        Tool.init(infos.list),
        Tool.init(infos.open),
        Tool.init(infos.diagnostics),
      ])
    })
  }

  function wordTools(deps: Deps, loaders: Loaders) {
    return Effect.gen(function* () {
      const word = loaders.word ?? (() => import("@/kilocode/tool/word-documents"))
      const mod = yield* Effect.tryPromise(() => word()).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("word document tools unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return []

      const infos = yield* mod.WordDocumentTools.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      return yield* Effect.all([
        Tool.init(infos.create),
        Tool.init(infos.inspect),
        Tool.init(infos.applyEdits),
        Tool.init(infos.applyTemplateStyles),
        Tool.init(infos.materializeFields),
        Tool.init(infos.merge),
        Tool.init(infos.diff),
        Tool.init(infos.normalizeTableSpec),
        Tool.init(infos.render),
      ])
    })
  }

  function mermaidTools(deps: Deps, loaders: Loaders) {
    return Effect.gen(function* () {
      const mermaid = loaders.mermaid ?? (() => import("@/kilocode/tool/mermaid-documents"))
      const mod = yield* Effect.tryPromise(() => mermaid()).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("mermaid document tools unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return []

      const infos = yield* mod.MermaidDocumentTools.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      return yield* Effect.all([
        Tool.init(infos.validate),
        Tool.init(infos.render),
        Tool.init(infos.save),
        Tool.init(infos.insertIntoWord),
      ])
    })
  }

  /** Kilo-specific tools to append to the builtin list */
  export function extra(
    tools: {
      codebase: Tool.Def
      analysis?: Tool.Def
      semantic?: Tool.Def
      document?: Tool.Def
      artifacts?: Tool.Def[]
      word?: Tool.Def[]
      mermaid?: Tool.Def[]
      recall: Tool.Def
      manager: Tool.Def
      process: Tool.Def
    },
    cfg: { experimental?: { codebase_search?: boolean } },
  ): Tool.Def[] {
    return [
      ...(cfg.experimental?.codebase_search === true ? [tools.codebase] : []),
      ...(tools.analysis ? [tools.analysis] : []),
      ...(tools.semantic ? [tools.semantic] : []),
      ...(tools.document ? [tools.document] : []),
      ...(tools.artifacts ?? []),
      ...(tools.word ?? []),
      ...(tools.mermaid ?? []),
      tools.recall,
      ...(Flag.KILO_CLIENT === "cli" || Flag.KILO_CLIENT === "vscode" ? [tools.process] : []),
      // The extension is the only client that can consume the Agent Manager start event.
      ...(Flag.KILO_CLIENT === "vscode" ? [tools.manager] : []),
    ]
  }

  export function describe(
    tools: Tool.Def[],
    extra: { analysis?: Tool.Def; semantic?: Tool.Def; document?: Tool.Def },
    enabled = true,
  ): Tool.Def[] {
    if (!enabled) return tools
    if (!extra.analysis && !extra.semantic && !extra.document) return tools
    return tools.map((tool) => {
      if (tool.id !== "glob" && tool.id !== "grep") return tool
      return { ...tool, description: `${tool.description}\n${hint}` }
    })
  }

  /** Internal/offline builds preload retrieval definitions, then resolve their model visibility from
   * effective config on every model step. Runtime indexing readiness never controls visibility here. */
  export function resolve(tools: Tool.Def[], source: ConfigSource, enabled = internal()) {
    return Effect.gen(function* () {
      if (!enabled) return tools

      const cfg = yield* source.get()
      const global = yield* source.getGlobal()
      const indexing = applyInternalIndexingDefaults({ ...global.indexing, ...cfg.indexing }, true)
      const plugins = [...(global.plugin ?? []), ...(cfg.plugin ?? [])]
      const allow = {
        codebase_analysis: hasIndexingPlugin(plugins),
        semantic_search: indexing?.enabled === true,
        document_search: indexing?.documents?.enabled === true,
      }
      const filtered = tools.filter((tool) => {
        if (tool.id === "codebase_analysis") return allow.codebase_analysis
        if (tool.id === "semantic_search") return allow.semantic_search
        if (tool.id === "document_search") return allow.document_search
        return true
      })
      const ids = new Set(filtered.map((tool) => tool.id))
      if (!ids.has("codebase_analysis") && !ids.has("semantic_search") && !ids.has("document_search")) {
        return filtered
      }
      const routing = route(ids)
      return filtered.map((tool) => {
        if (tool.id !== "glob" && tool.id !== "grep") return tool
        return { ...tool, description: `${tool.description}\n${routing}` }
      })
    })
  }
}
