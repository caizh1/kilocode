import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // chipmate_change
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { PlanExitTool } from "./plan"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
// chipmate_change start
import { SuggestTool } from "../chipmate/suggestion/tool"
import { Command } from "@/command"
// chipmate_change end
import { ShellTool } from "./shell"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { Database } from "@opencode-ai/core/database/database"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@chipmate/plugin"
import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"
import { Schema } from "effect"
import z from "zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"

import { WebSearchTool } from "./websearch"
import { ChipMateToolRegistry } from "../chipmate/tool/registry" // chipmate_change
import { Notebook } from "@/chipmate/notebook/service" // chipmate_change
import { AgentManager } from "@/chipmate/agent-manager/service" // chipmate_change
import { RepoOverviewTool } from "@/chipmate/tool/repo-overview" // chipmate_change
import { RepoCloneTool } from "./repo_clone" // chipmate_change
import { Flag } from "@opencode-ai/core/flag/flag" // chipmate_change
import { Auth } from "@/auth" // chipmate_change
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Option } from "effect" // chipmate_change
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { HttpClient } from "effect/unstable/http" // chipmate_change
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Bus } from "../bus"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { SessionStatus } from "@/session/status" // chipmate_change
import { ChipMateSessions } from "@/chipmate-sessions/chipmate-sessions" // chipmate_change - provide ChipMateSessions.Service so the notify_user tool's init resolves
import { Git } from "@/git" // chipmate_change
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as ToolNetwork from "@/chipmate/sandbox/network" // chipmate_change
import { MemoryService } from "@chipmate/chipmate-memory/effect/service" // chipmate_change
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { RepositoryCache } from "@opencode-ai/core/repository-cache" // chipmate_change
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary" // chipmate_change
import { AppProcess } from "@opencode-ai/core/process" // chipmate_change

