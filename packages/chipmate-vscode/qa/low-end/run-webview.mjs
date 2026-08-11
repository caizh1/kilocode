#!/usr/bin/env node

import { chromium } from "@playwright/test"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { cpus, freemem, hostname, platform, release, totalmem } from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { budgets, fixtures, profile } from "./budgets.mjs"
import { validate } from "./validate.mjs"

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, "../..")
const args = parse(process.argv.slice(2))
const output = resolve(args.output ?? `chipmate-low-end-webview-${Date.now()}`)
const evidence = join(output, "evidence")
const staticDir = join(output, "storybook")
mkdirSync(evidence, { recursive: true })

const environment = {
  hostname: hostname(),
  platform: platform(),
  release: release(),
  cpuModel: cpus()[0]?.model ?? "unknown",
  logicalCpus: cpus().length,
  totalMemoryBytes: totalmem(),
  freeMemoryBytes: freemem(),
  node: process.version,
  headless: !args.headed,
}

let server
let browser
try {
  const base = args.baseUrl ?? (await serve())
  browser = await chromium.launch({ headless: !args.headed, args: ["--disable-gpu", "--js-flags=--expose-gc"] })
  const index = await fetch(`${base}/index.json`).then((response) => response.json())
  const stories = {
    settings: story(index, "Performance/LowEnd", "Settings heavy fixture"),
    history: story(index, "Performance/LowEnd", "Long history fixture"),
    console: story(index, "Performance/LowEnd", "Agent Console fixture"),
  }
  const attempts = []
  attempts.push(await attempt(browser, base, stories, 1, args.settingsOnly === true))
  if (attempts[0].status === "FAIL") attempts.push(await attempt(browser, base, stories, 2, args.settingsOnly === true))
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
    lane: "webview",
    profile,
    fixtures,
    budgets,
    environment,
    artifact: null,
    attempts,
    status,
    summary:
      status === "PASS"
        ? args.settingsOnly
          ? "设置页已通过 2 核、8GB、HDD、无独显组合代理门禁。"
          : "当前 Webview 已通过 2 核、8GB、HDD、无独显组合代理门禁。"
        : status === "FLAKY"
          ? "首次超预算、全新 Context 复跑通过，记为 FLAKY；按当前策略不阻塞发布。"
          : status === "FAIL"
            ? "两个全新 Context 均存在确定性超预算指标，阻塞发布；本轮未修改业务代码。"
            : "基准环境或测量前置条件不可用，不能判定通过。",
    limitations: [
      "CPU 降速只精确作用于 Webview renderer，不等同于限制整机为两个物理核心。",
      "8GB 与 HDD 通过大数据 fixture、延迟和内存增长门禁代理，不制造真实系统换页或物理磁盘吞吐。",
      "该结果不代表真实低配 Windows，也不测试模型回答质量。",
      ...(args.settingsOnly ? ["本次聚焦设置页，不包含历史记录和 Agent Console 指标。"] : []),
    ],
  }
  const result = join(output, "results.json")
  const errors = validate(data)
  if (errors.length) throw new Error(`Result schema validation failed: ${errors.join("; ")}`)
  writeFileSync(result, `${JSON.stringify(data, null, 2)}\n`)
  report(result)
  archive(output)
  process.stdout.write(
    `${JSON.stringify({ status, result, report: join(output, "report.html"), evidence: `${output}-evidence.zip` }, null, 2)}\n`,
  )
  if (status === "FAIL" || status === "BLOCKED") process.exitCode = 1
} catch (error) {
  const data = blocked(error)
  const result = join(output, "results.json")
  const errors = validate(data)
  if (errors.length) process.stderr.write(`Result schema validation failed: ${errors.join("; ")}\n`)
  writeFileSync(result, `${JSON.stringify(data, null, 2)}\n`)
  report(result)
  archive(output)
  process.stderr.write(`${data.summary}\n`)
  process.exitCode = 1
} finally {
  await browser?.close()
  server?.kill("SIGTERM")
}

async function serve() {
  const build = spawnSync("bunx", ["storybook", "build", "-o", staticDir], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: "1" },
    maxBuffer: 20 * 1024 * 1024,
  })
  writeFileSync(join(evidence, "storybook-build.log"), `${build.stdout ?? ""}\n${build.stderr ?? ""}`)
  if (build.status !== 0) throw new Error(`Storybook build failed with status ${build.status}`)
  const port = await freePort()
  server = spawn("bunx", ["http-server", staticDir, "-a", "127.0.0.1", "-p", String(port), "--silent"], {
    cwd: root,
    stdio: "ignore",
  })
  const base = `http://127.0.0.1:${port}`
  for (let count = 0; count < 600; count++) {
    const response = await fetch(`${base}/index.json`).catch(() => undefined)
    if (response?.ok) return base
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Storybook HTTP server did not become ready")
}

