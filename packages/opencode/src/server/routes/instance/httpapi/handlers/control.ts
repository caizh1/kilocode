import { Auth } from "@/auth"
import { MemoryDebug } from "@/kilocode/memory-debug" // kilocode_change
import * as ProviderSave from "@/kilocode/server/provider-save-lifecycle" // kilocode_change
import {
  invalidateAfterProviderAuthChange,
  invalidatePresence,
} from "@/kilocode/server/provider-auth-lifecycle" // kilocode_change
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http" // kilocode_change
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@opencode-ai/core/provider"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    // kilocode_change start - provider auth updates and memory diagnostics share the Kilo instance lifecycle
    const auth = yield* Auth.Service

    const authGet = Effect.fn("ControlHttpApi.authGet")(function* (ctx: { params: { providerID: ProviderV2.ID } }) {
      return (yield* auth.get(ctx.params.providerID).pipe(Effect.orDie)) ?? null
    })

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: Auth.Info
    }) {
      // Do not log credentials, only provider hash + request operation.
      const request = yield* HttpServerRequest.HttpServerRequest
      const operation = MemoryDebug.operation(request.headers)
      const defer = ProviderSave.deferred(request.headers) // kilocode_change
      const began = Date.now()
      yield* Effect.promise(() =>
        MemoryDebug.event({
          name: "provider.auth.set.begin",
          operationId: operation,
          data: { provider: MemoryDebug.hash(ctx.params.providerID) },
        }),
      )
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      yield* invalidateAfterProviderAuthChange(ctx.params.providerID, { dispose: !defer })
      if (defer)
        yield* Effect.promise(() =>
          MemoryDebug.event({
            name: "provider.auth.dispose.deferred",
            operationId: operation,
            data: { provider: MemoryDebug.hash(ctx.params.providerID) },
          }),
        )
      yield* Effect.promise(() =>
        MemoryDebug.event({
          name: "provider.auth.set.end",
          operationId: operation,
          data: { provider: MemoryDebug.hash(ctx.params.providerID), durationMs: Date.now() - began },
        }),
      )
      // kilocode_change start - drop old presence socket before instance disposal on Kilo auth changes
      if (ctx.params.providerID === "kilo") yield* invalidatePresence()
      // kilocode_change end
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const operation = MemoryDebug.operation(request.headers)
      const defer = ProviderSave.deferred(request.headers) // kilocode_change
      const began = Date.now()
      yield* Effect.promise(() =>
        MemoryDebug.event({
          name: "provider.auth.remove.begin",
          operationId: operation,
          data: { provider: MemoryDebug.hash(ctx.params.providerID) },
        }),
      )
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      yield* invalidateAfterProviderAuthChange(ctx.params.providerID, { dispose: !defer })
      if (defer)
        yield* Effect.promise(() =>
          MemoryDebug.event({
            name: "provider.auth.dispose.deferred",
            operationId: operation,
            data: { provider: MemoryDebug.hash(ctx.params.providerID) },
          }),
        )
      yield* Effect.promise(() =>
        MemoryDebug.event({
          name: "provider.auth.remove.end",
          operationId: operation,
          data: { provider: MemoryDebug.hash(ctx.params.providerID), durationMs: Date.now() - began },
        }),
      )
      // kilocode_change start - drop old presence socket before instance disposal on Kilo auth changes
      if (ctx.params.providerID === "kilo") yield* invalidatePresence()
      // kilocode_change end
      return true
    })
    // kilocode_change end

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const logger = Log.create({ service: ctx.payload.service })
      logger[ctx.payload.level](ctx.payload.message, ctx.payload.extra)
      return true
    })

    // kilocode_change start - register Kilo auth inspection beside upstream auth writes
    return handlers
      .handle("authGet", authGet)
      .handle("authSet", authSet)
      .handle("authRemove", authRemove)
      .handle("log", log)
    // kilocode_change end
  }),
)
