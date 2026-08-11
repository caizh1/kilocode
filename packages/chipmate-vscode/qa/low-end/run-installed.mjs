#!/usr/bin/env node

import { chromium } from "@playwright/test"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { cpus, freemem, hostname, platform, release, totalmem } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { budgets, fixtures, profile } from "./budgets.mjs"
import { validate } from "./validate.mjs"

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, "../..")
const args = parse(process.argv.slice(2))
if (!args.vsix) fail("Usage: node qa/low-end/run-installed.mjs --vsix <darwin VSIX> [--output <dir>] [--code <CLI>]")
if (platform() !== "darwin") fail("The controlled installed timing lane currently requires macOS")
for (const key of ["NO_PROXY", "no_proxy"])
  process.env[key] = [process.env[key], "127.0.0.1", "localhost"].filter(Boolean).join(",")
const vsix = resolve(args.vsix)
const output = resolve(args.output ?? `chipmate-low-end-installed-${Date.now()}`)
const evidence = join(output, "evidence")
const runtime = mkdtempSync("/tmp/chipmate-low-end-installed-")
const extensions = join(runtime, "extensions")
const workspace = join(runtime, "fixture-中文 workspace")
mkdirSync(evidence, { recursive: true })
mkdirSync(extensions, { recursive: true })
mkdirSync(workspace, { recursive: true })
writeFileSync(join(workspace, "main.c"), "int main(void) { return 0; }\n")

const code = args.code ?? execFileSync("sh", ["-lc", "command -v code"], { encoding: "utf8" }).trim()
const manifest = JSON.parse(execFileSync("unzip", ["-p", vsix, "extension/package.json"], { encoding: "utf8" }))
if (`${manifest.publisher}.${manifest.name}` !== "chipmate.chipmate")
  fail(`Unexpected extension identity: ${manifest.publisher}.${manifest.name}`)
const artifact = {
  path: vsix,
  sha256: createHash("sha256").update(readFileSync(vsix)).digest("hex"),
  version: manifest.version,
  target: manifest.chipmatePackageTarget ?? null,
}
const install = spawnSync(code, ["--install-extension", vsix, "--force", "--extensions-dir", extensions], {
  encoding: "utf8",
})
writeFileSync(join(evidence, "install.log"), `${install.stdout ?? ""}\n${install.stderr ?? ""}`)
if (install.status !== 0) fail(`VSIX installation failed with status ${install.status}`)

const environment = {
  hostname: hostname(),
  platform: platform(),
  release: release(),
  cpuModel: cpus()[0]?.model ?? "unknown",
  logicalCpus: cpus().length,
  totalMemoryBytes: totalmem(),
  freeMemoryBytes: freemem(),
  node: process.version,
  code,
  codeVersion: execFileSync(code, ["--version"], { encoding: "utf8" }).trim().split(/\r?\n/)[0],
  runtime,
}

const attempts = []
attempts.push(await attempt(1))
if (attempts[0].status === "FAIL") attempts.push(await attempt(2))
const status =
  attempts[0].status === "PASS"
    ? "PASS"
    : attempts[1]?.status === "PASS"
      ? "FLAKY"
      : attempts.some((item) => item.status === "BLOCKED")
        ? "BLOCKED"
        : "FAIL"
const data = {
  generatedAt: new Date().toISOString(),
  lane: "installed",
  profile,
  fixtures,
  budgets,
  environment,
  artifact,
  attempts,
  status,
  summary:
    status === "PASS"
      ? "正式安装的发布候选 VSIX 已通过 macOS 低配组合代理门禁。"
      : status === "FLAKY"
        ? "正式安装态首次超预算、五个全新 Profile 复跑通过，记为 FLAKY。"
        : status === "FAIL"
          ? "正式安装态两轮均超预算，阻塞发布；本轮未修改业务代码。"
          : "正式安装态测量前置条件不可用，不能判定通过。",
  limitations: [
    "taskpolicy（系统可用时）或 nice/renice、6 倍 Webview CPU throttle 是低配代理，不等同于真实双核硬件。",
    "该门禁不制造真实 8GB 系统换页或 HDD 物理吞吐。",
    "Windows 与模型回答质量不在本轮证明范围。",
  ],
}
const result = join(output, "results.json")
const errors = validate(data)
if (errors.length) fail(`Result schema validation failed: ${errors.join("; ")}`)
writeFileSync(result, `${JSON.stringify(data, null, 2)}\n`)
spawnSync(process.execPath, [join(dir, "report.mjs"), result, join(output, "report.html")], { stdio: "inherit" })
spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", output, `${output}-evidence.zip`])
process.stdout.write(
  `${JSON.stringify({ status, result, report: join(output, "report.html"), evidence: `${output}-evidence.zip` }, null, 2)}\n`,
)
if (status === "FAIL" || status === "BLOCKED") process.exitCode = 1

