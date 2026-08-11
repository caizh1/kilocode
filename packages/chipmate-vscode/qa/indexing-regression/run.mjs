#!/usr/bin/env bun

import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadCatalog, selectCases, validateCatalog } from "./catalog.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const extension = resolve(here, "../..")
const repository = resolve(extension, "../..")
const argv = parse(process.argv.slice(2))
const catalog = loadCatalog()
const errors = validateCatalog(catalog)
if (errors.length > 0) throw new Error(`测试用例库校验失败：\n${errors.join("\n")}`)

const requested =
  typeof argv.case === "string"
    ? argv.case
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : []
const cases = selectCases(catalog, requested)

if (argv.list) {
  for (const item of cases) {
    process.stdout.write(`${item.id}  ${item.severity}  ${item.title}\n`)
    for (const expected of item.expected) process.stdout.write(`  预期：${expected}\n`)
  }
  process.exit(0)
}

const sourceOnly = argv["source-only"] === true
const packageOnly = argv["package-only"] === true
const verbose = argv.verbose === true
const packageBin = typeof argv["package-bin"] === "string" ? resolve(argv["package-bin"]) : undefined
const requirePackage = argv["require-package"] === true
if (sourceOnly && packageOnly) throw new Error("--source-only 与 --package-only 不能同时使用")
if (sourceOnly && packageBin) throw new Error("--source-only 不能与 --package-bin 同时使用")
if ((packageOnly || requirePackage) && !packageBin) {
  throw new Error("--package-only 或 --require-package 必须同时提供 --package-bin")
}

const output = resolve(
  typeof argv.output === "string"
    ? argv.output
    : join(repository, "packages/chipmate-vscode/qa/artifacts/indexing-regression", timestamp()),
)
await mkdir(output, { recursive: true })

const executorDefinitions = {
  "progress-core": {
    cwd: join(repository, "packages/chipmate-indexing"),
    command: [
      "bun",
      "test",
      "test/chipmate/indexing/state-manager.test.ts",
      "test/chipmate/indexing/orchestrator.test.ts",
      "test/chipmate/indexing/processors/scanner.test.ts",
      "--timeout",
      "30000",
    ],
  },
  "manager-lifecycle": {
    cwd: join(repository, "packages/chipmate-indexing"),
    command: [
      "bun",
      "test",
      "test/chipmate/indexing/manager.test.ts",
      "test/chipmate/indexing/service-factory.test.ts",
      "--timeout",
      "30000",
    ],
  },
  "lancedb-native": {
    cwd: join(repository, "packages/chipmate-indexing"),
    command: [
      "bun",
      "test",
      "test/chipmate/indexing/vector-store/lancedb-vector-store.test.ts",
      "test/chipmate/indexing/vector-store/safe-lancedb-vector-store.test.ts",
      "test/chipmate/indexing/vector-store/lancedb-vector-store.native.test.ts",
      "--timeout",
      "60000",
    ],
  },
  "vscode-status-sync": {
    cwd: extension,
    command: ["bun", "test", "tests/unit/chipmate-provider-indexing-refresh.test.ts", "--timeout", "30000"],
  },
}

const started = new Date().toISOString()
const sourceResults = []
const selectedExecutors = [...new Set(cases.flatMap((item) => item.sourceExecutors))]
if (!packageOnly) {
  for (const id of selectedExecutors) {
    const definition = executorDefinitions[id]
    const result = await execute(definition.command, definition.cwd)
    sourceResults.push({ id, ...result })
    process.stdout.write(`\n[源码] ${id} ${result.exitCode === 0 ? "PASS" : "FAIL"}，${result.durationMs} 毫秒\n`)
    printDetails(result)
  }
}

let packageResult
const packageCases = cases.filter((item) => item.packageExecutor === "formal-indexer-ipc")
if (!sourceOnly && packageBin && packageCases.length > 0) {
  const packageOutput = join(output, "包内IPC")
  const result = await execute(
    ["node", join(here, "package-smoke.mjs"), "--bin", packageBin, "--output", packageOutput],
    extension,
  )
  packageResult = { id: "formal-indexer-ipc", outputDirectory: packageOutput, ...result }
  process.stdout.write(
    `\n[包内 IPC] formal-indexer-ipc ${result.exitCode === 0 ? "PASS" : "FAIL"}，${result.durationMs} 毫秒\n`,
  )
  printDetails(result)
}

const failedSources = sourceResults.filter((item) => item.exitCode !== 0)
const packageFailed = packageResult?.exitCode !== undefined && packageResult.exitCode !== 0
const packageNotRun = packageCases.length > 0 && !sourceOnly && !packageBin
const status = failedSources.length > 0 || packageFailed || (requirePackage && packageNotRun) ? "FAIL" : "PASS"
const result = {
  测试库版本: catalog.version,
  开始时间: started,
  完成时间: new Date().toISOString(),
  状态: status,
  模式: packageOnly ? "仅包内 IPC" : sourceOnly ? "仅源码" : packageBin ? "源码和包内 IPC" : "仅源码",
  用例: cases.map((item) => ({
    id: item.id,
    标题: item.title,
    严重级别: item.severity,
    源码执行器: item.sourceExecutors,
    包内执行器: item.packageExecutor,
    现场用例: item.scope.includes("windows-installed") ? "WIN-INDEXING-LIFECYCLE" : "不要求",
    功能预期: item.expected,
  })),
  源码执行结果: sourceResults.map(summary),
  包内执行结果: packageResult
    ? summary(packageResult)
    : packageCases.length > 0
      ? "未执行，需要 --package-bin"
      : "不要求",
}

