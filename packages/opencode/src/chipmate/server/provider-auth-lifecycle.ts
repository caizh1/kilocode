import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
import { ChipMateViewers } from "@/chipmate/presence/service" // chipmate_change
import { Effect } from "effect"

export const disposeAllInstancesAfterProviderAuthCallback = Effect.fn(
  "ChipMateServer.disposeAllInstancesAfterProviderAuthCallback",
)(function* () {
  const store = yield* InstanceStore.Service
  yield* store.disposeAll()
})

// chipmate_change start - drop the old presence socket; callers invoke this for the "chipmate" provider only
export const invalidatePresence = Effect.fn("ChipMateServer.invalidatePresence")(function* () {
  const viewers = yield* ChipMateViewers.Service
  yield* viewers.invalidateAuth()
})
// chipmate_change end

export const invalidateAfterProviderAuthChange = Effect.fn("ChipMateServer.invalidateAfterProviderAuthChange")(function* (
  providerID: string,
  options?: { dispose?: boolean },
) {
  const cache = yield* ModelCache.Service
  yield* cache.clear(providerID)
  if (options?.dispose === false) return
  yield* disposeAllInstancesAfterProviderAuthCallback()
})
