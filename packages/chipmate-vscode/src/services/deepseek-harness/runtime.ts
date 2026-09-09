import { createHash, randomUUID } from "crypto"
import {
  chmodSync,
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs"
import { join, resolve } from "path"
import type { ChildProcess } from "child_process"
import * as vscode from "vscode"
import { exec, spawn } from "../../util/process"
import {
  DEEPSEEK_HARNESS_NODE_VERSION,
  DEEPSEEK_HARNESS_PROTOCOL_VERSION,
  DEEPSEEK_HARNESS_PRESET_POLICY_VERSION,
  DEEPSEEK_HARNESS_VERSION,
  type DeepSeekHarnessAgentPreset,
  type DeepSeekHarnessState,
} from "../../shared/deepseek-harness"
import {
  deepSeekHarnessPresetForTarget,
  type DeepSeekHarnessRuntimeTarget,
} from "../../shared/deepseek-harness-runtime"
import {
  DeepSeekHarnessProtocol,
  type DeepSeekHarnessDisconnect,
  type DeepSeekHarnessFrame,
} from "./protocol"
import {
  DeepSeekHarnessRuntimeInstaller,
  type InstalledDeepSeekHarnessRuntime,
} from "./installer"
import {
  DEEPSEEK_HARNESS_LEASE_SCHEMA_VERSION,
  deepSeekHarnessProcessStartIdentity,
  getDeepSeekHarnessLeaseCoordinator,
  type DeepSeekHarnessLeaseCoordinator,
} from "./lease"

export { writeDeepSeekHarnessLease } from "./lease"

export interface DeepSeekHarnessConfig {
  baseURL: string
  apiKey: string
  models: Array<{ id: string; name: string }>
}

export const DEEPSEEK_HARNESS_CAPACITY_POLICY = {
  version: 1,
  contextWindow: 262_144,
  maxTokens: 32_768,
} as const

export class DeepSeekHarnessPresetUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DeepSeekHarnessPresetUnavailableError"
  }
}

type SettingsNamespace = {
  ns: string
  value: unknown
  user?: unknown
  revision: number
}

type SettingsDescription = {
  writable: boolean
  namespaces: SettingsNamespace[]
}

type RunRecord = {
  pid: number
  startIdentity: string
  supervisorPid?: number
  supervisorStartIdentity?: string
  supervisorPath?: string
  supervisorSchemaVersion?: number
  port: number
  baseUrl: string
  dshVersion: string
  nodeVersion: string
  home: string
  configFingerprint: string
  runtimeTarget: string
  runtimeSha256: string
  runtimeRoot: string
  startedAt: string
}

export class DeepSeekHarnessRuntime {
  private protocol?: DeepSeekHarnessProtocol
  private child?: ChildProcess
  private record?: RunRecord
  private disconnectExpected = false
  private reconnectTask?: Promise<void>
  private reconnectToken = 0
  private reconnectCount = 0
  private reconnectCycle = 0
  private terminating = false
  private readonly owner = randomUUID()
  private readonly root: string
  private readonly home: string
  private readonly leaseCoordinator: DeepSeekHarnessLeaseCoordinator
  private readonly supervisor: string
  private readonly supervisorMetadata: string
  private readonly installer: DeepSeekHarnessRuntimeInstaller
  private readonly extensionVersion: string

  constructor(
    context: vscode.ExtensionContext,
    private readonly mux: (data: string) => void,
    private readonly host: (data: string) => void,
    private readonly plugin: (frame: DeepSeekHarnessFrame) => void,
    private readonly crashed: (error?: Error) => void,
    private readonly phase: (state: DeepSeekHarnessState) => void,
  ) {
    this.root = join(context.globalStorageUri.fsPath, "deepseek-harness")
    this.home = join(this.root, "home")
    this.leaseCoordinator = getDeepSeekHarnessLeaseCoordinator(this.root)
    this.supervisor = join(context.extensionUri.fsPath, "supervisor", "deepseek-harness-supervisor.cjs")
    this.supervisorMetadata = join(this.root, "supervisor", `${this.owner}.json`)
    this.installer = new DeepSeekHarnessRuntimeInstaller(context)
    this.extensionVersion = context.extension?.packageJSON.version ?? "unknown"
  }

  static fingerprint(config: DeepSeekHarnessConfig, target: DeepSeekHarnessRuntimeTarget): string {
    const agentPreset = deepSeekHarnessPresetForTarget(target)
    return createHash("sha256")
      .update(
        JSON.stringify({
          baseURL: config.baseURL,
          key: createHash("sha256").update(config.apiKey).digest("hex"),
          models: [...config.models].sort((a, b) => a.id.localeCompare(b.id)),
          capacity: DEEPSEEK_HARNESS_CAPACITY_POLICY,
          runtimeTarget: target,
          agentPreset,
          presetPolicyVersion: DEEPSEEK_HARNESS_PRESET_POLICY_VERSION,
          version: DEEPSEEK_HARNESS_VERSION,
        }),
      )
      .digest("hex")
  }

  get baseUrl(): string | undefined {
    return this.record?.baseUrl
  }

  get logPath(): string {
    return join(this.root, "dsh.log")
  }

  get transportLogPath(): string {
    return join(this.root, "transport.log")
  }

  get reconnectAttempt(): number {
    return this.reconnectCount
  }

  get connectionCycle(): number {
    return this.reconnectCycle
  }

  get currentProtocol(): DeepSeekHarnessProtocol | undefined {
    return this.protocol
  }

  get currentConfigFingerprint(): string | undefined {
    return this.record?.configFingerprint
  }