async function attempt(browser, base, stories, number, settingsOnly) {
  const context = await browser.newContext({ viewport: { width: 940, height: 720 }, reducedMotion: "reduce" })
  const trace = join(evidence, `attempt-${number}-trace.zip`)
  // DOM snapshots retain the full 1000-turn fixture after each page closes and
  // materially distort later samples. Screenshots plus the Chromium timeline
  // preserve timing evidence without turning the recorder into the hotspot.
  await context.tracing.start({ screenshots: true, snapshots: false, sources: false })
  try {
    const metrics = []
    if (settingsOnly) {
      await settingsScroll(context, base, stories.settings, metrics, number)
    } else {
      await settings(context, base, stories.settings, metrics, number)
      await history(context, base, stories.history, metrics)
      await consolePath(context, base, stories.console, metrics)
    }
    const status = metrics.some((item) => item.status === "BLOCKED")
      ? "BLOCKED"
      : metrics.some((item) => item.status === "FAIL")
        ? "FAIL"
        : "PASS"
    await context.tracing.stop({ path: trace })
    return {
      number,
      status,
      metrics,
      evidence: { trace, screenshot: join(evidence, `attempt-${number}-settings.png`) },
      error: null,
    }
  } catch (error) {
    await context.tracing.stop({ path: trace }).catch(() => undefined)
    return {
      number,
      status: "BLOCKED",
      metrics: [],
      evidence: { trace },
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    }
  } finally {
    await context.close()
  }
}

async function settingsScroll(context, base, id, metrics, attemptNumber) {
  const item = await page(context, base, id)
  try {
    const opened = await measure(
      () => item.page.locator('[data-ui="low-end-open-settings"]').click({ noWaitAfter: true }),
      () => item.page.locator('[data-ui="settings-frame"]').waitFor({ state: "visible" }),
    )
    const selected = await select(item.page, "indexing")
    const frames = await scrollIndexingSettings(item.page)
    await item.page.screenshot({ path: join(evidence, `attempt-${attemptNumber}-settings.png`), fullPage: true })
    metrics.push(timing("settings.open", "点击打开设置", [opened], budgets.settingsOpenMs, "median", true))
    metrics.push(
      timing("settings.tab.indexing.first", "indexing 首次打开", [selected], budgets.indexingMs, "median", true),
    )
    recordIndexingScrollMetrics(metrics, frames)
  } finally {
    await item.page.close()
  }
}

