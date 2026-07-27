// kilocode_change - new file
import { CodebaseSearchTool } from "../../tool/warpgrep"
import { RecallTool } from "../../tool/recall"
import { AgentManagerModelsTool } from "./agent-manager-models"
import { AgentManagerTool } from "./agent-manager"
import { BackgroundProcessTool } from "./background-process"
import { GenerateImageTool } from "./generate-image"
import { InteractiveTerminalTool } from "./interactive-terminal"
import { AgentConsoleShellTool } from "./agent-console-shell"
import { NotebookEditTool, NotebookExecuteTool, NotebookReadTool } from "./notebook-host"
import { SkillMarketTools } from "./skill-market"
import { MemoryRecallTool } from "./memory-recall"
import { MemorySaveTool } from "./memory-save"
import * as Tool from "../../tool/tool"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect } from "effect"
import { Notebook } from "@/kilocode/notebook/service"
import { SkillMarket, HostError as SkillMarketHostError } from "@/kilocode/skill-market/service"
import { AgentManager, HostError } from "@/kilocode/agent-manager/service"
import * as Log from "@opencode-ai/core/util/log"
import type { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import * as Truncate from "@/tool/truncate"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import { applyInternalIndexingDefaults, isInternalOffline } from "../internal-offline"
import { InstanceState } from "@/effect/instance-state"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"
import type { Parameters as TaskParameters } from "@/tool/task"
import { UltraCouncilTools } from "./ultra-council"
import { UltraCouncil } from "../agent/ultra-council"
import { ProductProfile } from "../product-profile"

const log = Log.create({ service: "kilocode-tool-registry" })
type ConfigSource = Pick<Config.Interface, "get" | "getGlobal">
type Deps = {
  agent: Agent.Interface
  truncate: Truncate.Interface
  task?: Tool.Def<typeof TaskParameters>
  internal?: boolean
  indexing?: boolean
}
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
  plantuml?: () => Promise<Pick<typeof import("@/kilocode/tool/plantuml-diagram"), "PlantUmlDiagramTools">>
  plantumlSource?: () => Promise<Pick<typeof import("@/kilocode/tool/plantuml-source"), "ExtractPlantUmlSourceTool">>
}

export namespace KiloToolRegistry {
  const hint = [
    "- For configured workspace PDF, DOCX, XLSX, ODS, Markdown, CSV, TSV, RST, or text documents, use the `document_search` tool before answering document-grounded questions.",
    "- When you are doing an open-ended conceptual search where you do not know the exact symbol name, use the `semantic_search` tool first to narrow down the search scope, then follow up with `Grep` and/or `Read`.",
  ].join("\n")

