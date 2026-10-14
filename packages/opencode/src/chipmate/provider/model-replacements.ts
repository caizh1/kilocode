import {
  parseModelReplacements,
  replaceConfigModels,
  replaceModelID,
} from "@opencode-ai/core/chipmate/model-replacements"
import { isInternalOffline } from "../internal-offline"

export function packagedModelReplacements() {
  return isInternalOffline()
    ? parseModelReplacements(process.env.CHIPMATE_INTERNAL_PROVIDER_MODEL_REPLACEMENTS)
    : undefined
}

export function replacePackagedModelID(providerID: string, modelID: string) {
  return replaceModelID(providerID, modelID, packagedModelReplacements())
}

export function replacePackagedConfigModels<T>(config: T): T {
  return replaceConfigModels(config, packagedModelReplacements())
}