async function attempt(number) {
  const metrics = []
  const starts = []
  const activations = []
  const settings = []
  const consoleOpens = []
  const processes = []
  const errors = []
  for (let sample = 0; sample < 5; sample++) {
    const run = join(runtime, `attempt-${number}-profile-${sample + 1}`)
    const user = join(run, "user")
    const probe = join(run, "probe")
    mkdirSync(user, { recursive: true })
    mkdirSync(probe, { recursive: true })
    const port = await freePort()
    const started = Date.now()
    const policy = existsSync("/usr/bin/taskpolicy") ? ["/usr/bin/taskpolicy", "-b"] : []
    const log = openSync(join(evidence, `attempt-${number}-profile-${sample + 1}-launch.log`), "a")
    const child = spawn(
      "/usr/bin/nice",
      [
        "-n",
        "15",
        ...policy,
        code,
        workspace,
        "--new-window",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        "--disable-gpu",
        `--remote-debugging-address=127.0.0.1`,
        `--remote-debugging-port=${port}`,
        `--extensions-dir=${extensions}`,
        `--user-data-dir=${user}`,
        `--extensionDevelopmentPath=${join(dir, "probe")}`,
      ],
      {
        env: {
          ...process.env,
          CHIPMATE_LOW_END_PROBE_ROOT: probe,
          CHIPMATE_LOW_END_STARTED_AT: String(started),
        },
        stdio: ["ignore", log, log],
      },
    )
    closeSync(log)
    const ready = await waitJson(join(probe, "ready.json"), 120_000)
    if (!ready) {
      errors.push(`profile ${sample + 1}: activation probe timed out`)
      cleanup(user, child)
      archive(user, evidence)
      continue
    }
    if (ready.status !== "PASS") {
      errors.push(`profile ${sample + 1}: activation failed (${ready.errors?.join("; ") ?? "unknown error"})`)
      cleanup(user, child)
      archive(user, evidence)
      continue
    }
    starts.push(ready.coldStartMs)
    activations.push(ready.activationMs)
    processes.push(...sampleProcesses(user))
    const browser = await connect(port, 30_000)
    if (!browser) {
      errors.push(`profile ${sample + 1}: CDP endpoint unavailable`)
      await control(probe, "quit").catch((error) => errors.push(String(error)))
      cleanup(user, child)
      archive(user, evidence)
      continue
    }
    const action = control(probe, "openSettings")
    const start = performance.now()
    const response = await action
    const frame = await findFrame(browser, '[data-ui="settings-frame"]', 30_000)
    if (!frame || response.status !== "PASS") {
      errors.push(`profile ${sample + 1}: settings webview unavailable (${response.error ?? "no page"})`)
    } else {
      settings.push(performance.now() - start)
      const host = frame.page()
      const cdp = await host.context().newCDPSession(host)
      if (sample === 0) {
        await trace(cdp, join(evidence, `attempt-${number}-installed-trace.json`), async () => {
          await installedSettings(frame, metrics)
        })
        await host.screenshot({ path: join(evidence, `attempt-${number}-installed-settings.png`), fullPage: true })
      }
    }
    const consoleStart = performance.now()
    const opened = await control(probe, "openAgentManager")
    if (opened.status === "PASS") consoleOpens.push(performance.now() - consoleStart)
    else errors.push(`profile ${sample + 1}: Agent Manager command failed: ${opened.error}`)
    processes.push(...sampleProcesses(user))
    await control(probe, "quit").catch((error) => errors.push(String(error)))
    await browser.close()
    cleanup(user, child)
    archive(user, evidence)
  }
  metrics.unshift(
    timing("installed.coldStart", "冷启动到 ChipMate 可用", starts, budgets.coldStartMs, "median", true),
    timing("installed.activation", "扩展激活", activations, budgets.activationMs, "median", true),
    timing("installed.settings.open", "正式安装态打开设置", settings, budgets.settingsOpenMs, "median", true),
    timing(
      "installed.agentManager.open",
      "正式安装态打开 Agent Manager",
      consoleOpens,
      budgets.consoleOpenMs,
      "median",
      true,
    ),
  )
  const status =
    errors.length || metrics.some((item) => item.status === "BLOCKED")
      ? "BLOCKED"
      : metrics.some((item) => item.status === "FAIL")
        ? "FAIL"
        : "PASS"
  writeFileSync(join(evidence, `attempt-${number}-process-samples.json`), `${JSON.stringify(processes, null, 2)}\n`)
  return {
    number,
    status,
    metrics,
    evidence: { processSamples: join(evidence, `attempt-${number}-process-samples.json`) },
    error: errors.length ? errors.join("; ") : null,
  }
}