  const route = (ids: Set<string>) =>
    [
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

  export function indexing(
    config: Pick<Config.Info, "indexing">,
    global?: Pick<Config.Info, "indexing">,
  ): boolean | undefined {
    return config.indexing?.enabled ?? global?.indexing?.enabled
  }

  export function usePatch(input: { modelID: string; family?: string }) {
    if (process.env["KILO_E2E_LLM_URL"]) return true

    const id = input.modelID.toLowerCase()
    const family = input.family?.toLowerCase()
    if (id.includes("gpt-4") || family?.startsWith("gpt-4")) return false
    if (id.includes("oss") || family?.includes("oss") || family === "gpt-image") return false
    if (id.includes("gpt-")) return true
    return family?.startsWith("gpt") ?? false
  }

  /** Resolve Kilo-specific tool Infos outside any InstanceState, so their Truncate/Agent deps are
   * satisfied at the outer registry scope instead of leaking into InstanceState's Effect. */
  const unavailable = AgentManager.Service.of({
    request: () =>
      Effect.fail(
        new HostError({ code: "disconnected", detail: "Agent Manager orchestration is unavailable in this runtime" }),
      ),
    list: () => Effect.succeed([]),
    reply: () => Effect.die(new Error("Agent Manager orchestration is unavailable in this runtime")),
    reject: () => Effect.die(new Error("Agent Manager orchestration is unavailable in this runtime")),
  })

  const unavailableMarket = SkillMarket.Service.of({
    request: () =>
      Effect.fail(
        new SkillMarketHostError({
          code: "host_unavailable",
          detail: "Skill Market operations are unavailable in this runtime",
        }),
      ),
    list: () => Effect.succeed([]),
    reply: () => Effect.die(new Error("Skill Market operations are unavailable in this runtime")),
    reject: () => Effect.die(new Error("Skill Market operations are unavailable in this runtime")),
  })

  export function infos(host?: AgentManager.Interface, notebook?: Notebook.Interface, market?: SkillMarket.Interface) {
    return Effect.gen(function* () {
      const codebase = yield* CodebaseSearchTool
      const recall = yield* RecallTool
      const managerModels = yield* AgentManagerModelsTool
      const memory = yield* MemoryRecallTool
      const save = yield* MemorySaveTool
      const manager = yield* AgentManagerTool.pipe(Effect.provideService(AgentManager.Service, host ?? unavailable))
      const process = yield* BackgroundProcessTool
      const image = yield* GenerateImageTool
      const terminal = yield* InteractiveTerminalTool
      const consoleShell = yield* AgentConsoleShellTool
      const markets = yield* SkillMarketTools.pipe(
        Effect.provideService(SkillMarket.Service, market ?? unavailableMarket),
      )
      if (!notebook)
        return {
          codebase,
          recall,
          managerModels,
          memory,
          save,
          manager,
          process,
          image,
          terminal,
          consoleShell,
          markets,
        }
      const tools = yield* Effect.all({
        notebookRead: NotebookReadTool,
        notebookEdit: NotebookEditTool,
        notebookExecute: NotebookExecuteTool,
      }).pipe(Effect.provideService(Notebook.Service, notebook))
      return {
        codebase,
        recall,
        managerModels,
        memory,
        save,
        manager,
        process,
        image,
        terminal,
        consoleShell,
        markets,
        ...tools,
      }
    })
  }

  /** Finalize Kilo-specific tools into Tool.Defs. Call this inside the InstanceState state Effect —
   * it has no Service deps beyond what Tool.init itself needs. */
  export function build(
    tools: {
      codebase: Tool.Info
      recall: Tool.Info
      managerModels: Tool.Info
      memory: Tool.Info
      save: Tool.Info
      manager: Tool.Info
      process: Tool.Info
      image: Tool.Info
      terminal?: Tool.Info
      consoleShell?: Tool.Info
      notebookRead?: Tool.Info
      notebookEdit?: Tool.Info
      notebookExecute?: Tool.Info
      markets?: {
        search: Tool.Info
        install: Tool.Info
        create: Tool.Info
        publish: Tool.Info
        transaction: Tool.Info
      }
    },
    deps: Deps,
    loaders: Loaders = {},
  ) {
    return Effect.gen(function* () {
      const base = yield* Effect.all({
        codebase: Tool.init(tools.codebase),
        recall: Tool.init(tools.recall),
        managerModels: Tool.init(tools.managerModels),
        memory: Tool.init(tools.memory),
        save: Tool.init(tools.save),
        manager: Tool.init(tools.manager),
        process: Tool.init(tools.process),
        image: Tool.init(tools.image),
        ...(tools.consoleShell ? { consoleShell: Tool.init(tools.consoleShell) } : {}),
      })
      const terminal = tools.terminal ? yield* Tool.init(tools.terminal) : undefined
      const notebooks =
        tools.notebookRead && tools.notebookEdit && tools.notebookExecute
          ? yield* Effect.all({
              notebookRead: Tool.init(tools.notebookRead),
              notebookEdit: Tool.init(tools.notebookEdit),
              notebookExecute: Tool.init(tools.notebookExecute),
            })
          : {}
      const markets = tools.markets
        ? yield* Effect.all({
            search: Tool.init(tools.markets.search),
            install: Tool.init(tools.markets.install),
            create: Tool.init(tools.markets.create),
            publish: Tool.init(tools.markets.publish),
            transaction: Tool.init(tools.markets.transaction),
          })
        : undefined
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
      const plantuml = yield* plantumlTools(deps, loaders)
      const plantumlSource = yield* plantumlSourceTool(deps, loaders)
      const ultra =
        deps.task && ProductProfile.chipmate
          ? yield* Effect.gen(function* () {
              const infos = yield* UltraCouncilTools(deps.task!, document).pipe(
                Effect.provideService(Agent.Service, deps.agent),
                Effect.provideService(Truncate.Service, deps.truncate),
              )
              return yield* Effect.all([
                Tool.init(infos.explore),
                Tool.init(infos.adjudicate),
                Tool.init(infos.revise),
                Tool.init(infos.arbitrate),
              ])
            })
          : []
      return {
        ...base,
        terminal,
        ...notebooks,
        markets,
        analysis,
        semantic,
        document,
        artifacts,
        word,
        mermaid,
        plantuml: [...plantuml, ...plantumlSource],
        ultra,
      }
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
        Tool.init(infos.validate),
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

  function plantumlTools(deps: Deps, loaders: Loaders) {
    return Effect.gen(function* () {
      const plantuml = loaders.plantuml ?? (() => import("@/kilocode/tool/plantuml-diagram"))
      const mod = yield* Effect.tryPromise(() => plantuml()).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("PlantUML diagram tool unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return []

      const infos = yield* mod.PlantUmlDiagramTools.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      return yield* Effect.all([Tool.init(infos.render)])
    })
  }

  function plantumlSourceTool(deps: Deps, loaders: Loaders) {
    return Effect.gen(function* () {
      const source = loaders.plantumlSource ?? (() => import("@/kilocode/tool/plantuml-source"))
      const mod = yield* Effect.tryPromise(() => source()).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("PlantUML source extraction tool unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return []

      const info = yield* mod.ExtractPlantUmlSourceTool.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      return [yield* Tool.init(info)]
    })
  }

  /** Hide human-driven tools from agents that cannot interact with the user directly. */
  export function available(tool: Tool.Def, agent: Agent.Info) {
    if (agent.name === "agent-console") return tool.id === "agent_console_shell"
    if (tool.id === "agent_console_shell") return false
    if (
      tool.id === "ultra_council_explore" ||
      tool.id === "ultra_council_adjudicate" ||
      tool.id === "ultra_council_revise" ||
      tool.id === "ultra_submit_arbitration"
    ) {
      return UltraCouncil.active(agent)
    }
    if (tool.id === "render_plantuml_diagram") return ["ask", "code", "plan"].includes(agent.name)
    if (tool.id === "extract_plantuml_source") return ["ask", "code", "ultra"].includes(agent.name)
    if (tool.id !== "interactive_terminal") return true
    return agent.mode === "primary"
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
      plantuml?: Tool.Def[]
      ultra?: Tool.Def[]
      recall: Tool.Def
      managerModels: Tool.Def
      memory: Tool.Def
      save: Tool.Def
      manager: Tool.Def
      process: Tool.Def
      image: Tool.Def
      terminal?: Tool.Def
      consoleShell?: Tool.Def
      notebookRead?: Tool.Def
      notebookEdit?: Tool.Def
      notebookExecute?: Tool.Def
      markets?: {
        search: Tool.Def
        install: Tool.Def
        create: Tool.Def
        publish: Tool.Def
        transaction: Tool.Def
      }
    },
    cfg: { experimental?: { codebase_search?: boolean; image_generation?: boolean; native_notebook_tools?: boolean } },
    opts: { market?: boolean } = {},
  ): Tool.Def[] {
    return [
      ...(cfg.experimental?.codebase_search === true ? [tools.codebase] : []),
      ...(tools.analysis ? [tools.analysis] : []),
      ...(cfg.experimental?.image_generation === true ? [tools.image] : []),
      ...(tools.semantic ? [tools.semantic] : []),
      ...(tools.document ? [tools.document] : []),
      ...(tools.artifacts ?? []),
      ...(tools.word ?? []),
      ...(tools.mermaid ?? []),
      ...(tools.plantuml ?? []),
      ...(tools.ultra ?? []),
      tools.memory,
      tools.save,
      tools.recall,
      ...(Flag.KILO_CLIENT === "cli" || Flag.KILO_CLIENT === "vscode" ? [tools.process] : []),
      ...(Flag.KILO_CLIENT === "cli" && tools.terminal ? [tools.terminal] : []),
      ...(Flag.KILO_CLIENT === "vscode" && tools.consoleShell ? [tools.consoleShell] : []),
      // Agent Manager tools are useful only when the extension can create and display their sessions.
      ...(Flag.KILO_CLIENT === "vscode" ? [tools.managerModels, tools.manager] : []),
      ...(Flag.KILO_CLIENT === "vscode" && opts.market !== false && tools.markets ? Object.values(tools.markets) : []),
      ...(Flag.KILO_CLIENT === "vscode" &&
      cfg.experimental?.native_notebook_tools === true &&
      tools.notebookRead &&
      tools.notebookEdit &&
      tools.notebookExecute
        ? [tools.notebookRead, tools.notebookEdit, tools.notebookExecute]
        : []),
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

  // Re-keyed to root string so invalidate() works across ctx identities.
  const memoryEnabledCache = new Map<string, { enabled: boolean; deadline: number }>()
  const MEMORY_ENABLED_CACHE_MAX = 512
  const MEMORY_ENABLED_TTL_MS = 5_000

  /** Drop the cached enabled flag for a root so the next probe re-reads fresh state.
   * Called by the MemoryEvents subscriber in bootstrap on every state mutation. */
  export function invalidateMemoryEnabled(root: string) {
    memoryEnabledCache.delete(root)
  }

  /** Per-turn cache of `KiloMemory.toolEnabled` keyed by root string, with a short TTL so the
   * step-loop coalesces probes inside a single turn. Cache is invalidated immediately on enable /
   * disable / purge / rebuild via the MemoryEvents bus (subscribed in kilocode/bootstrap.ts). */
  export function memoryToolsEnabled(input: { ctx: MemoryPaths.Ctx }) {
    return Effect.gen(function* () {
      const root = MemoryPaths.root({ ctx: input.ctx })
      const cached = memoryEnabledCache.get(root)
      if (cached && cached.deadline > Date.now()) return cached.enabled
      const enabled = yield* Effect.tryPromise({
        try: () => KiloMemory.toolEnabled({ ctx: input.ctx }),
        catch: (err) => err,
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("memory tools unavailable", { error: String(err) })
            return false
          }),
        ),
      )
      memoryEnabledCache.set(root, { enabled, deadline: Date.now() + MEMORY_ENABLED_TTL_MS })
      if (memoryEnabledCache.size > MEMORY_ENABLED_CACHE_MAX) {
        const oldest = memoryEnabledCache.keys().next().value
        if (oldest !== undefined) memoryEnabledCache.delete(oldest)
      }
      return enabled
    })
  }
  /** Hide Kilo memory tools from the model when project memory is disabled. */
  export const applyVisibility = Effect.fn("KiloToolRegistry.applyVisibility")(function* (tools: Tool.Def[]) {
    const ctx = yield* InstanceState.context
    const memoryEnabled = yield* memoryToolsEnabled({ ctx })
    return tools.filter((tool) => {
      if (tool.id.startsWith("kilo_memory_")) return memoryEnabled
      return true
    })
  })

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
