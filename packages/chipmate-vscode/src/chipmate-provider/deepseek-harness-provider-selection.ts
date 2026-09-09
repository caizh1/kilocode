import type { DeepSeekHarnessCredential } from "./deepseek-harness-config"
import { DeepSeekHarnessCredentialError } from "./deepseek-harness-config"
import {
  isDeepSeekModel,
  type DeepSeekHarnessModel,
  type DeepSeekHarnessProviderOption,
} from "../shared/deepseek-harness"

export type DeepSeekHarnessProviderCatalog = Record<
  string,
  {
    id: string
    name: string
    options?: Record<string, unknown>
    models: Record<string, { id: string; name: string }>
  }
>

export type ResolvedDeepSeekHarnessProvider = {
  credential: DeepSeekHarnessCredential
  models: DeepSeekHarnessModel[]
}

export async function inspectDeepSeekHarnessProviders(
  providers: DeepSeekHarnessProviderCatalog,
  resolveCredential: (
    providerID: string,
    provider: DeepSeekHarnessProviderCatalog[string],
  ) => Promise<DeepSeekHarnessCredential>,
): Promise<{
  options: DeepSeekHarnessProviderOption[]
  resolved: Map<string, ResolvedDeepSeekHarnessProvider>
}> {
  const entries = Object.values(providers)
    .map((provider) => ({
      provider,
      models: Object.values(provider.models)
        .filter((model) => isDeepSeekModel(provider.id, provider.name, model.id, model.name))
        .map((model) => ({ providerID: provider.id, modelID: model.id, name: model.name }))
        .sort(compareModels),
    }))
    .filter((entry) => entry.models.length > 0)
    .sort((a, b) => compareText(a.provider.name, b.provider.name) || compareText(a.provider.id, b.provider.id))

  const resolved = new Map<string, ResolvedDeepSeekHarnessProvider>()
  const options = await Promise.all(
    entries.map(async ({ provider, models }): Promise<DeepSeekHarnessProviderOption> => {
      try {
        const credential = await resolveCredential(provider.id, provider)
        resolved.set(provider.id, { credential, models })
        return { providerID: provider.id, providerName: provider.name, available: true, models }
      } catch (error) {
        return {
          providerID: provider.id,
          providerName: provider.name,
          available: false,
          reason: error instanceof DeepSeekHarnessCredentialError ? error.reason : "auth-read-failed",
          models,
        }
      }
    }),
  )
  return { options, resolved }
}

export function chooseDeepSeekHarnessSelection(
  options: readonly DeepSeekHarnessProviderOption[],
  recent?: Pick<DeepSeekHarnessModel, "providerID" | "modelID">,
  preferred?: Pick<DeepSeekHarnessModel, "providerID" | "modelID">,
): DeepSeekHarnessModel | undefined {
  const available = options.filter((option) => option.available).flatMap((option) => option.models)
  return findSelection(available, recent) ?? findSelection(available, preferred) ?? available[0]
}

function findSelection(
  models: readonly DeepSeekHarnessModel[],
  selection?: Pick<DeepSeekHarnessModel, "providerID" | "modelID">,
): DeepSeekHarnessModel | undefined {
  if (!selection) return
  return models.find(
    (model) => model.providerID === selection.providerID && model.modelID === selection.modelID,
  )
}

function compareModels(a: DeepSeekHarnessModel, b: DeepSeekHarnessModel): number {
  return compareText(a.name, b.name) || compareText(a.modelID, b.modelID)
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" })
}
