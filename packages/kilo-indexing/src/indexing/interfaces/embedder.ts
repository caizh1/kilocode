/**
 * Interface for code index embedders.
 * This interface is implemented by both OpenAI and Ollama embedders.
 */
export interface IEmbedder {
  /**
   * Creates embeddings for the given texts.
   * @param texts Array of text strings to create embeddings for
   * @param model Optional model ID to use for embeddings
   * @returns Promise resolving to an EmbeddingResponse
   */
  createEmbeddings(texts: string[], model?: string, purpose?: EmbeddingPurpose): Promise<EmbeddingResponse>

  /**
   * Validates the embedder configuration by testing connectivity and credentials.
   * @returns Promise resolving to validation result with success status and optional error message
   */
  validateConfiguration(): Promise<EmbeddingValidationResult>

  get embedderInfo(): EmbedderInfo
}

export type EmbeddingPurpose = "document" | "code-query" | "document-query" | "validation"

export type EmbeddingQualityResult = {
  version: string
  minNorm: number
  minVariance: number
  maxZeroRatio: number
  commonZeroTail: number
  maxCosine: number
  semanticTop1: number
  semanticTop3: number
}

export type EmbeddingValidationResult = {
  valid: boolean
  error?: string
  dimension?: number
  quality?: EmbeddingQualityResult
}

export type EmbeddingRuntimeProfile = {
  provider: AvailableEmbedders
  modelId: string
  dimensionMode: "auto" | "fixed"
  requestedDimension?: number
  dimension: number
  endpointDigest: string
  fingerprint: number[][]
  fingerprintDigest: string
  qualityVersion: string
  instructionVersion?: string
}

export interface EmbeddingResponse {
  embeddings: number[][]
  usage?: {
    promptTokens: number
    totalTokens: number
  }
}

export type AvailableEmbedders =
  | "kilo"
  | "openai"
  | "ollama"
  | "openai-compatible"
  | "gemini"
  | "mistral"
  | "vercel-ai-gateway"
  | "bedrock"
  | "openrouter"
  | "voyage"

export interface EmbedderInfo {
  name: AvailableEmbedders
}
