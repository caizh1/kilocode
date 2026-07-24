import { InstanceState } from "@/effect/instance-state"
import * as AgentConsolePty from "@/kilocode/agent-console/pty"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"

export function semantics(platform: NodeJS.Platform = process.platform) {
  const shell = platform === "win32" ? "PowerShell" : "Bash"
  return {
    parameter: `Exact single-line ${shell} command to run in the Agent Console shell`,
    description: `Propose one exact, non-interactive ${shell} command for the persistent Agent Console terminal. The user must approve every command. The approved command runs in the same shell, preserving its cwd and environment.`,
  }
}

const copy = semantics()

const Params = Schema.Struct({
  command: Schema.String.annotate({ description: copy.parameter }),
  description: Schema.optional(Schema.String).annotate({
    description: "Short explanation shown above the approval command",
  }),
}).check(
  Schema.makeFilter((input: { command: string }) => {
    const command = input.command.trim()
    if (!command) return "command must contain a non-whitespace character"
    if (/\r|\n|\0/.test(command)) return "command must be a single visible shell line"
    return undefined
  }),
)

type Meta = {
  cwd: string
  exitCode: number
  bytes: number
  truncated: boolean
}

export const AgentConsoleShellTool = Tool.define<typeof Params, Meta, never, "agent_console_shell">(
  "agent_console_shell",
  Effect.succeed({
    description: copy.description,
    parameters: Params,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        if (ctx.agent !== "agent-console") return yield* Effect.die(new Error("Agent Console shell tool is restricted"))
        const inst = yield* InstanceState.context
        const command = params.command.trim()
        const current = AgentConsolePty.inspect({ directory: inst.directory, sessionID: ctx.sessionID })
        yield* ctx.ask({
          permission: "agent_console_shell",
          patterns: [command],
          always: [],
          metadata: {
            command,
            cwd: current.cwd,
            description: params.description,
          },
          forceAsk: true,
        })
        const latest = AgentConsolePty.inspect({ directory: inst.directory, sessionID: ctx.sessionID })
        if (latest.cwd !== current.cwd || latest.generation !== current.generation) {
          return yield* Effect.die(new Error("Agent Console shell changed while awaiting approval"))
        }
        const result = yield* Effect.tryPromise(() =>
          AgentConsolePty.run({
            directory: inst.directory,
            sessionID: ctx.sessionID,
            command,
            abort: ctx.abort,
          }),
        ).pipe(Effect.orDie)
        return {
          title: params.description ?? command,
          output: [
            result.output || "(no output)",
            `Exit code: ${result.exitCode}`,
            result.truncated ? "Output capture was truncated to the last 2 MiB." : undefined,
          ]
            .filter((line): line is string => line !== undefined)
            .join("\n\n"),
          metadata: {
            cwd: result.cwd,
            exitCode: result.exitCode,
            bytes: result.bytes,
            truncated: result.truncated,
          },
        }
      }),
  }),
)
