import { Config } from "@/config/config"
// chipmate_change start - preserve ChipMate API default model overlay
import { fetchDefaultModel } from "@chipmate/chipmate-gateway"
import { Auth } from "@/auth"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { filterPromptTrainingModels, nonEmptyProviders } from "@/chipmate/provider/model-filter"
// chipmate_change end
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi" // chipmate_change
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"

// chipmate_change start - indexing settings hot-reload without disposing the active instance
function isIndexingOnlyConfig(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const keys = Object.keys(input as Record<string, unknown>)
  return keys.length === 1 && keys[0] === "indexing"
}
// chipmate_change end

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      // chipmate_change start - indexing settings are consumed by the indexing hot-reload path
      if (!isIndexingOnlyConfig(ctx.payload)) {
        yield* markInstanceForDisposal(yield* InstanceState.context)
      }
      // chipmate_change end
      return ctx.payload
    })

    // chipmate_change start
    const warnings = Effect.fn("ConfigHttpApi.warnings")(function* () {
      return yield* configSvc.warnings()
    })
    // chipmate_change end

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      // chipmate_change start
      const config = yield* configSvc.get()
      const providers = filterPromptTrainingModels(
        yield* providerSvc.list(),
        config.hide_prompt_training_models === true,
      )
      const defaults = Provider.defaultModelIDs(nonEmptyProviders(providers))
      // chipmate_change end

      // chipmate_change start - Fetch default model from ChipMate API when the chipmate provider is available.
      if (providers[ProviderV2.ID.chipmate]) {
        const auth = yield* Auth.Service
        const info = yield* auth.get("chipmate").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({}))) // chipmate_change
        const token = info?.type === "oauth" ? info.access : info?.key
        const organizationId = info?.type === "oauth" ? info.accountId : undefined
        const model = yield* Effect.promise(() => fetchDefaultModel(token, organizationId))
        if (model && providers[ProviderV2.ID.chipmate]?.models[model]) defaults[ProviderV2.ID.chipmate] = ModelV2.ID.make(model)
      }
      // chipmate_change end

      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: defaults,
      }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("warnings", warnings)
      .handle("providers", providers) // chipmate_change
  }),
)
