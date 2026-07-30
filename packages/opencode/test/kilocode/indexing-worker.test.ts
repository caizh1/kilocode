import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { IndexingWorker, indexingCommand } from "../../src/kilocode/indexing-worker-client"
import { tmpdir } from "../fixture/fixture"

test("allows a packaged native indexing sidecar to override the compiled default", () => {
  const arm = String.raw`C:\extension\bin\kilo-indexer-arm64.exe`

  expect(indexingCommand(arm, String.raw`C:\extension\bin\kilo-arm64.exe`)).toEqual([arm])
  expect(indexingCommand("kilo-indexer-arm64.exe", String.raw`C:\extension\bin\kilo-arm64.exe`)).toEqual([arm])
})

test.serial("runs indexing engine requests in its isolated process", async () => {
  await using tmp = await tmpdir()
  const failures: unknown[] = []
  const engine = IndexingWorker.create(tmp.path, tmp.path, {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure(err) {
      failures.push(err)
    },
  })

  try {
    const initialGraph = await engine.codeGraphStatus()
    expect(initialGraph).toMatchObject({
      state: "disabled",
      evidenceAvailable: false,
    })

    const status = await engine.init({ enabled: false, embedderProvider: "openai" })
    expect(status.state).not.toBe("Error")
    expect(status.pipelines?.codeGraph.state).not.toBe("Disabled")
    expect(status.pipelines?.rag.state).toBe("Disabled")
    const updated = await engine.updateConfig({ enabled: false, embedderProvider: "openai", searchMinScore: 0.5 })
    expect(updated.state).not.toBe("Error")

    const graph = await engine.codeGraphStatus()
    const evidence = await engine.queryEvidence("find callers", { retrievalMode: "graph-only" })
    const vector = evidence.trace.stages.find((stage) => stage.name === "vector")

    expect(graph).toMatchObject({
      state: "container_ready",
      enabled: true,
      evidenceAvailable: false,
    })
    expect(evidence.answerPolicy.mode).toBe("conservative")
    expect(evidence.answerPolicy.confidence).toBe("none")
    expect(evidence.formattedPackText).toContain("<local-analysis-pack")
    expect(vector).toMatchObject({
      status: "skipped",
      reason: "graph-only",
    })
  } finally {
    await engine.dispose()
  }

  expect(failures).toEqual([])
})

test.serial("routes multiple directories through the shared indexing worker", async () => {
  await using first = await tmpdir()
  await using second = await tmpdir()
  const failures: unknown[] = []
  const create = (directory: string) =>
    IndexingWorker.create(directory, directory, {
      status() {},
      telemetry() {},
      warning() {},
      log() {},
      failure(err) {
        failures.push(err)
      },
    })
  const left = create(first.path)
  const right = create(second.path)

  try {
    const statuses = await Promise.all([
      left.init({ enabled: false, embedderProvider: "openai" }),
      right.init({ enabled: false, embedderProvider: "openai" }),
    ])
    expect(statuses.every((status) => status.state !== "Error")).toBe(true)
    expect(statuses.map((status) => status.pipelines?.rag.state)).toEqual(["Disabled", "Disabled"])
    expect(statuses.every((status) => status.pipelines?.codeGraph.state !== "Disabled")).toBe(true)
  } finally {
    await Promise.all([left.dispose(), right.dispose()])
  }

  expect(failures).toEqual([])
})

test.serial("waits for the primary index instead of scanning a worktree independently", async () => {
  await using tmp = await tmpdir()
  const main = path.join(tmp.path, "main")
  const worktree = path.join(tmp.path, "worktree")
  await mkdir(main)
  await mkdir(worktree)
  await Bun.write(path.join(worktree, "file.ts"), "export function value() { return 1 }\n")

  const requests: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      requests.push(new URL(req.url).pathname)
      const body = (await req.json()) as { input: string | string[] }
      const input = Array.isArray(body.input) ? body.input : [body.input]
      return Response.json({
        object: "list",
        model: "fixture-model",
        data: input.map((_, index) => ({ object: "embedding", index, embedding: [0.1, 0.2, 0.3] })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      })
    },
  })
  const failures: unknown[] = []
  const engine = IndexingWorker.create(worktree, tmp.path, {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure(err) {
      failures.push(err)
    },
  })

  try {
    const status = await engine.init(
      {
        enabled: true,
        embedderProvider: "openai-compatible",
        vectorStoreProvider: "lancedb",
        modelId: "fixture-model",
        modelDimension: 3,
        openAiCompatibleBaseUrl: `http://127.0.0.1:${server.port}/v1`,
      },
      main,
    )

    expect(status.state).toBe("Standby")
    expect(status.message).toContain("primary worktree index")
    expect(requests).toEqual([])
  } finally {
    await engine.dispose()
    server.stop(true)
  }

  expect(failures).toEqual([])
})

