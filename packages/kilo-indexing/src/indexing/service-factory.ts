import path from "path"

import { getDefaultModelId } from "./model-registry"
import { resolveEmbeddingProfile } from "./embedding-profile"

import { OpenAiEmbedder } from "./embedders/openai"
import { KiloEmbedder } from "./embedders/kilo"
import { CodeIndexOllamaEmbedder } from "./embedders/ollama"
import { OpenAICompatibleEmbedder } from "./embedders/openai-compatible"
import { GeminiEmbedder } from "./embedders/gemini"
import { MistralEmbedder } from "./embedders/mistral"
import { VercelAiGatewayEmbedder } from "./embedders/vercel-ai-gateway"
import { BedrockEmbedder } from "./embedders/bedrock"
import { OpenRouterEmbedder } from "./embedders/openrouter"
import { VoyageEmbedder } from "./embedders/voyage"
import { QdrantVectorStore } from "./vector-store/qdrant-client"
import { LanceDBVectorStore } from "./vector-store/lancedb-vector-store"
import { loadActiveEmbeddingProfile, SafeLanceDBVectorStore } from "./vector-store/safe-lancedb-vector-store"
import { codeParser, CodeParser, DirectoryScanner, FileWatcher } from "./processors"
import { DocumentIndexService } from "./documents"
import type {
  AvailableEmbedders,
  EmbeddingRuntimeProfile,
  EmbeddingValidationResult,
  ICodeParser,
  IEmbedder,
  IFileWatcher,
  IVectorStore,
} from "./interfaces"
import type { ICodeGraphStorage, ICodePostingsStorage } from "./codegraph"
import type { CodeIndexConfigManager } from "./config-manager"
import type { CacheManager } from "./cache-manager"
import type { IndexingTelemetryMeta, IndexingTelemetryReporter } from "./interfaces/telemetry"
import type { RagCheckpointMeta } from "./rag-checkpoint"
import {
  fallbackCheckpointMeta,
  RAG_CHECKPOINT_SCHEMA_VERSION,
  RAG_CHUNKER_VERSION,
  RAG_PARSER_VERSION,
} from "./rag-checkpoint"
import {
  BATCH_SEGMENT_THRESHOLD,
  DEFAULT_VECTOR_STORE,
  OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS,
  REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
} from "./constants"
import { Log } from "../util/log"
import type { IgnoreMatcher } from "./shared/load-ignore"
import { endpointDigest, probeEmbedding, type PreparedEmbeddingRuntime } from "./embedding-quality"
import { EmbeddingRuntimeStore } from "./embedding-runtime-store"

const log = Log.create({ service: "indexing-factory" })

function product(): string | undefined {
  return process.env.KILO_PRODUCT_PROFILE === "chipmate-v2" ? "chipmate-v2" : undefined
}

function internal(): boolean {
  return (
    product() === "chipmate-v2" ||
    process.env.CHIPMATE_INTERNAL_OFFLINE === "1" ||
    process.env.KILO_INTERNAL_OFFLINE === "1"
  )
}

function isolated(dir: string): string {
  const profile = product()
  return profile ? path.join(dir, profile) : dir
}

// RATIONALE: The OpenAI SDK applies the per-attempt timeout and retries internally.
const policy = {
  openai: undefined,
  openrouter: undefined,
  "openai-compatible": undefined,
  kilo: undefined,
  gemini: undefined,
  mistral: undefined,
  "vercel-ai-gateway": undefined,
  ollama: {
    timeout: OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS,
    error: "Connection to embedding service failed (timeout)",
  },
  voyage: {
    timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
    error: "Connection failed. Please check the endpoint URL and network connectivity.",
  },
  bedrock: {
    timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
    error: "Connection failed. Please check the endpoint URL and network connectivity.",
  },
} satisfies Record<AvailableEmbedders, { timeout: number; error: string } | undefined>

/**
 * Factory class responsible for creating and configuring code indexing service dependencies.
 *
 * RATIONALE: Removed vscode.ExtensionContext, Package, RooIgnoreController, and
 * LanceDBManager inputs. All batch sizing, retry counts, vector-store selection,
 * and model selection now come from the injected CodeIndexConfigManager.
 */
