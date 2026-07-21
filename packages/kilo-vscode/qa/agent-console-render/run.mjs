#!/usr/bin/env node

import { chromium } from "@playwright/test"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { cpus, freemem, hostname, platform, release, totalmem } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { validate } from "./schema.mjs"

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, "../..")
const repo = resolve(root, "../..")
const args = parse(process.argv.slice(2))
const output = resolve(args.output ?? `chipmate-agent-console-render-${Date.now()}`)
const evidence = join(output, "evidence")
const staticDir = join(output, "storybook")
const scales = [1, 1.25, 1.5, 2]
const gpus = ["default", "disabled"]
const widths = [1_143, 940, 640, 420, 300]
mkdirSync(evidence, { recursive: true })

const source = {
  head: git(["rev-parse", "HEAD"]),
  dirty: git(["status", "--short"]),
}
const environment = {
  hostname: hostname(),
  platform: platform(),
  release: release(),
  cpuModel: cpus()[0]?.model ?? "unknown",
  logicalCpus: cpus().length,
  totalMemoryBytes: totalmem(),
  freeMemoryBytes: freemem(),
  node: process.version,
  chromium: chromium.executablePath(),
  cpuThrottle: 6,
  scales,
  gpus,
  widths,
  headed: Boolean(args.headed),
}

let server
try {
  const base = args.baseUrl ?? (await serve())
  const index = await fetch(`${base}/index.json`).then((response) => response.json())
  const storyId = story(index, "Performance/LowEnd", "Agent Console fixture")
  const attempts = [await attempt(base, storyId, 1)]
  if (attempts[0].status === "FAIL") {
    attempts.push(await attempt(base, storyId, 2))
    attempts.push(await attempt(base, storyId, 3))
  }
  const status = overall(attempts)
  const data = {
    generatedAt: new Date().toISOString(),
    lane: "macos-source-render-proxy",
    source,
    environment,
    status,
    attempts,
    summary: summary(status),
    limitations: [
      "源码 Story 使用真实生产 TerminalTab/xterm 和测试态 Socket，但不经过扩展宿主或真实远端 PTY。",
      "macOS 的 Chromium 字体栅格化、GPU 合成和缩放不能证明 Windows DirectWrite 与原生显示缩放无问题。",
      "140ms 透明度切换只生成 contact sheet 和视频，保留为 REVIEW，不由机器替用户判断观感。",
      "本轮不测试模型回答质量，也不修改 Agent Console 业务代码或视觉样式。",
    ],
  }
  const errors = validate(data)
  if (errors.length) throw new Error(`Result schema validation failed: ${errors.join("; ")}`)
  const result = join(output, "results.json")
  writeFileSync(result, `${JSON.stringify(data, null, 2)}\n`)
  spawnSync(process.execPath, [join(dir, "report.mjs"), result, join(output, "report.html")], { stdio: "inherit" })
  archive(output)
  process.stdout.write(
    `${JSON.stringify({ status, result, report: join(output, "report.html"), evidence: `${output}-evidence.zip` }, null, 2)}\n`,
  )
  if (status === "FAIL" || status === "BLOCKED") process.exitCode = 1
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  const data = {
    generatedAt: new Date().toISOString(),
    lane: "macos-source-render-proxy",
    source,
    environment,
    status: "BLOCKED",
    attempts: [],
    summary: `macOS Agent Console 渲染代理测试被阻塞：${message}`,
    limitations: ["BLOCKED 不得解释为通过。"],
  }
  writeFileSync(join(output, "results.json"), `${JSON.stringify(data, null, 2)}\n`)
  process.stderr.write(`${data.summary}\n`)
  process.exitCode = 1
} finally {
  server?.kill("SIGTERM")
}

