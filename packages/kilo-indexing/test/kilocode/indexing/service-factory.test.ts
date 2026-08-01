import { describe, expect, test, mock, beforeEach } from "bun:test"
import path from "path"
import { mockEmbeddingsCreate, openAIMockFactory, setOpenAIConstructorHook } from "./embedders/__helpers__/openai-mock"
import {
  OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS,
  REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
} from "../../../src/indexing/constants"
import type { AvailableEmbedders, EmbeddingRuntimeProfile, IEmbedder } from "../../../src/indexing/interfaces/embedder"

mock.module("openai", openAIMockFactory)
import { CodeIndexServiceFactory } from "../../../src/indexing/service-factory"
import { CodeIndexConfigManager } from "../../../src/indexing/config-manager"
import { CacheManager } from "../../../src/indexing/cache-manager"

const workspacePath = "/tmp/ws"
const cacheDirectory = "/tmp/cache"

function createFactory(input?: Partial<ConstructorParameters<typeof CodeIndexConfigManager>[0]>) {
  const cfg = new CodeIndexConfigManager({
    enabled: true,
    embedderProvider: "openai",
    openAiKey: "sk-test",
    ...input,
  })

  const cache = {} as CacheManager

  return new CodeIndexServiceFactory(cfg, workspacePath, cache, cacheDirectory)
}

function createEmbedder(name: AvailableEmbedders): IEmbedder {
  return {
    async createEmbeddings() {
      return { embeddings: [] }
    },
    async validateConfiguration() {
      return { valid: true }
    },
    get embedderInfo() {
      return { name }
    },
  }
}

