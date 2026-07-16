import { mkdir, readFile, rm, writeFile } from "fs/promises"
import path from "path"
import { Log } from "../util/log"
import { normalizeWorkspace, workspaceKey } from "./workspace-key"

const log = Log.create({ service: "indexing-run-lock" })
const STALE_MS = 120_000
const HEARTBEAT_MS = 30_000
const DEFAULT_RETRY_MS = 10_000
const LOCK_VERSION = 2

type LockInfo = {
  runId: string
  workspacePath: string
  root?: string
  pid: number
  appVersion?: string
  lockVersion?: number
  startedAt: number
  heartbeatAt: number
}

export type IndexingRunLockAcquireResult =
  | {
      status: "acquired"
      lock: IndexingRunLock
      staleRemoved?: boolean
      staleReason?: string
      previous?: Partial<LockInfo>
    }
  | {
      status: "held"
      owner?: Partial<LockInfo>
      reason: string
      retryAfterMs: number
    }

export class IndexingRunLock {
  private timer: ReturnType<typeof setInterval> | undefined
  private task: Promise<void> = Promise.resolve()
  private readonly startedAt = Date.now()

  private constructor(
    public readonly runId: string,
    private readonly dir: string,
    private readonly workspacePath: string,
  ) {}

  static async acquire(input: {
    cacheDirectory: string
    workspacePath: string
    kind?: "code" | "documents"
  }): Promise<IndexingRunLockAcquireResult> {
    const workspace = normalizeWorkspace(input.workspacePath)
    const dir = lockDir(input.cacheDirectory, workspace, input.kind)
    const runId = globalThis.crypto.randomUUID()
    const lock = new IndexingRunLock(runId, dir, workspace)
    await mkdir(input.cacheDirectory, { recursive: true })

    try {
      await mkdir(dir, { recursive: false })
      await lock.write()
      lock.start()
      log.info("indexing lock acquired", { visible: true, workspacePath: workspace, runId })
      return { status: "acquired", lock }
    } catch (err) {
      const code = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined
      if (code !== "EEXIST") throw err
    }

    const stale = await checkStale(dir, workspace)
    if (!stale.stale) {
      log.warn("indexing lock is held", {
        visible: true,
        workspacePath: workspace,
        reason: stale.reason,
        retryAfterMs: retryMs(),
        ownerPid: stale.info?.pid,
        ownerRunId: stale.info?.runId,
        heartbeatAgeMs: stale.info?.heartbeatAt ? Date.now() - stale.info.heartbeatAt : undefined,
      })
      return {
        status: "held",
        owner: stale.info,
        reason: stale.reason,
        retryAfterMs: retryMs(),
      }
    }

    log.warn("removing stale indexing lock", {
      visible: true,
      workspacePath: workspace,
      dir,
      reason: stale.reason,
      ownerPid: stale.info?.pid,
      ownerRunId: stale.info?.runId,
    })
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: false })
    await lock.write()
    lock.start()
    log.info("indexing lock acquired after stale cleanup", { visible: true, workspacePath: workspace, runId })
    return {
      status: "acquired",
      lock,
      staleRemoved: true,
      staleReason: stale.reason,
      previous: stale.info,
    }
  }

  async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.task
    if (!(await this.owned())) {
      log.warn("indexing lock release skipped for non-owner", {
        visible: true,
        workspacePath: this.workspacePath,
        runId: this.runId,
      })
      return
    }
    await rm(this.dir, { recursive: true, force: true })
    log.info("indexing lock released", { visible: true, workspacePath: this.workspacePath, runId: this.runId })
  }

  private start(): void {
    this.timer = setInterval(() => {
      const task = this.task.then(() => this.heartbeat())
      this.task = task.catch((err) => {
        log.error("indexing lock heartbeat failed", {
          workspacePath: this.workspacePath,
          runId: this.runId,
          err,
        })
      })
    }, HEARTBEAT_MS)
    this.timer.unref?.()
  }

  private async heartbeat(): Promise<void> {
    if (await this.owned()) {
      await this.write()
      return
    }
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    log.warn("indexing lock heartbeat stopped after ownership changed", {
      visible: true,
      workspacePath: this.workspacePath,
      runId: this.runId,
    })
  }

  private async owned(): Promise<boolean> {
    try {
      const raw = await readFile(path.join(this.dir, "lock.json"), "utf-8")
      const info = JSON.parse(raw) as Partial<LockInfo>
      return info.runId === this.runId
    } catch (err) {
      const code = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined
      if (code !== "ENOENT") {
        log.warn("failed to verify indexing lock ownership", {
          workspacePath: this.workspacePath,
          runId: this.runId,
          err,
        })
      }
      return false
    }
  }

  private async write(): Promise<void> {
    const now = Date.now()
    const info: LockInfo = {
      runId: this.runId,
      workspacePath: this.workspacePath,
      root: this.workspacePath,
      pid: globalThis.process?.pid ?? 0,
      appVersion: globalThis.process?.env?.KILO_APP_VERSION,
      lockVersion: LOCK_VERSION,
      startedAt: this.startedAt,
      heartbeatAt: now,
    }
    await writeFile(path.join(this.dir, "lock.json"), `${JSON.stringify(info, null, 2)}\n`, "utf-8")
  }
}

async function checkStale(
  dir: string,
  workspacePath: string,
): Promise<{ stale: boolean; reason: string; info?: Partial<LockInfo> }> {
  try {
    const raw = await readFile(path.join(dir, "lock.json"), "utf-8")
    const info = JSON.parse(raw) as Partial<LockInfo>
    const root = info.workspacePath ?? info.root
    if (root && normalizeWorkspace(root) !== workspacePath) {
      return { stale: false, reason: "workspace mismatch", info }
    }

    const heartbeat = typeof info.heartbeatAt === "number" ? info.heartbeatAt : 0
    const pid = typeof info.pid === "number" ? info.pid : 0
    if (pid > 0) {
      if (!pidAlive(pid)) return { stale: true, reason: "owner pid exited", info }
      const reason = Date.now() - heartbeat > STALE_MS ? "owner pid alive with stale heartbeat" : "active heartbeat"
      return { stale: false, reason, info }
    }
    if (Date.now() - heartbeat > STALE_MS) {
      return { stale: true, reason: "heartbeat timeout", info }
    }
    return { stale: false, reason: "active heartbeat", info }
  } catch {
    return { stale: true, reason: "malformed lock" }
  }
}

function lockDir(cacheDirectory: string, workspacePath: string, kind: "code" | "documents" = "code"): string {
  if (kind === "documents") {
    return path.join(cacheDirectory, `document-indexing-lock-${workspaceKey(workspacePath)}`)
  }
  return path.join(cacheDirectory, `indexing-lock-${workspaceKey(workspacePath)}`)
}

function pidAlive(pid: number): boolean {
  try {
    globalThis.process?.kill(pid, 0)
    return true
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined
    return code === "EPERM"
  }
}

function retryMs(): number {
  const raw = globalThis.process?.env?.KILO_INDEXING_LOCK_RETRY_MS
  const ms = raw ? Number(raw) : DEFAULT_RETRY_MS
  if (!Number.isFinite(ms) || ms < 0) return DEFAULT_RETRY_MS
  return ms
}
