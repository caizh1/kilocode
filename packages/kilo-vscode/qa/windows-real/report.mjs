#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"

const input = resolve(process.argv[2] ?? "results.json")
const output = resolve(process.argv[3] ?? resolve(dirname(input), "report.html"))
const data = JSON.parse(readFileSync(input, "utf8"))
const results = Array.isArray(data.results) ? data.results : []
const atomic = Array.isArray(data.atomicResults) ? data.atomicResults : []
const counts = Object.fromEntries(
  ["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP"].map((status) => [
    status,
    results.filter((item) => item.status === status).length,
  ]),
)
const cards = results
  .map((item) => {
    const shots = (item.evidence?.screenshots ?? [])
      .map((path) => {
        const src = relative(dirname(output), resolve(dirname(input), path)).replaceAll("\\", "/")
        return `<a href="${attr(src)}"><img src="${attr(src)}" alt="${attr(item.id)} screenshot"></a>`
      })
      .join("")
    const assertions = (item.assertions ?? [])
      .map(
        (assertion) =>
          `<li class="assertion ${attr(String(assertion.status ?? "").toLowerCase())}"><strong>${html(assertion.status)}</strong> ${html(assertion.id)}${assertion.detail ? ` — ${html(assertion.detail)}` : ""}</li>`,
      )
      .join("")
    return `<article class="case ${attr(item.status.toLowerCase())}">
    <header><code>${html(item.id)}</code><span>${html(item.status)}</span></header>
    <h2>${html(item.title)}</h2>
    <p>${html(item.summary ?? "")}</p>
    ${assertions ? `<ul class="assertions">${assertions}</ul>` : ""}
    ${item.error ? `<pre>${html(item.error)}</pre>` : ""}
    <div class="shots">${shots}</div>
  </article>`
  })
  .join("\n")
const atomicCounts = Object.fromEntries(
  ["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP"].map((status) => [
    status,
    atomic.filter((item) => item.status === status).length,
  ]),
)
const atomicRows = atomic
  .map(
    (item) =>
      `<tr><td><code>${html(item.id)}</code></td><td>${html(item.status)}</td><td>${html(item.title)}</td><td>${html(item.summary ?? "")}</td></tr>`,
  )
  .join("")

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ChipMate Windows 回归报告</title>
<style>
:root{color-scheme:light dark;font-family:"Segoe UI","Microsoft YaHei",sans-serif;background:#101318;color:#eef2f8}body{margin:0;padding:28px;background:radial-gradient(circle at 20% 0,#253348 0,transparent 38%),#101318}.shell{max-width:1180px;margin:auto}.hero,.case{border:1px solid #ffffff24;background:#ffffff0d;box-shadow:0 20px 48px #0006,inset 0 1px #ffffff26;backdrop-filter:blur(20px);border-radius:22px}.hero{padding:24px;margin-bottom:20px}.counts{display:flex;gap:10px;flex-wrap:wrap}.counts span,.case header span{padding:6px 10px;border-radius:999px;background:#ffffff12}.case{padding:18px;margin:14px 0}.case header{display:flex;justify-content:space-between;gap:12px}.case.fail,.case.flaky{border-color:#ff647c99}.case.blocked,.case.review{border-color:#ffca6699}.case.pass{border-color:#5ce0a399}.assertions{display:grid;gap:7px;padding-left:22px}.assertion.pass strong{color:#5ce0a3}.assertion.fail strong{color:#ff647c}.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.shots img{display:block;width:100%;border-radius:14px;border:1px solid #ffffff24}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0005;padding:12px;border-radius:12px}code{overflow-wrap:anywhere}details{margin:20px 0;padding:18px;border:1px solid #ffffff24;border-radius:18px;background:#ffffff0d}summary{cursor:pointer;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:8px;border-bottom:1px solid #ffffff1f;text-align:left;vertical-align:top}</style>
</head><body><main class="shell"><section class="hero"><h1>ChipMate Windows 已修复问题回归</h1><p>Artifact: ${html(data.artifact?.vsix ?? "unknown")} · SHA-256: ${html(data.artifact?.sha256 ?? "unknown")}</p><div class="counts">${Object.entries(
  counts,
)
  .map(([key, value]) => `<span>${key}: ${value}</span>`)
  .join("")}</div>${atomic.length ? `<p>Atomic: ${Object.entries(atomicCounts)
    .map(([key, value]) => `${key} ${value}`)
    .join(" · ")}</p>` : ""}</section>${cards}${atomic.length ? `<details><summary>原子断言明细（${atomic.length}）</summary><table><thead><tr><th>ID</th><th>状态</th><th>断言</th><th>说明</th></tr></thead><tbody>${atomicRows}</tbody></table></details>` : ""}</main></body></html>`
writeFileSync(output, page)
process.stdout.write(`${output}\n`)

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function attr(value) {
  return html(value).replaceAll("'", "&#39;")
}
