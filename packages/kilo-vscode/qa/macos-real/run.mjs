#!/usr/bin/env node

import { createHash } from "node:crypto"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))
const shared = resolve(dir, "../windows-real")
const atomic = JSON.parse(readFileSync(join(shared, "atomic-cases.json"), "utf8"))
const args = parse(process.argv.slice(2))
if (!args.vsix) fail("Usage: node run.mjs --vsix <darwin-arm64.vsix> [--output <dir>] [--code <code CLI>]")

const vsix = resolve(args.vsix)
const output = resolve(args.output ?? `chipmate-macos-proxy-${Date.now()}`)
const runtime = join(output, "runtime")
const evidence = join(output, "evidence")
const extensions = join(runtime, "extensions")
const user = join(runtime, "user")
const workspace = join(runtime, "fixture-中文 workspace")
const code = args.code ?? execFileSync("sh", ["-lc", "command -v code"], { encoding: "utf8" }).trim()
const results = []
const atomicResults = []
mkdirSync(extensions, { recursive: true })
mkdirSync(user, { recursive: true })
mkdirSync(workspace, { recursive: true })
mkdirSync(evidence, { recursive: true })
writeFileSync(join(output, ".chipmate-macos-proxy-root"), `${new Date().toISOString()}\n`)
writeFileSync(
  join(workspace, "main.c"),
  "static int qa_leaf(int value) { return value + 1; }\nint qa_entry(int value) { return qa_leaf(value); }\n",
)
writeFileSync(join(workspace, "design.md"), "# QA Document\n\nThe deterministic limit is 42.\n")

const manifest = inspect()
record("MAC-PACKAGE-INSTALL", "package", "PASS", [
  assertion("manifest", true, `${manifest.publisher}.${manifest.name}@${manifest.version}`),
  assertion("target", true, manifest.chipmatePackageTarget),
  assertion("payload", true, "required macOS payload present; forbidden payload absent"),
])

const install = run(code, [
  "--install-extension",
  vsix,
  "--force",
  "--extensions-dir",
  extensions,
  "--user-data-dir",
  user,
])
writeFileSync(join(evidence, "install.log"), `${install.stdout}\n${install.stderr}`)
if (install.status !== 0) failCase("MAC-PACKAGE-INSTALL", `VSIX installation failed with ${install.status}`)

const listed = run(code, [
  "--list-extensions",
  "--show-versions",
  "--extensions-dir",
  extensions,
  "--user-data-dir",
  user,
])
writeFileSync(join(evidence, "extensions.txt"), listed.stdout)
const installed = listed.stdout.split(/\r?\n/).includes(`chipmate.chipmate@${manifest.version}`)
append("MAC-PACKAGE-INSTALL", assertion("installed-version", installed, listed.stdout.trim()))
if (!installed)
  setStatus("MAC-PACKAGE-INSTALL", "FAIL", `正式安装列表缺少 chipmate.chipmate@${manifest.version}。`)

await probe()
capture()
snapshot()

for (const item of [
  ["MAC-IDENTITY-UPGRADE", "identity", "需要旧版 macOS VSIX、三次 Reload 和共存专用动作。"],
  ["MAC-BRANDING-VISUAL", "visual", "已采集正式安装窗口截图；视觉 contact sheet 尚待人工复核。", "REVIEW"],
  ["MAC-SETTINGS-PROVIDER", "settings", "需要 macOS Accessibility 逐字符输入专用动作。"],
  ["MAC-QA-SESSION", "qa", "需要固定 SSE 会话、停止、重试、历史和重连专用动作。"],
  ["MAC-RESPONSIVE", "visual", "需要 940/560/420/300px 与三种主题截图断言。"],
  ["MAC-INDEXING", "indexing", "需要索引状态、落盘、恢复和项目隔离专用动作。"],
  ["MAC-RETRIEVAL", "retrieval", "需要 graph-only 与固定检索协议专用动作。"],
  ["MAC-QWEN", "autocomplete", "需要编辑器 ghost text、Tab 接受和取消专用动作。"],
  ["MAC-AGENT-CONSOLE", "agent", "需要 session/worktree/terminal/审批专用动作。"],
  ["MAC-MARKETPLACE", "marketplace", "需要导入、删除、发布和取消专用动作。"],
  ["MAC-DOCUMENTS", "documents", "需要固定工具调用执行 Word/Mermaid/Artifact 专用动作。"],
  ["MAC-UPDATE-FAILURES", "failure", "需要更新协议及 401/403/503/超时专用动作。"],
]) {
  if (results.some((result) => result.id === item[0])) continue
  record(item[0], item[1], item[3] ?? "BLOCKED", [assertion("complete-case", false, item[2])], item[2])
}
const shot = join(evidence, "installed-window.png")
const visual = results.find((item) => item.id === "MAC-BRANDING-VISUAL")
if (visual && existsSync(shot)) visual.evidence.screenshots.push(relative(output, shot))

finish()

