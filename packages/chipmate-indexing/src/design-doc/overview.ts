import type { DiscoveredDesignDocModule, OverviewExtractionResult } from "./types"
import { extractBehaviorEvidence } from "./behavior"
import { extractCodeStructureEvidence } from "./code-structure"
import { extractStructureEvidence } from "./structure"

export async function extractOverviewEvidence(
  module: DiscoveredDesignDocModule,
): Promise<OverviewExtractionResult> {
  const [structure, code, behavior] = await Promise.all([
    extractStructureEvidence(module),
    extractCodeStructureEvidence(module),
    extractBehaviorEvidence(module),
  ])
  const called = new Set(
    behavior.evidence
      .filter((item) => item.kind === "call-message")
      .flatMap((item) =>
        typeof item.attributes.toRef === "string" && !item.attributes.toRef.startsWith("external:")
          ? [item.attributes.toRef]
          : [],
      ),
  )
  const entries = behavior.evidence.filter(
    (item) =>
      item.kind === "flow-node" &&
      item.attributes.nodeKind === "entry" &&
      typeof item.attributes.ownerRef === "string" &&
      !called.has(item.attributes.ownerRef),
  )
  const representatives = [
    ...new Map(
      code.evidence
        .filter((item) => item.kind === "code-symbol" && item.attributes.parentRef === item.source.path)
        .sort((left, right) => left.source.path.localeCompare(right.source.path) || left.source.startLine - right.source.startLine)
        .map((item) => [item.source.path, item] as const),
    ).values(),
  ]
  return {
    moduleID: module.id,
    sourceSnapshotHash: module.sourceSnapshotHash,
    evidence: [
      ...structure.evidence,
      ...representatives,
      ...entries,
      ...behavior.evidence.filter((item) => item.kind === "configuration"),
    ],
    unknowns: [...new Set([...structure.unknowns, ...code.unknowns, ...behavior.unknowns])],
  }
}
