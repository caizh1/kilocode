import * as vscode from "vscode"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import type { ExecFileOptionsWithStringEncoding } from "node:child_process"
import { exec as run } from "../../util/process"
import { chipmateServerEndpoints } from "../chipmate-server"
import { readVsixManifest } from "./vsix"

export const LAST_AUTO_KEY = "chipmate.v2.updateCheck.lastAutoCheckMs"
export const LAST_MANUAL_KEY = "chipmate.v2.updateCheck.lastManualCheckMs"
export const LAST_WARNING_KEY = "chipmate.v2.updateCheck.lastWarningMs"

const DEFAULT_INTERVAL = 24
const DEFAULT_TIMEOUT = 30_000
const DEFAULT_DOWNLOAD_TIMEOUT = 15 * 60_000
const DEFAULT_CODE = "code"
const DEFAULT_MAX = 268_435_456
const DEFAULT_IDLE = 60_000
const INSTALL_TIMEOUT = 5 * 60_000
const INSTALL = "Install Update"
const RELOAD = "Reload Window"
const TARGETS = ["win32-x64-baseline", "linux-x64-baseline", "darwin-x64", "darwin-arm64"] as const

type Mode = "auto" | "manual"
type Target = (typeof TARGETS)[number]
type Kind =
  | "availability"
  | "manifest"
  | "server"
  | "identity"
  | "target"
  | "version"
  | "vsix-url"
  | "download"
  | "download-size"
  | "sha256"
  | "install"

type Package = {
  extensionId: string
  publisher: string
  name: string
  version: string
  target: Target
  url: string
  sha256: string
  sizeBytes: number
}

type Manifest = {
  latestByTarget: Partial<Record<Target, Package>>
}

type Config = {
  enabled: boolean
  autoInstall: boolean
  checkOnStartup: boolean
  intervalHours: number
  timeoutMs: number
  downloadTimeoutMs: number
  codeCliPath: string
  maxDownloadBytes: number
}

type Identity = {
  publisher: string
  name: string
  version: string
}

type Exec = (
  cmd: string,
  args: string[],
  opts?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
) => Promise<{ stdout: string; stderr: string }>

type Deps = {
  fetch: typeof fetch
  exec: Exec
  now: () => number
  updates: () => string
  log: Pick<Console, "log" | "warn" | "error">
}

class UpdateError extends Error {
  constructor(
    readonly kind: Kind,
    message: string,
    readonly warning = message,
    readonly file?: string,
  ) {
    super(message)
  }
}

type Transaction =
  | { state: "running"; promise: Promise<"declined" | "installed"> }
  | { state: "installed"; file: string }
  | { state: "manual"; file: string; warning: string }