  reusableProtocol(config: DeepSeekHarnessConfig): DeepSeekHarnessProtocol | undefined {
    if (this.terminating || this.reconnectTask || !this.record) return undefined
    if (!isRuntimeTarget(this.record.runtimeTarget)) return undefined
    if (this.record.configFingerprint !== DeepSeekHarnessRuntime.fingerprint(config, this.record.runtimeTarget))
      return undefined
    return this.protocol?.connected ? this.protocol : undefined
  }

  runtimeAvailable(): boolean {
    return this.installer.available()
  }

  prepareRuntime(): Promise<InstalledDeepSeekHarnessRuntime> {
    return this.installer.ensureInstalled()
  }

  async hasActiveWork(): Promise<boolean> {
    const record = this.record ?? this.readRecord()
    if (!record || !(await this.validateDshProcess(record))) return false
    try {
      const protocol = new DeepSeekHarnessProtocol(
        record.baseUrl,
        () => undefined,
        () => undefined,
        () => undefined,
      )
      const result = await withTimeout(
        protocol.call<{ items?: Array<{ running?: boolean; pendingInteraction?: unknown }> }>("session.list", {}),
        5_000,
        "检查官方 DSH 任务状态超时",
      )
      return (
        result.items?.some(
          (session) =>
            session.running === true ||
            (session.pendingInteraction !== null && session.pendingInteraction !== undefined),
        ) ?? false
      )
    } catch {
      return true
    }
  }

  hasOtherLeases(): Promise<boolean> {
    return this.leaseCoordinator.hasOtherLeases()
  }

  async ensure(
    workspace: string,
    config: DeepSeekHarnessConfig,
    verified?: InstalledDeepSeekHarnessRuntime,
  ): Promise<DeepSeekHarnessProtocol> {
    const current = this.reusableProtocol(config)
    if (current) return current
    if (this.reconnectTask) {
      await this.reconnectTask
      const recovered = this.reusableProtocol(config)
      if (recovered) return recovered
    }
    const installed = verified ?? (await this.prepareRuntime())
    mkdirSync(join(this.root, "leases"), { recursive: true, mode: 0o700 })
    mkdirSync(this.home, { recursive: true, mode: 0o700 })
    if (process.platform !== "win32") {
      chmodSync(this.root, 0o700)
      chmodSync(this.home, 0o700)
      chmodSync(join(this.root, "leases"), 0o700)
    }
    this.terminating = false
    this.disconnectExpected = false
    const fingerprint = DeepSeekHarnessRuntime.fingerprint(config, installed.artifact.target)
    this.phase("acquiring-lock")
    const lock = await this.acquireLock("lifecycle.lock", 45_000)
    let leased = false
    try {
      await this.leaseCoordinator.acquire(this.owner)
      leased = true
      try {
        this.phase("checking-process")
        const raced = await this.attach(config, fingerprint, installed)
        if (raced) return raced
        const started = this.readRecord()
        if (started && (await this.validateDshProcess(started))) {
          throw new Error("并发窗口已启动配置不匹配的官方 DSH，需要重启")
        }
        return await this.start(workspace, config, fingerprint, installed)
      } catch (error) {
        this.leaseCoordinator.release(this.owner)
        leased = false
        throw error
      }
    } catch (error) {
      if (leased) this.leaseCoordinator.release(this.owner)
      throw error
    } finally {
      closeSync(lock.fd)
      rmSync(lock.path, { force: true })
    }
  }

  async stop(forceAfterMs = 15_000, onlyIfNoLeases = false): Promise<{ forced: boolean; skipped?: boolean }> {
    this.disconnectExpected = true
    this.terminating = true
    this.reconnectToken += 1
    this.replaceProtocol()
    if (!this.record && !existsSync(join(this.root, "run.json"))) return { forced: false }
    const lock = await this.acquireLock("lifecycle.lock", 45_000)
    try {
      if (onlyIfNoLeases) {
        if (this.leaseCoordinator.hasClients() || (await this.leaseCoordinator.hasOtherLeases()))
          return { forced: false, skipped: true }
      }
      const record = this.record ?? this.readRecord()
      if (!record || !(await this.validateDshProcess(record))) {
        this.clearRecord()
        return { forced: false }
      }
      const result = (await this.validateProcess(record))
        ? await stopSupervised(record, this.root, forceAfterMs)
        : await terminateProcess(record.pid, forceAfterMs)
      this.clearRecord()
      return result
    } finally {
      closeSync(lock.fd)
      rmSync(lock.path, { force: true })
    }
  }

  async release(): Promise<{ stopped: boolean; forced: boolean }> {
    this.terminating = true
    this.disconnectExpected = true
    this.reconnectToken += 1
    const finalLocalLease = this.leaseCoordinator.release(this.owner)
    if (!finalLocalLease || (await this.leaseCoordinator.hasOtherLeases())) {
      this.replaceProtocol()
      return { stopped: false, forced: false }
    }
    const result = await this.stop(15_000, true)
    if (result.skipped) {
      this.replaceProtocol()
      return { stopped: false, forced: false }
    }
    return { stopped: true, ...result }
  }