export function webSearchEnabled(
  providerID: ProviderV2.ID,
  flags = { exa: Flag.CHIPMATE_ENABLE_EXA, parallel: Flag.CHIPMATE_ENABLE_PARALLEL },
) {
  return providerID === ProviderV2.ID.chipmate || flags.exa || flags.parallel // chipmate_change
}

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  // chipmate_change start
  readonly tools: (model: {
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    family?: string
    agent: Agent.Info
  }) => Effect.Effect<Tool.Def[]>
  // chipmate_change end
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolRegistry") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service // chipmate_change - keep the available skill summary in model-facing tool context
    const truncate = yield* Truncate.Service
    const flags = yield* RuntimeFlags.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const clone = yield* RepoCloneTool // chipmate_change
    const overview = yield* RepoOverviewTool // chipmate_change
    const shell = yield* ShellTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const agent = yield* Agent.Service
    // chipmate_change start
    const suggesttool = yield* SuggestTool
    const manager = Option.getOrUndefined(yield* Effect.serviceOption(AgentManager.Service))
    const notebook = Option.getOrUndefined(yield* Effect.serviceOption(Notebook.Service))
    const chipmateToolInfos = yield* ChipMateToolRegistry.infos(manager, notebook).pipe(Effect.provide(MemoryService.layer))
    // chipmate_change end

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          // Plugin tools still expose Zod args publicly; keep that compatibility
          // boxed at the registry boundary and give the LLM the original JSON Schema.
          // Normalize missing args to `{}` once — pre-1.14.49 the code was
          // `z.object(def.args)` and Zod silently tolerated undefined (#27451, #27630).
          const args = def.args ?? {}
          const entries = Object.entries(args)
          const allZod = entries.every((entry) => isZodType(entry[1]))
          const zodParams = allZod ? z.object(args) : undefined
          const jsonSchema = zodParams ? zodJsonSchema(zodParams) : legacyJsonSchema(entries)
          const parameters = zodParams
            ? Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success)
            : Schema.Unknown
          return {
            id,
            parameters,
            jsonSchema,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                // Bridge the host's Effect-based `ask` into a Promise-returning
                // function for the plugin to make sure context persists
                const bridge = yield* EffectBridge.make()
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => bridge.promise(toolCtx.ask(req)),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const attachments = typeof result === "string" ? undefined : result.attachments
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: typeof result === "string" ? "" : (result.title ?? ""),
                  output: out.truncated ? out.content : output,
                  attachments,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }).pipe(
                Effect.withSpan("Tool.execute", {
                  attributes: {
                    "tool.name": id,
                    "session.id": toolCtx.sessionID,
                    "message.id": toolCtx.messageID,
                    ...(toolCtx.callID ? { "tool.call_id": toolCtx.callID } : {}),
                  },
                }),
              ),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries(mod)) {
            if (!isPluginTool(def)) continue
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        // chipmate_change start
        const cfg = yield* config.get()
        const global = yield* config.getGlobal()
        const indexing = ChipMateToolRegistry.indexing(cfg, global)
        // chipmate_change end
        const questionEnabled = ["app", "cli", "desktop", "vscode"].includes(flags.client) || flags.enableQuestionTool // chipmate_change: add vscode client

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          shell: Tool.init(shell),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          fetch: Tool.init(webfetch),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          clone: Tool.init(clone), // chipmate_change
          overview: Tool.init(overview), // chipmate_change
          skill: Tool.init(skilltool),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
          suggest: Tool.init(suggesttool), // chipmate_change
        })

        // chipmate_change start
        const chipmate = yield* ChipMateToolRegistry.build(chipmateToolInfos, {
          agent: agents,
          truncate,
          task: tool.task, // chipmate_change - Ultra runtime registration requires the real Task tool
          indexing: indexing ?? false,
        })
        // chipmate_change end

        return {
          custom,
          // chipmate_change start
          builtin: ChipMateToolRegistry.describe(
            [
              tool.invalid,
              ...(questionEnabled ? [tool.question] : []),
              tool.shell,
              tool.read,
              tool.glob,
              tool.grep,
              tool.edit,
              tool.write,
              tool.task,
              tool.fetch,
              tool.todo,
              tool.search,
              ...(flags.experimentalScout ? [tool.clone, tool.overview] : []), // chipmate_change
              tool.skill,
              tool.patch,
              tool.plan,
              ...(["cli", "vscode"].includes(flags.client) ? [tool.suggest] : []),
              ...ChipMateToolRegistry.extra(chipmate, cfg),
              ...(flags.experimentalLspTool ? [tool.lsp] : []),
            ],
            chipmate,
          ),
          // chipmate_change end
          task: tool.task,
          read: tool.read,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin.map(ToolNetwork.builtin), ...s.custom] as Tool.Def[] // chipmate_change
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    // chipmate_change start - retain the concise skill inventory added to the skill tool description
    const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* (agent: Agent.Info) {
      const list = yield* skill.available(agent)
      if (list.length === 0) return "No skills are currently available."
      return [
        "Load a specialized skill that provides domain-specific instructions and workflows.",
        "",
        "When a task matches one of the available skills below, load its full instructions with this tool.",
        "",
        Skill.fmt(list, { verbose: false }),
      ].join("\n")
    })
    // chipmate_change end

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const cfg = yield* config.get() // chipmate_change
      const filtered = (yield* all()).filter((tool) => {
        if (!ChipMateToolRegistry.available(tool, input.agent)) return false // chipmate_change
        if (tool.id === WebSearchTool.id) {
          if (cfg.web_search === true) return true // chipmate_change
          return webSearchEnabled(input.providerID, { exa: flags.enableExa, parallel: flags.enableParallel })
        }

        const usePatch = ChipMateToolRegistry.usePatch(input) // chipmate_change
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id) return !usePatch // chipmate_change

        return true
      })
      const chipmateFiltered = yield* ChipMateToolRegistry.applyVisibility(filtered) // chipmate_change

      return yield* Effect.forEach(
        chipmateFiltered, // chipmate_change
        Effect.fnUntraced(function* (tool: Tool.Def) {
          const output = {
            description: tool.description,
            parameters: tool.parameters,
            jsonSchema: tool.jsonSchema,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          const jsonSchema =
            output.parameters === tool.parameters || output.jsonSchema !== tool.jsonSchema
              ? output.jsonSchema
              : undefined
          // chipmate_change start
          const result = {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === SkillTool.id ? yield* describeSkill(input.agent) : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            jsonSchema,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
          return ToolNetwork.isBuiltin(tool) ? ToolNetwork.builtin(result) : result
          // chipmate_change end
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, named, tools })
  }),
)

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() => AppNodeBuilder.build(node)) // chipmate_change - build from the LayerNode graph

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value
}

