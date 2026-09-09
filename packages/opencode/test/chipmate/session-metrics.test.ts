// chipmate_change - new file
import { describe, expect, test } from "bun:test"
import {
  computeMetrics,
  finishStepPerformance,
  formatRate,
  observeFirstToken,
  observeToolFinish,
  observeToolStart,
  startStepPerformance,
} from "@/chipmate/session/metrics"

const tokens = {
  input: 100,
  output: 50,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

describe("chipmate.session.metrics.computeMetrics", () => {
  test("derives decode rate after excluding first-token latency", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 100 },
      elapsedMs: 1000,
      ttftMs: 200,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(125)
    expect(metrics?.ttftMs).toBe(200)
    expect(metrics?.prompt).toBeUndefined()
  })

  test("excludes tool execution from decode time", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 100 },
      elapsedMs: 2_000,
      ttftMs: 500,
      toolElapsedMs: 500,
    })
    expect(metrics?.generation).toBeCloseTo(100)
    expect(metrics?.ttftMs).toBe(500)
  })

  test("preserves TTFT when usage has no generation tokens", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 0, reasoning: 0 },
      elapsedMs: 2000,
      ttftMs: 450,
    })
    expect(metrics).toEqual({ ttftMs: 450, source: "computed" })
  })

  test("does not fabricate metrics without a valid TTFT", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 50 },
      elapsedMs: 1000,
    })
    expect(metrics).toBeUndefined()
  })

  test("keeps TTFT but hides speed when decode duration is invalid", () => {
    expect(
      computeMetrics({
        tokens: { ...tokens, output: 50 },
        elapsedMs: 500,
        ttftMs: 500,
      }),
    ).toEqual({ ttftMs: 500, source: "computed" })
  })

  test("ignores providerMetadata until the upstream wiring lands (see #6579)", () => {
    // llama.cpp surfaces prompt_per_second / predicted_per_second, but the
    // upstream AI SDK drops them before the raw usage reaches our adapter.
    // Until a metadataExtractor is wired into createOpenAICompatible, the
    // provider source is unreachable — exercise the tolerance here.
    const metrics = computeMetrics({
      providerMetadata: {
        llama: { prompt_per_second: 412.3, predicted_per_second: 28.7 },
      },
      tokens: { ...tokens, output: 100 },
      elapsedMs: 2500,
      ttftMs: 500,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(50)
    expect(metrics?.prompt).toBeUndefined()
  })

  test("tolerates missing providerMetadata", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 200 },
      elapsedMs: 4500,
      ttftMs: 500,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(50)
    expect(metrics?.prompt).toBeUndefined()
  })
})

describe("chipmate.session.metrics first-token timer", () => {
  test("captures the first non-empty text or reasoning delta once", () => {
    const started = startStepPerformance(100)
    const empty = observeFirstToken(started, "", 150)
    const first = observeFirstToken(empty, "reasoning", 920)
    const repeated = observeFirstToken(first, "answer", 1_400)

    expect(empty.ttftMs).toBeUndefined()
    expect(first.ttftMs).toBe(820)
    expect(repeated).toBe(first)
  })

  test("a new step resets TTFT and missing step-start does not fabricate it", () => {
    const prior = observeFirstToken(startStepPerformance(100), "first", 300)
    const retried = startStepPerformance(1_000)

    expect(prior.ttftMs).toBe(200)
    expect(retried.ttftMs).toBeUndefined()
    expect(observeFirstToken(retried, "next", 1_250).ttftMs).toBe(250)
    expect(observeFirstToken({}, "orphan", 1_250).ttftMs).toBeUndefined()
  })

  test("rejects non-monotonic or invalid observations", () => {
    const started = startStepPerformance(500)
    expect(observeFirstToken(started, "delta", 499)).toBe(started)
    expect(startStepPerformance(Number.NaN)).toEqual({})
  })

  test("counts only the post-first-token part of a tool interval", () => {
    const started = observeToolStart(startStepPerformance(0), 100)
    const first = observeFirstToken(started, "answer", 500)
    const finished = observeToolFinish(first, 700)

    expect(finished.ttftMs).toBe(500)
    expect(finished.toolElapsedMs).toBe(200)
  })

  test("counts concurrent tools as one wall-clock interval", () => {
    const first = observeFirstToken(startStepPerformance(0), "answer", 100)
    const tool1 = observeToolStart(first, 200)
    const tool2 = observeToolStart(tool1, 300)
    const firstFinished = observeToolFinish(tool2, 500)
    const allFinished = observeToolFinish(firstFinished, 700)

    expect(firstFinished.toolElapsedMs).toBeUndefined()
    expect(allFinished.toolElapsedMs).toBe(500)
  })

  test("settles an unfinished tool interval at step finish", () => {
    const first = observeFirstToken(startStepPerformance(0), "answer", 100)
    const tool = observeToolStart(first, 200)
    const finished = finishStepPerformance(tool, 600)

    expect(finished.activeTools).toBe(0)
    expect(finished.toolElapsedMs).toBe(400)
  })

  test("matches a controlled chunked-provider trace within the acceptance tolerance", () => {
    const started = startStepPerformance(0)
    const reasoning = observeFirstToken(started, "思考", 820)
    const text = observeFirstToken(reasoning, "回答", 1_200)
    const tool = observeToolStart(text, 5_820)
    const settled = observeToolFinish(tool, 6_820)
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 200, reasoning: 87 },
      elapsedMs: 11_820,
      ttftMs: settled.ttftMs,
      toolElapsedMs: settled.toolElapsedMs,
    })

    expect(Math.abs((metrics?.ttftMs ?? 0) - 820)).toBeLessThanOrEqual(100)
    expect(Math.abs((metrics?.generation ?? 0) - 28.7) / 28.7).toBeLessThanOrEqual(0.05)
  })
})

describe("chipmate.session.metrics.formatRate", () => {
  test.each([
    [0, "0 t/s"],
    [12, "12 t/s"],
    [412.5, "412.5 t/s"],
    [12345, "12,345 t/s"],
  ] as const)("formats %f as %s", (input, expected) => {
    expect(formatRate(input)).toBe(expected)
  })

  test("returns zero string for negative inputs", () => {
    expect(formatRate(-5)).toBe("0 t/s")
  })
})
