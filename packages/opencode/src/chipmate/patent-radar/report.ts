import { createHash } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { ZipFile } from "yazl"
import { blindCandidateIds, type PatentRadar } from "./types"
import { atomic, exportRoot } from "./store"

export async function exportEvidencePackage(run: PatentRadar.Run) {
  const root = exportRoot(run.workspace, run.id)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const json = path.join(root, `patent-radar-${run.id}.json`)
  const html = path.join(root, `patent-radar-${run.id}.html`)
  const docx = path.join(root, `patent-radar-${run.id}.docx`)
  const blind = path.join(root, `patent-radar-${run.id}-blind-review.json`)
  await atomic(json, `${JSON.stringify(run, null, 2)}\n`)
  await atomic(html, page(run))
  await atomic(docx, await document(run))
  await atomic(blind, `${JSON.stringify(blindPackage(run), null, 2)}\n`)
  const files = await Promise.all([json, html, docx, blind].map(details))
  await atomic(
    path.join(root, "SHA256SUMS"),
    `${files.map((item) => `${item.sha256}  ${path.basename(item.path)}`).join("\n")}\n`,
  )
  return { root, files }
}

function blindPackage(run: PatentRadar.Run) {
  const selected = blindCandidateIds(run.candidates.map((candidate) => candidate.id))
  const candidates = run.candidates.filter((candidate) => selected.has(candidate.id))
  const evidence = new Set(candidates.flatMap((candidate) => candidate.evidenceIds))
  return {
    schemaVersion: 2,
    runId: run.id,
    sourceFingerprint: run.sourceFingerprint,
    methodVersion: run.methodVersion,
    说明: "本文件不包含首审结论。第二位评审人填写 reviews 后，由 ChipMate 的 Patent Radar 导入命令载入。",
    candidates,
    sources: run.sources.filter((source) => evidence.has(source.id)),
    reviews: [] as Array<{
      candidateId: string
      reviewer: string
      decision: "worthy" | "reject" | "needs-arbitration"
      note: string
    }>,
  }
}

function page(run: PatentRadar.Run) {
  const scope = scopeLines(run)
  const candidates = run.candidates
    .map((candidate) => {
      const assessment = run.assessments.find((item) => item.candidateId === candidate.id)
      const matrix = assessment?.matrix.length
        ? `<h3>必要特征 × 专利证据矩阵</h3><table><thead><tr><th>特征</th><th>公开号</th><th>覆盖</th><th>位置</th><th>原文</th><th>理由</th></tr></thead><tbody>${assessment.matrix.map((cell) => `<tr><td>${escape(cell.featureId)}</td><td>${escape(cell.publicationNumber)}</td><td>${cell.covered ? "是" : "否"}</td><td>${escape(cell.locator ?? "")}</td><td>${escape(cell.quote ?? "")}</td><td>${escape(cell.rationale)}</td></tr>`).join("")}</tbody></table>`
        : ""
      const chain = candidate.relationIds.length
        ? `<h3>跨文件关系链</h3><ul>${candidate.relationIds.map((id) => relation(run, id)).join("")}</ul>`
        : ""
      return `<article><h2>${escape(candidate.title)}</h2><p class="verdict">${escape(candidate.discoveryTier)} · ${escape(candidate.origin)}</p><p>${escape(assessment?.reason ?? "尚未检索")}</p><dl><dt>技术问题</dt><dd>${escape(candidate.technicalProblem)}</dd><dt>实现手段</dt><dd>${escape(candidate.implementation)}</dd><dt>技术效果</dt><dd>${escape(candidate.technicalEffect)}（${escape(candidate.effectEvidenceLevel)}）</dd></dl><h3>必要技术特征</h3><ol>${candidate.features.map((item) => `<li>${escape(item.text)}</li>`).join("")}</ol>${chain}${matrix}<h3>证据</h3><ul>${candidate.evidenceIds.map((id) => evidence(run, id)).join("")}</ul></article>`
    })
    .join("")
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Patent Radar 证据报告</title><style>body{font:15px/1.65 system-ui,sans-serif;max-width:1080px;margin:auto;padding:32px;color:#202124;background:#f6f7f9}header,article{background:#fff;border:1px solid #dde1e6;border-radius:12px;padding:24px;margin:0 0 20px}.verdict{display:inline-block;padding:4px 10px;border-radius:999px;background:#e7f0ff;color:#124a91}code{white-space:pre-wrap}dt{font-weight:650}dd{margin:0 0 10px}small{color:#5f6368}table{width:100%;border-collapse:collapse}th,td{border:1px solid #dde1e6;padding:7px;text-align:left;vertical-align:top}</style></head><body><header><h1>ChipMate Patent Radar 证据报告${run.scope.kind === "module" ? "（范围扫描）" : ""}</h1><p>运行：${escape(run.id)}<br>方法版本：${escape(run.methodVersion)}<br>源码指纹：${escape(run.sourceFingerprint)}<br>${scope}<br>工作区覆盖：${run.coverage?.analyzedFiles ?? 0}/${run.coverage?.supportedFiles ?? 0}，完整扫描：${run.coverage?.completeWorkspaceScan ? "是" : "否"}<br>排序策略：混合召回（RRF），Rerank 关闭<br>语料 generation：${escape(run.corpus?.generation ?? "未取得")}</p><p><strong>质量状态：</strong>实验性技术发现；真实 gold set 验收完成前不得宣称达到高质量门槛。</p><p><strong>边界：</strong>${run.scope.kind === "module" ? "本报告只覆盖所列模块核心路径及自动纳入的确定性关系闭包，不能代表完成全仓扫描。" : ""} 本报告是现有技术与权利要求风险预检，不构成授权、无冲突或不侵权法律意见。</p></header>${candidates || "<article>未提取到候选。</article>"}</body></html>`
}

function relation(run: PatentRadar.Run, id: string) {
  const item = run.relations.find((entry) => entry.relationId === id)
  if (!item) return `<li>不可解析关系 ${escape(id)}</li>`
  const from = run.sources.find((entry) => entry.id === item.fromEvidenceId)?.location.file ?? item.fromEvidenceId
  const to = run.sources.find((entry) => entry.id === item.toEvidenceId)?.location.file ?? item.toEvidenceId
  return `<li>${escape(from)} → ${escape(to)}；${escape(item.kind)}；${escape(item.resolution)} / ${escape(item.strength)}；Variant ${escape(item.variantIds.join(", ") || "未确定")}</li>`
}

function evidence(run: PatentRadar.Run, id: string) {
  const item = run.sources.find((source) => source.id === id)
  if (!item) return `<li>不可解析证据 ${escape(id)}</li>`
  const locator = item.location.page
    ? `${item.location.file}#page=${item.location.page}`
    : `${item.location.file}:${item.location.lineStart}`
  return `<li><strong>${escape(locator)}</strong><br><small>SHA-256 ${escape(item.location.sha256)}</small><pre><code>${escape(item.excerpt.slice(0, 2000))}</code></pre></li>`
}

async function document(run: PatentRadar.Run) {
  const zip = new ZipFile()
  zip.addBuffer(Buffer.from(contentTypes()), "[Content_Types].xml")
  zip.addBuffer(Buffer.from(relationships()), "_rels/.rels")
  zip.addBuffer(Buffer.from(wordDocument(run)), "word/document.xml")
  zip.end()
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on("error", reject)
  })
}

