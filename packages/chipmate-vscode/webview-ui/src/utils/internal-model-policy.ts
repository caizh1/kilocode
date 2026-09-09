import { isInternalOfflineBuild } from "../../../src/shared/internal-offline"

export interface InternalModelIdentity {
  providerID?: string
  providerName?: string
  modelID?: string
  modelName?: string
}

const GLM_52 = /(?:^|[^a-z0-9])glm[-_. ]?5(?:[._ -]2|p2)(?=$|[^a-z0-9])/i

export function isInternalModelHidden(
  identity: InternalModelIdentity,
  internal = isInternalOfflineBuild(),
): boolean {
  if (!internal) return false
  const values = [identity.providerID, identity.providerName, identity.modelID, identity.modelName].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  return values.some((value) => GLM_52.test(value) || /doubao/i.test(value) || value.includes("豆包"))
}

export function partitionInternalModels<T>(
  input: {
    providerID?: string
    providerName?: string
    models: Record<string, T>
    modelName: (model: T, modelID: string) => string | undefined
  },
  internal = isInternalOfflineBuild(),
): { visible: Record<string, T>; hidden: Record<string, T> } {
  const visible: Record<string, T> = {}
  const hidden: Record<string, T> = {}
  for (const [modelID, model] of Object.entries(input.models)) {
    const target = isInternalModelHidden(
      {
        providerID: input.providerID,
        providerName: input.providerName,
        modelID,
        modelName: input.modelName(model, modelID),
      },
      internal,
    )
      ? hidden
      : visible
    target[modelID] = model
  }
  return { visible, hidden }
}

export function restoreInternalHiddenModels<T>(visible: Record<string, T>, hidden: Record<string, T>) {
  return { ...visible, ...hidden }
}
