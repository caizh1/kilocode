import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { Config } from "../../src/config/config"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { IndexingWorker } from "../../src/kilocode/indexing-worker-client"
import { disposeAllInstances, provideTestInstance, tmpdir } from "../fixture/fixture"

const cfg: Partial<Config.Info> = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    provider: "ollama",
    vectorStore: "qdrant",
    ollama: {
      baseUrl: "http://127.0.0.1:1",
    },
  },
}

const configDir = process.env["KILO_CONFIG_DIR"]
const indexed = {
  state: "Complete" as const,
  message: "Index up-to-date.",
  processedFiles: 0,
  totalFiles: 0,
  percent: 100,
}

async function wait(state: KiloIndexing.Status["state"]) {
  for (const _ of Array.from({ length: 100 })) {
    const status = await KiloIndexing.current()
    if (status.state === state) return status
    await Bun.sleep(10)
  }
  throw new Error(`indexing did not reach ${state}`)
}

afterEach(async () => {
  IndexingWorker.override()
  if (configDir === undefined) delete process.env["KILO_CONFIG_DIR"]
  else process.env["KILO_CONFIG_DIR"] = configDir
  await disposeAllInstances()
})

describe("indexing worktrees", () => {
  test("does not pass a baseline for the primary checkout root", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path

    const calls: Array<string | undefined> = []
    IndexingWorker.override(() => ({
      async init(_input, baseline) {
        calls.push(baseline)
        return indexed
      },
      async search() {
        return []
      },
      async dispose() {},
    }))

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const status = await wait("Complete")
        await KiloIndexing.search("primary checkout")
        expect(status.message).not.toContain("primary worktree index")
      },
    })

    expect(calls).toEqual([undefined])
  })

  test("does not pass a baseline for a directory inside the primary checkout", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const directory = path.join(tmp.path, "packages", "app")
    await mkdir(directory, { recursive: true })

    const calls: Array<string | undefined> = []
    IndexingWorker.override(() => ({
      async init(_input, baseline) {
        calls.push(baseline)
        return indexed
      },
      async search() {
        return []
      },
      async dispose() {},
    }))

    await provideTestInstance({
      directory,
      fn: async () => {
        await wait("Complete")
        await KiloIndexing.search("primary checkout directory")
      },
    })

    expect(calls).toEqual([undefined])
  })

  test("shares the primary checkout index with a linked worktree", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    await Bun.$`git -C ${tmp.path} add opencode.json && git -C ${tmp.path} commit -m config`.quiet()
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "feature")
    await Bun.$`git -C ${tmp.path} worktree add -b feature ${worktree}`.quiet()

    const calls: Array<{ directory: string; baseline?: string }> = []
    IndexingWorker.override((directory) => ({
      async init(_input, baseline) {
        calls.push({ directory, baseline })
        return indexed
      },
      async search() {
        return []
      },
      async dispose() {},
    }))

    await provideTestInstance({
      directory: worktree,
      fn: async () => {
        await wait("Complete")
        await KiloIndexing.search("worktree")
        expect(await KiloIndexing.available()).toBe(true)
      },
    })

    expect(calls).toEqual([{ directory: worktree, baseline: tmp.path }])
  }, 15_000)

  test("maps a directory inside a linked worktree into the primary checkout", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    await Bun.$`git -C ${tmp.path} add opencode.json && git -C ${tmp.path} commit -m config`.quiet()
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "nested")
    await Bun.$`git -C ${tmp.path} worktree add -b nested ${worktree}`.quiet()
    const directory = path.join(worktree, "packages", "app")
    await mkdir(directory, { recursive: true })

    const calls: Array<{ directory: string; baseline?: string }> = []
    IndexingWorker.override((root) => ({
      async init(_input, baseline) {
        calls.push({ directory: root, baseline })
        return indexed
      },
      async search() {
        return []
      },
      async dispose() {},
    }))

    await provideTestInstance({
      directory,
      fn: async () => {
        await wait("Complete")
        await KiloIndexing.search("linked worktree directory")
      },
    })

    expect(calls).toEqual([
      {
        directory,
        baseline: path.join(tmp.path, "packages", "app"),
      },
    ])
  }, 15_000)

  test("does not classify an ordinary directory from its pathname", async () => {
    await using tmp = await tmpdir({ git: true, config: cfg })
    process.env["KILO_CONFIG_DIR"] = tmp.path
    const directory = path.join(tmp.path, ".kilocode", "worktrees", "feature")
    await mkdir(directory, { recursive: true })
    await Bun.write(path.join(directory, "file.ts"), "export const value = 1\n")

    const calls: Array<string | undefined> = []
    IndexingWorker.override(() => ({
      async init(_input, baseline) {
        calls.push(baseline)
        return indexed
      },
      async search() {
        return []
      },
      async dispose() {},
    }))

    await provideTestInstance({
      directory,
      fn: async () => {
        await wait("Complete")
        await KiloIndexing.search("ordinary directory")
        expect(await KiloIndexing.available()).toBe(true)
      },
    })

    expect(calls).toEqual([undefined])
  })
})
