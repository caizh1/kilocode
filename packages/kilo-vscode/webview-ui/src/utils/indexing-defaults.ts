import type { IndexingConfig } from "../types/messages"
import {
  INTERNAL_OFFLINE_INDEXING_DEFAULTS,
  internalOfflineIndexingDefaults,
  isInternalOfflineBuild,
} from "../../../src/shared/internal-offline"

export function applyInternalIndexingDefaults(
  cfg: IndexingConfig = {},
  enabled = isInternalOfflineBuild(),
): IndexingConfig {
  if (!enabled) return cfg

  const def = internalOfflineIndexingDefaults()
  const provider = cfg.provider ?? def.provider
  const documents = {
    ...cfg.documents,
    enabled: cfg.documents?.enabled ?? true,
    paths: cfg.documents?.paths?.length ? cfg.documents.paths : ["."],
  }
  const base = {
    ...cfg,
    enabled: cfg.enabled ?? true,
    documents,
    provider,
  }
  if (provider !== def.provider) return base
  const providerOptions = def["openai-compatible"]
    ? { "openai-compatible": { ...def["openai-compatible"], ...(cfg["openai-compatible"] ?? {}) } }
    : {}

  return {
    ...base,
    ...providerOptions,
    model: cfg.model === undefined ? def.model : cfg.model,
    dimension: cfg.dimension === undefined ? def.dimension : cfg.dimension,
    vectorStore: cfg.vectorStore ?? def.vectorStore,
  }
}

export function mergeIndexingConfigForDisplay(globalCfg: IndexingConfig = {}, projectCfg: IndexingConfig = {}) {
  return { ...globalCfg, ...projectCfg }
}

const INTERNAL_INDEXING_MATERIALIZE_KEYS = new Set<keyof IndexingConfig>([
  "provider",
  "model",
  "dimension",
  "vectorStore",
  "kilo",
  "openai",
  "ollama",
  "openai-compatible",
  "gemini",
  "mistral",
  "vercel-ai-gateway",
  "bedrock",
  "openrouter",
  "voyage",
  "qdrant",
  "lancedb",
])

export function materializeInternalIndexingDefaultsForSave(
  cfg: IndexingConfig = {},
  partial: IndexingConfig,
  enabled = isInternalOfflineBuild(),
): IndexingConfig {
  if (!enabled) return partial
  if (!Object.keys(partial).some((key) => INTERNAL_INDEXING_MATERIALIZE_KEYS.has(key as keyof IndexingConfig))) {
    return partial
  }

  const def = INTERNAL_OFFLINE_INDEXING_DEFAULTS
  const current = applyInternalIndexingDefaults(cfg, enabled)
  const provider = partial.provider ?? current.provider
  if (provider !== def.provider) return partial
  const providerKey = def.provider
  const providerOptions =
    current[providerKey] || partial[providerKey]
      ? { [providerKey]: { ...(current[providerKey] ?? {}), ...(partial[providerKey] ?? {}) } }
      : {}

  return {
    provider: def.provider,
    model: partial.model !== undefined ? partial.model : (cfg.model ?? current.model),
    dimension: partial.dimension !== undefined ? partial.dimension : (cfg.dimension ?? current.dimension),
    vectorStore: partial.vectorStore !== undefined ? partial.vectorStore : (cfg.vectorStore ?? current.vectorStore),
    ...partial,
    ...providerOptions,
  }
}
