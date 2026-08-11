// chipmate_change - new file
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Ref } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { SessionRunState } from "../../src/session/run-state"
import { SessionID } from "../../src/session/schema"
import { Skill } from "../../src/skill"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const layer = Layer.mergeAll(
  Skill.defaultLayer,
  SessionRunState.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  testInstanceStoreLayer,
)
const it = testEffect(layer)

afterEach(() => disposeAllInstances())

describe("Skill cache refresh", () => {
  it.live("refreshes project Skill discovery and state after filesystem changes", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const first = path.join(dir, ".chipmate", "skills", "first", "SKILL.md")
      const second = path.join(dir, ".chipmate", "skills", "second", "SKILL.md")
      yield* Effect.promise(() => write(first, "first", "Before refresh"))

      yield* provideInstance(dir)(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          expect((yield* skill.get("first"))?.description).toBe("Before refresh")

          yield* Effect.promise(() =>
            Promise.all([write(first, "first", "After refresh"), write(second, "second", "Added")]),
          )
          expect(yield* skill.get("second")).toBeUndefined()

          yield* skill.refresh("project")
          expect((yield* skill.get("first"))?.description).toBe("After refresh")
          expect((yield* skill.get("second"))?.description).toBe("Added")

          yield* Effect.promise(() => fs.rm(path.dirname(second), { recursive: true, force: true }))
          yield* skill.refresh("project")
          expect(yield* skill.get("second")).toBeUndefined()
        }),
      )
    }),
  )

  it.live("refreshes global Skill caches for every loaded directory", () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      const home = path.join(root, "home")
      const first = path.join(root, "one")
      const second = path.join(root, "two")
      const file = path.join(home, ".chipmate", "skills", "shared", "SKILL.md")
      yield* Effect.promise(() =>
        Promise.all([fs.mkdir(first), fs.mkdir(second), write(file, "shared", "Before refresh")]),
      )

      yield* withHome(
        home,
        Effect.gen(function* () {
          const before = yield* provideInstance(first)(Skill.Service.use((skill) => skill.get("shared")))
          expect(before?.description).toBe("Before refresh")
          yield* provideInstance(second)(Skill.Service.use((skill) => skill.get("shared")))

          yield* Effect.promise(() => write(file, "shared", "After refresh"))
          yield* provideInstance(first)(Skill.Service.use((skill) => skill.refresh("global")))

          const fresh = yield* provideInstance(second)(Skill.Service.use((skill) => skill.get("shared")))
          expect(fresh?.description).toBe("After refresh")
        }),
      )
    }),
  )

  it.live("keeps a running session alive while Skill caches refresh", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const file = path.join(dir, ".chipmate", "skills", "live", "SKILL.md")
      yield* Effect.promise(() => write(file, "live", "Before refresh"))

      yield* provideInstance(dir)(
        Effect.gen(function* () {
          const run = yield* SessionRunState.Service
          const skill = yield* Skill.Service
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const interrupted = yield* Ref.make(false)
          const answer = {} as SessionV1.WithParts
          const sessionID = SessionID.make("ses_skill_refresh_running")
          const work = Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            return answer
          })
          const fallback = Ref.set(interrupted, true).pipe(Effect.as(answer))
          const fiber = yield* run.ensureRunning(sessionID, fallback, work).pipe(Effect.forkChild)
          yield* Deferred.await(started)
          expect(Exit.isFailure(yield* Effect.exit(run.assertNotBusy(sessionID)))).toBe(true)

          yield* Effect.promise(() => write(file, "live", "After refresh"))
          yield* skill.refresh("project")

          expect(Exit.isFailure(yield* Effect.exit(run.assertNotBusy(sessionID)))).toBe(true)
          expect(yield* Ref.get(interrupted)).toBe(false)
          yield* Deferred.succeed(release, undefined)
          expect(yield* Fiber.join(fiber)).toBe(answer)
          expect(yield* Ref.get(interrupted)).toBe(false)
        }),
      )
    }),
  )
})

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

async function write(file: string, name: string, description: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    `---
name: ${name}
description: ${description}
---

# ${name}
`,
  )
}
