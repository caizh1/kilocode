import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readFileSync } from "node:fs"
import * as vscode from "vscode"
import {
  BenchmarkConfigError,
  BenchmarkFixtureError,
  detectFailureReasons,
  latencyStats,
  prepareFixture,
  runBenchmark,
  type BenchmarkFixture,
} from "../../src/services/qwen-autocomplete/benchmark"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("qwen autocomplete benchmark fixtures", () => {
  it("rejects missing cursor marker", () => {
    expect(() => prepareFixture({ ...fixture(), document: "int main(void) { return 0; }" })).toThrow(
      BenchmarkFixtureError,
    )
  })

  it("converts cursor marker to a VS Code-like position", () => {
    const prepared = prepareFixture(
      fixture({
        document: "int main(void) {\n  return /*__CURSOR__*/;\n}\n",
      }),
    )

    expect(prepared.position.line).toBe(1)
    expect(prepared.position.character).toBe(9)
  })
})

describe("qwen autocomplete benchmark execution", () => {
  it("keeps mock mode off the network", async () => {
    const root = await temp()
    await write(root, fixture())
    let calls = 0

    const report = await runBenchmark({
      mode: "mock",
      fixturesPath: ".",
      cwd: root,
      timeoutMs: 1_000,
      fetcher: (async () => {
        calls++
        throw new Error("mock mode must not fetch")
      }) as typeof fetch,
    })

    expect(calls).toBe(0)
    expect(report.summary.total).toBe(1)
    expect(report.cases[0]!.observed.qwenCalled).toBe(true)
  })

  it("keeps cache disabled by default so repeats do not pollute qwenCalled metrics", async () => {
    const root = await temp()
    await write(root, fixture())

    const report = await runBenchmark({ mode: "mock", fixturesPath: ".", cwd: root, repeat: 2, timeoutMs: 1_000 })

    expect(report.config.cacheEnabled).toBe(false)
    expect(report.metrics.requestAttemptedCount).toBe(2)
    expect(report.cases[0]!.observed.qwenCalled).toBe(true)
  })

  it("makes cache benchmarking explicit opt-in while keeping repeat providers isolated", async () => {
    const root = await temp()
    await write(root, fixture())

    const report = await runBenchmark({
      mode: "mock",
      fixturesPath: ".",
      cwd: root,
      repeat: 2,
      cache: true,
      timeoutMs: 1_000,
    })

    expect(report.config.cacheEnabled).toBe(true)
    expect(report.metrics.requestAttemptedCount).toBe(2)
  })

  it("blocks unsafe fixtures before complete is called", async () => {
    const root = await temp()
    await write(
      root,
      fixture({
        id: "unsafe",
        fileName: "backend/hal/.env.cpp",
        expectation: {
          shouldRequest: false,
          shouldShowGhostText: false,
          guardShouldBlock: true,
        },
      }),
    )

    const report = await runBenchmark({ mode: "mock", fixturesPath: ".", cwd: root, timeoutMs: 1_000 })

    expect(report.cases[0]!.pass).toBe(true)
    expect(report.cases[0]!.observed.guardBlocked).toBe(true)
    expect(report.cases[0]!.observed.qwenCalled).toBe(false)
  })

  it("fails real mode fast before request when config is missing", async () => {
    let calls = 0
    let err: unknown

    try {
      await runBenchmark({
        mode: "real",
        fixturesPath: ".",
        cwd: await temp(),
        timeoutMs: 1_000,
        fetcher: (async () => {
          calls++
          return new Response("{}")
        }) as typeof fetch,
      })
    } catch (caught) {
      err = caught
    }

    expect(err).toBeInstanceOf(BenchmarkConfigError)
    expect(calls).toBe(0)
  })

  it("rejects legacy direct endpoint inputs without network access", async () => {
    const root = await temp()
    await write(root, fixture())
    const urls: string[] = []

    await expect(
      runBenchmark({
        mode: "real",
        fixturesPath: ".",
        cwd: root,
        repeat: 1,
        timeoutMs: 1_000,
        endpoint: "http://unit.test/v1/completions",
        model: "qwen-coder-30b0",
        apiKeyEnv: "QWEN_TEST_KEY",
        env: { QWEN_TEST_KEY: "secret" },
        fetcher: (async (input) => {
          urls.push(String(input))
          return new Response(JSON.stringify({ choices: [{ text: "return ok;" }] }), { status: 200 })
        }) as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(BenchmarkConfigError)

    expect(urls).toEqual([])
  })

  it("keeps mock-mode report prompts redacted by default", async () => {
    const root = await temp()
    await write(root, fixture())

    const report = await runBenchmark({
      mode: "mock",
      fixturesPath: ".",
      cwd: root,
      repeat: 1,
      timeoutMs: 1_000,
      model: "qwen-coder-30b0",
    })

    expect(report.config.redactedPrompts).toBe(true)
    expect(report.cases[0]!.observed.requestPreview?.prompt).toBe("[redacted prompt]")
    expect(JSON.stringify(report)).not.toContain("<|fim_prefix|>")
  })
})

describe("qwen autocomplete benchmark failure detectors", () => {
  it("detects prefix echo", () => {
    const reasons = reasonsFor("time_timeout", { mustNotEchoPrefix: true }, "cfg->time", "")

    expect(reasons).toContain("PREFIX_ECHO")
  })

  it("detects suffix overlap", () => {
    const reasons = reasonsFor(") {", { mustNotOverlapSuffix: true }, "if (ready", ") {")

    expect(reasons).toContain("SUFFIX_OVERLAP")
  })

  it("detects markdown leakage", () => {
    const reasons = reasonsFor("```c\nreturn ok;\n```")

    expect(reasons).toContain("MARKDOWN_LEAKAGE")
  })

  it("detects special token leakage", () => {
    const reasons = reasonsFor("<|fim_suffix|>return ok;")

    expect(reasons).toContain("SPECIAL_TOKEN_LEAKAGE")
  })
})

describe("qwen autocomplete benchmark reporting", () => {
  it("calculates p50 and p95 latency", () => {
    expect(latencyStats([10, 20, 30, 40, 50])).toMatchObject({ p50: 30, p95: 50 })
  })

  it("keeps JSON report schema stable", async () => {
    const root = await temp()
    await write(root, fixture())

    const report = await runBenchmark({ mode: "mock", fixturesPath: ".", cwd: root, timeoutMs: 1_000 })

    expect(report).toMatchObject({
      phase: "2A",
      mode: "mock",
      config: {
        repeat: 1,
        timeoutMs: 1_000,
        redactedPrompts: true,
      },
      summary: {
        total: 1,
      },
      metrics: {
        totalFixtures: 1,
      },
    })
    expect(report.summary).toHaveProperty("manualAcceptEligibleRate")
    expect(report.summary).not.toHaveProperty("manualAcceptRate")
    expect(report.cases[0]).toMatchObject({
      id: "case",
      title: "case",
      observed: {
        guardBlocked: false,
        qwenCalled: true,
        itemCount: 1,
      },
    })
  })

  it("keeps benchmark code out of activation/runtime imports", () => {
    const root = path.join(__dirname, "../..")
    const extension = readFileSync(path.join(root, "src/extension.ts"), "utf8")
    const qwen = readFileSync(path.join(root, "src/services/qwen-autocomplete/index.ts"), "utf8")
    const provider = readFileSync(
      path.join(root, "src/services/qwen-autocomplete/ChipMateQwenInlineCompletionProvider.ts"),
      "utf8",
    )

    expect(extension).not.toContain("benchmark")
    expect(qwen).not.toContain("benchmark")
    expect(provider).not.toContain("benchmark")
  })

  it("does not import the old autocomplete runtime from benchmark code", () => {
    const root = path.join(__dirname, "../..")
    const source = readFileSync(path.join(root, "src/services/qwen-autocomplete/benchmark.ts"), "utf8")

    expect(source).not.toContain("AutocompleteServiceManager")
    expect(source).not.toContain("ensureBackendForAutocomplete")
    expect(source).not.toContain("/chipmate/fim")
    expect(source).not.toContain("/chipmate/edit")
  })
})

function reasonsFor(
  insert: string,
  expectation: Partial<BenchmarkFixture["expectation"]> = {},
  linePrefix = "",
  lineSuffix = "",
) {
  return detectFailureReasons({
    fixture: fixture({
      expectation: {
        shouldRequest: true,
        shouldShowGhostText: true,
        ...expectation,
      },
    }),
    guard: false,
    called: true,
    items: [
      new vscode.InlineCompletionItem(insert, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0))),
    ],
    insert,
    linePrefix,
    lineSuffix,
    range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
  })
}

function fixture(input: Partial<BenchmarkFixture> = {}): BenchmarkFixture {
  return {
    id: input.id ?? "case",
    title: input.title ?? "case",
    languageId: input.languageId ?? "c",
    fileName: input.fileName ?? "backend/hal/main.c",
    cursorMarker: input.cursorMarker ?? "/*__CURSOR__*/",
    document: input.document ?? "int main(void) {\n  /*__CURSOR__*/\n}\n",
    mockCompletion: input.mockCompletion ?? "return ok;",
    selectedCompletionInfo: input.selectedCompletionInfo,
    expectation: input.expectation ?? {
      shouldRequest: true,
      shouldShowGhostText: true,
      allowMultiline: false,
      mustContainAny: ["return ok"],
    },
  }
}

async function temp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-benchmark-"))
  dirs.push(dir)
  return dir
}

async function write(dir: string, value: BenchmarkFixture): Promise<void> {
  await fs.writeFile(path.join(dir, `${value.id}.json`), `${JSON.stringify(value, null, 2)}\n`)
}
