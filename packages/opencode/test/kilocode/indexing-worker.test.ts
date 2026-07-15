import { expect, test } from "bun:test"
import { IndexingWorker } from "../../src/kilocode/indexing-worker-client"
import { tmpdir } from "../fixture/fixture"

test.serial("runs indexing engine requests in its isolated process", async () => {
  await using tmp = await tmpdir()
  const failures: unknown[] = []
  const engine = IndexingWorker.create(tmp.path, tmp.path, {
    status() {},
    telemetry() {},
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
