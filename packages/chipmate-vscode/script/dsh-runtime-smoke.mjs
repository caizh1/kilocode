#!/usr/bin/env node
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const runtime = process.argv[2]
if (!runtime) throw new Error("缺少 DSH 运行时目录")

const require = createRequire(pathToFileURL(join(runtime, "package.json")))
console.log("[smoke] 开始 sharp 实际转换")
const sharp = require(join(runtime, "node_modules", "sharp"))
const image = await sharp({
  create: { width: 1, height: 1, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
})
  .png()
  .toBuffer()
if (image.length === 0) throw new Error("sharp 没有生成图片")

console.log("[smoke] 开始 node-pty 实际 Shell")
const pty = require(join(runtime, "node_modules", "node-pty"))
await new Promise((resolve, reject) => {
  const shell = pty.spawn("/bin/sh", ["-lc", "printf chipmate-pty"], { cols: 80, rows: 24 })
  let output = ""
  const timeout = setTimeout(() => {
    shell.kill()
    reject(new Error("node-pty 冒烟测试超时"))
  }, 10_000)
  shell.onData((data) => (output += data))
  shell.onExit(({ exitCode }) => {
    clearTimeout(timeout)
    if (exitCode !== 0 || !output.includes("chipmate-pty")) reject(new Error("node-pty 没有正确执行 Shell"))
    else resolve()
  })
})

const provider = createServer((request, response) => {
  response.setHeader("content-type", "application/json")
  if (request.url?.endsWith("/models")) {
    response.end(JSON.stringify({ data: [{ id: "deepseek-v4-flash" }] }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ error: "not-found" }))
})
await new Promise((resolve, reject) => {
  provider.once("error", reject)
  provider.listen(0, "127.0.0.1", resolve)
})
const address = provider.address()
if (!address || typeof address === "string") throw new Error("无法启动 DSH 冒烟 Provider")

const home = await mkdtemp(join(tmpdir(), "chipmate-dsh-smoke-home-"))
const workspace = await mkdtemp(join(tmpdir(), "chipmate-dsh-smoke-workspace-"))
const node = join(runtime, "node")
const entry = join(runtime, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(CHIPMATE|OPENCODE|KILO|DSH|DEEPSEEK)_/iu.test(key) &&
      key !== "NODE_OPTIONS" &&
      key !== "NODE_PATH" &&
      key !== "BUN_OPTIONS",
  ),
)
const child = spawn(node, [entry, "web", "--host", "127.0.0.1", "--port", "0"], {
  cwd: workspace,
  env: {
    ...environment,
    USER: process.env.USER ?? "chipmate",
    LOGNAME: process.env.LOGNAME ?? "chipmate",
    SHELL: process.env.SHELL ?? "/bin/bash",
    LANG: process.env.LANG ?? "C.UTF-8",
    TERM: process.env.TERM ?? "xterm",
    DSH_HOME: home,
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    DEEPSEEK_API_KEY: "chipmate-smoke-key",
  },
  stdio: ["ignore", "pipe", "pipe"],
})

let output = ""
child.stdout.on("data", (chunk) => (output += chunk.toString()))
child.stderr.on("data", (chunk) => (output += chunk.toString()))

try {
  console.log("[smoke] 等待官方 DSH Web 监听地址")
  const base = await waitForAddress()
  console.log(`[smoke] 官方 DSH Web 已监听 ${new URL(base).origin}`)
  const rpcId = crypto.randomUUID()
  const response = await fetch(`${base}/api/host.describe`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId, method: "host.describe", payload: {} }),
  })
  const envelope = await response.json()
  if (
    !response.ok ||
    envelope?.type !== "server-response" ||
    envelope?.rpcId !== rpcId ||
    envelope?.result?.ok !== true
  )
    throw new Error("官方 host.describe 握手失败")
  console.log("[smoke] host.describe 已通过")
  await Promise.all([openWebSocket(base, "/api/events.mux"), openWebSocket(base, "/api/events.host")])
  console.log("[smoke] mux/host WebSocket 已通过")
  child.kill("SIGTERM")
  const result = await waitForExit(child, 15_000)
  if (result.code === null && result.signal === null) throw new Error("官方 DSH 未在 15 秒内正常退出")
  console.log("Linux 官方 DSH Web Profile 启动、原生工具和协议握手通过")
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM")
    const result = await waitForExit(child, 15_000)
    if (result.code === null && result.signal === null) child.kill("SIGKILL")
  }
  await new Promise((resolve) => provider.close(resolve))
  await rm(home, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}

async function waitForAddress() {
  const deadline = performance.now() + 30_000
  while (performance.now() < deadline) {
    const match = output.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+)/u)
    if (match?.[1]) return match[1]
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`官方 DSH 在监听前退出：${output.slice(-4000)}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`等待官方 DSH 监听地址超时：${output.slice(-4000)}`)
}

async function openWebSocket(base, path) {
  const url = new URL(path, base)
  url.protocol = "ws:"
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`WebSocket 连接超时：${path}`)), 10_000)
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout)
        resolve()
      },
      { once: true },
    )
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout)
        reject(new Error(`WebSocket 连接失败：${path}`))
      },
      { once: true },
    )
  })
  socket.close()
}

async function waitForExit(process, timeout) {
  if (process.exitCode !== null || process.signalCode !== null)
    return { code: process.exitCode, signal: process.signalCode }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: null, signal: null }), timeout)
    process.once("exit", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}
