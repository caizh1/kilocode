import { createHash } from "node:crypto"
import { ChipMateIndexing } from "@/chipmate/indexing"
import type { PatentRadar } from "./types"

export async function semanticObservationRelations(
  mechanisms: PatentRadar.MechanismAtom[],
  evidence: PatentRadar.SourceEvidence[],
): Promise<{ relations: PatentRadar.EvidenceRelation[]; warnings: string[] }> {
  if (!(await ChipMateIndexing.available().catch(() => false))) {
    return { relations: [], warnings: ["本地 Embedding 索引未就绪，语义观察通道未执行；不影响确定性强关系候选。"] }
  }
  const byFile = new Map<string, PatentRadar.MechanismAtom[]>()
  const source = new Map(evidence.map((item) => [item.id, item]))
  for (const atom of mechanisms)
    for (const file of atom.sourceFiles) byFile.set(file, [...(byFile.get(file) ?? []), atom])
  const relations = new Map<string, PatentRadar.EvidenceRelation>()
  for (const atom of mechanisms) {
    const hits = await ChipMateIndexing.search(
      `${atom.abstractMechanism}\n${atom.technicalProblem}\n${atom.bridgeHooks.join("；")}`,
    ).catch(() => [])
    for (const hit of hits) {
      const file = hit.payload?.filePath
      if (!file || atom.sourceFiles.includes(file)) continue
      for (const target of byFile.get(file) ?? []) {
        const fromEvidenceId = atom.evidenceIds[0]
        const toEvidenceId = target.evidenceIds[0]
        const from = fromEvidenceId ? source.get(fromEvidenceId) : undefined
        const to = toEvidenceId ? source.get(toEvidenceId) : undefined
        if (!from || !to || from.id === to.id) continue
        const pair = [from.id, to.id].sort()
        const relationId = createHash("sha256")
          .update(`semantic:${pair.join(":")}`)
          .digest("hex")
          .slice(0, 16)
        relations.set(relationId, {
          relationId,
          kind: "semantic-similarity",
          fromEvidenceId: from.id,
          toEvidenceId: to.id,
          evidenceIds: [from.id, to.id],
          resolution: "unresolved",
          strength: "weak",
          variantIds: [],
          condition: "仅由本地 Embedding 发现潜在互补性，尚无确定性工程关系",
          locations: [from.location, to.location],
        })
      }
    }
  }
  return { relations: [...relations.values()], warnings: [] }
}