async function installedSettings(page, metrics) {
  const tabs = ["providers", "agentBehaviour", "indexing", "experimental", "chipmateServer", "models"]
  const first = []
  const revisit = []
  for (const tab of tabs) first.push(await select(page, tab))
  for (const tab of tabs) revisit.push(await select(page, tab))
  metrics.push(
    timing("installed.settings.tabs.first", "正式安装态重型标签首次打开", first, budgets.tabFirstMs, "median", true),
  )
  metrics.push(
    timing("installed.settings.tabs.revisit", "正式安装态标签再次打开", revisit, budgets.tabRevisitMs, "p95"),
  )
  await select(page, "chipmateServer")
  const field = page.locator("#chipmate-server-base-url")
  await field.click()
  await field.press("Meta+A")
  await field.press("Backspace")
  const value = "http://127.0.0.1:6001/installed-performance-0123456789"
  const start = performance.now()
  await field.pressSequentially(value)
  const elapsed = performance.now() - start
  const actual = await field.inputValue()
  metrics.push(
    numberMetric(
      "installed.settings.input",
      "正式安装态逐字符输入",
      elapsed / value.length,
      budgets.inputP95Ms,
      "ms",
      actual === value,
      `expected=${JSON.stringify(value)}；actual=${JSON.stringify(actual)}`,
    ),
  )
}

async function select(page, tab) {
  const target = page.locator(`[data-ui="settings-nav-item"][data-value="${tab}"]`)
  const start = performance.now()
  await target.click({ noWaitAfter: true })
  await page.waitForFunction(
    (value) =>
      document.querySelector(`[data-ui="settings-nav-item"][data-value="${value}"]`)?.getAttribute("aria-selected") ===
      "true",
    tab,
  )
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return performance.now() - start
}

async function control(root, action) {
  const nonce = randomUUID()
  writeFileSync(join(root, "control.json"), `${JSON.stringify({ nonce, action })}\n`)
  const response = join(root, "response.json")
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    const data = existsSync(response) ? JSON.parse(readFileSync(response, "utf8")) : undefined
    if (data?.nonce === nonce) return data
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`probe action timed out: ${action}`)
}

async function connect(port, timeout) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined)
    if (browser) return browser
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return undefined
}

async function findFrame(browser, selector, timeout) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        for (const frame of page.frames()) {
          if (
            await frame
              .locator(selector)
              .count()
              .catch(() => 0)
          )
            return frame
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return undefined
}

async function waitJson(file, timeout) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"))
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return undefined
}

async function trace(cdp, file, action) {
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline",
    transferMode: "ReturnAsStream",
  })
  await action()
  const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve))
  await cdp.send("Tracing.end")
  const event = await complete
  const chunks = []
  for (;;) {
    const part = await cdp.send("IO.read", { handle: event.stream })
    chunks.push(part.data)
    if (part.eof) break
  }
  await cdp.send("IO.close", { handle: event.stream })
  writeFileSync(file, chunks.join(""))
}

function cleanup(user, child) {
  child.kill("SIGTERM")
  spawnSync("pkill", ["-TERM", "-f", user], { encoding: "utf8" })
  spawnSync("pkill", ["-KILL", "-f", user], { encoding: "utf8" })
}

function archive(user, evidence) {
  const logs = join(user, "logs")
  if (!existsSync(logs)) return
  cpSync(logs, join(evidence, `${basename(dirname(user))}-logs`), { recursive: true })
}

function sampleProcesses(user) {
  const output = spawnSync("ps", ["-axo", "pid=,rss=,%cpu=,command="], { encoding: "utf8" }).stdout ?? ""
  return output
    .split(/\r?\n/)
    .filter((line) => line.includes(user))
    .map((line) => ({ at: new Date().toISOString(), line: line.trim() }))
}

function timing(id, title, samples, budget, stat, guard = false) {
  if (!samples.length)
    return { id, title, status: "BLOCKED", samples, unit: "ms", budget, value: null, summary: "没有采集到样本。" }
  const value = stat === "median" ? median(samples) : percentile(samples, 95)
  const status = value <= budget && (!guard || Math.max(...samples) <= budget * 2) ? "PASS" : "FAIL"
  return {
    id,
    title,
    status,
    samples,
    unit: "ms",
    budget,
    value,
    statistic: stat,
    summary: `${stat}=${value.toFixed(1)}ms，最大值=${Math.max(...samples).toFixed(1)}ms。`,
  }
}

function numberMetric(id, title, value, budget, unit, exact = true, detail = "") {
  return {
    id,
    title,
    status: value <= budget && exact ? "PASS" : "FAIL",
    samples: [value],
    unit,
    budget,
    value,
    summary: `结果 ${value.toFixed(1)}；字符完整=${exact}。${detail ? ` ${detail}` : ""}`,
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function percentile(values, percent) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)]
}

function parse(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--vsix") result.vsix = argv[++index]
    else if (argv[index] === "--output") result.output = argv[++index]
    else if (argv[index] === "--code") result.code = argv[++index]
  }
  return result
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}
