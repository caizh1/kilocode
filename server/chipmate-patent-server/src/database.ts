import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Pool, type PoolClient, type QueryResultRow } from "pg"
import type {
  BatchMetrics,
  CorpusStatus,
  CorpusWatermark,
  Jurisdiction,
  NormalizedPatentRecord,
  PatentClaim,
  PatentDocument,
  SourceManifest,
} from "./contracts.js"
import { JURISDICTIONS } from "./contracts.js"
import { sha256Text, stableJson } from "./hash.js"

const SQL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "sql")

export interface BatchFile {
  filename: string
  sha256: string
  size: number
}

export interface Generation {
  id: string
  indexName: string
  state: "BUILDING" | "ACTIVE" | "RETIRED" | "FAILED"
  documentCount: number
  vectorCount: number
  sourceBatch: string | null
  publishedAt: string | null
}

export class PatentDatabase {
  readonly pool: Pool

  constructor(
    databaseUrl: string,
    private readonly requiredJurisdictions: Jurisdiction[] = [...JURISDICTIONS],
  ) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 12, idleTimeoutMillis: 30_000 })
  }

  async migrate(): Promise<void> {
    const sql = await fs.readFile(path.join(SQL_ROOT, "001-initial.sql"), "utf8")
    const client = await this.pool.connect()
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('chipmate-patent-migrate-v1'))")
      await client.query(sql)
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('chipmate-patent-migrate-v1'))").catch(() => undefined)
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async health(): Promise<boolean> {
    return this.pool
      .query("SELECT 1")
      .then(() => true)
      .catch(() => false)
  }

  async withImportLock<T>(callback: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('chipmate-patent-import-v1'))")
      return await callback()
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('chipmate-patent-import-v1'))").catch(() => undefined)
      client.release()
    }
  }

  async beginBatch(
    manifest: SourceManifest,
    file: BatchFile,
    parserVersion: string,
  ): Promise<"created" | "duplicate" | "blocked"> {
    const sameHash = await this.pool.query<{ id: string; state: string; parser_version: string }>(
      "SELECT id,state,parser_version FROM corpus_import_batches WHERE source_sha256=$1",
      [file.sha256],
    )
    const previous = sameHash.rows[0]
    if (previous) {
      if (previous.state === "PUBLISHED") return "duplicate"
      if (previous.state === "QUARANTINED" && previous.parser_version === parserVersion) return "blocked"
      if (!["STAGING", "VALIDATING", "INDEXING", "QUARANTINED"].includes(previous.state)) {
        throw new Error(`批次 ${previous.id} 处于无法自动恢复的状态 ${previous.state}`)
      }
      await this.retryBatch(previous.id, manifest, parserVersion, previous.state)
      return "created"
    }
    const sameId = await this.pool.query<{ source_sha256: string }>(
      "SELECT source_sha256 FROM corpus_import_batches WHERE id=$1",
      [manifest.batchId],
    )
    if (sameId.rowCount) {
      throw new Error(`批次 ${manifest.batchId} 已存在但 SHA-256 不同，已拒绝覆盖`)
    }
    await this.pool.query(
      `INSERT INTO corpus_import_batches(
        id,source,jurisdiction,data_type,coverage_scope,sequence_number,period_start,period_end,source_filename,
        source_sha256,source_size,parser_version,state,declared_records
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'STAGING',$13)`,
      [
        manifest.batchId,
        manifest.source,
        manifest.jurisdiction,
        manifest.dataType,
        manifest.coverageScope ?? "supplemental",
        manifest.sequence ?? null,
        manifest.periodStart ?? null,
        manifest.periodEnd ?? null,
        file.filename,
        file.sha256,
        file.size,
        parserVersion,
        manifest.declaredRecords ?? null,
      ],
    )
    return "created"
  }

  private async retryBatch(
    batchId: string,
    manifest: SourceManifest,
    parserVersion: string,
    previousState: string,
  ): Promise<void> {
    if (batchId !== manifest.batchId) {
      throw new Error(`相同内容曾以批次 ${batchId} 隔离，当前清单批次 ${manifest.batchId} 不一致，已拒绝重试`)
    }
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const active = await client.query(
        `SELECT 1 FROM patent_documents d
         JOIN patent_document_versions v ON v.id=d.active_version_id
         WHERE v.source_batch=$1 LIMIT 1`,
        [batchId],
      )
      if (active.rowCount) throw new Error(`隔离批次 ${batchId} 已被在线版本引用，不能清理暂存记录`)
      await client.query("DELETE FROM patent_document_versions WHERE source_batch=$1", [batchId])
      await client.query("DELETE FROM corpus_generations WHERE source_batch=$1 AND state<>'ACTIVE'", [batchId])
      await client.query(
        `UPDATE corpus_import_batches SET
           parser_version=$2,coverage_scope=$3,state='STAGING',published_at=NULL,failure_message=NULL,
           discovered_records=0,accepted_records=0,rejected_records=0,duplicate_records=0,
           explicit_deletions=0,metrics='{}'::jsonb
         WHERE id=$1 AND state=$4`,
        [batchId, parserVersion, manifest.coverageScope ?? "supplemental", previousState],
      )
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async stageRecords(
    batchId: string,
    records: NormalizedPatentRecord[],
  ): Promise<{ accepted: number; duplicates: number }> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      let accepted = 0
      let duplicates = 0
      for (const record of records) {
        await client.query(
          "INSERT INTO patent_documents(publication_number,jurisdiction) VALUES($1,$2) ON CONFLICT(publication_number) DO NOTHING",
          [record.publicationNumber, record.jurisdiction],
        )
        const contentHash = recordHash(record)
        const result = await client.query<{ id: string }>(
          `INSERT INTO patent_document_versions(
            publication_number,application_number,jurisdiction,kind_code,language,title,abstract_text,description_text,
            filing_date,priority_date,publication_date,family_id,family_source,legal_status,legal_status_date,
            applicants,inventors,classifications,priorities,citations,claims,deleted,source_batch,source_record_id,content_hash
          ) VALUES(
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,
            $20::jsonb,$21::jsonb,$22,$23,$24,$25
          ) ON CONFLICT(publication_number,content_hash) DO NOTHING RETURNING id`,
          [
            record.publicationNumber,
            record.applicationNumber,
            record.jurisdiction,
            record.kindCode,
            record.language,
            record.title,
            record.abstract,
            record.description,
            record.filingDate,
            record.priorityDate,
            record.publicationDate,
            record.familyId,
            record.familySource,
            record.legalStatus,
            record.legalStatusDate,
            JSON.stringify(record.applicants),
            JSON.stringify(record.inventors),
            JSON.stringify(record.classifications),
            JSON.stringify(record.priorities),
            JSON.stringify(record.citations),
            JSON.stringify(record.claims),
            record.deleted,
            batchId,
            record.sourceRecordId,
            contentHash,
          ],
        )
        if (result.rowCount) accepted += 1
        else duplicates += 1
      }
      await client.query("COMMIT")
      return { accepted, duplicates }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async setBatchMetrics(batchId: string, metrics: BatchMetrics, state: string): Promise<void> {
    await this.pool.query(
      `UPDATE corpus_import_batches SET state=$2,discovered_records=$3,accepted_records=$4,rejected_records=$5,
       duplicate_records=$6,explicit_deletions=$7,metrics=$8::jsonb WHERE id=$1`,
      [
        batchId,
        state,
        metrics.discoveredRecords,
        metrics.acceptedRecords,
        metrics.rejectedRecords,
        metrics.duplicateRecords,
        metrics.explicitDeletions,
        JSON.stringify(metrics),
      ],
    )
  }

  async quarantine(batchId: string, message: string, metrics?: BatchMetrics): Promise<void> {
    await this.pool.query(
      "UPDATE corpus_import_batches SET state='QUARANTINED',failure_message=$2,metrics=COALESCE($3::jsonb,metrics) WHERE id=$1",
      [batchId, message, metrics ? JSON.stringify(metrics) : null],
    )
    await this.integrity({ batchId, severity: "ERROR", code: "BATCH_QUARANTINED", message })
  }

  async activeGeneration(): Promise<Generation | null> {
    const result = await this.pool.query<GenerationRow>(
      "SELECT * FROM corpus_generations WHERE state='ACTIVE' ORDER BY published_at DESC LIMIT 1",
    )
    return result.rows[0] ? generation(result.rows[0]) : null
  }

  async createGeneration(input: {
    id: string
    indexName: string
    documentCount: number
    vectorCount: number
    batchId: string
    coverage: unknown
    warnings: string[]
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO corpus_generations(id,index_name,state,document_count,vector_count,source_batch,coverage,warnings)
       VALUES($1,$2,'BUILDING',$3,$4,$5,$6::jsonb,$7::jsonb)`,
      [
        input.id,
        input.indexName,
        input.documentCount,
        input.vectorCount,
        input.batchId,
        JSON.stringify(input.coverage),
        JSON.stringify(input.warnings),
      ],
    )
  }

  async failGeneration(id: string, message: string): Promise<void> {
    await this.pool.query("UPDATE corpus_generations SET state='FAILED',warnings=warnings || $2::jsonb WHERE id=$1", [
      id,
      JSON.stringify([message]),
    ])
    await this.integrity({ generationId: id, severity: "ERROR", code: "GENERATION_FAILED", message })
  }

  async activateGeneration(id: string, batchId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `UPDATE patent_documents d SET active_version_id=v.id
         FROM (
           SELECT DISTINCT ON (publication_number) id,publication_number
           FROM patent_document_versions WHERE source_batch=$1 ORDER BY publication_number,created_at DESC,id DESC
         ) v WHERE d.publication_number=v.publication_number`,
        [batchId],
      )
      await client.query("UPDATE corpus_generations SET state='RETIRED' WHERE state='ACTIVE'")
      await client.query(
        "UPDATE corpus_generations SET state='ACTIVE',published_at=now() WHERE id=$1 AND state='BUILDING'",
        [id],
      )
      await client.query("UPDATE corpus_import_batches SET state='PUBLISHED',published_at=now() WHERE id=$1", [batchId])
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async proposedCount(batchId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `WITH pending AS (
         SELECT DISTINCT ON (publication_number) publication_number,deleted
         FROM patent_document_versions WHERE source_batch=$1 ORDER BY publication_number,created_at DESC,id DESC
       )
       SELECT count(*)::text AS count FROM patent_documents d
       LEFT JOIN pending p ON p.publication_number=d.publication_number
       LEFT JOIN patent_document_versions a ON a.id=d.active_version_id
       WHERE COALESCE(p.deleted,a.deleted,false)=false AND (p.publication_number IS NOT NULL OR a.id IS NOT NULL)`,
      [batchId],
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async activeCount(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM patent_documents d
       JOIN patent_document_versions v ON v.id=d.active_version_id WHERE v.deleted=false`,
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async latestPublishedSequence(source: string, jurisdiction: Jurisdiction): Promise<number | null> {
    const result = await this.pool.query<{ sequence_number: string | null }>(
      `SELECT sequence_number::text FROM corpus_import_batches
       WHERE source=$1 AND jurisdiction=$2 AND state='PUBLISHED' AND sequence_number IS NOT NULL
       ORDER BY sequence_number DESC LIMIT 1`,
      [source, jurisdiction],
    )
    const value = result.rows[0]?.sequence_number
    return value === null || value === undefined ? null : Number(value)
  }

  async recordsForBatch(batchId: string): Promise<PatentDocument[]> {
    const result = await this.pool.query<VersionRow>(
      `SELECT DISTINCT ON (v.publication_number) v.* FROM patent_document_versions v
       WHERE v.source_batch=$1 ORDER BY v.publication_number,v.created_at DESC,v.id DESC`,
      [batchId],
    )
    return result.rows.map(document)
  }

  async proposedDocuments(batchId: string, offset: number, limit: number): Promise<PatentDocument[]> {
    const result = await this.pool.query<VersionRow>(
      `WITH pending AS (
         SELECT DISTINCT ON (publication_number) * FROM patent_document_versions
         WHERE source_batch=$1 ORDER BY publication_number,created_at DESC,id DESC
       ), selected AS (
         SELECT COALESCE(p.id,a.id) AS version_id FROM patent_documents d
         LEFT JOIN pending p ON p.publication_number=d.publication_number
         LEFT JOIN patent_document_versions a ON a.id=d.active_version_id
         WHERE COALESCE(p.deleted,a.deleted,false)=false AND COALESCE(p.id,a.id) IS NOT NULL
         ORDER BY d.publication_number OFFSET $2 LIMIT $3
       ) SELECT v.* FROM selected s JOIN patent_document_versions v ON v.id=s.version_id ORDER BY v.publication_number`,
      [batchId, offset, limit],
    )
    return result.rows.map(document)
  }

  async getDocuments(publicationNumbers: string[]): Promise<PatentDocument[]> {
    if (!publicationNumbers.length) return []
    const result = await this.pool.query<VersionRow>(
      `SELECT v.* FROM patent_documents d JOIN patent_document_versions v ON v.id=d.active_version_id
       WHERE d.publication_number=ANY($1::text[])`,
      [publicationNumbers],
    )
    return result.rows.map(document)
  }

  async getDocument(publicationNumber: string): Promise<PatentDocument | null> {
    return (await this.getDocuments([publicationNumber]))[0] ?? null
  }

  async getFamily(familyId: string): Promise<PatentDocument[]> {
    const result = await this.pool.query<VersionRow>(
      `SELECT v.* FROM patent_documents d JOIN patent_document_versions v ON v.id=d.active_version_id
       WHERE v.family_id=$1 ORDER BY v.priority_date NULLS LAST,v.publication_date,v.publication_number`,
      [familyId],
    )
    return result.rows.map(document)
  }

  async status(opensearchReady: boolean): Promise<CorpusStatus> {
    const active = await this.activeGeneration()
    const stats = await this.pool.query<CoverageRow>(
      `SELECT v.jurisdiction,count(*)::text AS documents,min(v.publication_date)::text AS earliest,
       max(v.publication_date)::text AS latest,
       count(*) FILTER (WHERE jsonb_array_length(v.claims)>0)::text AS claims,
       count(*) FILTER (WHERE length(COALESCE(v.description_text,''))>0)::text AS fulltext,
       max(v.legal_status_date)::text AS legal_through
       FROM patent_documents d JOIN patent_document_versions v ON v.id=d.active_version_id
       WHERE v.deleted=false GROUP BY v.jurisdiction`,
    )
    const last = await this.pool.query<{ id: string }>(
      "SELECT id FROM corpus_import_batches WHERE state='PUBLISHED' ORDER BY published_at DESC LIMIT 1",
    )
    const quarantine = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM corpus_import_batches WHERE state='QUARANTINED'",
    )
    const mapped = new Map(stats.rows.map((row) => [row.jurisdiction, row]))
    const baselines = await this.pool.query<BaselineRow>(
      `SELECT jurisdiction,
       bool_or(coverage_scope='historical-baseline') AS historical_baseline,
       max(period_end)::text AS coverage_through
       FROM corpus_import_batches WHERE state='PUBLISHED' GROUP BY jurisdiction`,
    )
    const baselineMap = new Map(baselines.rows.map((row) => [row.jurisdiction, row]))
    const jurisdictions = this.requiredJurisdictions.map((jurisdiction) =>
      coverage(jurisdiction, mapped.get(jurisdiction), baselineMap.get(jurisdiction)),
    )
    const vectorCoverage = active && active.documentCount ? active.vectorCount / active.documentCount : 0
    const coverageWarnings = jurisdictions.flatMap((item) => [
      ...(item.documents === 0 ? [`${item.jurisdiction} 语料缺失。`] : []),
      ...(item.documents > 0 && item.claimsCoverage < 0.8 ? [`${item.jurisdiction} 权利要求覆盖率低于 80%。`] : []),
      ...(item.documents > 0 && item.fullTextCoverage < 0.8 ? [`${item.jurisdiction} 全文覆盖率低于 80%。`] : []),
      ...(item.documents > 0 && !item.legalStatusThrough ? [`${item.jurisdiction} 缺少法律状态水位。`] : []),
      ...(!item.historicalBaseline ? [`${item.jurisdiction} 尚未声明并导入完整历史基线。`] : []),
      ...(!item.coverageThrough ? [`${item.jurisdiction} 缺少批次覆盖截止水位。`] : []),
    ])
    const warnings = [
      ...(!opensearchReady ? ["OpenSearch 不可用。"] : []),
      ...(!active ? ["尚未发布任何专利语料 generation。"] : []),
      ...(active && vectorCoverage < 0.9 ? ["向量索引覆盖率低于 90%。"] : []),
      ...coverageWarnings,
    ]
    const state = !active ? "EMPTY" : warnings.length ? "DEGRADED" : "READY"
    return {
      service: "chipmate-patent-server",
      apiVersion: "1.0.0",
      requiredJurisdictions: this.requiredJurisdictions,
      generation: active?.id ?? null,
      indexName: active?.indexName ?? null,
      state,
      publishedAt: active?.publishedAt ?? null,
      jurisdictions,
      vectorCoverage,
      warnings,
      lastSuccessfulBatch: last.rows[0]?.id ?? null,
      quarantinedBatches: Number(quarantine.rows[0]?.count ?? 0),
    }
  }

  async watermark(opensearchReady: boolean): Promise<CorpusWatermark> {
    const status = await this.status(opensearchReady)
    const {
      service: _service,
      apiVersion: _apiVersion,
      lastSuccessfulBatch: _batch,
      quarantinedBatches: _count,
      ...watermark
    } = status
    return watermark
  }

  async integrity(input: {
    batchId?: string
    generationId?: string
    severity: "INFO" | "WARNING" | "ERROR"
    code: string
    message: string
    details?: unknown
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO corpus_integrity_events(batch_id,generation_id,severity,code,message,details)
       VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        input.batchId ?? null,
        input.generationId ?? null,
        input.severity,
        input.code,
        input.message,
        JSON.stringify(input.details ?? {}),
      ],
    )
  }
}

