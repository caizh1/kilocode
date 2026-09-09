import type { PatentRadar } from "./types"

const JURISDICTIONS = ["CN", "JP", "KR", "US", "EP", "RU"]

export function corpusGate(
  corpus: PatentRadar.CorpusWatermark,
  vectorCoverage: number,
): { ready: boolean; warnings: string[] } {
  const warnings: string[] = []
  if (corpus.status !== "READY" || !corpus.generation) warnings.push("专利语料状态不是 READY。")
  if (!corpus.indexedAt) warnings.push("专利语料缺少索引发布时间。")
  if (vectorCoverage < 0.9) warnings.push(`向量覆盖率 ${(vectorCoverage * 100).toFixed(1)}% 低于 90%。`)
  for (const jurisdiction of corpus.requiredJurisdictions ?? JURISDICTIONS) {
    const row = corpus.jurisdictions.find((item) => item.jurisdiction === jurisdiction)
    if (!row || row.records === 0) {
      warnings.push(`${jurisdiction} 语料缺失。`)
      continue
    }
    if (row.claimsCoverage < 0.8) warnings.push(`${jurisdiction} 权利要求覆盖率低于 80%。`)
    if (!row.historicalBaseline) warnings.push(`${jurisdiction} 尚未导入并声明完整历史基线。`)
    if (!row.coverageThrough) warnings.push(`${jurisdiction} 缺少批次覆盖截止水位。`)
    if (!row.dataThrough) warnings.push(`${jurisdiction} 缺少数据截止时间。`)
    if (!row.legalStatusThrough) warnings.push(`${jurisdiction} 缺少法律状态截止时间。`)
    if (row.dataThrough && row.legalStatusThrough && days(row.legalStatusThrough, row.dataThrough) > 180) {
      warnings.push(`${jurisdiction} 法律状态水位落后公开数据超过 180 天。`)
    }
  }
  return { ready: warnings.length === 0, warnings }
}

function days(earlier: string, later: string) {
  return (Date.parse(later) - Date.parse(earlier)) / (24 * 60 * 60 * 1000)
}

export function assess(
  candidate: PatentRadar.Candidate,
  hits: PatentRadar.PatentHit[],
  matrix: PatentRadar.MatrixCell[],
  gate: { ready: boolean; warnings: string[] },
  modelWarnings: string[],
): PatentRadar.Assessment {
  const necessary = candidate.features.filter((item) => item.necessary).map((item) => item.id)
  const warnings = [...gate.warnings, ...modelWarnings]
  if (!necessary.length) {
    return result("insufficient-evidence", "候选未形成可检验的必要技术特征集合。", warnings)
  }
  if (!gate.ready) {
    return result("insufficient-evidence", "语料完整性门禁未通过，已关闭正面结论。", warnings)
  }
  if (hits.length && !completeMatrix(necessary, hits, matrix)) {
    return result("insufficient-evidence", "逐项对比矩阵不完整或引用未通过原文校验。", warnings)
  }
  const coverage = new Map(
    hits.map((hit) => [
      hit.publicationNumber,
      new Set(
        matrix
          .filter((cell) => cell.publicationNumber === hit.publicationNumber && cell.covered)
          .map((cell) => cell.featureId),
      ),
    ]),
  )
  const single = hits.find((hit) => necessary.every((feature) => coverage.get(hit.publicationNumber)?.has(feature)))
  if (single) {
    return result(
      "single-reference-conflict",
      `${single.publicationNumber} 的经校验证据覆盖全部必要技术特征。`,
      warnings,
    )
  }
  const union = new Set(matrix.filter((cell) => cell.covered).map((cell) => cell.featureId))
  if (necessary.every((feature) => union.has(feature)) && hits.length > 1) {
    return result(
      "combination-risk",
      "多份截止日前文献合并后覆盖全部必要技术特征；该结论不等同于单篇新颖性冲突。",
      warnings,
    )
  }
  const cn = hits.find((hit) => {
    if (hit.jurisdiction !== "CN" || !/active|granted|in force|有效|授权|维持/i.test(hit.legalStatus ?? ""))
      return false
    return (coverage.get(hit.publicationNumber)?.size ?? 0) >= Math.max(1, Math.ceil(necessary.length / 2))
  })
  if (cn)
    return result(
      "cn-claim-risk",
      `${cn.publicationNumber} 的中国权利要求相关证据覆盖较多必要特征，建议代理人进一步核查有效权利要求。`,
      warnings,
    )
  return result(
    "review-ready",
    "在当前内网专利语料范围和数据截止时间内，暂未发现单份更早专利文献完整公开全部必要技术特征，建议继续人工专利检索。",
    warnings,
  )

  function result(verdict: PatentRadar.Verdict, reason: string, localWarnings: string[]): PatentRadar.Assessment {
    return { candidateId: candidate.id, verdict, reason, references: hits, matrix, warnings: localWarnings }
  }
}

function completeMatrix(features: string[], hits: PatentRadar.PatentHit[], matrix: PatentRadar.MatrixCell[]) {
  const cells = new Set(matrix.map((item) => `${item.featureId}:${item.publicationNumber}`))
  return hits.slice(0, 50).every((hit) => features.every((feature) => cells.has(`${feature}:${hit.publicationNumber}`)))
}
