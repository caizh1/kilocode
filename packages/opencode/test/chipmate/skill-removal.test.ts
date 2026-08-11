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
      const previous = process.env.CHIPMATE_TEST_HOME
      process.env.CHIPMATE_TEST_HOME = home
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.env.CHIPMATE_TEST_HOME = previous
      }),
  )

describe("ChipMate skill removal", () => {
  it.live("removes a discovered skill and refreshes the live cache without restarting", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const root = path.join(dir, ".chipmate", "skills", "removable")
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

          yield* skill.remove(file, "project")

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

          const arbitrary = yield* Effect.exit(skill.remove(path.join(process.cwd(), "SKILL.md"), "project"))
          expect(arbitrary._tag).toBe("Failure")

          const protectedResult = yield* Effect.exit(skill.remove(builtin!.location, "project"))
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
            const global = path.join(dir, "home", ".chipmate", "skills", "shared", "SKILL.md")
            const project = path.join(dir, ".chipmate", "skills", "shared", "SKILL.md")
            yield* Effect.promise(() => Promise.all([write(global, "global"), write(project, "project")]))

            const skill = yield* Skill.Service
            expect((yield* skill.get("shared"))?.location).toBe(global)

            yield* skill.remove(global, "global")

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

  it.live("reveals the built-in Skill after deleting a user override", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const root = path.join(dir, ".chipmate", "skills", "chipmate-config")
          const file = path.join(root, "SKILL.md")
          yield* Effect.promise(() =>
            Bun.write(
              file,
              `---
name: chipmate-config
description: User override.
---

# User override
`,
            ),
          )

          const skill = yield* Skill.Service
          expect((yield* skill.get("chipmate-config"))?.location).toBe(file)

          yield* skill.remove(file, "project")

          const restored = yield* skill.get("chipmate-config")
          expect(restored?.location).toBe(Skill.BUILTIN_LOCATION)
          expect(restored?.content).not.toContain("# User override")
        }),
      { git: true },
    ),
  )

  it.live("refuses to remove a directory that contains a nested Skill", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const root = path.join(dir, ".chipmate", "skills", "parent")
          const parent = path.join(root, "SKILL.md")
          const child = path.join(root, "child", "SKILL.md")
          yield* Effect.promise(() => Promise.all([writeNamed(parent, "parent"), writeNamed(child, "child")]))

          const skill = yield* Skill.Service
          expect((yield* skill.get("parent"))?.location).toBe(parent)
          expect((yield* skill.get("child"))?.location).toBe(child)

          const result = yield* Effect.exit(skill.remove(parent, "project"))

          expect(result._tag).toBe("Failure")
          expect(yield* Effect.promise(() => fs.readFile(parent, "utf8"))).toContain("name: parent")
          expect(yield* Effect.promise(() => fs.readFile(child, "utf8"))).toContain("name: child")
        }),
      { git: true },
    ),
  )

  it.live("refuses to remove through a symbolic link inside the discovery root", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          if (process.platform === "win32") return
          const external = path.join(dir, "external", "linked")
          const config = path.join(dir, ".chipmate")
          const file = path.join(external, "SKILL.md")
          yield* Effect.promise(() => Promise.all([writeNamed(file, "linked"), fs.mkdir(config, { recursive: true })]))
          yield* Effect.promise(() => fs.symlink(path.dirname(external), path.join(config, "skills")))

          const skill = yield* Skill.Service
          const item = yield* skill.get("linked")
          expect(item).toBeDefined()

          const result = yield* Effect.exit(skill.remove(item!.location, "project"))

          expect(result._tag).toBe("Failure")
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toContain("name: linked")
        }),
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

          const result = yield* Effect.exit(skill.remove(file, "project"))

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

async function writeNamed(file: string, name: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    `---
name: ${name}
description: Nested removal test.
---
`,
  )
}
