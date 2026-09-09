import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import type { SourceManifest } from "./contracts.js"
import { sha256File } from "./hash.js"

export interface RawPaths {
  root: string
  drop: string
  raw: string
  processed: string
  quarantine: string
  reports: string
  work: string
}

export class RawStore {
  readonly paths: RawPaths

  constructor(root: string) {
    this.paths = {
      root,
      drop: path.join(root, "drop"),
      raw: path.join(root, "raw"),
      processed: path.join(root, "processed"),
      quarantine: path.join(root, "quarantine"),
      reports: path.join(root, "reports"),
      work: path.join(root, "work"),
    }
  }

  async initialize(): Promise<void> {
    await Promise.all(Object.values(this.paths).map((directory) => fs.mkdir(directory, { recursive: true })))
  }

  async discover(): Promise<string[]> {
    const entries = await fs.readdir(this.paths.drop, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && !entry.name.endsWith(".manifest.json"))
      .map((entry) => path.join(this.paths.drop, entry.name))
      .sort()
  }

  async stable(file: string, intervalMs = 2_000): Promise<boolean> {
    const first = await fs.stat(file)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    const second = await fs.stat(file)
    return first.size === second.size && first.mtimeMs === second.mtimeMs && first.size > 0
  }

  async preserve(file: string, manifest?: SourceManifest): Promise<{ sha256: string; size: number; rawPath: string }> {
    const stat = await fs.stat(file)
    const sha256 = await sha256File(file)
    const directory = path.join(this.paths.raw, sha256.slice(0, 2), sha256)
    await fs.mkdir(directory, { recursive: true })
    const names = await fs.readdir(directory)
    const existingPayload = names.find((name) => name.startsWith("payload"))
    const rawPath = path.join(directory, existingPayload ?? `payload${suffix(file)}`)
    await fs.copyFile(file, rawPath, constants.COPYFILE_EXCL).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error
      const existing = await fs.stat(rawPath)
      if (existing.size !== stat.size || (await sha256File(rawPath)) !== sha256) {
        throw new Error(`内容寻址原始文件 ${rawPath} 与预期 SHA-256 不一致`)
      }
    })
    if (manifest) await this.preserveManifest(directory, manifest)
    return { sha256, size: stat.size, rawPath }
  }

  private async preserveManifest(directory: string, manifest: SourceManifest): Promise<void> {
    const file = path.join(directory, "manifest.json")
    const content = `${JSON.stringify(manifest, null, 2)}\n`
    await fs
      .writeFile(file, content, { encoding: "utf8", flag: "wx", mode: 0o640 })
      .catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error
        const existing = await fs.readFile(file, "utf8")
        if (existing !== content) throw new Error(`相同原始内容对应不同 manifest，已拒绝覆盖：${file}`)
      })
  }

  async complete(file: string, batchId: string): Promise<string> {
    return this.move(file, this.paths.processed, `${safe(batchId)}-${path.basename(file)}`)
  }

  async quarantine(file: string, batchId: string): Promise<string> {
    return this.move(file, this.paths.quarantine, `${safe(batchId)}-${path.basename(file)}`)
  }

  async report(batchId: string, value: unknown): Promise<string> {
    const destination = path.join(this.paths.reports, `${safe(batchId)}-${Date.now()}-${process.pid}.json`)
    const temporary = `${destination}.tmp-${process.pid}`
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o640 })
    await fs.rename(temporary, destination)
    return destination
  }

  async requeueRaw(sha256?: string): Promise<string[]> {
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("requeue-raw 的 SHA-256 格式无效")
    const prefixes: string[] = sha256 ? [sha256.slice(0, 2)] : await fs.readdir(this.paths.raw).catch(() => [])
    const output: string[] = []
    for (const prefix of prefixes.sort()) {
      const prefixPath = path.join(this.paths.raw, prefix)
      const hashes: string[] = sha256 ? [sha256] : await fs.readdir(prefixPath).catch(() => [])
      for (const hash of hashes.sort()) {
        if (!/^[a-f0-9]{64}$/.test(hash)) continue
        const directory = path.join(prefixPath, hash)
        const names: string[] = await fs.readdir(directory).catch(() => [])
        const payload = names.find((name) => name.startsWith("payload"))
        if (!payload || !names.includes("manifest.json")) continue
        const destination = path.join(this.paths.drop, `${hash}-${payload}`)
        await fs.copyFile(path.join(directory, payload), destination, constants.COPYFILE_EXCL)
        await fs.copyFile(
          path.join(directory, "manifest.json"),
          `${destination}.manifest.json`,
          constants.COPYFILE_EXCL,
        )
        output.push(destination)
      }
    }
    if (sha256 && output.length === 0) throw new Error(`未找到可重排队的原始包 ${sha256}`)
    return output
  }

  private async move(file: string, directory: string, name: string): Promise<string> {
    const destination = unique(path.join(directory, name))
    await fs.rename(file, destination).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EXDEV") throw error
      await fs.copyFile(file, destination, constants.COPYFILE_EXCL)
      await fs.unlink(file)
    })
    const sidecar = `${file}.manifest.json`
    const sidecarDestination = `${destination}.manifest.json`
    await fs.rename(sidecar, sidecarDestination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
    return destination
  }
}

function safe(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "batch"
  )
}

function unique(value: string): string {
  return `${value}-${Date.now()}-${process.pid}`
}

function suffix(file: string): string {
  const name = file.toLowerCase()
  const value = name.match(/(\.tar\.(?:gz|bz2|xz)|\.(?:zip|tgz|tbz2|txz|xml|jsonl|ndjson|json)(?:\.gz)?)$/)?.[1]
  return value ?? ".bin"
}
