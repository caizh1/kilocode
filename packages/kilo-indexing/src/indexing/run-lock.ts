import { createHash } from "crypto"
import { mkdir, readFile, rm, writeFile } from "fs/promises"
import path from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "indexing-run-lock" })
const STALE_MS = 120_000
const HEARTBEAT_MS = 30_000

type LockInfo = {
  runId: string
  root: string
  pid: number
  startedAt: number
  heartbeatAt: number
}

export class IndexingRunLock {
  private timer: ReturnType<typeof setInterval> | undefined

  private constructor(
    public readonly runId: string,
    private readonly dir: string,
    private readonly root: string,
  ) {}

  static async acquire(input: { cacheDirectory: string; workspacePath: string }): Promise<IndexingRunLock | undefined> {
    const dir = lockDir(input.cacheDirectory, input.workspacePath)
    const runId = globalThis.crypto.randomUUID()
    const lock = new IndexingRunLock(runId, dir, input.workspacePath)

    try {
      await mkdir(dir, { recursive: false })
      await lock.write()
      lock.start()
      return lock
    } catch (err) {
      const code = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined
      if (code !== "EEXIST") throw err
    }

    const stale = await isStale(dir)
    if (!stale) return undefined

    log.warn("removing stale indexing lock", { dir })
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: false })
    await lock.write()
    lock.start()
    return lock
  }

  async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await rm(this.dir, { recursive: true, force: true })
  }

  private start(): void {
    this.timer = setInterval(() => void this.write(), HEARTBEAT_MS)
    this.timer.unref?.()
  }

  private async write(): Promise<void> {
    const now = Date.now()
    const info: LockInfo = {
      runId: this.runId,
      root: this.root,
      pid: globalThis.process?.pid ?? 0,
      startedAt: now,
      heartbeatAt: now,
    }
    await writeFile(path.join(this.dir, "lock.json"), `${JSON.stringify(info, null, 2)}\n`, "utf-8")
  }
}

async function isStale(dir: string): Promise<boolean> {
  try {
    const raw = await readFile(path.join(dir, "lock.json"), "utf-8")
    const info = JSON.parse(raw) as Partial<LockInfo>
    const heartbeat = typeof info.heartbeatAt === "number" ? info.heartbeatAt : 0
    return Date.now() - heartbeat > STALE_MS
  } catch {
    return true
  }
}

function lockDir(cacheDirectory: string, workspacePath: string): string {
  const hash = createHash("sha256").update(workspacePath).digest("hex")
  return path.join(cacheDirectory, `indexing-lock-${hash}`)
}
