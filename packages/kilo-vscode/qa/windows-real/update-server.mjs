import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { basename, resolve } from "node:path"
import { readFileSync, statSync, writeFileSync } from "node:fs"

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const index = item.indexOf("=")
    return index < 0 ? [item.replace(/^--/, ""), ""] : [item.slice(2, index), item.slice(index + 1)]
  }),
)
const file = resolve(required("vsix"))
const version = required("version")
const target = args.target || "win32-x64-baseline"
const port = Number(args.port || 0)
const log = args.log ? resolve(args.log) : ""
const body = readFileSync(file)
const hash = createHash("sha256").update(body).digest("hex")
const size = statSync(file).size
const name = basename(file)
const route = `/packages/${encodeURIComponent(name)}`
const requests = []
let mode = "valid"

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")
  requests.push({
    at: new Date().toISOString(),
    method: req.method,
    path: url.pathname,
    mode,
  })
  persist()

  if (req.method === "POST" && url.pathname === "/__qa/mode") {
    const next = url.searchParams.get("value") || ""
    if (!["valid", "target", "cross-origin", "sha256", "size"].includes(next)) return send(res, 400, "模式无效")
    mode = next
    return json(res, { status: "ok", mode })
  }
  if (url.pathname === "/__qa/health") return json(res, { status: "ok", mode })
  if (url.pathname === "/__qa/requests") return json(res, { requests })
  if (url.pathname === "/packages/manifest.json") return json(res, manifest())
  if (url.pathname === route) {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(size),
      "cache-control": "no-store",
    })
    return res.end(body)
  }
  return send(res, 404, "未找到")
})

server.listen(port, "127.0.0.1", () => {
  const address = server.address()
  process.stdout.write(`${JSON.stringify({ status: "ready", port: address.port, file: name, version, target })}\n`)
})

function manifest() {
  const item = {
    extensionId: "chipmate.chipmate",
    publisher: "chipmate",
    name: "chipmate",
    version,
    target: mode === "target" ? "linux-x64-baseline" : target,
    url: mode === "cross-origin" ? "http://127.0.0.1:9/packages/blocked.vsix" : route,
    sha256: mode === "sha256" ? "0".repeat(64) : hash,
    sizeBytes: mode === "size" ? size + 1 : size,
    releaseNotes: "Windows 离线自动更新真实链路验收包。",
    publishedAt: new Date().toISOString(),
  }
  return {
    schemaVersion: 2,
    latestByTarget: {
      [target]: item,
    },
  }
}

function json(res, value) {
  const data = Buffer.from(JSON.stringify(value))
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(data.length),
    "cache-control": "no-store",
  })
  res.end(data)
}

function send(res, status, value) {
  const data = Buffer.from(value)
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "content-length": String(data.length) })
  res.end(data)
}

function persist() {
  if (!log) return
  writeFileSync(log, `${JSON.stringify({ requests }, null, 2)}\n`)
}

function required(key) {
  const value = args[key]
  if (value) return value
  throw new Error(`缺少参数 --${key}`)
}
