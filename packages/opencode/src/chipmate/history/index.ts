import { Database } from "bun:sqlite"
import { createHash } from "crypto"
import { createReadStream, createWriteStream, existsSync } from "fs"
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, statfs, writeFile } from "fs/promises"
import { hostname, tmpdir } from "os"
import path from "path"
import { Transform, Writable } from "stream"
import { pipeline } from "stream/promises"
import { crc32 } from "zlib"
import { openPromise, type Entry, type ZipFile as ReadZipFile } from "yauzl"
import { ZipFile as WriteZipFile } from "yazl"
import { Flock } from "@opencode-ai/core/util/flock"
import { Hash } from "@opencode-ai/core/util/hash"
import { Global } from "@opencode-ai/core/global"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Effect, Layer } from "effect"
import { JsonMigration } from "@/chipmate/storage/json-migration"

const FORMAT_VERSION = 1
const SANITIZED_BACKUP_MARKER = "chat-history-backup/v1/sanitized"
const MAX_ENTRY_BYTES = 4 * 1024 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 100_000
const TABLES = ["project", "project_directory", "session", "message", "part", "todo"] as const
const JSON_FOLDERS = ["project", "session", "message", "part", "todo"] as const

export type Phase = "scan" | "backup" | "normalize" | "merge" | "verify" | "complete" | "error"
export type Progress = {
  phase: Phase
  current: number
  total: number
  message: string
  result: Record<string, unknown> | null
}

export type Summary = {
  backup: string
  sources: number
  families: number
  imported: number
  skipped: number
  failed: number
  errors: string[]
}

type ManifestFile = {
  path: string
  size: number
  sha256: string
  kind: "database" | "json"
}

type Manifest = {
  format: "chipmate-chat-history-backup"
  version: number
  createdAt: string
  files: ManifestFile[]
  statistics: Record<string, number>
}

type Source = { label: string; file: string; cleanup?: string; issues?: string[] }
type Row = Record<string, string | number | null>

