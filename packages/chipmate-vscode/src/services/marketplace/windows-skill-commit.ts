import * as fs from "fs/promises"
import * as path from "path"
import { createHash, randomUUID } from "crypto"
import { validateSkillFiles, type SkillInputFile } from "@chipmate/skill-spec"

export type SkillInstallScope = "project" | "global"

export type SkillCopyPhase =
  | "prepared"
  | "backup-ready"
  | "manifest-hidden"
  | "copying"
  | "committed"

export interface SkillCopyTransactionRecord {
  version: 1
  id: string
  scope: SkillInstallScope
  target: string
  staging: string
  backup: string
  sourceSha256: string
  snapshotSha256: string
  fileModes?: Record<string, number>
  backupSha256?: string
  previousExists: boolean
  phase: SkillCopyPhase
  createdAt: string
}

export interface SkillCopyCommitOptions {
  writeFile?: (file: string, data: Buffer, mode?: number) => Promise<void>
  onPhase?: (phase: SkillCopyPhase, record: SkillCopyTransactionRecord) => Promise<void>
  wait?: (milliseconds: number) => Promise<void>
}

export interface SkillCopyCommitInput {
  base: string
  id: string
  scope: SkillInstallScope
  sourceSha256: string
  snapshotSha256: string
  files: SkillInputFile[]
  allowUpdate: boolean
}

const MANIFEST = "SKILL.md"
const TRANSACTIONS = ".skill-install-transactions"

export async function commitWindowsSkillByCopy(
  input: SkillCopyCommitInput,
  options: SkillCopyCommitOptions = {},
): Promise<void> {
  const root = transactionRoot(input.base)
  await fs.mkdir(path.join(root, ".locks"), { recursive: true })
  await withLock(root, input.id, options, async () => {
    await recoverOne(input.base, input.id, options)
    const target = path.join(input.base, input.id)
    const previousExists = await exists(target)
    if (previousExists && !input.allowUpdate) throw new SkillAlreadyInstalledError()

    const home = path.join(root, input.id)
    const staging = path.join(home, `staging-${randomUUID()}`)
    const backup = path.join(home, `backup-${randomUUID()}`)
    const record: SkillCopyTransactionRecord = {
      version: 1,
      id: input.id,
      scope: input.scope,
      target,
      staging,
      backup,
      sourceSha256: input.sourceSha256,
      snapshotSha256: input.snapshotSha256,
      fileModes: Object.fromEntries(input.files.map((file) => [file.path, file.mode ?? portableMode(file.path)])),
      previousExists,
      phase: "prepared",
      createdAt: new Date().toISOString(),
    }

    await fs.mkdir(home, { recursive: true })
    try {
      await writeFiles(staging, input.files, options)
      await verifySnapshot(staging, input.id, input.snapshotSha256, record.fileModes)
      await saveRecord(home, record)
      await notify(record, options)

      if (previousExists) {
        const before = await directoryDigest(target)
        await copyDirectory(target, backup, options)
        const copied = await directoryDigest(backup)
        if (copied !== before) throw new Error("Skill backup verification failed")
        record.backupSha256 = before
      }
      await advance(home, record, "backup-ready", options)

      await advance(home, record, "manifest-hidden", options)
      await fs.mkdir(target, { recursive: true })
      await fs.rm(path.join(target, MANIFEST), { force: true })
      await clearDirectory(target)
      await advance(home, record, "copying", options)
      await copySkillManifestLast(staging, target, options)
      await advance(home, record, "committed", options)
      await verifySnapshot(target, input.id, input.snapshotSha256, record.fileModes)
      await cleanupTransaction(home, record)
    } catch (error) {
      if (record.phase !== "prepared" && record.phase !== "backup-ready") {
        await rollback(record, options).catch((rollbackError) => {
          throw new AggregateError([error, rollbackError], "Skill install failed and rollback failed")
        })
      }
      await cleanupTransaction(home, record)
      throw error
    }
  })
}

export async function recoverWindowsSkillTransactions(
  base: string,
  options: SkillCopyCommitOptions = {},
): Promise<void> {
  const root = transactionRoot(base)
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".locks") continue
    await withLock(root, entry.name, options, () => recoverOne(base, entry.name, options))
  }
}

