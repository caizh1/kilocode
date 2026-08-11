import type { DiscoveredDesignDocModuleTree } from "@kilocode/kilo-indexing/design-doc"
import type { ModuleManifest, WorkItem } from "./domain"

export function buildModuleManifest(
  tree: DiscoveredDesignDocModuleTree,
  workItems: readonly WorkItem[],
  createdAt: number,
): ModuleManifest {
  return {
    schemaVersion: 1,
    sourceSnapshotHash: tree.sourceSnapshotHash,
    rootModuleID: tree.rootModuleID,
    modules: tree.modules.map((module) => ({
      id: module.id,
      name: module.name,
      path: module.path,
      ...(module.parentID ? { parentID: module.parentID } : {}),
      languages: [...new Set(module.files.map((file) => file.language))],
      sourceFiles: module.files.filter((file) => file.sourceKind !== "test").map((file) => file.path),
      testFiles: module.files.filter((file) => file.sourceKind === "test").map((file) => file.path),
      ...(module.unitKind ? { unitKind: module.unitKind } : {}),
      ...(module.implementationFiles ? { implementationFiles: module.implementationFiles } : {}),
      ...(module.supportFiles ? { supportFiles: module.supportFiles } : {}),
    })),
    ...(tree.ownership ? { ownership: tree.ownership } : {}),
    workItemIDs: workItems.map((item) => item.id),
    createdAt,
  }
}
