import { createHash } from "crypto"
import type {
  EmbeddingPurpose,
  EmbeddingQualityResult,
  EmbeddingResponse,
  EmbeddingRuntimeProfile,
  EmbeddingValidationResult,
  IEmbedder,
} from "./interfaces/embedder"

export const EMBEDDING_QUALITY_VERSION = "qwen3-dense-v1"
export const EMBEDDING_INSTRUCTION_VERSION = "qwen3-retrieval-v1"
export const CODE_QUERY_INSTRUCTION =
  "Instruct: Given a code search query, retrieve relevant source code passages that answer the query\nQuery: "
export const DOCUMENT_QUERY_INSTRUCTION =
  "Instruct: Given a document search query, retrieve relevant document passages that answer the query\nQuery: "

const probes = [
  {
    document:
      "int retry_connection(struct link *link) { close_socket(link); reset_backoff(link); return open_socket(link); }",
    query: "find the C function that closes and reopens a failed network connection",
  },
  {
    document:
      "void enter_recovery(struct controller *ctl) { ctl->state = STATE_RECOVERY; ctl->retries = 0; notify_watchdog(ctl); }",
    query: "控制器进入错误恢复状态时在哪里清零重试次数",
  },
  {
    document:
      "uint64_t translate_page(const struct mmu *mmu, uint64_t virtual_page) { return mmu->table[virtual_page].physical_page; }",
    query: "locate virtual to physical page address translation",
  },
  {
    document:
      "void queue_push(struct queue *q, struct item value) { mutex_lock(&q->lock); q->items[q->tail++] = value; mutex_unlock(&q->lock); }",
    query: "哪个函数使用互斥锁保护队列写入",
  },
  {
    document:
      "bool verify_packet(const uint8_t *data, size_t size, uint32_t expected) { return crc32(data, size) == expected; }",
    query: "find packet integrity validation using a CRC checksum",
  },
  {
    document:
      "size_t copy_frame(uint8_t *dst, size_t capacity, const uint8_t *src, size_t length) { size_t count = length < capacity ? length : capacity; memcpy(dst, src, count); return count; }",
    query: "查找复制数据前限制长度以避免缓冲区越界的代码",
  },
] as const

type BatchOptions = {
  expectedCount: number
  expectedDimension?: number
  dense?: boolean
  semantic?: boolean
  collapse?: boolean
}

type BatchResult = {
  dimension: number
  quality: EmbeddingQualityResult
}

export type EmbeddingProbeOptions = {
  provider: "openai-compatible"
  modelId: string
  dimensionMode: "auto" | "fixed"
  requestedDimension?: number
  endpoint: string
  instructions: boolean
  previous?: EmbeddingRuntimeProfile
}

export type PreparedEmbeddingRuntime = {
  embedder: IEmbedder
  profile: EmbeddingRuntimeProfile
  validation: EmbeddingValidationResult
  drifted: boolean
}

export function instruction(text: string, purpose: EmbeddingPurpose): string {
  if (purpose === "code-query") return `${CODE_QUERY_INSTRUCTION}${text}`
  if (purpose === "document-query") return `${DOCUMENT_QUERY_INSTRUCTION}${text}`
  return text
}

export function endpointDigest(endpoint: string): string {
  const normalized = (() => {
    try {
      const url = new URL(endpoint)
      url.username = ""
      url.password = ""
      url.hash = ""
      return url.toString()
    } catch {
      return endpoint.trim()
    }
  })()
  return digest(normalized)
}

