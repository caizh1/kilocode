#!/usr/bin/env node

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const out = resolve(process.argv[2])
const base = String(process.argv[3] ?? "http://127.0.0.1:6002").replace(/\/+$/, "")
const docx = resolve(process.argv[4])
const mac = resolve(process.argv[5])
const win = resolve(process.argv[6])
const path = join(out, "service-results.json")
const data = JSON.parse(readFileSync(path, "utf8"))
const results = new Map(data.serviceResults.map((item) => [item.id, item]))
const evidence = join(out, "evidence", "local-actions")
mkdirSync(evidence, { recursive: true })
const actions = []

const health = await get("/health")
const tools = health.body?.tools ?? {}
const renderTools =
  Object.hasOwn(tools, "mermaid") &&
  Object.hasOwn(tools, "soffice") &&
  Object.hasOwn(tools, "pdftoppm") &&
  Object.hasOwn(tools, "pdfinfo") &&
  (Object.hasOwn(tools, "chromium") || Object.hasOwn(tools, "chrome"))
update(
  "SVC-HEALTH-02",
  renderTools ? "PASS" : "FAIL",
  `health tools keys: ${Object.keys(tools).join(", ") || "none"}`,
)

const manifest = (await get("/packages/manifest.json")).body
const targets = new Map((manifest?.packages ?? []).map((item) => [item.target, item]))
update(
  "SVC-PACKAGE-02",
  targets.has("darwin-arm64") && targets.has("win32-x64-baseline") ? "PASS" : "FAIL",
  `targets=${[...targets.keys()].join(",")}`,
)
const expected = new Map([
  ["darwin-arm64", sha(mac)],
  ["win32-x64-baseline", sha(win)],
])
update(
  "SVC-PACKAGE-03",
  [...expected].every(([target, value]) => targets.get(target)?.version === "0.0.88" && targets.get(target)?.sha256 === value)
    ? "PASS"
    : "FAIL",
  "0.0.88 target hashes compared with frozen VSIX.",
)
update(
  "SVC-PACKAGE-04",
  [...targets.values()].every((item) => new URL(item.url, base).origin === new URL(base).origin) ? "PASS" : "FAIL",
  "All package URLs resolve to the configured local Service origin.",
)
const downloads = []
for (const [target, item] of targets) {
  const response = await fetch(new URL(item.url, base))
  const hash = createHash("sha256")
  let bytes = 0
  for await (const chunk of response.body) {
    hash.update(chunk)
    bytes += chunk.length
  }
  downloads.push({ target, status: response.status, bytes, sha256: hash.digest("hex"), expectedBytes: item.sizeBytes, expectedSha256: item.sha256 })
}
update(
  "SVC-PACKAGE-05",
  downloads.every((item) => item.status === 200 && item.bytes === item.expectedBytes && item.sha256 === item.expectedSha256) ? "PASS" : "FAIL",
  "Both complete VSIX downloads matched manifest size and SHA-256.",
)

const invalid = await post("/api/v1/auth/session", { apiKey: "qa-invalid-local-fixture" })
update(
  "SVC-AUTH-05",
  invalid.status === 404 && !invalid.headers["set-cookie"] ? "PASS" : invalid.status === 503 ? "BLOCKED" : "FAIL",
  `invalid login HTTP ${invalid.status}; set-cookie=${Boolean(invalid.headers["set-cookie"])}.`,
)

const mermaid = await post("/render/mermaid", {
  filename: "qa-e2e-20260718",
  scale: 2,
  source: "flowchart TD\nA[Start] --> B{Check}\nB -->|Pass| C[Done]\nB -->|Fail| D[Retry]",
})
if (mermaid.status === 200 && mermaid.body?.ok === true && mermaid.body?.png?.base64) {
  const png = Buffer.from(mermaid.body.png.base64, "base64")
  writeFileSync(join(evidence, "mermaid.png"), png)
  update("SVC-RENDER-01", "PASS", `PNG ${mermaid.body.pixelWidth}x${mermaid.body.pixelHeight}.`, ["evidence/local-actions/mermaid.png"])
  update(
    "SVC-RENDER-02",
    mermaid.body.contentBounds && mermaid.body.cropBounds ? "PASS" : "FAIL",
    `contentBounds=${Boolean(mermaid.body.contentBounds)}, cropBounds=${Boolean(mermaid.body.cropBounds)}.`,
    ["evidence/local-actions/mermaid.png"],
  )
} else {
  update("SVC-RENDER-01", "FAIL", `HTTP ${mermaid.status}: ${mermaid.body?.code ?? "render failed"}.`)
  update("SVC-RENDER-02", "BLOCKED", "合法 Mermaid 未生成 PNG，无法检查裁剪。")
}
const badMermaid = await post("/render/mermaid", { filename: "qa-invalid", source: "flowchart TD\nA[" })
const recovered = await get("/health")
update(
  "SVC-RENDER-03",
  mermaid.body?.ok !== true
    ? "BLOCKED"
    : badMermaid.body?.ok === false && Array.isArray(badMermaid.body?.issues) && recovered.status === 200 && recovered.body?.ok === true
      ? "PASS"
      : "FAIL",
  `invalid HTTP ${badMermaid.status}; follow-up health HTTP ${recovered.status}.`,
)
const hugeMermaid = await post("/render/mermaid", { filename: "qa-limit", source: `flowchart TD\n${"A-->B\n".repeat(90_000)}` })
const limited = hugeMermaid.body?.ok === false && hugeMermaid.body?.issues?.some((item) => String(item.message).includes("exceeds"))
update("SVC-RENDER-04", limited ? "PASS" : "FAIL", `oversize HTTP ${hugeMermaid.status}; rejected=${limited}.`)

