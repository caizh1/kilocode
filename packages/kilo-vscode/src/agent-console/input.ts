import { constants } from "node:fs"
import { access } from "node:fs/promises"
import path from "node:path"

export type AgentConsoleInputRoute = "agent" | "shell"

export interface AgentConsoleRoutedInput {
  route: AgentConsoleInputRoute
  input: string
}

const builtins = new Set([
  ".",
  "alias",
  "bg",
  "cd",
  "command",
  "dirs",
  "disown",
  "echo",
  "eval",
  "exec",
  "exit",
  "export",
  "false",
  "fc",
  "fg",
  "getopts",
  "hash",
  "help",
  "history",
  "jobs",
  "kill",
  "popd",
  "printf",
  "pushd",
  "pwd",
  "read",
  "return",
  "set",
  "shift",
  "source",
  "test",
  "times",
  "trap",
  "true",
  "type",
  "typeset",
  "ulimit",
  "umask",
  "unalias",
  "unset",
  "wait",
])

function forced(input: string): AgentConsoleRoutedInput | undefined {
  if (input.startsWith("/agent ")) return { route: "agent", input: input.slice(7).trim() }
  if (input === "/agent") return { route: "agent", input: "" }
  if (input.startsWith("!")) return { route: "shell", input: input.slice(1).trimStart() }
  return undefined
}

function syntax(input: string): boolean {
  if (/^(?:\.\.?[\\/]|~[\\/]|[\\/])/.test(input)) return true
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(input)) return true
  if (/(?:&&|\|\||[|<>`]|\$\()/.test(input)) return true
  return /\.(?:sh|bash|zsh|fish|py|pl|rb|js|mjs|cjs)(?:\s|$)/i.test(input)
}

function token(input: string): string {
  const match = input.match(/^\s*([^\s;&|<>]+)/)
  return match?.[1]?.replace(/^['"]|['"]$/g, "") ?? ""
}

async function executable(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (!command || /[\u3400-\u9fff]/u.test(command)) return false
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean)
  const suffixes = process.platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""]
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const file = path.join(dir, process.platform === "win32" ? `${command}${suffix}` : command)
      const ok = await access(file, constants.X_OK)
        .then(() => true)
        .catch(() => false)
      if (ok) return true
    }
  }
  return false
}

export async function routeAgentConsoleInput(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentConsoleRoutedInput> {
  const input = value.trim()
  const override = forced(input)
  if (override) return override
  const command = token(input)
  if (builtins.has(command) || syntax(input) || (await executable(command, env))) return { route: "shell", input }
  return { route: "agent", input }
}