export function validateEmbeddingBatch(vectors: number[][], opts: BatchOptions): BatchResult {
  if (vectors.length !== opts.expectedCount) {
    throw new Error(`Embedding count mismatch: expected ${opts.expectedCount}, received ${vectors.length}.`)
  }
  const dimension = vectors[0]?.length ?? 0
  if (dimension <= 0) throw new Error("Embedding response contains an empty vector.")
  if (opts.expectedDimension !== undefined && dimension !== opts.expectedDimension) {
    throw new Error(`Embedding dimension mismatch: expected ${opts.expectedDimension}, received ${dimension}.`)
  }
  if (vectors.some((vector) => vector.length !== dimension)) {
    throw new Error("Embedding response contains inconsistent vector dimensions.")
  }

  const norms: number[] = []
  const variances: number[] = []
  const zeros: number[] = []
  for (const vector of vectors) {
    if (vector.some((value) => !Number.isFinite(value))) {
      throw new Error("Embedding response contains a non-finite value.")
    }
    const sum = vector.reduce((total, value) => total + value, 0)
    const mean = sum / dimension
    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0))
    const variance = vector.reduce((total, value) => total + (value - mean) ** 2, 0) / dimension
    const ratio = vector.filter((value) => value === 0).length / dimension
    if (norm <= 1e-6) throw new Error("Embedding response contains a zero-norm vector.")
    if (variance <= 1e-10) throw new Error("Embedding response contains a near-constant vector.")
    if (opts.dense && ratio > 0.01) {
      throw new Error(`Embedding response contains too many exact zero values (${(ratio * 100).toFixed(2)}%).`)
    }
    norms.push(norm)
    variances.push(variance)
    zeros.push(ratio)
  }

  const tail = commonZeroTail(vectors)
  const limit = Math.max(8, Math.ceil(dimension * 0.01))
  if (opts.dense && tail >= limit) {
    throw new Error(`Embedding response has a suspicious shared zero-padded suffix (${tail} values).`)
  }

  const similarities = pairs(vectors).map(([left, right]) => cosine(left, right))
  const max = similarities.length > 0 ? Math.max(...similarities) : 0
  if (opts.collapse !== false && vectors.length > 1 && max >= 0.9999) {
    throw new Error(`Embedding response appears collapsed (maximum cross-text cosine ${max.toFixed(6)}).`)
  }

  const semantic = opts.semantic ? semanticScores(vectors) : { top1: 0, top3: 0 }
  if (opts.semantic && (semantic.top1 < 5 || semantic.top3 < 6)) {
    throw new Error(
      `Embedding semantic smoke failed: Top-1 ${semantic.top1}/6, Top-3 ${semantic.top3}/6 (required 5/6 and 6/6).`,
    )
  }

  return {
    dimension,
    quality: {
      version: EMBEDDING_QUALITY_VERSION,
      minNorm: Math.min(...norms),
      minVariance: Math.min(...variances),
      maxZeroRatio: Math.max(...zeros),
      commonZeroTail: tail,
      maxCosine: max,
      semanticTop1: semantic.top1,
      semanticTop3: semantic.top3,
    },
  }
}

export async function probeEmbedding(
  raw: IEmbedder,
  opts: EmbeddingProbeOptions,
): Promise<PreparedEmbeddingRuntime> {
  if (opts.dimensionMode === "fixed") {
    const requested = opts.requestedDimension
    if (!Number.isInteger(requested) || requested! < 32 || requested! > 4096) {
      throw new Error("Qwen3 fixed embedding dimension must be an integer between 32 and 4096.")
    }
  }

  const connectivity = await raw.validateConfiguration()
  if (!connectivity.valid) {
    throw new Error(connectivity.error || "Embedding endpoint validation failed.")
  }

  const documents = probes.map((item) => item.document)
  const queries = probes.map((item) =>
    opts.instructions ? instruction(item.query, "code-query") : item.query,
  )
  const input = [...documents, ...queries]
  const first = await raw.createEmbeddings(input, opts.modelId, "validation")
  const initial = validateEmbeddingBatch(first.embeddings, {
    expectedCount: input.length,
    expectedDimension: opts.dimensionMode === "fixed" ? opts.requestedDimension : undefined,
    dense: true,
    semantic: true,
  })
  const second = await raw.createEmbeddings(input, opts.modelId, "validation")
  const repeated = validateEmbeddingBatch(second.embeddings, {
    expectedCount: input.length,
    expectedDimension: initial.dimension,
    dense: true,
    semantic: true,
  })
  for (let index = 0; index < first.embeddings.length; index += 1) {
    const similarity = cosine(first.embeddings[index]!, second.embeddings[index]!)
    if (similarity < 0.999) {
      throw new Error(`Embedding response is unstable across repeated probes at item ${index + 1}.`)
    }
  }

  const current = first.embeddings.slice(0, probes.length).map(normalize)
  const identity = {
    provider: opts.provider,
    modelId: opts.modelId,
    dimensionMode: opts.dimensionMode,
    requestedDimension: opts.dimensionMode === "fixed" ? opts.requestedDimension : undefined,
    dimension: initial.dimension,
    endpointDigest: endpointDigest(opts.endpoint),
    qualityVersion: EMBEDDING_QUALITY_VERSION,
    instructionVersion: opts.instructions ? EMBEDDING_INSTRUCTION_VERSION : undefined,
  } as const
  const compatible = opts.previous && sameIdentity(opts.previous, identity) && sameSpace(opts.previous.fingerprint, current)
  const fingerprint = compatible ? opts.previous!.fingerprint : current
  const profile: EmbeddingRuntimeProfile = {
    ...identity,
    fingerprint,
    fingerprintDigest: digest(JSON.stringify(fingerprint.map((vector) => vector.map(round)))),
  }
  const quality = {
    ...initial.quality,
    minNorm: Math.min(initial.quality.minNorm, repeated.quality.minNorm),
    minVariance: Math.min(initial.quality.minVariance, repeated.quality.minVariance),
    maxZeroRatio: Math.max(initial.quality.maxZeroRatio, repeated.quality.maxZeroRatio),
    commonZeroTail: Math.max(initial.quality.commonZeroTail, repeated.quality.commonZeroTail),
    maxCosine: Math.max(initial.quality.maxCosine, repeated.quality.maxCosine),
  }
  const validation: EmbeddingValidationResult = {
    valid: true,
    dimension: initial.dimension,
    quality,
  }
  return {
    embedder: new QualityCheckedEmbedder(raw, profile, validation, opts.instructions),
    profile,
    validation,
    drifted: Boolean(opts.previous && !compatible),
  }
}

