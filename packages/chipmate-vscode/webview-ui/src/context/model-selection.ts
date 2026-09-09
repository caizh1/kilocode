import type { ModelSelection, Provider } from "../types/messages"
import { isModelValid } from "./provider-utils"
import { isInternalModelHidden } from "../utils/internal-model-policy"

function validate(
  providers: Record<string, Provider>,
  connected: string[],
  selection: ModelSelection | null | undefined,
  internal?: boolean,
): ModelSelection | null {
  if (!selection) return null
  if (isInternalModelHidden({ providerID: selection.providerID, modelID: selection.modelID }, internal)) return null
  if (Object.keys(providers).length === 0) return selection
  return isModelValid(providers, connected, selection, internal) ? selection : null
}

function recent(
  providers: Record<string, Provider>,
  connected: string[],
  selections: ModelSelection[] | undefined,
  internal?: boolean,
): ModelSelection | null {
  for (const item of selections ?? []) {
    const selection = validate(providers, connected, item, internal)
    if (selection) return selection
  }
  return null
}

export function resolveModelSelection(input: {
  providers: Record<string, Provider>
  connected: string[]
  override?: ModelSelection | null
  mode?: ModelSelection | null
  global?: ModelSelection | null
  recent?: ModelSelection[]
  fallback?: ModelSelection | null
  internal?: boolean
}): ModelSelection | null {
  const fallback = isInternalModelHidden(
    { providerID: input.fallback?.providerID, modelID: input.fallback?.modelID },
    input.internal,
  )
    ? null
    : input.fallback
  return (
    validate(input.providers, input.connected, input.override, input.internal) ??
    validate(input.providers, input.connected, input.mode, input.internal) ??
    validate(input.providers, input.connected, input.global, input.internal) ??
    recent(input.providers, input.connected, input.recent, input.internal) ??
    fallback ??
    null
  )
}
