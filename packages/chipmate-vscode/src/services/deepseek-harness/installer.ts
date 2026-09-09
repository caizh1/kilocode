import { createHash, randomUUID } from "node:crypto"
import { createWriteStream, existsSync, readFileSync } from "node:fs"
import * as fs from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import * as vscode from "vscode"
import * as yauzl from "yauzl"
import { resolveChipmateServer } from "../chipmate-server"
import {
  deepSeekHarnessHostTarget,
  isAllowedDeepSeekHarnessRuntimeBase,
  parseDeepSeekHarnessRuntimeCatalog,
  sameDeepSeekHarnessRuntimeArtifact,
  type DeepSeekHarnessRuntimeArtifact,
  type DeepSeekHarnessRuntimeCatalog,
} from "../../shared/deepseek-harness-runtime"

const LOCK_FILE = "dsh-runtime-lock.json"
const SERVER_MANIFEST = "/packages/runtimes/deepseek-harness/manifest.json"
const DOWNLOAD_TIMEOUT = 15 * 60_000
const LOCK_STALE = 20 * 60_000

type Receipt = { schemaVersion: 1; artifact: DeepSeekHarnessRuntimeArtifact; installedAt: string }
type FileManifest = {
  schemaVersion: 1
  files: Array<{ path: string; size: number; sha256: string; mode: number }>
}

export type InstalledDeepSeekHarnessRuntime = {
  root: string
  artifact: DeepSeekHarnessRuntimeArtifact
}

export class DeepSeekHarnessRuntimeInstaller {
  private task?: Promise<InstalledDeepSeekHarnessRuntime>
  private readonly root: string
  private readonly owner = randomUUID()

  constructor(private readonly context: vscode.ExtensionContext) {
    this.root = join(context.globalStorageUri.fsPath, "deepseek-harness")
  }

  available(): boolean {
    const target = deepSeekHarnessHostTarget()
    if (!target) return false
    return loadDeepSeekHarnessRuntimeLock(this.context.extensionUri)?.artifacts[target] !== undefined
  }

  ensureInstalled(): Promise<InstalledDeepSeekHarnessRuntime> {
    this.task ??= this.install().finally(() => (this.task = undefined))
    return this.task
  }

  private async install(): Promise<InstalledDeepSeekHarnessRuntime> {
    const artifact = requiredArtifact(this.context.extensionUri)
    const destination = runtimeDestination(this.root, artifact)
    if (await validInstallation(destination, artifact)) return { root: destination, artifact }
    if (existsSync(destination))
      throw new Error("已安装的官方 DSH 运行时被外部修改；为避免静默覆盖，ChipMate DeepSeek Harness 已停用")

    await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
    const lock = await this.acquireInstallLock(artifact, destination)
    try {
      if (await validInstallation(destination, artifact)) return { root: destination, artifact }
      if (existsSync(destination))
        throw new Error("已安装的官方 DSH 运行时被外部修改；为避免静默覆盖，ChipMate DeepSeek Harness 已停用")
      const base = productionServerBase()
      const manifest = await fetchJson(new URL(SERVER_MANIFEST, base), base)
      const remote = parseDeepSeekHarnessRuntimeCatalog(manifest).artifacts[artifact.target]
      if (!remote || !sameDeepSeekHarnessRuntimeArtifact(remote, artifact))
        throw new Error("ChipMate Server 的 DeepSeek Harness 运行时清单与 VSIX 固定锁不一致")

      const url = new URL(artifact.url, base)
      if (url.origin !== base.origin) throw new Error("DeepSeek Harness 运行时下载地址不是 ChipMate Server 同源地址")
      const archive = join(this.root, `.runtime-${artifact.sha256}-${process.pid}-${Date.now()}.zip`)
      const staging = join(this.root, `.runtime-${artifact.sha256}-${process.pid}-${randomUUID()}.stage`)
      try {
        await download(url, base, archive, artifact)
        await fs.mkdir(staging, { recursive: true, mode: 0o700 })
        await extractRuntime(archive, staging, artifact)
        await verifyExtractedRuntime(staging, artifact)
        await fs.mkdir(dirname(destination), { recursive: true, mode: 0o700 })
        await fs.rename(staging, destination)
      } finally {
        await fs.rm(archive, { force: true })
        await fs.rm(staging, { recursive: true, force: true })
      }
      return { root: destination, artifact }
    } finally {
      await lock.close()
      await fs.rm(lock.path, { force: true })
    }
  }

