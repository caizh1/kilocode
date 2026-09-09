import type { Config } from "./config.js"

interface EmbeddingResponse {
  data?: Array<{ index?: number; embedding?: number[] }>
}

export class EmbeddingClient {
  private dimension: number | null = null

  constructor(private readonly config?: Config["embedding"]) {}

  get enabled(): boolean {
    return Boolean(this.config)
  }

  async probe(): Promise<number | null> {
    if (!this.config) return null
    if (this.dimension) return this.dimension
    const vectors = await this.embed(["ChipMate 专利索引维度探测"])
    const dimension = vectors[0]?.length
    if (!dimension) throw new Error("Embedding 服务未返回有效向量")
    this.dimension = dimension
    return dimension
  }

  async embed(inputs: string[]): Promise<number[][]> {
    if (!this.config) return []
    if (!inputs.length) return []
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.config.model, input: inputs }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`Embedding 服务返回 HTTP ${response.status}`)
    const body = (await response.json()) as EmbeddingResponse
    const rows = [...(body.data ?? [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    if (rows.length !== inputs.length) throw new Error(`Embedding 返回 ${rows.length} 条，预期 ${inputs.length} 条`)
    const vectors = rows.map((row) => row.embedding ?? [])
    const dimension = vectors[0]?.length ?? 0
    if (
      !dimension ||
      vectors.some((vector) => vector.length !== dimension || vector.some((value) => !Number.isFinite(value)))
    ) {
      throw new Error("Embedding 返回的向量维度或数值无效")
    }
    if (this.dimension && this.dimension !== dimension) {
      throw new Error(`Embedding 维度从 ${this.dimension} 变化为 ${dimension}，已停止写入`)
    }
    this.dimension = dimension
    return vectors
  }
}

export function embeddingText(input: {
  title: string | null
  abstract: string | null
  claims: Array<{ independent: boolean | null; text: string }>
}): string {
  const claims = input.claims.filter((claim) => claim.independent !== false).map((claim) => claim.text)
  return [input.title, input.abstract, ...claims].filter(Boolean).join("\n").slice(0, 24_000)
}
