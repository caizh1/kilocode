import * as vscode from "vscode"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createHash } from "node:crypto"
import type { ExecFileOptionsWithStringEncoding } from "node:child_process"
import { exec as run } from "../../util/process"

export const LAST_AUTO_KEY = "kilo.updateCheck.lastAutoCheckMs"
export const LAST_MANUAL_KEY = "kilo.updateCheck.lastManualCheckMs"
export const LAST_WARNING_KEY = "kilo.updateCheck.lastWarningMs"

const DEFAULT_BASE = "http://10.10.5.22/vscode-plugins/chipmate/"
const DEFAULT_MANIFEST = "latest.json"
const DEFAULT_INTERVAL = 24
const DEFAULT_TIMEOUT = 10_000
const DEFAULT_CODE = "code"
const DEFAULT_MAX = 209_715_200
const INSTALL = "Install Update"
const RELOAD = "Reload Window"

type Mode = "auto" | "manual"
type Kind =
  | "manifest"
  | "manifest-url"
  | "identity"
  | "version"
  | "vsix-url"
  | "download"
  | "download-size"
  | "sha256"
  | "install"

type Manifest = {
  publisher: string
  name: string
  version: string
  vsix: string
  sha256?: string
  releaseNotes?: string
  mandatory?: boolean
}

type Config = {
  enabled: boolean
  baseUrl: string
  manifestFile: string
  checkOnStartup: boolean
  intervalHours: number
  timeoutMs: number
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
  log: Pick<Console, "log" | "warn" | "error">
}

class UpdateError extends Error {
  constructor(
    readonly kind: Kind,
    message: string,
    readonly warning = message,
  ) {
    super(message)
  }
}

