import { describe, expect, test } from "bun:test"
import {
  CODE_QUERY_INSTRUCTION,
  probeEmbedding,
  QualityCheckedEmbedder,
  validateEmbeddingBatch,
} from "../../../src/indexing/embedding-quality"
import type {
  EmbeddingPurpose,
  EmbeddingRuntimeProfile,
  IEmbedder,
} from "../../../src/indexing/interfaces/embedder"

function dense(seed: number, dimension = 64): number[] {
  return Array.from({ length: dimension }, (_, index) => Math.sin((index + 1) * (seed + 1)) + seed * 0.031 + 0.017)
}

function samples(dimension = 64): number[][] {
  const documents = Array.from({ length: 6 }, (_, index) => dense(index + 1, dimension))
  const queries = documents.map((document, index) => {
    const noise = dense(index + 9, dimension)
    return document.map((value, offset) => value * 0.8 + noise[offset]! * 0.2)
  })
  return [...documents, ...queries]
}

function normalized(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0))
  return vector.map((value) => value / norm)
}

class ProbeEmbedder implements IEmbedder {
  readonly calls: Array<{ texts: string[]; purpose?: EmbeddingPurpose }> = []

  constructor(private readonly vectors = samples()) {}

  async createEmbeddings(texts: string[], _model?: string, purpose?: EmbeddingPurpose) {
    this.calls.push({ texts, purpose })
    return { embeddings: this.vectors.slice(0, texts.length).map((vector) => vector.slice()) }
  }

  async validateConfiguration() {
    return { valid: true }
  }

  get embedderInfo() {
    return { name: "openai-compatible" as const }
  }
}

