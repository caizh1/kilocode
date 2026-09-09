import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { legacyReviewCommand, reviewCommand } from "@/chipmate/review/command" // chipmate_change
import { embeddedReviewCommand } from "@/chipmate/embedded-review/command" // chipmate_change
import { semanticExploreCommand } from "@/chipmate/semantic-explore/command" // chipmate_change
import { EventV2 } from "@opencode-ai/core/event"
import { apply as applyOverride, type Override } from "@/chipmate/command/override" // chipmate_change
import PROMPT_INITIALIZE from "./template/initialize.txt"
import { LegacyEvent } from "@opencode-ai/schema/legacy-event"
import { SessionResume } from "@/chipmate/session-resume" // chipmate_change
import { specCommand } from "@/chipmate/spec/command" // chipmate_change

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: LegacyEvent.CommandExecuted,
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String), // chipmate_change
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  trusted: Schema.optional(Schema.Boolean), // chipmate_change - skill-sourced templates only run `!`cmd`` shell when trusted
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "Command" })

export type Info = Omit<Schema.Schema.Type<typeof Info>, "template"> & { template: Promise<string> | string }

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  INIT: "init",
  REVIEW: "review",
} as const

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

// chipmate_change start - skills can share names with slash commands
function fromSkill(item: Skill.Info, dir?: string): Info {
  return {
    name: item.name,
    description: item.description,
    source: "skill",
    trusted: item.trusted === true,
    get template() {
      if (!dir) return item.content
      return [
        item.content,
        "",
        `Base directory for this skill: ${dir}`,
        "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
      ].join("\n")
    },
    hints: [],
  }
}

function directory(item: Skill.Info) {
  return item.location === "<built-in>" ? undefined : path.dirname(item.location)
}

function skillName(name: string) {
  return name.endsWith(":skill") ? name.slice(0, -6) : undefined
}

function mcpName(name: string) {
  return name.endsWith(":mcp") ? name.slice(0, -4) : undefined
}
// chipmate_change end

export class Service extends Context.Service<Service, Interface>()("@opencode/Command") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      }
      // chipmate_change start
      commands[Default.REVIEW] = reviewCommand()
      commands["embedded-review"] = embeddedReviewCommand()
      commands["semantic-explore"] = semanticExploreCommand()
      commands["spec"] = specCommand()
      commands["local-review"] = legacyReviewCommand("local-review")!
      commands["local-review-uncommitted"] = legacyReviewCommand("local-review-uncommitted")!
      commands["resume-claude"] = SessionResume.resumeClaude
      commands["resume-codex"] = SessionResume.resumeCodex
      // chipmate_change end

      // chipmate_change start - defer partial overrides until all command sources are registered
      const overrides: Array<{ name: string; command: Override }> = []
      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        if (!applyOverride(commands, name, command, hints)) overrides.push({ name, command }) // chipmate_change
      }
      // chipmate_change end

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                .pipe(
                  Effect.map(
                    (template) =>
                      template?.messages
                        .map((message) => (message.content.type === "text" ? message.content.text : ""))
                        .join("\n") || "",
                  ),
                ),
            )
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }

      for (const item of yield* skill.all()) {
        if (commands[item.name]) continue
        commands[item.name] = fromSkill(item, directory(item)) // chipmate_change
      }

      // chipmate_change start - apply deferred overrides to their registered source
      for (const item of overrides) {
        const skillTarget = skillName(item.name)
        if (skillTarget) {
          const found = yield* skill.get(skillTarget)
          if (found) {
            if (commands[skillTarget]?.source !== "skill") {
              commands[item.name] = fromSkill(found, directory(found))
              applyOverride(commands, item.name, item.command, hints) // chipmate_change
            } else {
              applyOverride(commands, skillTarget, item.command, hints) // chipmate_change
            }
          }
          continue
        }
        const mcpTarget = mcpName(item.name)
        if (mcpTarget) {
          if (commands[mcpTarget]?.source !== "mcp") continue
          applyOverride(commands, mcpTarget, item.command, hints) // chipmate_change
          continue
        }
        applyOverride(commands, item.name, item.command, hints) // chipmate_change
      }
      // chipmate_change end

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      // chipmate_change start
      const exact = s.commands[name]
      if (exact?.source !== "skill") {
        if (exact) return exact
      } else {
        const item = yield* skill.get(name)
        if (item) return fromSkill(item)
      }
      const alias = legacyReviewCommand(name)
      if (alias) return alias

      const current = yield* skill.get(name)
      if (current) return fromSkill(current)

      const target = skillName(name)
      if (target) {
        const exact = s.commands[target]
        if (exact?.source === "skill") return exact
        const item = yield* skill.get(target)
        if (item) return fromSkill(item, directory(item))
        return undefined
      }
      // chipmate_change end
      // chipmate_change start
      const prompt = mcpName(name)
      if (prompt) {
        const cmd = s.commands[prompt]
        return cmd?.source === "mcp" ? cmd : undefined
      }
      // chipmate_change end
      return undefined // chipmate_change
    })

    // chipmate_change start
    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      const result = Object.values(s.commands).filter((item) => item.source !== "skill")
      const names = new Set(result.map((item) => item.name))
      for (const item of yield* skill.all()) {
        if (s.commands[item.name]?.source === "skill" || s.commands[`${item.name}:skill`]?.source === "skill") continue
        if (names.has(item.name)) result.push(fromSkill(item, directory(item)))
      }
      return result
    })
    // chipmate_change end

    return Service.of({ get, list })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Config.node, MCP.node, Skill.node] })
export const defaultLayer = Layer.suspend(() => AppNodeBuilder.build(node))

export * as Command from "."