function isPluginTool(value: unknown): value is ToolDefinition {
  return typeof value === "object" && value !== null && "args" in value && "description" in value && "execute" in value
}

function isJsonSchemaDefinition(value: unknown): value is JSONSchema7Definition {
  return typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value))
}

function legacyJsonSchema(entries: [string, unknown][]): JSONSchema7 {
  const properties = Object.fromEntries(
    entries.filter((entry): entry is [string, JSONSchema7Definition] => isJsonSchemaDefinition(entry[1])),
  )
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  }
}

function zodJsonSchema(schema: z.ZodType): JSONSchema7 {
  const result = normalizeZodJsonSchema(z.toJSONSchema(schema, { io: "input", metadata: zodMetadataRegistry(schema) }))
  if (!isJsonSchemaObject(result)) throw new Error("plugin tool Zod schema produced a non-object JSON Schema")
  const { $defs, ...rest } = result
  return (
    $defs && isJsonSchemaObject($defs) ? { ...rest, definitions: $defs as JSONSchema7["definitions"] } : rest
  ) as JSONSchema7
}

function zodMetadataRegistry(schema: z.ZodType) {
  const registry = z.registry<Record<string, unknown>>()
  const seen = new WeakSet<object>()
  const collect = (value: unknown) => {
    if (typeof value !== "object" || value === null) return
    if (seen.has(value)) return
    seen.add(value)

    if (isZodType(value)) {
      const metadata = typeof value.meta === "function" ? value.meta() : undefined
      const description = typeof value.description === "string" ? value.description : undefined
      const merged = {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        ...(description ? { description } : {}),
      }
      if (Object.keys(merged).length) registry.add(value, merged)
      collect(value._zod.def)
      return
    }

    for (const item of Object.values(value)) collect(item)
  }
  collect(schema)
  return registry
}

function normalizeZodJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeZodJsonSchema(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) =>
        (entry[0] === "exclusiveMaximum" || entry[0] === "exclusiveMinimum") && typeof entry[1] === "boolean"
          ? false
          : true,
      )
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)]),
  )
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// chipmate_change start - preserve ChipMate registry dependencies and sandbox-aware HTTP in the upstream node graph
const network = LayerNode.make({ service: HttpClient.HttpClient, layer: ToolNetwork.httpLayer, deps: [] })

export const node = LayerNode.suspend(() =>
  LayerNode.make({
    service: Service,
    layer,
    deps: [
      Config.node,
      Plugin.node,
      Question.node,
      Todo.node,
      Agent.node,
      Skill.node,
      Session.node,
      BackgroundJob.node,
      Provider.node,
      LSP.node,
      Instruction.node,
      FSUtil.node,
      EventV2Bridge.node,
      network,
      CrossSpawnSpawner.node,
      Format.node,
      Truncate.node,
      RuntimeFlags.node,
      Database.node,
      Ripgrep.node,
      Command.node,
      Git.node,
      Bus.node,
      Auth.node,
      SessionStatus.node,
      AgentManager.node,
      Notebook.node,
      RepositoryCache.node,
      ChipMateSessions.node,
    ],
  }),
)
// chipmate_change end

export * as ToolRegistry from "./registry"
