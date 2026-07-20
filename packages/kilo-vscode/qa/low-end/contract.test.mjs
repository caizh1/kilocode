import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import test from "node:test"
import { budgets, fixtures, profile } from "./budgets.mjs"
import { validate } from "./validate.mjs"

const root = resolve(import.meta.dirname, "../..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const story = readFileSync(join(root, "webview-ui/src/stories/low-end.stories.tsx"), "utf8")
const runner = readFileSync(join(import.meta.dirname, "run-webview.mjs"), "utf8")
const installed = readFileSync(join(import.meta.dirname, "run-installed.mjs"), "utf8")
const schema = JSON.parse(readFileSync(join(import.meta.dirname, "result.schema.json"), "utf8"))

test("exposes the three low-end QA commands", () => {
  assert.equal(pkg.scripts["benchmark:low-end:webview"], "node qa/low-end/run-webview.mjs")
  assert.equal(pkg.scripts["benchmark:low-end:installed"], "node qa/low-end/run-installed.mjs")
  assert.equal(pkg.scripts["test:low-end:contract"], "node --test qa/low-end/contract.test.mjs")
})

test("renders the real production component chain with the frozen fixture sizes", () => {
  for (const name of ["Settings", "ChatView", "HistoryView", "AgentConsoleContent"]) {
    assert.match(story, new RegExp(`import .*${name}`))
  }
  assert.match(story, /Array\.from\(\{ length: 20 \}/)
  assert.match(story, /Array\.from\(\{ length: 15 \}/)
  assert.match(story, /Array\.from\(\{ length: 30 \}/)
  assert.match(story, /Array\.from\(\{ length: 40 \}/)
  assert.match(story, /Array\.from\(\{ length: 100 \}/)
  assert.match(story, /Array\.from\(\{ length: 1_000 \}/)
  assert.deepEqual(fixtures, {
    providers: 20,
    models: 300,
    agents: 30,
    mcps: 40,
    skills: 100,
    sessions: 100,
    turns: 1_000,
    managerSessions: 4,
  })
})

test("keeps the agreed proxy controls and absolute budgets executable", () => {
  assert.equal(profile.cpuRate, 6)
  assert.equal(profile.network.latencyMs, 300)
  assert.equal(profile.network.downloadBytesPerSecond, 125_000)
  assert.equal(budgets.settingsOpenMs, 1_500)
  assert.equal(budgets.tabFirstMs, 800)
  assert.equal(budgets.tabRevisitMs, 300)
  assert.equal(budgets.inputP95Ms, 100)
  assert.equal(budgets.inputMaxMs, 200)
  assert.equal(budgets.heapGrowthPercent, 20)
  assert.equal(budgets.heapGrowthBytes, 50 * 1024 * 1024)
  assert.match(runner, /Emulation\.setCPUThrottlingRate/)
  assert.match(runner, /Network\.emulateNetworkConditions/)
  assert.match(runner, /for \(let count = 0; count < 5; count\+\+\)/)
  assert.match(installed, /attempt-\$\{number\}-profile-\$\{sample \+ 1\}/)
  assert.match(installed, /existsSync\("\/usr\/bin\/taskpolicy"\)/)
  assert.match(installed, /\/usr\/bin\/nice/)
  assert.match(installed, /"-n",\s*"15"/)
  assert.match(installed, /"NO_PROXY", "no_proxy"/)
  assert.match(installed, /--disable-gpu/)
})

test("validates a minimal schema-conforming result", () => {
  assert.equal(schema.properties.profile.properties.cpuRate.const, 6)
  const result = {
    generatedAt: new Date().toISOString(),
    lane: "webview",
    profile,
    environment: {},
    attempts: [{ number: 1, status: "PASS", metrics: [], evidence: {}, error: null }],
    status: "PASS",
    summary: "contract fixture",
  }
  assert.deepEqual(validate(result), [])
})
