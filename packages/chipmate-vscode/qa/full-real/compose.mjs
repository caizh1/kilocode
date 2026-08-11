#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))
const out = resolve(process.argv[2])
const service = read(join(out, "service-results.json"))
const mac = read(join(out, "macos-run-2", "results.json"))
const catalog = read(join(dir, "..", "windows-real", "atomic-cases.json"))
const states = ["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP"]
const historic = catalog.problems.flatMap((problem) =>
  problem.assertions.map((check) =>
    mac.atomicResults.find((item) => item.id === check.id) ?? {
      id: check.id,
      title: check.title,
      status: "BLOCKED",
      summary: "该 changeset 在本轮覆盖冻结时新增映射；尚无 macOS 安装态执行证据。",
      evidence: [],
    },
  ),
)
const windows = [
  window("WIN-SMOKE-INSTALL", "正式安装、激活及 Extension Host 无启动错误"),
  window("WIN-SMOKE-SETTINGS", "真实键盘逐字符输入 embedding model 与维度，blur 后保持"),
  window("WIN-SMOKE-INDEXING", "Mock Provider 启动 CodeGraph/Code RAG，并加载 rg.exe 与 LanceDB"),
  window("WIN-SMOKE-CONSOLE", "Agent Console 执行固定命令；取消审批后不执行"),
]
const ledger = {
  runId: "20260718",
  prefix: "qa-e2e-20260718",
  remoteWritesAttempted: 0,
  created: [],
  cleanupRequired: [],
  residue: [],
  reason: "Remote health gate failed before credentials or mutation steps.",
}
const payload = {
  generatedAt: new Date().toISOString(),
  verdict: "NOT_READY_FOR_SIGNOFF",
  scope: "ChipMate 0.0.88 macOS proxy regression, real ChipMate Service integration, Windows minimum smoke",
  freeze: service.freeze,
  counts: {
    macosParents: count(mac.results),
    historicalAtomic: count(historic),
    serviceAtomic: count(service.serviceResults),
    windowsSmoke: count(windows),
  },
  macosParents: mac.results,
  historicalAtomic: historic,
  serviceAtomic: service.serviceResults,
  windowsSmoke: windows,
  ledger,
  blockers: [
    "Remote http://10.10.5.23:6001 accepts TCP but /health and public probes do not return a valid HTTP response within 5 seconds; real Chrome records ERR_EMPTY_RESPONSE.",
    "macOS system-level UI capture failed with ScreenCaptureKit Code=-3811, so keyboard, Accessibility tree, responsive visual and real webview actions were not executable.",
    "No Windows 11 host was connected to this task, so the four mandatory Windows smoke cases remain BLOCKED.",
    "Owner and non-owner QA credentials were intentionally not requested because the remote health gate failed before any authenticated action.",
    "Coverage freeze found atomic-skill-market-tools unmapped; 10 QA assertions were added, but no installed-state run exists for them yet.",
  ],
}

