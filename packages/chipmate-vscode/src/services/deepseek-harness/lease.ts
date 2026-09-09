import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { exec } from "../../util/process"

export const DEEPSEEK_HARNESS_LEASE_SCHEMA_VERSION = 2
export const DEEPSEEK_HARNESS_LEASE_FRESH_MS = 30_000

export interface DeepSeekHarnessLease {
  schemaVersion: 2
  ownerId: string
  ownerPid: number
  ownerStartIdentity: string
  createdAt: number
  updatedAt: number
}

type LegacyLease = {
  owner?: string
  pid?: number
  updatedAt?: number
}

type OwnerState = "live" | "dead" | "unknown"

export class DeepSeekHarnessLeaseCoordinator {
  private readonly ownerId = randomUUID()
  private readonly clients = new Set<string>()
  private readonly directory: string
  private readonly path: string
  private heartbeat?: NodeJS.Timeout
  private starting?: Promise<void>
  private createdAt = Date.now()
  private ownerStartIdentity?: string

  constructor(root: string) {
    this.directory = join(root, "leases")
    this.path = join(this.directory, `${this.ownerId}.json`)
  }

  async acquire(clientId: string): Promise<void> {
    if (this.clients.has(clientId)) {
      if (this.starting) await this.starting
      return
    }
    this.clients.add(clientId)
    if (this.heartbeat) return
    const task = this.starting ?? this.start()
    this.starting = task
    try {
      await task
    } catch (error) {
      this.clients.delete(clientId)
      throw error
    } finally {
      if (this.starting === task) this.starting = undefined
    }
  }

  release(clientId: string): boolean {
    if (!this.clients.delete(clientId)) return false
    if (this.clients.size > 0) return false
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    rmSync(this.path, { force: true })
    rmSync(`${this.path}.${process.pid}.tmp`, { force: true })
    return true
  }

  async hasOtherLeases(now = Date.now()): Promise<boolean> {
    if (!existsSync(this.directory)) return false
    for (const name of readdirSync(this.directory)) {
      if (name.endsWith(".tmp")) continue
      const path = join(this.directory, name)
      if (resolve(path) === resolve(this.path)) continue
      const state = await inspectLease(path, now)
      if (state === "live" || state === "unknown") return true
      if (state === "dead") rmSync(path, { force: true })
    }
    return false
  }

  hasClients(): boolean {
    return this.clients.size > 0
  }

  private async start(): Promise<void> {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.ownerStartIdentity ??= await deepSeekHarnessProcessStartIdentity(process.pid)
    this.createdAt = Date.now()
    this.write(true)
    this.heartbeat = setInterval(() => this.write(false), 10_000)
  }

  private write(required: boolean): void {
    try {
      writeDeepSeekHarnessLease(this.path, {
        schemaVersion: DEEPSEEK_HARNESS_LEASE_SCHEMA_VERSION,
        ownerId: this.ownerId,
        ownerPid: process.pid,
        ownerStartIdentity: this.ownerStartIdentity ?? "",
        createdAt: this.createdAt,
        updatedAt: Date.now(),
      })
    } catch (error) {
      if (required) throw error
      console.warn("[DeepSeek Harness] 无法刷新窗口生命周期租约：", safeLeaseError(error))
    }
  }
}

export function writeDeepSeekHarnessLease(path: string, value: DeepSeekHarnessLease | LegacyLease): void {
  const temporary = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

export async function deepSeekHarnessProcessStartIdentity(pid: number): Promise<string> {
  if (process.platform === "win32") {
    const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
    const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 5_000,
    })
    const identity = stdout.trim()
    if (!identity) throw new Error("无法读取 Windows 进程启动标识")
    return identity
  }
  if (process.platform === "linux") {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u)
    const started = fields[19]
    const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
    if (!started || !boot) throw new Error("无法读取 Linux 进程启动标识")
    return `${boot}:${started}`
  }
  const { stdout } = await exec("ps", ["-p", String(pid), "-o", "lstart="], { timeout: 5_000 })
  const identity = stdout.trim()
  if (!identity) throw new Error("无法读取进程启动标识")
  return identity
}

async function inspectLease(path: string, now: number): Promise<OwnerState> {
  let value: DeepSeekHarnessLease | LegacyLease
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as DeepSeekHarnessLease | LegacyLease
  } catch {
    return "unknown"
  }
  if (isLeaseV2(value)) {
    if (now - value.updatedAt <= DEEPSEEK_HARNESS_LEASE_FRESH_MS) return "live"
    return inspectOwner(value.ownerPid, value.ownerStartIdentity)
  }
  return typeof value.updatedAt === "number" && now - value.updatedAt <= DEEPSEEK_HARNESS_LEASE_FRESH_MS
    ? "live"
    : "dead"
}

async function inspectOwner(pid: number, expected: string): Promise<OwnerState> {
  try {
    process.kill(pid, 0)
  } catch (error) {
    return isMissingProcess(error) ? "dead" : "unknown"
  }
  try {
    return (await deepSeekHarnessProcessStartIdentity(pid)) === expected ? "live" : "dead"
  } catch {
    return "unknown"
  }
}

function isLeaseV2(value: DeepSeekHarnessLease | LegacyLease): value is DeepSeekHarnessLease {
  return (
    "schemaVersion" in value &&
    value.schemaVersion === DEEPSEEK_HARNESS_LEASE_SCHEMA_VERSION &&
    typeof value.ownerId === "string" &&
    typeof value.ownerPid === "number" &&
    typeof value.ownerStartIdentity === "string" &&
    value.ownerStartIdentity.length > 0 &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  )
}

function isMissingProcess(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ESRCH"
}

function safeLeaseError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[\r\n]+/gu, " ").slice(0, 240) : "未知错误"
}

const coordinators = new Map<string, DeepSeekHarnessLeaseCoordinator>()

export function getDeepSeekHarnessLeaseCoordinator(root: string): DeepSeekHarnessLeaseCoordinator {
  const key = resolve(root)
  const existing = coordinators.get(key)
  if (existing) return existing
  const coordinator = new DeepSeekHarnessLeaseCoordinator(key)
  coordinators.set(key, coordinator)
  return coordinator
}
