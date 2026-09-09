export const JURISDICTIONS = ["CN", "JP", "KR", "US", "EP", "RU"] as const

export type Jurisdiction = (typeof JURISDICTIONS)[number]
export type CorpusState = "EMPTY" | "BUILDING" | "READY" | "DEGRADED"
export type BatchState = "DISCOVERED" | "STAGING" | "VALIDATING" | "INDEXING" | "PUBLISHED" | "QUARANTINED"

export interface CorpusWatermark {
  requiredJurisdictions: Jurisdiction[]
  generation: string | null
  indexName: string | null
  state: CorpusState
  publishedAt: string | null
  jurisdictions: Array<{
    jurisdiction: Jurisdiction
    documents: number
    earliestPublicationDate: string | null
    latestPublicationDate: string | null
    claimsCoverage: number
    fullTextCoverage: number
    legalStatusThrough: string | null
    historicalBaseline: boolean
    coverageThrough: string | null
  }>
  vectorCoverage: number
  warnings: string[]
}

export interface CorpusStatus extends CorpusWatermark {
  service: "chipmate-patent-server"
  apiVersion: "1.0.0"
  lastSuccessfulBatch: string | null
  quarantinedBatches: number
}

export interface PatentSearchRequest {
  queries: string[]
  cutoffDate?: string
  jurisdictions?: Jurisdiction[]
  languages?: string[]
  classifications?: string[]
  familyCollapse?: boolean
  limit?: number
}

export interface PatentPassage {
  field: "title" | "abstract" | "claim" | "description"
  locator: string
  text: string
}

export interface PatentHit {
  publicationNumber: string
  jurisdiction: Jurisdiction
  kindCode: string | null
  title: string | null
  familyId: string | null
  familySource: "official" | "derived" | null
  filingDate: string | null
  priorityDate: string | null
  publicationDate: string
  legalStatus: string | null
  legalStatusDate: string | null
  classifications: string[]
  passages: PatentPassage[]
  scores: {
    lexical: number | null
    vector: number | null
    citation: number | null
    fused: number
    rerank: number | null
  }
  sourceBatch: string
  versionId: string
}

export interface PatentSearchResponse {
  hits: PatentHit[]
  watermark: CorpusWatermark
  searchedAt: string
  warnings: string[]
}

export interface PatentClaim {
  number: string
  independent: boolean | null
  language: string | null
  text: string
}

export interface PatentDocument {
  versionId: string
  publicationNumber: string
  applicationNumber: string | null
  jurisdiction: Jurisdiction
  kindCode: string | null
  language: string | null
  title: string | null
  abstract: string | null
  description: string | null
  filingDate: string | null
  priorityDate: string | null
  publicationDate: string
  familyId: string | null
  familySource: "official" | "derived" | null
  legalStatus: string | null
  legalStatusDate: string | null
  applicants: string[]
  inventors: string[]
  classifications: string[]
  priorities: string[]
  citations: string[]
  claims: PatentClaim[]
  deleted: boolean
  sourceBatch: string
  contentHash: string
}

export interface SourceManifest {
  schemaVersion: 1
  source: "CNIPA"
  jurisdiction: Jurisdiction
  batchId: string
  dataType: "fulltext" | "bibliographic" | "legal-status" | "citation" | "mixed"
  coverageScope?: "historical-baseline" | "incremental" | "supplemental"
  sequence?: number
  periodStart?: string
  periodEnd?: string
  declaredRecords?: number
  files?: Array<{ path: string; sha256?: string; records?: number }>
}

export interface NormalizedPatentRecord extends Omit<PatentDocument, "versionId" | "sourceBatch" | "contentHash"> {
  sourceRecordId: string
}

export interface BatchMetrics {
  discoveredRecords: number
  acceptedRecords: number
  rejectedRecords: number
  duplicateRecords: number
  explicitDeletions: number
  missingPublicationNumber: number
  missingPublicationDate: number
  claimsDocuments: number
  fullTextDocuments: number
  errors: Array<{ record: string; code: string; message: string }>
}

export function isJurisdiction(value: unknown): value is Jurisdiction {
  return typeof value === "string" && (JURISDICTIONS as readonly string[]).includes(value)
}
