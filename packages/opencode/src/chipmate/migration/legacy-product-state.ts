import { createHash } from "crypto"
import { existsSync } from "fs"
import { chmod, mkdir, open, rename, stat, unlink } from "fs/promises"
import path from "path"
import { Database as BunDatabase } from "bun:sqlite"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { Global } from "@opencode-ai/core/global"
import { Database } from "@opencode-ai/core/database/database"
import * as Log from "@opencode-ai/core/util/log"
import { ProductProfile } from "@/chipmate/product-profile"

const log = Log.create({ service: "legacy-product-state-migration" })
const LEGACY_PROVIDER = "kilo"
const CURRENT_PROVIDER = "chipmate"
const SCHEMA = "https://app.chipmate.ai/config.json"
const MIGRATION = "chipmate_legacy_provider_id_v1"
const blocked = new Set(["__proto__", "constructor", "prototype"])
const active = new Map<string, Promise<void>>()

type JsonObject = Record<string, unknown>

export namespace LegacyProductStateMigration {
  export async function bootstrap(): Promise<void> {
    if (!ProductProfile.chipmate) return
    await attempt("global bootstrap", () =>
      locked(Global.Path.config, async () => {
        await attempt("global config", () => migrateConfigDirectory(Global.Path.config))
        await attempt("authentication", migrateAuth)
        await attempt("model state", migrateModelState)
        migrateDatabase()
      }),
    )
  }

  export async function project(directory: string, worktree?: string): Promise<void> {
    if (!ProductProfile.chipmate) return
    const stop = worktree && worktree !== "/" ? path.resolve(worktree) : path.resolve(directory)
    let current = path.resolve(directory)
    while (true) {
      const root = ProductProfile.project(current)
      if (existsSync(root)) await attempt("project config", () => locked(root, () => migrateConfigDirectory(root)))
      if (current === stop) return
      const parent = path.dirname(current)
      if (parent === current || !inside(parent, stop)) return
      current = parent
    }
  }

  /** Migrates one already-discovered ChipMate config directory before it is loaded. */
  export function configDirectory(directory: string): Promise<void> {
    return attempt("discovered config", () => locked(directory, () => migrateConfigDirectory(directory)))
  }

  /** @internal Exported for focused migration tests. */
  export function database(file: string): void {
    migrateDatabase(file)
  }

  /** @internal Exported for focused migration tests. */
  export function transformConfig(input: JsonObject): JsonObject {
    const output = structuredClone(input)
    if (typeof output.$schema === "string" && output.$schema.includes("kilo")) output.$schema = SCHEMA
    renameChild(output, "provider")
    renameChild(output, "indexing")
    transformKnownConfigValues(output)
    return output
  }

  /** @internal Exported for focused migration tests. */
  export function transformPersistedState(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(transformPersistedState)
    if (!record(input)) return input
    const output: JsonObject = {}
    for (const [key, value] of Object.entries(input)) {
      if (blocked.has(key)) continue
      if (key === "providerID" && value === LEGACY_PROVIDER) {
        output[key] = CURRENT_PROVIDER
        continue
      }
      if (key === "variant" && record(value)) {
        output[key] = Object.fromEntries(
          Object.entries(value).map(([name, variant]) => [providerReference(name), transformPersistedState(variant)]),
        )
        continue
      }
      output[key] = transformPersistedState(value)
    }
    return output
  }
}

async function migrateConfigDirectory(directory: string) {
  await Promise.all([
    migrateConfigFile(directory, "kilo.json", "chipmate.json"),
    migrateConfigFile(directory, "kilo.jsonc", "chipmate.jsonc"),
  ])
}

async function migrateConfigFile(directory: string, sourceName: string, targetName: string) {
  const source = path.join(directory, sourceName)
  if (!existsSync(source)) return
  const target = path.join(directory, targetName)
  const sourceText = await Bun.file(source)
    .text()
    .catch((error) => {
      log.warn("legacy config migration could not read source", { file: sourceName, error: category(error) })
      return undefined
    })
  if (sourceText === undefined) return
  const legacy = json(sourceText)
  if (!legacy) {
    log.warn("legacy config migration skipped invalid source", { file: sourceName, error: "invalid-jsonc" })
    return
  }
  const transformed = LegacyProductStateMigration.transformConfig(legacy)
  const targetText = existsSync(target)
    ? await Bun.file(target)
        .text()
        .catch(() => undefined)
    : undefined
  if (targetText === undefined && existsSync(target)) {
    log.warn("legacy config migration could not read target", { file: targetName })
    return
  }
  const current = targetText === undefined ? legacy : json(targetText)
  if (!current) {
    log.warn("legacy config migration skipped invalid target", { file: targetName, error: "invalid-jsonc" })
    return
  }
  const next = targetText === undefined ? transformed : fill(current, transformed)
  const base = targetText ?? sourceText
  const patched = patch(base, current, next)
  await atomic(target, patched, await mode(source))
  const verified = json(await Bun.file(target).text())
  if (!verified || JSON.stringify(verified) !== JSON.stringify(next)) {
    log.warn("legacy config migration verification failed", { file: targetName })
    return
  }
  await backup(source, directory, sourceName.endsWith(".jsonc") ? "config-jsonc" : "config-json")
  log.info("legacy config migrated", { source: sourceName, target: targetName })
}

