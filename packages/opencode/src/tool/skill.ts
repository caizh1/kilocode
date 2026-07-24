import path from "path"
import { pathToFileURL } from "url"
import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"
import * as WorkflowGuard from "@/kilocode/skill/workflow-guard" // kilocode_change
import { Session } from "@/session/session" // kilocode_change

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const rg = yield* Ripgrep.Service
    const sessions = yield* Session.Service // kilocode_change

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
          // kilocode_change start - restore the canonical document root from persisted turns
          const messages = yield* Effect.gen(function* () {
            if (info.name !== "source-backed-detail-design") return ctx.messages
            const history = yield* sessions.messages({ sessionID: ctx.sessionID })
            const seen = new Set(history.map((message) => message.info.id))
            return [...history, ...ctx.messages.filter((message) => !seen.has(message.info.id))]
          })
          WorkflowGuard.activate(ctx.sessionID, info.name, messages)
          // kilocode_change end

          // kilocode_change start - built-in skills have no filesystem directory
          if (info.location === Skill.BUILTIN_LOCATION) {
            return {
              title: `Loaded skill: ${info.name}`,
              output: [
                `<skill_content name="${info.name}">`,
                `# Skill: ${info.name}`,
                "",
                info.content.trim(),
                "</skill_content>",
              ].join("\n"),
              metadata: {
                name: info.name,
                dir: Skill.BUILTIN_LOCATION,
              },
            }
          }
          // kilocode_change end

          const dir = path.dirname(info.location)
          const base = pathToFileURL(dir).href
          const limit = 10
          const files = yield* rg.files({ cwd: dir, follow: false, hidden: true, signal: ctx.abort }).pipe(
            Stream.filter((file) => !file.includes("SKILL.md")),
            Stream.map((file) => path.resolve(dir, file)),
            Stream.take(limit),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk].map((file) => `<file>${file}</file>`).join("\n")),
          )

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              info.content.trim(),
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files,
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
