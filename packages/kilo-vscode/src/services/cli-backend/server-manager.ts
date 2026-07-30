import { type ChildProcess } from "child_process"
import { spawn } from "../../util/process"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { PRODUCT } from "../../chipmate/identity"
import { resolveLanceDBEnv, resolveLocalBwrapEnv, resolveTreeSitterEnv } from "./cli-resources"
import { t } from "./i18n"
import { parseServerPort } from "./server-utils"
import { internalOfflineEnv } from "../../shared/internal-offline"
import { appendIndexingStderr, indexingOutput } from "../indexing-output"
import * as MemoryDebug from "../memory-debug"
import { chipmateServerEndpoints } from "../chipmate-server"
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
  phase: "starting" | "running"
  arch: string
  cliHash: string
  crash?: "access-violation"
}
type ServerExitListener = (info: ServerExitInfo) => void

export function serverDetached(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32"
}

export function isAccessViolation(code: number | null): boolean {
  return code !== null && code >>> 0 === 0xc0000005
}

export function isWindowsArm(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") return false
  return [env.PROCESSOR_ARCHITECTURE, env.PROCESSOR_ARCHITEW6432, env.PROCESSOR_IDENTIFIER].some((value) =>
    /arm64|armv8/i.test(value ?? ""),
  )
}

export function resolveCliPath(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = fs.existsSync,
): string {
  const paths = platform === "win32" ? path.win32 : path
  const bin = paths.join(root, "bin")
  const arm = paths.join(bin, "kilo-arm64.exe")
  if (isWindowsArm(env, platform) && exists(arm)) return arm
  return paths.join(bin, platform === "win32" ? "kilo.exe" : "kilo")
}

export function cliRuntimeEnv(file: string): Record<string, string> {
  const paths = /^[a-z]:[\\/]/i.test(file) || file.includes("\\") ? path.win32 : path
  if (paths.basename(file).toLowerCase() !== "kilo-arm64.exe") return {}
  return { KILO_INDEXING_PROCESS_PATH: paths.join(paths.dirname(file), "kilo-indexer-arm64.exe") }
}

export function taskkillArgs(pid: number, force: boolean): string[] {
  return ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])]
}

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
    KILO_VSCODE_BUNDLED_BIN: bin,
    ...(base.KILO_RIPGREP_PATH ? {} : { KILO_RIPGREP_PATH: rg }),
  }
}

function pathKey(base: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") return "PATH"
  return Object.keys(base).find((key) => key.toLowerCase() === "path") ?? "Path"
}

export function resolveManagedServerEnv(env: NodeJS.ProcessEnv, storage: string): NodeJS.ProcessEnv {
  const blocked = new Set([
    "KILO_ACP_PROFILE",
    "KILO_AUTH_CONTENT",
    "KILO_CONFIG",
    "KILO_CONFIG_CONTENT",
    "KILO_CONFIG_DIR",
    "KILO_DB",
    "KILO_DEV_CWD",
    "KILO_DEV_REPO",
    "KILO_MEMORY_DEBUG_DIR",
    "KILO_INDEXING_PROCESS_PATH",
    "KILO_PLUGIN_META_FILE",
    "KILO_TUI_CONFIG",
    "KILO_ZED_DB",
  ])
  const clean = Object.fromEntries(
    Object.entries(env).filter(([key]) => !blocked.has(key) && !key.startsWith("KILO_TEST_")),
  )
  return {
    ...clean,
    KILO_DISABLE_CHANNEL_DB: "true",
    KILO_PRODUCT_PROFILE: PRODUCT,
    KILO_STORAGE_ROOT: storage,
    KILO_VSCODE_GLOBAL_STORAGE: storage,
  }
}

export class ServerManager {
  private instance: ServerInstance | null = null
  private starting: ChildProcess | null = null
  private startupPromise: Promise<ServerInstance> | null = null
  private lastExitInfo: ServerExitInfo | null = null
  private readonly expected = new Set<ChildProcess>()
  private disposed = false

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
    if (this.disposed) throw new Error("CLI server manager has been disposed")
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
    const start = this.startServer()
      .then((instance) => {
        if (this.disposed) {
          this.expected.add(instance.process)
          ServerManager.killProcess(instance.process, "SIGKILL")
          throw new Error("CLI server manager was disposed during startup")
        }
        this.instance = instance
        if (this.starting === instance.process) this.starting = null
        console.log("[Kilo New] ServerManager: ✅ Server started successfully:", { port: instance.port })
        return instance
      })
      .finally(() => {
        this.startupPromise = null
      })
    this.startupPromise = start
    return start
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