export class CodeIndexServiceFactory {
  constructor(
    private readonly configManager: CodeIndexConfigManager,
    private readonly workspacePath: string,
    private readonly cacheManager: CacheManager,
    private readonly cacheDirectory: string,
    private readonly ignoreFingerprint: string,
    private readonly onTelemetry?: IndexingTelemetryReporter,
    private readonly graph?: ICodeGraphStorage,
    private readonly postings?: ICodePostingsStorage,
  ) {}

  private getTelemetryMeta(): IndexingTelemetryMeta {
    const cfg = this.configManager.getConfig()
    return {
      provider: cfg.embedderProvider,
      vectorStore: cfg.vectorStoreProvider ?? DEFAULT_VECTOR_STORE,
      modelId: cfg.modelId,
    }
  }

  private storage(): string {
    const config = this.configManager.getConfig()
    if (config.lancedbVectorStoreDirectoryPlaceholder) {
      return isolated(config.lancedbVectorStoreDirectoryPlaceholder)
    }
    return internal() ? path.join(this.cacheDirectory, "c") : this.legacyStorage()
  }

  private legacyStorage(): string {
    const config = this.configManager.getConfig()
    return isolated(config.lancedbVectorStoreDirectoryPlaceholder ?? path.join(this.cacheDirectory, "lancedb"))
  }

  private documentStorage(): string {
    const config = this.configManager.getConfig()
    if (config.lancedbVectorStoreDirectoryPlaceholder) {
      return isolated(path.join(config.lancedbVectorStoreDirectoryPlaceholder, "documents"))
    }
    return internal() ? path.join(this.cacheDirectory, "d") : this.legacyDocumentStorage()
  }

  private legacyDocumentStorage(): string {
    const config = this.configManager.getConfig()
    const base = config.lancedbVectorStoreDirectoryPlaceholder ?? this.cacheDirectory
    return isolated(path.join(base, config.lancedbVectorStoreDirectoryPlaceholder ? "documents" : "lancedb-documents"))
  }

  private legacyDirectories(current: string, legacy: string): string[] {
    return current === legacy ? [] : [legacy]
  }

  private async previous(): Promise<EmbeddingRuntimeProfile | undefined> {
    const config = this.configManager.getConfig()
    if (config.vectorStoreProvider === "lancedb") {
      const current = this.storage()
      const legacy = this.legacyStorage()
      const active = await loadActiveEmbeddingProfile(
        this.workspacePath,
        current,
        this.legacyDirectories(current, legacy),
      )
      if (active) return active
    }
    return new EmbeddingRuntimeStore(this.cacheDirectory, this.workspacePath).load()
  }

