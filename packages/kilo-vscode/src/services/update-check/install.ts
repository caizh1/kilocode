import * as vscode from "vscode"
import { existsSync } from "node:fs"
import * as path from "node:path"
import type { ExecFileOptionsWithStringEncoding } from "node:child_process"

export type Exec = (
  cmd: string,
  args: string[],
  opts?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
) => Promise<{ stdout: string; stderr: string }>

type Host = {
  platform: NodeJS.Platform
  exe: string
  root: string
  env: NodeJS.ProcessEnv
  exists: (file: string) => boolean
}

export type InstallCall = {
  cmd: string
  args: string[]
  opts: Omit<ExecFileOptionsWithStringEncoding, "encoding">
  label: string
  display: string
}

const LIMIT = 4_096

export function resolveInstall(value: string, file: string, input: Partial<Host> = {}): InstallCall {
  const host: Host = {
    platform: input.platform ?? process.platform,
    exe: input.exe ?? process.execPath,
    root: input.root ?? vscode.env.appRoot,
    env: input.env ?? process.env,
    exists: input.exists ?? existsSync,
  }
  if (host.platform !== "win32" || value !== "code") return custom(value, file, host)

  const cli = path.win32.join(host.root, "out", "cli.js")
  if (!host.exists(host.exe)) {
    throw new Error(`当前 VS Code 可执行文件不存在：${host.exe}`)
  }
  if (!host.exists(cli)) {
    throw new Error(`当前 VS Code CLI 入口不存在：${cli}`)
  }

  const env: NodeJS.ProcessEnv = { ...host.env, ELECTRON_RUN_AS_NODE: "1" }
  if (env.NODE_OPTIONS) env.VSCODE_NODE_OPTIONS = env.NODE_OPTIONS
  if (env.NODE_REPL_EXTERNAL_MODULE) env.VSCODE_NODE_REPL_EXTERNAL_MODULE = env.NODE_REPL_EXTERNAL_MODULE
  delete env.NODE_OPTIONS
  delete env.NODE_REPL_EXTERNAL_MODULE
  const args = [cli, "--install-extension", file, "--force"]
  return {
    cmd: host.exe,
    args,
    opts: { env },
    label: "当前 VS Code 内置 CLI",
    display: format(host.exe, args),
  }
}

export function installDetail(value: unknown): string {
  const item = record(value)
  const parts = [
    limit(value instanceof Error ? value.message : String(value)),
    item && item.code !== undefined ? `退出码：${String(item.code)}` : "",
    item && item.signal !== undefined ? `信号：${String(item.signal)}` : "",
    item ? output("stderr", item.stderr) : "",
    item ? output("stdout", item.stdout) : "",
  ].filter(Boolean)
  return [...new Set(parts)].join("\n")
}

function custom(value: string, file: string, host: Host): InstallCall {
  const paths = host.platform === "win32" ? path.win32 : path.posix
  if (paths.isAbsolute(value) && !host.exists(value)) {
    throw new Error(`配置的 VS Code CLI 不存在：${value}`)
  }
  const args = ["--install-extension", file, "--force"]
  if (host.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(value)) {
    return {
      cmd: value,
      args,
      opts: {},
      label: host.platform === "win32" ? "自定义 Windows 可执行文件" : "自定义 VS Code CLI",
      display: format(value, args),
    }
  }

  const shell = host.env.ComSpec || host.env.COMSPEC || "cmd.exe"
  const env = {
    ...host.env,
    CHIPMATE_UPDATE_CLI: value,
    CHIPMATE_UPDATE_VSIX: file,
  }
  const body = '"%CHIPMATE_UPDATE_CLI%" --install-extension "%CHIPMATE_UPDATE_VSIX%" --force'
  const command = `"${body}"`
  return {
    cmd: shell,
    args: ["/d", "/s", "/c", command],
    opts: { env },
    label: "Windows 命令脚本",
    display: format(shell, ["/d", "/s", "/c", command]),
  }
}

function format(cmd: string, args: string[]): string {
  return [quote(cmd), ...args.map(quote)].join(" ")
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function output(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return ""
  const text = value.trim().replace(/\0/g, "")
  return `${name}：${limit(text)}`
}

function limit(value: string): string {
  return value.length > LIMIT ? `${value.slice(0, LIMIT)}…` : value
}