  private async attach(
    config: DeepSeekHarnessConfig,
    fingerprint: string,
    installed: InstalledDeepSeekHarnessRuntime,
  ): Promise<DeepSeekHarnessProtocol | undefined> {
    const record = this.readRecord()
    if (!record) return undefined
    if (record.supervisorSchemaVersion !== DEEPSEEK_HARNESS_LEASE_SCHEMA_VERSION)
      throw new Error("ChipMate DeepSeek Harness 生命周期 Supervisor 已升级，需要重启")
    if (
      record.dshVersion !== DEEPSEEK_HARNESS_VERSION ||
      record.nodeVersion !== DEEPSEEK_HARNESS_NODE_VERSION ||
      resolve(record.home) !== resolve(this.home) ||
      record.configFingerprint !== fingerprint ||
      record.runtimeTarget !== installed.artifact.target ||
      record.runtimeSha256 !== installed.artifact.sha256 ||
      resolve(record.runtimeRoot) !== resolve(installed.root) ||
      !(await this.validateProcess(record))
    ) {
      return undefined
    }
    this.record = record
    const protocol = this.makeProtocol(record.baseUrl, record)
    this.replaceProtocol(protocol)
    try {
      const description = (await withTimeout(protocol.connect(this.phase), 10_000, "连接现有官方 DSH 超时")) as {
        version?: string
      }
      if (description?.version !== DEEPSEEK_HARNESS_PROTOCOL_VERSION) throw new Error("DSH 官方协议版本握手不匹配")
      this.phase("configuring-preset")
      const preset = deepSeekHarnessPresetForTarget(installed.artifact.target)
      await ensureDeepSeekHarnessPreset(protocol, preset, false)
      if (deepSeekHarnessPresetRequiresBashProbe(preset)) await probeOfficialMinimalBash()
      this.phase("configuring-provider")
      await ensureDeepSeekHarnessCapacity(protocol, config, false)
      validateOfficialWebHome(this.home)
      if (this.reconnectTask) await withTimeout(this.reconnectTask, 30_000, "连接现有官方 DSH 的事件流恢复超时")
      if (!this.protocol) throw new Error("连接现有官方 DSH 后事件流不可用")
      return this.protocol
    } catch (error) {
      protocol.close()
      await this.cancelReconnect()
      if (this.protocol === protocol) this.protocol = undefined
      this.record = undefined
      if (isRestartRequired(error) || error instanceof DeepSeekHarnessPresetUnavailableError) throw error
      return undefined
    }
  }

