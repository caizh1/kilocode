import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import test from "node:test"
import { validate } from "./schema.mjs"

const root = resolve(import.meta.dirname, "../..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const story = readFileSync(join(root, "webview-ui/src/stories/low-end.stories.tsx"), "utf8")
const runner = readFileSync(join(import.meta.dirname, "run.mjs"), "utf8")

test("exposes the focused Agent Console render proxy commands", () => {
  assert.equal(pkg.scripts["qa:agent-console:render-proxy"], "node qa/agent-console-render/run.mjs")
  assert.equal(pkg.scripts["test:agent-console:render-contract"], "node --test qa/agent-console-render/contract.test.mjs")
})

test("uses the real production terminal and deterministic PTY fixture", () => {
  assert.match(story, /import \{ TerminalTab, type TerminalSocket \}/)
  assert.match(story, /<TerminalTab/)
  assert.doesNotMatch(story, /<pre data-ui="low-end-console-output"/)
  assert.match(story, /offset < 5_000/)
  assert.match(story, /中文宽字符/)
  assert.match(story, /Uint8Array\.of\(byte\)\.buffer/)
})

test("keeps scale, GPU, CPU, frame, layout and stress controls executable", () => {
  for (const token of [
    "deviceScaleFactor",
    "--disable-gpu",
    "Emulation.setCPUThrottlingRate",
    "Page.startScreencast",
    "context.tracing.start",
    "for (let batch = 0; batch < 10; batch++)",
    "for (let step = 0; step < 5; step++)",
    "[1_143, 940, 640, 420, 300]",
    "longtask",
    "ResizeObserver",
  ])
    assert.match(runner, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
})

test("validates a complete eight-case attempt", () => {
  const cases = ["default", "disabled"].flatMap((gpu) =>
    [1, 1.25, 1.5, 2].map((scale) => ({ gpu, scale, status: "PASS", assertions: [] })),
  )
  const data = {
    generatedAt: new Date().toISOString(),
    lane: "macos-source-render-proxy",
    status: "PASS",
    environment: {},
    attempts: [{ number: 1, status: "PASS", cases }],
    limitations: [],
  }
  assert.deepEqual(validate(data), [])
})