  private async acquireInstallLock(
    artifact: DeepSeekHarnessRuntimeArtifact,
    destination: string,
  ): Promise<{ close: () => Promise<void>; path: string }> {
    const path = join(this.root, "runtime-install.lock")
    for (let attempt = 0; attempt < 4_800; attempt += 1) {
      try {
        const handle = await fs.open(path, "wx", 0o600)
        await handle.writeFile(JSON.stringify({ owner: this.owner, pid: process.pid, createdAt: Date.now() }))
        return { close: () => handle.close(), path }
      } catch (error) {
        if (!exists(error)) throw error
        if (await validInstallation(destination, artifact)) {
          const handle = await fs.open(path, "r")
          return { close: () => handle.close(), path: join(this.root, `.unused-${randomUUID()}`) }
        }
        if (attempt % 50 === 0) await removeStaleLock(path)
        await delay(200)
      }
    }
    throw new Error("等待 DeepSeek Harness 运行时安装锁超时")
  }
}

export function hasDeepSeekHarnessRuntimeLock(extension: vscode.Uri): boolean {
  return loadDeepSeekHarnessRuntimeLock(extension) !== undefined
}

export function loadDeepSeekHarnessRuntimeLock(extension: vscode.Uri): DeepSeekHarnessRuntimeCatalog | undefined {
  const path = join(extension.fsPath, "bin", LOCK_FILE)
  if (!existsSync(path)) return undefined
  try {
    return parseDeepSeekHarnessRuntimeCatalog(JSON.parse(readFileSync(path, "utf8")))
  } catch (error) {
    console.warn("[DeepSeek Harness] VSIX 运行时锁无效：", error)
    return undefined
  }
}

function requiredArtifact(extension: vscode.Uri): DeepSeekHarnessRuntimeArtifact {
  const target = deepSeekHarnessHostTarget()
  if (!target) throw new Error("当前平台不支持 DeepSeek Harness 远程运行时")
  const artifact = loadDeepSeekHarnessRuntimeLock(extension)?.artifacts[target]
  if (!artifact) throw new Error(`VSIX 缺少 ${target} 的 DeepSeek Harness 固定运行时锁`)
  return artifact
}

function runtimeDestination(root: string, artifact: DeepSeekHarnessRuntimeArtifact): string {
  return join(root, "runtimes", artifact.target, artifact.dshVersion, artifact.sha256)
}

function productionServerBase(): URL {
  const state = resolveChipmateServer()
  if (state.source === "invalid" || state.source === "conflict") throw new Error("ChipMate Server 地址无效")
  const url = new URL(state.baseUrl)
  if (!isAllowedDeepSeekHarnessRuntimeBase(url))
    throw new Error("DeepSeek Harness 运行时只能通过 HTTPS、本机回环地址或字面量私网 IPv4 下载")
  return url
}

async function fetchJson(url: URL, base: URL): Promise<unknown> {
  const response = await request(url, base)
  if (!response.ok) throw new Error(`读取 DeepSeek Harness 运行时清单失败（HTTP ${response.status}）`)
  return response.json().catch(() => {
    throw new Error("DeepSeek Harness 运行时清单不是有效 JSON")
  })
}

