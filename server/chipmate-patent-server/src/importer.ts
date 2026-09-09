import path from "node:path"
import type { Config } from "./config.js"
import type { BatchMetrics, NormalizedPatentRecord, PatentDocument, SourceManifest } from "./contracts.js"
import { PatentDatabase } from "./database.js"
import { assertBatchIntegrity, createMetrics, validateRecords } from "./integrity.js"
import { OpenSearchStore } from "./opensearch.js"
import { PARSER_VERSION, parsePatentStream } from "./parser.js"
import { RawStore } from "./raw-store.js"
import { contentStreams, loadManifest } from "./source.js"

const CHUNK = 500

export interface ImportResult {
  batchId: string
  status: "published" | "duplicate" | "quarantined" | "unstable"
  report: string | null
  message: string
  metrics?: BatchMetrics
}

export class PatentImporter {
  readonly raw: RawStore

  constructor(
    private readonly config: Config,
    private readonly database: PatentDatabase,
    private readonly search: OpenSearchStore,
  ) {
    this.raw = new RawStore(config.dataRoot)
  }

  async initialize(): Promise<void> {
    await this.raw.initialize()
    await this.database.migrate()
  }

  async scan(): Promise<ImportResult[]> {
    const files = await this.raw.discover()
    const output: ImportResult[] = []
    for (const file of files) output.push(await this.import(file))
    return output
  }

  async import(file: string): Promise<ImportResult> {
    return this.database.withImportLock(() => this.importLocked(file))
  }

