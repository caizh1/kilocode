import type { Config } from "./config.js"
import type {
  CorpusWatermark,
  PatentDocument,
  PatentHit,
  PatentPassage,
  PatentSearchRequest,
  PatentSearchResponse,
} from "./contracts.js"
import type { PatentDatabase, Generation } from "./database.js"
import { EmbeddingClient, embeddingText } from "./embedding.js"
import { completeRanking, RerankClient } from "./rerank.js"

const ALIAS = "chipmate-patents-current"
const PAGE = 250

interface SearchRow {
  _id: string
  _score?: number
  _source: IndexedPatent
  highlight?: Record<string, string[]>
}

interface IndexedPatent {
  publicationNumber: string
  jurisdiction: string
  kindCode: string | null
  language: string | null
  title: string | null
  abstract: string | null
  description?: string | null
  claimText: string
  claims: Array<{ number: string; independent: boolean | null; language: string | null; text: string }>
  classifications: string[]
  citations: string[]
  applicants: string[]
  familyId: string | null
  familySource: string | null
  filingDate: string | null
  priorityDate: string | null
  publicationDate: string
  legalStatus: string | null
  legalStatusDate: string | null
  sourceBatch: string
  versionId: string
  embedding?: number[]
}

export class OpenSearchStore {
  private readonly embedding: EmbeddingClient
  private readonly rerank: RerankClient

  constructor(
    private readonly config: Config,
    private readonly database: PatentDatabase,
  ) {
    this.embedding = new EmbeddingClient(config.embedding)
    this.rerank = new RerankClient(undefined)
  }

  async health(): Promise<boolean> {
    return this.request("GET", "/_cluster/health", undefined, false)
      .then(() => true)
      .catch(() => false)
  }

  async publish(input: {
    batchId: string
    generationId: string
    active: Generation | null
    expectedCount: number
  }): Promise<{ indexName: string; vectorCount: number }> {
    const indexName = `chipmate-patents-${input.generationId.toLowerCase()}`
    const dimension = await this.embedding.probe()
    await this.createIndex(indexName, dimension)
    try {
      if (input.active) {
        await this.request("POST", "/_reindex?wait_for_completion=true&refresh=true", {
          source: { index: input.active.indexName },
          dest: { index: indexName, op_type: "create" },
          conflicts: "proceed",
        })
        await this.indexDocuments(indexName, await this.database.recordsForBatch(input.batchId))
      } else {
        for (let offset = 0; ; offset += PAGE) {
          const records = await this.database.proposedDocuments(input.batchId, offset, PAGE)
          if (!records.length) break
          await this.indexDocuments(indexName, records)
        }
      }
      await this.request("POST", `/${encodeURIComponent(indexName)}/_refresh`)
      const count = await this.count(indexName)
      if (count !== input.expectedCount) {
        throw new Error(`索引记录数 ${count} 与规范化库预期 ${input.expectedCount} 不一致`)
      }
      const vectorCount = dimension ? await this.vectorCount(indexName) : 0
      await this.swapAlias(indexName)
      return { indexName, vectorCount }
    } catch (error) {
      await this.request("DELETE", `/${encodeURIComponent(indexName)}`, undefined, false).catch(() => undefined)
      throw error
    }
  }

  async search(request: PatentSearchRequest, watermark: CorpusWatermark): Promise<PatentSearchResponse> {
    if (!watermark.indexName || (watermark.state !== "READY" && !this.config.allowIncompleteCorpusSearch)) {
      throw new Error("专利语料尚未就绪")
    }
    const limit = Math.min(Math.max(request.limit ?? 50, 1), 100)
    const fetchSize = Math.min(limit * 3, 300)
    const query = request.queries
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n")
    const filter = filters(request)
    const lexical = await this.lexical(watermark.indexName, query, filter, fetchSize, request.classifications ?? [])
    const vector = this.embedding.enabled ? await this.semantic(watermark.indexName, query, filter, fetchSize) : []
    let citationFailed = false
    const citation = await this.citation(watermark.indexName, [...lexical, ...vector], filter, fetchSize).catch(() => {
      citationFailed = true
      return []
    })
    const fused = fuse(lexical, vector, citation)
    let rerankFailed = false
    const ranked = this.rerank.enabled
      ? await this.rerank
          .rank(
            query,
            fused.slice(0, 100).map((item) => searchText(item.row._source)),
          )
          .then((rows) => {
            if (fused.length && !rows.length) throw new Error("Rerank 未返回有效结果")
            return completeRanking(fused.length, rows).map((row) => ({ ...fused[row.index]!, rerank: row.score }))
          })
          .catch(() => {
            rerankFailed = true
            return fused.map((item) => ({ ...item, rerank: null }))
          })
      : fused.map((item) => ({ ...item, rerank: null }))
    const hits = collapse(
      ranked.map(
        ({
          row,
          lexical: lexicalScore,
          vector: vectorScore,
          citation: citationScore,
          fused: fusedScore,
          rerank: rerankScore,
        }) => hit(row, lexicalScore, vectorScore, citationScore, fusedScore, rerankScore),
      ),
      request.familyCollapse !== false,
      limit,
    )
    return {
      hits,
      watermark,
      searchedAt: new Date().toISOString(),
      warnings: [
        ...(watermark.state !== "READY" ? ["当前为不完整语料试运行检索，结果不得用于正面新颖性结论。"] : []),
        ...(!this.embedding.enabled ? ["向量检索未配置，本次仅执行字段化全文检索。"] : []),
        ...(this.embedding.enabled && vector.length === 0 ? ["向量检索未返回结果，已保留全文检索结果。"] : []),
        ...(citationFailed ? ["引用扩展检索失败，已保留全文与向量召回结果。"] : []),
        ...(!this.rerank.enabled ? ["Rerank 模式为 off，本次固定按混合召回融合分数排序。"] : []),
        ...(rerankFailed ? ["Rerank 调用失败，已保留混合召回融合排序。"] : []),
      ],
    }
  }

