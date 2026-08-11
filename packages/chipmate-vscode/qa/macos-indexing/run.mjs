#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { execFileSync, spawn } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"
import yazl from "yazl"
import { utils, write } from "../../../chipmate-indexing/node_modules/xlsx/xlsx.mjs"

const prefix = "@chipmate-indexing:"
const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../..")
const argv = parse(process.argv.slice(2))
const vsix = resolve(argv.vsix ?? "")
const endpoint = argv.endpoint ?? "http://127.0.0.1:1234/v1/embeddings"
const endpointHash = createHash("sha256").update(endpoint).digest("hex")
const model = argv.model ?? "qwen3-embedding-8b"
const keyenv = argv["api-key-env"] ?? "CHIPMATE_EMBEDDING_API_KEY"
const apikey = process.env[keyenv]
const requested = argv.dimension === undefined ? undefined : Number(argv.dimension)
const output = resolve(argv.output ?? join(tmpdir(), `chipmate-macos-indexing-${Date.now()}`))
const runtime = join(output, "runtime")
const evidence = join(output, "evidence")
const cache = join(output, "cache")
const results = []
const drivers = []
const benchmark = qualityCases()

if (!argv.vsix) {
  throw new Error(
    "用法：bun qa/macos-indexing/run.mjs --vsix <darwin-arm64.vsix> [--endpoint <完整 embeddings URL>] [--api-key-env <环境变量名>] [--output <目录>]",
  )
}
if (!existsSync(vsix)) throw new Error(`找不到 VSIX：${vsix}`)
if (requested !== undefined && (!Number.isInteger(requested) || requested < 32 || requested > 4096)) {
  throw new Error(`无效 Qwen3 固定向量维度：${requested}`)
}

mkdirSync(runtime, { recursive: true })
mkdirSync(evidence, { recursive: true })
mkdirSync(cache, { recursive: true })
execFileSync("unzip", ["-q", vsix, "-d", runtime])

const extension = join(runtime, "extension")
const bin = join(extension, "bin")
const indexer = join(bin, "chipmate-indexer")
const lancedb = join(bin, "lancedb", "node_modules", "@lancedb", "lancedb", "dist", "index.js")
const rg = join(bin, "rg")
const manifest = JSON.parse(readFileSync(join(extension, "package.json"), "utf8"))
const files = execFileSync("unzip", ["-Z1", vsix], { encoding: "utf8" }).split(/\r?\n/)

await check("PKG-01", "VSIX 包内运行时审计", async () => {
  const required = [
    "extension/bin/chipmate",
    "extension/bin/chipmate-indexer",
    "extension/bin/rg",
    "extension/bin/models-snapshot.json",
    "extension/bin/codegraph-parser-worker.mjs",
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
  const missing = required.filter((file) => !files.includes(file))
  const foreign = files.filter(
    (file) =>
      /lancedb-(win32|linux|darwin-x64)|lancedb\.(win32|linux|x64)/i.test(file) ||
      /chipmate(?:-indexer)?\.exe$/i.test(file),
  )
  const forbidden = files.filter((file) => file === "extension/bin/ffmpeg" || /^extension\/dist\/.*\.map$/i.test(file))
  verify(manifest.publisher === "chipmate" && manifest.name === "chipmate", "扩展身份不是 chipmate.chipmate。")
  if (argv.version) verify(manifest.version === argv.version, `包内版本不是 ${argv.version}：${manifest.version}`)
  verify(manifest.chipmatePackageTarget === "darwin-arm64", `TargetPlatform 错误：${manifest.chipmatePackageTarget}`)
  verify(missing.length === 0, `缺少包内文件：${missing.join("、")}`)
  verify(foreign.length === 0, `包含其他平台原生文件：${foreign.join("、")}`)
  verify(forbidden.length === 0, `包含禁止文件：${forbidden.join("、")}`)
  chmodSync(indexer, 0o755)
  chmodSync(rg, 0o755)
  const ripgrep = execFileSync(rg, ["--version"], { encoding: "utf8" }).split(/\r?\n/)[0]
  verify(/^ripgrep /i.test(ripgrep), `包内 rg 不可执行：${ripgrep}`)
  return {
    身份: `${manifest.publisher}.${manifest.name}`,
    版本: manifest.version,
    目标: manifest.chipmatePackageTarget,
    文件数: files.filter(Boolean).length,
    ripgrep,
  }
})

const protocol = await check("EMB-01", "真实 embedding 协议与自动维度校验", async () => {
  const samples = [
    { 名称: "单条", input: "ChipMate indexing protocol probe" },
    { 名称: "批量", input: ["alpha firmware path", "beta recovery path"] },
    { 名称: "中文", input: "垃圾回收与地址转换流程" },
    { 名称: "空白", input: " " },
    { 名称: "长文本", input: "long-indexing-probe ".repeat(800) },
  ]
  const rows = []
  const dimensions = []
  for (const sample of samples) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apikey ? { authorization: `Bearer ${apikey}` } : {}),
      },
      body: JSON.stringify({ model, input: sample.input, encoding_format: "float" }),
    })
    const body = await response.text()
    verify(response.ok, `${sample.名称} embedding 请求失败：HTTP ${response.status} ${body.slice(0, 300)}`)
    const data = JSON.parse(body)
    const expected = Array.isArray(sample.input) ? sample.input.length : 1
    verify(Array.isArray(data.data) && data.data.length === expected, `${sample.名称} 返回 data 数量错误。`)
    const dims = data.data.map((item) => item.embedding?.length)
    verify(dims.every((value) => Number.isInteger(value) && value > 0), `${sample.名称} 返回空维度。`)
    dimensions.push(...dims)
    verify(
      data.data.every((item) => item.embedding.every((value) => Number.isFinite(value))),
      `${sample.名称} 返回非有限数值。`,
    )
    rows.push({ 名称: sample.名称, 数量: data.data.length, 维度: dims[0] })
  }
  verify(new Set(dimensions).size === 1, `连续协议请求返回了不同维度：${[...new Set(dimensions)].join("、")}`)
  const dimension = dimensions[0]
  verify(dimension >= 32 && dimension <= 4096, `Qwen3 实际维度超出 32–4096：${dimension}`)
  if (requested !== undefined) verify(dimension === requested, `期望 ${requested} 维，实际 ${dimension} 维。`)
  return { dimension, rows }
})
if (protocol.status !== "PASS") throw new Error("真实 embedding 协议探测失败，停止后续索引验收。")
const dimension = protocol.detail.dimension

const proxyState = { count: 0, mode: "pass", requests: [], switchAt: Number.POSITIVE_INFINITY }
const proxy = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    proxyState.count += 1
    const body = await request.text()
    proxyState.requests.push({
      time: new Date().toISOString(),
      mode: proxyState.mode,
      path: new URL(request.url).pathname,
      body: safe(body),
    })
    if (proxyState.mode === "timeout") {
      await Bun.sleep(15_000)
      return Response.json({ error: "qa timeout" }, { status: 504 })
    }
    if (proxyState.mode === "429") return Response.json({ error: "qa rate limit" }, { status: 429 })
    if (proxyState.mode === "500") return Response.json({ error: "qa server error" }, { status: 500 })
    if (proxyState.mode === "invalid") {
      return new Response("{invalid-json", { status: 200, headers: { "content-type": "application/json" } })
    }
    if (proxyState.mode === "empty") return Response.json({ data: [], model })
    const payload = JSON.parse(body)
    if (proxyState.mode === "reject-dimensions" && payload.dimensions !== undefined) {
      return Response.json({ error: "qa dimensions unsupported" }, { status: 400 })
    }
    const headers = new Headers(request.headers)
    headers.delete("host")
    headers.delete("content-length")
    const target = { ...payload }
    if (proxyState.mode === "ignore-dimensions") delete target.dimensions
    if (transformMode(proxyState.mode)) target.encoding_format = "float"
    const forwarded =
      proxyState.mode === "ignore-dimensions" || transformMode(proxyState.mode) ? JSON.stringify(target) : body
    const response = await fetch(endpoint, { method: "POST", headers, body: forwarded })
    if (!response.ok || !faultMode(proxyState.mode, proxyState.count, proxyState.switchAt)) return response
    const data = await response.json()
    return Response.json(fault(data, proxyState.mode), { status: response.status })
  },
})
const proxyUrl = `http://127.0.0.1:${proxy.port}/v1/embeddings`

const fixture = await synth(join(output, "fixture-中文 空格"))
const main = driver(fixture, "synthetic")
const cfg = config("synthetic", { documents: { enabled: true, paths: ["."] } })

await check("IDX-01", "包内 indexer 冷启动与三条索引流水线", async () => {
  await main.init(cfg)
  const status = await main.complete({ documents: true })
  verify(status.pipelines.codeGraph.validFileCount >= 7, "CodeGraph 未覆盖合成 C/C++ 样本。")
  verify(status.pipelines.rag.processedFiles >= 7, "Code RAG 未覆盖合成 C/C++ 样本。")
  verify(status.pipelines.documents.validFileCount >= 8, "Document RAG 未覆盖固定文档格式。")
  verify(
    main.stderr.includes('"target":"rag","discoveryEngine":"rg"'),
    "日志未确认 Code RAG 使用包内 rg。",
  )
  verify(
    !main.stderr.includes('"target":"rag","discoveryEngine":"glob"'),
    "正常包的 Code RAG 错误进入 glob fallback。",
  )
  return status
})

await check("IDX-01A", "文件发现、全部 C/C++ 后缀与越界隔离", async () => {
  const expected = [
    ["QA_CHINESE_PATH_7001", "src/中文 文件.c"],
    ["QA_HIDDEN_PATH_7002", ".hidden/hidden.c"],
    ["QA_C_HEADER_7005", "include/all.h"],
    ["QA_HH_HEADER_7006", "include/all.hh"],
    ["QA_CC_CONDITIONAL_7007", "src/all.cc"],
  ]
  const rows = []
  for (const [query, file] of expected) {
    const graph = await main.call("queryEvidence", {
      query,
      retrievalMode: "graph-only",
      maxEvidenceItems: 8,
    })
    verify(graph.evidenceRefs.some((item) => item.filePath.endsWith(file)), `${query} 未命中 ${file}。`)
    rows.push({ query, file, evidence: graph.evidenceRefs })
  }
  for (const [query, file] of [
    ["QA_IGNORED_7003", "ignored.c"],
    ["QA_SYMLINK_ESCAPE_7004", "src/escape.c"],
  ]) {
    const graph = await main.call("queryEvidence", {
      query,
      retrievalMode: "graph-only",
      maxEvidenceItems: 8,
    })
    const rag = await main.call("search", { query })
    verify(!graph.evidenceRefs.some((item) => item.filePath.endsWith(file)), `${query} 泄漏到 CodeGraph。`)
    verify(!rag.some((item) => item.payload?.filePath?.endsWith(file)), `${query} 泄漏到 Code RAG。`)
    rows.push({ query, file, blocked: true })
  }
  const broken = await main.call("queryEvidence", {
    query: "broken.c",
    retrievalMode: "graph-only",
    maxEvidenceItems: 8,
  })
  verify(
    broken.evidenceRefs.some((item) => item.filePath.endsWith("src/broken.c")),
    "损坏语法文件未以可降级文件证据进入 CodeGraph。",
  )
  rows.push({ query: "broken.c", file: "src/broken.c", degraded: true, evidence: broken.evidenceRefs })
  return rows
})