    const cliHash = await hashFile(cliPath)
    const cliArch = path.basename(cliPath).toLowerCase() === "kilo-arm64.exe" ? "arm64" : process.arch
    console.log("[Kilo New] ServerManager: 🔎 CLI SHA-256:", cliHash)
    console.log("[Kilo New] ServerManager: 🧭 Runtime architecture:", {
      extensionHost: process.arch,
      windowsArmHost: isWindowsArm(),
      cli: cliArch,
    })

    const stat = fs.statSync(cliPath)
    console.log("[Kilo New] ServerManager: 📄 CLI isFile:", stat.isFile())
    console.log("[Kilo New] ServerManager: 📄 CLI mode (octal):", (stat.mode & 0o777).toString(8))

    return new Promise((resolve, reject) => {
      console.log("[Kilo New] ServerManager: 🎬 Spawning CLI process:", cliPath, ["serve", "--port", "0"])
      const cfg = vscode.workspace.getConfiguration("chipmate.v2")
      const render = renderEnv()
      console.log("[Kilo New] ServerManager: 🖼️ Mermaid render endpoint:", mermaidEndpoint(render))
      console.log("[Kilo New] ServerManager: 🖼️ PlantUML render endpoint:", plantumlEndpoint(render))
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
      //     `chipmate.v2.extraCaCerts` (NODE_EXTRA_CA_CERTS).
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
          ...resolveManagedServerEnv(process.env, this.context.globalStorageUri.fsPath),
          ...cliRuntimeEnv(cliPath),
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
        detached: serverDetached(),
      })
      this.starting = serverProcess
      console.log("[Kilo New] ServerManager: 📦 Process spawned with PID:", serverProcess.pid)
      void MemoryDebug.append({
        event: "cli.spawned",
        runId,
        data: {
          pid: serverProcess.pid,
          cli: path.basename(cliPath),
          cliHash,
          arch: process.arch,
          cliArch,
          windowsArmHost: isWindowsArm(),
          phase: "starting",
        },
      })