  private async createIndex(indexName: string, dimension: number | null): Promise<void> {
    await this.request("PUT", `/${encodeURIComponent(indexName)}`, {
      settings: {
        index: {
          number_of_shards: 1,
          number_of_replicas: 0,
          refresh_interval: "30s",
          ...(dimension ? { knn: true } : {}),
        },
      },
      mappings: {
        dynamic: "strict",
        properties: {
          publicationNumber: { type: "keyword" },
          jurisdiction: { type: "keyword" },
          kindCode: { type: "keyword" },
          language: { type: "keyword" },
          title: { type: "text" },
          abstract: { type: "text" },
          description: { type: "text" },
          claimText: { type: "text" },
          claims: {
            type: "nested",
            properties: {
              number: { type: "keyword" },
              independent: { type: "boolean" },
              language: { type: "keyword" },
              text: { type: "text" },
            },
          },
          classifications: { type: "keyword" },
          citations: { type: "keyword" },
          applicants: { type: "keyword" },
          familyId: { type: "keyword" },
          familySource: { type: "keyword" },
          filingDate: { type: "date", format: "strict_date_optional_time||yyyy-MM-dd" },
          priorityDate: { type: "date", format: "strict_date_optional_time||yyyy-MM-dd" },
          publicationDate: { type: "date", format: "strict_date_optional_time||yyyy-MM-dd" },
          legalStatus: { type: "keyword" },
          legalStatusDate: { type: "date", format: "strict_date_optional_time||yyyy-MM-dd" },
          sourceBatch: { type: "keyword" },
          versionId: { type: "keyword" },
          ...(dimension
            ? {
                embedding: {
                  type: "knn_vector",
                  dimension,
                  method: { name: "hnsw", engine: "lucene", space_type: "cosinesimil" },
                },
              }
            : {}),
        },
      },
    })
  }

  private async indexDocuments(indexName: string, records: PatentDocument[]): Promise<void> {
    const active = records.filter((record) => !record.deleted)
    const vectors = this.embedding.enabled
      ? await batched(
          active.map((record) => embeddingText(record)),
          32,
          (items) => this.embedding.embed(items),
        )
      : []
    const vectorById = new Map(active.map((record, index) => [record.publicationNumber, vectors[index]]))
    const lines: string[] = []
    for (const record of records) {
      if (record.deleted) {
        lines.push(JSON.stringify({ delete: { _index: indexName, _id: record.publicationNumber } }))
        continue
      }
      lines.push(JSON.stringify({ index: { _index: indexName, _id: record.publicationNumber } }))
      lines.push(JSON.stringify(indexed(record, vectorById.get(record.publicationNumber))))
    }
    if (!lines.length) return
    const response = await this.request<{ errors?: boolean; items?: unknown[] }>(
      "POST",
      "/_bulk?refresh=false",
      `${lines.join("\n")}\n`,
      true,
      "application/x-ndjson",
    )
    if (response.errors) throw new Error("OpenSearch bulk 写入存在失败项")
  }