async function settings(context, base, id, metrics, attemptNumber) {
  const open = []
  const tabs = ["models", "providers", "agentBehaviour", "indexing", "experimental", "chipmateServer"]
  const first = Object.fromEntries(tabs.map((id) => [id, []]))
  const revisit = Object.fromEntries(tabs.map((id) => [id, []]))
  const tasks = []
  const input = []
  const saves = []
  const exact = []
  const heaps = []
  const scrollFrames = []
  for (let count = 0; count < 5; count++) {
    const item = await page(context, base, id)
    const elapsed = await measure(
      () => item.page.locator('[data-ui="low-end-open-settings"]').click({ noWaitAfter: true }),
      () => item.page.locator('[data-ui="settings-frame"]').waitFor({ state: "visible" }),
    )
    open.push(elapsed)
    first.models.push(elapsed)
    for (const tab of tabs.slice(1)) first[tab].push(await select(item.page, tab))
    for (const tab of tabs) revisit[tab].push(await select(item.page, tab))
    if (count === 0) {
      await select(item.page, "indexing")
      scrollFrames.push(...(await scrollIndexingSettings(item.page)))
      await item.page.screenshot({ path: join(evidence, `attempt-${attemptNumber}-settings.png`), fullPage: true })
      await select(item.page, "chipmateServer")
      await item.page.evaluate(() => {
        globalThis.__chipmateLowEndInput = []
        document.addEventListener(
          "input",
          () => {
            const start = performance.now()
            requestAnimationFrame(() => globalThis.__chipmateLowEndInput.push(performance.now() - start))
          },
          true,
        )
      })
      const field = item.page.locator("#chipmate-server-base-url")
      await field.click()
      await field.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
      await field.press("Backspace")
      const value = "http://127.0.0.1:6001/performance-test-0123456789abcdef"
      await field.pressSequentially(value)
      await item.page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      exact.push((await field.inputValue()) === value)
      input.push(...(await item.page.evaluate(() => globalThis.__chipmateLowEndInput ?? [])))
      await item.page.locator('[data-ui="settings-save-bar"]').waitFor({ state: "visible" })
      saves.push(
        await measure(
          () => item.page.locator(".settings-save-button").click({ noWaitAfter: true }),
          () => item.page.locator('[data-ui="settings-save-bar"]').waitFor({ state: "hidden" }),
        ),
      )
      await item.cdp.send("HeapProfiler.enable")
      await item.cdp.send("HeapProfiler.collectGarbage")
      const before = await heap(item.cdp)
      for (let cycle = 0; cycle < 10; cycle++) {
        for (const tab of tabs) await select(item.page, tab)
      }
      await item.cdp.send("HeapProfiler.collectGarbage")
      const after = await heap(item.cdp)
      heaps.push({ before, after })
    }
    tasks.push(...(await item.page.evaluate(() => globalThis.__chipmateLowEndTasks ?? [])))
    await item.page.close()
  }
  metrics.push(timing("settings.open", "点击打开设置", open, budgets.settingsOpenMs, "median", true))
  for (const tab of tabs) {
    metrics.push(
      timing(
        `settings.tab.${tab}.first`,
        `${tab} 首次打开`,
        first[tab],
        tab === "indexing" ? budgets.indexingMs : budgets.tabFirstMs,
        "median",
        true,
      ),
    )
    metrics.push(timing(`settings.tab.${tab}.revisit`, `${tab} 再次打开`, revisit[tab], budgets.tabRevisitMs, "p95"))
  }
  metrics.push(timing("settings.input.p95", "设置逐字符输入 p95", input, budgets.inputP95Ms, "p95"))
  metrics.push(timing("settings.input.max", "设置逐字符输入最大延迟", input, budgets.inputMaxMs, "max"))
  metrics.push(
    flag(
      "settings.input.exact",
      "设置输入字符完整性",
      exact.every(Boolean),
      `${exact.filter(Boolean).length}/${exact.length} 个样本完全一致`,
    ),
  )
  metrics.push(timing("settings.save", "设置保存确认", saves, budgets.saveMs, "median", true))
  recordIndexingScrollMetrics(metrics, scrollFrames)
  metrics.push(
    timing("webview.longtask.max", "Webview 主线程最长冻结", tasks.length ? tasks : [0], budgets.stallMaxMs, "max"),
  )
  if (heaps.length) {
    const growth = heaps[0].after - heaps[0].before
    const percent = heaps[0].before > 0 ? (growth / heaps[0].before) * 100 : 0
    metrics.push(
      numberMetric("webview.heap.growth.bytes", "十轮切换后 JS heap 增长", growth, budgets.heapGrowthBytes, "bytes"),
    )
    metrics.push(
      numberMetric(
        "webview.heap.growth.percent",
        "十轮切换后 JS heap 增幅",
        percent,
        budgets.heapGrowthPercent,
        "percent",
      ),
    )
  }
}

function recordIndexingScrollMetrics(metrics, scrollFrames) {
  metrics.push(
    timing(
      "settings.indexing.scroll.frame.p95",
      "索引设置滚动帧间隔 p95",
      scrollFrames,
      budgets.settingsScrollP95Ms,
      "p95",
    ),
  )
  metrics.push(
    timing(
      "settings.indexing.scroll.frame.max",
      "索引设置滚动最大帧间隔",
      scrollFrames,
      budgets.settingsScrollMaxMs,
      "max",
    ),
  )
  metrics.push(
    numberMetric(
      "settings.indexing.scroll.over32.percent",
      "索引设置超过 32ms 的滚动帧比例",
      scrollFrames.length ? (scrollFrames.filter((value) => value > 32).length / scrollFrames.length) * 100 : 100,
      budgets.settingsScrollOver32Percent,
      "percent",
    ),
  )
}

