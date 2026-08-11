import { resolveChipMateGatewayBaseUrl } from "@chipmate/chipmate-gateway"
import { HEADER_FEATURE, HEADER_ORGANIZATIONID } from "@chipmate/chipmate-gateway"
import { MAX_ITEM_TOKENS } from "../constants"
import type { EmbedderInfo, EmbeddingResponse, IEmbedder } from "../interfaces/embedder"
import { Log } from "../../util/log"
import { OpenAICompatibleEmbedder } from "./openai-compatible"

const log = Log.create({ service: "embedder-chipmate" })

export const CHIPMATE_INDEXING_FEATURE = "managed-indexing"

export class ChipMateEmbedder implements IEmbedder {
  private readonly embedder: OpenAICompatibleEmbedder
  private readonly model: string

  constructor(input: {
    apiKey: string
    baseUrl?: string
    organizationId?: string
    modelId?: string
    dimensions?: number
  }) {
    if (!input.apiKey) throw new Error("ChipMate API key is required for embedding.")

    if (!input.modelId) throw new Error("ChipMate embedding model is required.")
    this.model = input.modelId
    const headers: Record<string, string> = {
      [HEADER_FEATURE]: CHIPMATE_INDEXING_FEATURE,
      ...(input.organizationId ? { [HEADER_ORGANIZATIONID]: input.organizationId } : {}),
    }

    this.embedder = new OpenAICompatibleEmbedder(
      resolveChipMateGatewayBaseUrl({ baseURL: input.baseUrl, token: input.apiKey }),
      input.apiKey,
      this.model,
      MAX_ITEM_TOKENS,
      { headers, dimensions: input.dimensions, sendDimensions: true },
    )
  }

  async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
    try {
      return await this.embedder.createEmbeddings(texts, model || this.model)
    } catch (err) {
      log.error("ChipMate embedder error", {
        err: err instanceof Error ? err.message : String(err),
        location: "ChipMateEmbedder:createEmbeddings",
      })
      throw err
    }
  }

  async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    try {
      return await this.embedder.validateConfiguration()
    } catch (err) {
      log.error("ChipMate embedder validation error", {
        err: err instanceof Error ? err.message : String(err),
        location: "ChipMateEmbedder:validateConfiguration",
      })
      throw err
    }
  }

  get embedderInfo(): EmbedderInfo {
    return { name: "chipmate" }
  }
}
