import { Auth } from "@/auth"
import { MemoryDebug } from "@/chipmate/memory-debug" // chipmate_change
import * as ProviderSave from "@/chipmate/server/provider-save-lifecycle" // chipmate_change
import {
  invalidateAfterProviderAuthChange,
  invalidatePresence,
} from "@/chipmate/server/provider-auth-lifecycle"
// chipmate_change end
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http" // chipmate_change
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { remove as removeAuth } from "@/chipmate/auth/remove" // chipmate_change

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    // chipmate_change start - provider auth updates and memory diagnostics share the ChipMate instance lifecycle
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
      const defer = ProviderSave.deferred(request.headers) // chipmate_change
      const began = Date.now()
      yield* Effect.promise(() =>
        MemoryDebug.event({
          name: "provider.auth.set.begin",
          operationId: operation,
          data: { provider: MemoryDebug.hash(ctx.params.providerID) },
        }),
      )
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      if (ctx.params.providerID === "chipmate") yield* invalidatePresence()
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
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const operation = MemoryDebug.operation(request.headers)
      const defer = ProviderSave.deferred(request.headers) // chipmate_change
      const began = Date.now()
      yield* Effect.promise(() =>
        MemoryDebug.event({
          name: "provider.auth.remove.begin",
          operationId: operation,
          data: { provider: MemoryDebug.hash(ctx.params.providerID) },
        }),
      )
      yield* removeAuth(ctx.params.providerID)
      if (ctx.params.providerID === "chipmate") yield* invalidatePresence()
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
      return true
    })
    // chipmate_change end

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      yield* write(ctx.payload.message).pipe(Effect.annotateLogs(ctx.payload.extra ?? {}))
      return true
    })

    // chipmate_change start - register ChipMate auth inspection beside upstream auth writes
    return handlers
      .handle("authGet", authGet)
      .handle("authSet", authSet)
      .handle("authRemove", authRemove)
      .handle("log", log)
    // chipmate_change end
  }),
)
