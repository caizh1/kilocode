#!/usr/bin/env node

import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"

const prefix = "@chipmate-indexing:"
const dimension = 4096
const argv = parse(process.argv.slice(2))
const bin = resolve(argv.bin ?? "")
const output = resolve(argv.output ?? join(tmpdir(), `chipmate-indexing-package-${Date.now()}`))
const drivers = []
const mock = { mode: "ok", requests: [] }

if (!argv.bin) {
  throw new Error(
    "用法：node qa/indexing-regression/package-smoke.mjs --bin <已安装扩展或解包 VSIX 的 bin 目录> [--output <报告目录>]",
  )
}

const names =
  process.platform === "win32" ? { indexer: "chipmate-indexer.exe", rg: "rg.exe" } : { indexer: "chipmate-indexer", rg: "rg" }
const indexer = join(bin, names.indexer)
const rg = join(bin, names.rg)
const tree = join(bin, "tree-sitter")
const lance = join(bin, "lancedb", "node_modules", "@lancedb", "lancedb", "dist", "index.js")

for (const file of [indexer, rg, join(tree, "tree-sitter.wasm"), lance]) {
  if (!existsSync(file)) throw new Error(`包内索引运行时缺少文件：${file}`)
}
if (process.platform !== "win32") {
  await ensureExecutable(indexer)
  await ensureExecutable(rg)
}

await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    const input = Array.isArray(body.input) ? body.input : [body.input]
    mock.requests.push({
      模式: mock.mode,
      数量: input.length,
      dimensions字段: body.dimensions === undefined ? "未发送" : body.dimensions,
    })
    if (mock.mode !== "ok") {
      response.writeHead(Number(mock.mode), { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { message: `测试服务固定返回 HTTP ${mock.mode}` } }))
      return
    }
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        object: "list",
        data: input.map((value, index) => ({
          object: "embedding",
          index,
          embedding: embedding(value),
        })),
        model: body.model,
        usage: { prompt_tokens: input.length, total_tokens: input.length },
      }),
    )
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { message: `测试服务异常：${message(error)}` } }))
  }
})
await new Promise((resolvePromise, reject) => {
  server.once("error", reject)
  server.listen(0, "127.0.0.1", resolvePromise)
})
const address = server.address()
if (!address || typeof address === "string") throw new Error("无法确定测试 embedding 服务端口")
const endpoint = `http://127.0.0.1:${address.port}/v1/embeddings`

