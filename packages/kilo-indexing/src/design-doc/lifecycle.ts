import { extractCLifecycleEvidence } from "./c-lifecycle"
import { extractTypeScriptLifecycleEvidence } from "./typescript-lifecycle"
import type { DiscoveredDesignDocModule, LifecycleExtractionResult, RawLifecycleEvidence } from "./types"

const derivedUnknown = ["未发现至少两个可由源码直接证明的状态", "未发现同时具有明确起点和终点的状态迁移"]

export async function extractLifecycleEvidence(module: DiscoveredDesignDocModule): Promise<LifecycleExtractionResult> {
  const hasC = module.files.some((file) => file.language === "c")
  const hasTypeScript = module.files.some((file) => file.language === "typescript" || file.language === "tsx")
  const results = await Promise.all([
    ...(hasC ? [extractCLifecycleEvidence(module)] : []),
    ...(hasTypeScript ? [extractTypeScriptLifecycleEvidence(module)] : []),
  ])
  const evidence = deduplicate(results.flatMap((result) => result.evidence))
  const confirmed = evidence.filter((item) => item.confidence === "explicit" && item.source.sourceKind !== "test")
  const states = new Set(
    confirmed
      .filter((item) => item.kind === "state-definition" || item.kind === "initial-state")
      .flatMap((item) => (typeof item.attributes.state === "string" ? [item.attributes.state] : [])),
  )
  const transitions = confirmed.filter((item) => item.kind === "state-transition")
  const fields = new Set(
    confirmed
      .filter((item) => item.kind === "state-field" || item.kind === "state-transition")
      .flatMap((item) => (typeof item.attributes.field === "string" ? [normalizedField(item.attributes.field)] : [])),
  )
  const unknowns = results
    .flatMap((result) => result.unknowns)
    .filter((item) => !derivedUnknown.includes(item) && !item.startsWith("发现多个候选状态字段"))
  if (states.size < 2) unknowns.push(derivedUnknown[0])
  if (transitions.length === 0) unknowns.push(derivedUnknown[1])
  if (fields.size > 1) unknowns.push(`发现多个候选状态字段，MVP 不自动合并：${[...fields].sort().join("、")}`)

  return {
    moduleID: module.id,
    sourceSnapshotHash: module.sourceSnapshotHash,
    evidence,
    unknowns: [...new Set(unknowns)],
  }
}

function normalizedField(value: string) {
  const field = /([A-Za-z_$][\w$]*)\s*$/.exec(value)?.[1]?.toLowerCase() ?? value.toLowerCase()
  if (field === "transitionto") return "state"
  return field.replace(/^set(?=[a-z_$])/, "")
}

function deduplicate(items: RawLifecycleEvidence[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = [item.kind, item.source.path, item.source.startLine, item.source.endLine, item.fact].join(":")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
