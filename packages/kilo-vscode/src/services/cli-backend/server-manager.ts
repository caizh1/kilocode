import { type ChildProcess } from "child_process"
import { spawn } from "../../util/process"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { resolveLanceDBEnv, resolveLocalBwrapEnv, resolveTreeSitterEnv } from "./cli-resources"
import { t } from "./i18n"
import { parseServerPort } from "./server-utils"
import { internalOfflineEnv } from "../../shared/internal-offline"
import { appendIndexingStderr, indexingOutput } from "../indexing-output"
import * as MemoryDebug from "../memory-debug"
import { chipmateServerEndpoints, legacyChipmateServerEndpoints } from "../chipmate-server"
export { isIndexingDiagnosticLine } from "../indexing-output"

export interface ServerInstance {
  port: number
  password: string
  process: ChildProcess
  runId: string
}

const STARTUP_TIMEOUT_SECONDS = 30

type WorkspaceFolderLike = { uri: { fsPath: string } }
export type ServerExitInfo = {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string[]
  cliPath: string
  pid?: number
  runId: string
  expected: boolean
}
type ServerExitListener = (info: ServerExitInfo) => void

export function resolveServerCwd(folders: readonly WorkspaceFolderLike[] | undefined, storage: string): string {
  return folders?.[0]?.uri.fsPath ?? storage
}

export function emptyWorkspaceEnv(
  folders: readonly WorkspaceFolderLike[] | undefined,
  cwd: string,
): Record<string, string> {
  if (folders?.length) return {}
  return { KILO_VSCODE_EMPTY_WORKSPACE_DIR: path.resolve(cwd) }
}

export function buildBundledToolEnv(root: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const key = pathKey(base)
  const bin = path.join(root, "bin")
  const poppler = path.join(bin, "poppler")
  const rg = path.join(bin, process.platform === "win32" ? "rg.exe" : "rg")
  const value = base[key]
  const prefix = `${poppler}${path.delimiter}${bin}`
  return {
    [key]: value ? `${prefix}${path.delimiter}${value}` : prefix,
    ...(base.KILO_RIPGREP_PATH ? {} : { KILO_RIPGREP_PATH: rg }),
  }
}

function pathKey(base: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") return "PATH"
  return Object.keys(base).find((key) => key.toLowerCase() === "path") ?? "Path"
}

export function resolveManagedServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, KILO_DISABLE_CHANNEL_DB: "true" }
}

