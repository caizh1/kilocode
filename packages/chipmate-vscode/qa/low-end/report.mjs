#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

const input = resolve(process.argv[2])
const output = resolve(process.argv[3] ?? join(dirname(input), "report.html"))
const data = JSON.parse(readFileSync(input, "utf8"))
const metrics = data.attempts.flatMap((attempt) =>
  attempt.metrics.map((metric) => ({ ...metric, attempt: attempt.number })),
)
const rows = metrics
  .map(
    (metric) =>
      `<tr><td>${metric.attempt}</td><td><code>${escape(metric.id)}</code></td><td class="${metric.status.toLowerCase()}">${metric.status}</td><td>${format(metric.value, metric.unit)}</td><td>${format(metric.budget, metric.unit)}</td><td>${escape(metric.summary)}</td></tr>`,
  )
  .join("")
const failures = metrics.filter((metric) => metric.status === "FAIL" || metric.status === "BLOCKED")
const fail = failures.length
  ? `<h2>未通过项目</h2><ul>${failures.map((metric) => `<li><code>${escape(metric.id)}</code>：${escape(metric.summary)}</li>`).join("")}</ul>`
  : ""
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>ChipMate 低配代理性能报告</title><style>body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:32px;color:#202124}h1{margin-bottom:4px}.lead{color:#5f6368}.badge{display:inline-block;padding:4px 10px;border-radius:999px;font-weight:700}.pass{color:#137333}.fail,.blocked{color:#b3261e}.flaky{color:#a15c00}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #dadce0;padding:8px;text-align:left;vertical-align:top}th{background:#f8f9fa}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style></head><body><h1>ChipMate 低配机器性能代理门禁</h1><p class="lead">该报告只代表 2 核、8GB、HDD、无独显的组合代理，不等同于真实低配 Windows。</p><p>Lane：<code>${escape(data.lane)}</code>　Profile：<code>${escape(data.profile.id)}</code>　结果：<span class="badge ${data.status.toLowerCase()}">${data.status}</span></p><p>${escape(data.summary)}</p>${fail}<h2>指标</h2><table><thead><tr><th>Attempt</th><th>指标</th><th>状态</th><th>结果</th><th>门槛</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table><h2>环境</h2><pre>${escape(JSON.stringify(data.environment, null, 2))}</pre><h2>限制</h2><ul>${(data.limitations ?? []).map((item) => `<li>${escape(item)}</li>`).join("")}</ul><p>原始结果：<code>${escape(basename(input))}</code></p></body></html>`
writeFileSync(output, html)
process.stdout.write(`${output}\n`)

function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function format(value, unit) {
  if (value === null || value === undefined) return "—"
  if (unit === "bytes") return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (unit === "percent") return `${value.toFixed(1)}%`
  if (unit === "boolean") return value ? "true" : "false"
  return `${value.toFixed(1)} ms`
}
