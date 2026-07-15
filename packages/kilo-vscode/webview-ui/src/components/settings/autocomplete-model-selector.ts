import { AUTOCOMPLETE_MODELS, getAutocompleteModel } from "../../../../src/shared/autocomplete-models"
import { QWEN_FIM_MODEL_ID, isQwenFimTarget } from "../../../../src/shared/qwen-autocomplete"
import type { EnrichedModel } from "../../context/provider"

/**
 * Resolve the (provider, model) pair to the dropdown's value. Returns
 * `null` when neither is set so the selector renders the "Not set" (clear)
 * state via `allowClear`. The runtime resolves unset values to
 * `DEFAULT_AUTOCOMPLETE_MODEL` separately.
 */
export function getAutocompleteSelection(provider?: string, modelID?: string) {
  if (!provider && !modelID) return null
  if (isQwenFimTarget(provider, modelID) && typeof modelID === "string") return { providerID: provider, modelID }
  const model = getAutocompleteModel(provider, modelID)
  return { providerID: model.providerID, modelID: model.modelID }
}

export const AUTOCOMPLETE_SELECTOR_MODELS: EnrichedModel[] = AUTOCOMPLETE_MODELS.map((m) => ({
  id: m.modelID,
  name: m.label,
  providerID: m.providerID,
  providerName: m.provider === "Kilo Gateway" ? "ChipMate Gateway" : m.provider,
}))

export function qwenAutocompleteModels(models: EnrichedModel[]): EnrichedModel[] {
  return models.filter((model) => model.id === QWEN_FIM_MODEL_ID).map((model) => ({ ...model, name: "Qwen Coder FIM" }))
}

export function autocompleteAutomaticLabel(automatic: boolean, modelID?: string): string {
  if (!automatic) return "Automatic — Prefer Qwen"
  if (modelID === QWEN_FIM_MODEL_ID) return "Automatic — Prefer Qwen → Qwen Coder FIM"
  if (modelID?.includes("codestral")) return "Automatic — Prefer Qwen → Codestral"
  return "Automatic — Prefer Qwen"
}

export function autocompleteSelectionLabel(automatic: boolean, modelID?: string): string {
  if (automatic && modelID === QWEN_FIM_MODEL_ID) return "Automatic → Qwen Coder FIM"
  if (automatic && modelID?.includes("codestral")) return "Automatic → Codestral"
  if (automatic) return "Automatic → Unavailable"
  if (modelID === QWEN_FIM_MODEL_ID) return "Explicit → Qwen Coder FIM"
  if (modelID?.includes("codestral")) return "Explicit → Codestral"
  return "Explicit"
}
