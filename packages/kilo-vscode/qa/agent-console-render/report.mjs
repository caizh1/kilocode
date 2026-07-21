#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

const input = resolve(process.argv[2])
const output = resolve(process.argv[3] ?? join(dirname(input), "report.html"))
const data = JSON.parse(readFileSync(input, "utf8"))
const rows = data.attempts
  .flatMap((run) =>
    run.cases.flatMap((item) =>
      item.assertions.map(
        (check) =>
          `<tr><td>${run.number}</td><td>${escape(item.gpu)}</td><td>${item.scale}</td><td><code>${escape(check.id)}</code></td><td class="${check.status.toLowerCase()}">${check.status}</td><td>${escape(check.summary)}</td></tr>`,
      ),
    ),
  )
  .join("")
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>ChipMate Agent Console macOS 渲染代理报告</title><style>body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:32px;color:#202124}.lead{color:#5f6368}.badge{display:inline-block;padding:4px 10px;border-radius:999px;font-weight:700}.pass{color:#137333}.fail,.blocked{color:#b3261e}.flaky,.review{color:#a15c00}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #dadce0;padding:8px;text-align:left;vertical-align:top}th{background:#f8f9fa}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style></head><body><h1>ChipMate Agent Console macOS 渲染代理测试</h1><p class="lead">真实生产 TerminalTab/xterm；6× CPU；四档缩放；GPU 默认/禁用。该结果不等于 Windows 原生渲染验收。</p><p>结果：<span class="badge ${data.status.toLowerCase()}">${data.status}</span>　源码：<code>${escape(data.source?.head ?? "unknown")}</code></p><p>${escape(data.summary)}</p><h2>原子断言</h2><table><thead><tr><th>Run</th><th>GPU</th><th>Scale</th><th>断言</th><th>状态</th><th>证据摘要</th></tr></thead><tbody>${rows}</tbody></table><h2>环境</h2><pre>${escape(JSON.stringify(data.environment, null, 2))}</pre><h2>限制</h2><ul>${data.limitations.map((item) => `<li>${escape(item)}</li>`).join("")}</ul><p>原始结果：<code>${escape(basename(input))}</code></p></body></html>`
writeFileSync(output, html)
process.stdout.write(`${output}\n`)

function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
