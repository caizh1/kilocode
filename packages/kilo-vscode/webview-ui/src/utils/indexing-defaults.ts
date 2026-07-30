import type { IndexingConfig } from "../types/messages"
import {
  INTERNAL_OFFLINE_INDEXING_DEFAULTS,
  internalOfflineIndexingDefaults,
  isInternalOfflineBuild,
} from "../../../src/shared/internal-offline"

const mode = (cfg: IndexingConfig, model: IndexingConfig["model"], expected: IndexingConfig["model"]) => {
  const legacy =
    model === expected &&
    cfg.dimensionMode === undefined &&
    (cfg.dimension === 2048 || cfg.dimension === 4096)
  if (cfg.dimensionMode) return cfg.dimensionMode
  if (legacy || cfg.dimension === undefined || cfg.dimension === null) return "auto"
  return "fixed"
}

const size = (
  cfg: IndexingConfig,
  partial: IndexingConfig,
  current: IndexingConfig,
  custom: boolean,
  model: IndexingConfig["model"],
) => {
  if (partial.dimension !== undefined) return partial.dimension
  if (!custom) return cfg.dimension ?? current.dimension
  if (cfg.model === model) return cfg.dimension
  return undefined
}

const savedMode = (
  cfg: IndexingConfig,
  partial: IndexingConfig,
  current: IndexingConfig,
  dimension: IndexingConfig["dimension"],
) => {
  if (partial.dimensionMode) return partial.dimensionMode
  if (partial.dimension === null) return "auto"
  if (partial.dimension !== undefined) return "fixed"
  if (cfg.dimensionMode) return cfg.dimensionMode
  if (current.dimensionMode) return current.dimensionMode
  return dimension === undefined || dimension === null ? "auto" : "fixed"
}

export function applyInternalIndexingDefaults(
  cfg: IndexingConfig = {},
  enabled = isInternalOfflineBuild(),
): IndexingConfig {
  if (!enabled) return cfg

  const def = internalOfflineIndexingDefaults()
  const provider = cfg.provider ?? def.provider
  const paths = [".", ...(cfg.documents?.paths ?? []).filter((item) => item !== ".")]
  const documents = {
    ...cfg.documents,
    enabled: cfg.documents?.enabled ?? true,
    paths,
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
  const model = cfg.model === undefined ? def.model : cfg.model
  const dimensionMode = mode(cfg, model, def.model)
  const dimension = dimensionMode === "fixed" ? cfg.dimension : undefined
  const normalized = { ...base }
  if (dimensionMode === "auto") delete normalized.dimension

  return {
    ...normalized,
    ...providerOptions,
    model,
    dimensionMode,
    ...(dimension !== undefined ? { dimension } : {}),
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
  "dimensionMode",
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
  const model = partial.model !== undefined ? partial.model : (cfg.model ?? current.model)
  const custom = typeof model === "string" && model !== def.model
  const dimension = size(cfg, partial, current, custom, model)
  const dimensionMode = savedMode(cfg, partial, current, dimension)
  const providerOptions =
    current[providerKey] || partial[providerKey]
      ? { [providerKey]: { ...(current[providerKey] ?? {}), ...(partial[providerKey] ?? {}) } }
      : {}

  return {
    provider: def.provider,
    model,
    dimensionMode,
    ...(dimension !== undefined ? { dimension } : {}),
    vectorStore: partial.vectorStore !== undefined ? partial.vectorStore : (cfg.vectorStore ?? current.vectorStore),
    ...partial,
    ...providerOptions,
  }
}
