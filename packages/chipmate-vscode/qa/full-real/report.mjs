#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"

const input = resolve(process.argv[2])
const output = resolve(process.argv[3])
const data = JSON.parse(readFileSync(input, "utf8"))
const results = data.serviceResults ?? []
const counts = Object.fromEntries(
  ["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP"].map((status) => [
    status,
    results.filter((item) => item.status === status).length,
  ]),
)
const rows = results
  .map(
    (item) =>
      `<tr><td><code>${html(item.id)}</code></td><td>${html(item.status)}</td><td>${html(item.title)}</td><td>${html(item.summary)}</td><td>${html(item.sideEffect)}</td></tr>`,
  )
  .join("")
const local = resolve(dirname(input), "evidence/chrome/home-1484x1060.png")
const chrome = existsSync(local) ? local : resolve(dirname(input), "evidence/chrome/service-root-error-1484x1060.png")
const shot = relative(dirname(output), chrome).replaceAll("\\", "/")
const artifacts = (data.freeze?.artifacts ?? [])
  .map((item) => `<li><code>${html(item.id)}@${html(item.version)}</code> ${html(item.target)} — ${html(item.sha256)}</li>`)
  .join("")
const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChipMate 0.0.88 全量真实测试</title><style>:root{color-scheme:light dark;font-family:"Segoe UI","Microsoft YaHei",sans-serif}body{margin:0;padding:28px;background:#101318;color:#eef2f8}.shell{max-width:1280px;margin:auto}.glass{border:1px solid #ffffff24;background:#ffffff0d;box-shadow:0 20px 48px #0006,inset 0 1px #ffffff26;backdrop-filter:blur(20px);border-radius:22px;padding:22px;margin:16px 0}.counts{display:flex;gap:10px;flex-wrap:wrap}.counts span{padding:6px 10px;border-radius:999px;background:#ffffff12}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #ffffff1f;text-align:left;vertical-align:top}img{max-width:100%;border-radius:14px;border:1px solid #ffffff24}code{overflow-wrap:anywhere}</style></head><body><main class="shell"><section class="glass"><h1>ChipMate 0.0.88 + 本地 Service 全量真实用户测试</h1><p>本地：${html(data.freeze?.baseUrl)} · 生成时间：${html(data.generatedAt)}</p><div class="counts">${Object.entries(counts)
  .map(([key, value]) => `<span>${key}: ${value}</span>`)
  .join("")}</div><ul>${artifacts}</ul></section><section class="glass"><h2>本地 Chrome 证据</h2><img src="${html(shot)}" alt="ChipMate Service Chrome evidence"></section><section class="glass"><h2>Service 原子断言</h2><table><thead><tr><th>ID</th><th>状态</th><th>断言</th><th>说明</th><th>副作用</th></tr></thead><tbody>${rows}</tbody></table></section></main></body></html>`
writeFileSync(output, page)
process.stdout.write(`${output}\n`)

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