export async function verifyInstalledSkillSnapshot(target: string, id: string, expected: string): Promise<void> {
  await verifySnapshot(target, id, expected)
}

export class SkillAlreadyInstalledError extends Error {
  constructor() {
    super("Skill already installed. Uninstall it before installing again.")
    this.name = "SkillAlreadyInstalledError"
  }
}

async function recoverOne(base: string, id: string, options: SkillCopyCommitOptions): Promise<void> {
  const home = path.join(transactionRoot(base), id)
  const record = await readRecord(home)
  if (!record) {
    await fs.rm(home, { recursive: true, force: true })
    return
  }
  if (record.id !== id || path.resolve(record.target) !== path.resolve(path.join(base, id))) {
    throw new Error(`Invalid Skill transaction record for ${id}`)
  }
  if (!inside(home, record.staging) || !inside(home, record.backup)) {
    throw new Error(`Invalid Skill transaction paths for ${id}`)
  }
  if (record.phase === "committed") {
    const committed = await verifySnapshot(
      record.target,
      record.id,
      record.snapshotSha256,
      record.fileModes ?? "portable",
    )
      .then(() => true)
      .catch(() => false)
    if (committed) {
      await cleanupTransaction(home, record)
      return
    }
  }
  if (record.phase === "prepared" || record.phase === "backup-ready") {
    await cleanupTransaction(home, record)
    return
  }
  await rollback(record, options)
  await cleanupTransaction(home, record)
}

async function rollback(record: SkillCopyTransactionRecord, options: SkillCopyCommitOptions): Promise<void> {
  await fs.mkdir(record.target, { recursive: true })
  await fs.rm(path.join(record.target, MANIFEST), { force: true })
  await clearDirectory(record.target)
  if (!record.previousExists) {
    await fs.rm(record.target, { recursive: true, force: true })
    return
  }
  if (!(await exists(record.backup))) throw new Error("Skill rollback backup is missing")
  await copySkillManifestLast(record.backup, record.target, options)
  if (record.backupSha256 && (await directoryDigest(record.target)) !== record.backupSha256) {
    throw new Error("Skill rollback verification failed")
  }
}

async function copySkillManifestLast(
  source: string,
  target: string,
  options: SkillCopyCommitOptions,
): Promise<void> {
  const files = await collectFiles(source)
  const manifest = files.find((file) => file.path === MANIFEST)
  if (!manifest) throw new Error("Skill staging manifest is missing")
  await writeFiles(
    target,
    files.filter((file) => file.path !== MANIFEST),
    options,
  )
  await writeOne(target, manifest, options)
}

async function copyDirectory(source: string, target: string, options: SkillCopyCommitOptions): Promise<void> {
  await writeFiles(target, await collectFiles(source), options)
}

async function writeFiles(root: string, files: SkillInputFile[], options: SkillCopyCommitOptions): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  for (const file of files.toSorted((first, second) => first.path.localeCompare(second.path))) {
    await writeOne(root, file, options)
  }
}

async function writeOne(root: string, file: SkillInputFile, options: SkillCopyCommitOptions): Promise<void> {
  const target = path.join(root, ...file.path.split("/"))
  await fs.mkdir(path.dirname(target), { recursive: true })
  if (options.writeFile) {
    await options.writeFile(target, Buffer.from(file.data), file.mode)
    return
  }
  await fs.writeFile(target, file.data, { mode: file.mode ?? 0o644 })
}

async function collectFiles(root: string): Promise<SkillInputFile[]> {
  const files: SkillInputFile[] = []
  const visit = async (current: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries.toSorted((first, second) => first.name.localeCompare(second.name))) {
      const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name
      const file = path.join(current, entry.name)
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) throw new Error(`Skill contains a symbolic link: ${relative}`)
      if (stat.isDirectory()) {
        await visit(file, relative)
        continue
      }
      if (!stat.isFile()) throw new Error(`Skill contains an unsupported entry: ${relative}`)
      files.push({ path: relative, data: await fs.readFile(file), mode: stat.mode & 0o777 })
    }
  }
  await visit(root, "")
  return files
}