  private async lexical(
    indexName: string,
    query: string,
    filter: unknown[],
    size: number,
    classifications: string[],
  ): Promise<SearchRow[]> {
    const body = await this.request<{ hits?: { hits?: SearchRow[] } }>("POST", `/${indexName}/_search`, {
      size,
      track_total_hits: false,
      _source: { excludes: ["description", "embedding"] },
      query: {
        bool: {
          filter,
          should: [
            {
              multi_match: {
                query,
                fields: ["title^6", "abstract^4", "claimText^5", "description", "classifications^2"],
                type: "best_fields",
                operator: "or",
                minimum_should_match: "35%",
              },
            },
            { match_phrase: { claimText: { query, boost: 3 } } },
            { match_phrase: { abstract: { query, boost: 2 } } },
            ...classifications
              .map((item) => item.replace(/\s+/g, "").trim())
              .filter(Boolean)
              .map((item) => ({ prefix: { classifications: { value: item, boost: 1.5 } } })),
          ],
          minimum_should_match: 1,
        },
      },
      highlight: {
        pre_tags: [""],
        post_tags: [""],
        fragment_size: 360,
        number_of_fragments: 3,
        fields: { title: {}, abstract: {}, claimText: {}, description: {} },
      },
    })
    return body.hits?.hits ?? []
  }

  private async semantic(indexName: string, query: string, filter: unknown[], size: number): Promise<SearchRow[]> {
    const vector = (await this.embedding.embed([query]))[0]
    if (!vector) return []
    const body = await this.request<{ hits?: { hits?: SearchRow[] } }>("POST", `/${indexName}/_search`, {
      size,
      track_total_hits: false,
      _source: { excludes: ["description", "embedding"] },
      query: {
        bool: {
          filter,
          must: [{ knn: { embedding: { vector, k: size } } }],
        },
      },
    })
    return body.hits?.hits ?? []
  }

  private async citation(indexName: string, seeds: SearchRow[], filter: unknown[], size: number): Promise<SearchRow[]> {
    const rows = [...new Map(seeds.slice(0, 40).map((row) => [row._id, row])).values()]
    const publications = rows.map((row) => row._source.publicationNumber)
    const citations = [...new Set(rows.flatMap((row) => row._source.citations))].slice(0, 500)
    if (!publications.length) return []
    const body = await this.request<{ hits?: { hits?: SearchRow[] } }>("POST", `/${indexName}/_search`, {
      size,
      track_total_hits: false,
      _source: { excludes: ["description", "embedding"] },
      query: {
        bool: {
          filter,
          should: [
            ...(citations.length ? [{ terms: { publicationNumber: citations } }] : []),
            { terms: { citations: publications } },
          ],
          minimum_should_match: 1,
        },
      },
    })
    return body.hits?.hits ?? []
  }

  private async count(indexName: string): Promise<number> {
    const body = await this.request<{ count?: number }>("GET", `/${encodeURIComponent(indexName)}/_count`)
    return body.count ?? 0
  }

  private async vectorCount(indexName: string): Promise<number> {
    const body = await this.request<{ count?: number }>("POST", `/${encodeURIComponent(indexName)}/_count`, {
      query: { exists: { field: "embedding" } },
    })
    return body.count ?? 0
  }

  private async swapAlias(indexName: string): Promise<void> {
    await this.request("POST", "/_aliases", {
      actions: [
        { remove: { index: "chipmate-patents-*", alias: ALIAS, must_exist: false } },
        { add: { index: indexName, alias: ALIAS } },
      ],
    })
  }

