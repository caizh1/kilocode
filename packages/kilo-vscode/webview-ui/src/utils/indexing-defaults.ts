import type { IndexingConfig } from "../types/messages"
import { INTERNAL_OFFLINE_INDEXING_DEFAULTS, isInternalOfflineBuild } from "../../../src/shared/internal-offline"

export function applyInternalIndexingDefaults(
  cfg: IndexingConfig = {},
  enabled = isInternalOfflineBuild(),
): IndexingConfig {
  if (!enabled) return cfg

  const def = INTERNAL_OFFLINE_INDEXING_DEFAULTS
  const provider = cfg.provider ?? def.provider
  if (provider !== def.provider) return { ...cfg, provider }

  return {
    ...cfg,
    provider,
    model: cfg.model ?? def.model,
    dimension: cfg.dimension ?? def.dimension,
    vectorStore: cfg.vectorStore ?? def.vectorStore,
  }
}