export class ServerManager {
  private instance: ServerInstance | null = null
  private startupPromise: Promise<ServerInstance> | null = null
  private lastExitInfo: ServerExitInfo | null = null
  private readonly expected = new Set<ChildProcess>()

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onExit?: ServerExitListener,
  ) {
    indexingOutput(context)
    MemoryDebug.initialize(context)
  }

  /**
   * Get or start the server instance
   */
  async getServer(): Promise<ServerInstance> {
    console.log("[Kilo New] ServerManager: 🔍 getServer called")
    if (this.instance) {
      console.log("[Kilo New] ServerManager: ♻️ Returning existing instance:", { port: this.instance.port })
      return this.instance
    }

    if (this.startupPromise) {
      console.log("[Kilo New] ServerManager: ⏳ Startup already in progress, waiting...")
      return this.startupPromise
    }

    console.log("[Kilo New] ServerManager: 🚀 Starting new server instance...")
    this.startupPromise = this.startServer()
    try {
      this.instance = await this.startupPromise
      console.log("[Kilo New] ServerManager: ✅ Server started successfully:", { port: this.instance.port })
      return this.instance
    } finally {
      this.startupPromise = null
    }
  }

  private async startServer(): Promise<ServerInstance> {
    const password = crypto.randomBytes(32).toString("hex")
    const runId = MemoryDebug.runId()
    const cliPath = this.getCliPath()
    console.log("[Kilo New] ServerManager: 📍 CLI path:", cliPath)
    console.log("[Kilo New] ServerManager: 🔐 Generated password (length):", password.length)

    // Verify the CLI binary exists
    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `CLI binary not found at expected path: ${cliPath}. Please ensure the CLI is built and bundled with the extension.`,
      )
    }

    const stat = fs.statSync(cliPath)
    console.log("[Kilo New] ServerManager: 📄 CLI isFile:", stat.isFile())
    console.log("[Kilo New] ServerManager: 📄 CLI mode (octal):", (stat.mode & 0o777).toString(8))

    return new Promise((resolve, reject) => {
      console.log("[Kilo New] ServerManager: 🎬 Spawning CLI process:", cliPath, ["serve", "--port", "0"])
      const cfg = vscode.workspace.getConfiguration("kilo-code.new")
      const render = renderEnv()
      console.log("[Kilo New] ServerManager: 🖼️ Mermaid render endpoint:", mermaidEndpoint(render))
      const internal = internalOfflineEnv()
      const indexingControl = indexingControlEnv(internal)
      const claudeCompat = cfg.get<boolean>("claudeCodeCompat", false)
      // Pin cwd so the CLI doesn't inherit the extension host's cwd ("/" under F5 debug)
      // or "$HOME" in empty VS Code windows.
      const folders = vscode.workspace.workspaceFolders
      const spawnCwd = resolveServerCwd(folders, this.context.globalStorageUri.fsPath)
      const empty = emptyWorkspaceEnv(folders, spawnCwd)
      fs.mkdirSync(spawnCwd, { recursive: true })
      const localCli =
        this.context.extensionMode === vscode.ExtensionMode.Development ||
        fs.existsSync(path.join(this.context.extensionPath, "bin", ".cli-version"))
      const bwrapEnv = process.env.KILO_BWRAP_PATH ? {} : resolveLocalBwrapEnv(this.context.extensionPath, localCli)
      // TLS / corporate-proxy support:
      //   - Default NODE_USE_SYSTEM_CA=1 so the bundled Bun CLI trusts the OS
      //     trust store (Windows cert store, macOS keychain, Linux /etc/ssl).
      //     Mirrors VS Code's `http.systemCertificates` default (true).
      //   - Allow users behind MITM proxies to point at a custom CA bundle via
      //     `kilo-code.new.extraCaCerts` (NODE_EXTRA_CA_CERTS).
      //   - Honor VS Code's `http.proxyStrictSSL=false` as an explicit opt-out
      //     from verification, matching what VS Code already does for its own
      //     requests. Users explicitly set that; we don't flip it ourselves.
      // All three are overridable by the user's environment.
      const extraCaCerts = cfg.get<string>("extraCaCerts", "").trim()
      const proxyStrictSSL = vscode.workspace.getConfiguration("http").get<boolean>("proxyStrictSSL", true)
      const serverProcess = spawn(cliPath, ["serve", "--port", "0"], {
        cwd: spawnCwd,
        env: {
          NODE_USE_SYSTEM_CA: "1",
          ...(extraCaCerts && { NODE_EXTRA_CA_CERTS: extraCaCerts }),
          ...(!proxyStrictSSL && { NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
          ...resolveManagedServerEnv(process.env),
          ...render,
          // VS Code's http.proxy / http.noProxy settings are not reflected in
          // process.env, so spawned children bypass the user's configured proxy
          // and fail behind corporate firewalls. Forward them as the standard
          // HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars that Bun's fetch and
          // most HTTP clients already respect.
          ...buildProxyEnv(),
          // Force mimalloc (the allocator Bun ships with) to return freed pages
          // to the OS immediately instead of retaining them in its arenas.
          // Without this, Bun.spawn's piped stdio accumulates ~2 MB of native
          // RSS per call on Windows, causing the Agent Manager (which polls git
          // once per second per worktree) to reach multi-GB RSS in minutes.
          // See oven-sh/bun#18265 and Jarred's workaround note in #21560.
          MIMALLOC_PURGE_DELAY: "0",
          KILO_MEMORY_DEBUG: "1",
          KILO_MEMORY_DEBUG_DIR: MemoryDebug.directory(),
          KILO_MEMORY_DEBUG_RUN_ID: runId,
          KILO_SERVER_PASSWORD: password,
          // The CLI watches this PID and exits if the extension host is hard-killed without a
          // chance to run dispose(), so it is never orphaned. See parent-watchdog.ts.
          KILO_PARENT_PID: String(process.pid),
          KILO_CLIENT: "vscode",
          KILO_ENABLE_QUESTION_TOOL: "true",
          KILOCODE_FEATURE: "vscode-extension",
          ...internal,
          ...indexingControl,
          ...empty,
          KILO_TELEMETRY_LEVEL: vscode.env.isTelemetryEnabled ? "all" : "off",
          KILO_APP_NAME: "chipmate",
          KILO_EDITOR_NAME: vscode.env.appName,
          KILO_PLATFORM: "vscode",
          KILO_MACHINE_ID: vscode.env.machineId,
          KILO_APP_VERSION: this.context.extension.packageJSON.version,
          KILO_VSCODE_VERSION: vscode.version,
          KILOCODE_VERSION: this.context.extension.packageJSON.version,
          KILOCODE_EDITOR_NAME: `${vscode.env.appName} ${vscode.version}`,
          ...(!claudeCompat && { KILO_DISABLE_CLAUDE_CODE: "true" }),
          ...buildBundledToolEnv(this.context.extensionPath),
          ...resolveLanceDBEnv(this.context.extensionPath),
          ...resolveTreeSitterEnv(this.context.extensionPath),
          ...bwrapEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      })
      console.log("[Kilo New] ServerManager: 📦 Process spawned with PID:", serverProcess.pid)
      void MemoryDebug.append({
        event: "cli.spawned",
        runId,
        data: { pid: serverProcess.pid, cli: path.basename(cliPath) },
      })

      let resolved = false
      let reported = false
      const stderrLines: string[] = []

      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (reported) return
        reported = true
        console.log("[Kilo New] ServerManager: 🛑 Process exited:", { code, signal })
        this.lastExitInfo = {
          code,
          signal,
          stderr: [...stderrLines],
          cliPath,
          pid: serverProcess.pid,
          runId,
          expected: this.expected.delete(serverProcess),
        }
        this.appendIndexingOutput(formatServerExitInfo(this.lastExitInfo))
        void MemoryDebug.append({
          event: "cli.exited",
          runId,
          data: {
            code,
            signal,
            expected: this.lastExitInfo.expected,
            pid: serverProcess.pid,
            crash: MemoryDebug.parseCrash(stderrLines),
            stderr: stderrLines.join("\n"),
          },
        })
        if (this.instance?.process === serverProcess) {
          this.instance = null
        }
        this.onExit?.(this.lastExitInfo)
        if (resolved) return
        const { userMessage, userDetails } = toErrorMessage(processExitMessage(code, signal), stderrLines, cliPath)
        reject(new ServerStartupError(userMessage, userDetails))
      }

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        console.log("[Kilo New] ServerManager: 📥 CLI Server stdout:", output)
        void MemoryDebug.append({ event: "cli.stdout", runId, data: { output } })

        const port = parseServerPort(output)
        if (port !== null && !resolved) {
          resolved = true
          console.log("[Kilo New] ServerManager: 🎯 Port detected:", port)
          resolve({ port, password, process: serverProcess, runId })
        }
      })

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const errorOutput = data.toString()
        console.error("[Kilo New] ServerManager: ⚠️ CLI Server stderr:", errorOutput)
        this.appendIndexingOutput(errorOutput)
        rememberStderr(stderrLines, errorOutput)
        void MemoryDebug.append({ event: "cli.stderr", runId, data: { output: errorOutput } })
      })

      serverProcess.on("error", (error) => {
        console.error("[Kilo New] ServerManager: ❌ Process error:", error)
        stderrLines.push(error.message)
        void MemoryDebug.append({ event: "cli.process.error", runId, data: { error: error.message } })
        finish(null, null)
      })

      serverProcess.on("exit", (code, signal) => {
        finish(code, signal)
      })

      setTimeout(() => {
        if (!resolved) {
          console.error(`[Kilo New] ServerManager: ⏰ Server startup timeout (${STARTUP_TIMEOUT_SECONDS}s)`)
          ServerManager.killProcess(serverProcess)
          const { userMessage, userDetails } = toErrorMessage(
            t("server.startupTimeout", { seconds: STARTUP_TIMEOUT_SECONDS }),
            stderrLines,
            cliPath,
          )
          reject(new ServerStartupError(userMessage, userDetails))
        }
      }, STARTUP_TIMEOUT_SECONDS * 1000)
    })
  }

  getLastExitInfo(): ServerExitInfo | null {
    return this.lastExitInfo
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const binName = process.platform === "win32" ? "kilo.exe" : "kilo"
    const cliPath = path.join(this.context.extensionPath, "bin", binName)
    console.log("[Kilo New] ServerManager: 📦 Using CLI path:", cliPath)
    return cliPath
  }

  private appendIndexingOutput(output: string): void {
    appendIndexingStderr(this.context, output)
  }

  /**
   * Kill a process and its entire process group.
   * On Unix, we send the signal to -pid (negative) to reach the whole group.
   * On Windows, process.kill() on the child handle is sufficient.
   */
  private static killProcess(proc: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
    if (proc.pid === undefined) {
      return
    }
    try {
      if (process.platform !== "win32") {
        // Negative PID targets the entire process group
        process.kill(-proc.pid, signal)
      } else {
        proc.kill(signal)
      }
    } catch {
      // Process already gone — ignore
    }
  }

  dispose(): void {
    if (!this.instance) {
      return
    }
    const proc = this.instance.process
    this.instance = null
    this.expected.add(proc)

    console.log("[Kilo New] ServerManager: 🔴 Disposing — sending SIGTERM to process group, PID:", proc.pid)
    ServerManager.killProcess(proc, "SIGTERM")

    // SIGKILL fallback after 5s. Ensures the process tree dies even if SIGTERM is ignored
    // or Instance.disposeAll() hangs past the serve.ts shutdown timeout.
    const timer = setTimeout(() => {
      if (proc.exitCode === null) {
        console.warn("[Kilo New] ServerManager: ⚠️ Process did not exit after SIGTERM, sending SIGKILL")
        ServerManager.killProcess(proc, "SIGKILL")
      }
    }, 5000)
    // unref so this timer doesn't prevent the extension host from exiting
    timer.unref()
    proc.on("exit", () => clearTimeout(timer))
  }
}

