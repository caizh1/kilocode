import { createHash } from "node:crypto"
import type { CodeGraphDerivedIndex, CodeGraphFileGraph, CodePostingsDocument } from "../codegraph/types"
import type { CodeBlock } from "../interfaces/file-processor"
import type { PointStruct, VectorStoreSearchResult } from "../interfaces/vector-store"

const volatile = new Set(["runId", "updatedAt", "lastFullScanAt"])

export type QualityHit = {
  key: string
  score: number
}

export type QualityManifest = {
  version: 1
  candidates: string[]
  chunks: Array<{
    key: string
    fileHash: string
    contentHash: string
  }>
  batches: Array<{
    size: number
    textHashes: string[]
  }>
  points: Array<{
    id: string
    vectorHash: string
    payloadHash: string
  }>
  graphs: Array<{
    filePath: string
    hash: string
  }>
  postings: Array<{
    filePath: string
    hash: string
  }>
  derivedHash?: string
  searches: Record<string, QualityHit[]>
}

export type QualityInput = {
  candidates?: string[]
  chunks?: CodeBlock[]
  batches?: string[][]
  points?: PointStruct[]
  graphs?: CodeGraphFileGraph[]
  postings?: CodePostingsDocument[]
  derived?: CodeGraphDerivedIndex
  searches?: Record<string, VectorStoreSearchResult[]>
}

export type QualityReport = {
  ok: boolean
  mismatches: string[]
}

export function buildQualityManifest(input: QualityInput): QualityManifest {
  const searches = Object.fromEntries(
    Object.entries(input.searches ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([query, hits]) => [query, hits.map(hit)]),
  )

  return {
    version: 1,
    candidates: [...(input.candidates ?? [])].map(normalize).sort(),
    chunks: (input.chunks ?? [])
      .map((block) => ({
        key: [
          normalize(block.file_path),
          block.start_line,
          block.end_line,
          block.type,
          block.identifier ?? "",
          block.segmentHash,
        ].join("\0"),
        fileHash: block.fileHash,
        contentHash: textDigest(block.content),
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    batches: (input.batches ?? []).map((batch) => ({
      size: batch.length,
      textHashes: batch.map(textDigest),
    })),
    points: (input.points ?? [])
      .map((point) => ({
        id: point.id,
        vectorHash: digest(point.vector),
        payloadHash: digest(clean(point.payload)),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    graphs: (input.graphs ?? [])
      .map((graph) => ({ filePath: normalize(graph.filePath), hash: digest(clean(graph)) }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath)),
    postings: (input.postings ?? [])
      .map((doc) => ({ filePath: normalize(doc.filePath), hash: digest(clean(doc)) }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath)),
    ...(input.derived ? { derivedHash: digest(clean(input.derived)) } : {}),
    searches,
  }
}

export function compareQualityManifests(
  baseline: QualityManifest,
  candidate: QualityManifest,
  tolerance = 1e-6,
): QualityReport {
  const mismatches: string[] = []

  compare("version", baseline.version, candidate.version, mismatches)
  compare("candidates", baseline.candidates, candidate.candidates, mismatches)
  compare("chunks", baseline.chunks, candidate.chunks, mismatches)
  compare("embedding batches", baseline.batches, candidate.batches, mismatches)
  compare("vector points", baseline.points, candidate.points, mismatches)
  compare("code graphs", baseline.graphs, candidate.graphs, mismatches)
  compare("postings", baseline.postings, candidate.postings, mismatches)
  compare("derived index", baseline.derivedHash, candidate.derivedHash, mismatches)

  const queries = [...new Set([...Object.keys(baseline.searches), ...Object.keys(candidate.searches)])].sort()
  for (const query of queries) {
    const left = baseline.searches[query]
    const right = candidate.searches[query]
    if (!left || !right) {
      mismatches.push(`search query set differs: ${query}`)
      continue
    }
    compareHits(query, left, right, tolerance, mismatches)
  }

  return { ok: mismatches.length === 0, mismatches }
}

export function parseQualityManifest(value: unknown): QualityManifest {
  if (manifest(value)) return value
  throw new Error("Invalid RAG quality manifest.")
}

function hit(result: VectorStoreSearchResult): QualityHit {
  const payload = result.payload
  const key = payload
    ? [normalize(payload.filePath), payload.startLine, payload.endLine, textDigest(payload.codeChunk)].join("\0")
    : `id:${String(result.id)}`
  return { key, score: result.score }
}

function compareHits(
  query: string,
  baseline: QualityHit[],
  candidate: QualityHit[],
  tolerance: number,
  mismatches: string[],
): void {
  if (baseline.length !== candidate.length) {
    mismatches.push(`search result count differs for ${query}: ${baseline.length} != ${candidate.length}`)
    return
  }

  for (const [start, end] of groups(baseline, tolerance)) {
    const left = baseline.slice(start, end).sort(order)
    const right = candidate.slice(start, end).sort(order)
    if (left.map((item) => item.key).join("\0") !== right.map((item) => item.key).join("\0")) {
      mismatches.push(`search order differs for ${query} at ${start + 1}-${end}`)
      continue
    }
    for (let i = 0; i < left.length; i += 1) {
      if (Math.abs(left[i].score - right[i].score) <= tolerance) continue
      mismatches.push(`search score differs for ${query} at ${start + i + 1}`)
    }
  }
}

function groups(hits: QualityHit[], tolerance: number): Array<[number, number]> {
  const result: Array<[number, number]> = []
  let start = 0
  for (let i = 1; i <= hits.length; i += 1) {
    if (i < hits.length && Math.abs(hits[i].score - hits[i - 1].score) <= tolerance) continue
    result.push([start, i])
    start = i
  }
  return result
}

function order(left: QualityHit, right: QualityHit): number {
  return left.key.localeCompare(right.key)
}

function compare(name: string, baseline: unknown, candidate: unknown, mismatches: string[]): void {
  if (digest(baseline) === digest(candidate)) return
  mismatches.push(`${name} differs`)
}

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean)
  if (!record(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !volatile.has(key))
      .sort()
      .map((key) => [key, clean(value[key])]),
  )
}

function manifest(value: unknown): value is QualityManifest {
  if (!record(value) || value.version !== 1) return false
  if (!strings(value.candidates) || !array(value.chunks, chunk) || !array(value.batches, batch)) return false
  if (!array(value.points, point) || !array(value.graphs, stored) || !array(value.postings, stored)) return false
  if (value.derivedHash !== undefined && typeof value.derivedHash !== "string") return false
  if (!record(value.searches)) return false
  return Object.values(value.searches).every((hits) => array(hits, qualityHit))
}

function chunk(value: unknown): value is QualityManifest["chunks"][number] {
  return (
    record(value) &&
    typeof value.key === "string" &&
    typeof value.fileHash === "string" &&
    typeof value.contentHash === "string"
  )
}

function batch(value: unknown): value is QualityManifest["batches"][number] {
  return record(value) && typeof value.size === "number" && strings(value.textHashes)
}

function point(value: unknown): value is QualityManifest["points"][number] {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.vectorHash === "string" &&
    typeof value.payloadHash === "string"
  )
}

function stored(value: unknown): value is QualityManifest["graphs"][number] {
  return record(value) && typeof value.filePath === "string" && typeof value.hash === "string"
}

function qualityHit(value: unknown): value is QualityHit {
  return record(value) && typeof value.key === "string" && typeof value.score === "number"
}

function array<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(clean(value)) ?? "undefined")
    .digest("hex")
}

function textDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function normalize(file: string): string {
  return file.replaceAll("\\", "/")
}
