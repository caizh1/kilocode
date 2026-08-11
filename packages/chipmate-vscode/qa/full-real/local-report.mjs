#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const out = resolve(process.argv[2])
const data = JSON.parse(readFileSync(join(out, "service-results.json"), "utf8"))
const states = ["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP"]
const counts = Object.fromEntries(states.map((status) => [status, data.serviceResults.filter((item) => item.status === status).length]))
const rows = data.serviceResults.map((item) => `| \`${item.id}\` | ${item.status} | ${cell(item.title)} | ${cell(item.summary)} |`).join("\n")
const failures = data.serviceResults
  .filter((item) => item.status === "FAIL")
  .map((item) => `- \`${item.id}\`: ${item.summary}`)
  .join("\n")
const report = `# ChipMate 0.0.88 本地 Service 代理测试报告

## 结论

本轮已把 QA 目标改为可访问的 http://127.0.0.1:6002，从当前源码启动隔离 Service，测试结束后已关闭。该结果只代表本地 Service 代理测试，不代表真实离线 Linux 环境。

| PASS | FAIL | FLAKY | REVIEW | BLOCKED | SKIP |
|---|---|---|---|---|---|
| ${states.map((status) => counts[status]).join(" | ")} |

当前 Profile 存在 4 个确定性 FAIL，因此禁止签收；尚未完成两个全新 Profile 的失败复跑，不能宣称为稳定复现。57 个 BLOCKED 主要依赖 owner/non-owner 身份、发布/上传副作用、SSE 重连或尚未执行的专用动作。

## 已通过的关键路径

- aligned-v1 health、capabilities、status 和匿名目录 API。
- 真实 Chrome 首页、Skill Market、Extension Market、搜索与组合筛选；控制台无 error/warning。
- 0.0.88 macOS/Windows manifest、target、同源 URL，以及约 374MB 完整下载后的大小和 SHA-256。
- Word 返回 2 页 PDF/PNG；两次清理重查确认 qa-e2e Skill/Extension 残留为 0。

## FAIL

${failures}

实际错误证据包括 spawn chromium ENOENT、ModuleNotFoundError: No module named 'uno'、TOC 条目/页码为 0，以及未返回 updatedDocxBase64。本轮按要求只记录，没有修改业务代码。

## 证据

- [真实 Chrome 1484×1060](evidence/chrome/home-1484x1060.png)
- [真实 Chrome 1050×1024](evidence/chrome/home-1050x1024.png)
- [HTTP 与下载动作记录](evidence/local-actions/action-transcript.json)
- [清理复核](evidence/local-actions/cleanup-recheck.json)
- [Service 完整结果](service-results.json)

## 78 个 Service 原子断言

| ID | 状态 | 断言 | 说明 |
|---|---|---|---|
${rows}
`
writeFileSync(join(out, "local-report.md"), report)
process.stdout.write(`${join(out, "local-report.md")}\n`)

function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ")
}
