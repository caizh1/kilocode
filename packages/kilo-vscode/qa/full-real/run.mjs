#!/usr/bin/env node

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, "../../../..")
const args = parse(process.argv.slice(2))
const base = String(args.base ?? "http://127.0.0.1:6002").replace(/\/+$/, "")
const out = resolve(args.output ?? join(root, "qa-results-0.0.88-full-real"))
const evidence = join(out, "evidence", "remote")
const mac = resolve(args.macos ?? join(root, "chipmate-0.0.88-darwin-arm64.vsix"))
const win = resolve(args.windows ?? join(root, "chipmate-0.0.88-win32-x64-baseline.vsix"))

mkdirSync(evidence, { recursive: true })
execFileSync(process.execPath, [join(dir, "service-generate.mjs")], { stdio: "inherit" })
const catalog = JSON.parse(readFileSync(join(dir, "service-cases.json"), "utf8"))
validate(catalog)
const results = []
const probes = [
  ["SVC-HEALTH-01", "/health", checkHealth],
  ["SVC-HEALTH-03", "/api/v1/capabilities", checkCapabilities],
  ["SVC-HEALTH-04", "/api/v1/status", checkStatus],
  ["SVC-PACKAGE-01", "/packages/manifest.json", checkManifest],
  ["SVC-AUTH-01", "/api/v1/skills", checkItems],
]

const transcript = await Promise.all(
  probes.map(async ([id, path, check]) => {
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(`${base}${path}`, { headers: { accept: "application/json" }, signal: controller.signal }).catch(
      (err) => (err instanceof Error ? err : new Error(String(err))),
    )
    clearTimeout(timer)
    if (response instanceof Error) {
      return { id, path, ok: false, elapsedMs: Date.now() - started, error: response.name, message: redact(response.message) }
    }
    const raw = await response.text()
    const body = json(raw)
    return {
      id,
      path,
      ok: response.ok && check(body),
      status: response.status,
      elapsedMs: Date.now() - started,
      contentType: response.headers.get("content-type"),
      bytes: Buffer.byteLength(raw),
      sha256: createHash("sha256").update(raw).digest("hex"),
      keys: record(body) ? Object.keys(body).slice(0, 30) : [],
      identity: path === "/health" && record(body) ? { service: body.service, ok: body.ok } : undefined,
    }
  }),
)

writeFileSync(join(evidence, "http-transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`)
const health = transcript.find((item) => item.id === "SVC-HEALTH-01")
for (const item of catalog.cases) {
  const probe = transcript.find((entry) => entry.id === item.id)
  if (probe?.ok) {
    results.push(result(item, "PASS", `HTTP ${probe.status}，${probe.elapsedMs}ms。`, ["evidence/remote/http-transcript.json"]))
    continue
  }
  if (probe) {
    results.push(result(item, "BLOCKED", `远端前置失败：${probe.error ?? `HTTP ${probe.status}`} ${probe.message ?? ""}`.trim(), ["evidence/remote/http-transcript.json"]))
    continue
  }
  const reason = health?.ok
    ? item.auth === "anonymous"
      ? "真实 Chrome 或专用动作执行器尚未上报结果。"
      : "需要 owner/non-owner QA 身份在运行时输入凭据。"
    : "远端 /health 未通过，禁止执行依赖远端的用户操作。"
  results.push(result(item, "BLOCKED", reason, []))
}

const freeze = {
  generatedAt: new Date().toISOString(),
  baseUrl: base,
  git: {
    branch: git(["branch", "--show-current"]),
    head: git(["rev-parse", "HEAD"]),
    dirty: Boolean(git(["status", "--porcelain=v1"])),
  },
  artifacts: [inspect(mac), inspect(win)],
}
writeFileSync(join(out, "freeze.json"), `${JSON.stringify(freeze, null, 2)}\n`)
const payload = { generatedAt: new Date().toISOString(), freeze, serviceResults: results }
writeFileSync(join(out, "service-results.json"), `${JSON.stringify(payload, null, 2)}\n`)
execFileSync(process.execPath, [join(dir, "report.mjs"), join(out, "service-results.json"), join(out, "service-report.html")], {
  stdio: "inherit",
})
process.stdout.write(`${JSON.stringify({ results: join(out, "service-results.json"), report: join(out, "service-report.html") }, null, 2)}\n`)
process.exitCode = results.some((item) => ["FAIL", "FLAKY", "REVIEW", "BLOCKED"].includes(item.status)) ? 1 : 0

function inspect(path) {
  if (!existsSync(path)) return { path, status: "BLOCKED", error: "VSIX not found" }
  const manifest = JSON.parse(execFileSync("unzip", ["-p", path, "extension/package.json"], { encoding: "utf8" }))
  return {
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    id: `${manifest.publisher}.${manifest.name}`,
    version: manifest.version,
    target: manifest.chipmatePackageTarget,
  }
}

function result(item, status, summary, files) {
  return {
    id: item.id,
    suite: item.suite,
    title: item.title,
    status,
    summary,
    action: item.action,
    expected: item.expected,
    sideEffect: item.sideEffect,
    cleanup: item.cleanup,
    evidence: files,
  }
}

function checkHealth(value) {
  return record(value) && value.service === "chipmate-word-render" && value.ok === true
}

function checkCapabilities(value) {
  return record(value) && value.mode === "aligned-v1" && value.apiVersion === "1.0.0" && record(value.features)
}

function checkStatus(value) {
  return record(value) && value.ok === true && value.render === "ready" && value.market === "ready" && value.packages === "ready"
}

function checkManifest(value) {
  return record(value) && value.ok === true && value.schemaVersion === 2 && Array.isArray(value.packages)
}

function checkItems(value) {
  return record(value) && Array.isArray(value.items)
}

function json(value) {
  try {
    return JSON.parse(value)
  } catch (err) {
    return { parseError: err instanceof Error ? err.message : String(err) }
  }
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function redact(value) {
  return String(value).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
}

function git(argv) {
  return execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim()
}

function parse(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, "").split("=", 2)
    out[key] = inline ?? argv[++index]
  }
  return out
}

function validate(value) {
  if (value.version !== 1 || !Array.isArray(value.cases) || value.cases.length === 0) throw new Error("Invalid service catalog")
  const required = [
    "id",
    "suite",
    "title",
    "preconditions",
    "action",
    "expected",
    "auth",
    "method",
    "path",
    "sideEffect",
    "cleanup",
    "evidence",
  ]
  const ids = new Set()
  for (const item of value.cases) {
    if (!required.every((key) => Object.hasOwn(item, key))) throw new Error(`Incomplete service case: ${item.id ?? "unknown"}`)
    if (!/^SVC-[A-Z]+-[0-9]{2}$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate service ID: ${item.id}`)
    if (!Array.isArray(item.preconditions) || item.preconditions.length === 0) throw new Error(`Missing preconditions: ${item.id}`)
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) throw new Error(`Missing evidence contract: ${item.id}`)
    if (!Array.isArray(item.cleanup)) throw new Error(`Invalid cleanup contract: ${item.id}`)
    ids.add(item.id)
  }
}