function emit(
  progress: ((event: Progress) => void) | undefined,
  event: Omit<Progress, "result"> & { result?: Progress["result"] },
) {
  progress?.({ ...event, result: event.result ?? null })
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function sqlIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

async function hashFile(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

function missingProcess(pid: number) {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return !!error && typeof error === "object" && "code" in error && error.code === "ESRCH"
  }
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return
  return error.code
}

async function recoverDeadMigrationLock(data: string) {
  const lock = path.join(data, "migration-locks", `${Hash.fast("chat-history-migration")}.lock`)
  const metadata = path.join(lock, "meta.json")
  const read = async () => {
    try {
      const value = JSON.parse(await readFile(metadata, "utf8")) as unknown
      if (!value || typeof value !== "object") return
      const record = value as Record<string, unknown>
      if (
        typeof record.token !== "string" ||
        typeof record.pid !== "number" ||
        !Number.isInteger(record.pid) ||
        record.pid <= 0 ||
        record.hostname !== hostname()
      )
        return
      return { token: record.token, pid: record.pid }
    } catch (error) {
      if (error instanceof SyntaxError || errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return
      throw error
    }
  }
  const observed = await read()
  if (!observed || !missingProcess(observed.pid)) return
  const breaker = `${lock}.breaker`
  try {
    await mkdir(breaker, { mode: 0o700 })
  } catch (error) {
    if (errorCode(error) === "EEXIST") return
    throw error
  }
  try {
    const current = await read()
    if (!current || current.token !== observed.token || !missingProcess(current.pid)) return
    await rm(lock, { recursive: true, force: true })
  } finally {
    await rm(breaker, { recursive: true, force: true }).catch(() => undefined)
  }
}

function hashRows(hash: ReturnType<typeof createHash>, label: string, row: Row) {
  hash.update(`${label}{`)
  for (const [key, value] of Object.entries(row).toSorted(([a], [b]) => a.localeCompare(b))) {
    hash.update(`${key.length}:${key}=`)
    if (value === null) {
      hash.update("null;")
      continue
    }
    const text = String(value)
    hash.update(`${typeof value}:${text.length}:`)
    hash.update(text)
    hash.update(";")
  }
  hash.update("}\n")
}

function databaseStats(file: string) {
  const db = new Database(file, { readonly: true })
  try {
    return Object.fromEntries(
      TABLES.map((table) => {
        const found = db
          .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
        if (!found) return [table, 0]
        return [table, db.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()?.count ?? 0]
      }),
    )
  } finally {
    db.close()
  }
}

async function snapshotDatabase(source: string, destination: string) {
  const db = new Database(source, { readonly: true })
  try {
    db.exec(`PRAGMA busy_timeout=5000; VACUUM INTO ${sqlString(destination)}`)
  } finally {
    db.close()
  }
  const check = new Database(destination, { readonly: true })
  try {
    const integrity = check.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check
    if (integrity !== "ok") throw new Error(`数据库快照完整性检查失败：${integrity ?? "未知错误"}`)
  } finally {
    check.close()
  }
}

async function sanitizeSnapshot(file: string) {
  await ensureCurrentSchema(file)
  const db = new Database(file)
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    db.exec("PRAGMA foreign_keys=OFF")
    const keep = new Set<string>([...TABLES, "data_migration", "migration", "__drizzle_migrations"])
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
    for (const table of tables) {
      if (keep.has(table.name) || !tableExists(db, table.name)) continue
      db.exec(`DROP TABLE ${sqlIdentifier(table.name)}`)
    }
    if (tableExists(db, "session")) {
      const available = columns(db, "session")
      const sensitive = [
        "workspace_id",
        "share_url",
        "metadata",
        "revert",
        "permission",
        "agent",
        "model",
        "time_compacting",
      ].filter((column) => available.has(column))
      if (sensitive.length > 0)
        db.exec(`UPDATE session SET ${sensitive.map((column) => `${sqlIdentifier(column)}=NULL`).join(",")}`)
    }
    if (tableExists(db, "project") && columns(db, "project").has("commands"))
      db.exec(`UPDATE project SET ${sqlIdentifier("commands")}=NULL`)
    db.query("INSERT OR REPLACE INTO data_migration(name,time_completed) VALUES (?,?)").run(
      SANITIZED_BACKUP_MARKER,
      Date.now(),
    )
    db.exec("VACUUM")
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    const integrity = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check
    if (integrity !== "ok") throw new Error(`脱敏快照完整性检查失败：${integrity ?? "未知错误"}`)
  } finally {
    db.close()
  }
  // Schema migration deliberately enables WAL.  A ZIP only carries the main
  // database file, so materialize one final DELETE-journal snapshot after all
  // sanitized changes have been checkpointed instead of archiving a WAL-mode
  // database that may require sibling -wal/-shm files when opened read-only.
  const finalized = `${file}.finalized`
  await snapshotDatabase(file, finalized)
  return finalized
}

async function walk(folder: string, root = folder): Promise<Array<{ file: string; relative: string }>> {
  if (!existsSync(folder)) return []
  const output: Array<{ file: string; relative: string }> = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) output.push(...(await walk(file, root)))
    if (entry.isFile() && entry.name.endsWith(".json")) output.push({ file, relative: path.relative(root, file) })
  }
  return output
}

async function sanitizedJsonFile(source: string, archive: string, temporary: string) {
  let value: unknown
  try {
    value = JSON.parse(await Bun.file(source).text())
  } catch {
    return undefined
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const data = { ...(value as Record<string, unknown>) }
    const folder = archive.split("/")[1]
    if (folder === "project") delete data.commands
    if (folder === "session") {
      for (const key of [
        "workspaceID",
        "share",
        "metadata",
        "revert",
        "permission",
        "agent",
        "model",
        "input",
        "events",
        "contextEpoch",
      ])
        delete data[key]
      if (data.time && typeof data.time === "object") {
        const time = data.time as Record<string, unknown>
        data.time = { created: time.created, updated: time.updated, archived: time.archived }
      }
    }
    value = data
  }
  const target = path.join(temporary, "json", ...archive.split("/"))
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(target, JSON.stringify(value), { mode: 0o600 })
  return target
}

