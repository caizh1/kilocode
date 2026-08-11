import path from "path"
import type { VectorStoreSearchResult } from "../interfaces"
import type { EvidenceRef, QueryEvidenceTraceDiagnostic, QueryEvidenceStageStatus } from "./types"

export type VectorEvidenceAdapter = (
  query: string,
  options: {
    directoryPrefix?: string
    maxResults: number
  },
) => Promise<VectorStoreSearchResult[]>

export type VectorEvidenceStatus = Extract<
  QueryEvidenceStageStatus,
  "ok" | "skipped" | "failed" | "unavailable" | "empty" | "malformed"
>

export type VectorEvidenceResult = {
  refs: EvidenceRef[]
  status: VectorEvidenceStatus
  reason: string
  candidates: number
  malformed: number
  filtered: number
  scoreDirection: "higher-is-better" | "unknown"
  elapsedMs: number
}

const timeoutMs = 5_000

export async function queryVectorEvidence(input: {
  query: string
  directoryPrefix?: string
  maxResults: number
  timeoutMs?: number
  adapter?: VectorEvidenceAdapter
  diagnostics: QueryEvidenceTraceDiagnostic[]
}): Promise<VectorEvidenceResult> {
  const start = Date.now()
  if (!input.adapter) {
    return result("unavailable", "vector-adapter-unavailable", start)
  }

  try {
    const raw = await withTimeout(
      input.adapter(input.query, {
        directoryPrefix: input.directoryPrefix,
        maxResults: input.maxResults,
      }),
      input.timeoutMs ?? timeoutMs,
    )
    if (!Array.isArray(raw)) {
      return result("malformed", "vector-results-not-array", start)
    }
    if (raw.length === 0) {
      return result("empty", "vector-empty", start)
    }

    const stats = {
      malformed: 0,
      filtered: 0,
    }
    const mapped = raw.flatMap((item) => {
      const ref = convert(item, input.directoryPrefix)
      if (ref.kind === "filtered") {
        stats.filtered += 1
        return []
      }
      if (ref.kind === "malformed") {
        stats.malformed += 1
        input.diagnostics.push({
          name: "vector-malformed-result",
          reason: ref.reason,
          count: 1,
        })
        return []
      }
      return [ref.value]
    })
    if (mapped.length === 0) {
      if (stats.malformed === 0 && stats.filtered > 0) {
        return {
          ...result("empty", "vector-results-filtered-by-directory-prefix", start),
          candidates: raw.length,
          filtered: stats.filtered,
        }
      }
      return {
        ...result("malformed", "vector-results-missing-line-backed-payload", start),
        candidates: raw.length,
        malformed: stats.malformed,
        filtered: stats.filtered,
      }
    }
    return {
      refs: mapped,
      status: "ok",
      reason: "valid-vector-results-read",
      candidates: raw.length,
      malformed: stats.malformed,
      filtered: stats.filtered,
      scoreDirection: "higher-is-better",
      elapsedMs: Date.now() - start,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (reason === "vector-timeout") return result("failed", "vector-timeout", start)
    if (reason.includes("not ready") || reason.includes("unavailable") || reason.includes("disabled")) {
      return result("unavailable", reason, start)
    }
    return result("failed", "vector-search-failed", start)
  }
}

function convert(
  item: VectorStoreSearchResult,
  directoryPrefix?: string,
): { kind: "ok"; value: EvidenceRef } | { kind: "filtered" } | { kind: "malformed"; reason: string } {
  const payload = item.payload
  if (typeof item.score !== "number" || !Number.isFinite(item.score)) {
    return { kind: "malformed", reason: "missing-score" }
  }
  if (!payload) return { kind: "malformed", reason: "missing-payload" }
  if (typeof payload.filePath !== "string") return { kind: "malformed", reason: "missing-file-path" }
  if (
    typeof payload.startLine !== "number" ||
    typeof payload.endLine !== "number" ||
    !Number.isFinite(payload.startLine) ||
    !Number.isFinite(payload.endLine)
  ) {
    return { kind: "malformed", reason: "missing-line-range" }
  }
  if (payload.startLine <= 0 || payload.endLine < payload.startLine) {
    return { kind: "malformed", reason: "invalid-line-range" }
  }
  if (typeof payload.codeChunk !== "string") return { kind: "malformed", reason: "missing-code-chunk" }

  const file = path.normalize(payload.filePath)
  if (directoryPrefix && !within(file, directoryPrefix)) return { kind: "filtered" }

  const snippet = clip(payload.codeChunk, 240)
  return {
    kind: "ok",
    value: {
      id: `vector_${hash([item.id, file, payload.startLine, payload.endLine].join(":")).slice(0, 16)}`,
      source: "vector",
      path: file,
      filePath: file,
      startLine: payload.startLine,
      endLine: payload.endLine,
      kind: "semantic",
      displayName: `${file}:${payload.startLine}-${payload.endLine}`,
      reason: "semantic vector match from existing ChipMate index",
      confidence: item.score >= 0.9 ? "medium" : "low",
      score: item.score,
      shortSnippet: snippet,
      snippet,
      snippetHash: hash(snippet),
    },
  }
}

function within(file: string, prefix: string): boolean {
  const normalized = path.normalize(prefix)
  return file === normalized || file.startsWith(`${normalized}${path.sep}`)
}

function result(status: VectorEvidenceStatus, reason: string, start: number): VectorEvidenceResult {
  return {
    refs: [],
    status,
    reason,
    candidates: 0,
    malformed: 0,
    filtered: 0,
    scoreDirection: "higher-is-better",
    elapsedMs: Date.now() - start,
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("vector-timeout")), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 3))}...`
}

function hash(value: string): string {
  let out = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    out ^= value.charCodeAt(index)
    out = Math.imul(out, 0x01000193)
  }
  return (out >>> 0).toString(16).padStart(8, "0")
}
