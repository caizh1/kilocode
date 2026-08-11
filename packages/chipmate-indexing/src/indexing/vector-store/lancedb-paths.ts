import { createHash } from "crypto"
import path from "path"

export const LANCEDB_WINDOWS_PATH_BUDGET = 240

const TRANSACTION_FILE = "18446744073709551615-00000000-0000-4000-8000-000000000000.txn.tmp"
const DATA_FILE = `${"0".repeat(64)}.lance.tmp`

function windowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.includes("\\")
}

function paths(...values: string[]): typeof path.win32 {
  return values.some(windowsPath) ? path.win32 : path
}

function normalizedWorkspace(workspace: string): string {
  const api = paths(workspace)
  const resolved = api.resolve(workspace)
  return api === path.win32 ? resolved.toLocaleLowerCase("en-US") : resolved
}

export function lanceDbWorkspaceDigest(workspace: string): string {
  return createHash("sha256").update(normalizedWorkspace(workspace)).digest("base64url").slice(0, 16)
}

export function compactLanceDbPath(workspace: string, base: string): string {
  return paths(workspace, base).join(base, lanceDbWorkspaceDigest(workspace))
}

export function compactSafeGenerationRoot(workspace: string, base: string): string {
  return paths(workspace, base).join(base, `s${lanceDbWorkspaceDigest(workspace)}`)
}

export function previousCompactSafeGenerationRoot(workspace: string, base: string): string {
  return paths(workspace, base).join(base, "g", lanceDbWorkspaceDigest(workspace))
}

export function legacySafeGenerationRoot(workspace: string, base: string): string {
  const hash = createHash("sha256").update(paths(workspace).resolve(workspace)).digest("hex").slice(0, 24)
  return paths(workspace, base).join(base, "safe-generations", hash)
}

export function legacyLanceDbPath(workspace: string, base: string): string {
  const api = paths(workspace, base)
  const basename = api.basename(workspace)
  const hash = createHash("sha256").update(workspace).digest("hex").slice(0, 16)
  return api.join(base, `${basename}-${hash}`)
}

export function lanceDbWorstCasePaths(database: string): { transaction: string; data: string; maximum: number } {
  const api = paths(database)
  const transaction = api.join(database, "metadata.lance", "_transactions", TRANSACTION_FILE)
  const data = api.join(database, "vector.lance", "data", DATA_FILE)
  return { transaction, data, maximum: Math.max(transaction.length, data.length) }
}

export function lanceDbPathFitsWindowsBudget(database: string): boolean {
  return lanceDbWorstCasePaths(database).maximum <= LANCEDB_WINDOWS_PATH_BUDGET
}

export function assertLanceDbPathFitsWindowsBudget(database: string): void {
  if ((!windowsPath(database) && process.platform !== "win32") || lanceDbPathFitsWindowsBudget(database)) return
  const measured = lanceDbWorstCasePaths(database)
  throw new Error(
    `LanceDB Windows write path is too long (${measured.maximum} characters; budget ${LANCEDB_WINDOWS_PATH_BUDGET}). ` +
      `Choose a shorter LanceDB directory such as C:\\cmdb. Database path: ${database}`,
  )
}

export function resolveLanceDbPath(
  workspace: string,
  base: string,
  databaseName?: string,
): { database: string; legacy?: string } {
  const api = paths(workspace, base)
  const preferred = databaseName === undefined ? compactLanceDbPath(workspace, base) : api.join(base, databaseName)
  const legacy = legacyLanceDbPath(workspace, base)
  return { database: preferred, legacy: preferred === legacy ? undefined : legacy }
}
