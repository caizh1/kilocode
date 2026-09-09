import type { Argv } from "yargs"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { InstallationBuildKind, InstallationVersion } from "@opencode-ai/core/installation/version"
import { Telemetry } from "@chipmate/chipmate-telemetry"
import { migrateLegacyChipMateAuth, ENV_FEATURE, ENV_VERSION } from "@chipmate/chipmate-gateway"
import { AppRuntime } from "@/effect/app-runtime"
import { Config } from "@/config/config"
import { Auth } from "@/auth"
import { InstanceRuntime } from "@/project/instance-runtime"
import { SessionExport } from "@/chipmate/session-export"
import { ChipMateShutdown } from "@/chipmate/cli/shutdown"
import { createHelpCommand } from "@/chipmate/help-command"
import { ChipMateConsoleCommand } from "@/chipmate/cli/cmd/console"
import { CloudCommand } from "@/chipmate/cli/cmd/cloud"
import { RollCallCommand } from "@/chipmate/cli/cmd/roll-call"
import { ProfileCommand } from "@/chipmate/cli/cmd/profile"
import { DaemonCommand } from "@/chipmate/cli/cmd/daemon"
import { DevSetupCommand, DevAliasCommand } from "@/chipmate/cli/dev-setup"
import { RemoteCommand } from "@/cli/cmd/remote"
import { ConfigCommand as ConfigCLICommand } from "@/cli/cmd/config"
import { ProductProfile } from "@/chipmate/product-profile"
import { ChipMateLog } from "@/chipmate/log"
import { ChipMateSessions } from "@/chipmate-sessions/chipmate-sessions"
import { LegacyProductStateMigration } from "@/chipmate/migration/legacy-product-state"
import { HistoryCommand } from "@/chipmate/cli/cmd/history"

const log = Log.create({ service: "chipmate.cli" })
let skipShutdown = false

ChipMateShutdown.register(() => ChipMateSessions.drainIngestForShutdown())

// All ChipMate-specific CLI customization lives here so the shared upstream entrypoint
// (src/index.ts) only needs a handful of thin call-sites behind chipmate_change markers.
// This keeps index.ts close to upstream and reduces merge conflicts on every sync.
export namespace ChipMateCli {
  // Register only the ChipMate-specific commands. Upstream commands stay in index.ts's chain so
  // upstream merges that add or remove commands keep working without touching this file.
  export function register<T>(cli: Argv<T>): Argv<T> {
    cli
      .command(ChipMateConsoleCommand)
      .command(CloudCommand)
      .command(RollCallCommand)
      .command(ProfileCommand)
      .command(RemoteCommand)
      .command(DaemonCommand)
      .command(HistoryCommand)
      .command(ConfigCLICommand)
    if (InstallationBuildKind !== "release") cli.command(DevSetupCommand).command(DevAliasCommand)
    // Safe self-reference: `cli` is a typed parameter and yargs `.command()` returns the same
    // instance, so the help command can resolve the fully-built root at handler time. This also
    // sidesteps the self-referential type error the old inline registration hit in index.ts.
    cli.command(createHelpCommand(() => cli))
    return cli
  }

  export async function runner() {
    if (!process.argv.includes("__background-process-runner")) return false
    return (await import("@/chipmate/background-process/runner")).BackgroundProcessRunner.maybe()
  }

  // Runs from the upstream `.middleware`, before any command handler. Env tagging is additive so
  // it never has to modify upstream's own env assignments.
  export async function bootstrap(opts?: Record<string, unknown>): Promise<void> {
    if (opts?.help || opts?.version) {
      skipShutdown = true
      return
    }
    await ChipMateLog.init()
    if (!process.env[ENV_FEATURE]) process.env[ENV_FEATURE] = process.argv.includes("serve") ? "unknown" : "cli"
    if (!process.env[ENV_VERSION]) process.env[ENV_VERSION] = InstallationVersion
    process.env.CHIPMATE = "1"

    // History maintenance must snapshot the database before any normal bootstrap
    // service opens or mutates it. The command owns its complete lifecycle.
    const command = Array.isArray(opts?._) ? opts._[0] : undefined
    if (command === "history") {
      skipShutdown = true
      return
    }

    // Must run before AppRuntime initializes the SQLite database, or the marker
    // exists before legacy JSON can be imported.
    await LegacyProductStateMigration.bootstrap()

    const cfg = await AppRuntime.runPromise(Config.Service.use((c) => c.getGlobal()))
    await Telemetry.init({
      dataPath: Global.Path.data,
      version: InstallationVersion,
      enabled: cfg.experimental?.openTelemetry !== false,
    })

    // ChipMate v2 must never inspect or import the native ChipMate credential store.
    if (ProductProfile.allowsLegacyAuthMigration()) {
      await migrateLegacyChipMateAuth(
        async () => (await AppRuntime.runPromise(Auth.Service.use((s) => s.get("chipmate")))) !== undefined,
        async (auth) => AppRuntime.runPromise(Auth.Service.use((s) => s.set("chipmate", auth))),
      )
    }

    const auth = await AppRuntime.runPromise(Auth.Service.use((s) => s.get("chipmate")))
    if (auth) {
      const token = auth.type === "oauth" ? auth.access : auth.key
      const account = auth.type === "oauth" ? auth.accountId : undefined
      await Telemetry.updateIdentity(token, account)
    }

    Telemetry.trackCliStart()
  }

  // Runs from the `finally` block on every exit path.
  export async function shutdown(): Promise<void> {
    if (skipShutdown) {
      skipShutdown = false
      return
    }
    const code = typeof process.exitCode === "number" ? process.exitCode : undefined
    Telemetry.trackCliExit(code)
    try {
      await SessionExport.shutdown()
      // Bound telemetry shutdown so an unreachable endpoint (offline, firewall,
      // DNS adblock resolving the host to 0.0.0.0) cannot block process exit on
      // short-lived commands like `chipmate --help` / `chipmate --version` (#9788).
      try {
        await Telemetry.shutdown(2000)
      } catch (err) {
        log.warn("telemetry shutdown failed", { err })
      }
    } finally {
      try {
        await ChipMateShutdown.run()
      } catch (err) {
        log.warn("shutdown task failed", { err })
      }
      await InstanceRuntime.disposeAllInstances() // safety net (no-op if already disposed)
    }
  }
}
