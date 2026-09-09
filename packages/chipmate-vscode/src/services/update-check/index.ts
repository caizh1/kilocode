import { diagnostic } from "../diagnostics/record"
import * as vscode from "vscode"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { chipmateServerEndpoints } from "../chipmate-server"
import {
  CHIPMATE_UPDATE_TARGETS,
  sanitize,
  type ChipmateUpdateResult,
  type ChipmateUpdateTarget,
} from "../../shared/update-check"
import { installDetail, installInCurrentProfile } from "./install"
import { compareVersions, parseVersion } from "./version"
export { compareVersions } from "./version"
import { readVsixManifest } from "./vsix"
import {
  markPendingUpdateReloadRequested,
  writePendingUpdateActivation,
  type PendingUpdateActivation,
} from "./activation"

export const LAST_AUTO_KEY = "chipmate.v2.updateCheck.lastAutoCheckMs"
export const LAST_MANUAL_KEY = "chipmate.v2.updateCheck.lastManualCheckMs"
export const LAST_WARNING_KEY = "chipmate.v2.updateCheck.lastWarningMs"

const DEFAULT_INTERVAL = 24
const DEFAULT_TIMEOUT = 30_000
const DEFAULT_DOWNLOAD_TIMEOUT = 15 * 60_000
const DEFAULT_MAX = 536_870_912
const DEFAULT_IDLE = 60_000
const CANDIDATE_TIMEOUT = 30 * 60_000
const INSTALL_AND_RELOAD = "Install and Reload Window"
const RETRY_RELOAD = "Retry Reload Window"
const SHOW_LOG = "View Update Log"
const RELEASE_NOTES = "View Release Notes"

type Mode = "auto" | "manual"
type Target = ChipmateUpdateTarget
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
  | "receipt"
  | "reload"

type Package = {
  extensionId: string
  publisher: string
  name: string
  version: string
  target: Target
  url: string
  sha256: string
  sizeBytes: number
  releaseNotes?: string
  publishedAt?: string
}

type Manifest = {
  latestByTarget: Partial<Record<Target, Package>>
}

type Config = {
  enabled: boolean
  autoDownload: boolean
  checkOnStartup: boolean
  intervalHours: number
  timeoutMs: number
  downloadTimeoutMs: number
  maxDownloadBytes: number
}

type Identity = {
  publisher: string
  name: string
  version: string
}

export type UpdateLog = Pick<Console, "log" | "warn" | "error"> & {
  show?: () => void
  dispose?: () => void
}