  private async request<T = unknown>(
    method: string,
    pathname: string,
    body?: unknown,
    required = true,
    contentType = "application/json",
  ): Promise<T> {
    const response = await fetch(`${this.config.opensearchUrl}${pathname}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": contentType }),
        ...(this.config.opensearchUsername
          ? {
              authorization: `Basic ${Buffer.from(`${this.config.opensearchUsername}:${this.config.opensearchPassword ?? ""}`).toString("base64")}`,
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) {
      const text = (await response.text()).slice(0, 2_000)
      if (!required) throw new Error(`OpenSearch HTTP ${response.status}`)
      throw new Error(`OpenSearch ${method} ${pathname} 返回 HTTP ${response.status}：${text}`)
    }
    const text = await response.text()
    return (text ? JSON.parse(text) : {}) as T
  }
}

function indexed(record: PatentDocument, embedding?: number[]): IndexedPatent {
  return {
    publicationNumber: record.publicationNumber,
    jurisdiction: record.jurisdiction,
    kindCode: record.kindCode,
    language: record.language,
    title: record.title,
    abstract: record.abstract,
    description: record.description,
    claimText: record.claims.map((claim) => claim.text).join("\n"),
    claims: record.claims,
    classifications: record.classifications,
    citations: record.citations,
    applicants: record.applicants,
    familyId: record.familyId,
    familySource: record.familySource,
    filingDate: record.filingDate,
    priorityDate: record.priorityDate,
    publicationDate: record.publicationDate,
    legalStatus: record.legalStatus,
    legalStatusDate: record.legalStatusDate,
    sourceBatch: record.sourceBatch,
    versionId: record.versionId,
    ...(embedding ? { embedding } : {}),
  }
}

function filters(request: PatentSearchRequest): unknown[] {
  return [
    ...(request.cutoffDate ? [{ range: { publicationDate: { lte: request.cutoffDate } } }] : []),
    ...(request.jurisdictions?.length ? [{ terms: { jurisdiction: request.jurisdictions } }] : []),
    ...(request.languages?.length ? [{ terms: { language: request.languages } }] : []),
  ]
}

function fuse(lexical: SearchRow[], vector: SearchRow[], citation: SearchRow[]) {
  const rows = new Map<
    string,
    { row: SearchRow; lexical: number | null; vector: number | null; citation: number | null; fused: number }
  >()
  lexical.forEach((row, index) => {
    rows.set(row._id, { row, lexical: row._score ?? null, vector: null, citation: null, fused: 1 / (60 + index + 1) })
  })
  vector.forEach((row, index) => {
    const existing = rows.get(row._id)
    if (existing) {
      existing.vector = row._score ?? null
      existing.fused += 1 / (60 + index + 1)
      return
    }
    rows.set(row._id, { row, lexical: null, vector: row._score ?? null, citation: null, fused: 1 / (60 + index + 1) })
  })
  citation.forEach((row, index) => {
    const existing = rows.get(row._id)
    if (existing) {
      existing.citation = row._score ?? 1
      existing.fused += 1 / (60 + index + 1)
      return
    }
    rows.set(row._id, { row, lexical: null, vector: null, citation: row._score ?? 1, fused: 1 / (60 + index + 1) })
  })
  return [...rows.values()].sort((left, right) => right.fused - left.fused)
}

function hit(
  row: SearchRow,
  lexical: number | null,
  vector: number | null,
  citation: number | null,
  fused: number,
  rerank: number | null,
): PatentHit {
  const source = row._source
  return {
    publicationNumber: source.publicationNumber,
    jurisdiction: source.jurisdiction as PatentHit["jurisdiction"],
    kindCode: source.kindCode,
    title: source.title,
    familyId: source.familyId,
    familySource: source.familySource as PatentHit["familySource"],
    filingDate: source.filingDate,
    priorityDate: source.priorityDate,
    publicationDate: source.publicationDate,
    legalStatus: source.legalStatus,
    legalStatusDate: source.legalStatusDate,
    classifications: source.classifications,
    passages: passages(row),
    scores: { lexical, vector, citation, fused, rerank },
    sourceBatch: source.sourceBatch,
    versionId: source.versionId,
  }
}

function searchText(source: IndexedPatent) {
  return [
    source.title,
    source.abstract,
    ...source.claims.filter((claim) => claim.independent !== false).map((claim) => claim.text),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12_000)
}

function passages(row: SearchRow): PatentPassage[] {
  const map: Record<string, PatentPassage["field"]> = {
    title: "title",
    abstract: "abstract",
    claimText: "claim",
    description: "description",
  }
  const highlighted = Object.entries(row.highlight ?? {}).flatMap(([field, values]) =>
    (values ?? []).map((text, index) => {
      const clean = text.replace(/<[^>]+>/g, "").slice(0, 1_200)
      const claim = field === "claimText" ? row._source.claims.find((item) => item.text.includes(clean)) : undefined
      return {
        field: map[field] ?? "description",
        locator: claim ? `claim:${claim.number}` : `${field}:${index + 1}`,
        text: clean,
      }
    }),
  )
  const fallback = [
    ...(row._source.title
      ? [{ field: "title" as const, locator: "title", text: row._source.title.slice(0, 1_200) }]
      : []),
    ...(row._source.abstract
      ? [{ field: "abstract" as const, locator: "abstract", text: row._source.abstract.slice(0, 1_200) }]
      : []),
    ...row._source.claims
      .filter((claim) => claim.independent !== false)
      .slice(0, 5)
      .map((claim) => ({
        field: "claim" as const,
        locator: `claim:${claim.number}`,
        text: claim.text.slice(0, 1_200),
      })),
  ]
  const seen = new Set<string>()
  return [...highlighted, ...fallback]
    .filter((item) => {
      const key = `${item.locator}:${item.text}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 8)
}

function collapse(hits: PatentHit[], enabled: boolean, limit: number): PatentHit[] {
  if (!enabled) return hits.slice(0, limit)
  const seen = new Set<string>()
  return hits
    .filter((item) => {
      const key = item.familyId || item.publicationNumber
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

async function batched<T, R>(items: T[], size: number, run: (batch: T[]) => Promise<R[]>): Promise<R[]> {
  const output: R[] = []
  for (let index = 0; index < items.length; index += size) output.push(...(await run(items.slice(index, index + size))))
  return output
}
