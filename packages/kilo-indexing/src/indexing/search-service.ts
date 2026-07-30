import path from "path"
import type { VectorStoreSearchResult } from "./interfaces"
import type { IEmbedder } from "./interfaces/embedder"
import type { IVectorStore } from "./interfaces/vector-store"
import type { CodeIndexConfigManager } from "./config-manager"
import type { CodeIndexStateManager } from "./state-manager"
import { Log } from "../util/log"
import type { WorktreeOverlay } from "./worktree-overlay"

interface BaselineSearch {
  store: IVectorStore
  overlay: WorktreeOverlay
}

const log = Log.create({ service: "indexing-search" })

function symbol(query: string): string | undefined {
  const token = query.trim()
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(token) ? token : undefined
}

function rank(query: string, results: VectorStoreSearchResult[]): VectorStoreSearchResult[] {
  const token = symbol(query)
  if (!token) return results
  const pattern = new RegExp(`\\b${token}\\b`)
  const body = new RegExp(`\\b${token}\\s*\\([^;{}]*\\)\\s*\\{`, "s")
  return results
    .map((item, index) => ({
      item,
      index,
      exact: pattern.test(item.payload?.codeChunk ?? ""),
      body: body.test(item.payload?.codeChunk ?? ""),
    }))
    .sort(
      (left, right) =>
        Number(right.body) - Number(left.body) || Number(right.exact) - Number(left.exact) || left.index - right.index,
    )
    .map((entry) => entry.item)
}

export class CodeIndexSearchService {
  constructor(
    private readonly configManager: CodeIndexConfigManager,
    private readonly stateManager: CodeIndexStateManager,
    private readonly embedder: IEmbedder,
    private readonly vectorStore: IVectorStore,
    private readonly baseline?: BaselineSearch,
  ) {}

  private allowed(result: VectorStoreSearchResult, extensions: ReadonlySet<string>): boolean {
    const file = result.payload?.filePath
    if (typeof file !== "string") return false
    return extensions.has(path.extname(file).toLowerCase())
  }

  public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    return this.searchIndexForEvidence(query, directoryPrefix)
  }

  public async searchIndexForEvidence(
    query: string,
    directoryPrefix?: string,
    options: { maxResults?: number } = {},
  ): Promise<VectorStoreSearchResult[]> {
    if (!this.configManager.isFeatureEnabled || !this.configManager.isFeatureConfigured) {
      throw new Error("Code index feature is disabled or not configured.")
    }

    const minScore = this.configManager.currentSearchMinScore
    const maxResults = options.maxResults ?? this.configManager.currentSearchMaxResults
    const ceiling = Math.max(maxResults, Math.min(maxResults * 16, 1000))
    const limit = symbol(query) ? ceiling : maxResults

    const currentState = this.stateManager.getCurrentStatus().systemStatus
    const fallback = currentState === "Error" ? await this.vectorStore.hasIndexedData() : false
    if (currentState !== "Indexed" && currentState !== "Indexing" && !fallback) {
      throw new Error(`Code index is not ready for search. Current state: ${currentState}`)
    }

    try {
      const embeddingResponse = await this.embedder.createEmbeddings([query], undefined, "code-query")
      const vector = embeddingResponse?.embeddings[0]
      if (!vector) {
        throw new Error("Failed to generate embedding for query.")
      }

      const normalizedPrefix = directoryPrefix ? path.normalize(directoryPrefix) : undefined
      const extensions = new Set(this.configManager.getConfig().fileExtensions)
      if (!this.baseline) {
        const results = await this.vectorStore.search(vector, normalizedPrefix, minScore, limit)
        return rank(
          query,
          results.filter((result) => this.allowed(result, extensions)),
        ).slice(0, maxResults)
      }
      if (!this.baseline.overlay.ready) throw new Error("Worktree index reconciliation is not complete.")

      const delta = (async () => {
        const search = async (limit: number): Promise<VectorStoreSearchResult[]> => {
          const results = await this.vectorStore.search(vector, normalizedPrefix, minScore, limit)
          const filtered = results.filter((result) => this.baseline!.overlay.deltaResult(result))
          if (filtered.length >= maxResults || results.length < limit || limit >= ceiling) return filtered
          return search(Math.min(limit * 2, ceiling))
        }
        return search(limit)
      })()
      const base = (async () => {
        const checks = new Map<string, Promise<boolean>>()
        const search = async (limit: number): Promise<VectorStoreSearchResult[]> => {
          const results = await this.baseline!.store.search(vector, normalizedPrefix, minScore, limit)
          const accepted = await Promise.all(
            results.map((result) => this.baseline!.overlay.baselineResult(result, checks)),
          )
          const filtered = results.filter((_, index) => accepted[index])
          if (filtered.length >= maxResults || results.length < limit || limit >= ceiling) return filtered
          return search(Math.min(limit * 2, ceiling))
        }
        return search(limit)
      })()
      const [baseline, current] = await Promise.all([base, delta])
      const merged = new Map<string, VectorStoreSearchResult>()
      const key = (result: VectorStoreSearchResult) =>
        [result.payload?.filePath, result.payload?.startLine, result.payload?.endLine, result.payload?.codeChunk].join(
          "\0",
        )

      for (const result of baseline) {
        if (this.allowed(result, extensions)) merged.set(key(result), result)
      }
      for (const result of current) {
        if (this.allowed(result, extensions) && this.baseline.overlay.deltaResult(result))
          merged.set(key(result), result)
      }
      return rank(
        query,
        [...merged.values()].sort((left, right) => right.score - left.score),
      ).slice(0, maxResults)
    } catch (err) {
      log.error("search failed", { err })
      throw err
    }
  }
}