await check("IDX-01B", "CodeGraph 声明、调用、模板、重载、宏、重复符号与循环", async () => {
  const cases = [
    ["qa_entry_increment_value", ["src/main.cpp"]],
    ["qa_leaf_increment", ["src/main.cpp", "include/qa.hpp"]],
    ["qa_identity", ["include/qa.hpp"]],
    ["qa_overload", ["src/main.cpp"]],
    ["QA_LIMIT", ["include/qa.hpp"]],
    ["cycle_a", ["src/cycle.c"]],
    ["cycle_b", ["src/cycle.c"]],
    ["duplicate_symbol", ["src/duplicate_a.c", "src/duplicate_b.c"]],
  ]
  const rows = []
  for (const [query, files] of cases) {
    const graph = await main.call("queryEvidence", {
      query,
      retrievalMode: "graph-only",
      maxEvidenceItems: 12,
      maxPackChars: 8_000,
    })
    for (const file of files) {
      verify(graph.evidenceRefs.some((item) => item.filePath.endsWith(file)), `${query} 缺少 ${file} 图谱证据。`)
    }
    verify(
      graph.evidenceRefs.every((item) => item.startLine > 0 && item.endLine >= item.startLine),
      `${query} 返回无效行号。`,
    )
    rows.push({ query, evidence: graph.evidenceRefs })
  }
  return rows
})

await check("IDX-02", "Code RAG 精确、语义、中文与目录过滤", async () => {
  const exact = await main.call("search", { query: "qa_entry_increment_value" })
  const semantic = await main.call("search", { query: "函数负责递增输入值并返回结果" })
  const filtered = await main.call("search", { query: "qa_entry_increment_value", directoryPrefix: "src" })
  const duplicate = await main.call("search", { query: "duplicate_symbol" })
  const empty = await main.call("search", {
    query: "QA_NO_RESULT_MARKER_918273",
    directoryPrefix: "does-not-exist",
  })
  const outside = await main.call("search", { query: "qa_entry_increment_value", directoryPrefix: "../outside" })
  verify(exact[0]?.payload?.filePath?.endsWith("src/main.cpp"), "精确符号未在 Top-1 命中 src/main.cpp。")
  verify(
    semantic.slice(0, 3).some((item) => item.payload?.filePath?.endsWith("src/main.cpp")),
    "中文语义查询 Top-3 未命中 src/main.cpp。",
  )
  verify(
    filtered.every((item) => item.payload?.filePath === "src" || item.payload?.filePath?.startsWith("src/")),
    "目录过滤返回了 src 之外的结果。",
  )
  verify(
    ["src/duplicate_a.c", "src/duplicate_b.c"].every((file) =>
      duplicate.some((item) => item.payload?.filePath?.endsWith(file)),
    ),
    "重复 static 符号未保留两个文件的独立结果。",
  )
  verify(empty.length === 0, "不存在目录的查询返回了结果。")
  verify(outside.length === 0, "越界目录过滤未被拒绝。")
  return {
    exact: compact(exact),
    semantic: compact(semantic),
    filtered: compact(filtered),
    duplicate: compact(duplicate),
    empty,
    outside,
  }
})

await check("IDX-02Q", "40 条 C/C++ 质量基准、阈值扫描与独立重建稳定性", async () => {
  const first = await qualitySearch(main, benchmark)
  const sweep = Array.from({ length: 9 }, (_, index) => 0.2 + index * 0.05).map((threshold) =>
    qualityMetrics(first, benchmark, threshold),
  )
  const eligible = sweep
    .filter(
      (item) =>
        item.exactTop1 === 1 &&
        item.recall5 >= 0.95 &&
        item.englishRecall5 >= 0.9 &&
        item.chineseRecall5 >= 0.9 &&
        item.mrr10 >= 0.85 &&
        item.ndcg5 >= 0.85,
    )
    .sort((left, right) => right.ndcg5 - left.ndcg5 || right.f1 - left.f1)
  const selected = eligible[0]
  writeFileSync(join(evidence, "quality-threshold-sweep.json"), `${JSON.stringify({ sweep, first }, null, 2)}\n`)
  verify(selected, `没有阈值通过质量门禁：${JSON.stringify(sweep)}`)
  verify(selected.validLocations === 1, "检索结果存在无效路径或行号。")
  verify(selected.directEvidence >= 0.8, `一次检索直接获得 gold 证据比例不足：${selected.directEvidence}`)

  const coverage = await qualityCoverage(main, benchmark)
  verify(coverage.ratio === 1, `质量语料索引覆盖率不足：${coverage.hits}/${coverage.total}`)
  const primary = main.last()
  verify(primary.pipelines.rag.totalFiles > 0, "主索引没有发现任何 Code RAG 文件。")
  verify(
    primary.pipelines.rag.processedFiles === primary.pipelines.rag.totalFiles,
    `主索引文件处理覆盖率不足：${primary.pipelines.rag.processedFiles}/${primary.pipelines.rag.totalFiles}`,
  )
  verify(primary.pipelines.rag.errorCount === 0, `主索引存在 ${primary.pipelines.rag.errorCount} 个 batch error。`)

  const second = driver(fixture, "quality-rebuild")
  await second.init(
    config("quality-rebuild", {
      documents: { enabled: false, paths: ["."] },
      searchMinScore: selected.threshold,
    }),
  )
  const status = await second.complete({ documents: false, timeout: 180_000 })
  verify(status.pipelines.rag.errorCount === 0, `独立重建存在 ${status.pipelines.rag.errorCount} 个 batch error。`)
  const rebuilt = await qualitySearch(second, benchmark)
  const overlap = qualityOverlap(first, rebuilt, selected.threshold)
  await second.dispose()
  verify(overlap >= 0.95, `两次独立重建 Top-5 集合重合率不足：${overlap}`)

  const detail = {
    selected,
    sweep,
    coverage,
    processedCoverage: {
      processed: primary.pipelines.rag.processedFiles,
      total: primary.pipelines.rag.totalFiles,
      ratio: primary.pipelines.rag.processedFiles / primary.pipelines.rag.totalFiles,
    },
    overlap,
    failures: selected.failures,
  }
  writeFileSync(join(evidence, "quality-benchmark.json"), `${JSON.stringify(detail, null, 2)}\n`)
  return detail
})

await check("EMB-02", "固定维度请求与安全成功或拒绝路径", async () => {
  proxyState.mode = "pass"
  const workspace = await synth(join(output, "fixed-dimension"))
  const item = driver(workspace, "fixed-dimension")
  const offset = proxyState.requests.length
  await item.init(
    config("fixed-dimension", {
      dimensionMode: "fixed",
      modelDimension: dimension,
      documents: { enabled: false, paths: ["."] },
    }),
  )
  const status = await item.wait(
    (next) =>
      next.pipelines?.codeGraph.state === "Complete" &&
      (next.pipelines?.rag.state === "Complete" || next.pipelines?.rag.state === "Error"),
    180_000,
  )
  const requests = proxyState.requests.slice(offset)
  verify(
    requests.filter((entry) => entry.body.count > 0).every((entry) => entry.body.dimensions === dimension),
    "固定模式存在未发送 dimensions 的 embedding 请求。",
  )
  verify(status.pipelines.codeGraph.state === "Complete", "固定维度失败时 CodeGraph 未继续可用。")
  if (status.pipelines.rag.state === "Complete") {
    const found = await item.call("search", { query: "qa_entry_increment_value" })
    verify(found[0]?.payload?.filePath?.endsWith("src/main.cpp"), "固定维度成功后检索不正确。")
  } else {
    verify(
      /dimension|维度|request|请求|unsupported|不支持/i.test(JSON.stringify(status)),
      "服务拒绝固定维度时没有给出可诊断错误。",
    )
  }
  await item.dispose()
  return { status, requestCount: requests.length, dimensions: [...new Set(requests.map((entry) => entry.body.dimensions))] }
})

await check("EMB-03", "固定维度被拒绝、忽略或返回错维时安全失败", async () => {
  const rows = []
  const alternate = dimension === 4096 ? 1024 : 4096
  for (const mode of ["reject-dimensions", "ignore-dimensions", "wrong-dimension"]) {
    proxyState.mode = mode
    const workspace = await synth(join(output, `fixed-${mode}`))
    const item = driver(workspace, `fixed-${mode}`)
    await item.init(
      config(`fixed-${mode}`, {
        dimensionMode: "fixed",
        modelDimension: mode === "ignore-dimensions" ? alternate : dimension,
        documents: { enabled: false, paths: ["."] },
      }),
    )
    const status = await item.error(90_000)
    verify(status.pipelines.codeGraph.state === "Complete", `${mode} 失败时 CodeGraph 未继续可用。`)
    verify(status.pipelines.rag.state === "Error", `${mode} 未阻止不兼容的向量索引。`)
    rows.push({ mode, status })
    await item.dispose()
  }
  proxyState.mode = "pass"
  return rows
})

await check("EMB-04", "1024/4096 自动维度切换均建立匹配 schema", async () => {
  const rows = []
  for (const target of [1024, 4096]) {
    proxyState.mode = `dimension-${target}`
    const workspace = await synth(join(output, `dimension-${target}`))
    const item = driver(workspace, `dimension-${target}`)
    await item.init(config(`dimension-${target}`, { documents: { enabled: false, paths: ["."] } }))
    const status = await item.complete({ documents: false, timeout: 180_000 })
    const found = await item.call("search", { query: "qa_entry_increment_value" })
    verify(found[0]?.payload?.filePath?.endsWith("src/main.cpp"), `${target} 维索引检索不正确。`)
    rows.push({ target, status, found: compact(found) })
    await item.dispose()
  }
  proxyState.mode = "pass"
  return rows
})

