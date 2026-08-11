export const QWEN_FIM_MODEL_ID = "qwen-coder-30b0"

export function isQwenFimTarget(providerID: unknown, modelID: unknown): providerID is string {
  return typeof providerID === "string" && providerID.length > 0 && modelID === QWEN_FIM_MODEL_ID
}