type Deps = {
  fetch: typeof fetch
  install: (file: string) => Promise<void>
  now: () => number
  updates: () => string
  log: UpdateLog
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
  | { state: "preparing"; promise: Promise<string> }
  | { state: "prepared"; file: string }
  | { state: "installing"; promise: Promise<void>; file: string }
  | { state: "installed"; file: string }

type Candidate = {
  id: string
  currentVersion: string
  item: Package
  url: URL
  source: string
  createdAt: number
}

type Probe =
  | { status: "latest"; currentVersion: string; checkedAt: number; target: Target }
  | { status: "available"; currentVersion: string; target: Target; item: Package; url: URL }

export class UpdateCheckService implements vscode.Disposable {
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly disposables: vscode.Disposable[] = []
  private readonly controllers = new Set<AbortController>()
  private readonly transactions = new Map<string, Transaction>()
  private readonly reloads = new Map<string, Promise<void>>()
  private readonly candidates = new Map<string, Candidate>()
  private readonly deps: Deps
  private readonly owns: boolean

  constructor(
    private readonly context: vscode.ExtensionContext,
    deps: Partial<Deps> = {},
  ) {
    this.owns = !deps.log
    this.deps = {
      fetch: deps.fetch ?? fetch,
      install: deps.install ?? installInCurrentProfile,
      now: deps.now ?? Date.now,
      updates: deps.updates ?? updateManifestUrl,
      log: deps.log ?? createUpdateLog(),
    }
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("chipmate.v2.updateCheck") ||
          event.affectsConfiguration("chipmate.v2.chipmateServer")
        ) {
          this.candidates.clear()
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
      this.info("自动检查已跳过：更新检查已禁用。")
      this.schedule(cfg)
      return
    }
    if (!this.autoDue(cfg)) {
      this.info("自动检查已跳过：尚未到达检查间隔。")
      this.schedule(cfg)
      return
    }
    this.info("开始自动检查更新。")
    await this.context.globalState.update(LAST_AUTO_KEY, this.deps.now())
    try {
      const result = await this.probe(cfg)
      if (result.status === "available") await this.offer(cfg, result)
    } catch (err) {
      await this.fail(err, cfg, "auto")
    } finally {
      this.schedule()
    }
  }

  async checkManual(): Promise<void> {
    const result = await this.probeManual()
    if (result.status === "error") {
      await this.warning(result.message)
      return
    }
    if (result.status === "latest") {
      await vscode.window.showInformationMessage("ChipMate is already up to date.")
      return
    }
    if (result.status !== "available") return
    const install = await this.promptInstallAndReload(
      `ChipMate update ${result.version} is available. Current version: ${result.currentVersion}.`,
      result,
    )
    if (!install) return
    const installed = await this.installManual(result.candidateId)
    if (installed.status === "error") {
      if (installed.code !== "reload") await this.warning(installed.message)
      return
    }
  }

  async probeManual(): Promise<ChipmateUpdateResult> {
    const cfg = this.config()
    if (!cfg.enabled) return this.error(new UpdateError("server", "ChipMate update checks are disabled."))
    this.info("开始手动检查更新。")
    try {
      await this.context.globalState.update(LAST_MANUAL_KEY, this.deps.now())
      const result = await this.probe(cfg)
      if (result.status === "latest") return result
      const id = randomUUID()
      this.pruneCandidates()
      this.candidates.set(id, {
        id,
        currentVersion: result.currentVersion,
        item: result.item,
        url: result.url,
        source: this.manifestUrl().toString(),
        createdAt: this.deps.now(),
      })
      return {
        status: "available",
        candidateId: id,
        currentVersion: result.currentVersion,
        version: result.item.version,
        target: result.target,
        ...(result.item.releaseNotes ? { releaseNotes: result.item.releaseNotes } : {}),
        ...(result.item.publishedAt ? { publishedAt: result.item.publishedAt } : {}),
      }
    } catch (err) {
      const result = this.error(err)
      this.warn(`手动检查失败（${result.code}）：${result.message}`)
      return result
    }
  }

  async installManual(id: string): Promise<ChipmateUpdateResult> {
    const current = this.candidates.get(id)
    if (!current) return this.error(new UpdateError("manifest", "Update candidate expired. Check for updates again."))
    if (this.deps.now() - current.createdAt > CANDIDATE_TIMEOUT) {
      this.candidates.delete(id)
      return this.error(new UpdateError("manifest", "Update candidate expired. Check for updates again."))
    }
    try {
      if (current.source !== this.manifestUrl().toString()) {
        this.candidates.clear()
        throw new UpdateError("server", "ChipMate Server changed. Check for updates again.")
      }
      const identity = this.identity()
      const target = this.target()
      if (identity.version !== current.currentVersion || target !== current.item.target) {
        this.candidates.delete(id)
        throw new UpdateError("identity", "This ChipMate installation changed. Check for updates again.")
      }
      await this.installAndReload(this.config(), current.item, current.url)
      return { status: "installed", version: current.item.version }
    } catch (err) {
      const result = this.error(err)
      this.warn(`手动安装失败（${result.code}）：${result.message}`)
      return result
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    for (const ctrl of this.controllers) ctrl.abort()
    this.controllers.clear()
    this.candidates.clear()
    this.reloads.clear()
    for (const item of this.disposables) item.dispose()
    if (this.owns) this.deps.log.dispose?.()
  }

  showLog(): void {
    this.deps.log.show?.()
  }

  private async probe(cfg: Config): Promise<Probe> {
    const id = this.identity()
    const target = this.target()
    if (!target) {
      throw new UpdateError("target", "This ChipMate installation does not have a supported internal update target.")
    }
    const url = this.manifestUrl()
    this.info(`检查环境：当前版本 ${id.version}，目标平台 ${target}，清单地址 ${safeUrl(url)}。`)
    const manifest = await this.fetchManifest(cfg, url)
    const item = manifest.latestByTarget[target]
    if (!item) {
      this.info(`清单检查完成：目标平台 ${target} 没有候选版本。`)
      return { status: "latest", currentVersion: id.version, checkedAt: this.deps.now(), target }
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
      this.info(`清单检查完成：候选版本 ${item.version} 不高于当前版本 ${id.version}。`)
      return { status: "latest", currentVersion: id.version, checkedAt: this.deps.now(), target }
    }
    this.info(`发现候选版本：${item.version}，目标平台 ${item.target}，大小 ${item.sizeBytes} 字节。`)
    return { status: "available", currentVersion: id.version, target, item, url: resolvePackageUrl(url, item.url) }
  }

  private async offer(cfg: Config, result: Extract<Probe, { status: "available" }>): Promise<void> {
    if (cfg.autoDownload) {
      await this.prepare(cfg, result.item, result.url)
      this.info(`版本 ${result.item.version} 已下载并校验，等待用户确认安装并重载窗口。`)
    }
    const install = await this.promptInstallAndReload(
      `ChipMate update ${result.item.version} is available. Current version: ${result.currentVersion}.`,
      result.item,
    )
    if (!install) return
    await this.installAndReload(cfg, result.item, result.url)
  }

  private async promptInstallAndReload(
    message: string,
    release: Pick<Package, "version" | "releaseNotes">,
  ): Promise<boolean> {
    const notice = releaseNotice(message, release.releaseNotes)
    const choice = release.releaseNotes
      ? await vscode.window.showInformationMessage(notice, RELEASE_NOTES, INSTALL_AND_RELOAD)
      : await vscode.window.showInformationMessage(notice, INSTALL_AND_RELOAD)
    if (choice === INSTALL_AND_RELOAD) return true
    if (choice !== RELEASE_NOTES || !release.releaseNotes) return false
    await this.showReleaseNotes(release.version, release.releaseNotes)
    return (
      (await vscode.window.showInformationMessage(
        `ChipMate update ${release.version} is ready to install and reload the window.`,
        INSTALL_AND_RELOAD,
      )) === INSTALL_AND_RELOAD
    )
  }

  private async showReleaseNotes(version: string, notes: string): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument({ language: "markdown", content: notes })
      await vscode.window.showTextDocument(document, { preview: true })
      this.info(`已打开版本 ${version} 的更新说明。`)
    } catch (err) {
      this.warn(`无法打开版本 ${version} 的更新说明：${message(err)}`)
      await this.warning("Failed to open ChipMate release notes.")
    }
  }

  private async prepare(cfg: Config, item: Package, url: URL): Promise<string> {
    const key = `${item.target}/${item.version}/${item.sha256.toLowerCase()}`
    const current = this.transactions.get(key)
    if (current?.state === "preparing") {
      this.info(`更新下载事务已在运行：复用版本 ${item.version} 的校验结果。`)
      return current.promise
    }
    if (current?.state === "installing") {
      await current.promise
      return current.file
    }
    if (current?.state === "installed") return current.file
    if (current?.state === "prepared") {
      try {
        await this.verify(current.file, item)
        this.info(`复用已校验的 VSIX：${path.basename(current.file)}。`)
        return current.file
      } catch (err) {
        this.transactions.delete(key)
        this.warn(`缓存 VSIX 重新校验失败，将重新下载：${message(err)}`)
      }
    }

    const task = this.download(cfg, item, url)
    this.transactions.set(key, { state: "preparing", promise: task })
    try {
      const file = await task
      this.transactions.set(key, { state: "prepared", file })
      return file
    } catch (err) {
      this.transactions.delete(key)
      throw err
    }
  }

  private async apply(cfg: Config, item: Package, url: URL): Promise<void> {
    const key = `${item.target}/${item.version}/${item.sha256.toLowerCase()}`
    const before = this.transactions.get(key)
    if (before?.state === "installed") return
    if (before?.state === "installing") return before.promise

    const file = await this.prepare(cfg, item, url)
    const current = this.transactions.get(key)
    if (current?.state === "installed") return
    if (current?.state === "installing") return current.promise

    const fromVersion = this.identity().version
    const task = this.install(file).then(() => {
      this.ensureActive()
      return this.rememberPendingActivation(item, fromVersion)
    })
    this.transactions.set(key, { state: "installing", promise: task, file })
    try {
      await task
      this.transactions.set(key, { state: "installed", file })
    } catch (err) {
      this.transactions.set(key, { state: "prepared", file })
      throw err
    }
  }

  private async installAndReload(cfg: Config, item: Package, url: URL): Promise<void> {
    const key = `${item.target}/${item.version}/${item.sha256.toLowerCase()}`
    const current = this.reloads.get(key)
    if (current) {
      this.info(`版本 ${item.version} 的安装并重载事务已在运行或完成，复用现有结果。`)
      return current
    }
    this.ensureActive()
    const task = this.apply(cfg, item, url).then(async () => {
      this.ensureActive()
      this.info(`版本 ${item.version} 已安装，立即请求完整窗口重载。`)
      await this.requestReload(item.version)
    })
    this.reloads.set(key, task)
    try {
      await task
    } catch (err) {
      this.reloads.delete(key)
      throw err
    }
  }

  private async requestReload(version: string): Promise<void> {
    while (true) {
      this.ensureActive()
      let pending: PendingUpdateActivation | undefined
      try {
        pending = await markPendingUpdateReloadRequested(this.context, this.deps.now())
      } catch (err) {
        const detail = message(err)
        this.errorLog(`更新激活回执写入失败：${detail}`)
        throw new UpdateError(
          "receipt",
          `Failed to record the ChipMate update activation receipt: ${detail}`,
          "ChipMate installed the update but could not record its activation receipt. Open the update log before reloading.",
        )
      }
      if (!pending) {
        this.errorLog("更新激活回执缺失，已阻止无回执的窗口重载。")
        throw new UpdateError(
          "receipt",
          "ChipMate update activation receipt is missing.",
          "ChipMate installed the update but its activation receipt is missing. Check for updates again before reloading.",
        )
      }
      this.ensureActive()
      this.info(`已请求完整窗口重载以激活版本 ${pending.expectedVersion}（尝试 ${pending.reloadAttempts ?? 1}）。`)
      try {
        await vscode.commands.executeCommand("workbench.action.reloadWindow")
        return
      } catch (err) {
        const detail = message(err)
        this.warn(`VS Code 取消或拒绝完整窗口重载：${detail}`)
        const choice = await this.warning(
          `ChipMate ${version} is installed, but VS Code canceled the full window reload.`,
          RETRY_RELOAD,
          SHOW_LOG,
        )
        if (choice === RETRY_RELOAD) continue
        if (choice === SHOW_LOG) this.showLog()
        throw new UpdateError(
          "reload",
          `VS Code canceled the full window reload: ${detail}`,
          `ChipMate ${version} is installed, but VS Code canceled the full window reload. Retry Reload Window or open the update log.`,
        )
      }
    }
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
      const manifest = parseManifest(raw)
      this.info(`清单请求成功：${safeUrl(url)}。`)
      return manifest
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
    if (await this.valid(file, item)) {
      this.info(`命中已校验的 VSIX 缓存：${path.basename(file)}。`)
      return file
    }
    await fs.rm(file, { force: true })

    this.info(`开始下载 VSIX：版本 ${item.version}，地址 ${safeUrl(url)}。`)
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
      this.info(`VSIX 下载完成：实际 ${result.size} 字节。`)
      if (result.digest.toLowerCase() !== item.sha256.toLowerCase()) {
        throw new UpdateError("sha256", "VSIX sha256 verification failed.")
      }
      this.info(`SHA-256 校验通过：${result.digest.toLowerCase()}。`)
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
    this.info(
      `VSIX 身份校验通过：${manifest.publisher}.${manifest.name} ${manifest.version}，目标 ${manifest.chipmatePackageTarget}。`,
    )
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

  private pruneCandidates(): void {
    for (const [id, item] of this.candidates) {
      if (this.deps.now() - item.createdAt > CANDIDATE_TIMEOUT) this.candidates.delete(id)
    }
  }

  private async install(file: string): Promise<void> {
    this.ensureActive()
    const start = this.deps.now()
    try {
      this.info(`开始安装：使用当前窗口的 VS Code 扩展安装服务，文件 ${file}。`)
      await this.deps.install(file)
      this.ensureActive()
      this.info(`当前窗口的扩展安装服务已完成，耗时 ${this.deps.now() - start} 毫秒；等待重载确认运行版本。`)
    } catch (err) {
      const detail = installDetail(err)
      this.errorLog(`安装阶段未完成：${detail}`)
      throw new UpdateError(
        "install",
        `Failed to install VSIX in the current profile: ${detail}`,
        `ChipMate update was not confirmed in the current profile. The verified VSIX was kept.\n${detail}`,
        file,
      )
    }
  }

  private ensureActive(): void {
    if (this.disposed) throw new UpdateError("install", "The update window was closed or its profile changed.")
  }

  private async rememberPendingActivation(item: Package, fromVersion: string): Promise<void> {
    const pending: PendingUpdateActivation = {
      schemaVersion: 1,
      transactionId: randomUUID(),
      extensionId: item.extensionId,
      fromVersion,
      expectedVersion: item.version,
      target: item.target,
      sha256: item.sha256.toLowerCase(),
      installedAt: this.deps.now(),
    }
    try {
      await writePendingUpdateActivation(this.context, pending)
    } catch (err) {
      const detail = message(err)
      this.errorLog(`更新激活回执写入失败：${detail}`)
      throw new UpdateError(
        "receipt",
        `Failed to record the ChipMate update activation receipt: ${detail}`,
        "ChipMate installed the update but could not record its activation receipt. Open the update log before reloading.",
      )
    }
    this.info(`已记录更新激活收据：目标版本 ${item.version}，目标平台 ${item.target}。`)
  }

  private async fail(err: unknown, cfg: Config, mode: Mode): Promise<void> {
    const item = err instanceof UpdateError ? err : new UpdateError("manifest", message(err))
    this.warn(`更新检查失败（${item.kind}）：${item.message}`)
    if (item.kind === "reload") return
    if (mode === "auto" && item.kind === "availability") return
    if (mode === "manual" || this.shouldWarn(item.kind, cfg)) {
      await this.warning(item.warning)
      if (mode === "auto") await this.markWarning(item.kind)
    }
  }

  private async warning(text: string, ...items: string[]): Promise<string | undefined> {
    if (this.disposed) return undefined
    try {
      return await vscode.window.showWarningMessage(text, ...items)
    } catch (err) {
      this.warn(`更新警告通知显示失败：${message(err)}`)
      return undefined
    }
  }

  private info(text: string): void {
    this.deps.log.log(`[ChipMate New] ${text}`)
  }

  private warn(text: string): void {
    this.deps.log.warn(`[ChipMate New] ${text}`)
  }

  private errorLog(text: string): void {
    this.deps.log.error(`[ChipMate New] ${text}`)
  }

  private error(err: unknown): Extract<ChipmateUpdateResult, { status: "error" }> {
    const item = err instanceof UpdateError ? err : new UpdateError("manifest", message(err))
    return {
      status: "error",
      code: item.kind,
      message: item.message,
      retryable: ["availability", "server", "download", "install", "receipt", "reload"].includes(item.kind),
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
    if (this.disposed || !cfg.enabled || cfg.intervalHours <= 0) return
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
      autoDownload: updateAutoDownload(cfg),
      checkOnStartup: cfg.get("checkOnStartup", true),
      intervalHours: positive(cfg.get("intervalHours", DEFAULT_INTERVAL), DEFAULT_INTERVAL),
      timeoutMs: positive(cfg.get("timeoutMs", DEFAULT_TIMEOUT), DEFAULT_TIMEOUT),
      downloadTimeoutMs: positive(cfg.get("downloadTimeoutMs", DEFAULT_DOWNLOAD_TIMEOUT), DEFAULT_DOWNLOAD_TIMEOUT),
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

let active: UpdateCheckService | undefined

export function getUpdateCheckService(): UpdateCheckService | undefined {
  return active
}

export function registerUpdateCheck(context: vscode.ExtensionContext, log?: UpdateLog): UpdateCheckService {
  const service = new UpdateCheckService(context, log ? { log } : {})
  active = service
  context.subscriptions.push({
    dispose: () => {
      if (active === service) active = undefined
      service.dispose()
    },
  })
  context.subscriptions.push(
    vscode.commands.registerCommand("chipmate.v2.checkForUpdates", () => service.checkManual()),
    vscode.commands.registerCommand("chipmate.v2.showUpdateLog", () => service.showLog()),
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

function updateManifestUrl(): string {
  const result = chipmateServerEndpoints()
  if (!result.endpoints)
    throw new UpdateError("server", result.state.error ?? result.state.warning ?? "ChipMate Server is unavailable.")
  return result.endpoints.updates
}

export function createUpdateLog(): UpdateLog {
  const channel = vscode.window.createOutputChannel("ChipMate 更新", { log: true })
  const emit = (level: "info" | "warn" | "error", value: unknown) => {
    diagnostic("更新阶段", { message: String(value) }, level === "error" ? "ERROR" : level === "warn" ? "WARN" : "INFO", "update")
    const raw = sanitize(String(value).replace(/^\[ChipMate New\]\s*/, ""))
    for (const line of raw.split(/\r?\n/)) {
      channel[level](`[ChipMate New] [${new Date().toISOString()}] ${line}`)
    }
  }
  return {
    log: (value) => emit("info", value),
    warn: (value) => emit("warn", value),
    error: (value) => emit("error", value),
    show: () => channel.show(true),
    dispose: () => channel.dispose(),
  }
}

export function updateAutoDownload(cfg: vscode.WorkspaceConfiguration): boolean {
  const current = explicitBoolean(cfg, "autoDownload")
  if (current !== undefined) return current
  return explicitBoolean(cfg, "autoInstall") ?? true
}

function explicitBoolean(cfg: vscode.WorkspaceConfiguration, key: string): boolean | undefined {
  const value = cfg.inspect<boolean>(key)
  if (!value) return
  return (
    value.workspaceFolderLanguageValue ??
    value.workspaceLanguageValue ??
    value.globalLanguageValue ??
    value.workspaceFolderValue ??
    value.workspaceValue ??
    value.globalValue
  )
}

function safeUrl(url: URL): string {
  return `${url.origin}${url.pathname}`
}

function clip(value: string): string {
  return value.length > 4_096 ? `${value.slice(0, 4_096)}…` : value
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
  const releaseNotes = parseReleaseNotes(value.releaseNotes)
  const publishedAt = parsePublishedAt(value.publishedAt)
  if (!extensionId || !publisher || !name || !version || !targetValue || !url || !sha256 || !sizeBytes) {
    throw new UpdateError("manifest", `Update package for ${expected} is incomplete.`)
  }
  if (extensionId !== `${publisher}.${name}`)
    throw new UpdateError("manifest", "Update package extension identity is invalid.")
  if (targetValue !== expected) throw new UpdateError("manifest", `Update package target does not match ${expected}.`)
  if (!parseVersion(version)) throw new UpdateError("version", `Update package version is invalid: ${version}.`)
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) throw new UpdateError("manifest", "Update package sha256 is invalid.")
  return {
    extensionId,
    publisher,
    name,
    version,
    target: targetValue,
    url,
    sha256,
    sizeBytes,
    ...(releaseNotes ? { releaseNotes } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  }
}

function hostTarget(): Target | undefined {
  if (process.platform === "win32" && process.arch === "x64") return "win32-x64-baseline"
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64-baseline"
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64"
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64"
  return undefined
}

function target(value: unknown): Target | undefined {
  return typeof value === "string" && (CHIPMATE_UPDATE_TARGETS as readonly string[]).includes(value)
    ? (value as Target)
    : undefined
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

function intervalMs(cfg: Config): number {
  return cfg.intervalHours * 60 * 60 * 1000
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function parseReleaseNotes(value: unknown): string {
  const notes = typeof value === "string" ? value.trim() : ""
  if (notes && (Buffer.byteLength(notes, "utf8") > 65_536 || notes.includes("\0"))) {
    throw new UpdateError("manifest", "Update release notes are invalid.")
  }
  return notes
}

function parsePublishedAt(value: unknown): string {
  const date = string(value)
  if (date && Number.isNaN(Date.parse(date))) {
    throw new UpdateError("manifest", "Update publication date is invalid.")
  }
  return date
}

function releaseNotice(message: string, notes: string | undefined): string {
  const summary = notes
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && line !== "---")
    ?.replace(/^[-*+>]\s*/, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!summary) return message
  const clipped = summary.length > 160 ? `${summary.slice(0, 157)}...` : summary
  return `${message} What's new: ${clipped}`
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
