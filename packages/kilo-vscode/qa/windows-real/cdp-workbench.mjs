#!/usr/bin/env node

import { writeFileSync } from "node:fs"

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const index = item.indexOf("=")
    return index === -1 ? [item.replace(/^--/, ""), "true"] : [item.slice(2, index), item.slice(index + 1)]
  }),
)
const port = Number(args.port)
if (!Number.isSafeInteger(port) || port < 1) throw new Error("--port is required")
if (!args.output) throw new Error("--output is required")

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function rpc(url) {
  const socket = new WebSocket(url)
  const calls = new Map()
  let id = 0
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const call = calls.get(message.id)
    if (!call) return
    calls.delete(message.id)
    if (message.error) call.reject(new Error(message.error.message))
    else call.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })
  return {
    call(method, params = {}, timeout = 20_000) {
      const key = ++id
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          calls.delete(key)
          reject(new Error("CDP call timed out: " + method))
        }, timeout)
        calls.set(key, {
          resolve(value) {
            clearTimeout(timer)
            resolve(value)
          },
          reject(error) {
            clearTimeout(timer)
            reject(error)
          },
        })
        socket.send(JSON.stringify({ id: key, method, params }))
      })
    },
    close() {
      socket.close()
    },
  }
}

async function evaluate(client, expression, timeout = 5000) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeout)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "CDP evaluation failed")
  return result.result?.value
}

const limit = Date.now() + 60_000
let selected
let targets = []
while (Date.now() < limit && !selected) {
  targets = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json())
  for (const target of targets) {
    if (!target.webSocketDebuggerUrl) continue
    const client = await rpc(target.webSocketDebuggerUrl)
    const found = await evaluate(client, 'Boolean(document.querySelector(".monaco-workbench"))').catch(() => false)
    if (found) {
      selected = { client, target }
      break
    }
    client.close()
  }
  if (!selected) await wait(500)
}
if (!selected) throw new Error("VS Code workbench CDP target not found")

try {
  const expression = [
    "(async () => {",
    "const labels = (element) => [element.getAttribute('aria-label') || '', element.getAttribute('title') || '', (element.textContent || '').trim()].filter(Boolean)",
    "let controls = [...document.querySelectorAll('button, a, [role=\"button\"], .action-label')]",
    "const chipmate = controls.find((element) => labels(element).some((label) => /^ChipMate$/i.test(label)))",
    "if (chipmate) { chipmate.click(); await new Promise((resolve) => setTimeout(resolve, 800)) }",
    "controls = [...document.querySelectorAll('button, a, [role=\"button\"], .action-label')]",
    "const console = controls.find((element) => labels(element).some((label) => /^(?:ChipMate:\\s*)?Agent Console$/i.test(label)))",
    "if (console) { console.click(); await new Promise(requestAnimationFrame) }",
    "return { clicked: Boolean(console), chipmateClicked: Boolean(chipmate), candidates: controls.flatMap(labels).filter((label) => /chipmate|agent console/i.test(label)).slice(0, 80) }",
    "})()",
  ].join("\n")
  const result = await evaluate(selected.client, expression, 30_000)
  writeFileSync(
    args.output,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        target: {
          id: selected.target.id,
          type: selected.target.type,
          title: selected.target.title,
          url: selected.target.url,
        },
        candidates: targets.map((item) => ({ id: item.id, type: item.type, title: item.title, url: item.url })),
        result,
      },
      null,
      2,
    ) + "\n",
  )
} finally {
  selected.client.close()
}
