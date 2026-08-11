import { Config } from "@/config/config"
import { GlobalBus, type GlobalEvent as GlobalBusEvent } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Installation } from "@/installation"
import * as ProviderSave from "@/chipmate/server/provider-save-lifecycle" // chipmate_change
import { disconnect } from "@/chipmate/server/sse" // chipmate_change
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { MemoryDebug } from "@/chipmate/memory-debug" // chipmate_change
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { RootHttpApi } from "../api"
import { GlobalUpgradeInput } from "../groups/global"

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function parseBody(body: string) {
  try {
    return JSON.parse(body || "{}") as unknown
  } catch {
    return undefined
  }
} // chipmate_change

// chipmate_change start - indexing settings hot-reload without disposing all instances
function isIndexingOnlyConfig(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const keys = Object.keys(input as Record<string, unknown>)
  return keys.length === 1 && keys[0] === "indexing"
}
// chipmate_change end

// chipmate_change start
function eventResponse(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    // chipmate_change end
    yield* Effect.logInfo("global event connected")
    const events = Stream.callback<GlobalBusEvent>((queue) => {
      const handler = (event: GlobalBusEvent) => Queue.offerUnsafe(queue, event)
      return Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", handler)),
        () => Effect.sync(() => GlobalBus.off("event", handler)),
      )
    })
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ payload: { id: EventV2.ID.create(), type: "server.heartbeat", properties: {} } })),
    )

    return HttpServerResponse.stream(
      Stream.make({ payload: { id: EventV2.ID.create(), type: "server.connected", properties: {} } }).pipe(
        Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
        // chipmate_change start - prevent disconnected SSE clients from retaining full diff payloads
        // Explicit interruption closes the stream scope, unregisters its GlobalBus listener, and
        // releases the unbounded callback queue even when transport cancellation is not propagated.
        Stream.interruptWhen(disconnect(request)),
        // chipmate_change end
        Stream.ensuring(Effect.logInfo("global event disconnected")),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const installation = yield* Installation.Service
    const bridge = yield* EffectBridge.make()

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      return { healthy: true as const, version: InstallationVersion }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest // chipmate_change
      return yield* eventResponse(request) // chipmate_change
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    // chipmate_change start - ChipMate configuration saves own disposal and memory diagnostics
    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      // chipmate_change start - correlate provider/settings saves without persisting request metadata
      const request = yield* HttpServerRequest.HttpServerRequest
      const operation = MemoryDebug.operation(request.headers)
      const defer = ProviderSave.deferred(request.headers) // chipmate_change
      const keys = Object.keys(ctx.payload)
      const began = Date.now()
      yield* Effect.promise(() =>
        MemoryDebug.event({ name: "global.config.update.begin", operationId: operation, data: { keys } }),
      )
      // chipmate_change end
      // chipmate_change start - indexing settings are consumed by the indexing hot-reload path
      const hot = isIndexingOnlyConfig(ctx.payload)
      const result = yield* config.updateGlobal(ctx.payload, ProviderSave.options(hot, defer))
      // chipmate_change end
      // chipmate_change start
      if (result.changed && defer) {
        yield* Effect.promise(() =>
          MemoryDebug.event({
            name: "global.dispose.deferred",
            operationId: operation,
            data: { reason: "custom-provider-save" },
          }),
        )
      }
      if (result.changed && !hot && !defer) {
        yield* Effect.promise(() =>
          MemoryDebug.event({
            name: "global.dispose.begin",
            operationId: operation,
            data: { reason: "config-update" },
          }),
        )
        yield* bridge.run(
          disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }).pipe(Effect.catchCause(() => Effect.void)),
        )
        yield* Effect.promise(() =>
          MemoryDebug.event({
            name: "global.dispose.end",
            operationId: operation,
            data: { durationMs: Date.now() - began },
          }),
        )
      }
      // chipmate_change end
      // chipmate_change - result only records changed/hot flags, never config values
      yield* Effect.promise(() =>
        MemoryDebug.event({
          name: "global.config.update.end",
          operationId: operation,
          data: { changed: result.changed, hot, deferred: defer, durationMs: Date.now() - began },
        }),
      )
      return result.info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      // chipmate_change start - explicit post-auth/provider disposal
      const request = yield* HttpServerRequest.HttpServerRequest
      const operation = MemoryDebug.operation(request.headers)
      const began = Date.now()
      yield* Effect.promise(() =>
        MemoryDebug.event({ name: "global.dispose.begin", operationId: operation, data: { reason: "explicit" } }),
      )
      // chipmate_change end
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      // chipmate_change
      yield* Effect.promise(() =>
        MemoryDebug.event({
          name: "global.dispose.end",
          operationId: operation,
          data: { durationMs: Date.now() - began },
        }),
      )
      return true
    })
    // chipmate_change end

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return {
          status: 400,
          body: { success: false as const, error: "Unknown installation method" },
        }
      }
      const target = ctx.payload.target || (yield* installation.latest(method))
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ status: 200, body: { success: true as const, version: target } }),
        Effect.catch((err) =>
          Effect.succeed({
            status: 500,
            body: {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            },
          }),
        ),
      )
      if (!result.body.success) return result
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return result
    })

    const upgradeRaw = Effect.fn("GlobalHttpApi.upgradeRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const json = parseBody(body)
      if (json === undefined) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const payload = yield* Schema.decodeUnknownEffect(GlobalUpgradeInput)(json).pipe(
        Effect.map((payload) => ({ valid: true as const, payload })),
        Effect.catch(() => Effect.succeed({ valid: false as const })),
      )
      if (!payload.valid) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const result = yield* upgrade({ payload: payload.payload })
      return HttpServerResponse.jsonUnsafe(result.body, { status: result.status })
    })

    return handlers
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("dispose", dispose)
      .handleRaw("upgrade", upgradeRaw)
  }),
)
