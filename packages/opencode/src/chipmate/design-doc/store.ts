import { createHash, randomUUID } from "crypto"
import { lstat, mkdir, open, readdir, readFile, rename, rm, stat } from "fs/promises"
import path from "path"
import { Schema } from "effect"
import { ProductProfile } from "@/chipmate/product-profile"
import { DesignDocJob as DesignDocJobSchema, type Artifact, type DesignDocJob } from "./domain"

const jobPrefix = "design-doc-"
const manifestName = "job.json"
const localLocks = new Map<string, Promise<void>>()

export class JobStoreError extends Error {
  constructor(
    readonly code: "JOB_NOT_FOUND" | "REVISION_CONFLICT" | "INVALID_ARTIFACT" | "LOCK_TIMEOUT",
    message: string,
  ) {
    super(message)
    this.name = "JobStoreError"
  }
}

export namespace DesignDocStore {
  export function root(workspace: string) {
    return ProductProfile.project(workspace, "artifacts")
  }

  export function directory(workspace: string, jobID: string) {
    return path.join(root(workspace), `${jobPrefix}${jobID}`)
  }

  export async function create(job: DesignDocJob) {
    const parent = root(job.workspace)
    const target = directory(job.workspace, job.id)
    await mkdir(parent, { recursive: true, mode: 0o700 })
    await mkdir(target, { recursive: false, mode: 0o700 })
    await atomicJSON(path.join(target, manifestName), job)
    return job
  }

  export async function get(workspace: string, jobID: string) {
    const file = path.join(directory(workspace, jobID), manifestName)
    const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new JobStoreError("JOB_NOT_FOUND", `DesignDoc Job 不存在：${jobID}`)
      throw error
    })
    const decoded = await Schema.decodeUnknownPromise(DesignDocJobSchema)(JSON.parse(raw))
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已验证全部字段，克隆只把只读容器转换为内部可变领域对象。
    return structuredClone(decoded) as DesignDocJob
  }

  export async function list(workspace: string) {
    const parent = root(workspace)
    const entries = await readdir(parent, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    const jobs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(jobPrefix))
        .map((entry) => get(workspace, entry.name.slice(jobPrefix.length)).catch(() => undefined)),
    )
    return jobs.filter((job): job is DesignDocJob => job !== undefined).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  export async function acquireRunLease(workspace: string, jobID: string) {
    const file = path.join(directory(workspace, jobID), ".runner.lock")
    const token = `${process.pid} ${randomUUID()}`
    for (let attempt = 0; attempt < 2; attempt++) {
      const handle = await open(file, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") return undefined
        throw error
      })
      if (handle) {
        try {
          await handle.writeFile(`${token}\n`)
          await handle.sync()
        } finally {
          await handle.close()
        }
        return async () => {
          const owner = await readFile(file, "utf8").catch(() => undefined)
          if (owner?.trim() === token) await rm(file, { force: true })
        }
      }
      const owner = await readFile(file, "utf8").catch(() => undefined)
      const pid = Number.parseInt(owner?.trim().split(/\s+/, 1)[0] ?? "", 10)
      if (Number.isInteger(pid) && processAlive(pid)) return undefined
      const info = await stat(file).catch(() => undefined)
      if (!Number.isInteger(pid) && info && Date.now() - info.mtimeMs < 5_000) return undefined
      await rm(file, { force: true })
    }
    return undefined
  }

  export async function update(
    workspace: string,
    jobID: string,
    expectedRevision: number,
    mutate: (job: DesignDocJob) => DesignDocJob,
  ) {
    return withLock(workspace, jobID, async () => {
      const current = await get(workspace, jobID)
      if (current.revision !== expectedRevision) {
        throw new JobStoreError(
          "REVISION_CONFLICT",
          `Job revision 已变化：期望 ${expectedRevision}，实际 ${current.revision}`,
        )
      }
      return save(workspace, jobID, current, mutate)
    })
  }

  export async function transact(
    workspace: string,
    jobID: string,
    mutate: (job: DesignDocJob) => DesignDocJob,
  ) {
    return withLock(workspace, jobID, async () => {
      const current = await get(workspace, jobID)
      return save(workspace, jobID, current, mutate)
    })
  }

  export async function writeJSON(workspace: string, jobID: string, name: string, value: unknown) {
    return writeArtifact(workspace, jobID, name, Buffer.from(`${JSON.stringify(value, null, 2)}\n`), "application/json")
  }

  export async function writeText(workspace: string, jobID: string, name: string, value: string, mediaType: string) {
    return writeArtifact(workspace, jobID, name, Buffer.from(value), mediaType)
  }

  export async function writeBytes(
    workspace: string,
    jobID: string,
    name: string,
    value: Uint8Array,
    mediaType: string,
  ) {
    return writeArtifact(workspace, jobID, name, value, mediaType)
  }

  export async function readDeclaredArtifact(job: DesignDocJob, artifactID: string) {
    const artifact = job.artifacts.find((item) => item.id === artifactID)
    if (!artifact) throw new JobStoreError("INVALID_ARTIFACT", `Artifact 不存在：${artifactID}`)
    const target = artifactPath(job.workspace, job.id, artifact.path)
    await assertArtifactTarget(job.workspace, job.id, artifact.path)
    const content = await readFile(target.absolute)
    if (sha256(content) !== artifact.sha256) {
      throw new JobStoreError("INVALID_ARTIFACT", `Artifact 校验和不匹配：${artifactID}`)
    }
    return { artifact, content }
  }

  export async function describe(workspace: string, jobID: string, name: string, mediaType: string) {
    const file = artifactPath(workspace, jobID, name)
    await assertArtifactTarget(workspace, jobID, name)
    const content = await readFile(file.absolute)
    return artifactMetadata(file.relative, content, mediaType)
  }

  export async function assertArtifactTarget(workspace: string, jobID: string, name: string) {
    const file = artifactPath(workspace, jobID, name)
    const jobRoot = directory(workspace, jobID)
    const rootInfo = await lstat(jobRoot).catch(() => undefined)
    if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new JobStoreError("INVALID_ARTIFACT", "Job 产物目录不是可信普通目录")
    }

    let current = jobRoot
    for (const segment of file.relative.split("/")) {
      current = path.join(current, segment)
      const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (!info) break
      if (info.isSymbolicLink()) {
        throw new JobStoreError("INVALID_ARTIFACT", `Artifact 路径包含符号链接：${file.relative}`)
      }
      if (current !== file.absolute && !info.isDirectory()) {
        throw new JobStoreError("INVALID_ARTIFACT", `Artifact 父路径不是目录：${file.relative}`)
      }
    }
  }
}

