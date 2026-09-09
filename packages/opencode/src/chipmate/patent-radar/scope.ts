import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { ScanResult } from "./scanner"
import { PATENT_RADAR_METHOD_VERSION, PatentRadar } from "./types"

export interface ResolvedScope {
  source: ScanResult
  preview: PatentRadar.ScopePreview
  coreEvidenceIds: Set<string>
}

export async function resolveScanScope(
  directory: string,
  workspace: ScanResult,
  value: PatentRadar.ScanScope,
): Promise<ResolvedScope> {
  const scope = PatentRadar.ScanScope.parse(value)
  if (scope.kind === "workspace") {
    const files = [...new Set(workspace.evidence.map((item) => item.location.file))].sort()
    const coverage: PatentRadar.ScopeCoverage = {
      coreFiles: files,
      dependencyFiles: [],
      documentFiles: files.filter((file) => workspace.evidence.some((item) => item.location.file === file && item.kind === "document")),
      supportingFiles: [],
      selectedEvidence: workspace.evidence.length,
      workspaceEvidence: workspace.evidence.length,
      workspacePercent: workspace.evidence.length ? 1 : 0,
      closureComplete: true,
      requiresConfirmation: false,
      excludedBoundaries: [],
      warnings: [],
    }
    return {
      source: workspace,
      coreEvidenceIds: new Set(workspace.evidence.map((item) => item.id)),
      preview: {
        scope,
        scopeFingerprint: workspace.fingerprint,
        coverage,
        estimatedModelCalls: estimateCalls(workspace.evidence.length),
      },
    }
  }

  const root = await fs.realpath(directory)
  const evidenceFiles = [...new Set(workspace.evidence.map((item) => item.location.file))]
  const coreFiles = new Set<string>()
  const coreRoots = new Set<string>()
  for (const input of scope.corePaths) {
    const absolute = path.resolve(root, input)
    const real = await fs.realpath(absolute).catch(() => undefined)
    if (!real) throw new Error(`模块路径不存在或已删除：${input}`)
    const relative = path.relative(root, real).replaceAll(path.sep, "/")
    if (!relative || relative === ".") throw new Error("不能把整个工作区根目录作为模块；请改用全仓扫描")
    if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`模块路径超出当前工作区：${input}`)
    coreRoots.add(relative)
    const stat = await fs.lstat(absolute)
    if (stat.isSymbolicLink()) throw new Error(`模块路径是符号链接，已拒绝：${input}`)
    const matches = stat.isDirectory()
      ? evidenceFiles.filter((file) => file === relative || file.startsWith(`${relative}/`))
      : evidenceFiles.filter((file) => file === relative)
    if (!matches.length) throw new Error(`模块路径没有可分析的文件，可能是不支持的类型：${input}`)
    for (const file of matches) coreFiles.add(file)
  }

  const coreEvidenceIds = new Set(
    workspace.evidence.filter((item) => coreFiles.has(item.location.file)).map((item) => item.id),
  )
  const strong = workspace.relations.filter(
    (relation) => relation.strength === "strong" && relation.resolution === "exact",
  )
  const complete = closure(coreEvidenceIds, strong)
  const selectedIds = scope.expansionPolicy === "balanced" ? directClosure(coreEvidenceIds, strong) : complete
  const closureComplete = selectedIds.size === complete.size
  const evidence = workspace.evidence.filter((item) => selectedIds.has(item.id))
  const selectedRelations = workspace.relations.filter(
    (relation) => selectedIds.has(relation.fromEvidenceId) && selectedIds.has(relation.toEvidenceId),
  )
  const selectedFiles = new Set(evidence.map((item) => item.location.file))
  const dependencies = [...selectedFiles].filter((file) => !coreFiles.has(file)).sort()
  const boundaries = strong
    .filter(
      (relation) => selectedIds.has(relation.fromEvidenceId) !== selectedIds.has(relation.toEvidenceId),
    )
    .map((relation) => ({
      relationId: relation.relationId,
      fromFile: fileOf(workspace, relation.fromEvidenceId),
      toFile: fileOf(workspace, relation.toEvidenceId),
      reason: "均衡范围未纳入的强关系边界",
    }))
  const percent = workspace.evidence.length ? evidence.length / workspace.evidence.length : 0
  const scopeGaps = [...workspace.coverage.skipped, ...workspace.coverage.parseFailures]
    .filter((item) => [...coreRoots].some((root) => item.file === root || item.file.startsWith(`${root}/`)))
    .map((item) => `核心范围覆盖缺口：${item.file}（${item.reason}）`)
  const warnings = [
    ...(percent > 0.4 && scope.expansionPolicy === "quality-first"
      ? [`完整模块闭包占全仓 ${(percent * 100).toFixed(1)}%，开始扫描前必须明确确认。`]
      : []),
    ...(!closureComplete ? ["均衡范围保留未处理强关系边界，结果最高只能晋升为技术候选。"] : []),
    ...scopeGaps.slice(0, 50),
    ...(scopeGaps.length > 50 ? [`另有 ${scopeGaps.length - 50} 个核心范围覆盖缺口，请在报告中查看完整清单。`] : []),
  ]
  const coverage: PatentRadar.ScopeCoverage = {
    coreFiles: [...coreFiles].sort(),
    dependencyFiles: dependencies,
    documentFiles: [...selectedFiles]
      .filter((file) => workspace.evidence.some((item) => item.location.file === file && item.kind === "document"))
      .sort(),
    supportingFiles: dependencies,
    selectedEvidence: evidence.length,
    workspaceEvidence: workspace.evidence.length,
    workspacePercent: percent,
    closureComplete,
    requiresConfirmation: percent > 0.4 && scope.expansionPolicy === "quality-first",
    excludedBoundaries: boundaries,
    warnings,
  }
  const scopeFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        methodVersion: PATENT_RADAR_METHOD_VERSION,
        scope,
        files: [...selectedFiles].sort().map((file) => [file, workspace.fileFingerprints[file]]),
        relations: selectedRelations.map((item) => item.relationId).sort(),
      }),
    )
    .digest("hex")
  const fingerprints = Object.fromEntries(
    Object.entries(workspace.fileFingerprints).filter(([file]) => selectedFiles.has(file)),
  )
  return {
    coreEvidenceIds,
    preview: { scope, scopeFingerprint, coverage, estimatedModelCalls: estimateCalls(evidence.length) },
    source: {
      ...workspace,
      fingerprint: scopeFingerprint,
      fileFingerprints: fingerprints,
      evidence,
      relations: selectedRelations,
      files: selectedFiles.size,
      warnings: [...workspace.warnings, ...warnings],
    },
  }
}