  private async start(
    workspace: string,
    config: DeepSeekHarnessConfig,
    fingerprint: string,
    installed: InstalledDeepSeekHarnessRuntime,
  ): Promise<DeepSeekHarnessProtocol> {
    const runtime = installed.root
    const node = join(runtime, process.platform === "win32" ? "node.exe" : "node")
    const entry = join(runtime, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
    const manifest = join(runtime, "runtime-manifest.json")
    verifyRuntime(node, entry, manifest)
    validateOfficialWebHome(this.home, true)

    const log = this.logPath
    const logOffset = existsSync(log) ? readFileSync(log, "utf8").length : 0
    const deadline = Date.now() + 30_000
    const env = cleanEnvironment(config, this.home)
    mkdirSync(join(this.root, "supervisor"), { recursive: true, mode: 0o700 })
    rmSync(join(this.root, "supervisor", "stop.request.json"), { force: true })
    rmSync(join(this.root, "supervisor", "stop.result.json"), { force: true })
    rmSync(this.supervisorMetadata, { force: true })
    if (!existsSync(this.supervisor)) throw new Error("VSIX 缺少 ChipMate DeepSeek Harness 生命周期 Supervisor")
    this.disconnectExpected = false
    this.phase("starting-supervisor")
    const supervisor = spawn(
      node,
      [this.supervisor, node, entry, workspace, this.root, log, this.supervisorMetadata],
      {
        cwd: workspace,
        env,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    )
    if (!supervisor.pid) throw new Error("生命周期 Supervisor 未返回 PID")
    this.child = supervisor
    let childFailure: Error | undefined
    supervisor.once("error", (error) => (childFailure = error))
    supervisor.once("exit", (code, signal) => {
      if (code !== null || signal)
        childFailure = new Error(`生命周期 Supervisor 在就绪前退出（code=${code ?? "null"}, signal=${signal ?? "none"}）`)
    })
    supervisor.unref()
    const supervisorPid = supervisor.pid
    let supervisorStartIdentity = ""
    let pid = 0
    let startIdentity = ""
    let port = 0
    try {
      supervisorStartIdentity = await deepSeekHarnessProcessStartIdentity(supervisorPid)
      this.phase("spawning-official-dsh")
      const metadata = await waitForSupervisor(
        this.supervisorMetadata,
        supervisorPid,
        remaining(deadline),
        () => childFailure,
      )
      pid = metadata.dshPid
      startIdentity = await deepSeekHarnessProcessStartIdentity(pid)
      this.phase("waiting-listen-address")
      port = await waitForDeepSeekHarnessAddress(log, pid, remaining(deadline), () => childFailure, logOffset)
    } catch (error) {
      const result = readSupervisorResult(this.root, supervisorPid, pid || undefined)
      if (!result) await requestSupervisorStop(this.root, supervisorPid)
      await waitForExit(pid || supervisorPid, 17_000)
      throw result ? new Error(supervisorFailureMessage(result)) : error
    }
    const record: RunRecord = {
      pid,
      startIdentity,
      supervisorPid,
      supervisorStartIdentity,
      supervisorPath: this.supervisor,
      supervisorSchemaVersion: DEEPSEEK_HARNESS_LEASE_SCHEMA_VERSION,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      dshVersion: DEEPSEEK_HARNESS_VERSION,
      nodeVersion: DEEPSEEK_HARNESS_NODE_VERSION,
      home: this.home,
      configFingerprint: fingerprint,
      runtimeTarget: installed.artifact.target,
      runtimeSha256: installed.artifact.sha256,
      runtimeRoot: runtime,
      startedAt: new Date().toISOString(),
    }
    this.record = record
    const protocol = this.makeProtocol(record.baseUrl, record)
    this.replaceProtocol(protocol)
    try {
      const description = (await withTimeout(
        protocol.connect(this.phase),
        remaining(deadline),
        "官方 DSH 就绪检查超过 30 秒",
      )) as { version?: string }
      if (description?.version !== DEEPSEEK_HARNESS_PROTOCOL_VERSION) throw new Error("官方 DSH 协议版本握手不匹配")
      this.phase("configuring-preset")
      const preset = deepSeekHarnessPresetForTarget(installed.artifact.target)
      await ensureDeepSeekHarnessPreset(protocol, preset, true)
      if (deepSeekHarnessPresetRequiresBashProbe(preset)) await probeOfficialMinimalBash()
      this.phase("configuring-provider")
      await ensureDeepSeekHarnessCapacity(protocol, config, true)
      validateOfficialWebHome(this.home)
      if (this.reconnectTask)
        await withTimeout(this.reconnectTask, remaining(deadline), "官方 DSH 就绪期间事件流恢复超时")
      if (!this.protocol) throw new Error("官方 DSH 配置完成后事件流不可用")
    } catch (error) {
      protocol.close()
      await this.cancelReconnect()
      if (this.protocol === protocol) this.protocol = undefined
      this.record = undefined
      await requestSupervisorStop(this.root, supervisorPid)
      await waitForExit(pid, 17_000)
      throw error
    }
    writeFileSync(join(this.root, "run.json"), JSON.stringify(record, null, 2), { mode: 0o600 })
    return this.protocol
  }

  private makeProtocol(baseUrl: string, record = this.record): DeepSeekHarnessProtocol {
    return new DeepSeekHarnessProtocol(
      baseUrl,
      this.mux,
      this.host,
      (disconnect) => this.beginReconnect(record, disconnect),
      this.plugin,
      (event) => this.logTransport({ connectionCycle: this.reconnectCycle, ...event }),
    )
  }

  private replaceProtocol(next?: DeepSeekHarnessProtocol): void {
    const previous = this.protocol
    if (previous === next) return
    previous?.close()
    this.protocol = next
  }

  private beginReconnect(record: RunRecord | undefined, disconnect: DeepSeekHarnessDisconnect): void {
    if (this.disconnectExpected || this.reconnectTask) return
    if (!record) {
      this.crashed(new Error("官方 DSH 事件流断开且缺少可信运行记录"))
      return
    }
    this.disconnectExpected = true
    this.replaceProtocol()
    this.reconnectCount = 0
    this.reconnectCycle += 1
    this.logTransport({
      channel: disconnect.channel,
      event: disconnect.kind,
      connectionCycle: this.reconnectCycle,
      ...(disconnect.code === undefined ? {} : { code: disconnect.code }),
      ...(disconnect.reason === undefined ? {} : { reason: disconnect.reason }),
    })
    this.phase("reconnecting-events")
    const token = ++this.reconnectToken
    const task = this.reconnect(record, token)
    this.reconnectTask = task
    void task.finally(() => {
      if (this.reconnectTask === task) this.reconnectTask = undefined
    })
  }

  private async cancelReconnect(): Promise<void> {
    this.disconnectExpected = true
    this.reconnectToken += 1
    const task = this.reconnectTask
    this.replaceProtocol()
    if (task) await task.catch(() => undefined)
    this.reconnectTask = undefined
  }

  private async reconnect(record: RunRecord, token: number): Promise<void> {
    const started = Date.now()
    for (let attempt = 1; token === this.reconnectToken && !this.terminating; attempt++) {
      this.reconnectCount = attempt
      this.phase("reconnecting-events")
      const cap = Math.min(10_000, 500 * 2 ** (attempt - 1))
      await delay(Math.floor(cap / 2 + Math.random() * (cap / 2)))
      if (token !== this.reconnectToken || this.terminating) return
      if (!(await this.validateProcess(record))) {
        this.logTransport({ event: "identity-failed", attempt })
        const result = readSupervisorResult(this.root, record.supervisorPid ?? 0, record.pid)
        this.crashed(new Error(supervisorFailureMessage(result)))
        return
      }
      const protocol = this.makeProtocol(record.baseUrl, record)
      const handshake = Date.now()
      try {
        const description = (await withTimeout(protocol.connect(), 10_000, "官方 DSH 事件流重连握手超时")) as {
          version?: string
        }
        if (description.version !== DEEPSEEK_HARNESS_PROTOCOL_VERSION) {
          protocol.close()
          this.crashed(new Error("官方 DSH 协议版本不匹配"))
          return
        }
        validateOfficialWebHome(this.home)
        this.replaceProtocol(protocol)
        this.record = record
        this.reconnectTask = undefined
        this.disconnectExpected = false
        this.logTransport({ event: "reconnected", attempt, handshakeMs: Date.now() - handshake })
        this.phase("resyncing-session")
        return
      } catch (error) {
        protocol.close()
        this.logTransport({
          event: "reconnect-failed",
          attempt,
          handshakeMs: Date.now() - handshake,
          error: redactTransportValue(error),
          warning: Date.now() - started >= 30_000,
        })
      }
    }
  }

  private logTransport(event: Record<string, unknown>): void {
    try {
      mkdirSync(this.root, { recursive: true, mode: 0o700 })
      appendFileSync(
        this.transportLogPath,
        `${JSON.stringify({
          at: new Date().toISOString(),
          extensionVersion: this.extensionVersion,
          supervisorSchemaVersion: DEEPSEEK_HARNESS_LEASE_SCHEMA_VERSION,
          runtimeSha256: this.record?.runtimeSha256,
          ...sanitizeTransportEvent(event),
        })}\n`,
        { mode: 0o600 },
      )
    } catch (error) {
      console.warn("[DeepSeek Harness] 无法写入脱敏运输日志：", redactTransportValue(error))
    }
  }

  private async validateProcess(record: RunRecord): Promise<boolean> {
    if (
      typeof record.supervisorPid !== "number" ||
      typeof record.supervisorStartIdentity !== "string" ||
      resolve(record.supervisorPath ?? "") !== resolve(this.supervisor)
    )
      return false
    try {
      return (
        (await this.validateDshProcess(record)) &&
        (await deepSeekHarnessProcessStartIdentity(record.supervisorPid)) === record.supervisorStartIdentity &&
        (await supervisorCommandMatches(record.supervisorPid, this.supervisor, record.runtimeRoot))
      )
    } catch {
      return false
    }
  }

  private async validateDshProcess(record: RunRecord): Promise<boolean> {
    try {
      process.kill(record.pid, 0)
      return (
        (await deepSeekHarnessProcessStartIdentity(record.pid)) === record.startIdentity &&
        (await processCommandMatches(record.pid, record.runtimeRoot))
      )
    } catch {
      return false
    }
  }

  private readRecord(): RunRecord | undefined {
    try {
      return JSON.parse(readFileSync(join(this.root, "run.json"), "utf8")) as RunRecord
    } catch {
      return undefined
    }
  }

  private clearRecord(): void {
    rmSync(join(this.root, "run.json"), { force: true })
    this.record = undefined
    this.child = undefined
  }

  private async acquireLock(
    name: "lifecycle.lock",
    staleAfter: number,
  ): Promise<{ fd: number; path: string }> {
    const path = join(this.root, name)
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const fd = openSync(path, "wx", 0o600)
        writeFileSync(fd, JSON.stringify({ owner: this.owner, pid: process.pid, createdAt: Date.now() }))
        return { fd, path }
      } catch (error) {
        if (!isExists(error)) throw error
        if (attempt % 25 === 0) {
          try {
            const value = JSON.parse(readFileSync(path, "utf8")) as { createdAt?: number }
            if (typeof value.createdAt === "number" && Date.now() - value.createdAt > staleAfter)
              rmSync(path, { force: true })
          } catch (lockError) {
            if (!isMissingFile(lockError)) console.warn("[DeepSeek Harness] 无法检查单航锁：", lockError)
          }
        }
        await delay(200)
      }
    }
    throw new Error("等待 ChipMate DeepSeek Harness 生命周期单航锁超时")
  }
}