test.serial("allows same-directory recreation while disposal is pending", async () => {
  await using tmp = await tmpdir()
  const hooks = {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure() {},
  }
  const first = IndexingWorker.create(tmp.path, tmp.path, hooks)
  await first.init({ enabled: false, embedderProvider: "openai" })

  const disposing = first.dispose()
  const second = IndexingWorker.create(tmp.path, tmp.path, hooks)
  const status = await second.init({ enabled: false, embedderProvider: "openai" })
  await disposing
  await second.dispose()

  expect(second).not.toBe(first)
  expect(status.state).not.toBe("Error")
  expect(status.pipelines?.rag.state).toBe("Disabled")
  expect(status.pipelines?.codeGraph.state).not.toBe("Disabled")
})

test.serial("releases enabled workers after provider initialization errors", async () => {
  await using tmp = await tmpdir()
  const drivers = new Set<IndexingWorker.Driver>()

  for (const _ of Array.from({ length: 3 })) {
    const failures: unknown[] = []
    const done = Promise.withResolvers<void>()
    const engine = IndexingWorker.create(tmp.path, tmp.path, {
      status(status) {
        if (status.state === "Error") done.resolve()
      },
      telemetry() {},
      warning() {},
      log() {},
      failure(err) {
        failures.push(err)
      },
    })
    drivers.add(engine)

    const status = await engine.init({
      enabled: true,
      embedderProvider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:1",
      modelId: "nomic-embed-text",
      modelDimension: 768,
      vectorStoreProvider: "qdrant",
      qdrantUrl: "http://127.0.0.1:1",
    })
    await Promise.race([
      done.promise,
      Bun.sleep(3_000).then(() => {
        throw new Error("Timed out waiting for the provider initialization error status.")
      }),
    ])
    await engine.dispose()

    expect(status.state).not.toBe("Error")
    expect(failures).toEqual([])
  }

  const engine = IndexingWorker.create(tmp.path, tmp.path, {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure() {},
  })
  const status = await engine.init({ enabled: false, embedderProvider: "openai" })
  await engine.dispose()

  expect(status.state).not.toBe("Error")
  expect(status.pipelines?.rag.state).toBe("Disabled")
  expect(status.pipelines?.codeGraph.state).not.toBe("Disabled")
  expect(drivers.has(engine)).toBe(false)
  expect(drivers.size).toBe(3)
})

test.serial("keeps the CLI process alive when the indexing process exceeds its RSS limit", async () => {
  await using tmp = await tmpdir()
  const pid = process.pid
  const before = {
    soft: process.env.KILO_INDEXING_SOFT_RSS_BYTES,
    hard: process.env.KILO_INDEXING_HARD_RSS_BYTES,
  }
  process.env.KILO_INDEXING_SOFT_RSS_BYTES = "1"
  process.env.KILO_INDEXING_HARD_RSS_BYTES = "1"
  const failure = Promise.withResolvers<unknown>()
  const engine = IndexingWorker.create(tmp.path, tmp.path, {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure(err) {
      failure.resolve(err)
    },
  })

  try {
    await engine.init({ enabled: false, embedderProvider: "openai" })
    const err = await Promise.race([
      failure.promise,
      Bun.sleep(5_000).then(() => {
        throw new Error("Timed out waiting for the indexing RSS watchdog.")
      }),
    ])
    expect(err).toBeInstanceOf(Error)
    expect(String(err)).toContain("Indexing process exceeded RSS limit")
    expect(process.pid).toBe(pid)
  } finally {
    await engine.dispose()
    restore("KILO_INDEXING_SOFT_RSS_BYTES", before.soft)
    restore("KILO_INDEXING_HARD_RSS_BYTES", before.hard)
  }
})

test.serial("requests a checkpointed rollover after sustained critical RSS", async () => {
  await using tmp = await tmpdir()
  const keys = [
    "KILO_INDEXING_SOFT_RSS_BYTES",
    "KILO_INDEXING_CRITICAL_RSS_BYTES",
    "KILO_INDEXING_HARD_RSS_BYTES",
    "KILO_INDEXING_RECOVERY_RSS_BYTES",
    "KILO_INDEXING_CRITICAL_HOLD_MS",
  ] as const
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  process.env.KILO_INDEXING_SOFT_RSS_BYTES = "1"
  process.env.KILO_INDEXING_CRITICAL_RSS_BYTES = "1"
  process.env.KILO_INDEXING_HARD_RSS_BYTES = String(1024 * 1024 * 1024)
  process.env.KILO_INDEXING_RECOVERY_RSS_BYTES = "1"
  process.env.KILO_INDEXING_CRITICAL_HOLD_MS = "1"
  const failure = Promise.withResolvers<unknown>()
  const engine = IndexingWorker.create(tmp.path, tmp.path, {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure(err) {
      failure.resolve(err)
    },
  })

  try {
    await engine.init({ enabled: false, embedderProvider: "openai" })
    const err = await Promise.race([
      failure.promise,
      Bun.sleep(5_000).then(() => {
        throw new Error("Timed out waiting for the indexing memory rollover.")
      }),
    ])
    expect(String(err)).toContain("requested a memory rollover")
  } finally {
    await engine.dispose()
    for (const key of keys) restore(key, before[key])
  }
})

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