await writeFile(join(output, "results.json"), `${JSON.stringify(result, null, 2)}\n`)
await writeFile(join(output, "索引回归报告.md"), markdown(result))
process.stdout.write(
  `\n${JSON.stringify(
    {
      状态: status,
      报告: join(output, "索引回归报告.md"),
      原始结果: join(output, "results.json"),
      包内IPC: sourceOnly
        ? "按 --source-only 跳过"
        : packageNotRun
          ? "未执行；如需发布门禁请增加 --package-bin 与 --require-package"
          : "已执行或不要求",
    },
    null,
    2,
  )}\n`,
)
if (status !== "PASS") process.exitCode = 1

function summary(value) {
  return {
    id: value.id,
    状态: value.exitCode === 0 ? "PASS" : "FAIL",
    退出码: value.exitCode,
    耗时毫秒: value.durationMs,
    输出末尾: tail(value.output, 12000),
    ...(value.outputDirectory ? { 证据目录: value.outputDirectory } : {}),
  }
}

async function execute(command, cwd) {
  const start = Date.now()
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let output = ""
  child.stdout.on("data", (chunk) => {
    output += String(chunk)
  })
  child.stderr.on("data", (chunk) => {
    output += String(chunk)
  })
  const exitCode = await new Promise((resolvePromise, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolvePromise(code ?? 1))
  })
  return { exitCode, durationMs: Date.now() - start, output }
}

function markdown(value) {
  const rows = value.用例.map(
    (item) =>
      `| ${item.id} | ${item.严重级别} | ${item.标题} | ${caseState(item, value)} | ${item.功能预期.join("；")} |`,
  )
  const sourceRows = value.源码执行结果.length
    ? value.源码执行结果.map((item) => `| ${item.id} | ${item.状态} | ${item.退出码} | ${item.耗时毫秒} |`)
    : ["| 未执行 | 未执行 | - | - |"]
  const packageRows =
    typeof value.包内执行结果 === "string"
      ? [`| formal-indexer-ipc | ${value.包内执行结果} | - | - |`]
      : [
          `| ${value.包内执行结果.id} | ${value.包内执行结果.状态} | ${value.包内执行结果.退出码} | ${value.包内执行结果.耗时毫秒} |`,
        ]
  return [
    "# ChipMate 索引历史缺陷回归报告",
    "",
    `- 结果：${value.状态}`,
    `- 模式：${value.模式}`,
    `- 开始时间：${value.开始时间}`,
    `- 完成时间：${value.完成时间}`,
    "",
    "## 用例与功能预期",
    "",
    "| ID | 级别 | 用例 | 本次状态 | 功能预期 |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "## 源码执行器",
    "",
    "| 执行器 | 状态 | 退出码 | 耗时（毫秒） |",
    "|---|---|---:|---:|",
    ...sourceRows,
    "",
    "## 包内真实 IPC",
    "",
    "| 执行器 | 状态 | 退出码 | 耗时（毫秒） |",
    "|---|---|---:|---:|",
    ...packageRows,
    "",
    "Windows 已安装扩展的 UI 与宿主生命周期仍由 `WIN-INDEXING-LIFECYCLE` 现场用例补充验收。",
    "",
  ].join("\n")
}

function caseState(item, value) {
  const sources = value.源码执行结果.filter((result) => item.源码执行器.includes(result.id))
  const sourcePass = sources.length === item.源码执行器.length && sources.every((result) => result.状态 === "PASS")
  if (value.模式 === "仅包内 IPC") {
    if (item.包内执行器 === "not-required") return "不适用"
    return typeof value.包内执行结果 === "string" ? "未执行" : value.包内执行结果.状态
  }
  if (!sourcePass) return sources.some((result) => result.状态 === "FAIL") ? "FAIL" : "未执行"
  if (item.包内执行器 === "not-required" || value.模式 === "仅源码") return "PASS"
  if (typeof value.包内执行结果 === "string") return "源码 PASS，包未执行"
  return value.包内执行结果.状态
}

function tail(value, limit) {
  return value.length <= limit ? value : value.slice(-limit)
}

function printDetails(result) {
  if (!verbose && result.exitCode === 0) return
  const output = verbose ? result.output : tail(result.output, 12000)
  process.stdout.write(output)
  if (!output.endsWith("\n")) process.stdout.write("\n")
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function parse(args) {
  const result = {}
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index]
    if (!item.startsWith("--")) continue
    const [key, inline] = item.slice(2).split("=", 2)
    if (inline !== undefined) result[key] = inline
    else if (args[index + 1] && !args[index + 1].startsWith("--")) result[key] = args[++index]
    else result[key] = true
  }
  return result
}