function wordDocument(run: PatentRadar.Run) {
  const paragraphs = [
    "ChipMate Patent Radar 证据报告",
    `运行：${run.id}`,
    `源码指纹：${run.sourceFingerprint}`,
    ...(run.scope.kind === "module"
      ? [
          `扫描范围：${run.scope.name ?? run.scope.moduleId ?? "临时模块"}（范围扫描）`,
          `核心路径：${run.scope.corePaths.join("、")}`,
          `范围指纹：${run.scopeFingerprint}`,
          `占全仓证据：${((run.scopeCoverage?.workspacePercent ?? 0) * 100).toFixed(1)}%`,
          `闭包完整：${run.scopeCoverage?.closureComplete ? "是" : "否"}`,
          `未纳入强关系边界：${run.scopeCoverage?.excludedBoundaries.length ?? 0}`,
          "范围边界：本报告不能代表完成全仓扫描。",
        ]
      : ["扫描范围：完整工作区"]),
    `语料 generation：${run.corpus?.generation ?? "未取得"}`,
    "本报告是现有技术与权利要求风险预检，不构成授权、无冲突或不侵权法律意见。",
    ...run.candidates.flatMap((candidate) => {
      const assessment = run.assessments.find((item) => item.candidateId === candidate.id)
      return [
        `候选：${candidate.title}`,
        `结论：${assessment?.verdict ?? "observation"}`,
        `说明：${assessment?.reason ?? "尚未检索"}`,
        `技术问题：${candidate.technicalProblem}`,
        `实现手段：${candidate.implementation}`,
        `技术效果：${candidate.technicalEffect}`,
        ...candidate.features.map((item) => `必要技术特征：${item.text}`),
        ...(assessment?.matrix.map(
          (cell) =>
            `证据矩阵：${cell.featureId} × ${cell.publicationNumber} = ${cell.covered ? "覆盖" : "未覆盖"}；${cell.locator ?? "无明确位置"}；${cell.quote ?? "无原文"}；${cell.rationale}`,
        ) ?? []),
        ...candidate.evidenceIds.map((id) => {
          const item = run.sources.find((source) => source.id === id)
          return item
            ? `源码证据：${item.location.page ? `${item.location.file}#page=${item.location.page}` : `${item.location.file}:${item.location.lineStart}-${item.location.lineEnd}`}，SHA-256 ${item.location.sha256}`
            : `不可解析证据：${id}`
        }),
      ]
    }),
  ]
  const body = paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`).join("")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
}

function scopeLines(run: PatentRadar.Run) {
  if (run.scope.kind === "workspace") return "扫描范围：完整工作区"
  return [
    `扫描范围：${escape(run.scope.name ?? run.scope.moduleId ?? "临时模块")}（范围扫描）`,
    `核心路径：${escape(run.scope.corePaths.join("、"))}`,
    `范围指纹：${escape(run.scopeFingerprint)}`,
    `占全仓证据：${((run.scopeCoverage?.workspacePercent ?? 0) * 100).toFixed(1)}%`,
    `闭包完整：${run.scopeCoverage?.closureComplete ? "是" : "否"}`,
    `未纳入强关系边界：${run.scopeCoverage?.excludedBoundaries.length ?? 0}`,
  ].join("<br>")
}

function contentTypes() {
  return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
}

function relationships() {
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
}

async function details(file: string) {
  const bytes = await readFile(file)
  return { path: file, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
}

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  )
}

function xml(value: string) {
  return escape(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
}
