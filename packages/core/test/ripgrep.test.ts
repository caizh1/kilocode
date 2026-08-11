import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))

async function configured(value: string) {
  return Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const prev = process.env.CHIPMATE_RIPGREP_PATH
        process.env.CHIPMATE_RIPGREP_PATH = value
        return prev
      }),
      () =>
        RipgrepBinary.Service.use((service) => service.filepath).pipe(Effect.provide(RipgrepBinary.defaultLayer)),
      (prev) =>
        Effect.sync(() => {
          if (prev === undefined) delete process.env.CHIPMATE_RIPGREP_PATH
          else process.env.CHIPMATE_RIPGREP_PATH = prev
        }),
    ),
  )
}

describe("Ripgrep", () => {
  test("prefers an explicit bundled ripgrep executable", async () => {
    const tmp = await tmpdir()
    const file = path.join(tmp.path, "rg")
    await fs.writeFile(file, "bundled ripgrep")

    expect(await configured(`  ${file}  `)).toBe(file)
    await tmp[Symbol.asyncDispose]()
  })

  test("rejects a relative bundled ripgrep path", async () => {
    const file = path.join("bin", "rg")
    await expect(configured(file)).rejects.toThrow(`configured ripgrep path must be absolute: ${file}`)
  })

  test("rejects a missing bundled ripgrep executable", async () => {
    const tmp = await tmpdir()
    const file = path.join(tmp.path, "missing-rg")
    await expect(configured(file)).rejects.toThrow(`configured ripgrep executable missing: ${file}`)
    await tmp[Symbol.asyncDispose]()
  })

  it.live("keeps ignored files out of catch-all find results", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "node_modules", "pkg"), { recursive: true }))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src")))
          yield* Effect.promise(() => Bun.$`git init -q ${tmp.path}`)
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".gitignore"), "node_modules/\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "node_modules", "pkg", "index.js"), "ignored\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "index.js"), "included\n"))

          const files = yield* (yield* Ripgrep.Service).find({ cwd: tmp.path, pattern: "*", limit: 10 })
          expect(files.map((item) => item.path)).toContain(RelativePath.make("src/index.js"))
          expect(files.map((item) => item.path)).not.toContain(RelativePath.make("node_modules/pkg/index.js"))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("never includes git metadata", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".opencode")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".opencode", "config"), "needle\n"))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".git")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".git", "config"), "needle\n"))
          const ripgrep = yield* Ripgrep.Service

          const files = yield* ripgrep.find({ cwd: tmp.path, pattern: "**/*", limit: 10 })
          expect(files.map((item) => item.path)).toContain(RelativePath.make(".opencode/config"))
          expect(files.map((item) => item.path)).not.toContain(RelativePath.make(".git/config"))

          const observed: string[] = []
          const limited = yield* ripgrep.find({
            cwd: tmp.path,
            pattern: "**/*",
            limit: 1,
            onEntry: (entry) => Effect.sync(() => observed.push(entry.path)),
          })
          expect(observed).toEqual(limited.map((item) => item.path))

          const matches = yield* ripgrep.grep({ cwd: tmp.path, pattern: "needle", include: "config", limit: 10 })
          expect(matches.items.map((item) => item.entry.path)).toContain(RelativePath.make(".opencode/config")) // chipmate_change
          expect(matches.items.map((item) => item.entry.path)).not.toContain(RelativePath.make(".git/config")) // chipmate_change
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  // chipmate_change start - surfaced error keeps the underlying reason
  it.live("includes the underlying reason in execution failures", () =>
    Effect.gen(function* () {
      const ripgrep = yield* Ripgrep.Service
      const controller = new AbortController()
      controller.abort()
      const error = yield* ripgrep
        .find({ cwd: process.cwd(), pattern: "*", limit: 1, signal: controller.signal })
        .pipe(Effect.flip)
      expect(error.message).toMatch(/^ripgrep execution failed: .+/)
    }),
  )
  // chipmate_change end
})
