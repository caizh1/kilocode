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

const powershell = new Set([
  "begin",
  "break",
  "catch",
  "cat",
  "cd",
  "class",
  "clear",
  "cls",
  "continue",
  "copy",
  "cp",
  "data",
  "del",
  "dir",
  "do",
  "dynamicparam",
  "else",
  "elseif",
  "end",
  "enum",
  "erase",
  "exit",
  "filter",
  "finally",
  "for",
  "foreach",
  "from",
  "function",
  "gc",
  "gci",
  "gi",
  "gps",
  "hidden",
  "if",
  "in",
  "kill",
  "ls",
  "man",
  "md",
  "mkdir",
  "move",
  "mv",
  "ni",
  "param",
  "popd",
  "process",
  "ps",
  "pushd",
  "pwd",
  "return",
  "rm",
  "rmdir",
  "set",
  "sl",
  "static",
  "switch",
  "throw",
  "trap",
  "try",
  "type",
  "until",
  "using",
  "var",
  "while",
  "where",
  "write-output",
])

function forced(input: string): AgentConsoleRoutedInput | undefined {
  if (input.startsWith("/agent ")) return { route: "agent", input: input.slice(7).trim() }
  if (input === "/agent") return { route: "agent", input: "" }
  if (input.startsWith("!")) return { route: "shell", input: input.slice(1).trimStart() }
  return undefined
}

function syntax(input: string, platform: NodeJS.Platform): boolean {
  if (/^(?:\.\.?[\\/]|~[\\/]|[\\/])/.test(input)) return true
  if (/^['"](?:\.\.?[\\/]|~[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(input)) return true
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(input)) return true
  if (/(?:&&|\|\||[|<>`]|\$\()/.test(input)) return true
  if (/\.(?:sh|bash|zsh|fish|py|pl|rb|js|mjs|cjs|ps1)(?:\s|$)/i.test(input)) return true
  if (platform !== "win32") return false
  if (/\.(?:com|exe|bat|cmd)$/i.test(token(input))) return true
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(input)) return true
  if (/^[$@](?:env:)?[A-Za-z_][A-Za-z0-9_:]*/i.test(input)) return true
  return /^[A-Za-z]+-[A-Za-z][A-Za-z0-9-]*(?:\s|$)/.test(input)
}

function token(input: string): string {
  const match = input.match(/^\s*([^\s;&|<>]+)/)
  return match?.[1]?.replace(/^['"]|['"]$/g, "") ?? ""
}

async function executable(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<boolean> {
  if (!command || /[\u3400-\u9fff]/u.test(command)) return false
  const win = platform === "win32"
  const api = win ? path.win32 : path
  const dirs = (env.PATH ?? "").split(win ? ";" : path.delimiter).filter(Boolean)
  const suffixes = win ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""]
  const ext = api.extname(command).toUpperCase()
  const names =
    win && suffixes.some((suffix) => suffix.toUpperCase() === ext) ? [command] : suffixes.map((s) => `${command}${s}`)
  const files = api.isAbsolute(command) ? names : dirs.flatMap((dir) => names.map((name) => api.join(dir, name)))
  for (const file of files) {
    const ok = await access(file, constants.X_OK)
      .then(() => true)
      .catch(() => false)
    if (ok) return true
  }
  return false
}

export async function routeAgentConsoleInput(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  known = false,
): Promise<AgentConsoleRoutedInput> {
  const input = value.trim()
  const override = forced(input)
  if (override) return override
  if (!input || known) return { route: "shell", input }
  const command = token(input)
  const name = command.toLowerCase()
  if (
    builtins.has(name) ||
    (platform === "win32" && powershell.has(name)) ||
    syntax(input, platform) ||
    (await executable(command, env, platform))
  )
    return { route: "shell", input }
  return { route: "agent", input }
}