async function history(context, base, id, metrics) {
  const returns = []
  const input = []
  const exact = []
  for (let count = 0; count < 5; count++) {
    const item = await page(context, base, id)
    const conversation = item.page.locator('[data-ui="qa-conversation"]')
    const mounted = await visible(conversation, 30_000)
    if (!mounted) {
      returns.push(30_000)
      await item.page.close()
      continue
    }
    if (count === 0) {
      await item.page.evaluate(() => {
        globalThis.__chipmateLowEndInput = []
        document.addEventListener(
          "input",
          () => {
            const start = performance.now()
            requestAnimationFrame(() => globalThis.__chipmateLowEndInput.push(performance.now() - start))
          },
          true,
        )
      })
      const field = item.page.locator("textarea.prompt-input")
      const value = "low-end-qa-input-0123456789012345678901234567890123456789"
      await field.pressSequentially(value)
      await item.page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      exact.push((await field.inputValue()) === value)
      input.push(...(await item.page.evaluate(() => globalThis.__chipmateLowEndInput ?? [])))
    }
    await item.page.locator('[data-ui="low-end-history-open"]').click({ noWaitAfter: true })
    await item.page.locator('[data-ui="low-end-history-screen"]').waitFor({ state: "visible" })
    const start = performance.now()
    await item.page.locator(".history-view-header button").first().click({ noWaitAfter: true })
    const restored = await visible(conversation, 30_000)
    returns.push(restored ? performance.now() - start : 30_000)
    await item.page.close()
  }
  metrics.push(timing("qa.input.p95", "QA 输入延迟 p95", input, budgets.inputP95Ms, "p95"))
  metrics.push(timing("qa.input.max", "QA 输入最大延迟", input, budgets.inputMaxMs, "max"))
  metrics.push(
    flag(
      "qa.input.exact",
      "QA 输入字符完整性",
      exact.every(Boolean),
      `${exact.filter(Boolean).length}/${exact.length} 个样本完全一致`,
    ),
  )
  metrics.push(timing("history.return", "返回 1000-turn 会话", returns, budgets.historyReturnMs, "median", true))
}

async function consolePath(context, base, id, metrics) {
  const opens = []
  const outputs = []
  for (let count = 0; count < 5; count++) {
    const item = await page(context, base, id)
    opens.push(
      await measure(
        () => item.page.locator('[data-ui="low-end-open-console"]').click({ noWaitAfter: true }),
        () => item.page.locator('[data-component="agent-console"]').waitFor({ state: "visible" }),
      ),
    )
    if (count === 0) {
      await item.page
        .locator('[data-slot="agent-console-mode"] button[data-value="shell"]')
        .click({ noWaitAfter: true })
      const field = item.page.locator(".xterm-helper-textarea")
      await field.pressSequentially("printf CHIPMATE_LOW_END_OK")
      outputs.push(
        await measure(
          () => field.press("Enter"),
          () => item.page.locator(".xterm-screen").getByText("CHIPMATE_LOW_END_OK").waitFor(),
        ),
      )
    }
    await item.page.close()
  }
  metrics.push(timing("console.open", "Agent Console 打开", opens, budgets.consoleOpenMs, "median", true))
  metrics.push(timing("console.output", "Agent Console 固定命令输出", outputs, budgets.consoleOutputMs, "median", true))
}