writeFileSync(join(out, "windows-results.json"), `${JSON.stringify({ generatedAt: payload.generatedAt, results: windows }, null, 2)}\n`)
writeFileSync(join(out, "mutation-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`)
writeFileSync(join(out, "unified-results.json"), `${JSON.stringify(payload, null, 2)}\n`)
writeFileSync(join(out, "report.md"), markdown(payload))
writeFileSync(join(out, "report.html"), html(payload))
process.stdout.write(`${JSON.stringify({ markdown: join(out, "report.md"), html: join(out, "report.html"), results: join(out, "unified-results.json") }, null, 2)}\n`)

function window(id, title) {
  return {
    id,
    title,
    status: "BLOCKED",
    summary: "当前任务未连接 Windows 11 执行机；已冻结 Windows VSIX 与交接 kit，未从 macOS 结果推断通过。",
    evidence: [],
  }
}

function count(items) {
  return Object.fromEntries(states.map((status) => [status, items.filter((item) => item.status === status).length]))
}

function read(path) {
  if (!existsSync(path)) throw new Error(`Missing report input: ${path}`)
  return JSON.parse(readFileSync(path, "utf8"))
}

function markdown(data) {
  const mac = data.freeze.artifacts.find((item) => item.target === "darwin-arm64")
  const win = data.freeze.artifacts.find((item) => item.target === "win32-x64-baseline")
  const summary = [
    ["macOS 父 case", data.counts.macosParents],
    ["历史原子断言", data.counts.historicalAtomic],
    ["Service 原子断言", data.counts.serviceAtomic],
    ["Windows 冒烟", data.counts.windowsSmoke],
  ]
    .map(([name, counts]) => `| ${name} | ${states.map((state) => counts[state]).join(" | ")} |`)
    .join("\n")
  const blockers = data.blockers.map((item) => `- ${item}`).join("\n")
  const parents = data.macosParents.map(row).join("\n")
  const history = data.historicalAtomic.map(row).join("\n")
  const services = data.serviceAtomic.map(row).join("\n")
  const windows = data.windowsSmoke.map(row).join("\n")
  return `# ChipMate 0.0.88 + 远端 Service 全量真实用户测试报告

## 结论

**NOT_READY_FOR_SIGNOFF**。本轮不能签收，也不能写成“已完成 macOS 全量真实用户操作测试、真实 ChipMate Service 集成测试及 Windows 最小冒烟”。

已确认的只有：冻结 VSIX 的身份、版本、target 与静态 payload；macOS 隔离 Profile 正式安装并激活 chipmate.chipmate@0.0.88。远端健康门禁、真实 macOS UI 操作和 Windows 冒烟均未满足前置条件。

## 冻结输入

- Git: ${data.freeze.git.branch}@${data.freeze.git.head}，dirty=${data.freeze.git.dirty}
- macOS VSIX: ${mac.sha256}
- Windows VSIX: ${win.sha256}
- 远端：${data.freeze.baseUrl}
- 模型回答质量：out-of-scope
- 业务代码修改：无；仅新增/修正 QA runner、schema、fixture 与报告生成器

## 汇总

| 范围 | PASS | FAIL | FLAKY | REVIEW | BLOCKED | SKIP |
|---|---|---|---|---|---|---|
${summary}

## 阻塞原因

${blockers}

远端写操作数为 **0**，创建对象 **0**，残留对象 **0**；健康门禁失败后没有请求身份凭据，也没有执行发布、收藏、评价、上传或删除。

## 关键证据

- [真实 Chrome ERR_EMPTY_RESPONSE 截图](evidence/chrome/service-root-error-1484x1060.png)
- [脱敏 HTTP 探针记录](evidence/remote/http-transcript.json)
- [macOS 正式安装结果](macos-run-2/results.json)
- [macOS 安装日志](macos-run-2/evidence/install.log)
- [macOS 已安装扩展探针](macos-run-2/evidence/installed-probe.json)
- [冻结 manifest 与 SHA-256](freeze.json)
- [远端副作用清理账本](mutation-ledger.json)
- [Windows 四项结果](windows-results.json)

## macOS 父 case

| ID | 状态 | 断言 | 说明 |
|---|---|---|---|
${parents}

## ${data.historicalAtomic.length} 个历史原子断言

| ID | 状态 | 断言 | 说明 |
|---|---|---|---|
${history}

## 78 个 Service 原子断言

| ID | 状态 | 断言 | 说明 |
|---|---|---|---|
${services}

## Windows 最小冒烟

| ID | 状态 | 断言 | 说明 |
|---|---|---|---|
${windows}

## 未覆盖风险

- ${data.historicalAtomic.length} 个历史修复原子断言均未完成真实用户动作判定，不能据静态测试或父 case 推断通过。
- 远端健康、能力、Skill/Extension Market、Word、Mermaid、更新和失败恢复均未执行。
- Windows 正式安装、输入法/键盘、原生二进制加载与 ConPTY/审批链未执行。
- macOS contact sheet 尚未形成有效 ChipMate UI 视觉证据；现有安装窗口截图不能作为视觉 PASS。
- DOCX 安全夹具已生成；本机 LibreOffice 预览的中文字体替换异常，因此远端 Word 的中文保持断言仍为 BLOCKED，未据本地预览判定远端失败。
`
}

function row(item) {
  return `| \`${item.id}\` | ${item.status} | ${clean(item.title)} | ${clean(item.summary)} |`
}

function clean(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ")
}

function html(data) {
  const counts = Object.entries(data.counts)
    .map(([name, values]) => `<tr><td>${escape(name)}</td>${states.map((state) => `<td>${values[state]}</td>`).join("")}</tr>`)
    .join("")
  const section = (title, items) => `<section class="glass"><h2>${escape(title)}</h2><table><thead><tr><th>ID</th><th>状态</th><th>断言</th><th>说明</th></tr></thead><tbody>${items
    .map((item) => `<tr><td><code>${escape(item.id)}</code></td><td class="${item.status.toLowerCase()}">${escape(item.status)}</td><td>${escape(item.title)}</td><td>${escape(item.summary)}</td></tr>`)
    .join("")}</tbody></table></section>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChipMate 0.0.88 真实用户测试报告</title><style>:root{color-scheme:dark;font-family:"Segoe UI","Microsoft YaHei",sans-serif}body{margin:0;background:#0b1018;color:#edf3ff}.shell{max-width:1440px;margin:auto;padding:28px}.glass{margin:16px 0;padding:22px;border:1px solid #ffffff24;border-radius:22px;background:#ffffff0c;box-shadow:0 18px 50px #0008,inset 0 1px #ffffff28}.verdict{color:#ffb4a8}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px;border-bottom:1px solid #ffffff1c;text-align:left;vertical-align:top}code{overflow-wrap:anywhere}.pass{color:#8ee8ad}.blocked{color:#ffd18b}.review{color:#d8b7ff}img{max-width:100%;border-radius:14px;border:1px solid #ffffff24}a{color:#9ed0ff}</style></head><body><main class="shell"><section class="glass"><h1>ChipMate 0.0.88 + 远端 Service 全量真实用户测试</h1><h2 class="verdict">NOT_READY_FOR_SIGNOFF</h2><p>远端健康门禁、真实 macOS GUI 操作和 Windows 冒烟未完成，禁止签收。</p><table><thead><tr><th>范围</th>${states.map((state) => `<th>${state}</th>`).join("")}</tr></thead><tbody>${counts}</tbody></table></section><section class="glass"><h2>阻塞证据</h2><ul>${data.blockers.map((item) => `<li>${escape(item)}</li>`).join("")}</ul><img src="evidence/chrome/service-root-error-1484x1060.png" alt="Chrome ERR_EMPTY_RESPONSE"><p><a href="evidence/remote/http-transcript.json">HTTP transcript</a> · <a href="freeze.json">freeze</a> · <a href="mutation-ledger.json">mutation ledger</a></p></section>${section("macOS 父 case", data.macosParents)}${section(`${data.historicalAtomic.length} 个历史原子断言`, data.historicalAtomic)}${section("78 个 Service 原子断言", data.serviceAtomic)}${section("Windows 最小冒烟", data.windowsSmoke)}</main></body></html>`
}

function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