export function cleanDeepSeekHarnessEnvironment(config: DeepSeekHarnessConfig, home: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(CHIPMATE|OPENCODE|KILO|DSH|DEEPSEEK)_/iu.test(key) &&
        key !== "NODE_OPTIONS" &&
        key !== "NODE_PATH" &&
        key !== "BUN_OPTIONS",
    ),
  )
  return {
    ...env,
    DSH_HOME: home,
    DEEPSEEK_BASE_URL: config.baseURL.replace(/\/$/u, ""),
    DEEPSEEK_API_KEY: config.apiKey,
  }
}

export function deepSeekHarnessCapacityPatch(config: DeepSeekHarnessConfig): Record<string, unknown> {
  return {
    defaultContextWindow: DEEPSEEK_HARNESS_CAPACITY_POLICY.contextWindow,
    maxTokens: DEEPSEEK_HARNESS_CAPACITY_POLICY.maxTokens,
    models: [...config.models]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: DEEPSEEK_HARNESS_CAPACITY_POLICY.contextWindow,
        maxTokens: DEEPSEEK_HARNESS_CAPACITY_POLICY.maxTokens,
      })),
  }
}

export function deepSeekHarnessCapacityMatches(value: unknown, config: DeepSeekHarnessConfig): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  const expected = deepSeekHarnessCapacityPatch(config)
  return (
    record.defaultContextWindow === expected.defaultContextWindow &&
    record.maxTokens === expected.maxTokens &&
    JSON.stringify(normalizeModels(record.models)) === JSON.stringify(expected.models)
  )
}

export async function ensureDeepSeekHarnessCapacity(
  protocol: Pick<DeepSeekHarnessProtocol, "call">,
  config: DeepSeekHarnessConfig,
  mayWrite: boolean,
): Promise<void> {
  const describe = () => protocol.call<SettingsDescription>("settings.describe", {})
  let settings = await describe()
  let namespace = settings.namespaces.find((item) => item.ns === "llm-deepseek")
  if (!namespace) throw new Error("官方 DSH 未暴露 llm-deepseek 设置命名空间")
  if (deepSeekHarnessCapacityMatches(namespace.value, config)) return
  if (!mayWrite) throw new Error("官方 DSH 模型容量策略不一致，需要重启")
  if (!settings.writable) throw new Error("官方 DSH 的 llm-deepseek 设置只读，无法应用模型容量策略")
  try {
    await protocol.call("settings.update", {
      ns: "llm-deepseek",
      patch: deepSeekHarnessCapacityPatch(config),
      expectedRevision: namespace.revision,
    })
  } catch (error) {
    settings = await describe()
    namespace = settings.namespaces.find((item) => item.ns === "llm-deepseek")
    if (!namespace || !deepSeekHarnessCapacityMatches(namespace.value, config)) {
      if (error instanceof Error && /conflict|revision|版本|冲突/iu.test(error.message))
        throw new Error("其他窗口已写入不同的官方 DSH 模型容量策略，需要重启")
      throw error
    }
    return
  }
  settings = await describe()
  namespace = settings.namespaces.find((item) => item.ns === "llm-deepseek")
  if (!namespace || !deepSeekHarnessCapacityMatches(namespace.value, config))
    throw new Error("官方 DSH 模型容量策略写入后验证失败")
}

type AgentPresetList = {
  presets?: Array<{
    id?: string
    trust?: "system" | "user"
    isDefault?: boolean
    broken?: string
  }>
}

