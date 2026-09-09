declare const __CHIPMATE_INTERNAL_OFFLINE__: boolean
declare const __CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL__: string | undefined
declare const __CHIPMATE_INTERNAL_PROVIDER_API_BASE_URL__: string | undefined
declare const __CHIPMATE_INTERNAL_PROVIDER_CHAT_MODEL__: string | undefined

import { QWEN_FIM_MODEL_ID } from "./qwen-autocomplete"

export const INTERNAL_OFFLINE_CONTEXT = "chipmate.v2.internalOffline"

export const INTERNAL_OFFLINE_INDEXING_DEFAULTS = {
  provider: "openai-compatible",
  model: "qwen3-embedding-8b",
  dimensionMode: "auto",
  vectorStore: "lancedb",
} as const

export const INTERNAL_OFFLINE_PROVIDER = {
  providerID: "chipmate",
  name: "ChipMate",
  npm: "@ai-sdk/openai-compatible",
  autocompleteModelID: QWEN_FIM_MODEL_ID,
  variant: "low",
} as const

export type InternalOfflineProviderDefaults = typeof INTERNAL_OFFLINE_PROVIDER & {
  baseURL: string
  modelID: string
}

export function isInternalOfflineBuild(): boolean {
  return typeof __CHIPMATE_INTERNAL_OFFLINE__ !== "undefined" && __CHIPMATE_INTERNAL_OFFLINE__
}

export function internalOfflineEnv(
  enabled = isInternalOfflineBuild(),
  defaults = internalOfflineProviderDefaults(enabled),
): Record<string, string> {
  if (!enabled) return {}
  const config = internalOfflineConfigContent(defaults)
  return {
    CHIPMATE_INTERNAL_OFFLINE: "1",
    CHIPMATE_DISABLE_MODELS_FETCH: "1",
    ...(config ? { CHIPMATE_INTERNAL_PROVIDER_DEFAULTS: config } : {}),
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

export function internalOfflineProviderDefaults(
  enabled = isInternalOfflineBuild(),
  baseURL = typeof __CHIPMATE_INTERNAL_PROVIDER_API_BASE_URL__ === "undefined"
    ? undefined
    : __CHIPMATE_INTERNAL_PROVIDER_API_BASE_URL__,
  modelID = typeof __CHIPMATE_INTERNAL_PROVIDER_CHAT_MODEL__ === "undefined"
    ? undefined
    : __CHIPMATE_INTERNAL_PROVIDER_CHAT_MODEL__,
): InternalOfflineProviderDefaults | undefined {
  const url = baseURL?.trim()
  const model = modelID?.trim()
  if (!enabled || !url || !model) return
  return { ...INTERNAL_OFFLINE_PROVIDER, baseURL: url, modelID: model }
}

export function internalOfflineConfigContent(
  defaults: InternalOfflineProviderDefaults | undefined,
): string | undefined {
  if (!defaults) return undefined
  return JSON.stringify({
    provider: {
      [defaults.providerID]: {
        name: defaults.name,
        npm: defaults.npm,
        options: { baseURL: defaults.baseURL },
        models: {
          [defaults.modelID]: {
            name: defaults.modelID,
            reasoning: true,
          },
        },
      },
    },
  })
}

export function shouldUseQuickProviderMode(
  defaults: InternalOfflineProviderDefaults | undefined,
  providerID?: string,
): boolean {
  return !!defaults && (!providerID || providerID === defaults.providerID)
}
