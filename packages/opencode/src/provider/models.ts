// chipmate_change - new file
import { Config } from "@/config/config"
import { Auth } from "@/auth"
import { ModelCache } from "./model-cache"
import * as Core from "@opencode-ai/core/models-dev"
import { Context, Effect, Layer } from "effect"
import { AI_SDK_PROVIDERS, CHIPMATE_OPENROUTER_BASE, PROMPTS } from "@chipmate/chipmate-gateway"
import { overlay } from "@/chipmate/anaconda-desktop/provider"
import { isInternalOffline } from "@/chipmate/internal-offline"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // chipmate_change

export const Model = Core.Model
export type Model = Core.Model
export const Provider = Core.Provider
export type Provider = Core.Provider
export const CatalogModelStatus = Core.CatalogModelStatus
export type CatalogModelStatus = Core.CatalogModelStatus

export interface Interface extends Core.Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

function baseURL(url: string | undefined, org: string | undefined) {
  if (!url) return
  const base = url.replace(/\/+$/, "")
  if (org) {
    if (base.includes("/api/organizations/")) return base
    if (base.endsWith("/api")) return `${base}/organizations/${org}`
    return `${base}/api/organizations/${org}`
  }
  if (base.includes("/openrouter")) return base
  if (base.endsWith("/api")) return `${base}/openrouter`
  return `${base}/api/openrouter`
}

export const layer: Layer.Layer<Service, never, Core.Service | Config.Service | Auth.Service | ModelCache.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const core = yield* Core.Service
      const config = yield* Config.Service
      const auth = yield* Auth.Service
      const cache = yield* ModelCache.Service

      const get = Effect.fn("ModelsDev.get")(function* () {
        const source = yield* core.get()
        const providers = overlay(source)
        delete providers.chipmate

        const cfg = yield* config.get()
        const disabled = new Set(cfg.disabled_providers ?? [])
        const enabled = cfg.enabled_providers ? new Set(cfg.enabled_providers) : undefined
        if (isInternalOffline()) {
          const custom = new Set(
            Object.entries(cfg.provider ?? {})
              .filter(
                ([id, item]) =>
                  item?.npm === "@ai-sdk/openai-compatible" &&
                  id !== "chipmate" &&
                  id !== "apertis" &&
                  (!enabled || enabled.has(id)),
              )
              .map(([id]) => id),
          )
          for (const id of disabled) custom.delete(id)
          return Object.fromEntries(Object.entries(providers).filter(([id]) => custom.has(id)))
        }

        const allowed = (!enabled || enabled.has("chipmate")) && !disabled.has("chipmate")
        const apt = cfg.provider?.apertis?.options
        const aptURL = apt?.baseURL ?? "https://api.apertis.ai/v1"
        const aptOpts = apt?.baseURL ? { baseURL: apt.baseURL } : {}

        const addApertis = Effect.fnUntraced(function* () {
          if (providers.apertis) return
          const models = yield* cache.fetch("apertis", aptOpts).pipe(Effect.catch(() => Effect.succeed({})))
          providers.apertis = {
            id: "apertis",
            name: "Apertis",
            env: ["APERTIS_API_KEY"],
            api: aptURL,
            npm: "@ai-sdk/openai-compatible",
            models,
          }
          if (Object.keys(models).length === 0)
            yield* cache.refresh("apertis", aptOpts).pipe(Effect.ignore, Effect.forkDetach)
        })

        if (!allowed) {
          yield* addApertis()
          return providers
        }

        const opts = cfg.provider?.chipmate?.options
        const info = yield* auth.get("chipmate").pipe(Effect.catch(() => Effect.succeed(undefined)))
        const org = opts?.chipmateOrganizationId ?? (info?.type === "oauth" ? info.accountId : undefined)
        const url = baseURL(opts?.baseURL, org)
        const fetch = {
          ...(url ? { baseURL: url } : {}),
          ...(org ? { chipmateOrganizationId: org } : {}),
        }
        const models = yield* cache.fetch("chipmate", fetch).pipe(Effect.catch(() => Effect.succeed({})))
        providers.chipmate = {
          id: "chipmate",
          name: "ChipMate Gateway",
          env: ["CHIPMATE_API_KEY"],
          api: CHIPMATE_OPENROUTER_BASE.endsWith("/") ? CHIPMATE_OPENROUTER_BASE : `${CHIPMATE_OPENROUTER_BASE}/`,
          npm: "@chipmate/chipmate-gateway",
          models,
        }
        if (Object.keys(models).length === 0) yield* cache.refresh("chipmate", fetch).pipe(Effect.ignore, Effect.forkDetach)
        yield* addApertis()
        return providers
      })

      return Service.of({ get, refresh: core.refresh })
    }),
  )

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() => AppNodeBuilder.build(node)) // chipmate_change - build from the LayerNode graph

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Core.node, Config.node, Auth.node, ModelCache.node],
})

export { AI_SDK_PROVIDERS, PROMPTS }
export * as ModelsDev from "./models"
