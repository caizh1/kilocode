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

export function applyInternalIndexingDefaults(
  cfg: IndexingConfig | undefined,
  enabled = isInternalOffline(),
): IndexingConfig | undefined {
  if (!enabled) return cfg

  const def = INTERNAL_OFFLINE_INDEXING_DEFAULTS
  const provider = cfg?.provider ?? def.provider
  if (provider !== def.provider) return { ...cfg, provider }

  return {
    ...cfg,
    provider,
    model: cfg?.model ?? def.model,
    dimension: cfg?.dimension ?? def.dimension,
    vectorStore: cfg?.vectorStore ?? def.vectorStore,
  }
}
