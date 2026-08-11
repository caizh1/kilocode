import { createHash } from "crypto"
import { constants } from "fs"
import { lstat, open, opendir, readFile, realpath, stat } from "fs/promises"
import ignore from "ignore"
import path from "path"
import type {
  DesignDocLanguage,
  DesignDocSourceFile,
  DiscoveredDesignDocModule,
  DiscoveredDesignDocModuleTree,
} from "./types"
import { DesignDocDiscoveryError } from "./types"

const excludedNames = new Set([
  ".git",
  ".chipmate",
  ".chipmate",
  ".chipmate-v2",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "generated",
  "gen",
  ".turbo",
  ".next",
  ".cache",
  "vendor",
])

export interface DiscoverDesignDocModuleInput {
  workspace: string
  targetPath: string
  maxFiles?: number
  maxBytes?: number
  maxDirectories?: number
  maxDepth?: number
}

export async function discoverDesignDocModule(input: DiscoverDesignDocModuleInput): Promise<DiscoveredDesignDocModule> {
  const maxFiles = input.maxFiles ?? 2_000
  const maxBytes = input.maxBytes ?? 64 * 1024 * 1024
  const maxDirectories = input.maxDirectories ?? 10_000
  const maxDepth = input.maxDepth ?? 64
  const workspace = await canonicalDirectory(input.workspace, "INVALID_TARGET")
  const requested = path.resolve(workspace, input.targetPath)
  assertContained(workspace, requested)

  const requestedStat = await lstat(requested).catch(() => undefined)
  if (requestedStat?.isSymbolicLink()) {
    throw new DesignDocDiscoveryError("SYMLINK_TARGET", "目标模块不能是符号链接")
  }
  if (!requestedStat?.isDirectory()) {
    throw new DesignDocDiscoveryError("INVALID_TARGET", "目标模块必须是存在的目录")
  }

  const target = await realpath(requested)
  assertContained(workspace, target)
  const matcher = await loadIgnoreMatcher(workspace, target)
  const files: DesignDocSourceFile[] = []
  let totalBytes = 0
  let directories = 0

  async function visit(directory: string, depth: number) {
    const directoryInfo = await lstat(directory).catch(() => undefined)
    const canonical = directoryInfo?.isDirectory() && !directoryInfo.isSymbolicLink() ? await realpath(directory) : undefined
    if (!canonical || canonical !== path.resolve(directory)) {
      throw new DesignDocDiscoveryError("SYMLINK_TARGET", "源码目录包含符号链接或重解析跳转")
    }
    assertContained(target, canonical)
    directories += 1
    if (directories > maxDirectories || depth > maxDepth) {
      throw new DesignDocDiscoveryError(
        "SOURCE_LIMIT_EXCEEDED",
        `源码目录范围超过限制：最多 ${maxDirectories} 个目录或 ${maxDepth} 层深度`,
      )
    }
    const entries = []
    const handle = await opendir(directory)
    for await (const entry of handle) entries.push(entry)
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (excludedNames.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      const relative = portable(path.relative(workspace, absolute))
      if (matcher.ignores(relative)) continue
      const entryInfo = await lstat(absolute).catch(() => undefined)
      if (!entryInfo || entryInfo.isSymbolicLink()) continue
      if (entryInfo.isDirectory()) {
        await visit(absolute, depth + 1)
        continue
      }
      if (!entryInfo.isFile()) continue
      const language = supportedLanguage(entry.name)
      if (!language || entry.name.endsWith(".d.ts")) continue
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined)
      if (!handle) continue
      const opened = await (async () => {
        try {
          const openedInfo = await handle.stat()
          if (!openedInfo.isFile()) return undefined
          const canonicalFile = await realpath(absolute)
          assertContained(target, canonicalFile)
          if (canonicalFile !== path.resolve(absolute)) {
            throw new DesignDocDiscoveryError("SYMLINK_TARGET", `源码路径包含重解析跳转：${relative}`)
          }
          const current = await stat(canonicalFile)
          if (current.dev !== openedInfo.dev || current.ino !== openedInfo.ino) {
            throw new DesignDocDiscoveryError("SOURCE_CHANGED", `源码文件在发现期间被替换：${relative}`)
          }
          if (files.length + 1 > maxFiles || totalBytes + openedInfo.size > maxBytes) {
            throw new DesignDocDiscoveryError(
              "SOURCE_LIMIT_EXCEEDED",
              `源码范围超过限制：最多 ${maxFiles} 个文件或 ${maxBytes} 字节`,
            )
          }
          return { content: await handle.readFile() }
        } finally {
          await handle.close()
        }
      })()
      if (!opened) continue
      const { content } = opened
      totalBytes += content.byteLength
      files.push({
        path: relative,
        absolutePath: absolute,
        contentHash: sha256(content),
        bytes: content.byteLength,
        language,
        sourceKind: sourceKind(relative),
      })
    }
  }

  await visit(target, 0)
  if (files.length === 0) {
    throw new DesignDocDiscoveryError("NO_SUPPORTED_SOURCE", "目标模块中没有受支持的 TypeScript/TSX/C 源码")
  }

  const modulePath = portable(path.relative(workspace, target)) || "."
  const sourceSnapshotHash = sha256(files.map((file) => `${file.path}\0${file.contentHash}\0${file.bytes}`).join("\n"))
  return {
    id: `MOD-${sha256(`${modulePath}\0${sourceSnapshotHash}`).slice(0, 20)}`,
    name: path.basename(target),
    path: modulePath,
    absolutePath: target,
    sourceSnapshotHash,
    files,
    totalBytes,
  }
}