await check("EMB-05", "补零、塌缩、非有限值与运行中漂移均在写库前停止", async () => {
  const rows = []
  for (const mode of ["padding", "collapse", "nonfinite", "drift"]) {
    proxyState.mode = mode
    proxyState.switchAt = mode === "drift" ? proxyState.count + 4 : Number.POSITIVE_INFINITY
    const workspace = await synth(join(output, `quality-${mode}`))
    const item = driver(workspace, `quality-${mode}`)
    await item.init(config(`quality-${mode}`, { documents: { enabled: false, paths: ["."] } }))
    const status = await item.error(120_000)
    verify(status.pipelines.codeGraph.state === "Complete", `${mode} 失败时 CodeGraph 未继续可用。`)
    verify(status.pipelines.rag.state === "Error", `${mode} 未阻止低质量向量索引。`)
    rows.push({ mode, status })
    await item.dispose()
  }
  proxyState.mode = "pass"
  proxyState.switchAt = Number.POSITIVE_INFINITY
  return rows
})

await check("IDX-03", "codebase_analysis graph-only、hybrid 与证据预算", async () => {
  const before = proxyState.count
  const graph = await main.call("queryEvidence", {
    query: "who calls qa_entry_increment_value",
    retrievalMode: "graph-only",
    maxEvidenceItems: 4,
    maxPackChars: 1600,
  })
  const after = proxyState.count
  const hybrid = await main.call("queryEvidence", {
    query: "increment input and return result",
    retrievalMode: "hybrid",
    maxEvidenceItems: 1,
    maxPackChars: 500,
  })
  verify(after === before, `graph-only 触发了 ${after - before} 次 embedding 请求。`)
  verify(graph.trace.stages.find((stage) => stage.name === "vector")?.reason === "graph-only", "vector 阶段未跳过。")
  verify(graph.evidenceRefs.length > 0, "graph-only 未返回源码证据。")
  verify(
    graph.evidenceRefs.every((item) => item.filePath && item.startLine > 0 && item.endLine >= item.startLine),
    "graph-only 证据缺少路径或有效行号。",
  )
  verify(hybrid.evidenceRefs.length <= 1, "hybrid 超出 maxEvidenceItems=1。")
  verify(hybrid.formattedPackText.length <= 500, "hybrid 超出 maxPackChars=500。")
  return {
    graphOnlyEmbeddingRequests: after - before,
    graphEvidence: graph.evidenceRefs,
    hybridEvidence: hybrid.evidenceRefs,
    hybridDropped: hybrid.droppedByBudget,
  }
})

await check("IDX-04", "Document RAG 多格式、引用与 PDF 缺依赖降级", async () => {
  const cases = [
    ["唯一航标赤铜海燕索引验收", "docs/索引验收.md"],
    ["DOCMARK_TXT_7430", "docs/notes.txt"],
    ["DOCMARK_RST_7431", "docs/guide.rst"],
    ["DOCMARK_CSV_7432", "docs/table.csv"],
    ["DOCMARK_TSV_7433", "docs/table.tsv"],
    ["DOCMARK_DOCX_7435", "docs/fixture.docx"],
    ["DOCMARK_XLSX_7436", "docs/fixture.xlsx"],
    ["DOCMARK_ODS_7437", "docs/fixture.ods"],
  ]
  const rows = []
  for (const [query, file] of cases) {
    const found = await main.call("documentSearch", { query, maxResults: 8 })
    verify(found[0]?.filePath?.endsWith(file), `${query} 未在 Top-1 命中 ${file}。`)
    verify(found.every((item) => item.sourceRef && item.filePath), `${query} 结果缺少来源引用。`)
    rows.push({ query, file, top: found[0] })
  }
  const pdftotext = command("pdftotext")
  const status = main.last()
  verify(status.pipelines.documents.skippedCount >= 4, "旧 Office 格式未计入 skipped。")
  if (!pdftotext) {
    verify(status.pipelines.documents.state === "Complete", "缺少 pdftotext 时 Document RAG 未完成。")
    verify(status.pipelines.documents.errorCount > 0, "缺少 pdftotext 时未记录可诊断的 PDF 错误。")
  }
  return { formats: rows, skipped: status.pipelines.documents.skippedCount, pdftotext: pdftotext || "未安装，按计划降级" }
})

await check("LIFE-00", "相同配置与非重建参数不得触发任何索引流水线", async () => {
  const before = await snapshot(main)
  const count = proxyState.count
  const offset = main.events.length
  const tuned = structuredClone(cfg)
  tuned.searchMinScore = 0.2
  tuned.searchMaxResults = 20
  tuned.embeddingBatchSize = 8
  tuned.scannerMaxBatchRetries = 5

  await main.call("updateConfig", structuredClone(cfg))
  await main.call("updateConfig", structuredClone(cfg))
  await main.call("updateConfig", tuned)
  await main.call("updateConfig", structuredClone(cfg))
  await Bun.sleep(750)

  const after = await snapshot(main)
  const statuses = main.events.slice(offset).filter((item) => item.event === "status").map((item) => item.data)
  verify(after.sha === before.sha, "相同/搜索配置更新改写了 CodeGraph manifest。")
  verify(after.generation === before.generation, "相同/搜索配置更新改变了 CodeGraph generation。")
  verify(after.lastFullScanAt === before.lastFullScanAt, "相同/搜索配置更新触发了 CodeGraph 全量扫描。")
  verify(proxyState.count === count, "相同/搜索配置更新触发了 embedding 请求。")
  verify(
    !statuses.some(
      (item) => item.state === "In Progress" || item.pipelines?.codeGraph?.state === "In Progress" || item.pipelines?.rag?.state === "In Progress",
    ),
    "相同/搜索配置更新产生了索引 In Progress 状态。",
  )
  return { before, after, embeddingRequests: proxyState.count - count, statusEvents: statuses }
})

await check("LIFE-01", "仅 Document RAG 配置变化不得扫描 CodeGraph 或 Code RAG", async () => {
  const before = await snapshot(main)
  const offset = main.events.length
  const count = main.statuses.length
  const docs = structuredClone(cfg)
  docs.documents.include = ["**/*.md"]
  await main.call("updateConfig", docs)
  const narrowed = await main.after(
    count,
    (item) => item.pipelines?.documents?.state === "Complete" && item.pipelines?.documents?.validFileCount === 1,
  )
  const middle = await snapshot(main)
  const restore = main.statuses.length
  await main.call("updateConfig", structuredClone(cfg))
  await main.after(
    restore,
    (item) => item.pipelines?.documents?.state === "Complete" && item.pipelines?.documents?.validFileCount >= 8,
  )
  const after = await snapshot(main)
  const statuses = main.events.slice(offset).filter((item) => item.event === "status").map((item) => item.data)

  verify(middle.sha === before.sha && after.sha === before.sha, "Document RAG 配置变化改写了 CodeGraph。")
  verify(middle.generation === before.generation && after.generation === before.generation, "Document RAG 变化改变了图谱 generation。")
  verify(
    !statuses.some(
      (item) => item.pipelines?.codeGraph?.state === "In Progress" || item.pipelines?.rag?.state === "In Progress",
    ),
    "Document RAG 配置变化错误触发 CodeGraph 或 Code RAG。",
  )
  return { narrowed, restored: main.last(), before, middle, after }
})

await check("LIFE-02", "Code RAG 关闭时相同与无关配置不得重建 CodeGraph", async () => {
  const workspace = await synth(join(output, "disabled-rag"))
  const item = driver(workspace, "disabled-rag")
  const disabled = config("disabled-rag", {
    enabled: false,
    documents: { enabled: false, paths: ["."] },
  })
  await item.init(disabled)
  await item.wait(
    (status) =>
      status.pipelines?.codeGraph?.state === "Complete" && status.pipelines?.rag?.state === "Disabled",
    120_000,
  )
  const before = await snapshot(item)
  const count = proxyState.count
  const offset = item.events.length
  const tuned = structuredClone(disabled)
  tuned.searchMinScore = 0.7

  await item.call("updateConfig", structuredClone(disabled))
  await item.call("updateConfig", tuned)
  await item.call("updateConfig", structuredClone(disabled))
  await Bun.sleep(750)

  const after = await snapshot(item)
  const statuses = item.events.slice(offset).filter((event) => event.event === "status").map((event) => event.data)
  verify(after.sha === before.sha, "Code RAG 关闭时无关配置改写了 CodeGraph manifest。")
  verify(after.generation === before.generation, "Code RAG 关闭时无关配置改变了 CodeGraph generation。")
  verify(after.lastFullScanAt === before.lastFullScanAt, "Code RAG 关闭时无关配置触发全量扫描。")
  verify(proxyState.count === count, "Code RAG 关闭时无关配置请求了 embedding。")
  verify(
    !statuses.some((status) => status.pipelines?.codeGraph?.state === "In Progress"),
    "Code RAG 关闭时无关配置使 CodeGraph 进入 In Progress。",
  )
  await item.dispose()
  return { before, after, embeddingRequests: proxyState.count - count, statusEvents: statuses }
})

await check("LIFE-03", "embedding 配置变化仅做一次图谱一致性扫描且复用全部图谱", async () => {
  const before = await snapshot(main)
  const count = proxyState.count
  const statuses = main.statuses.length
  const offset = main.stderr.length
  const changed = structuredClone(cfg)
  changed.openAiCompatibleBaseUrl = `${proxyUrl}?profile=changed`

  await main.call("updateConfig", changed)
  await main.after(
    statuses,
    (item) => item.state === "In Progress" || item.pipelines?.codeGraph?.state === "In Progress",
    60_000,
  )
  const status = await main.after(
    statuses,
    (item) =>
      item.state === "Complete" &&
      item.pipelines?.codeGraph?.state === "Complete" &&
      item.pipelines?.rag?.state === "Complete" &&
      item.pipelines?.documents?.state === "Complete",
    180_000,
  )
  const after = await snapshot(main)
  const logs = main.stderr
    .slice(offset)
    .split(/\r?\n/)
    .filter((line) => line.includes("code graph scan performance summary"))

  verify(after.lastFullScanAt !== before.lastFullScanAt, "embedding 配置变化未执行预期的一致性扫描。")
  verify(after.records === before.records, "embedding 配置变化改变了 CodeGraph 记录内容。")
  verify(logs.length === 1, `embedding 配置变化触发了 ${logs.length} 次图谱扫描，预期 1 次。`)
  verify(logs[0].includes('"parsed":0'), "embedding 配置变化重新解析了未修改的 CodeGraph 文件。")
  verify(logs[0].includes('"reused":'), "一致性扫描没有记录图谱复用数量。")
  verify(proxyState.count > count, "embedding 配置变化未重建 Code RAG。")
  return {
    status,
    before,
    after,
    graphScanSummaries: logs,
    embeddingRequests: proxyState.count - count,
  }
})