export function renderEnv(): Record<string, string> {
  const unified = chipmateServerEndpoints()
  const legacy = legacyChipmateServerEndpoints()
  const word = unified.endpoints?.word ?? (unified.state.source === "conflict" ? legacy.word : "")
  const mermaid = unified.endpoints?.mermaid ?? (unified.state.source === "conflict" ? legacy.mermaid : "")
  return {
    ...(word && !process.env.KILO_WORD_RENDER_ENDPOINT ? { KILO_WORD_RENDER_ENDPOINT: word } : {}),
    ...(mermaid && !process.env.KILO_MERMAID_RENDER_ENDPOINT ? { KILO_MERMAID_RENDER_ENDPOINT: mermaid } : {}),
  }
}

export type MermaidEndpoint = {
  state: "injected" | "inherited" | "absent"
  endpoint?: string
}

export function mermaidEndpoint(
  render: Record<string, string> = renderEnv(),
  inherited = process.env.KILO_MERMAID_RENDER_ENDPOINT,
): MermaidEndpoint {
  const injected = render.KILO_MERMAID_RENDER_ENDPOINT
  if (injected) return { state: "injected", endpoint: redactEndpoint(injected) }
  if (inherited) return { state: "inherited", endpoint: redactEndpoint(inherited) }
  return { state: "absent" }
}