export class UpdateCheckService implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly disposables: vscode.Disposable[] = []
  private readonly controllers = new Set<AbortController>()
  private readonly transactions = new Map<string, Transaction>()
  private readonly deps: Deps

  constructor(
    private readonly context: vscode.ExtensionContext,
    deps: Partial<Deps> = {},
  ) {
    this.deps = {
      fetch: deps.fetch ?? fetch,
      exec: deps.exec ?? run,
      now: deps.now ?? Date.now,
      updates: deps.updates ?? updateManifestUrl,
      log: deps.log ?? console,
    }
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("chipmate.v2.updateCheck") ||
          event.affectsConfiguration("chipmate.v2.chipmateServer")
        ) {
          this.schedule()
        }
      }),
    )
  }

  async checkOnStartup(): Promise<void> {
    const cfg = this.config()
    if (!cfg.enabled || !cfg.checkOnStartup) {
      this.schedule(cfg)
      return
    }
    await this.checkAuto()
  }

  async checkAuto(): Promise<void> {
    const cfg = this.config()
    if (!cfg.enabled) {
      this.schedule(cfg)
      return
    }
    if (!this.autoDue(cfg)) {
      this.schedule(cfg)
      return
    }
    await this.context.globalState.update(LAST_AUTO_KEY, this.deps.now())
    try {
      await this.check(cfg, "auto")
    } catch (err) {
      await this.fail(err, cfg, "auto")
    } finally {
      this.schedule()
    }
  }

  async checkManual(): Promise<void> {
    const cfg = this.config()
    await this.context.globalState.update(LAST_MANUAL_KEY, this.deps.now())
    if (!cfg.enabled) {
      await vscode.window.showWarningMessage("ChipMate update checks are disabled.")
      return
    }
    try {
      await this.check(cfg, "manual")
    } catch (err) {
      await this.fail(err, cfg, "manual")
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    for (const ctrl of this.controllers) ctrl.abort()
    this.controllers.clear()
    for (const item of this.disposables) item.dispose()
  }

  private async check(cfg: Config, mode: Mode): Promise<void> {
    const id = this.identity()
    const target = this.target()
    if (!target) {
      const text = "This ChipMate installation does not have a supported internal update target."
      this.deps.log.warn(`[Kilo New] Update check skipped: ${text}`)
      if (mode === "manual") await vscode.window.showWarningMessage(text)
      return
    }
    const url = this.manifestUrl()
    const manifest = await this.fetchManifest(cfg, url)
    const item = manifest.latestByTarget[target]
    if (!item) {
      const text = `No compatible ChipMate update package is available for ${target}.`
      this.deps.log.log(`[Kilo New] Update check: ${text}`)
      if (mode === "manual") await vscode.window.showInformationMessage(text)
      return
    }
    if (item.publisher !== id.publisher || item.name !== id.name) {
      throw new UpdateError(
        "identity",
        `Update package identity ${item.publisher}.${item.name} does not match ${id.publisher}.${id.name}.`,
      )
    }
    if (item.target !== target) {
      throw new UpdateError("target", `Update package target ${item.target} does not match ${target}.`)
    }
    if (item.sizeBytes > cfg.maxDownloadBytes) {
      throw new UpdateError("download-size", `VSIX download is larger than ${cfg.maxDownloadBytes} bytes.`)
    }
    if (compareVersions(item.version, id.version) <= 0) {
      if (mode === "manual") await vscode.window.showInformationMessage("ChipMate is already up to date.")
      return
    }
    await this.update(cfg, mode, id, item, resolvePackageUrl(url, item.url))
  }

  private async update(cfg: Config, mode: Mode, id: Identity, item: Package, url: URL): Promise<void> {
    const key = `${item.target}/${item.version}/${item.sha256.toLowerCase()}`
    const current = this.transactions.get(key)
    if (current?.state === "running") {
      await current.promise.catch(() => undefined)
      return
    }
    if (current?.state === "installed") {
      if (mode === "manual")
        await vscode.window.showInformationMessage("ChipMate update is installed and awaiting reload.")
      return
    }
    if (current?.state === "manual") {
      if (mode === "manual") await this.warning(current.warning)
      return
    }

    const task = this.apply(cfg, id, item, url)
    this.transactions.set(key, { state: "running", promise: task })
    try {
      const result = await task
      if (result === "declined") {
        this.transactions.delete(key)
        return
      }
      const file = this.packagePath(item)
      this.transactions.set(key, { state: "installed", file })
      const reload = await vscode.window.showInformationMessage(
        "ChipMate update installed. Reload Window to finish.",
        RELOAD,
      )
      if (reload === RELOAD) await vscode.commands.executeCommand("workbench.action.reloadWindow")
    } catch (err) {
      if (err instanceof UpdateError && err.kind === "install" && err.file) {
        this.transactions.set(key, { state: "manual", file: err.file, warning: err.warning })
      } else {
        this.transactions.delete(key)
      }
      throw err
    }
  }

  private async apply(cfg: Config, id: Identity, item: Package, url: URL): Promise<"declined" | "installed"> {
    if (!cfg.autoInstall) {
      const choice = await vscode.window.showInformationMessage(
        `ChipMate update ${item.version} is available. Current version: ${id.version}.`,
        INSTALL,
      )
      if (choice !== INSTALL) return "declined"
    }
    const file = await this.download(cfg, item, url)
    await this.install(cfg, file)
    return "installed"
  }

  private manifestUrl(): URL {
    try {
      return new URL(this.deps.updates())
    } catch (err) {
      throw new UpdateError("server", `ChipMate Server update address is invalid: ${message(err)}`)
    }
  }

  private async fetchManifest(cfg: Config, url: URL): Promise<Manifest> {
    const ctrl = this.controller()
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
    try {
      const res = await this.deps.fetch(url.toString(), { signal: ctrl.signal }).catch((err) => {
        throw new UpdateError("availability", `Failed to read update manifest: ${message(err)}`)
      })
      if (!res.ok) {
        const kind = transient(res.status) ? "availability" : "manifest"
        throw new UpdateError(kind, `Failed to read update manifest: HTTP ${res.status}`)
      }
      const raw = await res.json().catch((err) => {
        throw new UpdateError("manifest", `Failed to parse update manifest: ${message(err)}`)
      })
      return parseManifest(raw)
    } finally {
      clearTimeout(timer)
      this.controllers.delete(ctrl)
    }
  }

  private async download(cfg: Config, item: Package, url: URL): Promise<string> {
    const file = this.packagePath(item)
    const dir = path.dirname(file)
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.mkdir(dir, { recursive: true })
    if (await this.valid(file, item)) return file
    await fs.rm(file, { force: true })

    const ctrl = this.controller()
    const header = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
    const total = setTimeout(() => ctrl.abort(), cfg.downloadTimeoutMs)
    try {
      const res = await this.deps.fetch(url.toString(), { signal: ctrl.signal })
      clearTimeout(header)
      if (!res.ok) throw new UpdateError("download", `Failed to download VSIX: HTTP ${res.status}`)
      this.validateLength(res, cfg, item)
      const result = await writeResponse(
        res,
        tmp,
        cfg.maxDownloadBytes,
        item.sizeBytes,
        Math.max(cfg.timeoutMs, DEFAULT_IDLE),
        ctrl,
      )
      if (result.digest.toLowerCase() !== item.sha256.toLowerCase()) {
        throw new UpdateError("sha256", "VSIX sha256 verification failed.")
      }
      await this.verify(tmp, item)
      await fs.rm(file, { force: true })
      await fs.rename(tmp, file)
      return file
    } catch (err) {
      await fs.rm(tmp, { force: true })
      if (err instanceof UpdateError) throw err
      throw new UpdateError("download", `Failed to download VSIX: ${message(err)}`)
    } finally {
      clearTimeout(header)
      clearTimeout(total)
      this.controllers.delete(ctrl)
    }
  }

  private validateLength(res: Response, cfg: Config, item: Package): void {
    const raw = res.headers.get("content-length")
    if (raw === null) return
    const len = Number(raw)
    if (!Number.isSafeInteger(len) || len < 0) throw new UpdateError("download-size", "VSIX Content-Length is invalid.")
    if (len > cfg.maxDownloadBytes) {
      throw new UpdateError("download-size", `VSIX download is larger than ${cfg.maxDownloadBytes} bytes.`)
    }
    if (len !== item.sizeBytes)
      throw new UpdateError("download-size", "VSIX Content-Length does not match the manifest.")
  }

  private async valid(file: string, item: Package): Promise<boolean> {
    try {
      await this.verify(file, item)
      return true
    } catch {
      return false
    }
  }

  private async verify(file: string, item: Package): Promise<void> {
    const stat = await fs.stat(file)
    if (stat.size !== item.sizeBytes) throw new UpdateError("download-size", "VSIX size does not match the manifest.")
    if ((await hashFile(file)).toLowerCase() !== item.sha256.toLowerCase()) {
      throw new UpdateError("sha256", "VSIX sha256 verification failed.")
    }
    const manifest = await readVsixManifest(file).catch((err) => {
      throw new UpdateError("identity", `VSIX package manifest is invalid: ${message(err)}`)
    })
    if (manifest.publisher !== item.publisher || manifest.name !== item.name) {
      throw new UpdateError("identity", "VSIX package identity does not match the update manifest.")
    }
    if (`${manifest.publisher}.${manifest.name}` !== item.extensionId) {
      throw new UpdateError("identity", "VSIX package extensionId does not match the update manifest.")
    }
    if (manifest.version !== item.version) {
      throw new UpdateError("version", "VSIX package version does not match the update manifest.")
    }
    if (manifest.chipmatePackageTarget !== item.target) {
      throw new UpdateError("target", "VSIX package target does not match the update manifest.")
    }
  }

  private packagePath(item: Package): string {
    const dir = path.join(this.context.globalStorageUri.fsPath, "update-check")
    const name = `${safe(item.publisher)}.${safe(item.name)}-${safe(item.version)}.vsix`
    return path.join(dir, name)
  }

  private controller(): AbortController {
    const ctrl = new AbortController()
    this.controllers.add(ctrl)
    return ctrl
  }

  private async install(cfg: Config, file: string): Promise<void> {
    const cmd = `${quote(cfg.codeCliPath)} --install-extension ${quote(file)} --force`
    try {
      await this.deps.exec(cfg.codeCliPath, ["--install-extension", file, "--force"], { timeout: INSTALL_TIMEOUT })
    } catch (err) {
      throw new UpdateError(
        "install",
        `Failed to install VSIX: ${message(err)}`,
        `ChipMate update install failed. You can run this command manually:\n${cmd}\n\n${message(err)}`,
        file,
      )
    }
  }

  private async fail(err: unknown, cfg: Config, mode: Mode): Promise<void> {
    const item = err instanceof UpdateError ? err : new UpdateError("manifest", message(err))
    this.deps.log.warn(`[Kilo New] Update check failed (${item.kind}): ${item.message}`)
    if (mode === "auto" && item.kind === "availability") return
    if (mode === "manual" || this.shouldWarn(item.kind, cfg)) {
      await this.warning(item.warning)
      if (mode === "auto") await this.markWarning(item.kind)
    }
  }

  private async warning(text: string): Promise<void> {
    try {
      await vscode.window.showWarningMessage(text)
    } catch (err) {
      this.deps.log.warn(`[Kilo New] Update check warning notification failed: ${message(err)}`)
    }
  }

  private shouldWarn(kind: Kind, cfg: Config): boolean {
    const warnings = this.context.globalState.get<Record<string, number>>(LAST_WARNING_KEY, {})
    const last = warnings[kind] ?? 0
    if (last <= 0) return true
    return this.deps.now() - last >= intervalMs(cfg)
  }

  private async markWarning(kind: Kind): Promise<void> {
    const warnings = this.context.globalState.get<Record<string, number>>(LAST_WARNING_KEY, {})
    await this.context.globalState.update(LAST_WARNING_KEY, { ...warnings, [kind]: this.deps.now() })
  }

  private autoDue(cfg: Config): boolean {
    const last = this.context.globalState.get<number>(LAST_AUTO_KEY, 0)
    return last <= 0 || this.deps.now() - last >= intervalMs(cfg)
  }

  private schedule(cfg = this.config()): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!cfg.enabled || cfg.intervalHours <= 0) return
    const last = this.context.globalState.get<number>(LAST_AUTO_KEY, 0)
    const wait = last > 0 ? Math.max(0, last + intervalMs(cfg) - this.deps.now()) : intervalMs(cfg)
    this.timer = setTimeout(() => {
      void this.checkAuto()
    }, wait)
  }

  private config(): Config {
    const cfg = vscode.workspace.getConfiguration("chipmate.v2.updateCheck")
    return {
      enabled: cfg.get("enabled", true),
      autoInstall: cfg.get("autoInstall", true),
      checkOnStartup: cfg.get("checkOnStartup", true),
      intervalHours: positive(cfg.get("intervalHours", DEFAULT_INTERVAL), DEFAULT_INTERVAL),
      timeoutMs: positive(cfg.get("timeoutMs", DEFAULT_TIMEOUT), DEFAULT_TIMEOUT),
      downloadTimeoutMs: positive(cfg.get("downloadTimeoutMs", DEFAULT_DOWNLOAD_TIMEOUT), DEFAULT_DOWNLOAD_TIMEOUT),
      codeCliPath: nonempty(cfg.get("codeCliPath", DEFAULT_CODE), DEFAULT_CODE),
      maxDownloadBytes: positive(cfg.get("maxDownloadBytes", DEFAULT_MAX), DEFAULT_MAX),
    }
  }

  private identity(): Identity {
    const raw = this.context.extension.packageJSON as Record<string, unknown>
    return {
      publisher: String(raw.publisher ?? ""),
      name: String(raw.name ?? ""),
      version: String(raw.version ?? "0.0.0"),
    }
  }

  private target(): Target | undefined {
    const raw = this.context.extension.packageJSON as Record<string, unknown>
    const value = target(raw.chipmatePackageTarget)
    if (value) return value
    return hostTarget()
  }
}