async function migrateAuth() {
  const file = path.join(Global.Path.data, "auth.json")
  if (!existsSync(file)) return
  const data = json(await Bun.file(file).text())
  if (!data || !(LEGACY_PROVIDER in data)) return
  if (!(CURRENT_PROVIDER in data)) {
    data[CURRENT_PROVIDER] = data[LEGACY_PROVIDER]
    delete data[LEGACY_PROVIDER]
  } else if (JSON.stringify(data[CURRENT_PROVIDER]) === JSON.stringify(data[LEGACY_PROVIDER])) {
    delete data[LEGACY_PROVIDER]
  } else {
    log.warn("legacy auth migration retained conflicting credential record")
    return
  }
  await atomic(file, JSON.stringify(data, null, 2) + "\n", 0o600)
  log.info("legacy auth provider migrated")
}

async function migrateModelState() {
  const file = path.join(Global.Path.state, "model.json")
  if (!existsSync(file)) return
  const data = json(await Bun.file(file).text())
  if (!data) return
  const next = LegacyProductStateMigration.transformPersistedState(data)
  if (JSON.stringify(next) === JSON.stringify(data)) return
  await atomic(file, JSON.stringify(next, null, 2) + "\n", await mode(file))
  log.info("legacy model provider state migrated")
}

function migrateDatabase(file = Database.path()) {
  if (file === ":memory:" || !existsSync(file)) return
  const db = new BunDatabase(file)
  try {
    db.run("PRAGMA busy_timeout = 5000")
    db.run("CREATE TABLE IF NOT EXISTS chipmate_data_migration (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)")
    const done = db.query("SELECT 1 FROM chipmate_data_migration WHERE name = ?").get(MIGRATION)
    if (done) return
    db.run("BEGIN IMMEDIATE")
    try {
      migrateColumn(db, "session", "model")
      migrateColumn(db, "message", "data")
      migrateColumn(db, "part", "data")
      migrateColumn(db, "session_message", "data")
      migrateColumn(db, "session_input", "prompt")
      db.query("INSERT INTO chipmate_data_migration(name, applied_at) VALUES (?, ?)").run(MIGRATION, Date.now())
      db.run("COMMIT")
      log.info("legacy database provider state migrated")
    } catch (error) {
      db.run("ROLLBACK")
      throw error
    }
  } catch (error) {
    log.warn("legacy database provider migration deferred", { error: category(error) })
  } finally {
    db.close()
  }
}

function migrateColumn(db: BunDatabase, table: string, column: string) {
  const exists = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  if (!exists) return
  const rows = db.query(`SELECT rowid AS id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`).all() as {
    id: number
    value: string
  }[]
  const update = db.query(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`)
  let malformed = 0
  for (const row of rows) {
    if (typeof row.value !== "string" || !row.value.includes(`\"${LEGACY_PROVIDER}\"`)) continue
    const parsed = (() => {
      try {
        return JSON.parse(row.value) as unknown
      } catch {
        malformed++
        return undefined
      }
    })()
    if (parsed === undefined) continue
    const next = LegacyProductStateMigration.transformPersistedState(parsed)
    const serialized = JSON.stringify(next)
    if (serialized !== row.value) update.run(serialized, row.id)
  }
  if (malformed > 0) log.warn("legacy database provider migration skipped malformed rows", { table, malformed })
}

function transformKnownConfigValues(input: JsonObject) {
  const modelKeys = new Set(["model", "small_model", "subagent_model"])
  const providerLists = new Set(["enabled_providers", "disabled_providers"])
  const visit = (value: unknown, parent?: string): unknown => {
    if (Array.isArray(value)) {
      if (parent && providerLists.has(parent))
        return value.map((item) => (item === LEGACY_PROVIDER ? CURRENT_PROVIDER : item))
      return value.map((item) => visit(item))
    }
    if (!record(value)) return value
    for (const [key, item] of Object.entries(value)) {
      if (blocked.has(key)) {
        delete value[key]
        continue
      }
      if ((key === "providerID" || (key === "provider" && parent === "indexing")) && item === LEGACY_PROVIDER) {
        value[key] = CURRENT_PROVIDER
        continue
      }
      if (modelKeys.has(key) && typeof item === "string") {
        value[key] = providerReference(item)
        continue
      }
      value[key] = visit(item, key)
    }
    return value
  }
  visit(input)
}