async function main() {
  let report
  try {
    report = await execute()
    await writeReports(report)
    process.stdout.write(
      `${JSON.stringify(
        {
          状态: "PASS",
          报告: join(output, "索引包回归报告.md"),
          原始结果: join(output, "results.json"),
        },
        null,
        2,
      )}\n`,
    )
  } catch (error) {
    report = {
      生成时间: new Date().toISOString(),
      平台: `${process.platform}-${process.arch}`,
      bin,
      状态: "FAIL",
      错误: message(error),
    }
    await writeReports(report)
    throw error
  } finally {
    await Promise.all(drivers.map((item) => item.dispose().catch(() => undefined)))
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
}

async function execute() {
  const base = await mkdtemp(join(tmpdir(), "chipmate-indexing-regression-"))
  const workspace = join(base, "工作区 中文 空格")
  const cache = join(base, "缓存")
  await createFixture(workspace)

  const main = createDriver(workspace, cache, "正常索引")
  const config = makeConfig(join(cache, "vectors", "正常索引"), endpoint)
  await main.init(config)
  const complete = await main.wait(
    (status) =>
      status.state === "Complete" &&
      status.pipelines?.codeGraph?.state === "Complete" &&
      status.pipelines?.rag?.state === "Complete" &&
      status.pipelines?.documents?.state === "Complete",
    180_000,
  )

  verifyProgress(main.statuses, complete)
  verifyDocumentOrder(main.statuses)
  const terminalIndex = main.statuses.indexOf(complete)
  await pause(300)
  verify(
    !main.statuses.slice(terminalIndex + 1).some((status) => status.pipelines?.rag?.state === "In Progress"),
    "Code RAG 终态后又恢复成运行态",
  )
  verify(
    complete.pipelines.rag.processedFiles === 3 && complete.pipelines.rag.totalFiles === 3,
    `Code RAG 进度不是 3/3：${complete.pipelines.rag.processedFiles}/${complete.pipelines.rag.totalFiles}`,
  )
  const code = await main.call("search", { query: "RAG_PROGRESS_ALPHA_7101" })
  const document = await main.call("documentSearch", { query: "DOC_RAG_FINAL_7702", maxResults: 3 })
  const graph = await main.call("queryEvidence", {
    query: "RAG_PROGRESS_ALPHA_7101",
    retrievalMode: "graph-only",
    maxEvidenceItems: 6,
  })
  verify(code[0]?.payload?.filePath?.endsWith("src/alpha.c"), "代码固定标记 Top-1 未命中 src/alpha.c")
  verify(document[0]?.filePath?.endsWith("docs/guide.md"), "文档固定标记 Top-1 未命中 docs/guide.md")
  verify(document[0]?.sourceRef, "文档固定标记结果缺少 sourceRef")
  verify(JSON.stringify(graph).includes("src/alpha.c"), "CodeGraph 固定证据未命中 src/alpha.c")
  verify(main.stderr.includes("vector index finalization complete"), "日志缺少向量索引完成阶段")
  verify(main.stderr.includes("indexing lock released"), "日志缺少索引锁释放阶段")
  verify(!/CASE WHEN.+not supported SQL/is.test(main.stderr), "包内 LanceDB 仍触发不支持的 CASE WHEN")

  const offset = main.statuses.length
  const graphFiles = complete.pipelines.codeGraph.validFileCount
  const changed = structuredClone(config)
  changed.openAiCompatibleBaseUrl = `${endpoint}?配置变更=1`
  await main.call("updateConfig", changed)
  const rebuilt = await main.wait(
    (status, index) =>
      index >= offset &&
      status.state === "Complete" &&
      status.pipelines?.rag?.state === "Complete" &&
      status.pipelines?.documents?.state === "Complete",
    180_000,
  )
  const changedStatuses = main.statuses.slice(offset)
  const firstRunning = changedStatuses.find((status) => status.pipelines?.rag?.state === "In Progress")
  verify(firstRunning, "embedding 配置变化后没有产生新一轮 RAG 运行态")
  verify(
    (firstRunning.pipelines.rag.processedFiles ?? -1) === 0 &&
      (firstRunning.pipelines.rag.totalFiles ?? -1) === 0 &&
      (firstRunning.pipelines.rag.percent ?? -1) === 0,
    `新一轮 RAG 未清除旧终态：${JSON.stringify(firstRunning.pipelines.rag)}`,
  )
  verify(rebuilt.pipelines.codeGraph.validFileCount === graphFiles, "embedding 配置变化后 CodeGraph 有效文件数发生变化")
  verify(
    changedStatuses.every((status) => status.pipelines?.codeGraph?.state !== "In Progress"),
    "embedding 配置变化后 CodeGraph 重新进入运行态",
  )
  const graphAfter = await main.call("queryEvidence", {
    query: "RAG_PROGRESS_ALPHA_7101",
    retrievalMode: "graph-only",
    maxEvidenceItems: 6,
  })
  verify(JSON.stringify(graphAfter).includes("src/alpha.c"), "embedding 配置变化后 CodeGraph 不可查询")

  const documentOffset = main.statuses.length
  const documentChanged = structuredClone(changed)
  documentChanged.documents.chunkChars = 700
  await main.call("updateConfig", documentChanged)
  await main.wait(
    (status, index) =>
      index >= documentOffset &&
      status.pipelines?.documents?.state === "In Progress" &&
      status.pipelines?.codeGraph?.state === "Complete" &&
      status.pipelines?.rag?.state === "Complete",
    60_000,
  )
  const documentRebuilt = await main.wait(
    (status, index) =>
      index >= documentOffset && status.state === "Complete" && status.pipelines?.documents?.state === "Complete",
    120_000,
  )
  const documentStatuses = main.statuses.slice(documentOffset)
  verify(
    documentStatuses.every((status) => status.pipelines?.codeGraph?.state !== "In Progress"),
    "仅 Document RAG 配置变化后 CodeGraph 重新进入运行态",
  )
  verify(
    documentStatuses.every((status) => status.pipelines?.rag?.state !== "In Progress"),
    "仅 Document RAG 配置变化后 Code RAG 重新进入运行态",
  )
  verify(
    documentRebuilt.pipelines.codeGraph.validFileCount === graphFiles,
    "仅 Document RAG 配置变化后 CodeGraph 有效文件数发生变化",
  )
  const graphAfterDocuments = await main.call("queryEvidence", {
    query: "RAG_PROGRESS_ALPHA_7101",
    retrievalMode: "graph-only",
    maxEvidenceItems: 6,
  })
  verify(JSON.stringify(graphAfterDocuments).includes("src/alpha.c"), "Document 配置变化后 CodeGraph 不可查询")
  await main.dispose()

  const failures = {}
  for (const code of ["401", "403", "404"]) {
    failures[code] = await verifyHttpFailure({ base, workspace, code })
  }
  mock.mode = "ok"

  return {
    生成时间: new Date().toISOString(),
    平台: `${process.platform}-${process.arch}`,
    bin,
    状态: "PASS",
    用例: {
      文件单次计数: "PASS",
      运行态最大百分比: 99,
      终态百分比: complete.percent,
      三条流水线: {
        CodeGraph: complete.pipelines.codeGraph.state,
        CodeRAG: complete.pipelines.rag.state,
        DocumentRAG: complete.pipelines.documents.state,
      },
      CodeRAG进度: `${complete.pipelines.rag.processedFiles}/${complete.pipelines.rag.totalFiles}`,
      代码Top1: code[0].payload.filePath,
      文档Top1: document[0].filePath,
      新一轮清除旧100: "PASS",
      配置变化后CodeGraph可查询: "PASS",
      仅Document配置不重建代码索引: "PASS",
      不可重试HTTP错误: failures,
      LanceDB原生Finalize: "PASS",
    },
  }
}

async function verifyHttpFailure({ base, workspace, code }) {
  mock.mode = code
  const root = join(base, `${code}缓存`)
  const driver = createDriver(workspace, root, `HTTP${code}`)
  const before = mock.requests.length
  await driver.init(makeConfig(join(root, "vectors"), endpoint))
  const failure = await driver.wait(
    (status) =>
      status.pipelines?.codeGraph?.state === "Complete" &&
      status.pipelines?.rag?.state === "Error" &&
      status.pipelines?.documents?.state === "Standby",
    120_000,
  )
  const requests = mock.requests.length - before
  verify(requests === 1, `HTTP ${code} 后仍然重试 embedding 请求`)
  verify(
    !driver.statuses.some(
      (status) => (status.pipelines?.rag?.processedFiles ?? 0) > 0 || (status.pipelines?.rag?.totalFiles ?? 0) > 0,
    ),
    `HTTP ${code} 后错误启动 RAG 文件扫描`,
  )
  verify(!(await accessible(join(root, "vectors"))), `HTTP ${code} 后仍创建了 LanceDB 向量目录`)
  const fallback = await driver.call("queryEvidence", {
    query: "RAG_PROGRESS_ALPHA_7101",
    retrievalMode: "graph-only",
    maxEvidenceItems: 6,
  })
  verify(JSON.stringify(fallback).includes("src/alpha.c"), `HTTP ${code} 后 CodeGraph 不可查询`)
  await driver.dispose()
  return {
    请求次数: requests,
    顶层状态: failure.state,
    CodeGraph: failure.pipelines.codeGraph.state,
    CodeRAG: failure.pipelines.rag.state,
    DocumentRAG: failure.pipelines.documents.state,
  }
}

function createDriver(workspace, root, id) {
  const item = new Driver({
    id,
    workspace,
    root,
    indexer,
    lance,
    env: {
      CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
      CHIPMATE_RIPGREP_PATH: rg,
      CHIPMATE_TREE_SITTER_WASM_DIR: tree,
      CHIPMATE_CODEGRAPH_WORKER_CONCURRENCY: "2",
    },
  })
  drivers.push(item)
  return item
}

function makeConfig(vectorDirectory, openAiCompatibleBaseUrl) {
  return {
    enabled: true,
    embedderProvider: "openai-compatible",
    vectorStoreProvider: "lancedb",
    lancedbVectorStoreDirectory: vectorDirectory,
    modelId: "qwen3-embedding-8b",
    dimensionMode: "auto",
    openAiCompatibleBaseUrl,
    searchMinScore: 0,
    searchMaxResults: 5,
    embeddingBatchSize: 8,
    scannerMaxBatchRetries: 1,
    fileExtensions: [".c", ".cpp", ".h"],
    documents: {
      enabled: true,
      paths: ["."],
      maxFiles: 20,
      maxFileBytes: 1024 * 1024,
      maxExtractedBytesPerFile: 512 * 1024,
      chunkChars: 800,
      chunkOverlapChars: 100,
      searchMaxResults: 5,
    },
  }
}

function verifyProgress(statuses, complete) {
  for (const status of statuses) {
    if (status.state === "In Progress") verify((status.percent ?? 0) <= 99, "顶层运行态提前显示 100%")
    if (status.pipelines?.rag?.state === "In Progress") {
      verify((status.pipelines.rag.percent ?? 0) <= 99, "Code RAG 运行态提前显示 100%")
      verify(
        (status.pipelines.rag.processedFiles ?? 0) <= (status.pipelines.rag.totalFiles ?? 0),
        "Code RAG processedFiles 超过 totalFiles",
      )
    }
  }
  const sequence = [
    ...new Set(statuses.map((status) => status.pipelines?.rag?.processedFiles ?? 0).filter((value) => value > 0)),
  ]
  verify(JSON.stringify(sequence) === JSON.stringify([1, 2, 3]), `文件处理序列不是 1、2、3：${sequence.join("、")}`)
  verify(complete.percent === 100 && complete.pipelines.rag.percent === 100, "真实终态没有显示 100%")
}

function verifyDocumentOrder(statuses) {
  const firstRagComplete = statuses.findIndex((status) => status.pipelines?.rag?.state === "Complete")
  const firstDocumentRunning = statuses.findIndex((status) => status.pipelines?.documents?.state === "In Progress")
  verify(firstRagComplete >= 0, "未观察到 Code RAG Complete")
  verify(firstDocumentRunning >= firstRagComplete, "Document RAG 在 Code RAG Complete 前启动")
  verify(
    statuses.every(
      (status) =>
        status.pipelines?.documents?.state !== "In Progress" ||
        (status.pipelines?.codeGraph?.state === "Complete" && status.pipelines?.rag?.state === "Complete"),
    ),
    "Document RAG 运行态没有依赖两条代码流水线的真实终态",
  )
  const starts = statuses.filter(
    (status, index) =>
      status.pipelines?.documents?.state === "In Progress" &&
      statuses[index - 1]?.pipelines?.documents?.state !== "In Progress",
  )
  verify(starts.length === 1, `Document RAG 本轮启动次数不是 1：${starts.length}`)
}

async function createFixture(workspace) {
  await mkdir(join(workspace, "src"), { recursive: true })
  await mkdir(join(workspace, "include"), { recursive: true })
  await mkdir(join(workspace, "docs"), { recursive: true })
  await writeFile(
    join(workspace, "src", "alpha.c"),
    `/*
 * RAG_PROGRESS_ALPHA_7101 固件恢复状态检查。
 * 保留完整函数上下文以形成稳定代码分块。
 */
typedef struct {
  int checkpoint_valid;
  int journal_replayed;
  int controller_ready;
} recovery_state;

int rag_progress_alpha_7101(const recovery_state *state)
{
  if (state == 0) return -1;
  if (!state->checkpoint_valid || !state->journal_replayed) return -2;
  return state->controller_ready ? 7101 : 0;
}
`,
  )
  await writeFile(
    join(workspace, "src", "beta.cpp"),
    `/*
 * RAG_PROGRESS_BETA_7102 负责验证提交队列。
 * 多行实现用于验证第二个候选文件只计数一次。
 */
class CommitQueue {
 public:
  int verify(int pending, bool storage_ready) const {
    if (!storage_ready) return -1;
    if (pending < 0) return -2;
    return pending == 0 ? 7102 : pending;
  }
};
`,
  )
  await writeFile(
    join(workspace, "include", "gamma.h"),
    `/*
 * RAG_PROGRESS_GAMMA_7103 是恢复检查的公共声明。
 * 头文件同样必须形成独立候选文件进度。
 */
typedef enum {
  RECOVERY_IDLE = 0,
  RECOVERY_REPLAYING = 1,
  RECOVERY_READY = 7103
} recovery_phase;

static inline int rag_progress_gamma_7103(recovery_phase phase)
{
  return phase == RECOVERY_READY ? 7103 : 0;
}
`,
  )
  await writeFile(
    join(workspace, "docs", "guide.md"),
    "# 固件恢复指南\n\nDOC_RAG_FINAL_7702 描述检查点、日志重放与控制器恢复的完整流程。\n",
  )
}

function category(value) {
  const text = String(value).toLowerCase()
  if (text.includes("rag_progress_alpha_7101")) return 7
  if (text.includes("rag_progress_beta_7102")) return 8
  if (text.includes("rag_progress_gamma_7103")) return 9
  if (text.includes("doc_rag_final_7702")) return 10
  if (/retry_connection|network connection|closes and reopens|failed network|socket/.test(text)) return 0
  if (/enter_recovery|controller|错误恢复|清零重试/.test(text)) return 1
  if (/translate_page|virtual|physical page|address translation|地址转换/.test(text)) return 2
  if (/queue_push|mutex|互斥锁|队列写入/.test(text)) return 3
  if (/verify_packet|crc|checksum|packet integrity/.test(text)) return 4
  if (/copy_frame|buffer|缓冲区越界|限制长度/.test(text)) return 5
  return 6
}

function embedding(value) {
  const group = category(value)
  let seed = 2166136261
  for (const character of String(value)) {
    seed ^= character.codePointAt(0)
    seed = Math.imul(seed, 16777619) >>> 0
  }
  const vector = Array.from({ length: dimension }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return ((seed / 0xffffffff) * 2 - 1) * 0.01
  })
  vector[group] = 1
  vector[64 + group] = 0.5
  return vector
}