export function registerUpdateCheck(context: vscode.ExtensionContext): UpdateCheckService {
  const service = new UpdateCheckService(context)
  context.subscriptions.push(service)
  context.subscriptions.push(
    vscode.commands.registerCommand("chipmate.v2.checkForUpdates", () => service.checkManual()),
  )
  return service
}

export function resolvePackageUrl(base: URL, value: string): URL {
  const text = value.trim()
  if (!text) throw new UpdateError("vsix-url", "Update package URL is empty.")
  if (
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(text) ||
    text.startsWith("//") ||
    text.includes("\\") ||
    text.includes("?") ||
    text.includes("#")
  ) {
    throw new UpdateError("vsix-url", "Update package URL must be a same-origin package path.")
  }
  const path = text.startsWith("/") ? text.slice(1) : text
  const parts = path.split("/")
  const unsafe = parts.some((part) => {
    try {
      const decoded = decodeURIComponent(part)
      return !decoded || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")
    } catch {
      return true
    }
  })
  if (!path.startsWith("packages/") || unsafe) {
    throw new UpdateError("vsix-url", "Update package URL must stay under /packages/.")
  }
  const url = new URL(`/${path}`, base.origin)
  if (!url.pathname.startsWith("/packages/")) {
    throw new UpdateError("vsix-url", "Update package URL must stay under /packages/.")
  }
  return url
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (const index of [0, 1, 2] as const) {
    if (left.main[index] !== right.main[index]) return left.main[index] > right.main[index] ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre > right.pre ? 1 : left.pre < right.pre ? -1 : 0
}

function updateManifestUrl(): string {
  const result = chipmateServerEndpoints()
  if (!result.endpoints)
    throw new UpdateError("server", result.state.error ?? result.state.warning ?? "ChipMate Server is unavailable.")
  return result.endpoints.updates
}

function transient(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function parseManifest(raw: unknown): Manifest {
  if (!record(raw)) throw new UpdateError("manifest", "Update manifest must be a JSON object.")
  if (raw.schemaVersion !== 2) throw new UpdateError("manifest", "Update manifest schemaVersion must be 2.")
  if (!record(raw.latestByTarget)) throw new UpdateError("manifest", "Update manifest latestByTarget is missing.")
  const latestByTarget: Partial<Record<Target, Package>> = {}
  for (const [key, item] of Object.entries(raw.latestByTarget)) {
    const kind = target(key)
    if (!kind) continue
    latestByTarget[kind] = parsePackage(item, kind)
  }
  return { latestByTarget }
}

function parsePackage(value: unknown, expected: Target): Package {
  if (!record(value)) throw new UpdateError("manifest", `Update package for ${expected} must be an object.`)
  const extensionId = string(value.extensionId)
  const publisher = string(value.publisher)
  const name = string(value.name)
  const version = string(value.version)
  const targetValue = target(value.target)
  const url = string(value.url)
  const sha256 = string(value.sha256)
  const sizeBytes = number(value.sizeBytes)
  if (!extensionId || !publisher || !name || !version || !targetValue || !url || !sha256 || !sizeBytes) {
    throw new UpdateError("manifest", `Update package for ${expected} is incomplete.`)
  }
  if (extensionId !== `${publisher}.${name}`)
    throw new UpdateError("manifest", "Update package extension identity is invalid.")
  if (targetValue !== expected) throw new UpdateError("manifest", `Update package target does not match ${expected}.`)
  if (!parseVersion(version)) throw new UpdateError("version", `Update package version is invalid: ${version}.`)
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) throw new UpdateError("manifest", "Update package sha256 is invalid.")
  return { extensionId, publisher, name, version, target: targetValue, url, sha256, sizeBytes }
}

function hostTarget(): Target | undefined {
  if (process.platform === "win32" && process.arch === "x64") return "win32-x64-baseline"
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64-baseline"
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64"
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64"
  return undefined
}

function target(value: unknown): Target | undefined {
  return typeof value === "string" && (TARGETS as readonly string[]).includes(value) ? (value as Target) : undefined
}

async function writeResponse(
  res: Response,
  file: string,
  max: number,
  expected: number,
  timeout: number,
  ctrl: AbortController,
): Promise<{ digest: string; size: number }> {
  if (!res.body) throw new UpdateError("download", "VSIX download response has no body.")
  const hash = createHash("sha256")
  const handle = await fs.open(file, "w")
  const reader = res.body.getReader()
  let size = 0
  let idle: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("VSIX download was aborted."))
    ctrl.signal.addEventListener("abort", abort, { once: true })
    if (ctrl.signal.aborted) abort()
  })
  const reset = () => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => ctrl.abort(), timeout)
  }
  try {
    reset()
    while (true) {
      const chunk = await Promise.race([reader.read(), stopped])
      if (chunk.done) break
      reset()
      size += chunk.value.byteLength
      if (size > max) throw new UpdateError("download-size", `VSIX download is larger than ${max} bytes.`)
      if (size > expected) throw new UpdateError("download-size", "VSIX size does not match the manifest.")
      hash.update(chunk.value)
      const data = Buffer.from(chunk.value)
      let offset = 0
      while (offset < data.length) {
        const result = await handle.write(data, offset, data.length - offset)
        if (result.bytesWritten <= 0) throw new UpdateError("download", "Failed to write the complete VSIX download.")
        offset += result.bytesWritten
      }
    }
    if (size !== expected) throw new UpdateError("download-size", "VSIX size does not match the manifest.")
  } finally {
    if (idle) clearTimeout(idle)
    if (abort) ctrl.signal.removeEventListener("abort", abort)
    if (ctrl.signal.aborted) await reader.cancel().catch(() => undefined)
    await handle.close()
  }
  return { digest: hash.digest("hex"), size }
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(file)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

function parseVersion(value: string): { main: [number, number, number]; pre: string } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) return undefined
  return {
    main: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? "",
  }
}

function intervalMs(cfg: Config): number {
  return cfg.intervalHours * 60 * 60 * 1000
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}

function nonempty(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function message(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function quote(value: string): string {
  return process.platform === "win32" ? `"${value.replace(/"/g, '\\"')}"` : `'${value.replace(/'/g, "'\\''")}'`
}
