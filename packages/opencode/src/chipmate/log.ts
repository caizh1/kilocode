import { DiagnosticStore } from "@opencode-ai/core/chipmate/diagnostics/store"
import { diagnosticMessage } from "@opencode-ai/core/chipmate/diagnostics/redact"
import * as Log from "@opencode-ai/core/util/log"
import { InstallationBuildKind } from "@opencode-ai/core/installation/version"

export namespace ChipMateLog {
  let detach: (() => void) | undefined
  export function init() {
    const value = process.env.CHIPMATE_LOG_LEVEL?.toUpperCase()
    const level: Log.Level =
      value === "DEBUG" || value === "INFO" || value === "WARN" || value === "ERROR"
        ? value
        : InstallationBuildKind === "release"
          ? "INFO"
          : "DEBUG"
    detach?.()
    const root = process.env.CHIPMATE_DIAGNOSTICS_DIR
    const salt = process.env.CHIPMATE_DIAGNOSTICS_SALT
    if (root && salt) {
      const store = new DiagnosticStore({ root, salt, source: "cli", workspace: process.env.CHIPMATE_DIAGNOSTICS_WORKSPACE ?? process.cwd(), runId: process.env.CHIPMATE_DIAGNOSTICS_RUN_ID })
      detach = Log.onDiagnostic((severity, message, data) => {
        if (severity === "DEBUG") return
        store.append(diagnosticMessage(message, salt), data, severity, typeof data.service === "string" ? `cli.${data.service}` : "cli")
      })
      store.append("CLI 诊断已初始化", { version: process.env.CHIPMATE_VERSION, platform: process.platform, arch: process.arch })
    }
    return Log.init({
      print: process.env.CHIPMATE_PRINT_LOGS === "1",
      dev: InstallationBuildKind !== "release",
      level,
    })
  }
}
