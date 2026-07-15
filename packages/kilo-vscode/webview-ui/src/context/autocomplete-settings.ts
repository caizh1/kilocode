import type { WebviewMessage } from "../types/messages"

export function buildAutocompleteSettingMessages(
  pending: Record<string, unknown>,
  current: Record<string, unknown>,
  requestId: string,
): WebviewMessage[] {
  const providerKey = "autocomplete.provider"
  const modelKey = "autocomplete.model"
  const selectionDirty = providerKey in pending || modelKey in pending
  const messages: WebviewMessage[] = []
  if (selectionDirty) {
    const provider = providerKey in pending ? pending[providerKey] : current[providerKey]
    const model = modelKey in pending ? pending[modelKey] : current[modelKey]
    messages.push({
      type: "updateAutocompleteSelection",
      providerID: typeof provider === "string" ? provider : null,
      modelID: typeof model === "string" ? model : null,
      automatic: (provider === null || provider === undefined) && (model === null || model === undefined),
      requestId,
    })
  }
  for (const [key, value] of Object.entries(pending)) {
    if (selectionDirty && (key === providerKey || key === modelKey)) continue
    messages.push({ type: "updateSetting", key, value, requestId })
  }
  return messages
}
