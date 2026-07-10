import type { IndexingConfig } from "@kilocode/kilo-indexing/config"

export const INTERNAL_OFFLINE_INDEXING_DEFAULTS = {
  provider: "openai-compatible",
  model: "qwen3-embedding-8b",
  dimension: 2048,
  vectorStore: "lancedb",
} as const

export function isInternalOffline(): boolean {
	return process.env.CHIPMATE_INTERNAL_OFFLINE === "1" || process.env.KILO_INTERNAL_OFFLINE === "1"
}

export function internalOfflineIndexingOpenAICompatibleBaseUrl(): string | undefined {
	const value = process.env.KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL?.trim()
	return value || undefined
}

export function internalOfflineIndexingDefaults(): IndexingConfig {
	const baseUrl = internalOfflineIndexingOpenAICompatibleBaseUrl()
	return {
		...INTERNAL_OFFLINE_INDEXING_DEFAULTS,
		...(baseUrl ? { "openai-compatible": { baseUrl } } : {}),
	}
}

export function applyInternalIndexingDefaults(
	cfg: IndexingConfig | undefined,
	enabled = isInternalOffline(),
): IndexingConfig | undefined {
	if (!enabled) return cfg

	const def = internalOfflineIndexingDefaults()
	const provider = cfg?.provider ?? def.provider
	if (provider !== def.provider) return { ...cfg, provider }
	const providerOptions = def["openai-compatible"] || cfg?.["openai-compatible"]
		? { "openai-compatible": { ...(def["openai-compatible"] ?? {}), ...(cfg?.["openai-compatible"] ?? {}) } }
		: {}

	return {
		...cfg,
		...providerOptions,
		provider,
		model: cfg?.model === undefined ? def.model : cfg.model,
		dimension: cfg?.dimension === undefined ? def.dimension : cfg.dimension,
    vectorStore: cfg?.vectorStore ?? def.vectorStore,
  }
}