      let resolved = false
      let reported = false
      let timeout = ""
      const stderrLines: string[] = []

      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (reported) return
        reported = true
        clearTimeout(timer)
        if (this.starting === serverProcess) this.starting = null
        console.log("[Kilo New] ServerManager: 🛑 Process exited:", { code, signal })
        this.lastExitInfo = {
          code,
          signal,
          stderr: [...stderrLines],
          cliPath,
          pid: serverProcess.pid,
          runId,
          expected: this.expected.delete(serverProcess),
          phase: resolved ? "running" : "starting",
          arch: process.arch,
          cliHash,
          crash: isAccessViolation(code) ? "access-violation" : undefined,
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
            phase: this.lastExitInfo.phase,
            arch: process.arch,
            cliArch,
            windowsArmHost: isWindowsArm(),
            cliHash,
            crash: MemoryDebug.parseCrash(stderrLines),
            stderr: stderrLines.join("\n"),
          },
        })
        if (this.instance?.process === serverProcess) {
          this.instance = null
        }
        this.onExit?.(this.lastExitInfo)
        if (resolved) return
        const { userMessage, userDetails } = toErrorMessage(
          timeout || processExitMessage(code, signal),
          stderrLines,
          cliPath,
        )
        reject(new ServerStartupError(userMessage, userDetails))
      }

      const timer = setTimeout(() => {
        if (resolved) return
        console.error(`[Kilo New] ServerManager: ⏰ Server startup timeout (${STARTUP_TIMEOUT_SECONDS}s)`)
        timeout = t("server.startupTimeout", { seconds: STARTUP_TIMEOUT_SECONDS })
        ServerManager.killProcess(serverProcess, "SIGKILL")
      }, STARTUP_TIMEOUT_SECONDS * 1000)
      timer.unref()

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        console.log("[Kilo New] ServerManager: 📥 CLI Server stdout:", output)
        void MemoryDebug.append({ event: "cli.stdout", runId, data: { output } })

        const port = parseServerPort(output)
        if (port !== null && !resolved) {
          resolved = true
          clearTimeout(timer)
          console.log("[Kilo New] ServerManager: 🎯 Port detected:", port)
          void MemoryDebug.append({
            event: "cli.ready",
            runId,
            data: { pid: serverProcess.pid, port, phase: "running" },
          })
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
    })
  }

  getLastExitInfo(): ServerExitInfo | null {
    return this.lastExitInfo
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const cliPath = resolveCliPath(this.context.extensionPath)
    console.log("[Kilo New] ServerManager: 📦 Using CLI path:", cliPath)
    return cliPath
  }

  private appendIndexingOutput(output: string): void {
    appendIndexingStderr(this.context, output)
  }

  /**
   * Kill a process and its entire process group.
   * On Unix, we send the signal to -pid (negative) to reach the whole group.
   * On Windows, taskkill targets the exact PID and its descendants.
   */
  private static killProcess(proc: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
    if (proc.pid === undefined) {
      return
    }
    if (process.platform === "win32") {
      if (signal !== "SIGKILL") {
        proc.kill("SIGTERM")
        return
      }
      const killer = spawn("taskkill.exe", taskkillArgs(proc.pid, signal === "SIGKILL"), {
        stdio: "ignore",
        detached: false,
      })
      killer.on("error", (err) => {
        console.warn("[Kilo New] ServerManager: taskkill failed:", { pid: proc.pid, error: err.message })
      })
      return
    }
    try {
      // Negative PID targets the entire process group.
      process.kill(-proc.pid, signal)
    } catch (err) {
      console.debug("[Kilo New] ServerManager: process group already exited:", {
        pid: proc.pid,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  dispose(): void {
    this.disposed = true
    const proc = this.instance?.process ?? this.starting
    if (!proc) return
    this.instance = null
    this.starting = null
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
  const word = unified.endpoints?.word ?? ""
  const mermaid = unified.endpoints?.mermaid ?? ""
  const plantuml = unified.endpoints?.plantuml ?? ""
  const review = unified.endpoints?.reviewRules ?? ""
  return {
    ...(word && !process.env.KILO_WORD_RENDER_ENDPOINT ? { KILO_WORD_RENDER_ENDPOINT: word } : {}),
    ...(mermaid && !process.env.KILO_MERMAID_RENDER_ENDPOINT ? { KILO_MERMAID_RENDER_ENDPOINT: mermaid } : {}),
    ...(plantuml && !process.env.KILO_PLANTUML_RENDER_ENDPOINT ? { KILO_PLANTUML_RENDER_ENDPOINT: plantuml } : {}),
    ...(review && !process.env.KILO_REVIEW_RULES_ENDPOINT ? { KILO_REVIEW_RULES_ENDPOINT: review } : {}),
  }
}

export type RenderEndpoint = {
  state: "injected" | "inherited" | "absent"
  endpoint?: string
}

export function mermaidEndpoint(
  render: Record<string, string> = renderEnv(),
  inherited = process.env.KILO_MERMAID_RENDER_ENDPOINT,
): RenderEndpoint {
  const injected = render.KILO_MERMAID_RENDER_ENDPOINT
  if (injected) return { state: "injected", endpoint: redactEndpoint(injected) }
  if (inherited) return { state: "inherited", endpoint: redactEndpoint(inherited) }
  return { state: "absent" }
}

export function plantumlEndpoint(
  render: Record<string, string> = renderEnv(),
  inherited = process.env.KILO_PLANTUML_RENDER_ENDPOINT,
): RenderEndpoint {
  const injected = render.KILO_PLANTUML_RENDER_ENDPOINT
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
  const cfg = vscode.workspace.getConfiguration("chipmate.v2.indexing")
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
  if (isAccessViolation(code))
    return "CLI process crashed with Windows access violation 0xC0000005 before server started"
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
    `Phase: ${info.phase}`,
    `Process: pid=${info.pid ?? "unknown"} arch=${info.arch}`,
    `CLI path: ${info.cliPath}`,
    `CLI SHA-256: ${info.cliHash}`,
    info.crash === "access-violation" ? "Crash: Windows access violation 0xC0000005" : undefined,
    stderr ? `Last CLI stderr:\n${stderr}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const stream = fs.createReadStream(file)
    stream.on("data", (data) => hash.update(data))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
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
