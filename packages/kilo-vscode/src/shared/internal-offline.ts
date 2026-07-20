declare const __CHIPMATE_INTERNAL_OFFLINE__: boolean
declare const __CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL__: string | undefined

export const INTERNAL_OFFLINE_CONTEXT = "chipmate.v2.internalOffline"

export const INTERNAL_OFFLINE_INDEXING_DEFAULTS = {
  provider: "openai-compatible",
  model: "qwen3-embedding-8b",
  dimension: 2048,
  vectorStore: "lancedb",
} as const

export function isInternalOfflineBuild(): boolean {
  return typeof __CHIPMATE_INTERNAL_OFFLINE__ !== "undefined" && __CHIPMATE_INTERNAL_OFFLINE__
}

export function internalOfflineEnv(enabled = isInternalOfflineBuild()): Record<string, string> {
  if (!enabled) return {}
  return {
    CHIPMATE_INTERNAL_OFFLINE: "1",
    KILO_INTERNAL_OFFLINE: "1",
    KILO_DISABLE_MODELS_FETCH: "1",
  }
}

export function internalOfflineIndexingOpenAICompatibleBaseUrl(): string | undefined {
  if (typeof __CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL__ === "undefined") return undefined
  const value = __CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL__.trim()
  return value || undefined
}

export function internalOfflineIndexingDefaults() {
  const baseUrl = internalOfflineIndexingOpenAICompatibleBaseUrl()
  return {
    ...INTERNAL_OFFLINE_INDEXING_DEFAULTS,
    ...(baseUrl ? { "openai-compatible": { baseUrl } } : {}),
  }
}