async function createArchive(input: { data: string; target?: string; progress?: (event: Progress) => void }) {
  const backups = path.join(input.data, "migration-backups")
  await mkdir(backups, { recursive: true, mode: 0o700 })
  await chmod(backups, 0o700).catch(() => undefined)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const archive = input.target ?? path.join(backups, `chipmate-chat-history-backup-${stamp}.zip`)
  const partial = archive + ".partial"
  const temporary = await mkdtemp(path.join(tmpdir(), "chipmate-history-backup-"))
  const files: Array<{ source: string; archive: string; kind: ManifestFile["kind"] }> = []
  try {
    const databases = [
      ["chipmate.db", "databases/chipmate.db"],
      ["kilo.db", "databases/kilo.db"],
    ] as const
    for (const [name, archivePath] of databases) {
      const source = path.join(input.data, name)
      if (!existsSync(source)) continue
      const snapshot = path.join(temporary, name)
      await snapshotDatabase(source, snapshot)
      const sanitized = await sanitizeSnapshot(snapshot)
      files.push({ source: sanitized, archive: archivePath, kind: "database" })
    }
    const storage = path.join(input.data, "storage")
    for (const folder of JSON_FOLDERS) {
      for (const item of await walk(path.join(storage, folder), storage)) {
        const archivePath = `storage/${item.relative.replaceAll(path.sep, "/")}`
        const source = await sanitizedJsonFile(item.file, archivePath, temporary)
        if (source) files.push({ source, archive: archivePath, kind: "json" })
      }
    }
    const manifestFiles: ManifestFile[] = []
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!
      const info = await stat(file.source)
      manifestFiles.push({ path: file.archive, size: info.size, sha256: await hashFile(file.source), kind: file.kind })
      emit(input.progress, {
        phase: "backup",
        current: index + 1,
        total: Math.max(files.length, 1),
        message: "正在生成一致性快照并计算校验值",
      })
    }
    const statistics: Record<string, number> = {}
    for (const file of files.filter((item) => item.kind === "database")) {
      for (const [key, value] of Object.entries(databaseStats(file.source)))
        statistics[`${path.basename(file.archive)}.${key}`] = value
    }
    statistics.jsonFiles = manifestFiles.filter((item) => item.kind === "json").length
    const manifest: Manifest = {
      format: "chipmate-chat-history-backup",
      version: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      files: manifestFiles,
      statistics,
    }
    const writer = new WriteZipFile()
    const timestamp = new Date("1980-01-01T00:00:00.000Z")
    for (const file of files)
      writer.addFile(file.source, file.archive, { mtime: timestamp, mode: 0o100600, compress: true })
    writer.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), "manifest.json", {
      mtime: timestamp,
      mode: 0o100600,
      compress: true,
    })
    writer.addBuffer(
      Buffer.from(
        "本压缩包由 ChipMate 在迁移前自动生成。请勿修改其中内容。\n如需恢复，请在同一 VS Code Profile 中执行“ChipMate: 从聊天记录备份安全恢复”。\n恢复只会合并缺失聊天，不会覆盖或删除当前聊天。\n",
      ),
      "恢复说明.txt",
      { mtime: timestamp, mode: 0o100600, compress: true },
    )
    const writing = pipeline(writer.outputStream, createWriteStream(partial, { mode: 0o600 }))
    writer.end({ forceZip64Format: true })
    await writing
    await chmod(partial, 0o600).catch(() => undefined)
    await verifyArchive(partial)
    await rename(partial, archive)
    return { archive, manifest }
  } finally {
    await rm(partial, { force: true }).catch(() => undefined)
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
  }
}

function unsafeName(name: string) {
  return (
    name.includes("\\") || path.posix.isAbsolute(name) || name.split("/").some((part) => part === ".." || part === "")
  )
}

function isSymlink(entry: Entry) {
  if ((entry.versionMadeBy >>> 8) !== 3) return false
  return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
}

async function openArchive(file: string) {
  const info = await stat(file)
  if (info.size > MAX_ARCHIVE_BYTES) throw new Error("备份文件大小超过安全限制")
  const reader = await openPromise(file, {
    autoClose: false,
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
  })
  try {
    if (reader.entryCount > MAX_ARCHIVE_ENTRIES) throw new Error("备份条目数量超过安全限制")
    const entries: Entry[] = []
    const names = new Set<string>()
    let total = 0
    for await (const entry of reader.eachEntry()) {
      const key = entry.fileName.normalize("NFC").toLocaleLowerCase("en-US")
      if (unsafeName(entry.fileName)) throw new Error("备份包含不安全路径")
      if (names.has(key)) throw new Error("备份包含重复或大小写冲突条目")
      if (isSymlink(entry)) throw new Error("备份包含符号链接")
      if (entry.isEncrypted() || !entry.canDecodeFileData()) throw new Error("备份包含不支持或加密的条目")
      names.add(key)
      total += entry.uncompressedSize
      if (entry.uncompressedSize > MAX_ENTRY_BYTES || total > MAX_ARCHIVE_BYTES)
        throw new Error("备份解压后大小超过安全限制")
      if (
        entry.compressedSize > 0 &&
        entry.uncompressedSize > 64 * 1024 * 1024 &&
        entry.uncompressedSize / entry.compressedSize > 200
      )
        throw new Error("备份压缩比异常")
      entries.push(entry)
    }
    return { reader, entries }
  } catch (error) {
    reader.close()
    if (
      error instanceof Error &&
      ["invalid relative path", "absolute path", "invalid characters in fileName"].some((message) =>
        error.message.includes(message),
      )
    )
      throw new Error("备份包含不安全路径")
    throw error
  }
}

