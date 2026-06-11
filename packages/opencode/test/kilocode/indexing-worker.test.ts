import { expect, test } from "bun:test"
import { IndexingWorker } from "../../src/kilocode/indexing-worker-client"
import { tmpdir } from "../fixture/fixture"

test("runs indexing engine requests in its worker", async () => {
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
    expect(status.state).toBe("Disabled")

    const graph = await engine.codeGraphStatus()
    const evidence = await engine.queryEvidence("find callers", { retrievalMode: "graph-only" })
    const vector = evidence.trace.stages.find((stage) => stage.name === "vector")

    expect(graph).toMatchObject({
      state: "disabled",
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