async function verifySnapshot(
  root: string,
  id: string,
  expected: string,
  modes?: Readonly<Record<string, number>> | "portable",
): Promise<void> {
  const collected = await collectFiles(root)
  const files = modes
    ? collected.map((file) => ({
        ...file,
        mode: modes === "portable" ? portableMode(file.path) : (modes[file.path] ?? portableMode(file.path)),
      }))
    : collected
  const manifests = files.filter((file) => path.posix.basename(file.path).toLocaleLowerCase() === "skill.md")
  if (manifests.length !== 1 || manifests[0]?.path !== MANIFEST) throw new Error("Skill snapshot must contain one root SKILL.md")
  const snapshot = validateSkillFiles(id, files)
  if (!snapshot.valid || snapshot.spec.id !== id) throw new Error("Installed Skill snapshot failed identity validation")
  if (snapshot.snapshotSha256 !== expected) throw new Error("Installed Skill snapshot SHA-256 mismatch")
}

function portableMode(file: string): number {
  return file.startsWith("scripts/") ? 0o755 : 0o644
}

async function directoryDigest(root: string): Promise<string> {
  const hash = createHash("sha256")
  for (const file of await collectFiles(root)) {
    hash.update(file.path.normalize("NFC"))
    hash.update("\0")
    hash.update(file.data)
    hash.update("\0")
  }
  return hash.digest("hex")
}

async function clearDirectory(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  for (const entry of entries) await fs.rm(path.join(root, entry.name), { recursive: true, force: true })
}

async function advance(
  home: string,
  record: SkillCopyTransactionRecord,
  phase: SkillCopyPhase,
  options: SkillCopyCommitOptions,
): Promise<void> {
  record.phase = phase
  await saveRecord(home, record)
  await notify(record, options)
}

async function notify(record: SkillCopyTransactionRecord, options: SkillCopyCommitOptions): Promise<void> {
  await options.onPhase?.(record.phase, { ...record })
}

async function saveRecord(home: string, record: SkillCopyTransactionRecord): Promise<void> {
  const file = path.join(home, "record.json")
  const temporary = path.join(home, `record-${randomUUID()}.tmp`)
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8")
  await fs.rename(temporary, file)
}

async function readRecord(home: string): Promise<SkillCopyTransactionRecord | undefined> {
  const content = await fs.readFile(path.join(home, "record.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!content) return undefined
  const value = JSON.parse(content) as SkillCopyTransactionRecord
  if (value.version !== 1 || !value.id || !value.target || !value.staging || !value.backup) {
    throw new Error("Invalid Skill transaction record")
  }
  return value
}

async function cleanupTransaction(home: string, record: SkillCopyTransactionRecord): Promise<void> {
  await Promise.all([
    fs.rm(record.staging, { recursive: true, force: true }),
    fs.rm(record.backup, { recursive: true, force: true }),
  ])
  await fs.rm(home, { recursive: true, force: true })
}

async function withLock<T>(
  root: string,
  id: string,
  options: SkillCopyCommitOptions,
  task: () => Promise<T>,
): Promise<T> {
  const lock = path.join(root, ".locks", `${id}.lock`)
  const wait = options.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  let handle: fs.FileHandle | undefined
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      handle = await fs.open(lock, "wx")
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (await staleLock(lock)) {
        await fs.rm(lock, { force: true })
        continue
      }
      await wait(50)
    }
  }
  if (!handle) throw new Error(`Timed out waiting for Skill install lock: ${id}`)
  try {
    return await task()
  } finally {
    await handle.close()
    await fs.rm(lock, { force: true })
  }
}

async function staleLock(file: string): Promise<boolean> {
  const content = await fs.readFile(file, "utf8").catch(() => "")
  const parsed = (() => {
    try {
      return JSON.parse(content || "{}") as { pid?: unknown }
    } catch {
      return {}
    }
  })()
  const pid = Number(parsed.pid)
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
  }
}

function transactionRoot(base: string): string {
  return path.join(path.dirname(base), TRANSACTIONS)
}

function inside(root: string, file: string): boolean {
  return path.resolve(file).startsWith(`${path.resolve(root)}${path.sep}`)
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}