  private async importLocked(file: string): Promise<ImportResult> {
    const fallback = `UNIDENTIFIED-${path
      .basename(file)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 100)}`
    const metrics = createMetrics()
    let manifest: SourceManifest | undefined
    let preserved: Awaited<ReturnType<RawStore["preserve"]>> | undefined
    let started = false
    let generationId: string | undefined
    let generationRecorded = false
    try {
      if (!(await this.raw.stable(file))) {
        return { batchId: fallback, status: "unstable", report: null, message: "文件仍在复制，已留待下一轮扫描" }
      }
      preserved = await this.raw.preserve(file)
      manifest = await loadManifest(file)
      preserved = await this.raw.preserve(file, manifest)
      const batch = await this.database.beginBatch(
        manifest,
        { filename: path.basename(file), sha256: preserved.sha256, size: preserved.size },
        PARSER_VERSION,
      )
      if (batch === "duplicate") {
        await this.raw.complete(file, manifest.batchId)
        const report = await this.raw.report(manifest.batchId, {
          批次: manifest.batchId,
          状态: "重复内容",
          SHA256: preserved.sha256,
          说明: "相同内容已经进入导入记录，本次未重复写入。",
        })
        return { batchId: manifest.batchId, status: "duplicate", report, message: "相同 SHA-256 已导入，幂等跳过" }
      }
      if (batch === "blocked") {
        await this.raw.quarantine(file, manifest.batchId)
        const report = await this.raw.report(manifest.batchId, {
          批次: manifest.batchId,
          状态: "保持隔离",
          SHA256: preserved.sha256,
          说明: `相同内容已被当前解析器 ${PARSER_VERSION} 隔离。修正源包或升级解析器后才允许重试。`,
        })
        return { batchId: manifest.batchId, status: "quarantined", report, message: "失败内容未变化，保持隔离" }
      }
      started = true
      await this.assertSequence(manifest)
      const publications = new Set<string>()
      const duplicatePublications = new Set<string>()
      for await (const source of contentStreams(preserved.rawPath, manifest)) {
        const before = metrics.discoveredRecords
        let chunk: NormalizedPatentRecord[] = []
        for await (const record of parsePatentStream(source.name, source.stream, manifest.jurisdiction)) {
          if (publications.has(record.publicationNumber)) duplicatePublications.add(record.publicationNumber)
          publications.add(record.publicationNumber)
          chunk.push(record)
          if (chunk.length >= CHUNK) {
            await this.stage(manifest, chunk, metrics)
            chunk = []
          }
        }
        if (chunk.length) await this.stage(manifest, chunk, metrics)
        const discovered = metrics.discoveredRecords - before
        if (source.records !== undefined && discovered !== source.records) {
          throw new Error(`归档文件 ${source.name} 声明 ${source.records} 条，实际解析 ${discovered} 条`)
        }
      }
      if (duplicatePublications.size) {
        throw new Error(
          `批次内存在 ${duplicatePublications.size} 个重复公开号：${[...duplicatePublications].slice(0, 20).join(", ")}`,
        )
      }
      metrics.acceptedRecords -= metrics.duplicateRecords
      assertBatchIntegrity(manifest, metrics)
      await this.database.setBatchMetrics(manifest.batchId, metrics, "INDEXING")
      const activeCount = await this.database.activeCount()
      const expectedCount = await this.database.proposedCount(manifest.batchId)
      const allowedReduction = metrics.explicitDeletions
      if (expectedCount < activeCount - allowedReduction) {
        throw new Error(
          `更新后记录数从 ${activeCount} 降至 ${expectedCount}，下降量超过显式删除 ${allowedReduction}，已拒绝发布`,
        )
      }
      generationId = generation(manifest.batchId, preserved.sha256)
      const active = await this.database.activeGeneration()
      const indexed = await this.search.publish({ batchId: manifest.batchId, generationId, active, expectedCount })
      await this.database.createGeneration({
        id: generationId,
        indexName: indexed.indexName,
        documentCount: expectedCount,
        vectorCount: indexed.vectorCount,
        batchId: manifest.batchId,
        coverage: {
          批次地区: manifest.jurisdiction,
          解析记录: metrics.discoveredRecords,
          权利要求记录: metrics.claimsDocuments,
          全文记录: metrics.fullTextDocuments,
        },
        warnings: [],
      })
      generationRecorded = true
      await this.database.activateGeneration(generationId, manifest.batchId)
      await this.database
        .integrity({
          batchId: manifest.batchId,
          generationId,
          severity: "INFO",
          code: "BATCH_PUBLISHED",
          message: `批次通过完整性检查并发布 generation ${generationId}`,
          details: metrics,
        })
        .catch((error) =>
          console.error(
            `[Patent Server] 发布后完整性事件写入失败：${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      await this.raw
        .complete(file, manifest.batchId)
        .catch((error) =>
          console.error(
            `[Patent Server] 批次已发布但 drop 文件归档失败：${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      const report = await this.raw
        .report(manifest.batchId, reportBody(manifest, preserved.sha256, metrics, generationId))
        .catch((error) => {
          console.error(
            `[Patent Server] 批次已发布但中文报告写入失败：${error instanceof Error ? error.message : String(error)}`,
          )
          return null
        })
      return {
        batchId: manifest.batchId,
        status: "published",
        report,
        message: report ? "完整性检查和索引发布通过" : "索引已发布，但中文报告写入失败",
        metrics,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const batchId = manifest?.batchId ?? fallback
      if (generationRecorded && generationId)
        await this.database.failGeneration(generationId, message).catch(() => undefined)
      if (started) await this.database.quarantine(batchId, message, metrics).catch(() => undefined)
      await this.raw.quarantine(file, batchId).catch(() => undefined)
      const report = await this.raw
        .report(batchId, {
          批次: batchId,
          状态: "隔离",
          SHA256: preserved?.sha256 ?? "未计算",
          失败原因: message,
          完整性指标: metrics,
          说明: "在线 generation 未切换；原始内容已按 SHA-256 保留。",
        })
        .catch(() => null)
      return { batchId, status: "quarantined", report, message, metrics }
    }
  }

  private async stage(
    manifest: SourceManifest,
    records: NormalizedPatentRecord[],
    metrics: BatchMetrics,
  ): Promise<void> {
    const current = await this.database.getDocuments(records.map((item) => item.publicationNumber).filter(Boolean))
    const existing = new Map(current.map((item) => [item.publicationNumber, normalized(item)]))
    const accepted = validateRecords(manifest, records, existing, metrics)
    const staged = await this.database.stageRecords(manifest.batchId, accepted)
    metrics.acceptedRecords += staged.accepted + staged.duplicates
    metrics.duplicateRecords += staged.duplicates
    await this.database.setBatchMetrics(manifest.batchId, metrics, "STAGING")
  }

  private async assertSequence(manifest: SourceManifest): Promise<void> {
    if (manifest.coverageScope === "historical-baseline") {
      if (!manifest.periodStart || !manifest.periodEnd || manifest.declaredRecords === undefined) {
        throw new Error("历史基线批次必须声明 periodStart、periodEnd 和 declaredRecords")
      }
      return
    }
    if (manifest.coverageScope === "incremental" && manifest.sequence === undefined) {
      throw new Error("增量批次必须声明连续 sequence")
    }
    if (manifest.sequence === undefined) return
    const latest = await this.database.latestPublishedSequence(manifest.source, manifest.jurisdiction)
    if (manifest.coverageScope === "incremental" && latest === null && manifest.sequence !== 1) {
      throw new Error(`首个增量批次序号必须为 1，收到 ${manifest.sequence}`)
    }
    if (latest !== null && manifest.sequence !== latest + 1) {
      throw new Error(`增量批次序号断档：当前最新为 ${latest}，收到 ${manifest.sequence}，预期 ${latest + 1}`)
    }
  }
}

function normalized(value: PatentDocument): NormalizedPatentRecord {
  const { versionId: _versionId, sourceBatch: _sourceBatch, contentHash: _contentHash, ...record } = value
  return { ...record, sourceRecordId: value.publicationNumber }
}

function generation(batchId: string, hash: string): string {
  const safe = batchId
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}-${Date.now().toString(36)}-${safe}-${hash.slice(0, 10)}`
}

function reportBody(manifest: SourceManifest, sha256: string, metrics: BatchMetrics, generationId: string) {
  return {
    批次: manifest.batchId,
    来源: manifest.source,
    地区: manifest.jurisdiction,
    数据类型: manifest.dataType,
    状态: "已发布",
    SHA256: sha256,
    Generation: generationId,
    完整性指标: metrics,
    发布说明: "新 generation 已完成记录数校验并成为在线版本，历史原始包和规范化版本仍保留。",
  }
}

export async function watch(importer: PatentImporter, intervalMs = 30_000): Promise<never> {
  for (;;) {
    const results = await importer.scan().catch((error) => {
      console.error(`[Patent Server] 导入扫描失败：${error instanceof Error ? error.message : String(error)}`)
      return []
    })
    for (const result of results) console.log(`[Patent Server] ${result.batchId}: ${result.status} - ${result.message}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