class Driver {
  constructor(options) {
    this.id = options.id
    this.workspace = options.workspace
    this.root = options.root
    this.lance = options.lance
    this.sequence = 0
    this.pending = new Map()
    this.statuses = []
    this.stderr = ""
    this.disposed = false
    this.child = spawn(options.indexer, [], {
      cwd: bin,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.child.stderr.on("data", (chunk) => {
      this.stderr += String(chunk)
    })
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.lines.on("line", (line) => this.line(line))
    this.child.once("exit", (code, signal) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`${this.id} indexer 提前退出：code=${code} signal=${signal}`))
      }
      this.pending.clear()
    })
  }

  line(line) {
    if (!line.startsWith(prefix)) {
      this.stderr += `${line}\n`
      return
    }
    const data = JSON.parse(line.slice(prefix.length))
    if (data.type === "event") {
      if (data.event === "status") this.statuses.push(data.data)
      return
    }
    const pending = this.pending.get(data.id)
    if (!pending) return
    this.pending.delete(data.id)
    clearTimeout(pending.timer)
    if (data.ok) pending.resolve(data.value)
    else pending.reject(new Error(data.error))
  }

  call(method, input, timeout = 120_000) {
    const id = this.sequence++
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.id} ${method} IPC 超时`))
      }, timeout)
      this.pending.set(id, { resolve: resolvePromise, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ type: "request", id, method, input })}\n`)
    })
  }

  init(config) {
    return this.call("init", {
      directory: this.workspace,
      root: this.root,
      config,
      lancedbPath: pathToFileURL(this.lance).href,
    })
  }

  async wait(predicate, timeout) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      for (let index = 0; index < this.statuses.length; index += 1) {
        if (predicate(this.statuses[index], index)) return this.statuses[index]
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    }
    throw new Error(`${this.id} 状态等待超时：${JSON.stringify(this.statuses.at(-1))}`)
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    await this.call("dispose", undefined, 10_000).catch(() => undefined)
    this.child.stdin.end()
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await new Promise((resolvePromise) => this.child.once("exit", resolvePromise))
    }
  }
}

