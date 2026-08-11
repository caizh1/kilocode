#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const out = resolve(process.argv[2])
const base = String(process.argv[3] ?? "http://127.0.0.1:6008").replace(/\/+$/, "")
const docx = resolve(process.argv[4])
const run = String(process.argv[5] ?? "1")
const file = join(out, "service-results.json")
const data = JSON.parse(readFileSync(file, "utf8"))
const results = new Map(data.serviceResults.map((item) => [item.id, item]))
const evidence = join(out, "evidence", "docker-word", `run-${run}`)
const root = mkdtempSync(join(tmpdir(), "chipmate-word-no-toc-"))
mkdirSync(evidence, { recursive: true })

try {
  const word = await post("/render/word", { filename: "qa-e2e-20260718.docx", docxBase64: readFileSync(docx).toString("base64") })
  const updated = word.body?.updatedDocxBase64 ? Buffer.from(word.body.updatedDocxBase64, "base64") : undefined
  if (word.body?.pdf?.base64) writeFileSync(join(evidence, "word.pdf"), Buffer.from(word.body.pdf.base64, "base64"))
  if (updated) writeFileSync(join(evidence, "word-updated.docx"), updated)
  const xml = updated ? execFileSync("unzip", ["-p", join(evidence, "word-updated.docx"), "word/document.xml"], { encoding: "utf8" }) : ""
  update("SVC-RENDER-05", word.status === 200 && word.body?.ok === true && word.body?.pageCount > 0 && word.body?.pdf?.contentType === "application/pdf" ? "PASS" : "FAIL", `Docker Word HTTP ${word.status}, pageCount=${word.body?.pageCount}.`)
  update("SVC-RENDER-06", word.body?.fieldRefreshStatus === "completed" && word.body?.tocEntryCount === 3 && word.body?.tocPageNumberCount === 3 ? "PASS" : "FAIL", `fieldRefreshStatus=${word.body?.fieldRefreshStatus}, tocEntryCount=${word.body?.tocEntryCount}, tocPageNumberCount=${word.body?.tocPageNumberCount}.`)
  update("SVC-RENDER-07", updated ? "PASS" : "FAIL", `updatedDocxBase64=${Boolean(updated)}.`)
  update("SVC-RENDER-08", updated && xml.includes("真实渲染") && xml.includes("QA-WORD-20260718") ? "PASS" : "FAIL", "Updated DOCX reopened and retained the Chinese marker and QA ID.")

  const plain = join(root, "qa-no-toc.docx")
  execFileSync("python3", [resolve("packages/chipmate-vscode/qa/full-real/fixture-docx.py"), "--output", plain, "--run", "NO-TOC", "--no-toc"])
  const noToc = await post("/render/word", { filename: "qa-no-toc.docx", docxBase64: readFileSync(plain).toString("base64") })
  update("SVC-RENDER-09", noToc.status === 200 && noToc.body?.ok === true && noToc.body?.fieldRefreshStatus === "not-required" ? "PASS" : "FAIL", `no-TOC Word HTTP ${noToc.status}, fieldRefreshStatus=${noToc.body?.fieldRefreshStatus}.`)

  writeFileSync(join(evidence, "result.json"), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl: base,
    word: summary(word),
    noToc: summary(noToc),
  }, null, 2)}\n`)
} finally {
  rmSync(root, { recursive: true, force: true })
}

data.generatedAt = new Date().toISOString()
data.serviceResults = [...results.values()]
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(count(data.serviceResults), null, 2)}\n`)

async function post(route, body) {
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

function summary(value) {
  return {
    status: value.status,
    ok: value.body?.ok,
    pageCount: value.body?.pageCount,
    fieldRefreshStatus: value.body?.fieldRefreshStatus,
    fieldRefreshDiagnostics: value.body?.fieldRefreshDiagnostics,
    tocEntryCount: value.body?.tocEntryCount,
    tocPageNumberCount: value.body?.tocPageNumberCount,
    updatedDocxBase64: Boolean(value.body?.updatedDocxBase64),
    textQa: value.body?.textQa,
    issues: value.body?.issues,
  }
}

function update(id, status, summary) {
  const item = results.get(id)
  if (!item) throw new Error(`Unknown service case: ${id}`)
  results.set(id, { ...item, status, summary, evidence: [`evidence/docker-word/run-${run}/result.json`] })
}

function count(items) {
  return Object.fromEntries(["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP"].map((status) => [status, items.filter((item) => item.status === status).length]))
}
