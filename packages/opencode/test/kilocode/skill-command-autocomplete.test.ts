import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { MCP } from "../../src/mcp"
import { Skill } from "../../src/skill"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Command.defaultLayer, CrossSpawnSpawner.defaultLayer))
const dynamic = testEffect(
  Command.layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provideMerge(Skill.defaultLayer),
    Layer.provideMerge(CrossSpawnSpawner.defaultLayer),
  ),
)

describe("skill slash commands", () => {
  it.live("lists and resolves the built-in grill-me skill", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const command = yield* Command.Service
          const list = yield* command.list()
          const item = list.find((entry) => entry.name === "grill-me" && entry.source === "skill")

          expect(item).toBeDefined()

          const skill = yield* command.get("grill-me")
          expect(skill?.source).toBe("skill")
          expect(yield* Effect.promise(async () => skill?.template)).toContain("Ask the questions one at a time.")
        }),
      { git: true },
    ),
  )

  it.live("lists and resolves skills that conflict with commands", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".kilo", "skill", "review", "SKILL.md"),
              `---
name: review
description: Skill with command conflict.
---

# Review Skill

Skill content.
`,
            ),
          )

          const command = yield* Command.Service
          const list = yield* command.list()
          const matches = list.filter((item) => item.name === "review")

          expect(matches.some((item) => item.source === "command")).toBe(true)
          expect(matches.some((item) => item.source === "skill")).toBe(true)

          const cmd = yield* command.get("review")
          const skill = yield* command.get("review:skill")

          expect(cmd?.source).toBe("command")
          expect(skill?.source).toBe("skill")
          expect(yield* Effect.promise(async () => skill?.template)).toContain("Skill content.")
        }),
      {
        git: true,
        config: {
          command: {
            review: {
              template: "Command content.",
            },
          },
        },
      },
    ),
  )

  dynamic.live("tracks installed and removed skills after refresh", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const root = path.join(dir, ".kilo", "skill")
          const stale = path.join(root, "stale-skill")
          yield* Effect.promise(() =>
            Bun.write(
              path.join(stale, "SKILL.md"),
              `---
name: stale-skill
description: Removed after command initialization.
---

# Stale Skill
`,
            ),
          )

          const command = yield* Command.Service
          const skill = yield* Skill.Service
          expect((yield* command.list()).some((item) => item.name === "stale-skill")).toBe(true)

          yield* Effect.promise(() => fs.rm(stale, { recursive: true }))
          yield* skill.refresh("project")

          expect((yield* command.list()).some((item) => item.name === "stale-skill")).toBe(false)
          expect(yield* command.get("stale-skill")).toBeUndefined()
          expect(yield* command.get("stale-skill:skill")).toBeUndefined()

          const fresh = path.join(root, "fresh-skill", "SKILL.md")
          yield* Effect.promise(() =>
            Bun.write(
              fresh,
              `---
name: fresh-skill
description: Installed after command initialization.
---

# Fresh Skill
`,
            ),
          )
          yield* skill.refresh("project")

          expect((yield* command.list()).some((item) => item.name === "fresh-skill" && item.source === "skill")).toBe(
            true,
          )
          expect((yield* command.get("fresh-skill"))?.source).toBe("skill")
        }),
      { git: true },
    ),
  )
})
