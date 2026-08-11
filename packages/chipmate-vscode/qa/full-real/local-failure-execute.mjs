#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const out = resolve(process.argv[2])
const base = String(process.argv[3] ?? "http://127.0.0.1:6006").replace(/\/+$/, "")
const file = join(out, "service-results.json")
const data = JSON.parse(readFileSync(file, "utf8"))
const results = new Map(data.serviceResults.map((item) => [item.id, item]))
const root = mkdtempSync(join(tmpdir(), "chipmate-local-failures-"))
const evidence = join(out, "evidence", "local-failures")
const actions = []
mkdirSync(evidence, { recursive: true })

try {
  const unsafe = join(root, "unsafe.tar.gz")
  execFileSync("python3", [
    "-c",
    "import io,sys,tarfile; t=tarfile.open(sys.argv[1],'w:gz'); i=tarfile.TarInfo('../escape.txt'); b=b'escape'; i.size=len(b); t.addfile(i,io.BytesIO(b)); t.close()",
    unsafe,
  ])
  const bad = await call("POST", "/api/v1/publications", {
    bearer: "qa-owner-identity",
    type: "application/gzip",
    key: "qa-unsafe-archive-0001",
    raw: readFileSync(unsafe),
  })
  const unsafeIssue = bad.body?.report?.issues?.some((item) => ["security-path", "security-link"].includes(item.code))
  update("SVC-FAIL-01", bad.status === 200 && bad.body?.status === "SECURITY_REJECTED" && unsafeIssue ? "PASS" : "FAIL", `unsafe archive HTTP ${bad.status}, status=${bad.body?.status}, guarded=${Boolean(unsafeIssue)}.`)

  const secret = archiveFor(
    "qa-e2e-secret-skill",
    "---\nname: QA Secret Fixture\ndescription: Security scanner fixture\n---\n\n# QA Secret Fixture\n\nThis fixture validates credential rejection.\n",
    { "secrets.txt": "api_key=sk-1234567890abcdefghijklmnop\n" },
  )
  const scanned = await call("POST", "/api/v1/publications", {
    bearer: "qa-owner-identity",
    type: "application/gzip",
    key: "qa-secret-archive-0001",
    raw: secret,
  })
  const secretIssue = scanned.body?.report?.issues?.some((item) => item.code === "security-secret")
  update("SVC-FAIL-02", scanned.status === 200 && scanned.body?.status === "SECURITY_REJECTED" && secretIssue ? "PASS" : "FAIL", `secret scan HTTP ${scanned.status}, status=${scanned.body?.status}, issue=${Boolean(secretIssue)}.`)

  const session = await call("POST", "/api/v1/auth/session", { json: { apiKey: "qa-owner-identity" } })
  const auth = {
    cookie: session.headers["set-cookie"]?.split(";", 1)[0],
    csrf: session.headers["x-csrf-token"],
  }
  const oversize = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61)
  const largeSkill = await call("POST", "/api/v1/publications", {
    bearer: "qa-owner-identity",
    type: "application/gzip",
    key: "qa-oversize-skill-0001",
    raw: oversize,
  })
  const largeVsix = await declared(512 * 1024 * 1024 + 1, auth)
  const skillStable = largeSkill.status === 413 && typeof largeSkill.body?.code === "string"
  const vsixStable = largeVsix.status === 413 && typeof largeVsix.body?.code === "string"
  update("SVC-FAIL-03", skillStable && vsixStable ? "PASS" : "FAIL", `oversize Skill HTTP ${largeSkill.status}, code=${largeSkill.body?.code}; VSIX HTTP ${largeVsix.status}, code=${largeVsix.body?.code}.`)

  const first = archiveFor("qa-e2e-idem-skill", "---\nname: QA Idem\ndescription: First idempotency body\n---\n\n# QA Idem\n\nFirst stable body with evidence and limitations.\n")
  const second = archiveFor("qa-e2e-idem-skill", "---\nname: QA Idem\ndescription: Conflicting idempotency body\n---\n\n# QA Idem\n\nDifferent stable body with evidence and limitations.\n")
  const one = await call("POST", "/api/v1/publications", { bearer: "qa-owner-identity", type: "application/gzip", key: "qa-idempotency-key-0001", raw: first })
  const two = await call("POST", "/api/v1/publications", { bearer: "qa-owner-identity", type: "application/gzip", key: "qa-idempotency-key-0001", raw: second })
  update("SVC-FAIL-04", one.status === 200 && two.status === 409 && two.body?.code === "IDEMPOTENCY_CONFLICT" ? "PASS" : "FAIL", `first HTTP ${one.status}; conflicting replay HTTP ${two.status}, code=${two.body?.code}.`)

  const offline = await fetch("http://127.0.0.1:6099/health", { signal: AbortSignal.timeout(500) }).then(() => false).catch(() => true)
  const recovered = await call("GET", "/health")
  update("SVC-FAIL-05", offline && recovered.status === 200 && recovered.body?.ok === true ? "PASS" : "FAIL", `unavailable endpoint failed=${offline}; retry health HTTP ${recovered.status}.`)

  const limited = await call("POST", "/api/v1/auth/session", { json: { apiKey: "qa-rate-limit" } })
  update("SVC-FAIL-06", limited.status === 429 && Number(limited.headers["retry-after"]) > 0 ? "PASS" : "FAIL", `rate-limit HTTP ${limited.status}, code=${limited.body?.code}, Retry-After=${limited.headers["retry-after"] ?? "missing"}.`)
} finally {
  rmSync(root, { recursive: true, force: true })
}