await check("IDX-05", "watcher 增量创建、修改、重命名与删除", async () => {
  const src = join(fixture, "src", "incremental.cpp")
  writeFileSync(src, "int QA_INCREMENTAL_CREATE_9017(void) { return 9017; }\n")
  const created = await main.poll("QA_INCREMENTAL_CREATE_9017", (items) =>
    items.some((item) => item.payload?.filePath?.endsWith("src/incremental.cpp")),
  )
  writeFileSync(src, "int QA_INCREMENTAL_MODIFY_9018(void) { return 9018; }\n")
  const modified = await main.poll("QA_INCREMENTAL_MODIFY_9018", (items) =>
    items.some((item) => item.payload?.filePath?.endsWith("src/incremental.cpp")),
  )
  const renamed = join(fixture, "src", "renamed.cpp")
  renameSync(src, renamed)
  const moved = await main.poll("QA_INCREMENTAL_MODIFY_9018", (items) =>
    items.some((item) => item.payload?.filePath?.endsWith("src/renamed.cpp")),
  )
  rmSync(renamed)
  await main.poll(
    "QA_INCREMENTAL_MODIFY_9018",
    (items) => items.every((item) => !item.payload?.filePath?.endsWith("src/renamed.cpp")),
  )
  return { created: compact(created), modified: compact(modified), renamed: compact(moved), deleted: true }
})

await check("IDX-06", "Document RAG 手动重建覆盖增删改重命名", async () => {
  const first = join(fixture, "docs", "incremental.md")
  writeFileSync(first, "# 文档增量\n\nDOC_INCREMENT_CREATE_8101\n")
  await main.call("rebuildDocuments", undefined)
  const created = await main.call("documentSearch", { query: "DOC_INCREMENT_CREATE_8101", maxResults: 3 })
  verify(created[0]?.filePath?.endsWith("docs/incremental.md"), "新增文档未被手动重建拾取。")
  writeFileSync(first, "# 文档增量\n\nDOC_INCREMENT_MODIFY_8102\n")
  await main.call("rebuildDocuments", undefined)
  const modified = await main.call("documentSearch", { query: "DOC_INCREMENT_MODIFY_8102", maxResults: 3 })
  verify(modified[0]?.filePath?.endsWith("docs/incremental.md"), "修改文档未被手动重建拾取。")
  const second = join(fixture, "docs", "renamed.md")
  renameSync(first, second)
  await main.call("rebuildDocuments", undefined)
  const renamed = await main.call("documentSearch", { query: "DOC_INCREMENT_MODIFY_8102", maxResults: 3 })
  verify(renamed[0]?.filePath?.endsWith("docs/renamed.md"), "重命名文档未被手动重建拾取。")
  rmSync(second)
  await main.call("rebuildDocuments", undefined)
  const removed = await main.call("documentSearch", { query: "DOC_INCREMENT_MODIFY_8102", maxResults: 8 })
  verify(removed.every((item) => !item.filePath.endsWith("docs/renamed.md")), "删除文档仍残留在检索结果中。")
  return { created: created[0], modified: modified[0], renamed: renamed[0], deleted: true }
})

await check("DOC-01", "外部文档必须显式批准且批准后不触发 CodeGraph/RAG", async () => {
  const workspace = await synth(join(output, "external-doc-workspace"))
  const external = await mkdtemp(join(tmpdir(), "chipmate-external-doc-"))
  writeFileSync(join(workspace, "docs", "shared.md"), "# 本地同名文档\n\nDOC_LOCAL_SHARED_8201\n")
  writeFileSync(join(external, "shared.md"), "# 外部同名文档\n\nDOC_EXTERNAL_APPROVED_8202\n")
  const item = driver(workspace, "external-doc")
  const blocked = config("external-doc", {
    documents: { enabled: true, paths: [".", external] },
  })
  await item.init(blocked)
  const denied = await item.wait(
    (status) =>
      status.pipelines?.codeGraph?.state === "Complete" &&
      status.pipelines?.rag?.state === "Complete" &&
      status.pipelines?.documents?.state === "Error",
    120_000,
  )
  verify(
    JSON.stringify(denied).includes("external document path is not approved"),
    "未批准外部文档没有给出明确诊断。",
  )
  const before = await snapshot(item)
  const index = item.statuses.length
  const approved = structuredClone(blocked)
  approved.documents.approvedExternalRoots = [{ path: external, workspace }]
  await item.call("updateConfig", approved)
  const complete = await item.after(
    index,
    (status) => status.pipelines?.documents?.state === "Complete",
    120_000,
  )
  const found = await item.call("documentSearch", { query: "DOC_EXTERNAL_APPROVED_8202", maxResults: 5 })
  const local = await item.call("documentSearch", { query: "DOC_LOCAL_SHARED_8201", maxResults: 5 })
  const after = await snapshot(item)
  verify(found[0]?.filePath?.includes("shared.md"), "批准后的外部文档未在 Top-1 命中。")
  verify(found[0]?.sourceRef, "外部文档缺少来源引用。")
  verify(local[0]?.filePath?.endsWith("docs/shared.md"), "同名本地文档来源错误。")
  verify(after.sha === before.sha, "外部文档批准错误触发 CodeGraph 重建。")
  await item.dispose()
  return { denied, complete, external: found[0], local: local[0], graph: { before, after } }
})

await check("ERR-01", "embedding 429、500、非法 JSON、空 data 与超时诊断", async () => {
  const rows = []
  for (const mode of ["429", "500", "invalid", "empty", "timeout"]) {
    proxyState.mode = mode
    const workspace = await synth(join(output, `fault-${mode}`))
    const item = driver(workspace, `fault-${mode}`)
    await item.init(config(`fault-${mode}`, { documents: { enabled: false, paths: ["."] } }))
    const status = await item.error(mode === "timeout" ? 120_000 : 90_000)
    verify(status.state === "Error", `${mode} 未进入可诊断 Error 状态。`)
    verify(JSON.stringify(status).length > 80, `${mode} 错误诊断为空。`)
    rows.push({ mode, message: status.message, rag: status.pipelines?.rag })
    await item.dispose()
  }
  proxyState.mode = "pass"
  return rows
})

await check("ERR-02", "embedding 服务恢复后一次配置重建完成", async () => {
  proxyState.mode = "500"
  const workspace = await synth(join(output, "service-recovery"))
  const item = driver(workspace, "service-recovery")
  await item.init(config("service-recovery", { documents: { enabled: false, paths: ["."] } }))
  const failed = await item.error(90_000)
  proxyState.mode = "pass"
  const recoveredCfg = config("service-recovery", {
    openAiCompatibleBaseUrl: `${proxyUrl}?recovered=1`,
    documents: { enabled: false, paths: ["."] },
  })
  await item.call("updateConfig", recoveredCfg)
  const recovered = await item.complete({ documents: false, timeout: 120_000 })
  await item.dispose()
  return { failed, recovered }
})

await check("ERR-03", "连接拒绝不影响 worker 释放与重建", async () => {
  proxyState.mode = "pass"
  const workspace = await synth(join(output, "connection-refused"))
  const item = driver(workspace, "connection-refused")
  await item.init(
    config("connection-refused", {
      openAiCompatibleBaseUrl: "http://127.0.0.1:1/v1/embeddings",
      documents: { enabled: false, paths: ["."] },
    }),
  )
  const failed = await item.error(90_000)
  await item.dispose()
  const next = driver(workspace, "connection-refused-rebuilt")
  await next.init(config("connection-refused-rebuilt", { documents: { enabled: false, paths: ["."] } }))
  const recovered = await next.complete({ documents: false, timeout: 120_000 })
  await next.dispose()
  return { failed, recovered }
})

await check("ERR-04", "中途杀死 indexer 后清理陈旧状态并恢复检索", async () => {
  proxyState.mode = "timeout"
  const workspace = await synth(join(output, "process-crash"))
  const item = driver(workspace, "process-crash")
  const count = proxyState.count
  await item.init(config("process-crash", { documents: { enabled: false, paths: ["."] } }))
  const started = Date.now()
  while (proxyState.count === count && Date.now() - started < 30_000) await Bun.sleep(100)
  verify(proxyState.count > count, "indexer 未进入 embedding 阶段，无法执行中途终止验证。")
  const crashed = await item.crash()
  verify(crashed.signal === "SIGKILL", `indexer 未按预期被 SIGKILL：${JSON.stringify(crashed)}`)

  proxyState.mode = "pass"
  const next = driver(workspace, "process-crash")
  await next.init(config("process-crash", { documents: { enabled: false, paths: ["."] } }))
  const recovered = await next.complete({ documents: false, timeout: 120_000 })
  const exact = await next.call("search", { query: "qa_entry_increment_value" })
  verify(exact[0]?.payload?.filePath?.endsWith("src/main.cpp"), "indexer 崩溃恢复后精确检索不正确。")
  await next.dispose()
  return { crashed, recovered, exact: compact(exact) }
})

await check("LIFE-04", "兼容配置热启动复用索引", async () => {
  proxyState.mode = "pass"
  await main.dispose()
  const warm = driver(fixture, "synthetic-warm")
  const before = proxyState.count
  await warm.init(cfg)
  const status = await warm.complete({ documents: true })
  const exact = await warm.call("search", { query: "qa_entry_increment_value" })
  verify(exact[0]?.payload?.filePath?.endsWith("src/main.cpp"), "热启动后检索不正确。")
  await warm.dispose()
  return { status, additionalEmbeddingRequests: proxyState.count - before, exact: compact(exact) }
})