function inspect() {
  const manifest = JSON.parse(execFileSync("unzip", ["-p", vsix, "extension/package.json"], { encoding: "utf8" }))
  if (manifest.publisher !== "chipmate" || manifest.name !== "chipmate") fail("Unexpected extension identity")
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) fail(`Unexpected version ${manifest.version}`)
  if (manifest.chipmatePackageTarget !== "darwin-arm64")
    fail(`Expected darwin-arm64, got ${manifest.chipmatePackageTarget}`)
  const files = execFileSync("unzip", ["-Z1", vsix], { encoding: "utf8" }).split(/\r?\n/)
  const required = [
    "extension/bin/kilo",
    "extension/bin/rg",
    "extension/bin/models-snapshot.json",
    "extension/bin/tree-sitter/tree-sitter.wasm",
    "extension/bin/lancedb/node_modules/@lancedb/lancedb/dist/index.js",
    "extension/bin/lancedb/node_modules/@lancedb/lancedb-darwin-arm64/lancedb.darwin-arm64.node",
    "extension/dist/extension.js",
    "extension/dist/webview.js",
    "extension/dist/agent-manager.js",
    "extension/dist/agent-console.js",
    "extension/dist/diff-viewer.js",
    "extension/dist/diff-virtual.js",
  ]
  const missing = required.filter((path) => !files.includes(path))
  if (missing.length) fail(`VSIX missing required files: ${missing.join(", ")}`)
  const forbidden = files.filter((path) => path === "extension/bin/ffmpeg" || /^extension\/dist\/.*\.map$/.test(path))
  if (forbidden.length) fail(`VSIX contains forbidden files: ${forbidden.join(", ")}`)
  return manifest
}

async function probe() {
  const out = join(evidence, "installed-probe.json")
  const child = spawn(
    code,
    [
      workspace,
      "--new-window",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      `--extensions-dir=${extensions}`,
      `--user-data-dir=${user}`,
      `--extensionDevelopmentPath=${join(shared, "probe")}`,
    ],
    {
      detached: false,
      env: {
        ...process.env,
        CHIPMATE_QA_PROBE_OUT: out,
        CHIPMATE_QA_PROBE_QUIT: "1",
        CHIPMATE_QA_EXPECTED_VERSION: manifest.version,
      },
      stdio: "ignore",
    },
  )
  const found = await wait(out, 90_000)
  if (!found) {
    child.kill("SIGTERM")
    record(
      "MAC-INSTALLED-PROBE",
      "identity",
      "FAIL",
      [assertion("probe-result", false, "result timeout")],
      "正式安装态 probe 超时。",
    )
    return
  }
  const data = JSON.parse(readFileSync(out, "utf8"))
  record(
    "MAC-INSTALLED-PROBE",
    "identity",
    data.status === "PASS" ? "PASS" : "FAIL",
    [
      assertion("subject-installed", data.extension?.development === false, JSON.stringify(data.extension)),
      assertion("contributions", data.status === "PASS", (data.errors ?? []).join("; ")),
    ],
    data.status === "PASS" ? "正式安装的 subject 已激活并通过贡献点检查。" : "正式安装态 probe 失败。",
  )
}

function capture() {
  const shot = join(evidence, "installed-window.png")
  const result = run("screencapture", ["-x", shot])
  if (result.status !== 0) writeFileSync(join(evidence, "screencapture-error.log"), result.stderr)
}

function snapshot() {
  const logs = join(user, "logs")
  if (existsSync(logs)) cpSync(logs, join(evidence, "vscode-logs"), { recursive: true })
  const inventory = walk(user).map((path) => ({
    path: relative(user, path),
    bytes: statSync(path).size,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }))
  writeFileSync(join(evidence, "user-data-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`)
}

function finish() {
  for (const problem of atomic.problems) {
    for (const check of problem.assertions) {
      if (atomicResults.some((item) => item.id === check.id)) continue
      atomicResults.push({
        id: check.id,
        title: check.title,
        status: "BLOCKED",
        summary:
          check.macos.state === "planned"
            ? "macOS 原子执行器尚未实现，禁止从父 case 推断通过。"
            : "已声明执行器但本次运行没有上报原子结果。",
        evidence: [],
      })
    }
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    platform: "darwin-arm64",
    artifact: { vsix, sha256: createHash("sha256").update(readFileSync(vsix)).digest("hex") },
    results,
    atomicResults,
  }
  const path = join(output, "results.json")
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`)
  run(process.execPath, [join(shared, "report.mjs"), path, join(output, "report.html")])
  const zip = `${output}-evidence.zip`
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", output, zip])
  process.stdout.write(
    `${JSON.stringify({ results: path, report: join(output, "report.html"), evidence: zip }, null, 2)}\n`,
  )
  if ([...results, ...atomicResults].some((item) => ["FAIL", "FLAKY", "REVIEW", "BLOCKED"].includes(item.status)))
    process.exitCode = 1
}

function record(id, suite, status, assertions, summary = "") {
  results.push({ id, suite, title: id, status, summary, assertions, evidence: { screenshots: [] } })
}

function append(id, value) {
  const result = results.find((item) => item.id === id)
  result?.assertions.push(value)
}

function setStatus(id, status, summary) {
  const result = results.find((item) => item.id === id)
  if (!result) return
  result.status = status
  result.summary = summary
}

function failCase(id, detail) {
  append(id, assertion("install", false, detail))
  setStatus(id, "FAIL", detail)
}

function assertion(id, pass, detail) {
  return { id, status: pass ? "PASS" : "FAIL", detail }
}

function run(file, argv) {
  const result = spawnSync(file, argv, { encoding: "utf8" })
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

function wait(path, timeout) {
  const started = Date.now()
  return new Promise((done) => {
    const timer = setInterval(() => {
      if (existsSync(path)) {
        clearInterval(timer)
        done(true)
      } else if (Date.now() - started >= timeout) {
        clearInterval(timer)
        done(false)
      }
    }, 250)
  })
}

function walk(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() ? [path] : []
  })
}

function parse(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, "").split("=", 2)
    out[key] = inline ?? argv[++index]
  }
  return out
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}