function renameChild(root: JsonObject, key: string) {
  const parent = root[key]
  if (!record(parent) || !(LEGACY_PROVIDER in parent)) return
  if (!(CURRENT_PROVIDER in parent)) parent[CURRENT_PROVIDER] = parent[LEGACY_PROVIDER]
  delete parent[LEGACY_PROVIDER]
}

function providerReference(value: string) {
  if (value === LEGACY_PROVIDER) return CURRENT_PROVIDER
  if (value.startsWith(`${LEGACY_PROVIDER}/`)) return `${CURRENT_PROVIDER}/${value.slice(LEGACY_PROVIDER.length + 1)}`
  return value.replaceAll(`/${LEGACY_PROVIDER}/`, `/${CURRENT_PROVIDER}/`)
}

function fill(current: JsonObject, legacy: JsonObject): JsonObject {
  const output = structuredClone(current)
  for (const [key, value] of Object.entries(legacy)) {
    if (blocked.has(key)) continue
    if (!(key in output)) {
      output[key] = structuredClone(value)
      continue
    }
    if (record(output[key]) && record(value)) output[key] = fill(output[key], value)
  }
  return output
}

function patch(text: string, before: JsonObject, after: JsonObject): string {
  const changes: Array<{ path: (string | number)[]; value: unknown }> = []
  const walk = (left: unknown, right: unknown, parts: (string | number)[]) => {
    if (record(left) && record(right)) {
      for (const key of Object.keys(left))
        if (!blocked.has(key) && !(key in right)) changes.push({ path: [...parts, key], value: undefined })
      for (const [key, value] of Object.entries(right)) {
        if (blocked.has(key)) continue
        if (!(key in left)) changes.push({ path: [...parts, key], value })
        else walk(left[key], value, [...parts, key])
      }
      return
    }
    if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ path: parts, value: right })
  }
  walk(before, after, [])
  return changes.reduce(
    (result, change) =>
      applyEdits(
        result,
        modify(result, change.path, change.value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
      ),
    text,
  )
}

function json(text: string): JsonObject | undefined {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  return errors.length === 0 && record(value) ? value : undefined
}

function record(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

async function atomic(file: string, content: string, permissions = 0o600) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${globalThis.crypto.randomUUID()}.tmp`
  const handle = await open(temp, "wx", permissions)
  try {
    await handle.writeFile(content, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(temp, permissions)
  await rename(temp, file)
}

async function backup(source: string, directory: string, label: string) {
  const root = path.join(directory, "migration-backup")
  await mkdir(root, { recursive: true, mode: 0o700 })
  const contents = await Bun.file(source).arrayBuffer()
  const digest = createHash("sha256")
    .update(new Uint8Array(contents))
    .digest("hex")
    .slice(0, 8)
  const target = path.join(root, `pre-1.1.0-${label}-${digest}.bak`)
  if (existsSync(target)) await unlink(source)
  else await rename(source, target)
  await chmod(target, 0o600)
}

async function mode(file: string) {
  return stat(file)
    .then((item) => item.mode & 0o777)
    .catch(() => 0o600)
}

async function locked(root: string, run: () => Promise<void>): Promise<void> {
  const key = path.resolve(root)
  const existing = active.get(key)
  if (existing) return existing
  const task = withFileLock(key, run).finally(() => active.delete(key))
  active.set(key, task)
  return task
}

async function withFileLock(root: string, run: () => Promise<void>) {
  await mkdir(root, { recursive: true })
  const file = path.join(root, ".migration.lock")
  for (let attempt = 0; attempt < 100; attempt++) {
    const handle = await open(file, "wx", 0o600).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error
      const age = await stat(file)
        .then((item) => Date.now() - item.mtimeMs)
        .catch(() => 0)
      if (age > 30_000) await unlink(file).catch(() => undefined)
      return undefined
    })
    if (!handle) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      continue
    }
    try {
      await run()
      return
    } finally {
      await handle.close()
      await unlink(file).catch(() => undefined)
    }
  }
  throw new Error(`Timed out waiting for migration lock: ${root}`)
}

function inside(value: string, root: string) {
  const relative = path.relative(root, value)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function category(error: unknown) {
  return error instanceof Error ? error.name : typeof error
}

async function attempt(label: string, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    log.warn("legacy product state migration deferred", { stage: label, error: category(error) })
  }
}