writeFileSync(join(evidence, "actions.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: base, actions }, null, 2)}\n`)
data.generatedAt = new Date().toISOString()
data.serviceResults = [...results.values()]
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(summary(data.serviceResults), null, 2)}\n`)

async function call(method, route, opts = {}) {
  const headers = { accept: "application/json" }
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  if (opts.key) headers["idempotency-key"] = opts.key
  const body = opts.raw ?? (opts.json === undefined ? undefined : Buffer.from(JSON.stringify(opts.json)))
  if (body) headers["content-type"] = opts.type ?? "application/json"
  if (body) headers["content-length"] = String(body.length)
  const started = Date.now()
  const response = await fetch(`${base}${route}`, { method, headers, body, duplex: body ? "half" : undefined })
  const raw = Buffer.from(await response.arrayBuffer())
  const type = response.headers.get("content-type") ?? ""
  const value = type.includes("json") && raw.length ? JSON.parse(raw.toString("utf8")) : undefined
  const result = { status: response.status, headers: Object.fromEntries(response.headers), body: value, raw }
  actions.push({ method, route, status: response.status, elapsedMs: Date.now() - started, bytes: raw.length, keys: value && typeof value === "object" ? Object.keys(value) : [] })
  return result
}

function declared(size, auth) {
  return new Promise((done, reject) => {
    const url = new URL("/api/v1/extension-publications", base)
    const req = request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        cookie: auth.cookie,
        origin: base,
        "x-csrf-token": auth.csrf,
        "content-type": "application/vnd.microsoft.vscode.vsix",
        "content-length": String(size),
        "x-publication-run-id": "qa-oversize-run-00000001",
        "idempotency-key": "qa-oversize-key-00000001",
        "x-vsix-filename": "qa-oversize.vsix",
      },
    })
    req.once("error", reject)
    req.once("response", (res) => {
      const chunks = []
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("end", () => {
        const raw = Buffer.concat(chunks)
        const body = raw.length ? JSON.parse(raw.toString("utf8")) : undefined
        actions.push({ method: "POST", route: "/api/v1/extension-publications", status: res.statusCode, bytes: raw.length, declaredBytes: size })
        done({ status: res.statusCode, headers: res.headers, body })
      })
    })
    req.flushHeaders()
  })
}

function archiveFor(id, markdown, files = {}) {
  const source = join(root, `publication-${id}-${Object.keys(files).length}`)
  const dir = join(source, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "skill.md"), markdown)
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), value)
  const archive = join(source, `${id}.tar.gz`)
  execFileSync("tar", ["-czf", archive, "-C", source, id], { env: { ...process.env, COPYFILE_DISABLE: "1" } })
  return readFileSync(archive)
}

function update(id, status, summary) {
  const item = results.get(id)
  if (!item) throw new Error(`Unknown service case: ${id}`)
  results.set(id, { ...item, status, summary, evidence: ["evidence/local-failures/actions.json"] })
}

function summary(items) {
  return Object.fromEntries(["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP"].map((status) => [status, items.filter((item) => item.status === status).length]))
}