const word = await post("/render/word", {
  filename: "qa-e2e-20260718.docx",
  docxBase64: readFileSync(docx).toString("base64"),
})
if (word.status === 200 && word.body?.ok === true) {
  writeFileSync(join(evidence, "word.pdf"), Buffer.from(word.body.pdf.base64, "base64"))
  for (const page of word.body.pages ?? []) writeFileSync(join(evidence, `word-page-${page.page}.png`), Buffer.from(page.base64, "base64"))
  update(
    "SVC-RENDER-05",
    word.body.pageCount > 0 && word.body.pdf?.contentType === "application/pdf" && word.body.pages?.every((item) => item.contentType === "image/png")
      ? "PASS"
      : "FAIL",
    `pageCount=${word.body.pageCount}.`,
    ["evidence/local-actions/word.pdf"],
  )
  update(
    "SVC-RENDER-06",
    word.body.fieldRefreshStatus === "completed" && word.body.tocEntryCount > 0 && word.body.tocPageNumberCount > 0 ? "PASS" : "FAIL",
    `fieldRefreshStatus=${word.body.fieldRefreshStatus}, tocEntryCount=${word.body.tocEntryCount}, tocPageNumberCount=${word.body.tocPageNumberCount}.`,
  )
  const updated = word.body.updatedDocxBase64 ? Buffer.from(word.body.updatedDocxBase64, "base64") : undefined
  if (updated) writeFileSync(join(evidence, "word-updated.docx"), updated)
  update("SVC-RENDER-07", updated ? "PASS" : "FAIL", `updatedDocxBase64=${Boolean(updated)}.`, updated ? ["evidence/local-actions/word-updated.docx"] : [])
  const xml = updated ? execFileSync("unzip", ["-p", join(evidence, "word-updated.docx"), "word/document.xml"], { encoding: "utf8" }) : ""
  update(
    "SVC-RENDER-08",
    !updated ? "BLOCKED" : xml.includes("真实渲染") && xml.includes("QA-WORD-20260718") ? "PASS" : "FAIL",
    "Updated DOCX checked for Chinese marker and QA ID.",
  )
} else {
  for (const id of ["SVC-RENDER-05", "SVC-RENDER-06", "SVC-RENDER-07", "SVC-RENDER-08"])
    update(id, id === "SVC-RENDER-05" ? "FAIL" : "BLOCKED", `Word render HTTP ${word.status}: ${word.body?.code ?? "render failed"}.`)
}

const skills = await get("/api/v1/skills?q=qa-e2e-20260718")
const extensions = await get("/api/v1/extensions?q=qa-e2e-20260718")
update(
  "SVC-FAIL-08",
  skills.status !== 200 || extensions.status !== 200
    ? "BLOCKED"
    : skills.body?.items?.length === 0 && extensions.body?.items?.length === 0
      ? "PASS"
      : "FAIL",
  `cleanup audit skills=${skills.body?.items?.length ?? "?"}, extensions=${extensions.body?.items?.length ?? "?"}.`,
)

const chrome = join(out, "evidence", "chrome", "chrome-results.json")
if (readable(chrome)) {
  const value = JSON.parse(readFileSync(chrome, "utf8"))
  for (const check of value.checks) update(check.id, check.status, check.summary, check.evidence)
}
writeFileSync(join(evidence, "action-transcript.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: base, downloads, actions }, null, 2)}\n`)
data.generatedAt = new Date().toISOString()
data.freeze.baseUrl = base
data.serviceResults = [...results.values()]
writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(summary(data.serviceResults), null, 2)}\n`)

function update(id, status, summary, files = ["evidence/local-actions/action-transcript.json"]) {
  const item = results.get(id)
  if (!item) throw new Error(`Unknown service case: ${id}`)
  results.set(id, { ...item, status, summary, evidence: files })
}

async function get(route) {
  const started = Date.now()
  const response = await fetch(`${base}${route}`, { headers: { accept: "application/json" } }).catch((err) => err)
  if (response instanceof Error) return failed(route, started, response)
  const raw = await response.text()
  const result = { route, status: response.status, elapsedMs: Date.now() - started, headers: headers(response), body: parse(raw), bytes: Buffer.byteLength(raw) }
  actions.push(meta(result))
  return result
}

async function post(route, body) {
  const started = Date.now()
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) }).catch((err) => err)
  if (response instanceof Error) return failed(route, started, response)
  const raw = await response.text()
  const result = { route, status: response.status, elapsedMs: Date.now() - started, headers: headers(response), body: parse(raw), bytes: Buffer.byteLength(raw) }
  actions.push(meta(result))
  return result
}

function failed(route, started, err) {
  const result = {
    route,
    status: 0,
    elapsedMs: Date.now() - started,
    headers: {},
    body: { code: err.cause?.code ?? err.name, message: err.message },
    bytes: 0,
  }
  actions.push(meta(result))
  return result
}

function meta(value) {
  return { route: value.route, status: value.status, elapsedMs: value.elapsedMs, bytes: value.bytes, keys: value.body && typeof value.body === "object" ? Object.keys(value.body) : [] }
}

function headers(response) {
  return Object.fromEntries([...response.headers].filter(([key]) => ["content-type", "set-cookie", "retry-after"].includes(key)))
}

function parse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function sha(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function readable(file) {
  try {
    readFileSync(file)
    return true
  } catch {
    return false
  }
}

function summary(items) {
  return Object.fromEntries(["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP"].map((status) => [status, items.filter((item) => item.status === status).length]))
}