async function streamEntry(reader: ReadZipFile, entry: Entry, output?: NodeJS.WritableStream) {
  let checksum = 0
  const hash = createHash("sha256")
  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      checksum = crc32(chunk, checksum)
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  const destination =
    output ??
    new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    })
  await pipeline(await reader.openReadStreamPromise(entry), inspect, destination)
  if ((checksum >>> 0) !== (entry.crc32 >>> 0)) throw new Error(`备份 CRC 校验失败：${entry.fileName}`)
  return hash.digest("hex")
}

async function entryText(reader: ReadZipFile, entry: Entry, limit: number) {
  if (entry.uncompressedSize > limit) throw new Error("备份清单超过安全大小限制")
  let checksum = 0
  let total = 0
  const chunks: Buffer[] = []
  for await (const value of await reader.openReadStreamPromise(entry)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    total += chunk.byteLength
    if (total > limit) throw new Error("备份清单超过安全大小限制")
    checksum = crc32(chunk, checksum)
    chunks.push(chunk)
  }
  if ((checksum >>> 0) !== (entry.crc32 >>> 0)) throw new Error(`备份 CRC 校验失败：${entry.fileName}`)
  return Buffer.concat(chunks, total).toString("utf8")
}

async function verifyArchive(file: string) {
  const { reader, entries } = await openArchive(file)
  const temporary = await mkdtemp(path.join(tmpdir(), "chipmate-history-verify-"))
  try {
    const manifestEntry = entries.find((entry) => entry.fileName === "manifest.json")
    if (!manifestEntry) throw new Error("备份缺少 manifest.json")
    const manifest = JSON.parse(await entryText(reader, manifestEntry, 2 * 1024 * 1024)) as Manifest
    if (manifest.format !== "chipmate-chat-history-backup" || manifest.version !== FORMAT_VERSION)
      throw new Error("不支持的备份格式版本")
    if (!Array.isArray(manifest.files) || !manifest.statistics || typeof manifest.statistics !== "object")
      throw new Error("备份清单结构无效")
    const declaredNames = new Set<string>()
    for (const item of manifest.files) {
      if (
        !item ||
        typeof item.path !== "string" ||
        typeof item.size !== "number" ||
        !Number.isSafeInteger(item.size) ||
        item.size < 0 ||
        typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !["database", "json"].includes(item.kind)
      )
        throw new Error("备份清单文件项无效")
      if (unsafeName(item.path) || declaredNames.has(item.path.normalize("NFC").toLocaleLowerCase("en-US")))
        throw new Error("备份清单包含不安全或重复路径")
      if (
        (item.kind === "database" && !["databases/chipmate.db", "databases/kilo.db"].includes(item.path)) ||
        (item.kind === "json" && !item.path.startsWith("storage/"))
      )
        throw new Error("备份清单包含不支持的聊天记录路径")
      declaredNames.add(item.path.normalize("NFC").toLocaleLowerCase("en-US"))
    }
    const declared = new Map(manifest.files.map((item) => [item.path, item]))
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!
      const expected = declared.get(entry.fileName)
      if (!expected) {
        if (entry.fileName === "manifest.json") continue
        if (entry.fileName !== "恢复说明.txt") throw new Error(`备份包含未声明条目：${entry.fileName}`)
        await streamEntry(reader, entry)
        continue
      }
      if (entry.uncompressedSize !== expected.size) throw new Error(`备份文件大小校验失败：${entry.fileName}`)
      if (expected.kind === "database") {
        const snapshot = path.join(temporary, `${index}.db`)
        if ((await streamEntry(reader, entry, createWriteStream(snapshot, { mode: 0o600 }))) !== expected.sha256)
          throw new Error(`备份哈希校验失败：${entry.fileName}`)
        const counts = databaseStats(snapshot)
        for (const [table, count] of Object.entries(counts)) {
          if (manifest.statistics[`${path.basename(entry.fileName)}.${table}`] !== count)
            throw new Error(`备份会话统计校验失败：${entry.fileName}`)
        }
        continue
      }
      if ((await streamEntry(reader, entry)) !== expected.sha256)
        throw new Error(`备份哈希校验失败：${entry.fileName}`)
    }
    if ([...declared.keys()].some((name) => !entries.some((entry) => entry.fileName === name)))
      throw new Error("备份清单声明的文件缺失")
    return manifest
  } finally {
    reader.close()
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function extractArchive(file: string, destination: string) {
  const manifest = await verifyArchive(file)
  const available = await statfs(destination)
  const required = manifest.files.reduce((sum, item) => sum + item.size, 0) * 2
  if (available.bavail * available.bsize < required) throw new Error("可用磁盘空间不足，无法安全恢复")
  const { reader, entries } = await openArchive(file)
  try {
    const allowed = new Map(manifest.files.map((item) => [item.path, item]))
    for (const entry of entries) {
      const expected = allowed.get(entry.fileName)
      if (!expected) continue
      const target = path.join(destination, ...entry.fileName.split("/"))
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      if ((await streamEntry(reader, entry, createWriteStream(target, { mode: 0o600 }))) !== expected.sha256)
        throw new Error(`备份哈希校验失败：${entry.fileName}`)
    }
  } finally {
    reader.close()
  }
  return manifest
}

async function ensureCurrentSchema(file: string) {
  await Effect.runPromise(Effect.scoped(Layer.build(CoreDatabase.layerFromPath(file))).pipe(Effect.orDie))
}

function tableExists(db: Database, table: string) {
  return !!db
    .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table)
}