  public createEmbedder(runtime?: EmbeddingRuntimeProfile): IEmbedder {
    const config = this.configManager.getConfig()
    const provider = config.embedderProvider

    if (provider === "kilo") {
      if (!config.kiloOptions?.apiKey) throw new Error("Kilo API key is required for embedding.")
      if (!config.modelId) throw new Error("Kilo embedding model is required.")
      return new KiloEmbedder({
        apiKey: config.kiloOptions.apiKey,
        baseUrl: config.kiloOptions.baseUrl,
        organizationId: config.kiloOptions.organizationId,
        modelId: config.modelId,
        dimensions: config.modelDimension,
      })
    }
    if (provider === "openai") {
      if (!config.openAiOptions?.apiKey) throw new Error("OpenAI API key is required for embedding.")
      return new OpenAiEmbedder(config.openAiOptions.apiKey, config.modelId)
    }
    if (provider === "ollama") {
      if (!config.ollamaOptions?.baseUrl) throw new Error("Ollama base URL is required for embedding.")
      return new CodeIndexOllamaEmbedder(config.ollamaOptions.baseUrl, config.modelId, config.modelDimension)
    }
    if (provider === "openai-compatible") {
      if (!config.openAiCompatibleOptions?.baseUrl) throw new Error("OpenAI-compatible base URL is required.")
      const model = runtime?.modelId ?? config.modelId
      const dimension = runtime?.requestedDimension ?? config.modelDimension
      const fixed = runtime ? runtime.dimensionMode === "fixed" : config.dimensionMode === "fixed"
      const matryoshka = (model ?? "").toLowerCase() === "qwen3-embedding-8b"
      return new OpenAICompatibleEmbedder(
        config.openAiCompatibleOptions.baseUrl,
        config.openAiCompatibleOptions.apiKey,
        config.modelId,
        undefined,
        {
          dimensions: dimension,
          expectedDimension: fixed ? dimension : runtime?.dimension,
          sendDimensions: fixed && matryoshka,
        },
      )
    }
    if (provider === "gemini") {
      if (!config.geminiOptions?.apiKey) throw new Error("Gemini API key is required for embedding.")
      return new GeminiEmbedder(config.geminiOptions.apiKey, config.modelId)
    }
    if (provider === "mistral") {
      if (!config.mistralOptions?.apiKey) throw new Error("Mistral API key is required for embedding.")
      return new MistralEmbedder(config.mistralOptions.apiKey, config.modelId)
    }
    if (provider === "vercel-ai-gateway") {
      if (!config.vercelAiGatewayOptions?.apiKey)
        throw new Error("Vercel AI Gateway API key is required for embedding.")
      return new VercelAiGatewayEmbedder(config.vercelAiGatewayOptions.apiKey, config.modelId)
    }
    if (provider === "bedrock") {
      if (!config.bedrockOptions?.region) throw new Error("Bedrock region is required for embedding.")
      return new BedrockEmbedder(config.bedrockOptions.region, config.bedrockOptions.profile, config.modelId)
    }
    if (provider === "openrouter") {
      if (!config.openRouterOptions?.apiKey) throw new Error("OpenRouter API key is required for embedding.")
      return new OpenRouterEmbedder(
        config.openRouterOptions.apiKey,
        config.modelId,
        undefined,
        config.openRouterOptions.specificProvider,
        config.modelDimension,
      )
    }
    if (provider === "voyage") {
      if (!config.voyageOptions?.apiKey) throw new Error("Voyage API key is required for embedding.")
      return new VoyageEmbedder(config.voyageOptions.apiKey, config.modelId)
    }

    throw new Error(`Unsupported embedder provider: ${provider}`)
  }

