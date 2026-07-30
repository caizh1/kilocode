import type { IndexingConfig } from "@kilocode/kilo-indexing/config"

export const INTERNAL_OFFLINE_INDEXING_DEFAULTS = {
  provider: "openai-compatible",
  model: "qwen3-embedding-8b",
  dimensionMode: "auto",
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
  const paths = [".", ...(cfg?.documents?.paths ?? []).filter((item) => item !== ".")]
  const documents = {
    ...cfg?.documents,
    enabled: cfg?.documents?.enabled ?? true,
    paths,
  }
  const base = {
    ...cfg,
    enabled: cfg?.enabled ?? true,
    documents,
    provider,
  }
  if (provider !== def.provider) return base
  const providerOptions =
    def["openai-compatible"] || cfg?.["openai-compatible"]
      ? { "openai-compatible": { ...(def["openai-compatible"] ?? {}), ...(cfg?.["openai-compatible"] ?? {}) } }
      : {}
  const model = cfg?.model === undefined ? def.model : cfg.model
  const legacy =
    model === def.model &&
    cfg?.dimensionMode === undefined &&
    (cfg?.dimension === 2048 || cfg?.dimension === 4096)
  const dimensionMode =
    cfg?.dimensionMode ?? (legacy || cfg?.dimension === undefined || cfg.dimension === null ? "auto" : "fixed")
  const dimension = dimensionMode === "fixed" ? cfg?.dimension : undefined
  const normalized = { ...base }
  if (dimensionMode === "auto") delete normalized.dimension

  return {
    ...normalized,
    ...providerOptions,
    model,
    dimensionMode,
    ...(dimension !== undefined ? { dimension } : {}),
    vectorStore: cfg?.vectorStore ?? def.vectorStore,
  }
}