function redactEndpoint(value: string): string {
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return "<invalid>"
  }
}

function indexingControlEnv(internal: Record<string, string>): Record<string, string> {
  const cfg = vscode.workspace.getConfiguration("kilo.indexing")
  const openAICompatibleBaseUrl = cfg.get<string>("openaiCompatible.baseUrl", "").trim()
  return {
    ...(Object.keys(internal).length > 0 &&
    openAICompatibleBaseUrl &&
    !process.env.KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL
      ? { KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL: openAICompatibleBaseUrl }
      : {}),
    ...(process.platform === "linux" &&
    Object.keys(internal).length > 0 &&
    !process.env.KILO_CODEGRAPH_WORKER_CONCURRENCY
      ? { KILO_CODEGRAPH_WORKER_CONCURRENCY: "2" }
      : {}),
  }
}

export class ServerStartupError extends Error {
  readonly userMessage: string
  readonly userDetails: string
  constructor(userMessage: string, userDetails: string) {
    super(userDetails)
    this.name = "ServerStartupError"
    this.userMessage = userMessage
    this.userDetails = userDetails
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

function processExitMessage(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `CLI process exited from signal ${signal} before server started`
  return t("server.processExited", { code: code ?? "null" })
}

function formatServerExitInfo(info: ServerExitInfo): string {
  const reason = info.signal ? `signal ${info.signal}` : `code ${info.code ?? "unknown"}`
  const stderr = info.stderr
    .flatMap((line) => line.split("\n"))
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .slice(-8)
    .join("\n")
  return [
    `[${new Date().toISOString()}] CLI background process exited with ${reason}.`,
    `CLI path: ${info.cliPath}`,
    stderr ? `Last CLI stderr:\n${stderr}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}

function rememberStderr(lines: string[], output: string): void {
  lines.push(output)
  if (lines.length > 40) lines.splice(0, lines.length - 40)
}

/**
 * Translate VS Code's `http.proxy` / `http.noProxy` / `http.proxySupport`
 * settings into the standard proxy env vars, so the spawned CLI honors the
 * user's proxy configuration. Returns an empty object when no override is
 * needed, so callers can spread unconditionally.
 *
 * `http.proxySupport: "off"` is VS Code's opt-in way to disable proxy support
 * entirely; when set, we explicitly clear the env vars so ambient shell
 * HTTP_PROXY/http_proxy doesn't leak into the spawned child.
 */
export function buildProxyEnv(): Record<string, string> {
  const httpConfig = vscode.workspace.getConfiguration("http")
  const proxyInfo = httpConfig.inspect<string>("proxy")
  const noProxyInfo = httpConfig.inspect<string[]>("noProxy")
  const proxySupport = httpConfig.get<string>("proxySupport")

  if (proxySupport === "off") {
    return { HTTP_PROXY: "", HTTPS_PROXY: "", NO_PROXY: "", http_proxy: "", https_proxy: "", no_proxy: "" }
  }

  const proxy = httpConfig.get<string>("proxy")
  const noProxy = httpConfig.get<string[]>("noProxy")
  const proxySet =
    proxyInfo !== undefined &&
    [
      proxyInfo.globalValue,
      proxyInfo.workspaceValue,
      proxyInfo.workspaceFolderValue,
      proxyInfo.globalLanguageValue,
      proxyInfo.workspaceLanguageValue,
      proxyInfo.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined)
  const noProxySet =
    noProxyInfo !== undefined &&
    [
      noProxyInfo.globalValue,
      noProxyInfo.workspaceValue,
      noProxyInfo.workspaceFolderValue,
      noProxyInfo.globalLanguageValue,
      noProxyInfo.workspaceLanguageValue,
      noProxyInfo.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined)
  const env: Record<string, string> = {}
  if (proxy && proxy.trim() !== "") {
    env.HTTP_PROXY = proxy
    env.HTTPS_PROXY = proxy
    env.http_proxy = proxy
    env.https_proxy = proxy
  }
  if (proxySet && proxy !== undefined && proxy.trim() === "") {
    env.HTTP_PROXY = ""
    env.HTTPS_PROXY = ""
    env.http_proxy = ""
    env.https_proxy = ""
  }
  if (Array.isArray(noProxy) && noProxy.length > 0) {
    env.NO_PROXY = noProxy.join(",")
    env.no_proxy = noProxy.join(",")
  }
  if (noProxySet && Array.isArray(noProxy) && noProxy.length === 0) {
    env.NO_PROXY = ""
    env.no_proxy = ""
  }
  return env
}

export function toErrorMessage(
  error: string,
  stderrLines: string[],
  cliPath?: string,
): {
  userMessage: string
  userDetails: string
  error: string
} {
  let lines = stderrLines.flatMap((line) => line.split("\n"))

  const errorLine = lines.map(stripAnsi).find((line) => /Error:\s+/.test(line))
  const userMessage = errorLine
    ? errorLine.match(/Error:\s+(.+)/)![1].trim()
    : stripAnsi([...lines].reverse().find((line) => line.trim() !== "") ?? error).trim()

  lines = [error, ...lines]
  if (cliPath && cliPath.trim() !== "") {
    lines = [`CLI path: ${cliPath}`, ...lines]
  }

  const detailsText = lines.map(stripAnsi).join("\n").trim()

  return {
    userMessage,
    userDetails: detailsText,
    error,
  }
}