export async function ensureDeepSeekHarnessPreset(
  protocol: Pick<DeepSeekHarnessProtocol, "call">,
  expectedPreset: DeepSeekHarnessAgentPreset,
  mayWrite: boolean,
): Promise<void> {
  const roster = await protocol.call<AgentPresetList>("agentPreset.list", {})
  const preset = roster.presets?.find((item) => item.id === expectedPreset)
  if (!preset || preset.trust !== "system" || preset.broken) {
    throw new DeepSeekHarnessPresetUnavailableError(
      preset?.broken
        ? `官方 ${expectedPreset} Agent Preset 不可用：${preset.broken}`
        : `官方 DSH 未提供完整、可信的内置 ${expectedPreset} Agent Preset`,
    )
  }

  const describe = () => protocol.call<SettingsDescription>("settings.describe", {})
  let settings = await describe()
  let namespace = settings.namespaces.find((item) => item.ns === "agent-presets")
  if (!namespace) throw new DeepSeekHarnessPresetUnavailableError("官方 DSH 未暴露 agent-presets 设置命名空间")
  if (agentPresetDefault(namespace.value) === expectedPreset) return
  if (!mayWrite) throw new Error(`官方 DSH 默认 Agent Preset 不是平台要求的 ${expectedPreset}，需要重启`)
  if (!settings.writable)
    throw new DeepSeekHarnessPresetUnavailableError(
      `官方 DSH 的 Agent Preset 设置只读，无法启用 ${expectedPreset}`,
    )
  try {
    await protocol.call("settings.update", {
      ns: "agent-presets",
      patch: { default: expectedPreset },
      expectedRevision: namespace.revision,
    })
  } catch (error) {
    settings = await describe()
    namespace = settings.namespaces.find((item) => item.ns === "agent-presets")
    if (!namespace || agentPresetDefault(namespace.value) !== expectedPreset) {
      if (error instanceof Error && /conflict|revision|版本|冲突/iu.test(error.message))
        throw new Error("其他窗口已写入不同的官方 DSH Agent Preset，需要重启")
      throw error
    }
    return
  }
  settings = await describe()
  namespace = settings.namespaces.find((item) => item.ns === "agent-presets")
  if (!namespace || agentPresetDefault(namespace.value) !== expectedPreset)
    throw new DeepSeekHarnessPresetUnavailableError(`官方 DSH ${expectedPreset} Agent Preset 写入后验证失败`)
}

export async function probeOfficialMinimalBash(): Promise<void> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(CHIPMATE|OPENCODE|KILO|DSH|DEEPSEEK)_/iu.test(key) &&
        key !== "NODE_OPTIONS" &&
        key !== "NODE_PATH" &&
        key !== "BUN_OPTIONS",
    ),
  )
  try {
    await exec("/bin/bash", ["--noprofile", "--norc", "-c", "exit 0"], {
      env,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    })
  } catch {
    throw new DeepSeekHarnessPresetUnavailableError(
      "官方极简模式要求 /bin/bash，当前系统无法启动该可执行文件",
    )
  }
}

export function deepSeekHarnessPresetRequiresBashProbe(preset: DeepSeekHarnessAgentPreset): boolean {
  return preset === "minimal"
}

function agentPresetDefault(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const selected = (value as Record<string, unknown>).default
  return typeof selected === "string" ? selected : undefined
}

function isRuntimeTarget(value: string): value is DeepSeekHarnessRuntimeTarget {
  return value === "win32-x64-baseline" || value === "linux-x64-baseline"
}

function normalizeModels(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((model): model is Record<string, unknown> => Boolean(model && typeof model === "object"))
    .map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

function isRestartRequired(error: unknown): boolean {
  return error instanceof Error && error.message.includes("需要重启")
}

const cleanEnvironment = cleanDeepSeekHarnessEnvironment

export function validateOfficialWebHome(home: string, allowUninitialized = false): void {
  const profile = join(home, "profiles", "web")
  const profilesRoot = join(home, "profiles")
  if (existsSync(join(home, "cordis.patch.yml"))) throw new Error("插件私有 DSH_HOME 存在 Home 级 patch")
  for (const name of ["plugins", "skills", "mcp"]) {
    if (existsSync(join(home, name))) throw new Error(`插件私有 DSH_HOME 存在额外 ${name} 配置`)
  }
  if (!existsSync(profile)) {
    if (
      existsSync(profilesRoot) &&
      readdirSync(profilesRoot).some((name) => name !== "node_modules")
    )
      throw new Error("插件私有 DSH_HOME 包含非官方 web Profile")
    if (allowUninitialized) return
    throw new Error("插件私有 DSH_HOME 缺少官方 web Profile")
  }
  for (const path of [profile, join(profile, "package.json"), join(profile, "cordis.patch.yml")]) {
    const info = lstatSync(path)
    if (info.isSymbolicLink()) throw new Error("插件私有 DSH_HOME 的 web Profile 包含链接或重解析点")
  }
  const profiles = readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
  if (profiles.length !== 1 || profiles[0] !== "web") throw new Error("插件私有 DSH_HOME 包含非官方 web Profile")
  const allowedProfileFiles = new Set(["package.json", "cordis.patch.yml", "pnpm-workspace.yaml", "cordis.yml"])
  const extraProfileFile = readdirSync(profile).find((name) => !allowedProfileFiles.has(name))
  if (extraProfileFile) throw new Error(`插件私有 DSH_HOME 的 web Profile 包含额外文件：${extraProfileFile}`)
  validateOfficialProfileContents(profile)
}

function validateOfficialProfileContents(profile: string): void {
  const manifest = JSON.parse(readFileSync(join(profile, "package.json"), "utf8")) as {
    name?: string
    private?: boolean
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  if (
    manifest.name !== "dsh-profile-web" ||
    manifest.private !== true ||
    Object.keys(manifest.dependencies ?? {}).length !== 0 ||
    JSON.stringify(manifest.dsh?.profile?.bundles) !==
      JSON.stringify(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"])
  ) {
    throw new Error("插件私有 DSH_HOME 的 web Profile 已被修改")
  }
  const patch = readFileSync(join(profile, "cordis.patch.yml"), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.replace(/#.*/u, "").trim())
    .filter(Boolean)
    .join("")
  if (patch !== "[]") throw new Error("插件私有 DSH_HOME 的 web Profile patch 不是官方空 patch")
}

function verifyRuntime(node: string, entry: string, manifestPath: string): void {
  if (!existsSync(node) || !existsSync(entry) || !existsSync(manifestPath))
    throw new Error("缺少固定的官方 DSH / Node 24 运行时，请先执行运行时准备脚本")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dshVersion?: string
    nodeVersion?: string
    dshIntegrity?: string
    launch?: { command?: string; arguments?: string[]; injectedEnvironment?: string[] }
  }
  if (manifest.dshVersion !== DEEPSEEK_HARNESS_VERSION || manifest.nodeVersion !== DEEPSEEK_HARNESS_NODE_VERSION)
    throw new Error("已安装 DSH 运行时版本不匹配")
  if (
    manifest.dshIntegrity !==
    "sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg=="
  )
    throw new Error("已安装 DSH 完整性锁不匹配")
  const launch = manifest.launch
  if (
    launch?.command !== "dsh web" ||
    JSON.stringify(launch.arguments) !== JSON.stringify(["web", "--host", "127.0.0.1", "--port", "0"]) ||
    JSON.stringify(launch.injectedEnvironment) !== JSON.stringify(["DSH_HOME", "DEEPSEEK_BASE_URL", "DEEPSEEK_API_KEY"])
  ) {
    throw new Error("已安装 DSH 启动参数或环境变量白名单不匹配")
  }
}

export async function waitForDeepSeekHarnessAddress(
  log: string,
  pid: number,
  timeout: number,
  childFailure: () => Error | undefined,
  initial = 0,
): Promise<number> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const failure = childFailure()
    if (failure) throw failure
    try {
      process.kill(pid, 0)
    } catch {
      throw new Error("官方 DSH 在就绪前退出")
    }
    const text = existsSync(log) ? readFileSync(log, "utf8").slice(initial) : ""
    const port = deepSeekHarnessListenPort(text)
    if (port) return port
    await delay(100)
  }
  throw new Error("官方 DSH 启动超过 30 秒")
}

export function deepSeekHarnessListenPort(text: string): number | undefined {
  const normalized = text.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/gu, "")
  const matches = [...normalized.matchAll(/dsh web:\s+(http:\/\/\S+)/gu)]
  const address = matches.at(-1)?.[1]
  if (!address) return
  try {
    const url = new URL(address)
    const port = Number(url.port)
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65_535)
      return
    return port
  } catch {
    return
  }
}

