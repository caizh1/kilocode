import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import fs from "fs/promises"
import path from "path"
import { Skill } from "../../src/skill"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer))

const withHome = <A, E, R>(home: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.KILO_TEST_HOME
      process.env.KILO_TEST_HOME = home
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.env.KILO_TEST_HOME = previous
      }),
  )

describe("Kilo skill removal", () => {
  it.live("removes a discovered skill and refreshes the live cache without restarting", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const root = path.join(dir, ".kilo", "skills", "removable")
          const file = path.join(root, "SKILL.md")
          yield* Effect.promise(() => fs.mkdir(root, { recursive: true }))
          yield* Effect.promise(() =>
            Bun.write(
              file,
              `---
name: removable
description: A removable test skill.
---

# Removable
`,
            ),
          )

          const skill = yield* Skill.Service
          expect((yield* skill.all()).some((item) => item.location === file)).toBe(true)

          yield* skill.remove(file)

          const exists = yield* Effect.promise(() =>
            fs.stat(root).then(
              () => true,
              () => false,
            ),
          )
          expect(exists).toBe(false)
          expect((yield* skill.all()).some((item) => item.location === file)).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("rejects arbitrary paths and materialized built-in skills", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const list = yield* skill.all()
          const builtin = list.find((item) => item.location.includes(`${path.sep}builtin-skills${path.sep}`))
          expect(builtin).toBeDefined()

          const arbitrary = yield* Effect.exit(skill.remove(path.join(process.cwd(), "SKILL.md")))
          expect(arbitrary._tag).toBe("Failure")

          const protectedResult = yield* Effect.exit(skill.remove(builtin!.location))
          expect(protectedResult._tag).toBe("Failure")
          const exists = yield* Effect.promise(() =>
            fs.stat(builtin!.location).then(
              () => true,
              () => false,
            ),
          )
          expect(exists).toBe(true)
        }),
      { git: true },
    ),
  )

  it.live("removes only the visible copy when project and global skills have the same name", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          path.join(dir, "home"),
          Effect.gen(function* () {
            const global = path.join(dir, "home", ".kilo", "skills", "shared", "SKILL.md")
            const project = path.join(dir, ".kilo", "skills", "shared", "SKILL.md")
            yield* Effect.promise(() => Promise.all([write(global, "global"), write(project, "project")]))

            const skill = yield* Skill.Service
            expect((yield* skill.get("shared"))?.location).toBe(global)

            yield* skill.remove(global)

            expect((yield* skill.get("shared"))?.location).toBe(project)
            const exists = yield* Effect.promise(() =>
              fs.stat(project).then(
                () => true,
                () => false,
              ),
            )
            expect(exists).toBe(true)
          }),
        ),
      { git: true },
    ),
  )

  it.live("refuses to delete a workspace root discovered through a custom skill path", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "SKILL.md")
          const name = path.basename(dir)
          yield* Effect.promise(() =>
            Bun.write(
              file,
              `---
name: ${name}
description: A root skill that must not delete the workspace.
---
`,
            ),
          )
          const skill = yield* Skill.Service
          expect((yield* skill.get(name))?.location).toBe(file)

          const result = yield* Effect.exit(skill.remove(file))

          expect(result._tag).toBe("Failure")
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toContain("must not delete the workspace")
        }),
      { git: true, config: { skills: { paths: ["."] } } },
    ),
  )
})

async function write(file: string, source: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    `---
name: shared
description: The ${source} copy.
---

# Shared
`,
  )
}