async function serve() {
  const build = spawnSync("bunx", ["storybook", "build", "-o", staticDir], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: "1" },
    maxBuffer: 40 * 1024 * 1024,
  })
  writeFileSync(join(evidence, "storybook-build.log"), `${build.stdout ?? ""}\n${build.stderr ?? ""}`)
  if (build.status !== 0) throw new Error(`Storybook build failed with status ${build.status}`)
  const port = await freePort()
  server = spawn("bunx", ["http-server", staticDir, "-a", "127.0.0.1", "-p", String(port), "--silent"], {
    cwd: root,
    stdio: "ignore",
  })
  const base = `http://127.0.0.1:${port}`
  for (let count = 0; count < 100; count++) {
    const response = await fetch(`${base}/index.json`).catch(() => undefined)
    if (response?.ok) return base
    await wait(100)
  }
  throw new Error("Storybook HTTP server did not become ready")
}

async function attempt(base, storyId, number) {
  const cases = []
  let halted = false
  for (const gpu of gpus) {
    if (halted) {
      for (const scale of scales) cases.push(gated(number, gpu, scale))
      continue
    }
    const flags = ["--js-flags=--expose-gc"]
    if (gpu === "disabled") flags.push("--disable-gpu", "--disable-software-rasterizer")
    const browser = await chromium.launch({ headless: !args.headed, args: flags })
    try {
      for (const scale of scales) {
        if (halted) {
          cases.push(gated(number, gpu, scale))
          continue
        }
        const result = await run(browser, base, storyId, number, gpu, scale)
        cases.push(result)
        halted = result.status === "FAIL"
      }
    } finally {
      await bounded(browser.close(), 10_000)
    }
  }
  const statuses = cases.map((item) => item.status)
  const status = statuses.includes("FAIL")
    ? "FAIL"
    : statuses.includes("BLOCKED")
      ? "BLOCKED"
      : statuses.includes("REVIEW")
        ? "REVIEW"
        : "PASS"
  return { number, status, cases }
}