function columns(db: Database, table: string) {
  return new Set(
    db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((item) => item.name),
  )
}

function rows(db: Database, table: string, where = "", bindings: Array<string | number> = []) {
  if (!tableExists(db, table)) return []
  return db.query<Row, Array<string | number>>(`SELECT * FROM ${table}${where}`).all(...bindings)
}

function comparable(row: Row, table: (typeof TABLES)[number]) {
  if (table === "session") {
    return Object.fromEntries(
      ["project_id", "parent_id", "slug", "directory", "path", "title", "version"].map((key) => [
        key,
        row[key] ?? null,
      ]),
    )
  }
  const ignored = new Set(["time_updated"])
  return Object.fromEntries(Object.entries(row).filter(([key]) => !ignored.has(key)))
}

function sameRow(a: Row | undefined, b: Row, table: (typeof TABLES)[number]) {
  if (!a) return false
  const left = Object.entries(comparable(a, table)).toSorted(([first], [second]) => first.localeCompare(second))
  const right = Object.entries(comparable(b, table)).toSorted(([first], [second]) => first.localeCompare(second))
  return left.length === right.length && left.every(([key, value], index) => key === right[index]?.[0] && value === right[index]?.[1])
}

function insertRow(target: Database, table: (typeof TABLES)[number], row: Row) {
  const targetColumns = columns(target, table)
  const entries = Object.entries(row).filter(([key]) => targetColumns.has(key))
  if (entries.length === 0) return
  target
    .query(
      `INSERT OR IGNORE INTO ${table} (${entries.map(([key]) => `"${key}"`).join(",")}) VALUES (${entries.map(() => "?").join(",")})`,
    )
    .run(...entries.map(([, value]) => value))
}

function select(row: Row, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]!])) as Row
}

function safeRow(table: (typeof TABLES)[number], row: Row) {
  if (table === "project")
    return select(row, [
      "id",
      "worktree",
      "vcs",
      "name",
      "icon_url",
      "icon_url_override",
      "icon_color",
      "time_created",
      "time_updated",
      "time_initialized",
      "sandboxes",
    ])
  if (table === "project_directory") return select(row, ["project_id", "directory", "type", "strategy", "time_created"])
  if (table === "session")
    return select(row, [
      "id",
      "project_id",
      "parent_id",
      "slug",
      "directory",
      "path",
      "title",
      "version",
      "summary_additions",
      "summary_deletions",
      "summary_files",
      "summary_diffs",
      "cost",
      "tokens_input",
      "tokens_output",
      "tokens_reasoning",
      "tokens_cache_read",
      "tokens_cache_write",
      "time_created",
      "time_updated",
      "time_archived",
    ])
  if (table === "message") return select(row, ["id", "session_id", "time_created", "time_updated", "data"])
  if (table === "part") return select(row, ["id", "message_id", "session_id", "time_created", "time_updated", "data"])
  return select(row, ["session_id", "content", "status", "priority", "position", "time_created", "time_updated"])
}

function remap(prefix: string, fingerprint: string, id: string) {
  return `${prefix}_migrated_${hashText(`${fingerprint}:${id}`).slice(0, 24)}`
}

function sourceFamilies(source: Database) {
  const sessions = rows(source, "session")
  const byID = new Map(sessions.map((session) => [String(session.id), session]))
  const root = (session: Row) => {
    let current = session
    const seen = new Set<string>()
    while (current.parent_id && byID.has(String(current.parent_id)) && !seen.has(String(current.id))) {
      seen.add(String(current.id))
      current = byID.get(String(current.parent_id))!
    }
    return String(current.id)
  }
  const families = new Map<string, Row[]>()
  for (const session of sessions) {
    const id = root(session)
    const list = families.get(id) ?? []
    list.push(session)
    families.set(id, list)
  }
  return families
}

