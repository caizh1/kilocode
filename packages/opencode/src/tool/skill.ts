import path from "path"
import { Effect, Schema } from "effect"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"
import * as WorkflowGuard from "@/chipmate/skill/workflow-guard" // chipmate_change
import { Session } from "@/session/session" // chipmate_change
// chipmate_change start - gate + run shell injection in skill bodies
import { Config } from "@/config/config"
import { Shell } from "@opencode-ai/core/shell"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ShellPermission } from "./shell"
import { SkillInject } from "@/chipmate/skills/inject"
// chipmate_change end

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const ripgrep = yield* Ripgrep.Service
    const sessions = yield* Session.Service // chipmate_change
    const flags = yield* RuntimeFlags.Service // chipmate_change
    const permission = yield* ShellPermission // chipmate_change - decompose skill commands like the bash tool
    const config = yield* Config.Service // chipmate_change - resolve a parseable shell for injection

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* skill
            .require(params.name)
            .pipe(Effect.catchTag("Skill.NotFoundError", (error) => Effect.die(new Error(error.message))))

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })
          // chipmate_change start - restore the canonical document root from persisted turns
          const messages = yield* Effect.gen(function* () {
            if (info.name !== "source-backed-detail-design") return ctx.messages
            const history = yield* sessions.messages({ sessionID: ctx.sessionID })
            const seen = new Set(history.map((message) => message.info.id))
            return [...history, ...ctx.messages.filter((message) => !seen.has(message.info.id))]
          })
          WorkflowGuard.activate(ctx.sessionID, info.name, messages)
          // chipmate_change end

          // chipmate_change start - render `!`cmd`` shell injection, gated by trust + kill-switch + batch approval
          const cfg = yield* config.get()
          const content = yield* SkillInject.render({
            content: info.content,
            trusted: info.trusted === true,
            disabled: flags.disableSkillShell,
            cwd: yield* InstanceState.directory,
            skill: info.name,
            shell: Shell.acceptable(cfg.shell),
            ctx,
            decompose: permission.decompose,
          })
          // chipmate_change end

          // chipmate_change start - built-in skills have no filesystem directory
          if (info.location === Skill.BUILTIN_LOCATION) {
            return {
              title: `Loaded skill: ${info.name}`,
              output: [
                `<skill_content name="${info.name}">`,
                `# Skill: ${info.name}`,
                "",
                content.trim(), // chipmate_change
                "</skill_content>",
              ].join("\n"),
              metadata: {
                name: info.name,
                dir: Skill.BUILTIN_LOCATION,
              },
            }
          }
          // chipmate_change end

          const dir = path.dirname(info.location)
          const base = dir
          const files = yield* ripgrep.find({
            cwd: dir,
            pattern: "!**/SKILL.md",
            hidden: true,
            follow: false,
            signal: ctx.abort,
            limit: 10,
          })

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              content.trim(), // chipmate_change
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files.map((file) => `<file>${path.resolve(dir, file.path)}</file>`).join("\n"),
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
