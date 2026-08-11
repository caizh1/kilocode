import { ScopedCache } from "effect"
import * as Refresh from "@opencode-ai/core/chipmate/models-refresh"
import type { InstanceState } from "@/effect/instance-state"

export const watch = <A, E, R>(state: InstanceState<A, E, R>) =>
  Refresh.watch(() => ScopedCache.invalidateAll(state.cache))