async function download(
  url: URL,
  base: URL,
  path: string,
  artifact: DeepSeekHarnessRuntimeArtifact,
): Promise<void> {
  const response = await request(url, base)
  if (!response.ok || !response.body) throw new Error(`下载 DeepSeek Harness 运行时失败（HTTP ${response.status}）`)
  const length = Number(response.headers.get("content-length"))
  if (length !== artifact.sizeBytes) throw new Error("DeepSeek Harness 运行时 Content-Length 与固定锁不一致")
  if (response.headers.get("x-content-sha256")?.toLowerCase() !== artifact.sha256)
    throw new Error("DeepSeek Harness 运行时 SHA-256 响应头与固定锁不一致")
  const handle = await fs.open(path, "wx", 0o600)
  const reader = response.body.getReader()
  const hash = createHash("sha256")
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > artifact.sizeBytes) throw new Error("DeepSeek Harness 运行时下载字节数超过固定锁")
      hash.update(chunk.value)
      await handle.write(chunk.value)
    }
  } finally {
    await handle.close()
    reader.releaseLock()
  }
  if (size !== artifact.sizeBytes || hash.digest("hex") !== artifact.sha256)
    throw new Error("DeepSeek Harness 运行时大小或 SHA-256 校验失败")
}

async function request(url: URL, base: URL): Promise<Response> {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT) })
  if (response.status >= 300 && response.status < 400) throw new Error("DeepSeek Harness 运行时下载拒绝重定向")
  if (new URL(response.url || url.toString()).origin !== base.origin)
    throw new Error("DeepSeek Harness 运行时响应不是 ChipMate Server 同源地址")
  return response
}

async function extractRuntime(archive: string, destination: string, artifact: DeepSeekHarnessRuntimeArtifact) {
  const entries = new Set<string>()
  let expanded = 0
  await new Promise<void>((resolvePromise, reject) => {
    yauzl.open(archive, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError ?? new Error("无法打开 DeepSeek Harness ZIP"))
      const fail = (error: unknown) => {
        zip.close()
        reject(error)
      }
      zip.on("error", fail)
      zip.on("end", resolvePromise)
      zip.on("entry", (entry) => {
        void extractEntry(zip, entry, destination, entries)
          .then((size) => {
            expanded += size
            if (expanded > artifact.expandedSizeBytes || entries.size > artifact.fileCount)
              throw new Error("DeepSeek Harness ZIP 展开大小或文件数超过固定锁")
            zip.readEntry()
          })
          .catch(fail)
      })
      zip.readEntry()
    })
  })
  if (expanded !== artifact.expandedSizeBytes || entries.size !== artifact.fileCount)
    throw new Error("DeepSeek Harness ZIP 展开大小或文件数与固定锁不一致")
}

async function extractEntry(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  destination: string,
  entries: Set<string>,
): Promise<number> {
  const raw = entry.fileName
  const relative = validateDeepSeekHarnessArchivePath(raw)
  if (relative === undefined) return 0
  const segments = relative.split("/")
  const key = relative.toLocaleLowerCase("en-US")
  if (entries.has(key)) throw new Error("DeepSeek Harness ZIP 包含重复或大小写冲突路径")
  entries.add(key)
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff
  const kind = mode & 0o170000
  if (kind && kind !== 0o100000) throw new Error("DeepSeek Harness ZIP 包含链接或特殊文件")
  const target = resolve(destination, ...segments)
  if (!target.startsWith(`${resolve(destination)}${sep}`)) throw new Error("DeepSeek Harness ZIP 路径越界")
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, reject) =>
    zip.openReadStream(entry, (error, value) => (error || !value ? reject(error) : resolveStream(value))),
  )
  await new Promise<void>((resolveWrite, reject) => {
    const output = createWriteStream(target, { flags: "wx", mode: 0o600 })
    stream.on("error", reject)
    output.on("error", reject)
    output.on("finish", resolveWrite)
    stream.pipe(output)
  })
  return entry.uncompressedSize
}