  public async validateEmbedder(embedder: IEmbedder): Promise<EmbeddingValidationResult> {
    const deadline = policy[embedder.embedderInfo.name]
    let timer: ReturnType<typeof setTimeout> | undefined
    const wait = embedder.validateConfiguration()
    const fail =
      deadline === undefined
        ? undefined
        : new Promise<EmbeddingValidationResult>((resolve) => {
            timer = setTimeout(
              () =>
                resolve({
                  valid: false,
                  error: deadline.error,
                }),
              deadline.timeout,
            )
          })

    try {
      log.info("validating embedder", { provider: embedder.embedderInfo.name })
      const result = fail ? await Promise.race([wait, fail]) : await wait
      if (result.valid) {
        log.info("embedder validation succeeded", { provider: embedder.embedderInfo.name })
      }
      if (!result.valid) {
        log.warn("embedder validation failed", {
          provider: embedder.embedderInfo.name,
          error: result.error,
        })
      }
      return result
    } catch (err) {
      log.error("embedder validation failed", { err })
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Configuration validation error",
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  public usesAdaptiveEmbedding(): boolean {
    const config = this.configManager.getConfig()
    return (
      internal() &&
      config.embedderProvider === "openai-compatible" &&
      (config.modelId ?? "").toLowerCase() === "qwen3-embedding-8b"
    )
  }

  public async prepareEmbeddingRuntime(): Promise<PreparedEmbeddingRuntime> {
    if (!this.usesAdaptiveEmbedding()) {
      throw new Error("Adaptive embedding runtime is only available for the internal Qwen3 embedding profile.")
    }
    const config = this.configManager.getConfig()
    const endpoint = config.openAiCompatibleOptions?.baseUrl
    if (!endpoint) throw new Error("OpenAI-compatible base URL is required.")
    const previous = await this.previous()
    return probeEmbedding(this.createEmbedder(), {
      provider: "openai-compatible",
      modelId: config.modelId ?? "qwen3-embedding-8b",
      dimensionMode: config.dimensionMode ?? "auto",
      requestedDimension: config.modelDimension,
      endpoint,
      instructions: true,
      previous,
    })
  }

  public async prepareLastKnownGoodRuntime(): Promise<PreparedEmbeddingRuntime | undefined> {
    if (!this.usesAdaptiveEmbedding()) return
    const config = this.configManager.getConfig()
    const endpoint = config.openAiCompatibleOptions?.baseUrl
    if (!endpoint) return
    const previous = await this.previous()
    if (!previous) return
    if (previous.provider !== "openai-compatible") return
    if (previous.modelId !== config.modelId) return
    if (previous.endpointDigest !== endpointDigest(endpoint)) return

    const runtime = await probeEmbedding(this.createEmbedder(previous), {
      provider: "openai-compatible",
      modelId: previous.modelId,
      dimensionMode: previous.dimensionMode,
      requestedDimension: previous.requestedDimension,
      endpoint,
      instructions: previous.instructionVersion !== undefined,
      previous,
    })
    if (runtime.drifted) return
    if (runtime.profile.fingerprintDigest !== previous.fingerprintDigest) return
    return runtime
  }

  public createVectorStore(workspacePath = this.workspacePath, runtime?: EmbeddingRuntimeProfile): IVectorStore {
    const config = this.configManager.getConfig()
    const profile = runtime
      ? {
          provider: runtime.provider,
          modelId: runtime.modelId,
          dimension: runtime.dimension,
          dimensionMode: runtime.dimensionMode,
          requestedDimension: runtime.requestedDimension,
          endpointDigest: runtime.endpointDigest,
          fingerprintDigest: runtime.fingerprintDigest,
          qualityVersion: runtime.qualityVersion,
          instructionVersion: runtime.instructionVersion,
        }
      : resolveEmbeddingProfile(config.embedderProvider, config.modelId, config.modelDimension)

    if (!profile || profile.dimension <= 0) {
      throw new Error(
        `Cannot determine vector dimension for model "${config.modelId ?? getDefaultModelId(config.embedderProvider)}" with provider "${config.embedderProvider}". ` +
          (config.embedderProvider === "openai-compatible"
            ? "Please set the model dimension explicitly."
            : "Check your model configuration."),
      )
    }

    if (config.vectorStoreProvider === "lancedb") {
      const dbDir = this.storage()
      const legacyDirectories = this.legacyDirectories(dbDir, this.legacyStorage())
      log.info("creating vector store", {
        provider: config.embedderProvider,
        vectorStore: "lancedb",
        model: profile.modelId,
        vectorSize: profile.dimension,
        dbDir,
        pathLayout: runtime ? "compact-generation" : "compact-workspace",
      })
      if (runtime) {
        return new SafeLanceDBVectorStore(
          workspacePath,
          dbDir,
          runtime,
          new EmbeddingRuntimeStore(this.cacheDirectory, this.workspacePath),
          undefined,
          legacyDirectories,
        )
      }
      return new LanceDBVectorStore(workspacePath, profile.dimension, dbDir, profile, undefined, legacyDirectories)
    }

    if (!config.qdrantUrl) throw new Error("Qdrant URL is required.")
    log.info("creating vector store", {
      provider: config.embedderProvider,
      vectorStore: "qdrant",
      model: profile.modelId,
      vectorSize: profile.dimension,
    })
    return new QdrantVectorStore(
      workspacePath,
      config.qdrantUrl,
      profile.dimension,
      config.qdrantApiKey,
      profile,
      product(),
    )
  }

  public createDocumentVectorStore(runtime?: EmbeddingRuntimeProfile): IVectorStore {
    const config = this.configManager.getConfig()
    const profile = runtime
      ? {
          provider: runtime.provider,
          modelId: runtime.modelId,
          dimension: runtime.dimension,
          dimensionMode: runtime.dimensionMode,
          requestedDimension: runtime.requestedDimension,
          endpointDigest: runtime.endpointDigest,
          fingerprintDigest: runtime.fingerprintDigest,
          qualityVersion: runtime.qualityVersion,
          instructionVersion: runtime.instructionVersion,
        }
      : resolveEmbeddingProfile(config.embedderProvider, config.modelId, config.modelDimension)

    if (!profile || profile.dimension <= 0) {
      throw new Error(
        `Cannot determine vector dimension for model "${config.modelId ?? getDefaultModelId(config.embedderProvider)}" with provider "${config.embedderProvider}". ` +
          (config.embedderProvider === "openai-compatible"
            ? "Please set the model dimension explicitly."
            : "Check your model configuration."),
      )
    }

    if (config.vectorStoreProvider === "lancedb") {
      const dbDir = this.documentStorage()
      const legacyDirectories = this.legacyDirectories(dbDir, this.legacyDocumentStorage())
      log.info("creating document vector store", {
        provider: config.embedderProvider,
        vectorStore: "lancedb",
        model: profile.modelId,
        vectorSize: profile.dimension,
        dbDir,
        pathLayout: runtime ? "compact-generation" : "compact-workspace",
      })
      if (runtime) {
        return new SafeLanceDBVectorStore(
          this.workspacePath,
          dbDir,
          runtime,
          new EmbeddingRuntimeStore(this.cacheDirectory, this.workspacePath),
          undefined,
          legacyDirectories,
        )
      }
      return new LanceDBVectorStore(this.workspacePath, profile.dimension, dbDir, profile, undefined, legacyDirectories)
    }

    if (!config.qdrantUrl) throw new Error("Qdrant URL is required.")
    log.info("creating document vector store", {
      provider: config.embedderProvider,
      vectorStore: "qdrant",
      model: profile.modelId,
      vectorSize: profile.dimension,
    })
    return new QdrantVectorStore(
      this.workspacePath,
      config.qdrantUrl,
      profile.dimension,
      config.qdrantApiKey,
      profile,
      [product(), "documents"].filter(Boolean).join("-"),
    )
  }

  public createRagCheckpointMeta(vectorStore: IVectorStore, runtime?: EmbeddingRuntimeProfile): RagCheckpointMeta {
    const config = this.configManager.getConfig()
    const profile = runtime
      ? {
          provider: runtime.provider,
          modelId: runtime.modelId,
          dimension: runtime.dimension,
        }
      : resolveEmbeddingProfile(config.embedderProvider, config.modelId, config.modelDimension)
    if (!profile) {
      throw new Error("Cannot determine embedding profile for RAG checkpoint metadata.")
    }
    return {
      root: this.workspacePath,
      schemaVersion: RAG_CHECKPOINT_SCHEMA_VERSION,
      parserVersion: RAG_PARSER_VERSION,
      chunkerVersion: RAG_CHUNKER_VERSION,
      embedderProvider: profile.provider,
      embedderModel: profile.modelId,
      embeddingDimension: profile.dimension,
      ...(runtime
        ? {
            dimensionMode: runtime.dimensionMode,
            requestedDimension: runtime.requestedDimension,
            endpointDigest: runtime.endpointDigest,
            fingerprintDigest: runtime.fingerprintDigest,
            qualityVersion: runtime.qualityVersion,
            instructionVersion: runtime.instructionVersion,
          }
        : {}),
      vectorStoreProvider: config.vectorStoreProvider ?? "lancedb",
      collectionName:
        vectorStore.getCollectionName?.() ?? `${config.vectorStoreProvider ?? "lancedb"}:${this.workspacePath}`,
      ignoreFingerprint: this.ignoreFingerprint,
    }
  }

  public createDirectoryScanner(
    embedder: IEmbedder | undefined,
    vectorStore: IVectorStore | undefined,
    parser: ICodeParser,
    ignoreInstance: IgnoreMatcher,
    opts: { writeCache?: boolean } = {},
    runtime?: EmbeddingRuntimeProfile,
  ): DirectoryScanner {
    const config = this.configManager.getConfig()
    const meta = this.getTelemetryMeta()
    const rag = vectorStore
      ? this.createRagCheckpointMeta(vectorStore, runtime)
      : fallbackCheckpointMeta(this.workspacePath)
    const scanner = new DirectoryScanner(
      embedder,
      vectorStore,
      parser,
      this.cacheManager,
      ignoreInstance,
      config.embeddingBatchSize,
      config.scannerMaxBatchRetries,
      this.onTelemetry,
      meta,
      this.graph,
      this.postings,
      opts,
      config.fileExtensions,
    )
    scanner.setRunContext(globalThis.crypto.randomUUID(), rag)
    return scanner
  }

  public createFileWatcher(
    embedder: IEmbedder | undefined,
    vectorStore: IVectorStore | undefined,
    cacheManager: CacheManager,
    ignoreInstance: IgnoreMatcher,
    parser: ICodeParser,
    opts: { writeCache?: boolean } = {},
    runtime?: EmbeddingRuntimeProfile,
  ): IFileWatcher {
    const config = this.configManager.getConfig()
    const meta = this.getTelemetryMeta()
    const rag = vectorStore
      ? this.createRagCheckpointMeta(vectorStore, runtime)
      : fallbackCheckpointMeta(this.workspacePath)
    const watcher = new FileWatcher(
      this.workspacePath,
      cacheManager,
      embedder,
      vectorStore,
      ignoreInstance,
      config.embeddingBatchSize,
      config.scannerMaxBatchRetries,
      this.onTelemetry,
      meta,
      this.graph,
      this.postings,
      { ...opts, lockCacheDirectory: this.cacheDirectory },
      config.fileExtensions,
      parser,
    )
    watcher.setRunContext(globalThis.crypto.randomUUID(), rag)
    return watcher
  }

  public createGraphServices(
    cacheManager: CacheManager,
    ignoreInstance: IgnoreMatcher,
  ): {
    parser: ICodeParser
    scanner: DirectoryScanner
    fileWatcher: IFileWatcher
    ragMeta: RagCheckpointMeta
  } {
    const parser = codeParser
    const opts = { writeCache: false }
    const scanner = this.createDirectoryScanner(undefined, undefined, parser, ignoreInstance, opts)
    const fileWatcher = this.createFileWatcher(undefined, undefined, cacheManager, ignoreInstance, parser, opts)
    const ragMeta = fallbackCheckpointMeta(this.workspacePath)
    return { parser, scanner, fileWatcher, ragMeta }
  }

  public createServices(
    cacheManager: CacheManager,
    ignoreInstance: IgnoreMatcher,
    runtime?: PreparedEmbeddingRuntime,
  ): {
    embedder: IEmbedder
    vectorStore: IVectorStore
    parser: ICodeParser
    scanner: DirectoryScanner
    fileWatcher: IFileWatcher
    ragMeta: RagCheckpointMeta
  } {
    if (!this.configManager.isFeatureConfigured) {
      throw new Error("Code indexing is not configured. Save your settings to start indexing.")
    }

    const config = this.configManager.getConfig()
    log.info("creating indexing services", {
      workspacePath: this.workspacePath,
      provider: config.embedderProvider,
      vectorStore: config.vectorStoreProvider,
      model: config.modelId ?? getDefaultModelId(config.embedderProvider),
      configured: config.isConfigured,
    })

    const embedder = runtime?.embedder ?? this.createEmbedder()
    const vectorStore = this.createVectorStore(this.workspacePath, runtime?.profile)
    const ragMeta = this.createRagCheckpointMeta(vectorStore, runtime?.profile)
    this.cacheManager.setCheckpointMeta(ragMeta)
    const parser = new CodeParser(config.fileExtensions)
    const scanner = this.createDirectoryScanner(embedder, vectorStore, parser, ignoreInstance, {}, runtime?.profile)
    const fileWatcher = this.createFileWatcher(
      embedder,
      vectorStore,
      cacheManager,
      ignoreInstance,
      parser,
      {},
      runtime?.profile,
    )

    log.info("indexing services created", {
      workspacePath: this.workspacePath,
      provider: embedder.embedderInfo.name,
    })

    return { embedder, vectorStore, parser, scanner, fileWatcher, ragMeta }
  }

  public createDocumentService(
    ignoreInstance: IgnoreMatcher,
    onStatus?: () => void,
    runtime?: PreparedEmbeddingRuntime,
    store?: IVectorStore,
  ): DocumentIndexService {
    if (!this.configManager.isFeatureConfigured) {
      throw new Error("Document RAG requires configured embeddings.")
    }

    const embedder = runtime?.embedder ?? this.createEmbedder()
    const vectorStore = store ?? this.createDocumentVectorStore(runtime?.profile)
    return new DocumentIndexService(
      this.workspacePath,
      this.cacheDirectory,
      this.configManager,
      embedder,
      vectorStore,
      ignoreInstance,
      onStatus,
      this.onTelemetry,
    )
  }
}
