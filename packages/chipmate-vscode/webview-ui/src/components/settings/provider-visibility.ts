import type { ProviderAuthState } from "../../types/messages"
import type { Provider } from "../../types/messages"
import { CHIPMATE_PROVIDER_ID, createChipMateFallbackProvider } from "../../../../src/shared/provider-model"
import { isInternalOfflineBuild } from "../../../../src/shared/internal-offline"

export function visibleConnectedIds(
  connected: string[],
  authStates: Record<string, ProviderAuthState>,
  internal = isInternalOfflineBuild(),
) {
  if (internal) return connected
  return connected.filter((id) => id !== CHIPMATE_PROVIDER_ID || authStates[CHIPMATE_PROVIDER_ID] !== undefined)
}

export function disabledProviderOptions(
  providers: Record<string, Provider>,
  disabled: string[],
  internal = isInternalOfflineBuild(),
) {
  const current = new Set(disabled)
  return Object.values(providers)
    .filter((item) => !internal || item.id !== CHIPMATE_PROVIDER_ID)
    .filter((item) => !current.has(item.id))
    .map((item) => ({ value: item.id, label: item.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function providersWithChipMateFallback(
  providers: Record<string, Provider>,
  internal = isInternalOfflineBuild(),
): Record<string, Provider> {
  if (internal) return providers
  if (providers[CHIPMATE_PROVIDER_ID]) return providers
  return { [CHIPMATE_PROVIDER_ID]: createChipMateFallbackProvider(), ...providers }
}
