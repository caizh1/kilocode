import { describe, expect, test } from "bun:test"
import {
  IndexingConfig,
  normalizeFileExtensions,
  parseFileExtensions,
  toIndexingConfigInput,
} from "../../../src/config"
import { CodeIndexConfigManager, type IndexingConfigInput } from "../../../src/indexing/config-manager"

function createInput(input: Partial<IndexingConfigInput> = {}): IndexingConfigInput {
  return {
    enabled: true,
    embedderProvider: "openai",
    vectorStoreProvider: "lancedb",
    openAiKey: "sk-test",
    ...input,
  }
}

describe("CodeIndexConfigManager", () => {
  test("parses explicit embedding dimension modes in the public config schema", () => {
    expect(IndexingConfig.parse({ dimensionMode: "auto", dimension: null })).toMatchObject({
      dimensionMode: "auto",
      dimension: null,
    })
    expect(IndexingConfig.parse({ dimensionMode: "fixed", dimension: 1024 })).toMatchObject({
      dimensionMode: "fixed",
      dimension: 1024,
    })
    expect(() => IndexingConfig.parse({ dimensionMode: "adaptive" })).toThrow()
  })

  test("uses auto mode without adopting an unverified registry dimension", () => {
    const manager = new CodeIndexConfigManager(createInput({
      embedderProvider: "openai-compatible",
      openAiCompatibleBaseUrl: "https://example.test/v1",
      modelId: "qwen3-embedding-8b",
      modelDimension: 4096,
      dimensionMode: "auto",
    }))

    expect(manager.currentDimensionMode).toBe("auto")
    expect(manager.currentModelDimension).toBeUndefined()
    expect(manager.getConfig().modelDimension).toBeUndefined()
  })

  test("does not restart for numeric dimension changes that explicit auto mode ignores", () => {
    const manager = new CodeIndexConfigManager(createInput({
      embedderProvider: "openai-compatible",
      openAiCompatibleBaseUrl: "https://example.test/v1",
      modelId: "qwen3-embedding-8b",
      modelDimension: 1024,
      dimensionMode: "auto",
    }))

    expect(
      manager.loadConfiguration(createInput({
        embedderProvider: "openai-compatible",
        openAiCompatibleBaseUrl: "https://example.test/v1",
        modelId: "qwen3-embedding-8b",
        modelDimension: 4096,
        dimensionMode: "auto",
      })).requiresRestart,
    ).toBe(false)
  })

  test("keeps an explicit fixed dimension as the requested runtime dimension", () => {
    const manager = new CodeIndexConfigManager(createInput({
      embedderProvider: "openai-compatible",
      openAiCompatibleBaseUrl: "https://example.test/v1",
      modelId: "qwen3-embedding-8b",
      modelDimension: 1024,
      dimensionMode: "fixed",
    }))

    expect(manager.currentDimensionMode).toBe("fixed")
    expect(manager.currentModelDimension).toBe(1024)
  })

  test("keeps public RAG disabled while defaulting document discovery bounds", () => {
    const input = toIndexingConfigInput(undefined)
    const cfg = new CodeIndexConfigManager(input)

    expect(input.enabled).toBe(false)
    expect(cfg.currentDocuments).toMatchObject({
      enabled: false,
      paths: ["."],
      maxFiles: 5_000,
      maxFileBytes: 25 * 1024 * 1024,
      maxExtractedBytesPerFile: 1024 * 1024,
    })
  })

  test("preserves explicit RAG opt-outs while keeping the workspace document root", () => {
    const input = toIndexingConfigInput({ enabled: false, documents: { enabled: false, paths: [] } })
    const cfg = new CodeIndexConfigManager(input)

    expect(input.enabled).toBe(false)
    expect(cfg.currentDocuments.enabled).toBe(false)
    expect(cfg.currentDocuments.paths).toEqual(["."])
  })

  test("prepends and deduplicates the workspace root before additional document paths", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        documents: {
          enabled: true,
          paths: ["/shared/left", ".", "/shared/right", "/shared/left"],
        },
      }),
    )

    expect(cfg.currentDocuments.paths).toEqual([".", "/shared/left", "/shared/right"])
  })

  test("uses default ollama base URL when omitted", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "ollama",
        openAiKey: undefined,
        ollamaBaseUrl: undefined,
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(true)
    expect(cfg.getConfig().ollamaOptions?.baseUrl).toBe("http://localhost:11434")
  })

  test("defaults vector store to lancedb when omitted", () => {
    const cfg = new CodeIndexConfigManager(createInput({ vectorStoreProvider: undefined }))

    expect(cfg.getConfig().vectorStoreProvider).toBe("lancedb")
  })

  test("normalizes omitted vector store config to LanceDB for hosts", () => {
    expect(toIndexingConfigInput(undefined).vectorStoreProvider).toBe("lancedb")
  })

  test("uses explicit qdrant vector store", () => {
    const cfg = new CodeIndexConfigManager(createInput({ vectorStoreProvider: "qdrant" }))

    expect(cfg.getConfig().vectorStoreProvider).toBe("qdrant")
  })

  test("configures an OpenAI-compatible endpoint without an API key", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "openai-compatible",
        openAiKey: undefined,
        openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(true)
    expect(cfg.getConfig().openAiCompatibleOptions).toEqual({
      baseUrl: "http://localhost:1234/v1",
      apiKey: undefined,
    })
  })

  test("requires a base URL for an OpenAI-compatible endpoint", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "openai-compatible",
        openAiKey: undefined,
        openAiCompatibleApiKey: "sk-test",
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(false)
  })

  test("normalizes configured file extensions", () => {
    expect(normalizeFileExtensions([" PHP ", ".JS", "js", "css"])).toEqual([".css", ".js", ".php"])
    expect(parseFileExtensions(" PHP, .JS, js, css ")).toEqual([".css", ".js", ".php"])
    expect(parseFileExtensions("  ")).toBeUndefined()
    expect(toIndexingConfigInput({ fileExtensions: ["PHP", ".JS"] }).fileExtensions).toEqual([".js", ".php"])
    expect(normalizeFileExtensions(["", "  "])).toBeUndefined()
    expect(
      normalizeFileExtensions(Array.from({ length: 10_000 }, (_, index) => (index % 2 ? " PHP " : ".JS"))),
    ).toEqual([".js", ".php"])
  })

  test("validates file extension tokens", () => {
    expect(IndexingConfig.safeParse({ fileExtensions: ["php", " .JS "] }).success).toBe(true)
    expect(IndexingConfig.safeParse({ fileExtensions: [] }).success).toBe(false)
    expect(IndexingConfig.safeParse({ fileExtensions: ["*.js"] }).success).toBe(false)
    expect(IndexingConfig.safeParse({ fileExtensions: ["src/php"] }).success).toBe(false)
    expect(IndexingConfig.safeParse({ fileExtensions: [".d.ts"] }).success).toBe(false)
  })

  test("configures ChipMate with hosted auth options and explicit model metadata", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "chipmate",
        openAiKey: undefined,
        chipmateApiKey: "chipmate-token",
        chipmateBaseUrl: "https://example.test/api/gateway/",
        chipmateOrganizationId: "org_123",
        modelId: "mistralai/mistral-embed-2312",
        modelDimension: 1024,
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(true)
    expect(cfg.getConfig().chipmateOptions).toEqual({
      apiKey: "chipmate-token",
      baseUrl: "https://example.test/api/gateway/",
      organizationId: "org_123",
    })
    expect(cfg.currentModelId).toBe("mistralai/mistral-embed-2312")
    expect(cfg.currentModelDimension).toBe(1024)
  })

  test("requires ChipMate model metadata from Cloud config", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "chipmate",
        openAiKey: undefined,
        chipmateApiKey: "chipmate-token",
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(false)
    expect(cfg.currentModelId).toBeUndefined()
    expect(cfg.currentModelDimension).toBeUndefined()
  })

  test("uses configured dimension for ChipMate models outside the fallback catalog", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "chipmate",
        openAiKey: undefined,
        chipmateApiKey: "chipmate-token",
        modelId: "custom/model",
        modelDimension: 2048,
      }),
    )

    expect(cfg.currentModelId).toBe("custom/model")
    expect(cfg.currentModelDimension).toBe(2048)
  })

  test("uses configured dimension before static model metadata", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "openrouter",
        openAiKey: undefined,
        openRouterApiKey: "or-test",
        modelId: "google/gemini-embedding-2-preview",
        modelDimension: 1536,
      }),
    )

    expect(cfg.currentModelDimension).toBe(1536)
  })

  describe("loadConfiguration restart checks", () => {
    test("does not restart for an identical normalized indexing configuration", () => {
      const input = createInput({
        embedderProvider: "openai-compatible",
        openAiKey: undefined,
        openAiCompatibleBaseUrl: "http://127.0.0.1:1234/v1/embeddings",
        modelId: "fixture-model",
        modelDimension: 1024,
        searchMinScore: 0.4,
        searchMaxResults: 12,
        embeddingBatchSize: 16,
        scannerMaxBatchRetries: 2,
        documents: { enabled: true, paths: [".", "docs"] },
      })
      const cfg = new CodeIndexConfigManager(input)

      expect(cfg.loadConfiguration(structuredClone(input)).requiresRestart).toBe(false)
    })

    test("does not restart Code Graph or RAG services for search and batching tuning", () => {
      const cfg = new CodeIndexConfigManager(
        createInput({
          searchMinScore: 0.4,
          searchMaxResults: 10,
          embeddingBatchSize: 8,
          scannerMaxBatchRetries: 1,
        }),
      )

      const result = cfg.loadConfiguration(
        createInput({
          searchMinScore: 0.6,
          searchMaxResults: 30,
          embeddingBatchSize: 32,
          scannerMaxBatchRetries: 5,
        }),
      )

      expect(result.requiresRestart).toBe(false)
      expect(cfg.currentSearchMinScore).toBe(0.6)
      expect(cfg.currentSearchMaxResults).toBe(30)
      expect(cfg.currentEmbeddingBatchSize).toBe(32)
      expect(cfg.currentScannerMaxBatchRetries).toBe(5)
    })

    test("does not restart Code Graph or RAG services for Document RAG-only changes", () => {
      const cfg = new CodeIndexConfigManager(
        createInput({
          documents: {
            enabled: true,
            paths: ["docs"],
            include: ["**/*.md"],
            maxFiles: 100,
          },
        }),
      )

      const result = cfg.loadConfiguration(
        createInput({
          documents: {
            enabled: true,
            paths: ["docs", "specs"],
            include: ["**/*.md", "**/*.txt"],
            exclude: ["**/archive/**"],
            maxFiles: 200,
          },
        }),
      )

      expect(result.requiresRestart).toBe(false)
      expect(cfg.currentDocuments).toMatchObject({
        paths: [".", "docs", "specs"],
        include: ["**/*.md", "**/*.txt"],
        exclude: ["**/archive/**"],
        maxFiles: 200,
      })
    })

    test("requires restart when model changes with same dimension", () => {
      const cfg = new CodeIndexConfigManager(createInput({ modelId: "text-embedding-3-small" }))

      const result = cfg.loadConfiguration(createInput({ modelId: "text-embedding-ada-002" }))

      expect(result.requiresRestart).toBe(true)
    })

    test("requires a RAG service restart when the OpenAI-compatible endpoint changes", () => {
      const cfg = new CodeIndexConfigManager(
        createInput({
          embedderProvider: "openai-compatible",
          openAiKey: undefined,
          openAiCompatibleBaseUrl: "http://127.0.0.1:1234/v1/embeddings",
          modelId: "fixture-model",
          modelDimension: 1024,
        }),
      )

      const result = cfg.loadConfiguration(
        createInput({
          embedderProvider: "openai-compatible",
          openAiKey: undefined,
          openAiCompatibleBaseUrl: "http://127.0.0.1:1235/v1/embeddings",
          modelId: "fixture-model",
          modelDimension: 1024,
        }),
      )

      expect(result.requiresRestart).toBe(true)
    })

    test("requires a RAG service restart when vector schema compatibility changes", () => {
      const cfg = new CodeIndexConfigManager(
        createInput({
          modelId: "text-embedding-3-small",
          modelDimension: 1024,
          lancedbVectorStoreDirectory: "/tmp/vector-a",
        }),
      )

      expect(
        cfg.loadConfiguration(
          createInput({
            modelId: "text-embedding-3-small",
            modelDimension: 2048,
            lancedbVectorStoreDirectory: "/tmp/vector-a",
          }),
        ).requiresRestart,
      ).toBe(true)
      expect(
        cfg.loadConfiguration(
          createInput({
            modelId: "text-embedding-3-small",
            modelDimension: 2048,
            lancedbVectorStoreDirectory: "/tmp/vector-b",
          }),
        ).requiresRestart,
      ).toBe(true)
    })

    test("does not restart when default model is made explicit", () => {
      const cfg = new CodeIndexConfigManager(createInput())

      const result = cfg.loadConfiguration(createInput({ modelId: "text-embedding-3-small" }))

      expect(result.requiresRestart).toBe(false)
    })

    test("requires restart when provider changes with same dimension", () => {
      const cfg = new CodeIndexConfigManager(createInput({ modelId: "text-embedding-3-small" }))

      const result = cfg.loadConfiguration(
        createInput({
          embedderProvider: "vercel-ai-gateway",
          vercelAiGatewayApiKey: "kg-test",
          openAiKey: undefined,
          modelId: "text-embedding-3-small",
        }),
      )

      expect(result.requiresRestart).toBe(true)
    })

    test("requires restart when ChipMate auth changes", () => {
      const cfg = new CodeIndexConfigManager(
        createInput({
          embedderProvider: "chipmate",
          openAiKey: undefined,
          chipmateApiKey: "old-token",
          modelId: "mistralai/mistral-embed-2312",
          modelDimension: 1024,
        }),
      )

      const result = cfg.loadConfiguration(
        createInput({
          embedderProvider: "chipmate",
          openAiKey: undefined,
          chipmateApiKey: "new-token",
          modelId: "mistralai/mistral-embed-2312",
          modelDimension: 1024,
        }),
      )

      expect(result.requiresRestart).toBe(true)
    })

    test("restarts only when the normalized file extension allowlist changes", () => {
      const cfg = new CodeIndexConfigManager(createInput({ fileExtensions: ["php", ".JS"] }))

      expect(cfg.getConfig().fileExtensions).toEqual([".js", ".php"])
      expect(cfg.loadConfiguration(createInput({ fileExtensions: [".js", ".PHP", "php"] })).requiresRestart).toBe(false)
      expect(cfg.loadConfiguration(createInput({ fileExtensions: [".css"] })).requiresRestart).toBe(true)
    })
  })
})
