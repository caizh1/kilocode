import type { EmbedderProvider } from "./manager"

export type DocumentIndexConfig = {
  enabled?: boolean
  paths?: string[]
  include?: string[]
  exclude?: string[]
  maxFiles?: number
  maxFileBytes?: number
  maxExtractedBytesPerFile?: number
  chunkChars?: number
  chunkOverlapChars?: number
  searchMaxResults?: number
}

/**
 * Configuration state for the code indexing feature.
 *
 * RATIONALE: Replaced the legacy ApiHandlerOptions / ContextProxy types with
 * indexing-local option shapes so the package does not depend on the
 * extension's configuration plumbing.
 */
export interface CodeIndexConfig {
  isConfigured: boolean
  embedderProvider: EmbedderProvider
  vectorStoreProvider?: "lancedb" | "qdrant"
  lancedbVectorStoreDirectoryPlaceholder?: string
  modelId?: string
  modelDimension?: number
  kiloOptions?: { apiKey: string; baseUrl?: string; organizationId?: string }
  openAiOptions?: { apiKey: string }
  ollamaOptions?: { baseUrl: string; modelId?: string }
  openAiCompatibleOptions?: { baseUrl: string; apiKey: string }
  geminiOptions?: { apiKey: string }
  mistralOptions?: { apiKey: string }
  vercelAiGatewayOptions?: { apiKey: string }
  bedrockOptions?: { region: string; profile?: string }
  openRouterOptions?: { apiKey: string; specificProvider?: string }
  voyageOptions?: { apiKey: string }
  qdrantUrl?: string
  qdrantApiKey?: string
  searchMinScore?: number
  searchMaxResults?: number
  embeddingBatchSize?: number
  scannerMaxBatchRetries?: number
  documents?: DocumentIndexConfig
}

export type PreviousConfigSnapshot = {
  enabled: boolean
  configured: boolean
  embedderProvider: EmbedderProvider
  vectorStoreProvider?: "lancedb" | "qdrant"
  lancedbVectorStoreDirectory?: string
  modelId?: string
  modelDimension?: number
  kiloApiKey?: string
  kiloBaseUrl?: string
  kiloOrganizationId?: string
  openAiKey?: string
  ollamaBaseUrl?: string
  openAiCompatibleBaseUrl?: string
  openAiCompatibleApiKey?: string
  geminiApiKey?: string
  mistralApiKey?: string
  vercelAiGatewayApiKey?: string
  bedrockRegion?: string
  bedrockProfile?: string
  openRouterApiKey?: string
  openRouterSpecificProvider?: string
  voyageApiKey?: string
  qdrantUrl?: string
  qdrantApiKey?: string
  documents?: DocumentIndexConfig
}