async function verifyExtractedRuntime(
  root: string,
  artifact: DeepSeekHarnessRuntimeArtifact,
  writeReceipt = true,
): Promise<void> {
  const manifestPath = join(root, "file-manifest.json")
  const bytes = await fs.readFile(manifestPath)
  if (createHash("sha256").update(bytes).digest("hex") !== artifact.fileManifestSha256)
    throw new Error("DeepSeek Harness 文件清单哈希与固定锁不一致")
  const manifest = JSON.parse(bytes.toString("utf8")) as FileManifest
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length + 1 !== artifact.fileCount)
    throw new Error("DeepSeek Harness 文件清单结构无效")
  const expected = new Set([
    "file-manifest.json",
    ...manifest.files.map((item) => item.path),
    ...(existsSync(join(root, ".installed.json")) ? [".installed.json"] : []),
  ])
  const actual = await regularFiles(root)
  if (actual.length !== expected.size || actual.some((item) => !expected.has(item)))
    throw new Error("DeepSeek Harness 解压目录包含未锁定文件")
  for (const item of manifest.files) {
    await verifyManifestFile(root, item)
  }
  const runtime = JSON.parse(await fs.readFile(join(root, "runtime-manifest.json"), "utf8")) as {
    dshVersion?: string
    nodeVersion?: string
    target?: string
  }
  if (
    runtime.dshVersion !== artifact.dshVersion ||
    runtime.nodeVersion !== artifact.nodeVersion ||
    runtime.target !== artifact.target
  )
    throw new Error("DeepSeek Harness 内部运行时清单与固定锁不一致")
  if (!writeReceipt) return
  const receipt: Receipt = { schemaVersion: 1, artifact, installedAt: new Date().toISOString() }
  await fs.writeFile(join(root, ".installed.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
}

async function verifyManifestFile(
  root: string,
  item: { path: string; size: number; sha256: string; mode: number },
): Promise<void> {
  if (!safeManifestPath(item.path) || !Number.isSafeInteger(item.size) || !/^[a-f0-9]{64}$/u.test(item.sha256))
    throw new Error("DeepSeek Harness 文件清单条目无效")
  const path = join(root, ...item.path.split("/"))
  const stat = await fs.lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.size || (await sha256(path)) !== item.sha256)
    throw new Error(`DeepSeek Harness 文件校验失败：${item.path}`)
  if (process.platform !== "win32") await fs.chmod(path, item.mode & 0o777)
}

async function validInstallation(root: string, artifact: DeepSeekHarnessRuntimeArtifact): Promise<boolean> {
  try {
    const receipt = JSON.parse(await fs.readFile(join(root, ".installed.json"), "utf8")) as Receipt
    if (receipt.schemaVersion !== 1 || !sameDeepSeekHarnessRuntimeArtifact(receipt.artifact, artifact)) return false
    await verifyExtractedRuntime(root, artifact, false)
    return true
  } catch {
    return false
  }
}

async function regularFiles(root: string, directory = root): Promise<string[]> {
  const result: string[] = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error("DeepSeek Harness 目录包含符号链接")
    if (entry.isDirectory()) result.push(...(await regularFiles(root, path)))
    else if (entry.isFile()) result.push(path.slice(root.length + 1).split(sep).join("/"))
    else throw new Error("DeepSeek Harness 目录包含特殊文件")
  }
  return result
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(path)).digest("hex")
}

function safeManifestPath(path: string): boolean {
  return (
    path !== "file-manifest.json" &&
    !path.includes("\\") &&
    path.split("/").every((part) => part && part !== "." && part !== ".." && !part.includes(":"))
  )
}

export function validateDeepSeekHarnessArchivePath(raw: string): string | undefined {
  if (!raw.startsWith("dsh-runtime/") || raw.includes("\\") || raw.includes("\0"))
    throw new Error("DeepSeek Harness ZIP 包含非法根路径")
  const relative = raw.slice("dsh-runtime/".length)
  if (!relative || relative.endsWith("/")) return undefined
  if (relative.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":")))
    throw new Error("DeepSeek Harness ZIP 包含路径逃逸或 Windows ADS")
  return relative
}

async function removeStaleLock(path: string): Promise<void> {
  try {
    const value = JSON.parse(await fs.readFile(path, "utf8")) as { createdAt?: number; pid?: number }
    if (typeof value.createdAt !== "number" || Date.now() - value.createdAt <= LOCK_STALE) return
    if (typeof value.pid === "number") {
      try {
        process.kill(value.pid, 0)
        return
      } catch {
        // 进程已不存在，允许清理过期锁。
      }
    }
    await fs.rm(path, { force: true })
  } catch (error) {
    if (!missing(error)) console.warn("[DeepSeek Harness] 无法检查运行时安装锁：", error)
  }
}

function exists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EEXIST"
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT"
}

const delay = (milliseconds: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
