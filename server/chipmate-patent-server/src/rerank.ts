import type { Config } from "./config.js"

interface Response {
  results?: Array<{ index?: number; relevance_score?: number; score?: number }>
  data?: Array<{ index?: number; relevance_score?: number; score?: number }>
}

export interface RerankRow {
  index: number
  score: number
}

export class RerankClient {
  constructor(private readonly config?: Config["rerank"]) {}

  get enabled() {
    return Boolean(this.config)
  }

  async rank(query: string, documents: string[]) {
    if (!this.config || !documents.length) return []
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        ...(this.config.model ? { model: this.config.model } : {}),
        query,
        documents,
        top_n: documents.length,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`Rerank 服务返回 HTTP ${response.status}`)
    const body = (await response.json()) as Response
    const rows = body.results ?? body.data ?? []
    const seen = new Set<number>()
    return rows.flatMap((row) => {
      const index = row.index
      const score = row.relevance_score ?? row.score
      if (
        !Number.isSafeInteger(index) ||
        index! < 0 ||
        index! >= documents.length ||
        !Number.isFinite(score) ||
        seen.has(index!)
      ) {
        return []
      }
      seen.add(index!)
      return [{ index: index!, score: score! }]
    })
  }
}

export function completeRanking(length: number, rows: RerankRow[]) {
  const returned = new Set(rows.map((row) => row.index))
  return [
    ...rows.map((row) => ({ index: row.index, score: row.score as number | null })),
    ...Array.from({ length }, (_value, index) => index)
      .filter((index) => !returned.has(index))
      .map((index) => ({ index, score: null as number | null })),
  ]
}
