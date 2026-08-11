import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { discoverDesignDocModule, type DiscoverDesignDocModuleInput } from "./discovery"
import type {
  DesignDocModuleHint,
  DesignDocSourceFile,
  DiscoveredDesignDocModule,
  DiscoveredDesignDocModuleTree,
} from "./types"
import { DesignDocDiscoveryError } from "./types"

export interface DiscoverLogicalDesignDocUnitsInput extends DiscoverDesignDocModuleInput {
  moduleHints?: DesignDocModuleHint[]
  maxModules?: number
}

/**
 * 建立产品级逻辑模块树。实现文件只是发现信号，只有具备公开边界、独立入口、
 * 生命周期或资源所有权的候选才会成为子模块；根调度文件和支撑定义保留在根单元。
 */
export async function discoverLogicalDesignDocUnits(
  input: DiscoverLogicalDesignDocUnitsInput,
): Promise<DiscoveredDesignDocModuleTree> {
  const discovered = await discoverDesignDocModule(input)
  const implementations = discovered.files.filter((file) => implementation(file) && file.sourceKind !== "test")
  const hinted = hintedGroups(discovered, implementations, input.moduleHints ?? [])
  const hintedPaths = new Set(hinted.flatMap((group) => group.files.map((file) => file.path)))
  const automatic = await Promise.all(
    implementations.filter((file) => !hintedPaths.has(file.path)).map((file) => candidate(discovered, file)),
  )
  const confirmed = [...hinted, ...automatic.flatMap((value) => (value ? [value] : []))]
  const maxModules = input.maxModules ?? 128
  if (confirmed.length + 1 > maxModules) {
    throw new DesignDocDiscoveryError(
      "SOURCE_LIMIT_EXCEEDED",
      `逻辑模块数量 ${confirmed.length + 1} 超过限制 ${maxModules}`,
    )
  }
  const ownership = new Map<string, { ownerModuleID: string; role: "implementation" | "support" }>()
  const modules = confirmed.map((group) => {
    const unit = logicalUnit(discovered, group.name, group.files)
    for (const file of group.files) {
      ownership.set(file.path, {
        ownerModuleID: unit.id,
        role: implementation(file) ? "implementation" : "support",
      })
    }
    return { ...unit, parentID: rootID(discovered) }
  })
  const root = rootUnit(discovered, [...ownership.keys()])
  for (const file of discovered.files) {
    if (ownership.has(file.path)) continue
    ownership.set(file.path, { ownerModuleID: root.id, role: implementation(file) ? "implementation" : "support" })
  }
  return {
    rootModuleID: root.id,
    modules: [root, ...modules.map((module) => ({ ...module, parentID: root.id }))],
    sourceSnapshotHash: discovered.sourceSnapshotHash,
    ownership: [...ownership.entries()]
      .map(([file, value]) => ({ path: file, ...value }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

interface LogicalGroup {
  name: string
  files: DesignDocSourceFile[]
}

function hintedGroups(
  discovered: DiscoveredDesignDocModule,
  implementations: DesignDocSourceFile[],
  hints: DesignDocModuleHint[],
): LogicalGroup[] {
  const used = new Set<string>()
  return hints.flatMap((hint) => {
    const paths = [
      ...new Set(
        hint.includePaths.flatMap((value) => {
          const normalized = portable(value).replace(/^\.\//, "").replace(/\/$/, "")
          return normalized === discovered.path || normalized.startsWith(`${discovered.path}/`)
            ? [normalized]
            : [normalized, path.posix.join(discovered.path, normalized)]
        }),
      ),
    ]
    const files = discovered.files.filter((file) => paths.some((value) => matchesHint(file.path, value)))
    const implementationFiles = files.filter((file) => implementations.some((item) => item.path === file.path))
    if (!implementationFiles.length) {
      throw new DesignDocDiscoveryError("INVALID_TARGET", `模块提示“${hint.name}”没有匹配生产实现文件`)
    }
    for (const file of files) {
      if (used.has(file.path)) {
        throw new DesignDocDiscoveryError("INVALID_TARGET", `模块提示重复声明源码所有权：${file.path}`)
      }
      used.add(file.path)
    }
    return [{ name: hint.name, files }]
  })
}

async function candidate(discovered: DiscoveredDesignDocModule, file: DesignDocSourceFile): Promise<LogicalGroup | undefined> {
  const content = await readFile(file.absolutePath, "utf8")
  if (rootOrchestrator(file, content)) return
  const header = matchingHeader(discovered.files, file)
  const hasPublicBoundary = Boolean(header && (await readFile(header.absolutePath, "utf8")).match(functionDeclaration))
  const hasExportedBoundary = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|const|let|var)\b/.test(
    content,
  )
  const hasLifecycle = lifecycleBoundary.test(content)
  const ownsResource = resourceOwnership.test(content)
  if (!hasPublicBoundary && !hasExportedBoundary && !hasLifecycle && !ownsResource) return
  return { name: humanName(file.path), files: [file, ...(header ? [header] : [])] }
}

function rootUnit(discovered: DiscoveredDesignDocModule, owned: string[]) {
  const id = rootID(discovered)
  return {
    ...discovered,
    id,
    unitKind: "root" as const,
    implementationFiles: discovered.files.filter(implementation).map((file) => file.path),
    supportFiles: discovered.files.filter((file) => !owned.includes(file.path)).map((file) => file.path),
  }
}

function logicalUnit(discovered: DiscoveredDesignDocModule, name: string, files: DesignDocSourceFile[]) {
  const sourceSnapshotHash = snapshot(files)
  const safe = name.trim() || "子模块"
  return {
    id: `MOD-${sha256(`${discovered.path}\0logical-submodule\0${safe}\0${sourceSnapshotHash}`).slice(0, 20)}`,
    name: safe,
    path: `${discovered.path}#${safe}`,
    absolutePath: discovered.absolutePath,
    sourceSnapshotHash,
    files,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    unitKind: "logical-submodule" as const,
    implementationFiles: files.filter(implementation).map((file) => file.path),
    supportFiles: files.filter((file) => !implementation(file)).map((file) => file.path),
  }
}

function rootID(discovered: DiscoveredDesignDocModule) {
  return `MOD-${sha256(`${discovered.path}\0product-root\0${discovered.sourceSnapshotHash}`).slice(0, 20)}`
}

function rootOrchestrator(file: DesignDocSourceFile, content: string) {
  const stem = path.posix.basename(file.path, path.posix.extname(file.path)).toLowerCase()
  if (/^(?:main|index|entry|bootstrap|module|mod)$/.test(stem)) return true
  if (/(?:^|_)(?:main|entry|bootstrap)$/.test(stem)) return true
  const calls = content.match(/\b[A-Za-z_]\w*\s*\(/g)?.length ?? 0
  return /\b(?:main|run|start|bootstrap)\s*\(/.test(content) && calls >= 6
}

function matchingHeader(files: DesignDocSourceFile[], implementationFile: DesignDocSourceFile) {
  const base = implementationFile.path.replace(/\.(?:c|cc|cpp|cxx)$/i, "")
  return files.find((file) => new RegExp(`^${escape(base)}\\.(?:h|hh|hpp|hxx)$`, "i").test(file.path))
}

function implementation(file: DesignDocSourceFile) {
  return /\.(?:c|cc|cpp|cxx|ts|tsx)$/i.test(file.path) && !/\.d\.ts$/i.test(file.path)
}

function matchesHint(file: string, hint: string) {
  const normalized = hint.replace(/^\.\//, "").replace(/\/$/, "")
  return file === normalized || file.startsWith(`${normalized}/`)
}

function humanName(value: string) {
  return path.posix
    .basename(value, path.posix.extname(value))
    .replace(/[-_]+/g, " ")
    .trim()
}

function snapshot(files: DesignDocSourceFile[]) {
  return sha256(
    [...files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => `${file.path}\0${file.contentHash}\0${file.bytes}`)
      .join("\n"),
  )
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function portable(value: string) {
  return value.split(path.sep).join("/")
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const functionDeclaration = /\b[A-Za-z_]\w*(?:\s+|\s*\*\s*)[A-Za-z_]\w*\s*\([^;{}]*\)\s*;/
const lifecycleBoundary = /\b(?:init|initialize|start|stop|shutdown|reset|register|unregister|handler|dispatch)\w*\s*\(/
const resourceOwnership =
  /\b(?:static|global)\b[^;\n]*(?:queue|fifo|buffer|cache|pool|context|state|status|device|resource)\w*|\b(?:queue|fifo|buffer|cache|pool|context|state|status)\w*\s*(?:\[|=)/i