export function candidateAnchoredToScope(
  candidate: PatentRadar.Candidate,
  coreEvidenceIds: Set<string>,
  relations: PatentRadar.EvidenceRelation[],
) {
  if (!candidate.evidenceIds.some((id) => coreEvidenceIds.has(id))) return false
  const exact = closure(coreEvidenceIds, relations.filter((item) => item.strength === "strong" && item.resolution === "exact"))
  return candidate.features
    .filter((feature) => feature.necessary)
    .every((feature) => feature.evidenceIds.every((id) => exact.has(id)))
}

function closure(seed: Set<string>, relations: PatentRadar.EvidenceRelation[]) {
  const output = new Set(seed)
  let changed = true
  while (changed) {
    changed = false
    for (const relation of relations) {
      if (output.has(relation.fromEvidenceId) && !output.has(relation.toEvidenceId)) {
        output.add(relation.toEvidenceId)
        changed = true
      }
      if (output.has(relation.toEvidenceId) && !output.has(relation.fromEvidenceId)) {
        output.add(relation.fromEvidenceId)
        changed = true
      }
    }
  }
  return output
}

function directClosure(seed: Set<string>, relations: PatentRadar.EvidenceRelation[]) {
  const output = new Set(seed)
  for (const relation of relations) {
    if (seed.has(relation.fromEvidenceId)) output.add(relation.toEvidenceId)
    if (seed.has(relation.toEvidenceId)) output.add(relation.fromEvidenceId)
  }
  return output
}

function fileOf(workspace: ScanResult, evidenceId: string) {
  return workspace.evidence.find((item) => item.id === evidenceId)?.location.file ?? "未知文件"
}

function estimateCalls(evidence: number) {
  return evidence ? Math.max(1, Math.ceil(evidence / 8)) : 0
}