await check("WT-00", "非 Git、primary 根目录与普通子目录绝不等待 baseline", async () => {
  proxyState.mode = "pass"
  const plain = join(output, "standalone")
  mkdirSync(join(plain, "src"), { recursive: true })
  writeFileSync(join(plain, "src", "plain.c"), "int QA_STANDALONE_5401(void) { return 5401; }\n")
  const primary = await synth(join(output, "primary-classification"))
  const cases = [
    [plain, "standalone-classification"],
    [primary, "primary-root-classification"],
    [join(primary, "src"), "primary-subdir-classification"],
  ]
  const rows = []
  for (const [workspace, id] of cases) {
    const item = driver(workspace, id)
    const initial = await item.init(config(id, { documents: { enabled: false, paths: ["."] } }))
    verify(!/primary worktree index/i.test(initial.message ?? ""), `${id} 被错误判定为 linked worktree。`)
    const status = await item.complete({ documents: false, timeout: 120_000 })
    verify(!item.stderr.includes("Waiting for the primary worktree index"), `${id} 日志出现 baseline 等待。`)
    rows.push({ id, initial, status })
    await item.dispose()
  }
  return rows
})

await check("WT-01", "linked worktree 等待、恢复、overlay 增删改与双 worktree 隔离", async () => {
  proxyState.mode = "pass"
  const primary = join(output, "worktree-primary")
  const linked = join(output, "worktree-linked")
  mkdirSync(primary, { recursive: true })
  execFileSync("git", ["init", "-b", "main"], { cwd: primary })
  execFileSync("git", ["config", "user.email", "qa@chipmate.invalid"], { cwd: primary })
  execFileSync("git", ["config", "user.name", "ChipMate QA"], { cwd: primary })
  writeFileSync(
    join(primary, "main.c"),
    [
      "#include <stddef.h>",
      "static int qa_primary_sum(const int *values, size_t count)",
      "{",
      "  int total = 0;",
      "  for (size_t index = 0; index < count; ++index) total += values[index];",
      "  return total;",
      "}",
      "int QA_WORKTREE_PRIMARY_5501(void)",
      "{",
      "  const int values[] = { 1000, 2000, 2000, 501 };",
      "  return qa_primary_sum(values, sizeof(values) / sizeof(values[0]));",
      "}",
      "",
    ].join("\n"),
  )
  execFileSync("git", ["add", "."], { cwd: primary })
  execFileSync("git", ["commit", "-m", "qa"], { cwd: primary })
  execFileSync("git", ["worktree", "add", "-b", "qa-linked", linked], { cwd: primary })
  writeFileSync(
    join(linked, "overlay.c"),
    [
      "#include <stddef.h>",
      "static int qa_overlay_sum(const int *values, size_t count)",
      "{",
      "  int total = 0;",
      "  for (size_t index = 0; index < count; ++index) total += values[index];",
      "  return total;",
      "}",
      "int QA_WORKTREE_OVERLAY_5502(void)",
      "{",
      "  const int values[] = { 1000, 2000, 2000, 502 };",
      "  return qa_overlay_sum(values, sizeof(values) / sizeof(values[0]));",
      "}",
      "",
    ].join("\n"),
  )

  const shared = config("worktree-shared", { documents: { enabled: false, paths: ["."] } })
  const child = driver(linked, "worktree-linked")
  const before = proxyState.count
  const waiting = await child.init(shared, primary)
  verify(waiting.state === "Standby", "primary 未就绪时 linked worktree 未进入 Standby。")
  verify(/primary worktree index/i.test(waiting.message), "linked worktree 等待诊断不明确。")
  verify(proxyState.count === before, "primary 未就绪时 linked worktree 提前请求 embedding。")

  const base = driver(primary, "worktree-primary")
  await base.init(shared)
  await base.complete({ documents: false, timeout: 120_000 })
  const resumed = await child.complete({ documents: false, timeout: 120_000 })
  const overlay = await child.call("queryEvidence", {
    query: "QA_WORKTREE_OVERLAY_5502",
    retrievalMode: "graph-only",
  })
  verify(overlay.evidenceRefs.some((item) => item.filePath.endsWith("overlay.c")), "linked overlay 未进入图谱证据。")
  const baseline = await child.call("queryEvidence", {
    query: "QA_WORKTREE_PRIMARY_5501",
    retrievalMode: "graph-only",
  })
  verify(baseline.evidenceRefs.some((item) => item.filePath.endsWith("main.c")), "linked worktree 未复用 primary 图谱。")

  writeFileSync(join(linked, "overlay.c"), "int QA_WORKTREE_OVERLAY_MODIFIED_5503(void) { return 5503; }\n")
  const modified = await child.pollEvidence("QA_WORKTREE_OVERLAY_MODIFIED_5503", (item) =>
    item.evidenceRefs.some((entry) => entry.filePath.endsWith("overlay.c")),
  )
  rmSync(join(linked, "overlay.c"))
  await child.pollEvidence("QA_WORKTREE_OVERLAY_MODIFIED_5503", (item) =>
    item.evidenceRefs.every((entry) => !entry.filePath.endsWith("overlay.c")),
  )
  writeFileSync(join(linked, "overlay.c"), "int QA_WORKTREE_OVERLAY_RESTORED_5504(void) { return 5504; }\n")
  const restored = await child.pollEvidence("QA_WORKTREE_OVERLAY_RESTORED_5504", (item) =>
    item.evidenceRefs.some((entry) => entry.filePath.endsWith("overlay.c")),
  )

  const original = readFileSync(join(linked, "main.c"), "utf8")
  rmSync(join(linked, "main.c"))
  await child.pollEvidence("QA_WORKTREE_PRIMARY_5501", (item) =>
    item.evidenceRefs.every((entry) => !entry.filePath.endsWith("main.c")),
  )
  writeFileSync(join(linked, "main.c"), original)
  const visible = await child.pollEvidence("QA_WORKTREE_PRIMARY_5501", (item) =>
    item.evidenceRefs.some((entry) => entry.filePath.endsWith("main.c")),
  )

  const linked2 = join(output, "worktree-linked-2")
  execFileSync("git", ["worktree", "add", "-b", "qa-linked-2", linked2], { cwd: primary })
  writeFileSync(join(linked2, "overlay.c"), "int QA_WORKTREE_SECOND_5505(void) { return 5505; }\n")
  const second = driver(linked2, "worktree-linked-2")
  await second.init(shared, primary)
  await second.complete({ documents: false, timeout: 120_000 })
  const secondOwn = await second.pollEvidence("QA_WORKTREE_SECOND_5505", (item) =>
    item.evidenceRefs.some((entry) => entry.filePath.endsWith("overlay.c")),
  )
  const firstLeak = await child.call("queryEvidence", {
    query: "QA_WORKTREE_SECOND_5505",
    retrievalMode: "graph-only",
  })
  const secondLeak = await second.call("queryEvidence", {
    query: "QA_WORKTREE_OVERLAY_RESTORED_5504",
    retrievalMode: "graph-only",
  })
  verify(
    !firstLeak.evidenceRefs.some((item) => JSON.stringify(item).includes("QA_WORKTREE_SECOND_5505")),
    "第二 worktree 泄漏到第一 worktree。",
  )
  verify(
    !secondLeak.evidenceRefs.some((item) => JSON.stringify(item).includes("QA_WORKTREE_OVERLAY_RESTORED_5504")),
    "第一 worktree 泄漏到第二 worktree。",
  )
  await Promise.all([child.dispose(), second.dispose(), base.dispose()])
  return {
    waiting,
    resumed,
    overlay: overlay.evidenceRefs,
    baseline: baseline.evidenceRefs,
    modified: modified.evidenceRefs,
    restored: restored.evidenceRefs,
    baselineRestored: visible.evidenceRefs,
    second: secondOwn.evidenceRefs,
  }
})

await check("ISO-01", "同名符号与同名文档跨 workspace 零串库", async () => {
  proxyState.mode = "pass"
  const left = await isolated(join(output, "isolation-left"), "LEFT_ONLY_6611")
  const right = await isolated(join(output, "isolation-right"), "RIGHT_ONLY_6612")
  const first = driver(left, "isolation-left")
  const second = driver(right, "isolation-right")
  await first.init(config("isolation-shared", { documents: { enabled: true, paths: ["."] } }))
  await second.init(config("isolation-shared", { documents: { enabled: true, paths: ["."] } }))
  await Promise.all([first.complete({ documents: true }), second.complete({ documents: true })])
  const leftCode = await first.call("search", { query: "SHARED_SYMBOL LEFT_ONLY_6611" })
  const rightCode = await second.call("search", { query: "SHARED_SYMBOL RIGHT_ONLY_6612" })
  const leftDoc = await first.call("documentSearch", { query: "LEFT_ONLY_6611", maxResults: 8 })
  const rightDoc = await second.call("documentSearch", { query: "RIGHT_ONLY_6612", maxResults: 8 })
  verify(leftCode.every((item) => !item.payload?.codeChunk?.includes("RIGHT_ONLY_6612")), "左 workspace 串入右代码。")
  verify(rightCode.every((item) => !item.payload?.codeChunk?.includes("LEFT_ONLY_6611")), "右 workspace 串入左代码。")
  verify(leftDoc.every((item) => !item.content.includes("RIGHT_ONLY_6612")), "左 workspace 串入右文档。")
  verify(rightDoc.every((item) => !item.content.includes("LEFT_ONLY_6611")), "右 workspace 串入左文档。")
  await Promise.all([first.dispose(), second.dispose()])
  return { leftCode: compact(leftCode), rightCode: compact(rightCode), leftDoc, rightDoc }
})

await check("REAL-01", "GreedyFTL 33 个 C/H 真实项目固定召回", async () => {
  proxyState.mode = "pass"
  const workspace = resolve(
    argv.real ??
      "/Users/archer/Work/cosmos-plus-openssd/project/Prebuild/8Ch8Way-3.0.0/GreedyFTL-3.0.0",
  )
  verify(existsSync(workspace), `真实项目不存在：${workspace}`)
  const count = Number(
    execFileSync("sh", ["-lc", "find . -type f \\( -name '*.c' -o -name '*.h' \\) | wc -l"], {
      cwd: workspace,
      encoding: "utf8",
    }).trim(),
  )
  verify(count === 33, `真实项目 C/H 文件数不是 33：${count}`)
  const item = driver(workspace, "greedy-ftl")
  await item.init(config("greedy-ftl", { documents: { enabled: false, paths: ["."] } }))
  const status = await item.complete({ documents: false, timeout: 180_000 })
  const expected = [
    ["InitFTL", "ftl_config.c"],
    ["GarbageCollection", "garbage_collection.c"],
    ["V2FReadPageTriggerAsync", "nsc_driver.c"],
  ]
  const rows = []
  for (const [query, file] of expected) {
    const search = await item.call("search", { query })
    const graph = await item.call("queryEvidence", { query, retrievalMode: "graph-only", maxEvidenceItems: 6 })
    verify(search[0]?.payload?.filePath?.endsWith(file), `${query} Code RAG Top-1 未命中 ${file}。`)
    verify(graph.evidenceRefs.some((entry) => entry.filePath.endsWith(file)), `${query} CodeGraph 未命中 ${file}。`)
    rows.push({ query, search: compact(search.slice(0, 3)), graph: graph.evidenceRefs })
  }
  await item.dispose()
  return { count, status, queries: rows }
})

