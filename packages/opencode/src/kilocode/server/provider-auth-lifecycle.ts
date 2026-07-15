import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
import { Effect } from "effect"

export const disposeAllInstancesAfterProviderAuthCallback = Effect.fn(
  "KiloServer.disposeAllInstancesAfterProviderAuthCallback",
)(function* () {
  const store = yield* InstanceStore.Service
  yield* store.disposeAll()
})

export const invalidateAfterProviderAuthChange = Effect.fn("KiloServer.invalidateAfterProviderAuthChange")(function* (
  providerID: string,
  options?: { dispose?: boolean },
) {
  const cache = yield* ModelCache.Service
  yield* cache.clear(providerID)
  if (options?.dispose === false) return
  yield* disposeAllInstancesAfterProviderAuthCallback()
})