async function page(context, base, id) {
  const page = await context.newPage()
  await page.addInitScript(() => {
    globalThis.__chipmateLowEndTasks = []
    if (typeof PerformanceObserver === "undefined") return
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) globalThis.__chipmateLowEndTasks.push(entry.duration)
    })
    try {
      observer.observe({ type: "longtask", buffered: true })
    } catch (error) {
      globalThis.__chipmateLowEndObserverError = String(error)
    }
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate })
  await cdp.send("Network.enable")
  await cdp.send("Performance.enable")
  await page.goto(`${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  })
  await page.locator("#storybook-root").waitFor({ state: "visible", timeout: 60_000 })
  // Storybook assets stand in for files bundled inside the VSIX and therefore
  // load locally. Apply slow-network conditions only after the production
  // component chain is present so service traffic, not fixture delivery, is
  // throttled.
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.network.latencyMs,
    downloadThroughput: profile.network.downloadBytesPerSecond,
    uploadThroughput: profile.network.uploadBytesPerSecond,
    connectionType: "cellular3g",
  })
  return { page, cdp }
}

async function select(page, tab) {
  const target = page.locator(`[data-ui="settings-nav-item"][data-value="${tab}"]`)
  return measure(
    () => target.click({ noWaitAfter: true }),
    async () => {
      await target.waitFor({ state: "visible" })
      await page.waitForFunction(
        (value) =>
          document
            .querySelector(`[data-ui="settings-nav-item"][data-value="${value}"]`)
            ?.getAttribute("aria-selected") === "true",
        tab,
      )
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    },
  )
}

async function scrollIndexingSettings(page) {
  const content = page.locator('[data-ui="settings-content"]:visible')
  return content.evaluate(async (element) => {
    const frames = []
    let progress = 63
    const timer = setInterval(() => {
      progress = progress >= 99 ? 1 : progress + 1
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "indexingStatusLoaded",
            status: {
              state: "In Progress",
              message: "Deterministic low-end indexing fixture",
              processedFiles: progress * 10,
              totalFiles: 1_000,
              percent: progress,
              pipelines: {
                codeGraph: {
                  state: "Complete",
                  message: "Code Graph complete",
                  processedFiles: 1_000,
                  totalFiles: 1_000,
                  percent: 100,
                  errorCount: 0,
                  staleCount: 0,
                  skippedCount: 0,
                },
                rag: {
                  state: "In Progress",
                  message: "Code RAG indexing",
                  processedFiles: progress * 10,
                  totalFiles: 1_000,
                  percent: progress,
                  errorCount: 0,
                  staleCount: 0,
                  skippedCount: 0,
                },
                documents: {
                  state: "Standby",
                  message: "Document RAG waiting",
                  processedFiles: 0,
                  totalFiles: 50,
                  percent: 0,
                  errorCount: 0,
                  staleCount: 0,
                  skippedCount: 0,
                },
              },
            },
          },
        }),
      )
    }, 250)

    const scroll = (target) =>
      new Promise((resolve) => {
        let previous
        const direction = target > element.scrollTop ? 1 : -1
        const step = (now) => {
          if (previous !== undefined) frames.push(now - previous)
          previous = now
          element.scrollTop = Math.min(target, Math.max(0, element.scrollTop + direction * 18))
          if (element.scrollTop === target) {
            resolve()
            return
          }
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })

    try {
      const bottom = element.scrollHeight - element.clientHeight
      if (bottom <= 0) throw new Error("索引设置页没有可测量的滚动范围。")
      element.scrollTop = 0
      for (let cycle = 0; cycle < 5; cycle++) {
        await scroll(bottom)
        await scroll(0)
      }
      return frames
    } finally {
      clearInterval(timer)
    }
  })
}

async function measure(action, ready) {
  const start = performance.now()
  await action()
  await ready()
  return performance.now() - start
}

async function visible(locator, timeout) {
  return locator
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false)
}

async function heap(cdp) {
  const data = await cdp.send("Performance.getMetrics")
  return data.metrics.find((item) => item.name === "JSHeapUsedSize")?.value ?? 0
}

function timing(id, title, samples, budget, stat, guard = false) {
  if (!samples.length)
    return { id, title, status: "BLOCKED", samples, unit: "ms", budget, value: null, summary: "没有采集到样本。" }
  const value = stat === "median" ? median(samples) : stat === "p95" ? percentile(samples, 95) : Math.max(...samples)
  const over = guard && Math.max(...samples) > budget * 2
  const status = value <= budget && !over ? "PASS" : "FAIL"
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

function numberMetric(id, title, value, budget, unit) {
  return {
    id,
    title,
    status: value <= budget ? "PASS" : "FAIL",
    samples: [value],
    unit,
    budget,
    value,
    summary: `结果 ${value.toFixed(1)}，门槛 ${budget.toFixed(1)}。`,
  }
}

function flag(id, title, pass, summary) {
  return {
    id,
    title,
    status: pass ? "PASS" : "FAIL",
    samples: [pass ? 1 : 0],
    unit: "boolean",
    budget: 1,
    value: pass ? 1 : 0,
    summary,
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

function story(index, title, name) {
  const entry = Object.values(index.entries ?? index.v3?.entries ?? {}).find(
    (item) => item.title === title && item.name === name,
  )
  if (!entry?.id) throw new Error(`Story not found: ${title} / ${name}`)
  return entry.id
}

function parse(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--headed") result.headed = true
    if (arg === "--settings-only") result.settingsOnly = true
    if (arg === "--output") result.output = argv[++index]
    if (arg === "--base-url") result.baseUrl = argv[++index]
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

function report(result) {
  spawnSync(process.execPath, [join(dir, "report.mjs"), result, join(output, "report.html")], { stdio: "inherit" })
}

function archive(path) {
  const target = `${path}-evidence.zip`
  if (platform() === "darwin") {
    spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", path, target])
    return
  }
  spawnSync("zip", ["-qr", target, path])
}

function blocked(error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  return {
    generatedAt: new Date().toISOString(),
    lane: "webview",
    profile,
    fixtures,
    budgets,
    environment,
    artifact: null,
    attempts: [{ number: 1, status: "BLOCKED", metrics: [], evidence: {}, error: message }],
    status: "BLOCKED",
    summary: `低配 Webview 基准被阻塞：${message}`,
    limitations: ["阻塞结果不得解释为性能通过。"],
  }
}
