export * as PtyPreparation from "./pty-preparation"

import { Config } from "@/config/config"
import * as InstanceState from "@/effect/instance-state"
import { Plugin } from "@/plugin"
import { Shell } from "@opencode-ai/core/shell"
import { Pty } from "@opencode-ai/core/pty"
import { ChipMatePtySelfCommand } from "@/chipmate/pty/self-command" // chipmate_change - ported from the deleted @/pty module
import { selfEnv, userEnv } from "@/chipmate/product-env" // chipmate_change
import { Effect } from "effect"

export const prepareCreate = Effect.fn("PtyPreparation.prepareCreate")(function* (input: Pty.CreateInput) {
  const config = yield* Config.Service
  const plugin = yield* Plugin.Service
  // chipmate_change start - resolve ChipMate self-commands (e.g. bare `chipmate`) to the real binary + args + project cwd
  const resolved = ChipMatePtySelfCommand.resolve({
    command: input.command,
    args: input.args ? [...input.args] : undefined,
    cwd: input.cwd,
  })
  const command = resolved.command || Shell.preferred((yield* config.get()).shell)
  const baseArgs = resolved.args ?? []
  const cwd = resolved.cwd || (yield* InstanceState.context).directory
  // chipmate_change end
  const args = Shell.login(command) ? [...baseArgs, "-l"] : [...baseArgs]
  const shell = yield* plugin.trigger("shell.env", { cwd }, { env: {} })
  const env = userEnv({
    // chipmate_change
    ...process.env,
    ...input.env,
    ...shell.env,
    TERM: "xterm-256color",
    CHIPMATE_TERMINAL: "1",
  }) as Record<string, string>
  if (resolved.self) Object.assign(env, selfEnv()) // chipmate_change - trusted bundled self keeps only product routing
  // chipmate_change start - ported from the deleted @/pty module.
  // Don't leak the chipmate server's auth credential into user shells: anything the shell forks (npm
  // post-install, `curl | bash`, compromised tools) would otherwise see the password for free. Users
  // who need `chipmate run`/`chipmate tui attach` to auto-connect from a chipmate-spawned terminal pass --password.
  delete env.CHIPMATE_SERVER_PASSWORD
  delete env.CHIPMATE_SERVER_USERNAME
  // chipmate_change end
  if (process.platform === "win32") {
    env.LC_ALL = "C.UTF-8"
    env.LC_CTYPE = "C.UTF-8"
    env.LANG = "C.UTF-8"
  }
  return { command, args, cwd, title: input.title, env }
})