describe("CodeIndexServiceFactory", () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset()
    setOpenAIConstructorHook(undefined)
  })

  test("creates an OpenAI-compatible embedder without an API key", () => {
    const factory = createFactory({
      embedderProvider: "openai-compatible",
      openAiKey: undefined,
      openAiCompatibleBaseUrl: "http://localhost:1234/v1",
    })

    expect(factory.createEmbedder().embedderInfo).toEqual({ name: "openai-compatible" })
  })

  test("keeps dimensions out of OpenAI-compatible requests in auto mode", async () => {
    const factory = createFactory({
      embedderProvider: "openai-compatible",
      openAiKey: undefined,
      openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      modelId: "qa-embedding-model",
      modelDimension: 3072,
      dimensionMode: "auto",
    })
    const vector = new Float32Array([0.25, 0.5])
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Buffer.from(vector.buffer).toString("base64") }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })

    await factory.createEmbedder().createEmbeddings(["hello"])

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      {
        input: ["hello"],
        model: "qa-embedding-model",
        encoding_format: "base64",
      },
      { timeout: 120_000, maxRetries: 0 },
    )
  })

  test("keeps legacy bge-m3 dimensions out of requests while enforcing the returned length", async () => {
    const factory = createFactory({
      embedderProvider: "openai-compatible",
      openAiKey: undefined,
      openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      modelId: "bge-m3",
      modelDimension: 3,
      dimensionMode: "fixed",
    })
    const vector = new Float32Array([0.25, 0.5, 0.75])
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Buffer.from(vector.buffer).toString("base64") }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })

    await factory.createEmbedder().createEmbeddings(["hello"])

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      {
        input: ["hello"],
        model: "bge-m3",
        encoding_format: "base64",
      },
      { timeout: 120_000, maxRetries: 0 },
    )
  })

  test("rejects a bge-m3 response that does not match the legacy schema dimension", async () => {
    const factory = createFactory({
      embedderProvider: "openai-compatible",
      openAiKey: undefined,
      openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      modelId: "bge-m3",
      modelDimension: 3,
      dimensionMode: "fixed",
    })
    const vector = new Float32Array([0.25, 0.5])
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Buffer.from(vector.buffer).toString("base64") }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })

    await expect(factory.createEmbedder().createEmbeddings(["hello"])).rejects.toThrow(
      "Embedding dimension mismatch: expected 3, received 2.",
    )
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      {
        input: ["hello"],
        model: "bge-m3",
        encoding_format: "base64",
      },
      { timeout: 120_000, maxRetries: 0 },
    )
  })

  test("validates legacy bge-m3 dimensions without sending a Matryoshka override", async () => {
    const factory = createFactory({
      embedderProvider: "openai-compatible",
      openAiKey: undefined,
      openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      modelId: "bge-m3",
      modelDimension: 3,
      dimensionMode: "fixed",
    })
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [0.25, 0.5] }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })

    await expect(factory.createEmbedder().validateConfiguration()).resolves.toEqual({
      valid: false,
      error: "Embedding dimension mismatch: expected 3, received 2.",
    })
    expect(mockEmbeddingsCreate.mock.calls[0]?.[0]).toEqual({
      input: ["test"],
      model: "bge-m3",
      encoding_format: "base64",
    })
  })

  test("sends configured dimensions only for fixed Qwen3 Matryoshka requests", async () => {
    const factory = createFactory({
      embedderProvider: "openai-compatible",
      openAiKey: undefined,
      openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      modelId: "qwen3-embedding-8b",
      modelDimension: 3,
      dimensionMode: "fixed",
    })
    const vector = new Float32Array([0.25, 0.5, 0.75])
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Buffer.from(vector.buffer).toString("base64") }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })

    await factory.createEmbedder().createEmbeddings(["hello"])

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      {
        input: ["hello"],
        model: "qwen3-embedding-8b",
        encoding_format: "base64",
        dimensions: 3,
      },
      { timeout: 120_000, maxRetries: 0 },
    )
  })

  test("uses the validated last-known-good request mode instead of an unapplied fixed setting", async () => {
    const factory = createFactory({
      embedderProvider: "openai-compatible",
      openAiKey: undefined,
      openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      modelId: "qwen3-embedding-8b",
      modelDimension: 3072,
      dimensionMode: "fixed",
    })
    const runtime: EmbeddingRuntimeProfile = {
      provider: "openai-compatible",
      modelId: "qwen3-embedding-8b",
      dimensionMode: "auto",
      dimension: 2,
      endpointDigest: "endpoint",
      fingerprint: [[0.25, 0.5]],
      fingerprintDigest: "space",
      qualityVersion: "qwen3-dense-v1",
      instructionVersion: "qwen3-retrieval-v1",
    }
    const vector = new Float32Array([0.25, 0.5])
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Buffer.from(vector.buffer).toString("base64") }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })

    await factory.createEmbedder(runtime).createEmbeddings(["hello"])

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      {
        input: ["hello"],
        model: "qwen3-embedding-8b",
        encoding_format: "base64",
      },
      { timeout: 120_000, maxRetries: 0 },
    )
  })

  test("lets SDK-backed embedders own validation timeouts", async () => {
    const original = globalThis.setTimeout
    const timer = mock((...args: Parameters<typeof setTimeout>) => original(...args))
    globalThis.setTimeout = timer

    try {
      const factory = createFactory()
      const providers = [
        "openai",
        "openrouter",
        "openai-compatible",
        "kilo",
        "gemini",
        "mistral",
        "vercel-ai-gateway",
      ] satisfies AvailableEmbedders[]

      for (const provider of providers) {
        await expect(factory.validateEmbedder(createEmbedder(provider))).resolves.toEqual({ valid: true })
      }

      expect(timer).not.toHaveBeenCalled()
    } finally {
      globalThis.setTimeout = original
    }
  })

  test("retains factory deadlines for non-SDK embedders", async () => {
    const original = globalThis.setTimeout
    const timer = mock((...args: Parameters<typeof setTimeout>) => original(...args))
    globalThis.setTimeout = timer

    try {
      const factory = createFactory()

      await factory.validateEmbedder(createEmbedder("voyage"))
      await factory.validateEmbedder(createEmbedder("bedrock"))
      await factory.validateEmbedder(createEmbedder("ollama"))

      expect(timer.mock.calls.map((call) => call[1])).toEqual([
        REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
        REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
        OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS,
      ])
    } finally {
      globalThis.setTimeout = original
    }
  })

  test("uses default LanceDB directory when config is unset", () => {
    const factory = createFactory({ vectorStoreProvider: undefined, lancedbVectorStoreDirectory: undefined })

    const store = factory.createVectorStore() as unknown as { dbPath: string }

    expect(store).toBeDefined()
    expect(store.dbPath).toContain(path.join(cacheDirectory, "lancedb"))
  })

  test("uses explicit LanceDB directory when configured", () => {
    const dir = path.join(process.cwd(), "tmp", "custom-lancedb")
    const factory = createFactory({ vectorStoreProvider: "lancedb", lancedbVectorStoreDirectory: dir })

    const store = factory.createVectorStore() as unknown as { dbPath: string }

    expect(store.dbPath).toContain(dir)
  })

  test("uses separate LanceDB directory for document vectors", () => {
    const factory = createFactory({ vectorStoreProvider: "lancedb", lancedbVectorStoreDirectory: undefined })

    const store = factory.createDocumentVectorStore() as unknown as { dbPath: string }

    expect(store).toBeDefined()
    expect(store.dbPath).toContain(path.join(cacheDirectory, "lancedb-documents"))
  })

  test("nests document vectors under explicit LanceDB directory", () => {
    const dir = "/tmp/custom-lancedb"
    const factory = createFactory({ vectorStoreProvider: "lancedb", lancedbVectorStoreDirectory: dir })

    const store = factory.createDocumentVectorStore() as unknown as { dbPath: string }

    expect(store.dbPath).toContain(path.join(dir, "documents"))
  })

  test("suffixes custom LanceDB and Qdrant storage for ChipMate v2", () => {
    const previous = process.env.KILO_PRODUCT_PROFILE
    process.env.KILO_PRODUCT_PROFILE = "chipmate-v2"
    try {
      const lance = createFactory({
        vectorStoreProvider: "lancedb",
        lancedbVectorStoreDirectory: "/tmp/shared-lancedb",
      }).createVectorStore() as unknown as { dbPath: string }
      const qdrant = createFactory({
        vectorStoreProvider: "qdrant",
        qdrantUrl: "http://localhost:6333",
      }).createVectorStore()

      expect(lance.dbPath).toContain(path.join("/tmp/shared-lancedb", "chipmate-v2"))
      expect(qdrant.getCollectionName?.()).toEndWith("-chipmate-v2")
    } finally {
      if (previous === undefined) delete process.env.KILO_PRODUCT_PROFILE
      else process.env.KILO_PRODUCT_PROFILE = previous
    }
  })

  test("passes configured dimension to Ollama embed requests", async () => {
    const fn = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ embeddings: [[0.1, 0.2]] }),
      } as Response),
    ) as unknown as typeof fetch
    const prev = global.fetch
    global.fetch = fn

    try {
      const factory = createFactory({
        embedderProvider: "ollama",
        openAiKey: undefined,
        ollamaBaseUrl: "http://localhost:11434",
        modelId: "mxbai-embed-large",
        modelDimension: 1024,
      })

      const embedder = factory.createEmbedder()
      await embedder.createEmbeddings(["hello"])

      const calls = (fn as unknown as { mock: { calls: Array<[string, RequestInit | undefined]> } }).mock.calls
      const req = calls[0]?.[1]
      if (!req || typeof req.body !== "string") throw new Error("Missing Ollama embed request body")
      const body = JSON.parse(req.body)

      expect(body.model).toBe("mxbai-embed-large")
      expect(body.input).toEqual(["hello"])
      expect(body.dimensions).toBe(1024)
    } finally {
      global.fetch = prev
    }
  })

  test("leaves Ollama dimensions unset when no override is configured", async () => {
    const fn = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ embeddings: [[0.1, 0.2]] }),
      } as Response),
    ) as unknown as typeof fetch
    const prev = global.fetch
    global.fetch = fn

    try {
      const factory = createFactory({
        embedderProvider: "ollama",
        openAiKey: undefined,
        ollamaBaseUrl: "http://localhost:11434",
        modelId: "mxbai-embed-large",
      })

      const embedder = factory.createEmbedder()
      await embedder.createEmbeddings(["hello"])

      const calls = (fn as unknown as { mock: { calls: Array<[string, RequestInit | undefined]> } }).mock.calls
      const req = calls[0]?.[1]
      if (!req || typeof req.body !== "string") throw new Error("Missing Ollama embed request body")
      const body = JSON.parse(req.body)

      expect(body.model).toBe("mxbai-embed-large")
      expect(body.input).toEqual(["hello"])
      expect("dimensions" in body).toBe(false)
    } finally {
      global.fetch = prev
    }
  })

  test("passes configured dimension to OpenRouter embed requests", async () => {
    const factory = createFactory({
      embedderProvider: "openrouter",
      openAiKey: undefined,
      openRouterApiKey: "or-test",
      modelId: "openai/text-embedding-3-small",
      modelDimension: 1024,
    })

    const testEmbedding = new Float32Array([0.25, 0.5])
    const base64String = Buffer.from(testEmbedding.buffer).toString("base64")

    mockEmbeddingsCreate.mockResolvedValue({
      data: [
        {
          embedding: base64String,
        },
      ],
      usage: {
        prompt_tokens: 1,
        total_tokens: 1,
      },
    })

    const embedder = factory.createEmbedder()

    await embedder.createEmbeddings(["hello"])

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      input: ["hello"],
      model: "openai/text-embedding-3-small",
      encoding_format: "float",
      dimensions: 1024,
    })
  })

  test("creates vector store for OpenRouter Gemini embedding preview", () => {
    const factory = createFactory({
      embedderProvider: "openrouter",
      openAiKey: undefined,
      openRouterApiKey: "or-test",
      modelId: "google/gemini-embedding-2-preview",
      vectorStoreProvider: "lancedb",
    })

    const store = factory.createVectorStore() as unknown as { vectorSize: number }

    expect(store).toBeDefined()
    expect(store.vectorSize).toBe(3072)
  })

  test("uses configured dimension before static model metadata for vector stores", () => {
    const factory = createFactory({
      embedderProvider: "openrouter",
      openAiKey: undefined,
      openRouterApiKey: "or-test",
      modelId: "openai/text-embedding-3-small",
      modelDimension: 1024,
      vectorStoreProvider: "lancedb",
    })

    const store = factory.createVectorStore() as unknown as { vectorSize: number }

    expect(store).toBeDefined()
    expect(store.vectorSize).toBe(1024)
  })

  test("creates Kilo embedder with Cloud-provided model", async () => {
    const factory = createFactory({
      embedderProvider: "kilo",
      openAiKey: undefined,
      kiloApiKey: "kilo-token",
      kiloOrganizationId: "org_123",
      modelId: "mistralai/mistral-embed-2312",
      modelDimension: 1024,
    })

    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })

    const embedder = factory.createEmbedder()
    await embedder.createEmbeddings(["hello"])

    expect(embedder.embedderInfo).toEqual({ name: "kilo" })
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      {
        input: ["hello"],
        model: "mistralai/mistral-embed-2312",
        encoding_format: "base64",
        dimensions: 1024,
      },
      { timeout: 120_000, maxRetries: 0 },
    )
  })
})
