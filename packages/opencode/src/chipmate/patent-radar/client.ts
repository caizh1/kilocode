import { z } from "zod"
import { PatentRadar } from "./types"

const Status = z.object({
  state: z.string(),
  generation: z.string().nullable(),
  publishedAt: z.string().nullable(),
  vectorCoverage: z.number(),
  warnings: z.array(z.string()),
  requiredJurisdictions: z.array(z.string()).optional(),
  jurisdictions: z.array(
    z.object({
      jurisdiction: z.string(),
      documents: z.number(),
      latestPublicationDate: z.string().nullable(),
      legalStatusThrough: z.string().nullable(),
      claimsCoverage: z.number(),
      fullTextCoverage: z.number(),
      historicalBaseline: z.boolean(),
      coverageThrough: z.string().nullable(),
    }),
  ),
})

const Search = z.object({
  hits: z.array(
    z.object({
      publicationNumber: z.string(),
      jurisdiction: z.string(),
      title: z.string().nullable(),
      familyId: z.string().nullable(),
      priorityDate: z.string().nullable(),
      publicationDate: z.string().nullable(),
      legalStatus: z.string().nullable(),
      classifications: z.array(z.string()),
      passages: z.array(PatentRadar.PatentPassage),
      scores: z.object({
        lexical: z.number().nullable(),
        vector: z.number().nullable(),
        citation: z.number().nullable(),
        fused: z.number(),
        rerank: z.number().nullable(),
      }),
      sourceBatch: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
})

export class PatentServerClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    const url = new URL(baseUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Patent Server 只允许使用 HTTP 或 HTTPS")
    this.baseUrl = url.toString().replace(/\/$/, "")
  }

  async status(
    abort?: AbortSignal,
  ): Promise<{ watermark: PatentRadar.CorpusWatermark; warnings: string[]; vectorCoverage: number }> {
    const value = Status.parse(await this.request("/api/v1/corpus/status", undefined, abort))
    return {
      watermark: {
        status: value.state,
        generation: value.generation,
        indexedAt: value.publishedAt,
        requiredJurisdictions: value.requiredJurisdictions,
        jurisdictions: value.jurisdictions.map((item) => ({
          jurisdiction: item.jurisdiction,
          records: item.documents,
          dataThrough: item.latestPublicationDate,
          legalStatusThrough: item.legalStatusThrough,
          claimsCoverage: item.claimsCoverage,
          fullTextCoverage: item.fullTextCoverage,
          historicalBaseline: item.historicalBaseline,
          coverageThrough: item.coverageThrough,
        })),
      },
      warnings: value.warnings,
      vectorCoverage: value.vectorCoverage,
    }
  }

  async search(candidate: PatentRadar.Candidate, cutoffDate: string, abort?: AbortSignal) {
    const responses: z.infer<typeof Search>[] = []
    for (const query of technicalQueries(candidate)) {
      responses.push(
        Search.parse(
          await this.request(
            "/api/v1/search",
            {
              queries: [query],
              cutoffDate,
              classifications: candidate.ipcHints,
              familyCollapse: true,
              limit: 50,
            },
            abort,
          ),
        ),
      )
    }
    return mergeSearchResponses(responses, 50)
  }

  private async request(endpoint: string, body?: unknown, abort?: AbortSignal): Promise<unknown> {
    const signal = abort ? AbortSignal.any([abort, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
    const response = await fetch(new URL(endpoint, `${this.baseUrl.replace(/\/$/, "")}/`), {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Patent Server ${endpoint} 返回 ${response.status}：${text.slice(0, 500)}`)
    }
    return response.json()
  }
}

export function technicalQueries(candidate: PatentRadar.Candidate): string[] {
  const features = candidate.features.filter((item) => item.necessary).map((item) => item.text)
  const pairs = features.flatMap((left, index) => features.slice(index + 1).map((right) => `${left}；${right}`))
  return [
    ...new Set(
      [
        ...features,
        ...pairs,
        features.join("；"),
        `${candidate.technicalProblem}；${candidate.abstractMechanism || candidate.implementation}`,
        `${candidate.keywords.join("；")}；${candidate.technicalEffect}`,
      ]
        .map((item) => item.trim().slice(0, 2_000))
        .filter(Boolean),
    ),
  ].slice(0, 32)
}

function mergeSearchResponses(responses: z.infer<typeof Search>[], limit: number) {
  const rows = new Map<
    string,
    {
      hit: z.infer<typeof Search>["hits"][number]
      fused: number
      lexical: number
      vector: number
      citation: number
    }
  >()
  for (const response of responses) {
    response.hits.forEach((hit, index) => {
      const current = rows.get(hit.publicationNumber)
      const rank = 1 / (60 + index + 1)
      rows.set(hit.publicationNumber, {
        hit: current?.hit ?? hit,
        fused: (current?.fused ?? 0) + rank,
        lexical: Math.max(current?.lexical ?? 0, hit.scores.lexical ?? 0),
        vector: Math.max(current?.vector ?? 0, hit.scores.vector ?? 0),
        citation: Math.max(current?.citation ?? 0, hit.scores.citation ?? 0),
      })
    })
  }
  const families = new Set<string>()
  const hits = [...rows.values()]
    .sort(
      (left, right) =>
        right.fused - left.fused || left.hit.publicationNumber.localeCompare(right.hit.publicationNumber),
    )
    .flatMap((item) => {
      const family = item.hit.familyId || item.hit.publicationNumber
      if (families.has(family)) return []
      families.add(family)
      return [
        {
          ...item.hit,
          score: item.fused,
          scores: {
            lexical: item.lexical,
            vector: item.vector,
            citation: item.citation,
            fused: item.fused,
            rerank: null,
          },
        },
      ]
    })
    .slice(0, limit)
  return {
    warnings: [...new Set(responses.flatMap((response) => response.warnings))],
    hits,
  } satisfies { warnings: string[]; hits: PatentRadar.PatentHit[] }
}
