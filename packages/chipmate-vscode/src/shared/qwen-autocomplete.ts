export const QWEN_FIM_MODEL_ID = "qwen-coder-30b0"

import { AUTOCOMPLETE_MODELS } from "./autocomplete-models"

export function isQwenFimTarget(providerID: unknown, modelID: unknown): providerID is string {
  return (
    typeof providerID === "string" &&
    providerID.length > 0 &&
    typeof modelID === "string" &&
    modelID.length > 0 &&
    !AUTOCOMPLETE_MODELS.some((model) => model.providerID === providerID && model.modelID === modelID)
  )
}
