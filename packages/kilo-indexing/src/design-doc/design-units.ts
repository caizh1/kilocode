import { createHash } from "crypto"
import path from "path"
import { discoverDesignDocModule, type DiscoverDesignDocModuleInput } from "./discovery"
import type {
  DesignDocSourceFile,
  DiscoveredDesignDocModule,
  DiscoveredDesignDocModuleTree,
} from "./types"
import { DesignDocDiscoveryError } from "./types"

export interface DiscoverDesignDocUnitsInput extends DiscoverDesignDocModuleInput {
  maxModules?: number
}

/**
 * 为完整详细设计建立确定性的 DesignUnit 树。
 *
 * 根目录始终是一个聚合单元；每个 C 实现文件形成一个组件单元，同名头文件
 * 归入该组件，其余头文件归根单元。模型不参与单元数量和文件归属决策。
 */
export async function discoverDesignDocUnits(
  input: DiscoverDesignDocUnitsInput,
): Promise<DiscoveredDesignDocModuleTree> {
  const discovered = await discoverDesignDocModule(input)
  const implementations = discovered.files.filter(
    (file) => file.language === "c" && file.sourceKind !== "test" && file.path.endsWith(".c"),
  )
  if (!implementations.length) {
    return {
      rootModuleID: discovered.id,
      modules: [{ ...discovered, unitKind: "root", implementationFiles: discovered.files.map((file) => file.path) }],
      sourceSnapshotHash: discovered.sourceSnapshotHash,
      ownership: discovered.files.map((file) => ({
        path: file.path,
        ownerModuleID: discovered.id,
        role: "implementation" as const,
      })),
    }
  }

  const maxModules = input.maxModules ?? 128
  if (implementations.length + 1 > maxModules) {
    throw new DesignDocDiscoveryError(
      "SOURCE_LIMIT_EXCEEDED",
      `DesignUnit 数量 ${implementations.length + 1} 超过限制 ${maxModules}`,
    )
  }

  const owned = new Set<string>()
  const components = implementations
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((implementation) => {
      const headerPath = implementation.path.replace(/\.c$/, ".h")
      const header = discovered.files.find((file) => file.path === headerPath)
      const files = header ? [implementation, header] : [implementation]
      files.forEach((file) => owned.add(file.path))
      return component(discovered, implementation, files)
    })
  const support = discovered.files.filter((file) => !owned.has(file.path))
  const root = rootUnit(discovered, support)
  const ownership = [
    ...support.map((file) => ({ path: file.path, ownerModuleID: root.id, role: "support" as const })),
    ...components.flatMap((unit) =>
      unit.files.map((file) => ({
        path: file.path,
        ownerModuleID: unit.id,
        role: file.path.endsWith(".c") ? ("implementation" as const) : ("support" as const),
      })),
    ),
  ].sort((left, right) => left.path.localeCompare(right.path))

  return {
    rootModuleID: root.id,
    modules: [root, ...components.map((unit) => ({ ...unit, parentID: root.id }))],
    sourceSnapshotHash: discovered.sourceSnapshotHash,
    ownership,
  }
}

function rootUnit(discovered: DiscoveredDesignDocModule, support: DesignDocSourceFile[]) {
  return {
    ...discovered,
    id: `MOD-${sha256(`${discovered.path}\0root\0${discovered.sourceSnapshotHash}`).slice(0, 20)}`,
    unitKind: "root" as const,
    implementationFiles: discovered.files.filter((file) => file.path.endsWith(".c")).map((file) => file.path),
    supportFiles: support.map((file) => file.path),
  }
}

function component(
  discovered: DiscoveredDesignDocModule,
  implementation: DesignDocSourceFile,
  files: DesignDocSourceFile[],
) {
  const sourceSnapshotHash = snapshot(files)
  const basename = path.posix.basename(implementation.path, ".c")
  return {
    id: `MOD-${sha256(`${discovered.path}\0c-component\0${implementation.path}\0${sourceSnapshotHash}`).slice(0, 20)}`,
    name: basename,
    path: `${discovered.path}#${basename}`,
    absolutePath: discovered.absolutePath,
    sourceSnapshotHash,
    files,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    unitKind: "c-component" as const,
    implementationFiles: [implementation.path],
    supportFiles: files.filter((file) => file.path !== implementation.path).map((file) => file.path),
  }
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