describe("embedding quality gate", () => {
  test("probes an auto-dimension Qwen space twice and records semantic quality", async () => {
    const raw = new ProbeEmbedder()
    const runtime = await probeEmbedding(raw, {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      endpoint: "https://user:secret@example.test/v1/embeddings?api-version=1",
      instructions: true,
    })

    expect(runtime.profile.dimension).toBe(64)
    expect(runtime.profile.requestedDimension).toBeUndefined()
    expect(runtime.profile.endpointDigest).not.toContain("example.test")
    expect(runtime.validation.quality?.semanticTop1).toBe(6)
    expect(runtime.validation.quality?.semanticTop3).toBe(6)
    expect(raw.calls).toHaveLength(2)
    expect(raw.calls[0]?.texts[6]).toStartWith(CODE_QUERY_INSTRUCTION)
  })

  test("rejects a fixed mode response whose dimension was ignored", async () => {
    const raw = new ProbeEmbedder()
    await expect(
      probeEmbedding(raw, {
        provider: "openai-compatible",
        modelId: "qwen3-embedding-8b",
        dimensionMode: "fixed",
        requestedDimension: 32,
        endpoint: "https://example.test/v1",
        instructions: true,
      }),
    ).rejects.toThrow("expected 32, received 64")
  })

  test("adapts to simulated 1024 and 4096 spaces and accepts a matching fixed request", async () => {
    for (const dimension of [1024, 4096]) {
      const runtime = await probeEmbedding(new ProbeEmbedder(samples(dimension)), {
        provider: "openai-compatible",
        modelId: "qwen3-embedding-8b",
        dimensionMode: "auto",
        endpoint: `https://example.test/${dimension}`,
        instructions: true,
      })
      expect(runtime.profile.dimension).toBe(dimension)
    }

    const fixed = await probeEmbedding(new ProbeEmbedder(samples(1024)), {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "fixed",
      requestedDimension: 1024,
      endpoint: "https://example.test/fixed",
      instructions: true,
    })
    expect(fixed.profile.requestedDimension).toBe(1024)
    expect(fixed.profile.dimension).toBe(1024)
  })

  test("rejects non-finite, padded, collapsed, and count-mismatched vectors", () => {
    expect(() =>
      validateEmbeddingBatch([[Number.NaN, ...dense(1, 63)]], {
        expectedCount: 1,
        expectedDimension: 64,
        dense: true,
      }),
    ).toThrow("non-finite")

    const padded = Array.from({ length: 2 }, (_, seed) => [...dense(seed + 1, 990), ...new Array(10).fill(0)])
    expect(() =>
      validateEmbeddingBatch(padded, {
        expectedCount: 2,
        expectedDimension: 1000,
        dense: true,
      }),
    ).toThrow("zero-padded suffix")

    const vector = dense(3)
    expect(() =>
      validateEmbeddingBatch([vector, vector.slice()], {
        expectedCount: 2,
        dense: true,
      }),
    ).toThrow("collapsed")

    expect(() => validateEmbeddingBatch([dense(1)], { expectedCount: 2, dense: true })).toThrow("count mismatch")
  })

  test("adds query instructions and validates every production response before use", async () => {
    const raw = new ProbeEmbedder([dense(1), dense(8)])
    const profile: EmbeddingRuntimeProfile = {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      dimension: 64,
      endpointDigest: "endpoint",
      fingerprint: samples().slice(0, 6).map(normalized),
      fingerprintDigest: "fingerprint",
      qualityVersion: "quality",
      instructionVersion: "instruction",
    }
    const guarded = new QualityCheckedEmbedder(raw, profile, { valid: true, dimension: 64 }, true)

    await guarded.createEmbeddings(["find recovery"], undefined, "code-query")
    expect(raw.calls[0]?.texts).toEqual([
      expect.stringContaining("retry_connection"),
      `${CODE_QUERY_INSTRUCTION}find recovery`,
    ])

    const wrong = new QualityCheckedEmbedder(
      new ProbeEmbedder([dense(1, 32), dense(8, 32)]),
      profile,
      { valid: true },
      true,
    )
    await expect(wrong.createEmbeddings(["find recovery"], undefined, "code-query")).rejects.toThrow(
      "expected 64, received 32",
    )
  })

  test("blocks a production request when the sentinel detects vector-space drift", async () => {
    const profile: EmbeddingRuntimeProfile = {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      dimension: 64,
      endpointDigest: "endpoint",
      fingerprint: samples().slice(0, 6).map(normalized),
      fingerprintDigest: "fingerprint",
      qualityVersion: "quality",
      instructionVersion: "instruction",
    }
    const raw = new ProbeEmbedder([dense(1).reverse(), dense(8)])
    const guarded = new QualityCheckedEmbedder(raw, profile, { valid: true }, true)

    await expect(guarded.createEmbeddings(["find recovery"], undefined, "code-query")).rejects.toThrow(
      "vector space drift",
    )
  })

  test("allows duplicate production chunks after the probe has ruled out model collapse", async () => {
    const profile: EmbeddingRuntimeProfile = {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      dimension: 64,
      endpointDigest: "endpoint",
      fingerprint: samples().slice(0, 6).map(normalized),
      fingerprintDigest: "fingerprint",
      qualityVersion: "quality",
      instructionVersion: "instruction",
    }
    const duplicate = dense(8)
    const raw = new ProbeEmbedder([dense(1), duplicate, duplicate.slice()])
    const guarded = new QualityCheckedEmbedder(raw, profile, { valid: true }, true)

    const result = await guarded.createEmbeddings(["same chunk", "same chunk"])

    expect(result.embeddings).toEqual([duplicate, duplicate])
  })

  test("allows one isolated identical vector pair for distinct production texts", async () => {
    const profile: EmbeddingRuntimeProfile = {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      dimension: 64,
      endpointDigest: "endpoint",
      fingerprint: samples().slice(0, 6).map(normalized),
      fingerprintDigest: "fingerprint",
      qualityVersion: "quality",
      instructionVersion: "instruction",
    }
    const duplicate = dense(8)
    const raw = new ProbeEmbedder([dense(1), duplicate, duplicate.slice(), dense(9)])
    const guarded = new QualityCheckedEmbedder(raw, profile, { valid: true }, true)

    const result = await guarded.createEmbeddings(["first chunk", "second chunk", "third chunk"])

    expect(result.embeddings).toEqual([duplicate, duplicate, dense(9)])
  })

  test("blocks a production response that collapses three distinct texts", async () => {
    const profile: EmbeddingRuntimeProfile = {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      dimension: 64,
      endpointDigest: "endpoint",
      fingerprint: samples().slice(0, 6).map(normalized),
      fingerprintDigest: "fingerprint",
      qualityVersion: "quality",
      instructionVersion: "instruction",
    }
    const collapsed = dense(8)
    const raw = new ProbeEmbedder([dense(1), collapsed, collapsed.slice(), collapsed.slice()])
    const guarded = new QualityCheckedEmbedder(raw, profile, { valid: true }, true)

    await expect(guarded.createEmbeddings(["first chunk", "second chunk", "third chunk"])).rejects.toThrow(
      "collapsed across distinct texts",
    )
  })

  test("blocks a production response that maps a distinct text to the sentinel vector", async () => {
    const profile: EmbeddingRuntimeProfile = {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      dimension: 64,
      endpointDigest: "endpoint",
      fingerprint: samples().slice(0, 6).map(normalized),
      fingerprintDigest: "fingerprint",
      qualityVersion: "quality",
      instructionVersion: "instruction",
    }
    const sentinel = dense(1)
    const raw = new ProbeEmbedder([sentinel, sentinel.slice()])
    const guarded = new QualityCheckedEmbedder(raw, profile, { valid: true }, true)

    await expect(guarded.createEmbeddings(["unrelated production chunk"])).rejects.toThrow(
      "collapsed across distinct texts",
    )
  })

  test("reuses a fingerprint only when the endpoint identity and vector space remain compatible", async () => {
    const first = await probeEmbedding(new ProbeEmbedder(), {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      endpoint: "https://example.test/v1",
      instructions: true,
    })
    const same = await probeEmbedding(new ProbeEmbedder(), {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      endpoint: "https://example.test/v1",
      instructions: true,
      previous: first.profile,
    })
    const changed = await probeEmbedding(new ProbeEmbedder(samples().map((vector) => vector.slice().reverse())), {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      endpoint: "https://example.test/v1",
      instructions: true,
      previous: first.profile,
    })

    expect(same.drifted).toBe(false)
    expect(same.profile.fingerprintDigest).toBe(first.profile.fingerprintDigest)
    expect(changed.drifted).toBe(true)
    expect(changed.profile.fingerprintDigest).not.toBe(first.profile.fingerprintDigest)
  })
})