export class QualityCheckedEmbedder implements IEmbedder {
  constructor(
    private readonly raw: IEmbedder,
    readonly profile: EmbeddingRuntimeProfile,
    private readonly validation: EmbeddingValidationResult,
    private readonly instructions: boolean,
  ) {}

  async createEmbeddings(
    texts: string[],
    model?: string,
    purpose: EmbeddingPurpose = "document",
  ): Promise<EmbeddingResponse> {
    const processed = this.instructions ? texts.map((text) => instruction(text, purpose)) : texts
    const input = [probes[0].document, ...processed]
    const response = await this.raw.createEmbeddings(input, model, purpose)
    validateEmbeddingBatch(response.embeddings, {
      expectedCount: input.length,
      expectedDimension: this.profile.dimension,
      dense: true,
      collapse: false,
    })
    const sentinel = response.embeddings[0]
    const expected = this.profile.fingerprint[0]
    if (!sentinel || !expected || cosine(normalize(sentinel), expected) < 0.999) {
      throw new Error("Embedding vector space drift was detected during a production request.")
    }
    const embeddings = response.embeddings.slice(1)
    validateEmbeddingBatch(embeddings, {
      expectedCount: texts.length,
      expectedDimension: this.profile.dimension,
      dense: true,
      collapse: false,
    })
    return { ...response, embeddings }
  }

  validateConfiguration(): Promise<EmbeddingValidationResult> {
    return Promise.resolve(this.validation)
  }

  get embedderInfo() {
    return this.raw.embedderInfo
  }
}

export function sameSpace(left: number[][], right: number[][]): boolean {
  if (left.length !== right.length || left.length === 0) return false
  return left.every((vector, index) => {
    const other = right[index]
    return !!other && vector.length === other.length && cosine(vector, other) >= 0.999
  })
}

function sameIdentity(
  left: EmbeddingRuntimeProfile,
  right: Omit<EmbeddingRuntimeProfile, "fingerprint" | "fingerprintDigest">,
): boolean {
  return (
    left.provider === right.provider &&
    left.modelId === right.modelId &&
    left.dimensionMode === right.dimensionMode &&
    left.requestedDimension === right.requestedDimension &&
    left.dimension === right.dimension &&
    left.endpointDigest === right.endpointDigest &&
    left.qualityVersion === right.qualityVersion &&
    left.instructionVersion === right.instructionVersion
  )
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0))
  return vector.map((value) => value / norm)
}

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return -1
  const dot = left.reduce((total, value, index) => total + value * right[index]!, 0)
  const a = Math.sqrt(left.reduce((total, value) => total + value * value, 0))
  const b = Math.sqrt(right.reduce((total, value) => total + value * value, 0))
  return dot / (a * b)
}

function pairs(vectors: number[][]): Array<[number[], number[]]> {
  const out: Array<[number[], number[]]> = []
  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      out.push([vectors[left]!, vectors[right]!])
    }
  }
  return out
}

function commonZeroTail(vectors: number[][]): number {
  const dimension = vectors[0]?.length ?? 0
  for (let index = dimension - 1; index >= 0; index -= 1) {
    if (vectors.some((vector) => vector[index] !== 0)) return dimension - 1 - index
  }
  return dimension
}

function semanticScores(vectors: number[][]): { top1: number; top3: number } {
  const count = probes.length
  const documents = vectors.slice(0, count)
  const queries = vectors.slice(count, count * 2)
  return queries.reduce(
    (score, query, expected) => {
      const ranked = documents
        .map((document, index) => ({ index, score: cosine(query, document) }))
        .sort((left, right) => right.score - left.score)
      if (ranked[0]?.index === expected) score.top1 += 1
      if (ranked.slice(0, 3).some((item) => item.index === expected)) score.top3 += 1
      return score
    },
    { top1: 0, top3: 0 },
  )
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