async function waitForSupervisor(
  metadata: string,
  supervisorPid: number,
  timeout: number,
  childFailure: () => Error | undefined,
): Promise<{ dshPid: number }> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const failure = childFailure()
    if (failure) throw failure
    if (existsSync(metadata)) {
      const value = JSON.parse(readFileSync(metadata, "utf8")) as {
        schemaVersion?: number
        supervisorPid?: number
        dshPid?: number
      }
      if (
        value.schemaVersion === DEEPSEEK_HARNESS_LEASE_SCHEMA_VERSION &&
        value.supervisorPid === supervisorPid &&
        typeof value.dshPid === "number" &&
        value.dshPid > 0
      )
        return { dshPid: value.dshPid }
      throw new Error("生命周期 Supervisor 返回了无效的进程身份")
    }
    await delay(50)
  }
  throw new Error("等待生命周期 Supervisor 启动官方 DSH 超时")
}

async function stopSupervised(record: RunRecord, root: string, timeout: number): Promise<{ forced: boolean }> {
  const supervisorPid = record.supervisorPid
  if (typeof supervisorPid !== "number") return terminateProcess(record.pid, timeout)
  await requestSupervisorStop(root, supervisorPid)
  const exited = await waitForExit(record.pid, timeout + 2_500)
  if (exited) {
    const result = await waitForSupervisorResult(root, supervisorPid, record.pid, 2_500)
    return { forced: result?.forced ?? false }
  }
  await terminateProcess(record.pid, 0)
  await terminateProcess(supervisorPid, 2_000).catch(() => ({ forced: true }))
  return { forced: true }
}

async function waitForSupervisorResult(
  root: string,
  supervisorPid: number,
  dshPid: number,
  timeout: number,
): Promise<ReturnType<typeof readSupervisorResult>> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const result = readSupervisorResult(root, supervisorPid, dshPid)
    if (result) return result
    await delay(50)
  }
  return undefined
}

async function requestSupervisorStop(root: string, supervisorPid: number): Promise<void> {
  const path = join(root, "supervisor", "stop.request.json")
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  mkdirSync(join(root, "supervisor"), { recursive: true, mode: 0o700 })
  writeFileSync(
    temporary,
    JSON.stringify({
      schemaVersion: DEEPSEEK_HARNESS_LEASE_SCHEMA_VERSION,
      supervisorPid,
      requestedAt: Date.now(),
    }),
    {
    mode: 0o600,
    },
  )
  rmSync(path, { force: true })
  renameSync(temporary, path)
}

function readSupervisorResult(
  root: string,
  supervisorPid: number,
  dshPid?: number,
):
  | {
      forced: boolean
      reason?: string
      signalAttempted?: boolean
      signalDelivered?: boolean
      gracefulExit?: boolean
      elapsedMs?: number
      dshExitCode?: number | null
      dshSignal?: string | null
    }
  | undefined {
  try {
    const value = JSON.parse(readFileSync(join(root, "supervisor", "stop.result.json"), "utf8")) as {
      supervisorPid?: number
      dshPid?: number
      forced?: boolean
      reason?: string
      signalAttempted?: boolean
      signalDelivered?: boolean
      gracefulExit?: boolean
      elapsedMs?: number
      dshExitCode?: number | null
      dshSignal?: string | null
    }
    if (
      value.supervisorPid !== supervisorPid ||
      (dshPid !== undefined && value.dshPid !== dshPid) ||
      typeof value.forced !== "boolean"
    )
      return undefined
    return {
      forced: value.forced,
      reason: value.reason,
      signalAttempted: value.signalAttempted,
      signalDelivered: value.signalDelivered,
      gracefulExit: value.gracefulExit,
      elapsedMs: value.elapsedMs,
      dshExitCode: value.dshExitCode,
      dshSignal: value.dshSignal,
    }
  } catch {
    return undefined
  }
}

