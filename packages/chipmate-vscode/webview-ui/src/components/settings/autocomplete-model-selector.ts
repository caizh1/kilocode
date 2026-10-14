import { AUTOCOMPLETE_MODELS } from "../../../../src/shared/autocomplete-models"
import { QWEN_FIM_MODEL_ID } from "../../../../src/shared/qwen-autocomplete"
import type { EnrichedModel } from "../../context/provider"

/**
 * Resolve the (provider, model) pair to the dropdown's value. Returns
 * `null` when neither is set so the selector renders the "Not set" (clear)
 * state via `allowClear`. The runtime resolves unset values to
 * `DEFAULT_AUTOCOMPLETE_MODEL` separately.
 */
export function getAutocompleteSelection(provider?: string, modelID?: string) {
  if (!provider && !modelID) return null
  return { providerID: provider ?? "", modelID: modelID ?? "" }
}

export const AUTOCOMPLETE_SELECTOR_MODELS: EnrichedModel[] = AUTOCOMPLETE_MODELS.map((m) => ({
  id: m.modelID,
  name: m.label,
  providerID: m.providerID,
  providerName: m.provider === "ChipMate Gateway" ? "ChipMate Gateway" : m.provider,
}))

export function qwenAutocompleteModels(models: EnrichedModel[], connected: readonly string[]): EnrichedModel[] {
  return models.filter((model) => connected.includes(model.providerID) && model.api?.npm === "@ai-sdk/openai-compatible")
}

export function autocompleteAutomaticLabel(automatic: boolean, modelID?: string): string {
  if (!automatic) return "Automatic — Prefer Qwen"
  if (modelID === QWEN_FIM_MODEL_ID) return "Automatic — Prefer Qwen → Qwen Coder FIM"
  if (AUTOCOMPLETE_MODELS.some((model) => model.modelID === modelID && model.label === "Codestral")) return "Automatic — Prefer Qwen → Codestral"
  return "Automatic — Prefer Qwen"
}

export function autocompleteSelectionLabel(automatic: boolean, modelID?: string, providerID?: string): string {
  const builtin = AUTOCOMPLETE_MODELS.find((model) => model.providerID === providerID && model.modelID === modelID)
  if (automatic && modelID === QWEN_FIM_MODEL_ID) return "Automatic → Qwen Coder FIM"
  if (automatic && builtin) return `Automatic → ${builtin.label}`
  if (automatic) return "Automatic → Unavailable"
  if (builtin) return `Explicit → ${builtin.label}`
  if (modelID) return "Explicit → Qwen FIM"
  return "Explicit"
}
