import { lstat, readdir, realpath, rm } from "node:fs/promises"
import path from "node:path"
import type { IndexingCleanupStats } from "./interfaces/cleanup"

export function emptyCleanupStats(): IndexingCleanupStats {
  return {
    filesDeleted: 0,
    directoriesDeleted: 0,
    bytesDeleted: 0,
    skipped: [],
  }
}

export async function cleanupRoot(
  root: string,
  stats: IndexingCleanupStats,
  label: string,
): Promise<string | undefined> {
  try {
    const info = await lstat(root)
    if (info.isSymbolicLink()) {
      stats.skipped.push(`${label}: root is symlink`)
      return undefined
    }
    if (!info.isDirectory()) {
      stats.skipped.push(`${label}: root is not a directory`)
      return undefined
    }
    return realpath(root)
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined
    if (code !== "ENOENT") stats.skipped.push(`${label}: root unavailable`)
    return undefined
  }
}

export async function removeSafe(
  target: string,
  root: string,
  stats: IndexingCleanupStats,
  label: string,
): Promise<void> {
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink()) {
      stats.skipped.push(`${label}: symlink skipped`)
      return
    }

    const real = await realpath(target)
    if (real === root || !inside(real, root)) {
      stats.skipped.push(`${label}: outside cleanup root`)
      return
    }

    if (info.isDirectory() && (await hasLink(target))) {
      stats.skipped.push(`${label}: directory contains symlink`)
      return
    }

    const bytes = await size(target)
    await rm(target, { recursive: true, force: true })
    if (info.isDirectory()) stats.directoriesDeleted += 1
    else stats.filesDeleted += 1
    stats.bytesDeleted += bytes
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined
    if (code !== "ENOENT") stats.skipped.push(`${label}: delete failed`)
  }
}

export async function list(
  dir: string,
): Promise<Array<{ name: string; path: string; directory: boolean; file: boolean }>> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(dir, entry.name),
      directory: entry.isDirectory(),
      file: entry.isFile(),
    }))
  } catch (err) {
    const code = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined
    if (code === "ENOENT") return []
    throw err
  }
}

export function rel(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/")
}

function inside(target: string, root: string): boolean {
  const next = path.relative(root, target)
  return next !== "" && !next.startsWith("..") && !path.isAbsolute(next)
}

async function hasLink(dir: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    const info = await lstat(file)
    if (info.isSymbolicLink()) return true
    if (info.isDirectory() && (await hasLink(file))) return true
  }
  return false
}

async function size(target: string): Promise<number> {
  const info = await lstat(target)
  if (info.isSymbolicLink()) return 0
  if (!info.isDirectory()) return info.size

  const items = await Promise.all((await readdir(target)).map((item) => size(path.join(target, item))))
  return items.reduce((sum, item) => sum + item, 0)
}
