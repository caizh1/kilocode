import type { Provider, ProviderModel, ModelSelection } from "../types/messages"
import {
  CHIPMATE_AUTO_FREE_NAME,
  CHIPMATE_AUTO_FREE_ID,
  CHIPMATE_PROVIDER_ID,
} from "../../../src/shared/provider-model"
import { isInternalModelHidden } from "../utils/internal-model-policy"

export type EnrichedModel = ProviderModel & { providerID: string; providerName: string }

/**
 * Flatten a provider map into a list of models enriched with provider info.
 */
export function flattenModels(providers: Record<string, Provider>, internal?: boolean): EnrichedModel[] {
  const result: EnrichedModel[] = []
  for (const providerID of Object.keys(providers)) {
    const provider = providers[providerID]!
    for (const modelID of Object.keys(provider.models)) {
      const model = provider.models[modelID]!
      if (
        isInternalModelHidden(
          { providerID, providerName: provider.name, modelID, modelName: model.name },
          internal,
        )
      )
        continue
      result.push({
        ...model,
        id: modelID,
        name:
          providerID === CHIPMATE_PROVIDER_ID && modelID === CHIPMATE_AUTO_FREE_ID
            ? CHIPMATE_AUTO_FREE_NAME
            : model.name,
        providerID,
        providerName: provider.name === "ChipMate Gateway" ? "ChipMate Gateway" : provider.name,
      })
    }
  }
  return result
}

/**
 * Find an enriched model from a flat model list by provider ID and model ID.
 */
export function findModel(models: EnrichedModel[], selection: ModelSelection | null): EnrichedModel | undefined {
  if (!selection) return undefined
  return models.find((m) => m.providerID === selection.providerID && m.id === selection.modelID)
}

/**
 * True when the selection points to an existing model in a connected provider.
 * ChipMate gateway models remain usable whenever the provider catalog exposes them.
 */
export function isModelValid(
  providers: Record<string, Provider>,
  connected: string[],
  selection: ModelSelection | null,
  internal?: boolean,
): boolean {
  if (!selection) return false
  if (isInternalModelHidden({ providerID: selection.providerID, modelID: selection.modelID }, internal)) return false
  const provider = providers[selection.providerID]
  if (!provider) return false
  if (selection.providerID !== "chipmate" && !connected.includes(selection.providerID)) return false
  const model = provider.models[selection.modelID]
  if (!model) return false
  return !isInternalModelHidden(
    {
      providerID: selection.providerID,
      providerName: provider.name,
      modelID: selection.modelID,
      modelName: model.name,
    },
    internal,
  )
}