proxy.stop(true)
await Promise.all(drivers.map((item) => item.dispose().catch(() => undefined)))
writeFileSync(join(evidence, "embedding-proxy-requests.json"), `${JSON.stringify(proxyState.requests, null, 2)}\n`)

const report = {
  生成时间: new Date().toISOString(),
  平台: `${process.platform}-${process.arch}`,
  版本: manifest.version,
  VSIX: vsix,
  SHA256: sha(vsix),
  embedding: { endpointDigest: endpointHash, model, dimension, mode: "auto", protocol: protocol.detail },
  汇总: {
    通过: results.filter((item) => item.status === "PASS").length,
    失败: results.filter((item) => item.status === "FAIL").length,
    总数: results.length,
  },
  结果: results,
}
writeFileSync(join(output, "results.json"), `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(join(output, "索引验收报告.md"), markdown(report))
process.stdout.write(
  `${JSON.stringify(
    {
      status: report.汇总.失败 === 0 ? "PASS" : "FAIL",
      report: join(output, "索引验收报告.md"),
      raw: join(output, "results.json"),
      evidence,
    },
    null,
    2,
  )}\n`,
)
if (report.汇总.失败 > 0) process.exitCode = 1

function driver(workspace, id) {
  const item = new Driver({
    id,
    workspace,
    root: cache,
    indexer,
    lancedb,
    env: {
      CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
      CHIPMATE_RIPGREP_PATH: rg,
      CHIPMATE_TREE_SITTER_WASM_DIR: join(bin, "tree-sitter"),
      CHIPMATE_CODEGRAPH_WORKER_CONCURRENCY: "2",
    },
  })
  drivers.push(item)
  return item
}

function config(id, overrides = {}) {
  return {
    enabled: true,
    embedderProvider: "openai-compatible",
    vectorStoreProvider: "lancedb",
    lancedbVectorStoreDirectory: join(cache, "vectors", id),
    modelId: model,
    dimensionMode: "auto",
    openAiCompatibleBaseUrl: proxyUrl,
    ...(apikey ? { openAiCompatibleApiKey: apikey } : {}),
    searchMinScore: 0,
    searchMaxResults: 10,
    embeddingBatchSize: 16,
    scannerMaxBatchRetries: 2,
    fileExtensions: [".c", ".h", ".cc", ".cpp", ".hpp", ".hh"],
    documents: {
      enabled: true,
      paths: ["."],
      maxFiles: 200,
      maxFileBytes: 2 * 1024 * 1024,
      maxExtractedBytesPerFile: 512 * 1024,
      chunkChars: 800,
      chunkOverlapChars: 100,
      searchMaxResults: 8,
    },
    ...overrides,
  }
}

class Driver {
  constructor(options) {
    this.id = options.id
    this.workspace = options.workspace
    this.root = options.root
    this.lancedb = options.lancedb
    this.seq = 0
    this.pending = new Map()
    this.statuses = []
    this.events = []
    this.transcript = []
    this.stderr = ""
    this.stopped = false
    this.child = spawn(options.indexer, [], {
      cwd: dirname(options.indexer),
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.lines.on("line", (line) => this.line(line))
    this.child.stderr.on("data", (chunk) => {
      this.stderr += String(chunk)
    })
    this.exit = new Promise((done) => this.child.once("exit", (code, signal) => done({ code, signal })))
    this.child.once("error", (err) => this.fail(err))
    this.child.once("exit", (code, signal) => {
      if (this.stopped) return
      this.fail(new Error(`chipmate-indexer 意外退出：code=${code} signal=${signal}`))
    })
  }

  line(line) {
    if (!line.startsWith(prefix)) {
      this.stderr += `${line}\n`
      return
    }
    const data = JSON.parse(line.slice(prefix.length))
    this.transcript.push({ time: new Date().toISOString(), direction: "receive", data: redact(data) })
    if (data.type === "event") {
      this.events.push(data)
      if (data.event === "status") this.statuses.push(data.data)
      return
    }
    const pending = this.pending.get(data.id)
    if (!pending) return
    this.pending.delete(data.id)
    clearTimeout(pending.timer)
    if (data.ok) {
      if (data.method === "init" || data.method === "updateConfig" || data.method === "rebuildDocuments") {
        this.statuses.push(data.value)
      }
      pending.resolve(data.value)
      return
    }
    pending.reject(new Error(data.error))
  }

  fail(err) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  call(method, input, timeout = 120_000) {
    const id = this.seq++
    const request = { type: "request", id, method, input }
    this.transcript.push({ time: new Date().toISOString(), direction: "send", data: redact(request) })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} IPC 请求超时。`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify(request)}\n`)
    })
  }

  init(input, baselineDirectory) {
    return this.call("init", {
      directory: this.workspace,
      root: this.root,
      config: input,
      baselineDirectory,
      lancedbPath: pathToFileURL(this.lancedb).href,
    })
  }

  last() {
    return this.statuses.at(-1)
  }

  async complete(options = {}) {
    const timeout = options.timeout ?? 120_000
    return this.wait((status) => {
      if (status.state === "Error") throw new Error(`索引进入 Error：${JSON.stringify(status)}`)
      if (status.state !== "Complete") return false
      if (status.pipelines?.codeGraph.state !== "Complete") return false
      if (status.pipelines?.rag.state !== "Complete") return false
      if (options.documents === false) return status.pipelines?.documents.state === "Disabled"
      return status.pipelines?.documents.state === "Complete"
    }, timeout)
  }

  async error(timeout = 90_000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const status = this.statuses.find((item) => item.state === "Error")
      if (status) return status
      await Bun.sleep(100)
    }
    throw new Error(`等待索引 Error 状态超时；最后状态：${JSON.stringify(this.last())}`)
  }

  async wait(predicate, timeout) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const status = this.last()
      if (status && predicate(status)) return status
      await Bun.sleep(100)
    }
    throw new Error(`等待索引状态超时；最后状态：${JSON.stringify(this.last())}`)
  }

  async after(index, predicate, timeout = 120_000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const status = this.statuses.slice(index).find((item) => predicate(item))
      if (status) return status
      await Bun.sleep(100)
    }
    throw new Error(`等待新的索引状态超时；最后状态：${JSON.stringify(this.last())}`)
  }

  async poll(query, predicate, timeout = 45_000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const items = await this.call("search", { query })
      if (predicate(items)) return items
      await Bun.sleep(500)
    }
    throw new Error(`等待增量检索超时：${query}`)
  }

  async pollEvidence(query, predicate, timeout = 45_000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const item = await this.call("queryEvidence", {
        query,
        retrievalMode: "graph-only",
        maxEvidenceItems: 12,
        maxPackChars: 8_000,
      })
      if (predicate(item)) return item
      await Bun.sleep(500)
    }
    throw new Error(`等待图谱增量证据超时：${query}`)
  }

  async dispose() {
    if (this.stopped) return
    this.stopped = true
    await this.call("dispose", undefined, 5_000).catch(() => undefined)
    this.child.stdin.end()
    const exit = await Promise.race([this.exit, Bun.sleep(5_000).then(() => undefined)])
    if (!exit) this.child.kill("SIGKILL")
    this.lines.close()
    const dir = join(evidence, this.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "ipc.json"), `${JSON.stringify(this.transcript, null, 2)}\n`)
    writeFileSync(join(dir, "stderr.log"), this.stderr)
    writeFileSync(join(dir, "statuses.json"), `${JSON.stringify(this.statuses, null, 2)}\n`)
  }

  async crash() {
    if (this.stopped) return this.exit
    this.stopped = true
    this.child.kill("SIGKILL")
    const result = await this.exit
    this.lines.close()
    return result
  }
}

async function synth(dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, "src"), { recursive: true })
  mkdirSync(join(dir, "include"), { recursive: true })
  mkdirSync(join(dir, "docs"), { recursive: true })
  mkdirSync(join(dir, "quality"), { recursive: true })
  mkdirSync(join(dir, ".hidden"), { recursive: true })
  writeFileSync(
    join(dir, "include", "qa.hpp"),
    [
      "#pragma once",
      "#define QA_LIMIT 42",
      "int qa_leaf_increment(int value);",
      "int qa_entry_increment_value(int value);",
      "template <typename T> T qa_identity(T value) { return value; }",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, "src", "main.cpp"),
    [
      '#include "../include/qa.hpp"',
      "int qa_leaf_increment(int value) { return value + 1; }",
      "int qa_entry_increment_value(int value) {",
      "  return qa_leaf_increment(qa_identity(value));",
      "}",
      "int qa_overload(int value) { return value; }",
      "double qa_overload(double value) { return value; }",
      "",
    ].join("\n"),
  )
  writeFileSync(join(dir, "src", "中文 文件.c"), "int QA_CHINESE_PATH_7001(void) { return QA_LIMIT; }\n")
  writeFileSync(join(dir, "include", "all.h"), "int QA_C_HEADER_7005(void);\n")
  writeFileSync(join(dir, "include", "all.hh"), "int QA_HH_HEADER_7006(void);\n")
  writeFileSync(
    join(dir, "src", "all.cc"),
    "#if defined(QA_FEATURE)\nint QA_CC_CONDITIONAL_7007(void) { return 7007; }\n#else\nint QA_CC_CONDITIONAL_7007(void) { return 0; }\n#endif\n",
  )
  writeFileSync(join(dir, "src", "duplicate_a.c"), "static int duplicate_symbol(void) { return 1; }\n")
  writeFileSync(join(dir, "src", "duplicate_b.c"), "static int duplicate_symbol(void) { return 2; }\n")
  writeFileSync(join(dir, "src", "cycle.c"), "int cycle_b(int); int cycle_a(int x) { return cycle_b(x); } int cycle_b(int x) { return x ? cycle_a(0) : 0; }\n")
  writeFileSync(join(dir, "src", "broken.c"), "int broken_syntax( { return 0;\n")
  writeFileSync(join(dir, "src", "zero.c"), "")
  writeQualityCorpus(dir, benchmark)
  writeFileSync(join(dir, ".hidden", "hidden.c"), "int QA_HIDDEN_PATH_7002(void) { return 7002; }\n")
  writeFileSync(join(dir, ".gitignore"), "ignored.c\n")
  writeFileSync(join(dir, "ignored.c"), "int QA_IGNORED_7003(void) { return 7003; }\n")
  writeFileSync(
    join(dir, "docs", "索引验收.md"),
    "# 索引验收\n\n唯一航标赤铜海燕索引验收 DOCMARK_INDEX_QA_7429\n".repeat(12),
  )
  writeFileSync(join(dir, "docs", "notes.txt"), "DOCMARK_TXT_7430 文本索引验收")
  writeFileSync(join(dir, "docs", "guide.rst"), "DOCMARK_RST_7431\n================")
  writeFileSync(join(dir, "docs", "table.csv"), "name,value\nDOCMARK_CSV_7432,42\n")
  writeFileSync(join(dir, "docs", "table.tsv"), "name\tvalue\nDOCMARK_TSV_7433\t42\n")
  writeFileSync(join(dir, "docs", "legacy.doc"), "legacy")
  writeFileSync(join(dir, "docs", "legacy.xls"), "legacy")
  writeFileSync(join(dir, "docs", "legacy.ppt"), "legacy")
  writeFileSync(join(dir, "docs", "legacy.pptx"), "legacy")
  writeFileSync(join(dir, "docs", "missing-tool.pdf"), "%PDF-1.4\nDOCMARK_PDF_7434\n%%EOF\n")
  await office(dir)
  const outside = await mkdtemp(join(tmpdir(), "chipmate-indexing-outside-"))
  writeFileSync(join(outside, "escape.c"), "int QA_SYMLINK_ESCAPE_7004(void) { return 7004; }\n")
  symlinkSync(join(outside, "escape.c"), join(dir, "src", "escape.c"))
  execFileSync("git", ["init", "-b", "main"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "qa@chipmate.invalid"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "ChipMate QA"], { cwd: dir })
  execFileSync("git", ["add", "."], { cwd: dir })
  execFileSync("git", ["commit", "-m", "qa fixture"], { cwd: dir })
  return dir
}

function qualityCases() {
  const groups = {
    exact: [
      ["qa_replay_mapping_journal", "重放掉电前未提交的映射日志并恢复页表。"],
      ["qa_flush_dma_ring", "停止 DMA 后排空完成环。"],
      ["qa_verify_boot_manifest", "启动前验证固件清单签名和版本。"],
      ["qa_quiesce_nand_channel", "等待 NAND 通道上的未完成事务归零。"],
      ["qa_restore_checkpoint", "从最后一个有效检查点恢复控制器状态。"],
      ["qa_rotate_error_log", "错误日志达到容量上限时轮换日志文件。"],
      ["qa_reseed_scrambler", "在擦除块切换后重新设置数据扰码种子。"],
      ["qa_release_stale_lock", "检测所有者 epoch 后释放陈旧互斥锁。"],
    ],
    english: [
      ["rebuild free block bitmap from the wear table", "Rebuild the free-block bitmap from persistent wear-level records."],
      ["drain the completion queue before resetting the controller", "Drain every completion entry before controller reset."],
      ["reject a packet after its CRC checksum mismatches", "Reject a received packet when the computed CRC mismatches."],
      ["restore the previous mapping after a NAND program failure", "Roll back to the previous logical mapping after NAND program failure."],
      ["enter read only mode after repeated journal corruption", "Enter read-only mode after repeated journal corruption is confirmed."],
      ["wake blocked producers when queue capacity becomes available", "Wake blocked producer threads when the queue gains free capacity."],
      ["clamp a DMA segment to the remaining destination buffer", "Clamp DMA segment length to the remaining destination buffer."],
      ["retry PCIe link training with exponential backoff", "Retry PCIe link training using bounded exponential backoff."],
    ],
    chinese: [
      ["掉电恢复时在哪里重放映射日志", "掉电恢复阶段重放映射日志，并按序号恢复逻辑到物理页映射。"],
      ["控制器超时后取消所有未完成命令", "控制器超时后逐项取消尚未完成的命令，并唤醒等待者。"],
      ["垃圾回收迁移有效页后擦除旧块", "垃圾回收先迁移全部有效页，确认映射提交后再擦除旧块。"],
      ["温度过高时降低后台写入速率", "温度超过安全阈值时降低后台写入速率，恢复后逐级放开。"],
      ["固件签名校验失败后进入安全模式", "固件签名校验失败时禁止启动镜像并进入安全恢复模式。"],
      ["队列释放空间后唤醒等待的生产者", "消费完成释放队列空间后，唤醒因队列满而等待的生产者。"],
      ["更新共享页表前先获取写锁", "更新共享页表前获取写锁，提交新映射后再释放锁。"],
      ["连续读取失败后切换到备用副本", "主副本连续读取失败达到阈值后切换备用副本并记录降级。"],
    ],
    cross: [
      ["which request coordinator validates input in another file before dispatch", "Request coordinator calls the external validator before dispatching work."],
      ["timeout callback invokes the reset scheduler across modules", "Timeout callback delegates controller recovery to the reset scheduler module."],
      ["recovery state waits for journal replay before becoming ready", "Recovery state waits for the journal replay helper before entering ready state."],
      ["write completion updates mapping then persists a checkpoint", "Write completion calls mapping update and then the checkpoint persistence helper."],
      ["read error escalates to ECC decoding before retry", "Read error handler calls the ECC decoder module before scheduling a retry."],
      ["shutdown flushes cache before disabling DMA", "Shutdown coordinator calls cache flush before the DMA disable helper."],
      ["startup loads configuration before launching worker threads", "Startup coordinator loads persistent configuration before worker launch."],
      ["allocation failure unwinds the ring and releases its mutex", "Allocation failure path calls ring unwind before releasing the shared mutex."],
    ],
    hard: [
      ["select the active superblock using both generation and CRC", "Select the active superblock only when generation is newest and CRC is valid."],
      ["discard a stale completion whose epoch differs from the request", "Discard stale completion entries when completion epoch differs from request epoch."],
      ["rollback a partially programmed page without changing the committed map", "Roll back a partially programmed page while preserving the committed mapping."],
      ["run foreground garbage collection only when host writes are blocked", "Run foreground garbage collection only while host writes are blocked for space."],
      ["distinguish local static parser state from the duplicate in another file", "Use this file-local static parser state rather than the duplicate symbol elsewhere."],
      ["choose the mirrored metadata copy only after primary checksum failure", "Choose mirrored metadata only after the primary copy fails checksum validation."],
      ["ignore a late timeout after the command has already completed", "Ignore a late timeout callback when the command completion flag is already set."],
      ["preserve the first fatal error while collecting later cleanup errors", "Preserve the first fatal error while recording later cleanup failures separately."],
    ],
  }
  return Object.entries(groups).flatMap(([category, rows]) =>
    rows.map(([query, description], index) => {
      const symbol =
        category === "exact" ? query : `qa_bench_${category}_${String(index + 1).padStart(2, "0")}`
      return {
        id: `${category}-${index + 1}`,
        category,
        query,
        description,
        symbol,
        path: `quality/${category}-${String(index + 1).padStart(2, "0")}.c`,
        line: 4,
      }
    }),
  )
}

function writeQualityCorpus(dir, cases) {
  const support = []
  for (const [index, item] of cases.entries()) {
    const call = item.category === "cross" ? `${item.symbol}_helper(state)` : `state ^ ${8100 + index}`
    const declaration = item.category === "cross" ? `extern int ${item.symbol}_helper(int state);` : ""
    writeFileSync(
      join(dir, item.path),
      [
        "#include <stdint.h>",
        declaration,
        `/* ${item.description} 固定质量标识：${item.symbol}。 */`,
        `int ${item.symbol}(int state) {`,
        `  return ${call};`,
        "}",
        "",
      ].join("\n"),
    )
    if (item.category === "cross") {
      support.push(`int ${item.symbol}_helper(int state) { return state + ${index + 1}; }`)
    }
    if (item.category === "hard") {
      writeFileSync(
        join(dir, "quality", `noise-${item.id}.c`),
        [
          "#include <stdint.h>",
          "",
          `/* 近似干扰项会谈到 ${item.query}，但这里只记录遥测，不执行目标恢复行为。 */`,
          `int qa_noise_${item.category}_${index + 1}(int state) {`,
          "  return state;",
          "}",
          "",
        ].join("\n"),
      )
    }
  }
  writeFileSync(join(dir, "quality", "cross-support.c"), `${support.join("\n")}\n`)
}

async function qualitySearch(item, cases) {
  const rows = []
  for (const entry of cases) {
    const found = await item.call("search", { query: entry.query })
    rows.push({
      id: entry.id,
      query: entry.query,
      results: found.slice(0, 10).map((result) => ({
        score: result.score,
        filePath: result.payload?.filePath,
        startLine: result.payload?.startLine,
        endLine: result.payload?.endLine,
      })),
    })
  }
  return rows
}

function qualityMetrics(rows, cases, threshold) {
  const ranked = rows.map((row, index) => {
    const gold = cases[index]
    const results = row.results.filter((item) => item.score >= threshold)
    const rank =
      results.findIndex(
        (item) =>
          item.filePath === gold.path &&
          item.startLine <= gold.line &&
          item.endLine >= gold.line,
      ) + 1
    return { ...row, gold, results, rank }
  })
  const recall = (category) => {
    const subset = ranked.filter((item) => item.gold.category === category)
    return subset.filter((item) => item.rank > 0 && item.rank <= 5).length / subset.length
  }
  const hits = ranked.filter((item) => item.rank > 0 && item.rank <= 5).length
  const returned = ranked.reduce((sum, item) => sum + Math.min(5, item.results.length), 0)
  const precision = returned === 0 ? 0 : hits / returned
  const recall5 = hits / ranked.length
  const f1 = precision + recall5 === 0 ? 0 : (2 * precision * recall5) / (precision + recall5)
  const valid = ranked.every((item) =>
    item.results.every(
      (result) =>
        typeof result.filePath === "string" &&
        existsSync(join(fixture, result.filePath)) &&
        Number.isInteger(result.startLine) &&
        result.startLine > 0 &&
        Number.isInteger(result.endLine) &&
        result.endLine >= result.startLine,
    ),
  )
  return {
    threshold: Math.round(threshold * 100) / 100,
    exactTop1: ranked.filter((item) => item.gold.category === "exact" && item.rank === 1).length / 8,
    recall5,
    englishRecall5: recall("english"),
    chineseRecall5: recall("chinese"),
    mrr10: ranked.reduce((sum, item) => sum + (item.rank > 0 && item.rank <= 10 ? 1 / item.rank : 0), 0) / ranked.length,
    ndcg5:
      ranked.reduce(
        (sum, item) => sum + (item.rank > 0 && item.rank <= 5 ? 1 / Math.log2(item.rank + 1) : 0),
        0,
      ) / ranked.length,
    f1,
    validLocations: valid ? 1 : 0,
    directEvidence: recall5,
    failures: ranked
      .filter((item) => item.rank === 0 || item.rank > 5)
      .map((item) => ({
        id: item.id,
        query: item.query,
        gold: item.gold.path,
        top5: item.results.slice(0, 5),
      })),
  }
}

async function qualityCoverage(item, cases) {
  const missing = []
  for (const entry of cases) {
    const found = await item.call("search", { query: `locate implementation of ${entry.symbol}` })
    if (
      !found
        .slice(0, 5)
        .some(
          (result) =>
            result.payload?.filePath === entry.path &&
            result.payload?.startLine <= entry.line &&
            result.payload?.endLine >= entry.line,
        )
    ) {
      missing.push(entry.path)
    }
  }
  return {
    total: cases.length,
    hits: cases.length - missing.length,
    ratio: (cases.length - missing.length) / cases.length,
    missing,
  }
}

function qualityOverlap(first, second, threshold) {
  const sets = (rows) =>
    rows.map(
      (row) =>
        new Set(
          row.results
            .filter((item) => item.score >= threshold)
            .slice(0, 5)
            .map((item) => `${item.filePath}:${item.startLine}:${item.endLine}`),
        ),
    )
  const left = sets(first)
  const right = sets(second)
  const totals = left.reduce(
    (sum, current, index) => {
      const other = right[index]
      const shared = [...current].filter((key) => other.has(key)).length
      return { shared: sum.shared + shared, maximum: sum.maximum + Math.max(current.size, other.size) }
    },
    { shared: 0, maximum: 0 },
  )
  return totals.maximum === 0 ? 0 : totals.shared / totals.maximum
}

async function isolated(dir, marker) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "shared.c"),
    [
      "#include <stddef.h>",
      "static int shared_fold(const int *values, size_t count)",
      "{",
      "  int total = 0;",
      "  for (size_t index = 0; index < count; ++index) total += values[index];",
      "  return total;",
      "}",
      "int SHARED_SYMBOL(void)",
      "{",
      `  /* ${marker} */`,
      "  const int values[] = { 1, 2, 3, 4 };",
      "  return shared_fold(values, sizeof(values) / sizeof(values[0]));",
      "}",
      "",
    ].join("\n"),
  )
  writeFileSync(join(dir, "shared.md"), `# 同名文档\n\n${marker}\n`)
  execFileSync("git", ["init", "-b", "main"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "qa@chipmate.invalid"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "ChipMate QA"], { cwd: dir })
  execFileSync("git", ["add", "."], { cwd: dir })
  execFileSync("git", ["commit", "-m", "qa isolation"], { cwd: dir })
  return dir
}

async function office(dir) {
  await zip(join(dir, "docs", "fixture.docx"), [
    [
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    [
      "word/document.xml",
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCMARK_DOCX_7435</w:t></w:r></w:p></w:body></w:document>',
    ],
  ])
  const book = utils.book_new()
  const sheet = utils.aoa_to_sheet([
    ["Name", "Value"],
    ["DOCMARK_XLSX_7436", 42],
  ])
  utils.book_append_sheet(book, sheet, "Data")
  writeFileSync(join(dir, "docs", "fixture.xlsx"), write(book, { type: "buffer", bookType: "xlsx" }))
  const ods = utils.book_new()
  const data = utils.aoa_to_sheet([
    ["Name", "Value"],
    ["DOCMARK_ODS_7437", 43],
  ])
  utils.book_append_sheet(ods, data, "Data")
  writeFileSync(join(dir, "docs", "fixture.ods"), write(ods, { type: "buffer", bookType: "ods" }))
}

function zip(file, entries, raw = new Set()) {
  return new Promise((done, reject) => {
    const archive = new yazl.ZipFile()
    const chunks = []
    archive.outputStream.on("data", (chunk) => chunks.push(chunk))
    archive.outputStream.once("error", reject)
    archive.outputStream.once("end", () => {
      writeFileSync(file, Buffer.concat(chunks))
      done()
    })
    for (const [name, content] of entries) {
      archive.addBuffer(Buffer.from(content), name, { compress: !raw.has(name) })
    }
    archive.end()
  })
}

async function check(id, title, run) {
  const started = Date.now()
  try {
    const detail = await run()
    const item = { id, title, status: "PASS", elapsedMs: Date.now() - started, detail }
    results.push(item)
    process.stdout.write(`PASS ${id} ${title}\n`)
    return item
  } catch (err) {
    const item = {
      id,
      title,
      status: "FAIL",
      elapsedMs: Date.now() - started,
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    }
    results.push(item)
    process.stderr.write(`FAIL ${id} ${title}: ${item.error}\n`)
    return item
  }
}

function verify(value, message) {
  if (!value) throw new Error(message)
}

async function snapshot(item) {
  const status = await item.call("codeGraphStatus", undefined)
  const dir = status.storage?.graphDirectory
  verify(dir && existsSync(join(dir, "manifest.json")), "CodeGraph manifest 不存在。")
  const file = join(dir, "manifest.json")
  const manifest = JSON.parse(readFileSync(file, "utf8"))
  const records = Object.entries(manifest.records ?? {})
    .map(([path, record]) => ({
      path,
      status: record.status,
      fileHash: record.fileHash,
      graphFile: record.graphFile,
      graphParts: record.graphParts,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return {
    sha: sha(file),
    records: createHash("sha256").update(JSON.stringify(records)).digest("hex"),
    generation: manifest.dataGeneration,
    lastFullScanAt: manifest.lastFullScanAt,
    recordCount: status.storage.recordCount,
    validFileCount: status.storage.validFileCount,
    parseErrorCount: status.storage.parseErrorCount,
  }
}

function compact(items) {
  return items.slice(0, 5).map((item) => ({
    score: item.score,
    filePath: item.payload?.filePath,
    startLine: item.payload?.startLine,
    endLine: item.payload?.endLine,
    codeChunk: item.payload?.codeChunk?.slice(0, 240),
  }))
}

function parse(args) {
  const out = {}
  for (const [index, value] of args.entries()) {
    if (!value.startsWith("--")) continue
    out[value.slice(2)] = args[index + 1]
  }
  return out
}

function command(name) {
  try {
    return execFileSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

function sha(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function safe(body) {
  try {
    const data = JSON.parse(body)
    return {
      model: data.model,
      dimensions: data.dimensions,
      count: Array.isArray(data.input) ? data.input.length : 1,
      chars: Array.isArray(data.input)
        ? data.input.reduce((sum, value) => sum + String(value).length, 0)
        : String(data.input ?? "").length,
    }
  } catch {
    return { invalid: true, chars: body.length }
  }
}

function faultMode(mode, count, switchAt) {
  if (["wrong-dimension", "padding", "collapse", "nonfinite"].includes(mode)) return true
  if (/^dimension-(1024|4096)$/.test(mode)) return true
  return mode === "drift" && count >= switchAt
}

function transformMode(mode) {
  return (
    ["wrong-dimension", "padding", "collapse", "nonfinite", "drift"].includes(mode) ||
    /^dimension-(1024|4096)$/.test(mode)
  )
}

function fault(data, mode) {
  const rows = Array.isArray(data.data) ? data.data : []
  const first = rows[0]?.embedding
  if (!Array.isArray(first)) return data
  if (mode === "collapse") {
    return { ...data, data: rows.map((item) => ({ ...item, embedding: [...first] })) }
  }
  return {
    ...data,
    data: rows.map((item) => {
      const vector = item.embedding
      if (!Array.isArray(vector)) return item
      if (mode === "wrong-dimension") return { ...item, embedding: vector.slice(0, -1) }
      if (mode === "padding") {
        const count = Math.max(8, Math.ceil(vector.length * 0.01))
        return { ...item, embedding: [...vector, ...new Array(count).fill(0)] }
      }
      if (mode === "nonfinite") return { ...item, embedding: [null, ...vector.slice(1)] }
      if (mode === "drift") return { ...item, embedding: vector.map((value) => -value) }
      const match = /^dimension-(1024|4096)$/.exec(mode)
      if (!match) return item
      const dimension = Number(match[1])
      return {
        ...item,
        embedding: Array.from({ length: dimension }, (_, index) => vector[index % vector.length]),
      }
    }),
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /(?:api.?key|authorization|token|secret)/i.test(key) ? "[已脱敏]" : redact(item),
    ]),
  )
}

function markdown(report) {
  const lines = [
    `# ChipMate ${report.版本} macOS 索引验收报告`,
    "",
    `- 生成时间：${report.生成时间}`,
    `- 平台：${report.平台}`,
    `- VSIX：\`${report.VSIX}\``,
    `- SHA-256：\`${report.SHA256}\``,
    `- Embedding：endpoint 摘要 \`${endpointHash}\` / \`${model}\` / 自动探测 ${dimension} 维`,
    `- 结果：${report.汇总.通过} 通过，${report.汇总.失败} 失败，共 ${report.汇总.总数} 项`,
    "",
    "| ID | 场景 | 结果 | 耗时（毫秒） |",
    "|---|---|---|---|",
    ...report.结果.map((item) => `| ${item.id} | ${item.title} | ${item.status} | ${item.elapsedMs} |`),
    "",
    "## 失败详情",
    "",
    ...report.结果
      .filter((item) => item.status === "FAIL")
      .flatMap((item) => [`### ${item.id} ${item.title}`, "", "```text", item.error, "```", ""]),
    "## 证据目录",
    "",
    `原始 IPC、状态与 stderr 日志保存在：\`${evidence}\`。`,
    "",
  ]
  return `${lines.join("\n")}\n`
}