function recordHash(record: NormalizedPatentRecord): string {
  const { sourceRecordId: _sourceRecordId, ...content } = record
  return sha256Text(stableJson(content))
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function document(row: VersionRow): PatentDocument {
  return {
    versionId: row.id,
    publicationNumber: row.publication_number,
    applicationNumber: row.application_number,
    jurisdiction: row.jurisdiction,
    kindCode: row.kind_code,
    language: row.language,
    title: row.title,
    abstract: row.abstract_text,
    description: row.description_text,
    filingDate: date(row.filing_date),
    priorityDate: date(row.priority_date),
    publicationDate: date(row.publication_date)!,
    familyId: row.family_id,
    familySource: row.family_source,
    legalStatus: row.legal_status,
    legalStatusDate: date(row.legal_status_date),
    applicants: jsonArray<string>(row.applicants),
    inventors: jsonArray<string>(row.inventors),
    classifications: jsonArray<string>(row.classifications),
    priorities: jsonArray<string>(row.priorities),
    citations: jsonArray<string>(row.citations),
    claims: jsonArray<PatentClaim>(row.claims),
    deleted: row.deleted,
    sourceBatch: row.source_batch,
    contentHash: row.content_hash,
  }
}

function date(value: string | Date | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function generation(row: GenerationRow): Generation {
  return {
    id: row.id,
    indexName: row.index_name,
    state: row.state,
    documentCount: Number(row.document_count),
    vectorCount: Number(row.vector_count),
    sourceBatch: row.source_batch,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
  }
}

function coverage(jurisdiction: Jurisdiction, row?: CoverageRow, baseline?: BaselineRow) {
  const documents = Number(row?.documents ?? 0)
  return {
    jurisdiction,
    documents,
    earliestPublicationDate: row?.earliest ?? null,
    latestPublicationDate: row?.latest ?? null,
    claimsCoverage: documents ? Number(row?.claims ?? 0) / documents : 0,
    fullTextCoverage: documents ? Number(row?.fulltext ?? 0) / documents : 0,
    legalStatusThrough: row?.legal_through ?? null,
    historicalBaseline: baseline?.historical_baseline === true,
    coverageThrough: baseline?.coverage_through ?? null,
  }
}

interface BaselineRow extends QueryResultRow {
  jurisdiction: Jurisdiction
  historical_baseline: boolean
  coverage_through: string | null
}

interface VersionRow extends QueryResultRow {
  id: string
  publication_number: string
  application_number: string | null
  jurisdiction: Jurisdiction
  kind_code: string | null
  language: string | null
  title: string | null
  abstract_text: string | null
  description_text: string | null
  filing_date: string | Date | null
  priority_date: string | Date | null
  publication_date: string | Date
  family_id: string | null
  family_source: "official" | "derived" | null
  legal_status: string | null
  legal_status_date: string | Date | null
  applicants: unknown
  inventors: unknown
  classifications: unknown
  priorities: unknown
  citations: unknown
  claims: unknown
  deleted: boolean
  source_batch: string
  content_hash: string
}

interface GenerationRow extends QueryResultRow {
  id: string
  index_name: string
  state: Generation["state"]
  document_count: string
  vector_count: string
  source_batch: string | null
  published_at: string | Date | null
}

interface CoverageRow extends QueryResultRow {
  jurisdiction: Jurisdiction
  documents: string
  earliest: string | null
  latest: string | null
  claims: string
  fulltext: string
  legal_through: string | null
}