export class UpdateCheckService implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly disposables: vscode.Disposable[] = []
  private readonly deps: Deps

  constructor(
    private readonly context: vscode.ExtensionContext,
    deps: Partial<Deps> = {},
  ) {
    this.deps = {
      fetch: deps.fetch ?? fetch,
      exec: deps.exec ?? run,
      now: deps.now ?? Date.now,
      log: deps.log ?? console,
    }
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("kilo.updateCheck")) this.schedule()
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
    for (const item of this.disposables) item.dispose()
  }

  private async check(cfg: Config, mode: Mode): Promise<void> {
    const id = this.identity()
    const manifest = await this.fetchManifest(cfg)
    if (manifest.publisher !== id.publisher || manifest.name !== id.name) {
      this.deps.log.log(
        `[Kilo New] Update check ignored: manifest identity ${manifest.publisher}.${manifest.name} does not match ${id.publisher}.${id.name}`,
      )
      return
    }
    const newer = compareVersions(manifest.version, id.version) > 0
    if (!newer) {
      if (mode === "manual") await vscode.window.showInformationMessage("ChipMate is already up to date.")
      return
    }
    const url = resolveRelativeUrl(cfg.baseUrl, manifest.vsix, "vsix-url")
    const detail = manifest.releaseNotes ? String(manifest.releaseNotes) : undefined
    const text = manifest.mandatory
      ? `A required ChipMate update ${manifest.version} is available. Current version: ${id.version}.`
      : `ChipMate update ${manifest.version} is available. Current version: ${id.version}.`
    const choice = await vscode.window.showInformationMessage(
      text,
      { modal: manifest.mandatory === true, detail },
      INSTALL,
    )
    if (choice !== INSTALL) return

    const file = await this.download(cfg, manifest, url)
    await this.install(cfg, file)
    const reload = await vscode.window.showInformationMessage("ChipMate update installed. Reload Window to finish.", RELOAD)
    if (reload === RELOAD) await vscode.commands.executeCommand("workbench.action.reloadWindow")
  }

  private async fetchManifest(cfg: Config): Promise<Manifest> {
    const url = resolveRelativeUrl(cfg.baseUrl, cfg.manifestFile, "manifest-url")
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
    try {
      const res = await this.deps.fetch(url.toString(), { signal: ctrl.signal })
      if (!res.ok) throw new UpdateError("manifest", `Failed to read latest.json: HTTP ${res.status}`)
      return parseManifest(await res.json())
    } catch (err) {
      if (err instanceof UpdateError) throw err
      throw new UpdateError("manifest", `Failed to read latest.json: ${message(err)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  private async download(cfg: Config, manifest: Manifest, url: URL): Promise<string> {
    const dir = path.join(this.context.globalStorageUri.fsPath, "update-check")
    const name = `${safe(manifest.publisher)}.${safe(manifest.name)}-${safe(manifest.version)}.vsix`
    const file = path.join(dir, name)
    const tmp = `${file}.tmp`
    await fs.mkdir(dir, { recursive: true })
    await fs.rm(tmp, { force: true })

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
    try {
      const res = await this.deps.fetch(url.toString(), { signal: ctrl.signal })
      if (!res.ok) throw new UpdateError("download", `Failed to download VSIX: HTTP ${res.status}`)
      const len = Number(res.headers.get("content-length") ?? "0")
      if (Number.isFinite(len) && len > cfg.maxDownloadBytes) {
        throw new UpdateError("download-size", `VSIX download is larger than ${cfg.maxDownloadBytes} bytes.`)
      }
      const digest = await writeResponse(res, tmp, cfg.maxDownloadBytes)
      if (manifest.sha256 && digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
        throw new UpdateError("sha256", "VSIX sha256 verification failed.")
      }
      await fs.rename(tmp, file)
      return file
    } catch (err) {
      await fs.rm(tmp, { force: true })
      if (err instanceof UpdateError) throw err
      throw new UpdateError("download", `Failed to download VSIX: ${message(err)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  private async install(cfg: Config, file: string): Promise<void> {
    const cmd = `${quote(cfg.codeCliPath)} --install-extension ${quote(file)} --force`
    try {
      await this.deps.exec(cfg.codeCliPath, ["--install-extension", file, "--force"], { timeout: 120_000 })
    } catch (err) {
      throw new UpdateError(
        "install",
        `Failed to install VSIX: ${message(err)}`,
        `ChipMate update install failed. You can run this command manually:\n${cmd}\n\n${message(err)}`,
      )
    }
  }

  private async fail(err: unknown, cfg: Config, mode: Mode): Promise<void> {
    const item = err instanceof UpdateError ? err : new UpdateError("manifest", message(err))
    this.deps.log.warn(`[Kilo New] Update check failed (${item.kind}): ${item.message}`)
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
    const cfg = vscode.workspace.getConfiguration("kilo.updateCheck")
    return {
      enabled: cfg.get("enabled", true),
      baseUrl: cfg.get("baseUrl", DEFAULT_BASE),
      manifestFile: cfg.get("manifestFile", DEFAULT_MANIFEST),
      checkOnStartup: cfg.get("checkOnStartup", true),
      intervalHours: positive(cfg.get("intervalHours", DEFAULT_INTERVAL), DEFAULT_INTERVAL),
      timeoutMs: positive(cfg.get("timeoutMs", DEFAULT_TIMEOUT), DEFAULT_TIMEOUT),
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
}

export function registerUpdateCheck(context: vscode.ExtensionContext): UpdateCheckService {
  const service = new UpdateCheckService(context)
  context.subscriptions.push(service)
  context.subscriptions.push(vscode.commands.registerCommand("kilo-code.new.checkForUpdates", () => service.checkManual()))
  return service
}

export function resolveRelativeUrl(base: string, value: string, kind: "manifest-url" | "vsix-url"): URL {
  const text = value.trim()
  if (!text) throw new UpdateError(kind, "Update manifest path is empty.")
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(text) || text.startsWith("//")) {
    throw new UpdateError(kind, "Update manifest path must be relative.")
  }
  if (text.startsWith("/") || text.includes("\\") || text.includes("?") || text.includes("#")) {
    throw new UpdateError(kind, "Update manifest path must be a plain relative path.")
  }
  const parts = text.split("/")
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new UpdateError(kind, "Update manifest path must not escape the update base URL.")
  }
  return new URL(text, ensureSlash(base))
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (const i of [0, 1, 2] as const) {
    if (left.main[i] !== right.main[i]) return left.main[i] > right.main[i] ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre > right.pre ? 1 : left.pre < right.pre ? -1 : 0
}

async function writeResponse(res: Response, file: string, max: number): Promise<string> {
  if (!res.body) throw new UpdateError("download", "VSIX download response has no body.")
  const hash = createHash("sha256")
  const handle = await fs.open(file, "w")
  const reader = res.body.getReader()
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > max) throw new UpdateError("download-size", `VSIX download is larger than ${max} bytes.`)
      hash.update(chunk.value)
      await handle.write(Buffer.from(chunk.value))
    }
  } finally {
    await handle.close()
  }
  return hash.digest("hex")
}

function parseManifest(value: unknown): Manifest {
  if (!record(value)) throw new UpdateError("manifest", "latest.json must be a JSON object.")
  const publisher = string(value.publisher)
  const name = string(value.name)
  const version = string(value.version)
  const vsix = string(value.vsix)
  if (!publisher || !name || !version || !vsix) {
    throw new UpdateError("manifest", "latest.json is missing publisher, name, version, or vsix.")
  }
  const sha = string(value.sha256)
  if (sha && !/^[a-fA-F0-9]{64}$/.test(sha)) throw new UpdateError("manifest", "latest.json sha256 is invalid.")
  return {
    publisher,
    name,
    version,
    vsix,
    sha256: sha || undefined,
    releaseNotes: string(value.releaseNotes) || undefined,
    mandatory: value.mandatory === true,
  }
}

function parseVersion(value: string): { main: [number, number, number]; pre: string } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) return undefined
  return {
    main: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? "",
  }
}

function ensureSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
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

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function quote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}