async function run(browser, base, storyId, attemptNumber, gpu, scale) {
  const id = `run-${attemptNumber}-${gpu}-scale-${String(scale).replace(".", "_")}`
  const path = join(evidence, id)
  const frameDir = join(path, "frames")
  mkdirSync(frameDir, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: 940, height: 720 },
    deviceScaleFactor: scale,
    reducedMotion: "no-preference",
  })
  const trace = join(path, "playwright-trace.zip")
  await context.tracing.start({ screenshots: true, snapshots: false, sources: false })
  const page = await context.newPage()
  await instrument(page)
  const cdp = await context.newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 })
  await cdp.send("Performance.enable")
  const cast = await screencast(cdp, frameDir)
  const assertions = []
  const layout = []
  try {
    await page.goto(`${base}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    })
    await page.locator('[data-ui="low-end-open-console"]').click({ noWaitAfter: true })
    await page.locator(".am-terminal-host .xterm-screen").waitFor({ state: "visible", timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.__chipmateTerminalQA))
    await page.evaluate(() => {
      window.__chipmateTerminalLongTasks = []
      window.__chipmateTerminalLayoutShifts = []
      window.__chipmateTerminalResizeEvents = []
    })

    const mixed = await scenario(page, "mixed", path)
    assertions.push(check("pty.mixed.exact", mixed.exact, mixed.summary))
    assertions.push(check("pty.mixed.tail", mixed.tail, "ANSI、CR、退格、清屏、长行、中文与 emoji 的结束标记可见。"))

    await page.evaluate(() => {
      void window.__chipmateTerminalQA?.start("bytes")
    })
    const shellShots = []
    const shell = page.locator('[data-slot="agent-console-mode"] button[data-value="shell"]')
    const agent = page.locator('[data-slot="agent-console-mode"] button[data-value="agent"]')
    for (let batch = 0; batch < 10; batch++) {
      await page.evaluate(() => {
        const agent = document.querySelector('[data-slot="agent-console-mode"] button[data-value="agent"]')
        const shell = document.querySelector('[data-slot="agent-console-mode"] button[data-value="shell"]')
        if (!(agent instanceof HTMLElement) || !(shell instanceof HTMLElement)) return
        for (let step = 0; step < 5; step++) {
          agent.click()
          shell.click()
        }
      })
      await page.waitForTimeout(180)
      const shot = cast.latest()
      if (shot) shellShots.push(shot)
    }
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".xterm-rows > div")].some((row) =>
          row.textContent?.includes("CHIPMATE_BYTES_DONE"),
        ),
      null,
      { timeout: 60_000 },
    )
    const bytes = await transcript(page, path, "bytes")
    assertions.push(check("pty.bytes.exact", bytes.emitted === bytes.received, describeTranscript(bytes)))

    await cast.stop()

    const edges = shellShots.map((shot) => edge(shot)).filter(Number.isFinite)
    assertions.push(
      edges.length
        ? check(
            "render.no-blank-shell-return",
            Math.min(...edges) > 0.05,
            `10 个 Shell 返回关键帧边缘分数 min=${Math.min(...edges).toFixed(3)}。`,
          )
        : blocked("render.no-blank-shell-return", "FFmpeg 未能读取关键帧，空白帧机器断言无法执行。"),
    )

    await shell.click({ noWaitAfter: true })
    const field = page.locator(".xterm-helper-textarea")
    await field.click()
    await field.pressSequentially("printf CHIPMATE_COMMAND_ONCE", { delay: 2 })
    await field.press("Enter")
    await field.press("Control+C")
    const input = await page.evaluate(() => window.__chipmateTerminalQA?.stats())
    assertions.push(check("input.command-once", input?.commands === 1, `命令执行计数=${input?.commands ?? "missing"}。`))
    assertions.push(check("input.ctrl-c-once", input?.interrupts === 1, `Ctrl+C 计数=${input?.interrupts ?? "missing"}。`))

    const burst = await scenario(page, "burst", path)
    assertions.push(check("pty.burst.exact", burst.exact, burst.summary))
    assertions.push(check("pty.burst.tail", burst.tail, "5000 行突发输出结束标记位于当前终端缓冲区末尾。"))

    for (const width of widths) {
      const resized = await bounded(page.setViewportSize({ width, height: 720 }), 5_000)
      assertions.push(
        check(
          `layout.${width}.responsive`,
          resized,
          resized
            ? `压力输出后 ${width}px resize 在 5 秒 watchdog 内完成。`
            : `压力输出后 ${width}px resize 超过 5 秒，远超 500ms 主线程冻结门槛。`,
        ),
      )
      if (!resized) throw new Error(`Renderer did not acknowledge ${width}px viewport resize within 5 seconds`)
      await shell.click({ noWaitAfter: true })
      await page.waitForTimeout(180)
      const samples = []
      for (let count = 0; count < 10; count++) {
        samples.push(await rects(page, width))
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
      }
      layout.push({ width, samples })
      const drift = jitter(samples)
      assertions.push(
        check(
          `layout.${width}.drift`,
          drift <= 1,
          `固定宽度 ${width}px 下 toolbar/xterm 最大漂移 ${drift.toFixed(3)} CSS px。`,
        ),
      )
      await agent.click({ noWaitAfter: true })
      await page.waitForTimeout(180)
      const prompt = await promptRect(page)
      assertions.push(
        check(
          `layout.${width}.prompt-contained`,
          prompt.contained,
          `Agent 输入行 contained=${prompt.contained}，宽=${prompt.prompt?.width?.toFixed(1) ?? "missing"}。`,
        ),
      )
      await shell.click({ noWaitAfter: true })
      await page.waitForTimeout(180)
      const geometry = await rowGeometry(page)
      assertions.push(
        check(
          `layout.${width}.rows`,
          geometry.overlaps === 0 && !geometry.cursorClipped,
          `相邻行重叠=${geometry.overlaps}，光标裁剪=${geometry.cursorClipped}。`,
        ),
      )
      const captured = await bounded(page.screenshot({ path: join(path, `width-${width}.png`) }), 5_000)
      if (!captured)
        assertions.push(blocked(`evidence.${width}.screenshot`, `${width}px 采证截图超过 5 秒，布局机器坐标已保留。`))
    }

    const other = await context.newPage()
    await other.goto("about:blank")
    await page.bringToFront()
    await other.close()
    await page.waitForTimeout(200)
    assertions.push(
      check(
        "focus.restore",
        await visibleText(page, "CHIPMATE_BURST_DONE"),
        "窗口失焦恢复后仍显示最后完成的 burst 结束标记。",
      ),
    )

    const perf = await page.evaluate(() => ({
      tasks: window.__chipmateTerminalLongTasks ?? [],
      shifts: window.__chipmateTerminalLayoutShifts ?? [],
      resizes: window.__chipmateTerminalResizeEvents ?? [],
    }))
    const longest = perf.tasks.length ? Math.max(...perf.tasks) : 0
    assertions.push(check("main-thread.max-500ms", longest <= 500, `最长主线程任务 ${longest.toFixed(1)}ms。`))
    const resizeRate = peak(perf.resizes, 1_000)
    assertions.push(check("resize.no-loop", resizeRate <= 120, `ResizeObserver 峰值 ${resizeRate} 次/秒。`))

    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 })
    await page.locator('[data-ui="low-end-open-console"]').click({ noWaitAfter: true })
    await page.locator(".am-terminal-host .xterm-screen").waitFor({ state: "visible", timeout: 60_000 })
    const reload = await scenario(page, "mixed", path, "reload")
    assertions.push(check("reload.restore", reload.exact && reload.tail, reload.summary))

    assertions.push(review("visual.opacity-140ms", "淡入淡出观感只进入逐帧视频和 contact sheet，由用户复核。"))
    writeFileSync(join(path, "layout.json"), `${JSON.stringify(layout, null, 2)}\n`)
    writeFileSync(join(path, "performance.json"), `${JSON.stringify(perf, null, 2)}\n`)
  } catch (error) {
    assertions.push(blocked("runner.execution", error instanceof Error ? (error.stack ?? error.message) : String(error)))
  } finally {
    await bounded(cast.stop(), 5_000)
    await bounded(context.tracing.stop({ path: trace }).catch(() => undefined), 5_000)
    await bounded(page.screenshot({ path: join(path, "final.png") }).catch(() => undefined), 5_000)
    await bounded(context.close(), 5_000)
  }

  const media = renderMedia(frameDir, path)
  const status = assertions.some((item) => item.status === "FAIL")
    ? "FAIL"
    : assertions.some((item) => item.status === "BLOCKED")
      ? "BLOCKED"
      : assertions.some((item) => item.status === "REVIEW")
        ? "REVIEW"
        : "PASS"
  return {
    id,
    gpu,
    scale,
    status,
    assertions,
    evidence: { path, trace, frames: cast.count(), ...media },
  }
}

async function instrument(page) {
  await page.addInitScript(() => {
    window.__chipmateTerminalLongTasks = []
    window.__chipmateTerminalLayoutShifts = []
    window.__chipmateTerminalResizeEvents = []
    if (typeof PerformanceObserver !== "undefined") {
      try {
        const tasks = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__chipmateTerminalLongTasks.push(entry.duration)
        })
        tasks.observe({ type: "longtask", buffered: true })
      } catch (error) {
        window.__chipmateTerminalObserverError = String(error)
      }
      try {
        const shifts = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__chipmateTerminalLayoutShifts.push(entry.value)
        })
        shifts.observe({ type: "layout-shift", buffered: true })
      } catch (error) {
        window.__chipmateTerminalShiftError = String(error)
      }
    }
    const Native = window.ResizeObserver
    window.ResizeObserver = class extends Native {
      constructor(callback) {
        super((entries, observer) => {
          window.__chipmateTerminalResizeEvents.push(performance.now())
          callback(entries, observer)
        })
      }
    }
  })
}

async function scenario(page, name, path, suffix = name) {
  const stats = await page.evaluate((value) => window.__chipmateTerminalQA?.start(value), name)
  await page.waitForFunction(
    (tail) =>
      [...document.querySelectorAll(".xterm-rows > div")].some((row) => row.textContent?.includes(tail)),
    stats.expectedTail,
    { timeout: 60_000 },
  )
  const data = await transcript(page, path, suffix)
  return {
    exact: data.emitted === data.received,
    tail: await visibleText(page, stats.expectedTail),
    summary: describeTranscript(data),
  }
}

async function transcript(page, path, name) {
  const data = await page.evaluate(() => window.__chipmateTerminalQA?.transcript())
  if (!data) return { emitted: "", received: "", input: "" }
  writeFileSync(join(path, `pty-${name}-emitted.log`), data.emitted)
  writeFileSync(join(path, `pty-${name}-received.log`), data.received)
  writeFileSync(join(path, `pty-${name}-input.log`), data.input)
  return data
}

function describeTranscript(data) {
  return `发出 ${Buffer.byteLength(data.emitted)} bytes，TerminalTab 收到 ${Buffer.byteLength(data.received)} bytes，顺序与内容 exact=${data.emitted === data.received}。`
}

async function visibleText(page, tail) {
  const expected = tail ?? "CHIPMATE_MIXED_DONE"
  return page.evaluate(
    (value) => [...document.querySelectorAll(".xterm-rows > div")].some((row) => row.textContent?.includes(value)),
    expected,
  )
}

async function rects(page, width) {
  return page.evaluate((viewport) => {
    const read = (selector) => {
      const node = document.querySelector(selector)
      if (!(node instanceof HTMLElement)) return null
      const rect = node.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }
    }
    return {
      viewport,
      toolbar: read('[data-slot="agent-console-toolbar"]'),
      host: read(".am-terminal-host"),
      screen: read(".xterm-screen"),
    }
  }, width)
}

async function promptRect(page) {
  return page.evaluate(() => {
    const area = document.querySelector('[data-slot="agent-console-layers"]')?.getBoundingClientRect()
    const prompt = document.querySelector('[data-component="agent-console-prompt"]')?.getBoundingClientRect()
    if (!area || !prompt) return { contained: false, area: null, prompt: null }
    return {
      contained:
        prompt.left >= area.left - 1 &&
        prompt.right <= area.right + 1 &&
        prompt.top >= area.top - 1 &&
        prompt.bottom <= area.bottom + 1,
      area: { x: area.x, y: area.y, width: area.width, height: area.height },
      prompt: { x: prompt.x, y: prompt.y, width: prompt.width, height: prompt.height },
    }
  })
}

async function rowGeometry(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll(".xterm-rows > div")].map((node) => node.getBoundingClientRect())
    const overlaps = rows.slice(1).filter((row, index) => row.top < rows[index].bottom - 1).length
    const screen = document.querySelector(".xterm-screen")?.getBoundingClientRect()
    const cursor = document.querySelector(".xterm-cursor")?.getBoundingClientRect()
    const cursorClipped = Boolean(
      screen && cursor && (cursor.left < screen.left - 1 || cursor.right > screen.right + 1 || cursor.bottom > screen.bottom + 1),
    )
    return { rows: rows.length, overlaps, cursorClipped }
  })
}

function jitter(samples) {
  const values = []
  for (const key of ["toolbar", "host", "screen"])
    for (const field of ["x", "y", "width", "height"]) {
      const list = samples.map((item) => item[key]?.[field]).filter(Number.isFinite)
      if (list.length) values.push(Math.max(...list) - Math.min(...list))
    }
  return values.length ? Math.max(...values) : Number.POSITIVE_INFINITY
}

async function screencast(cdp, frameDir) {
  let count = 0
  let saved = 0
  const max = 360
  cdp.on("Page.screencastFrame", async (event) => {
    count += 1
    if (saved < max) {
      saved += 1
      writeFileSync(join(frameDir, `frame-${String(saved).padStart(4, "0")}.jpg`), Buffer.from(event.data, "base64"))
    }
    await cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined)
  })
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 1_143, maxHeight: 720, everyNthFrame: 2 })
  return {
    count: () => ({ observed: count, saved }),
    latest: () => (saved ? join(frameDir, `frame-${String(saved).padStart(4, "0")}.jpg`) : null),
    stop: () => cdp.send("Page.stopScreencast").catch(() => undefined),
  }
}

function edge(path) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "info", "-i", path, "-vf", "format=gray,edgedetect,signalstats,metadata=print", "-frames:v", "1", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  )
  const match = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(/lavfi\.signalstats\.YAVG=([\d.]+)/)
  return match ? Number(match[1]) : Number.NaN
}

function renderMedia(frameDir, path) {
  const frames = readdirSync(frameDir).filter((name) => name.endsWith(".jpg")).sort()
  if (!frames.length) return { video: null, contactSheet: null }
  const video = join(path, "screencast.mp4")
  const contact = join(path, "contact-sheet.jpg")
  spawnSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-loglevel", "error", "-framerate", "15", "-i", join(frameDir, "frame-%04d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", video],
    { stdio: "ignore" },
  )
  spawnSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-loglevel", "error", "-pattern_type", "glob", "-i", join(frameDir, "*.jpg"), "-vf", "select='not(mod(n,18))',scale=320:-1,tile=5x4", "-frames:v", "1", contact],
    { stdio: "ignore" },
  )
  return { video, contactSheet: contact }
}

function peak(values, windowMs) {
  let max = 0
  for (let left = 0, right = 0; right < values.length; right++) {
    while (values[right] - values[left] > windowMs) left += 1
    max = Math.max(max, right - left + 1)
  }
  return max
}

function check(id, pass, summary) {
  return { id, status: pass ? "PASS" : "FAIL", summary }
}

function blocked(id, summary) {
  return { id, status: "BLOCKED", summary }
}

function gated(number, gpu, scale) {
  return {
    id: `run-${number}-${gpu}-scale-${String(scale).replace(".", "_")}`,
    gpu,
    scale,
    status: "BLOCKED",
    assertions: [blocked("runner.gated", "同一轮较早的确定性 FAIL 已阻止后续矩阵，避免用已失控的渲染环境污染结果。")],
    evidence: {},
  }
}

function review(id, summary) {
  return { id, status: "REVIEW", summary }
}

function overall(attempts) {
  if (attempts[0].status === "PASS") return "PASS"
  if (attempts[0].status === "REVIEW") return "REVIEW"
  if (attempts[0].status === "BLOCKED") return "BLOCKED"
  if (attempts.every((item) => item.status === "FAIL")) return "FAIL"
  return "FLAKY"
}

function summary(status) {
  if (status === "PASS") return "macOS 源码渲染代理的全部机器断言通过。"
  if (status === "REVIEW") return "macOS 源码渲染代理的机器断言通过；140ms 透明度切换仍待 contact sheet 人工复核。"
  if (status === "FLAKY") return "首次失败后两个全新 Context 的结果不一致，记为 FLAKY。"
  if (status === "FAIL") return "三个全新 Context 均复现确定性渲染或交互失败；本轮未修改业务代码。"
  return "测试环境或执行链路被阻塞，不能判定通过。"
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
    if (arg === "--output") result.output = argv[++index]
    if (arg === "--base-url") result.baseUrl = argv[++index]
  }
  return result
}

function git(argv) {
  return spawnSync("git", argv, { cwd: repo, encoding: "utf8" }).stdout.trim()
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

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

async function bounded(promise, timeout) {
  return Promise.race([promise.then(() => true, () => false), wait(timeout).then(() => false)])
}

function archive(path) {
  const target = `${path}-evidence.zip`
  if (platform() === "darwin") {
    spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", path, target])
    return
  }
  spawnSync("zip", ["-qr", target, path])
}
