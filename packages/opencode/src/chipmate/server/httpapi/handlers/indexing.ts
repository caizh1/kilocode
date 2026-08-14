import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { EffectBridge } from "@/effect/bridge"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"

export const indexingHandlers = HttpApiBuilder.group(InstanceHttpApi, "indexing", (handlers) =>
  Effect.gen(function* () {
    const mod = yield* Effect.promise(() => import("@/chipmate/indexing"))
    const status = Effect.fn("IndexingHttpApi.status")(function* () {
      return yield* EffectBridge.fromPromise(() => mod.ChipMateIndexing.current())
    })
    const models = Effect.fn("IndexingHttpApi.models")(function* () {
      return yield* EffectBridge.fromPromise(() => mod.ChipMateIndexing.models())
    })
    const warnings = Effect.fn("IndexingHttpApi.warnings")(function* () {
      return yield* EffectBridge.fromPromise(() => mod.ChipMateIndexing.warnings())
    })

    const documentsRebuild = Effect.fn("IndexingHttpApi.documentsRebuild")(function* () {
      const mod = yield* Effect.promise(() => import("@/chipmate/indexing"))
      const current = yield* EffectBridge.fromPromise(() => mod.ChipMateIndexing.rebuildDocuments())
      return current
    })

    const documentDiagnostics = Effect.fn("IndexingHttpApi.documentDiagnostics")(function* (ctx: {
      params: { runId: string }
    }) {
      const report = yield* EffectBridge.fromPromise(() => mod.ChipMateIndexing.documentDiagnostics(ctx.params.runId))
      if (!report) return yield* new HttpApiError.NotFound({})
      return report
    })

    return handlers
      .handle("status", status)
      .handle("models", models)
      .handle("warnings", warnings)
      .handle("documentDiagnostics", documentDiagnostics)
      .handle("documentsRebuild", documentsRebuild)
  }),
)
