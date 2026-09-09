import type { BatchMetrics, NormalizedPatentRecord, SourceManifest } from "./contracts.js"
import { isJurisdiction } from "./contracts.js"

export interface IntegrityResult {
  accepted: NormalizedPatentRecord[]
  metrics: BatchMetrics
}

export function createMetrics(): BatchMetrics {
  return {
    discoveredRecords: 0,
    acceptedRecords: 0,
    rejectedRecords: 0,
    duplicateRecords: 0,
    explicitDeletions: 0,
    missingPublicationNumber: 0,
    missingPublicationDate: 0,
    claimsDocuments: 0,
    fullTextDocuments: 0,
    errors: [],
  }
}

export function validateRecords(
  manifest: SourceManifest,
  records: NormalizedPatentRecord[],
  existing: Map<string, NormalizedPatentRecord>,
  metrics: BatchMetrics,
): NormalizedPatentRecord[] {
  const output: NormalizedPatentRecord[] = []
  for (const raw of records) {
    metrics.discoveredRecords += 1
    const previous = existing.get(raw.publicationNumber)
    const record = previous ? merge(previous, raw) : raw
    if (!record.publicationNumber) {
      reject(metrics, raw.sourceRecordId, "MISSING_PUBLICATION_NUMBER", "记录缺少公开号")
      metrics.missingPublicationNumber += 1
      continue
    }
    if (!isJurisdiction(record.jurisdiction) || record.jurisdiction !== manifest.jurisdiction) {
      reject(
        metrics,
        raw.sourceRecordId,
        "JURISDICTION_MISMATCH",
        `记录地区 ${record.jurisdiction} 与批次地区 ${manifest.jurisdiction} 不一致`,
      )
      continue
    }
    if (!record.publicationDate) {
      reject(metrics, raw.sourceRecordId, "MISSING_PUBLICATION_DATE", "记录缺少公开日，且现有版本无法补全")
      metrics.missingPublicationDate += 1
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.publicationDate) || !Number.isFinite(Date.parse(record.publicationDate))) {
      reject(metrics, raw.sourceRecordId, "INVALID_PUBLICATION_DATE", `公开日无效：${record.publicationDate}`)
      continue
    }
    if (record.deleted) metrics.explicitDeletions += 1
    if (record.claims.length) metrics.claimsDocuments += 1
    if (record.description) metrics.fullTextDocuments += 1
    output.push(record)
  }
  return output
}

export function assertBatchIntegrity(manifest: SourceManifest, metrics: BatchMetrics): void {
  if (metrics.discoveredRecords === 0) throw new Error("数据包未解析出任何专利记录")
  if (manifest.declaredRecords !== undefined && manifest.declaredRecords !== metrics.discoveredRecords) {
    throw new Error(`声明记录数 ${manifest.declaredRecords} 与解析记录数 ${metrics.discoveredRecords} 不一致`)
  }
  if (metrics.rejectedRecords > 0) {
    throw new Error(`有 ${metrics.rejectedRecords} 条记录未通过关键字段校验，批次不得发布`)
  }
}

function merge(previous: NormalizedPatentRecord, current: NormalizedPatentRecord): NormalizedPatentRecord {
  return {
    ...previous,
    ...current,
    applicationNumber: current.applicationNumber || previous.applicationNumber,
    kindCode: current.kindCode || previous.kindCode,
    language: current.language || previous.language,
    title: current.title || previous.title,
    abstract: current.abstract || previous.abstract,
    description: current.description || previous.description,
    filingDate: current.filingDate || previous.filingDate,
    priorityDate: current.priorityDate || previous.priorityDate,
    publicationDate: current.publicationDate || previous.publicationDate,
    familyId: current.familyId || previous.familyId,
    familySource: current.familyId ? current.familySource : previous.familySource,
    legalStatus: current.legalStatus || previous.legalStatus,
    legalStatusDate: current.legalStatusDate || previous.legalStatusDate,
    applicants: current.applicants.length ? current.applicants : previous.applicants,
    inventors: current.inventors.length ? current.inventors : previous.inventors,
    classifications: current.classifications.length ? current.classifications : previous.classifications,
    priorities: current.priorities.length ? current.priorities : previous.priorities,
    citations: current.citations.length ? current.citations : previous.citations,
    claims: current.claims.length ? current.claims : previous.claims,
    deleted: current.deleted,
  }
}

function reject(metrics: BatchMetrics, record: string, code: string, message: string): void {
  metrics.rejectedRecords += 1
  if (metrics.errors.length < 1_000) metrics.errors.push({ record, code, message })
}