export async function discoverDesignDocModules(
  input: DiscoverDesignDocModuleInput & { recursive: boolean; maxModules?: number },
): Promise<DiscoveredDesignDocModuleTree> {
  const root = await discoverDesignDocModule(input)
  if (!input.recursive) {
    return { rootModuleID: root.id, modules: [root], sourceSnapshotHash: root.sourceSnapshotHash }
  }
  const maxModules = input.maxModules ?? 128
  const direct = new Map<string, DesignDocSourceFile[]>()
  for (const file of root.files) {
    const directory = portable(path.dirname(file.path))
    const values = direct.get(directory) ?? []
    values.push(file)
    direct.set(directory, values)
  }
  const moduleCount = direct.has(root.path) ? direct.size : direct.size + 1
  if (moduleCount > maxModules) {
    throw new DesignDocDiscoveryError("SOURCE_LIMIT_EXCEEDED", `递归模块数量 ${moduleCount} 超过限制 ${maxModules}`)
  }
  const directRootFiles = direct.get(root.path) ?? []
  const rootSnapshot = snapshot(directRootFiles)
  const directRoot: DiscoveredDesignDocModule & { parentID?: string } = {
    ...root,
    id: `MOD-${sha256(`${root.path}\0${rootSnapshot}`).slice(0, 20)}`,
    sourceSnapshotHash: rootSnapshot,
    files: directRootFiles,
    totalBytes: directRootFiles.reduce((total, file) => total + file.bytes, 0),
  }
  const modules: Array<DiscoveredDesignDocModule & { parentID?: string }> = [directRoot]
  const paths = [...direct.keys()]
    .filter((modulePath) => modulePath !== root.path)
    .sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right))
  for (const modulePath of paths) {
    const files = direct.get(modulePath) ?? []
    const moduleSnapshot = snapshot(files)
    const id = `MOD-${sha256(`${modulePath}\0${moduleSnapshot}`).slice(0, 20)}`
    const parent = [...modules]
      .filter((candidate) => modulePath.startsWith(`${candidate.path}/`))
      .sort((left, right) => right.path.length - left.path.length)[0]
    modules.push({
      id,
      name: path.basename(modulePath),
      path: modulePath,
      absolutePath: path.join(await canonicalDirectory(input.workspace, "INVALID_TARGET"), modulePath),
      sourceSnapshotHash: moduleSnapshot,
      files,
      totalBytes: files.reduce((total, file) => total + file.bytes, 0),
      parentID: parent?.id ?? root.id,
    })
  }
  return { rootModuleID: directRoot.id, modules, sourceSnapshotHash: root.sourceSnapshotHash }
}

function snapshot(files: DesignDocSourceFile[]) {
  return sha256(files.map((file) => `${file.path}\0${file.contentHash}\0${file.bytes}`).join("\n"))
}

async function canonicalDirectory(input: string, code: DesignDocDiscoveryError["code"]) {
  const resolved = path.resolve(input)
  const stat = await lstat(resolved).catch(() => undefined)
  if (!stat?.isDirectory()) throw new DesignDocDiscoveryError(code, "工作区目录不存在")
  return realpath(resolved)
}

function assertContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)))
    return
  throw new DesignDocDiscoveryError("PATH_ESCAPE", "目标模块必须位于当前工作区内")
}

async function loadIgnoreMatcher(workspace: string, target: string) {
  const matcher = ignore()
  for (const file of new Set([path.join(workspace, ".gitignore"), path.join(target, ".gitignore")])) {
    const content = await readFile(file, "utf8").catch(() => undefined)
    if (content) matcher.add(content)
  }
  return matcher
}

function supportedLanguage(file: string): DesignDocLanguage | undefined {
  if (file.endsWith(".tsx")) return "tsx"
  if (file.endsWith(".ts")) return "typescript"
  if (file.endsWith(".c") || file.endsWith(".h")) return "c"
  return undefined
}

function sourceKind(file: string) {
  if (/(^|\/)(__tests__|test|tests|spec)(\/|\.)/i.test(file) || /\.(test|spec)\.tsx?$/.test(file)) return "test"
  if (/(^|\/)(config|configuration)(\/|\.)/i.test(file)) return "config"
  return "production"
}

function portable(value: string) {
  return value.split(path.sep).join("/")
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}
