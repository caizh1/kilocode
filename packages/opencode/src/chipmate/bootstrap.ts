import { Cause, Context, Effect, Layer } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { ChipMateSessions } from "@/chipmate-sessions/chipmate-sessions"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import path from "node:path"
import { Bus } from "@/bus"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { SessionExport } from "@/chipmate/session-export"
import { createWorkspaceProvider } from "@/chipmate/session-export/workspace-provider"
import { Instance } from "@/chipmate/instance"
import { Identity } from "@chipmate/chipmate-telemetry"
import { MemoryLifecycle } from "@/chipmate/memory/turn"
import { MemoryService } from "@chipmate/chipmate-memory/effect/service"
import { MemoryEvents } from "@/chipmate/memory/events"
import { installMemoryRuntime } from "@/chipmate/memory/runtime"
import { ChipMateToolRegistry } from "@/chipmate/tool/registry"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ChipMateWatcher } from "@/chipmate/watcher"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // chipmate_change

const log = Log.create({ service: "chipmate-bootstrap" })

export namespace ChipMateBootstrap {
  export interface Interface {
    readonly init: () => Effect.Effect<void, unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("@chipmate/Bootstrap") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      // Bind the package memory effect layer to opencode (paths, instance binder, logger, event sink).
      installMemoryRuntime()
      const chipmate = yield* ChipMateSessions.Service
      const bus = yield* Bus.Service
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const provider = yield* Provider.Service
      const memory = yield* MemoryService.Service
      const watcher = yield* ChipMateWatcher.Service

      const init = Effect.fn("ChipMateBootstrap.init")(function* () {
        yield* watcher.init()
        yield* chipmate.init()
        yield* MemoryLifecycle.subscribe({ bus, sessions, summary, provider, memory })
        // Invalidate enabled cache on every memory state mutation (properties.directory holds the memory root).
        yield* bus.subscribeCallback(MemoryEvents.Status, (evt) =>
          ChipMateToolRegistry.invalidateMemoryEnabled(evt.properties.directory),
        )
        yield* bus.subscribeCallback(MemoryEvents.Updated, (evt) =>
          ChipMateToolRegistry.invalidateMemoryEnabled(evt.properties.directory),
        )
        // Session export bootstrap.
        yield* Effect.gen(function* () {
          if (!SessionExport.enabled) return
          const anon = yield* EffectBridge.fromPromise(() =>
            Identity.getMachineId().catch((err) => {
              log.warn("session export identity failed", { err })
              return undefined
            }),
          )
          SessionExport.init({
            agentVersion: InstallationVersion,
            anonId: anon,
            dbPath: path.join(Global.Path.data, "session-export.db"),
            workspaceKey: Instance.directory,
            subscribeAll: (cb) => Bus.subscribeAll(cb),
            snapshotProvider: createWorkspaceProvider({
              root: Instance.directory,
              statePath: path.join(Global.Path.data, "session-export-workspace.json"),
            }),
          })
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => log.warn("session export bootstrap failed", { err: Cause.squash(cause) })),
          ),
        )
        if (process.env["CHIPMATE_PLATFORM"] !== "vscode") {
          yield* EffectBridge.fromPromise(() =>
            import("@/chipmate/indexing").then((mod) => mod.ChipMateIndexing.init()),
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => log.warn("indexing bootstrap failed", { err: Cause.squash(cause) })),
            ),
            Effect.forkDetach,
          )
        }
      })

      return Service.of({ init })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide([
      ChipMateSessions.defaultLayer,
      Session.defaultLayer,
      AppNodeBuilder.build(SessionSummary.node),
      AppNodeBuilder.build(Provider.node),
      MemoryService.layer,
      Bus.defaultLayer,
      ChipMateWatcher.defaultLayer,
    ]),
  )

  const memory = LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] })
  const watcher = LayerNode.make({ service: ChipMateWatcher.Service, layer: ChipMateWatcher.defaultLayer, deps: [] })
  export const node = LayerNode.suspend(() =>
    LayerNode.make({
      service: Service,
      layer,
      deps: [ChipMateSessions.node, Session.node, SessionSummary.node, Provider.node, memory, Bus.node, watcher],
    }),
  )
}