async function save(
  workspace: string,
  jobID: string,
  current: DesignDocJob,
  mutate: (job: DesignDocJob) => DesignDocJob,
) {
  const next = mutate(structuredClone(current))
  const saved = { ...next, revision: current.revision + 1, updatedAt: Date.now() }
  const decoded = await Schema.decodeUnknownPromise(DesignDocJobSchema)(saved)
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已验证全部字段，克隆只把只读容器转换为内部可变领域对象。
  const mutable = structuredClone(decoded) as DesignDocJob
  await atomicJSON(path.join(DesignDocStore.directory(workspace, jobID), manifestName), mutable)
  return mutable
}

async function writeArtifact(workspace: string, jobID: string, name: string, value: Uint8Array, mediaType: string) {
  return withLock(workspace, jobID, async () => {
    const job = await DesignDocStore.get(workspace, jobID)
    if (["paused", "failed", "blocked", "completed", "cancelled"].includes(job.status)) {
      throw new JobStoreError("INVALID_ARTIFACT", `Job 状态 ${job.status} 禁止写入新产物`)
    }
    const file = artifactPath(workspace, jobID, name)
    await DesignDocStore.assertArtifactTarget(workspace, jobID, name)
    await mkdir(path.dirname(file.absolute), { recursive: true, mode: 0o700 })
    await atomicWrite(file.absolute, value)
    return artifactMetadata(file.relative, value, mediaType)
  })
}

function artifactPath(workspace: string, jobID: string, name: string) {
  const root = DesignDocStore.directory(workspace, jobID)
  const relative = portable(path.normalize(name))
  if (!relative || relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
    throw new JobStoreError("INVALID_ARTIFACT", "Artifact 路径越界")
  }
  const absolute = path.resolve(root, relative)
  const boundary = path.relative(root, absolute)
  if (boundary.startsWith(`..${path.sep}`) || boundary === ".." || path.isAbsolute(boundary)) {
    throw new JobStoreError("INVALID_ARTIFACT", "Artifact 路径越界")
  }
  return { relative, absolute }
}

async function withLock<T>(workspace: string, jobID: string, callback: () => Promise<T>) {
  const lock = path.join(DesignDocStore.directory(workspace, jobID), ".job.lock")
  const previous = localLocks.get(lock) ?? Promise.resolve()
  let release = () => {}
  const turn = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.catch(() => {}).then(() => turn)
  localLocks.set(lock, queued)
  await previous.catch(() => {})
  try {
    return await withFileLock(lock, jobID, callback)
  } finally {
    release()
    if (localLocks.get(lock) === queued) localLocks.delete(lock)
  }
}

async function withFileLock<T>(lock: string, jobID: string, callback: () => Promise<T>) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const handle = await open(lock, "wx", 0o600).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error
      const info = await stat(lock).catch(() => undefined)
      if (info && Date.now() - info.mtimeMs > 30_000) await rm(lock, { force: true })
      return undefined
    })
    if (handle) {
      try {
        await handle.writeFile(`${process.pid} ${Date.now()}\n`)
        await handle.sync()
        return await callback()
      } finally {
        await handle.close()
        await rm(lock, { force: true })
      }
    }
    await Bun.sleep(25)
  }
  throw new JobStoreError("LOCK_TIMEOUT", `Job 锁等待超时：${jobID}`)
}

async function atomicJSON(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await atomicWrite(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`))
}

async function atomicWrite(file: string, value: Uint8Array) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temp, "wx", 0o600)
  let renamed = false
  try {
    await handle.writeFile(value)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temp, file)
    renamed = true
    await syncDirectory(path.dirname(file))
  } finally {
    if (!renamed) await rm(temp, { force: true })
  }
}

async function syncDirectory(directory: string) {
  if (process.platform === "win32") return
  const handle = await open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function artifactMetadata(path: string, content: Uint8Array, mediaType: string) {
  return { path, sha256: sha256(content), mediaType }
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

function portable(value: string) {
  return value.split(path.sep).join("/")
}

export function artifact(
  input: ReturnType<typeof artifactMetadata> & {
    id: string
    workItemID: string
    kind: Artifact["kind"]
    status: Artifact["status"]
  },
): Artifact {
  return { ...input, createdAt: Date.now() }
}