function supervisorFailureMessage(
  result: { forced?: boolean; reason?: string; dshExitCode?: number | null; dshSignal?: string | null } | undefined,
): string {
  if (result?.reason === "dsh-exit")
    return `官方 DSH 进程退出（code=${result.dshExitCode ?? "null"}, signal=${result.dshSignal ?? "none"}）`
  if (result?.reason === "spawn-error") return "官方 DSH 进程启动失败"
  if (result?.reason === "lease-expired")
    return result.forced
      ? "生命周期租约过期，官方 DSH 未在 15 秒内退出并被强制终止"
      : "生命周期租约过期，官方 DSH 已正常关闭"
  if (result?.reason === "requested-stop") return "生命周期 Supervisor 在启动期间收到停止请求"
  if (result?.reason === "signal") return "生命周期 Supervisor 收到关闭信号"
  return "官方 DSH 进程退出或可信进程身份不匹配"
}

async function terminateProcess(pid: number, timeout: number): Promise<{ forced: boolean }> {
  if (process.platform === "win32") {
    try {
      await sendWindowsInterrupt(pid)
      if (await waitForExit(pid, timeout)) return { forced: false }
    } catch (error) {
      console.warn("[DeepSeek Harness] Windows Ctrl+C 正常清理信号发送失败：", error)
    }
    await killTree(pid)
    await waitForExit(pid, 2_000)
    return { forced: true }
  }
  try {
    process.kill(pid, "SIGTERM")
  } catch (error) {
    if (!isMissingProcess(error)) throw error
  }
  if (await waitForExit(pid, timeout)) return { forced: false }
  await killTree(pid)
  await waitForExit(pid, 2_000)
  return { forced: true }
}

async function sendWindowsInterrupt(pid: number): Promise<void> {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChipMateConsoleSignal {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint processId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint type, uint processGroupId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
}
'@
[ChipMateConsoleSignal]::FreeConsole() | Out-Null
if (-not [ChipMateConsoleSignal]::AttachConsole(${pid})) { exit 2 }
[ChipMateConsoleSignal]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
if (-not [ChipMateConsoleSignal]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }
Start-Sleep -Milliseconds 250
[ChipMateConsoleSignal]::FreeConsole() | Out-Null
`
  await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5_000 })
}

async function processCommandMatches(pid: number, runtimeRoot: string): Promise<boolean> {
  let command: string
  if (process.platform === "win32") {
    const script = `(Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\").CommandLine`
    command = (
      await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5_000 })
    ).stdout
  } else {
    command = (await exec("ps", ["-ww", "-p", String(pid), "-o", "command="], { timeout: 5_000 })).stdout
  }
  const normalized = command.replaceAll("\\", "/")
  const expected = resolve(runtimeRoot).replaceAll("\\", "/")
  return (
    normalized.includes(`${expected}/${process.platform === "win32" ? "node.exe" : "node"}`) &&
    normalized.includes("/node_modules/@deepseek-ai/dsh/lib/bin.js") &&
    normalized.includes("web --host 127.0.0.1 --port 0")
  )
}

async function supervisorCommandMatches(pid: number, supervisor: string, runtimeRoot: string): Promise<boolean> {
  let command: string
  if (process.platform === "win32") {
    const script = `(Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\").CommandLine`
    command = (
      await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5_000 })
    ).stdout
  } else {
    command = (await exec("ps", ["-ww", "-p", String(pid), "-o", "command="], { timeout: 5_000 })).stdout
  }
  const normalized = command.replaceAll("\\", "/")
  const expectedSupervisor = resolve(supervisor).replaceAll("\\", "/")
  const expectedNode = join(resolve(runtimeRoot), process.platform === "win32" ? "node.exe" : "node").replaceAll(
    "\\",
    "/",
  )
  return normalized.includes(expectedNode) && normalized.includes(expectedSupervisor)
}

async function killTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await exec("taskkill.exe", ["/PID", String(pid), "/T", "/F"]).catch(() => undefined)
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch (error) {
    if (!isMissingProcess(error)) throw error
  }
}

async function waitForExit(pid: number, timeout: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await delay(100)
  }
  return false
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const remaining = (deadline: number) => Math.max(1, deadline - Date.now())

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
const code = (error: unknown) => (error && typeof error === "object" && "code" in error ? error.code : undefined)
const isExists = (error: unknown) => code(error) === "EEXIST"
const isMissingProcess = (error: unknown) => code(error) === "ESRCH"
const isMissingFile = (error: unknown) => code(error) === "ENOENT"

function sanitizeTransportEvent(event: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(event)
      .filter(([key]) => !/(prompt|content|payload|authorization|api.?key|workspace|sessionHistory)/iu.test(key))
      .map(([key, value]) => [key, typeof value === "string" ? redactTransportValue(value) : value]),
  )
}

function redactTransportValue(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/(api[_-]?key|authorization)\s*[:=]\s*\S+/giu, "$1=[已脱敏]")
    .replace(/https?:\/\/[^\s/]+/giu, "[地址已脱敏]")
    .replace(/[A-Za-z]:\\[^\s]+|\/(?:Users|home|workspace)\/[^\s]+/gu, "[路径已脱敏]")
    .slice(0, 500)
}