function* familyRows(source: Database, table: "message" | "part" | "todo", sessionIDs: string[]) {
  if (!tableExists(source, table)) return
  const order = table === "todo" ? "position" : "id"
  const first = source.query<Row, [string]>(`SELECT * FROM ${table} WHERE session_id=? ORDER BY ${order} LIMIT 1`)
  const next = source.query<Row, [string, string | number]>(
    `SELECT * FROM ${table} WHERE session_id=? AND ${order}>? ORDER BY ${order} LIMIT 1`,
  )
  let count = 0
  for (const sessionID of sessionIDs) {
    let row = first.get(sessionID)
    while (row) {
      yield row
      const cursor = row[order]
      if (typeof cursor !== "string" && typeof cursor !== "number") throw new Error(`${table} 缺少稳定排序字段`)
      row = next.get(sessionID, cursor)
      // 关闭上一条 SQLite 查询后主动释放大 Part 文本，避免编译后的 Bun
      // 在整个会话族游标结束前保留历史绑定值。
      count++
      if (count % 4 === 0) Bun.gc(true)
    }
  }
}

function mergeSource(targetFile: string, source: Source, progress?: (event: Progress) => void) {
  const target = new Database(targetFile)
  const input = new Database(source.file, { readonly: true })
  const result = { families: 0, imported: 0, skipped: 0, failed: 0, errors: [] as string[] }
  try {
    target.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000")
    const integrity = input.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check
    if (integrity !== "ok") throw new Error(`${source.label} 数据库损坏：${integrity ?? "未知错误"}`)
    for (const project of rows(input, "project")) insertRow(target, "project", safeRow("project", project))
    for (const directory of rows(input, "project_directory"))
      insertRow(target, "project_directory", safeRow("project_directory", directory))
    const families = sourceFamilies(input)
    let current = 0
    for (const unsorted of families.values()) {
      current++
      result.families++
      const sessions = unsorted.toSorted((a, b) => String(a.id).localeCompare(String(b.id)))
      const ids = sessions.map((session) => String(session.id))
      const digestHash = createHash("sha256")
      for (const session of sessions) hashRows(digestHash, "session", session)
      for (const table of ["message", "part", "todo"] as const) {
        for (const row of familyRows(input, table, ids)) hashRows(digestHash, table, row)
      }
      const digest = digestHash.digest("hex")
      const marker = `chat-history/v1/${digest}`
      if (target.query<{ name: string }, [string]>("SELECT name FROM data_migration WHERE name=?").get(marker)) {
        result.skipped++
        continue
      }
      const identityHash = createHash("sha256")
      let conflict = false
      for (const row of sessions) {
        hashRows(identityHash, "session", comparable(row, "session"))
        const existing = rows(target, "session", " WHERE id=?", [String(row.id)])[0]
        if (existing && !sameRow(existing, row, "session")) conflict = true
      }
      for (const table of ["message", "part", "todo"] as const) {
        for (const row of familyRows(input, table, ids)) {
          const existing =
            table === "todo"
              ? rows(target, table, " WHERE session_id=? AND position=?", [
                  String(row.session_id),
                  Number(row.position),
                ])[0]
              : rows(target, table, " WHERE id=?", [String(row.id)])[0]
          if (!existing || sameRow(existing, row, table)) continue
          conflict = true
          hashRows(identityHash, table, comparable(row, table))
        }
      }
      const identity = identityHash.digest("hex")
      const sessionIDs = new Map(ids.map((id) => [id, conflict ? remap("ses", identity, id) : id]))
      const messageID = (id: string) => (conflict ? remap("msg", identity, id) : id)
      const partID = (id: string) => (conflict ? remap("prt", identity, id) : id)
      try {
        const sessionRows = sessions.map((original) => {
          const row: Row = { ...safeRow("session", original), id: sessionIDs.get(String(original.id))! }
          if (original.parent_id) row.parent_id = sessionIDs.get(String(original.parent_id)) ?? original.parent_id
          if (conflict) {
            row.title = `${String(original.title)}（从旧版恢复）`
            row.metadata = JSON.stringify({
              restoredFromLegacy: true,
              migrationSource: source.label,
              sourceFingerprint: identity,
            })
            row.workspace_id = null
            row.share_url = null
            row.revert = null
            row.permission = null
          }
          return row
        })
        const verify = (table: (typeof TABLES)[number], row: Row) => {
          const actual =
            table === "todo"
              ? rows(target, table, " WHERE session_id=? AND position=?", [
                  String(row.session_id),
                  Number(row.position),
                ])[0]
              : rows(target, table, " WHERE id=?", [String(row.id)])[0]
          if (!sameRow(actual, row, table)) throw new Error("会话族归一化摘要比对失败")
        }
        for (const row of sessionRows) {
          insertRow(target, "session", row)
          verify("session", row)
        }
        for (const original of familyRows(input, "message", ids)) {
          const row: Row = {
            ...safeRow("message", original),
            id: messageID(String(original.id)),
            session_id: sessionIDs.get(String(original.session_id))!,
          }
          if (conflict && typeof row.data === "string") {
            const data = JSON.parse(row.data) as Record<string, unknown>
            if (typeof data.parentID === "string") data.parentID = messageID(data.parentID)
            row.data = JSON.stringify(data)
          }
          insertRow(target, "message", row)
          verify("message", row)
        }
        for (const original of familyRows(input, "part", ids)) {
          const row: Row = {
            ...safeRow("part", original),
            id: partID(String(original.id)),
            message_id: messageID(String(original.message_id)),
            session_id: sessionIDs.get(String(original.session_id))!,
          }
          insertRow(target, "part", row)
          verify("part", row)
        }
        for (const original of familyRows(input, "todo", ids)) {
          const row: Row = {
            ...safeRow("todo", original),
            session_id: sessionIDs.get(String(original.session_id))!,
          }
          insertRow(target, "todo", row)
          verify("todo", row)
        }
        const orphanMessages =
          target
            .query<
              { count: number },
              []
            >("SELECT count(*) count FROM message m LEFT JOIN session s ON s.id=m.session_id WHERE s.id IS NULL")
            .get()?.count ?? 0
        const orphanParts =
          target
            .query<
              { count: number },
              []
            >("SELECT count(*) count FROM part p LEFT JOIN message m ON m.id=p.message_id WHERE m.id IS NULL")
            .get()?.count ?? 0
        if (orphanMessages || orphanParts) throw new Error("合并后发现孤儿消息或 Part")
        target.query("INSERT INTO data_migration(name,time_completed) VALUES (?,?)").run(marker, Date.now())
        result.imported++
      } catch (error) {
        result.failed++
        result.errors.push(
          `${source.label} 的一个会话族迁移失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      emit(progress, { phase: "merge", current, total: families.size, message: "正在安全合并聊天会话" })
    }
    const foreign = target.query<Row, []>("PRAGMA foreign_key_check").all()
    const targetIntegrity = target
      .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
      .get()?.integrity_check
    if (foreign.length > 0 || targetIntegrity !== "ok") throw new Error("迁移后数据库完整性门禁未通过")
    return result
  } finally {
    input.close()
    target.close()
  }
}

async function jsonSource(storage: string) {
  if (!existsSync(storage)) return undefined
  const temporary = await mkdtemp(path.join(tmpdir(), "chipmate-history-json-"))
  const file = path.join(temporary, "json.db")
  try {
    await ensureCurrentSchema(file)
    const sqlite = new Database(file)
    let issues: string[] = []
    let sessions = 0
    try {
      const stats = await JsonMigration.run(drizzle({ client: sqlite }), {
        storageDir: storage,
        includeSensitive: false,
      })
      sessions = stats.sessions
      issues = stats.errors.map((_, index) => `旧 JSON 记录 ${index + 1} 无法解析或导入`)
      if (stats.skipped.sessions > 0) issues.push(`旧 JSON 中 ${stats.skipped.sessions} 个会话缺少项目，未导入`)
      if (stats.skipped.todos > 0) issues.push(`旧 JSON 中 ${stats.skipped.todos} 组 Todo 缺少会话，未导入`)
    } finally {
      sqlite.close()
    }
    if (sessions === 0 && issues.length === 0) {
      await rm(temporary, { recursive: true, force: true })
      return undefined
    }
    return { label: "旧 JSON 历史", file, cleanup: temporary, issues } satisfies Source
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function databaseSource(file: string, label: string) {
  const temporary = await mkdtemp(path.join(tmpdir(), "chipmate-history-database-"))
  const snapshot = path.join(temporary, "source.db")
  try {
    await snapshotDatabase(file, snapshot)
    const db = new Database(snapshot, { readonly: true })
    let sanitized = false
    try {
      sanitized =
        tableExists(db, "data_migration") &&
        !!db
          .query<{ name: string }, [string]>("SELECT name FROM data_migration WHERE name=?")
          .get(SANITIZED_BACKUP_MARKER)
    } finally {
      db.close()
    }
    if (!sanitized) await ensureCurrentSchema(snapshot)
    return { label, file: snapshot, cleanup: temporary } satisfies Source
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function migrateSources(input: {
  data: string
  sources: Source[]
  backup: string
  progress?: (event: Progress) => void
}): Promise<Summary> {
  const target = path.join(input.data, "chipmate.db")
  await ensureCurrentSchema(target)
  const totals = { families: 0, imported: 0, skipped: 0, failed: 0, errors: [] as string[] }
  for (const source of input.sources) {
    totals.failed += source.issues?.length ?? 0
    totals.errors.push(...(source.issues ?? []))
    try {
      const result = mergeSource(target, source, input.progress)
      totals.families += result.families
      totals.imported += result.imported
      totals.skipped += result.skipped
      totals.failed += result.failed
      totals.errors.push(...result.errors)
    } catch (error) {
      totals.failed++
      totals.errors.push(error instanceof Error ? error.message : String(error))
    } finally {
      if (source.cleanup) await rm(source.cleanup, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return { backup: input.backup, sources: input.sources.length, ...totals }
}

async function cleanupSources(sources: Source[]) {
  await Promise.all(
    sources
      .map((source) => source.cleanup)
      .filter((folder): folder is string => !!folder)
      .map((folder) => rm(folder, { recursive: true, force: true }).catch(() => undefined)),
  )
}

export namespace ChatHistoryMigration {
  export async function migrate(input: { data?: string; progress?: (event: Progress) => void } = {}) {
    const data = input.data ?? Global.Path.data
    await recoverDeadMigrationLock(data)
    return Flock.withLock(
      "chat-history-migration",
      async () => {
        emit(input.progress, { phase: "scan", current: 0, total: 1, message: "正在扫描当前 VS Code Profile" })
        const old = path.join(data, "kilo.db")
        const storage = path.join(data, "storage")
        const hasJSON = (await Promise.all(JSON_FOLDERS.map((folder) => walk(path.join(storage, folder))))).some(
          (files) => files.length > 0,
        )
        if (!existsSync(old) && !hasJSON) {
          const result: Summary = {
            backup: "",
            sources: 0,
            families: 0,
            imported: 0,
            skipped: 0,
            failed: 0,
            errors: [],
          }
          emit(input.progress, {
            phase: "complete",
            current: 1,
            total: 1,
            message: "未发现需要迁移的旧聊天记录",
            result,
          })
          return result
        }
        const backup = await createArchive({ data, progress: input.progress })
        const sources: Source[] = []
        try {
          if (existsSync(old)) sources.push(await databaseSource(old, "kilo.db"))
          const json = hasJSON ? await jsonSource(storage) : undefined
          if (json) sources.push(json)
          const result = await migrateSources({ data, sources, backup: backup.archive, progress: input.progress })
          emit(input.progress, { phase: "complete", current: 1, total: 1, message: "聊天记录迁移完成", result })
          return result
        } catch (error) {
          await cleanupSources(sources)
          throw error
        }
      },
      { dir: path.join(data, "migration-locks"), timeoutMs: 1_000, staleMs: 30 * 60_000 },
    )
  }

  export async function restore(input: { archive: string; data?: string; progress?: (event: Progress) => void }) {
    const data = input.data ?? Global.Path.data
    await recoverDeadMigrationLock(data)
    return Flock.withLock(
      "chat-history-migration",
      async () => {
        emit(input.progress, { phase: "scan", current: 0, total: 1, message: "正在验证聊天记录备份" })
        const temporary = await mkdtemp(path.join(tmpdir(), "chipmate-history-restore-"))
        try {
          await extractArchive(input.archive, temporary)
          const backup = await createArchive({ data, progress: input.progress })
          const sources: Source[] = []
          try {
            for (const name of ["chipmate.db", "kilo.db"]) {
              const file = path.join(temporary, "databases", name)
              if (existsSync(file)) sources.push(await databaseSource(file, `备份中的 ${name}`))
            }
            const storage = path.join(temporary, "storage")
            const json = await jsonSource(storage)
            if (json) sources.push(json)
            const result = await migrateSources({ data, sources, backup: backup.archive, progress: input.progress })
            emit(input.progress, {
              phase: "complete",
              current: 1,
              total: 1,
              message: "聊天记录安全恢复完成",
              result,
            })
            return result
          } catch (error) {
            await cleanupSources(sources)
            throw error
          }
        } finally {
          await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
        }
      },
      { dir: path.join(data, "migration-locks"), timeoutMs: 1_000, staleMs: 30 * 60_000 },
    )
  }

  export const verify = verifyArchive
  export const backup = createArchive
}
