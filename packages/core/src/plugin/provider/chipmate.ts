import { createChipMate, CHIPMATE_OPENROUTER_BASE } from "@chipmate/chipmate-gateway" // chipmate_change
import { Effect } from "effect"
import { ProviderV2 } from "../../provider" // chipmate_change
import { define } from "../internal"

const id = ProviderV2.ID.chipmate // chipmate_change

export const ChipMatePlugin = define({
  id: "chipmate",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.id !== id) continue // chipmate_change
          evt.provider.update(item.provider.id, (provider) => {
            // chipmate_change start
            const options = provider.request.body
            const token = options.chipmateToken ?? options.apiKey ?? process.env.CHIPMATE_API_KEY
            const org = process.env.CHIPMATE_ORG_ID ?? options.chipmateOrganizationId

            provider.api = {
              type: "aisdk",
              package: "@chipmate/chipmate-gateway",
              url: CHIPMATE_OPENROUTER_BASE,
            }
            // chipmate_change end
            provider.request.headers["HTTP-Referer"] = "https://chipmate.ai/"
            // chipmate_change start
            provider.request.headers["X-Title"] = "ChipMate"
            options.apiKey = token ?? "anonymous"
            options.chipmateToken = options.apiKey
            if (org) options.chipmateOrganizationId = org
            // chipmate_change end
          })
        }
      }),
    )
    // chipmate_change start
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== id) return
        evt.sdk = createChipMate(evt.options)
      }),
    )
    // chipmate_change end
  }),
})
