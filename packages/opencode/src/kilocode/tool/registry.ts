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

const log = Log.create({ service: "kilocode-tool-registry" })
type Deps = { agent: Agent.Interface; truncate: Truncate.Interface }
type Loaders = {
  indexing?: () => Promise<{ KiloIndexing: { ready: () => boolean } }>
  semantic?: () => Promise<Pick<typeof import("@/kilocode/tool/semantic-search"), "SemanticSearchTool">>
  analysis?: () => Promise<Pick<typeof import("@/kilocode/tool/codebase-analysis"), "CodebaseAnalysisTool">>
}

export namespace KiloToolRegistry {
  const hint = [
    "- For C/C++ symbols, callers/callees/call chains, macro/register/MMIO usage, state machines, error paths, cleanup paths, module flow, or impact analysis, use the `codebase_analysis` tool first.",
    "- When you are doing an open-ended conceptual search where you do not know the exact symbol name, use the `semantic_search` tool first to narrow down the search scope, then follow up with `Grep` and/or `Read`.",
  ].join("\n")

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
      const ready = yield* indexingReady(loaders)
      const analysis = yield* analysisTool(deps, loaders, ready)
      const semantic = yield* semanticTool(deps, loaders, ready)
      return { ...base, analysis, semantic }
    })
  }

  function indexingReady(loaders: Loaders) {
    return Effect.gen(function* () {
      const indexing = loaders.indexing ?? (() => import("@/kilocode/indexing"))
      const ready = yield* Effect.tryPromise(() =>
        indexing().then((mod) => mod.KiloIndexing.ready()),
      ).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("indexing tools unavailable", { err })
            return false
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

  /** Kilo-specific tools to append to the builtin list */
  export function extra(
    tools: {
      codebase: Tool.Def
      analysis?: Tool.Def
      semantic?: Tool.Def
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
      tools.recall,
      ...(Flag.KILO_CLIENT === "cli" || Flag.KILO_CLIENT === "vscode" ? [tools.process] : []),
      // The extension is the only client that can consume the Agent Manager start event.
      ...(Flag.KILO_CLIENT === "vscode" ? [tools.manager] : []),
    ]
  }

  export function describe(tools: Tool.Def[], extra: { analysis?: Tool.Def; semantic?: Tool.Def }): Tool.Def[] {
    if (!extra.analysis && !extra.semantic) return tools
    return tools.map((tool) => {
      if (tool.id !== "glob" && tool.id !== "grep") return tool
      return { ...tool, description: `${tool.description}\n${hint}` }
    })
  }
}