async function writeReports(value) {
  await writeFile(join(output, "results.json"), `${JSON.stringify(value, null, 2)}\n`)
  const rows =
    value.状态 === "PASS"
      ? Object.entries(value.用例).map(([key, detail]) => `| ${key} | ${format(detail)} |`)
      : [["错误", value.错误]].map(([key, detail]) => `| ${key} | ${detail} |`)
  const markdown = [
    "# ChipMate 索引包回归报告",
    "",
    `- 生成时间：${value.生成时间}`,
    `- 平台：${value.平台}`,
    `- bin：\`${value.bin}\``,
    `- 结果：${value.状态}`,
    "",
    "| 检查项 | 结果 |",
    "|---|---|",
    ...rows,
    "",
  ].join("\n")
  await writeFile(join(output, "索引包回归报告.md"), markdown)
}

function format(value) {
  if (typeof value === "string" || typeof value === "number") return String(value)
  return JSON.stringify(value)
}

async function accessible(path) {
  return stat(path)
    .then(() => true)
    .catch(() => false)
}

async function ensureExecutable(path) {
  const info = await stat(path)
  if ((info.mode & 0o111) !== 0) return
  await chmod(path, info.mode | 0o755)
}

function pause(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function verify(condition, failure) {
  if (!condition) throw new Error(failure)
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
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

await main()
