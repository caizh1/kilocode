import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstanceRuntime } from "../../project/instance-runtime" // kilocode_change
import { MemoryDebug } from "@/kilocode/memory-debug" // kilocode_change
import { startParentWatchdog } from "../../kilocode/parent-watchdog" // kilocode_change

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless kilo server",
  // Server loads instances per-request via x-kilo-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false, // kilocode_change
  handler: Effect.fn("Cli.serve")(function* (args) {
    // kilocode_change start - capture CLI memory before a Bun process can crash
    MemoryDebug.start()
    // kilocode_change end
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.KILO_SERVER_PASSWORD) {
      console.log("Warning: KILO_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    // kilocode_change - the listening boundary anchors each diagnostic run
    void MemoryDebug.event({ name: "cli.listening", data: { port: server.port, hostname: server.hostname } })

    // kilocode_change start
    const urls = server.urls

    console.log(`kilo server listening on ${urls.bind}`)
    if (urls.local !== urls.bind) console.log(`  Local:   ${urls.local}`)
    if (urls.network) console.log(`  Network: ${urls.network}`)
    // kilocode_change end

    // kilocode_change start - graceful signal shutdown
    // yield* Effect.never
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          // Exit if the editor client that spawned us is hard-killed (no signal reaches us).
          const stopWatchdog = startParentWatchdog(() => process.kill(process.pid, "SIGTERM"))
          const shutdown = async () => {
            stopWatchdog()
            try {
              await InstanceRuntime.disposeAllInstances()
              await server.stop(true)
            } finally {
              void MemoryDebug.stop("signal")
              resolve()
            }
          }
          process.once("SIGTERM", shutdown)
          process.once("SIGINT", shutdown)
          process.once("SIGHUP", shutdown)
        }),
    )
    // kilocode_change end
  }),
})
