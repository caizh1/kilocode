import { createHash } from "node:crypto"
import { generateText, Output } from "ai"
import { Effect } from "effect"
import { mergeDeep } from "remeda"
import { z } from "zod"
import { Token } from "@/util/token"
import { AppRuntime } from "@/effect/app-runtime"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { PatentRadar } from "./types"
import { semanticObservationRelations } from "./semantic"

const CandidateItem = z.object({
  title: z.string(),
  technicalProblem: z.string(),
  implementation: z.string(),
  technicalEffect: z.string(),
  features: z.array(
    z.object({
      text: z.string(),
      necessary: z.boolean(),
      evidenceIds: z.array(z.string()),
    }),
  ),
  keywords: z.array(z.string()),
  ipcHints: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  relationIds: z.array(z.string()).optional(),
  abstractMechanism: z.string().optional(),
  effectEvidenceLevel: PatentRadar.EffectEvidenceLevel.optional(),
  engineeringEvaluation: z.unknown().optional(),
})

const CandidateOutput = z.object({
  candidates: z.array(z.unknown()),
})

class CandidateOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CandidateOutputError"
  }
}

const MechanismItem = z.object({
  abstractMechanism: z.string(),
  implementation: z.string(),
  technicalProblem: z.string(),
  input: z.array(z.string()),
  processing: z.array(z.string()),
  output: z.array(z.string()),
  stateChanges: z.array(z.string()),
  constraints: z.array(z.string()),
  technicalEffect: z.string(),
  effectEvidenceLevel: PatentRadar.EffectEvidenceLevel,
  evidenceIds: z.array(z.string()),
  bridgeHooks: z.array(z.string()),
})

const AtomOutput = z.object({
  mechanisms: z.array(z.unknown()),
})

class MechanismOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MechanismOutputError"
  }
}
const VerificationOutput = z.object({
  candidateId: z.string(),
  status: z.enum(["verified", "downgraded", "rejected"]),
  unsupportedEvidenceIds: z.array(z.string()),
  unsupportedRelationIds: z.array(z.string()),
  effectSupported: z.boolean(),
  variantCompatible: z.boolean(),
  conventionalOnly: z.boolean(),
  reason: z.string(),
})

const MatrixOutput = z.object({
  cells: z.array(
    z.object({
      featureId: z.string(),
      publicationNumber: z.string(),
      covered: z.boolean(),
      locator: z.string().nullable(),
      quote: z.string().nullable(),
      rationale: z.string(),
    }),
  ),
})

export const PATENT_RADAR_LONG_RUNNING_HEADER = "x-chipmate-long-running-task"
export const ANALYSIS_TIMEOUT_MS: undefined = undefined

export interface CandidateExtractionOptions {
  abort?: AbortSignal
  completed?: Record<string, PatentRadar.Candidate[]>
  onBatch?: (event: {
    hash: string
    index: number
    total: number
    status: "started" | "completed"
    candidates?: PatentRadar.Candidate[]
  }) => void | Promise<void>
}

export interface DiscoveryResult {
  mechanisms: PatentRadar.MechanismAtom[]
  candidates: PatentRadar.Candidate[]
  bridgeCandidateIds: string[]
  relations: PatentRadar.EvidenceRelation[]
  warnings: string[]
}

export async function extractCandidates(
  evidence: PatentRadar.SourceEvidence[],
  analysisModel: PatentRadar.AnalysisModel | null,
  options: CandidateExtractionOptions | AbortSignal = {},
) {
  const config = options instanceof AbortSignal ? { abort: options } : options
  const budget = await modelInputBudget(analysisModel)
  const batches = packEvidence(evidence, budget).map((evidence) => ({ evidence, hash: batchHash(evidence) }))
  const rows = await parallel(batches, 2, async (batch, index) => {
    const saved = config.completed?.[batch.hash]
    if (saved) return { candidates: saved, warnings: [] }
    await config.onBatch?.({ hash: batch.hash, index: index + 1, total: batches.length, status: "started" })
    const system = [
      "你是嵌入式系统技术创新候选提取器。只依据给定证据，不补充不存在的实现。",
      "找出由至少两个必要技术特征组成、能够说明技术问题、实现手段和技术效果的候选。普通业务需求、变量重命名、单一常规调用不得成为候选。",
      "每个字段必须用中文；evidenceIds 必须原样引用输入 ID。effectEvidenceLevel 只能是 measured、implemented、documented、inferred、proposed。engineeringEvaluation 的八项分数为 0-5，并逐项给出中文理由；分数只用于排序。没有可靠候选时返回空数组。",
      `只输出 JSON：{"candidates":[{"title":"","technicalProblem":"","implementation":"","technicalEffect":"","effectEvidenceLevel":"implemented","features":[{"text":"","necessary":true,"evidenceIds":[""]}],"keywords":[""],"ipcHints":[""],"evidenceIds":[""],"engineeringEvaluation":${evaluationExample()}}]}。`,
    ].join("\n")
    const result = await candidateBatch(system, batch.evidence, analysisModel, config.abort)
    const items = result.candidates
    const allowed = new Set(batch.evidence.map((item) => item.id))
    const output: PatentRadar.Candidate[] = []
    for (const item of items) {
      const features = item.features.flatMap((feature, index) => {
        const ids = feature.evidenceIds.filter((id) => allowed.has(id))
        if (!ids.length || feature.text.trim().length < 4) return []
        return [{ ...feature, id: `F${index + 1}`, evidenceIds: ids }]
      })
      if (features.filter((feature) => feature.necessary).length < 2) continue
      const refs = [
        ...new Set([
          ...item.evidenceIds.filter((id) => allowed.has(id)),
          ...features.flatMap((feature) => feature.evidenceIds),
        ]),
      ]
      const files = [
        ...new Set(refs.flatMap((id) => batch.evidence.find((evidence) => evidence.id === id)?.location.file ?? [])),
      ]
      const valid = PatentRadar.Candidate.safeParse({
        ...item,
        id: createHash("sha256")
          .update(`${item.title}:${refs.join(",")}`)
          .digest("hex")
          .slice(0, 16),
        features,
        evidenceIds: refs,
        keywords: item.keywords
          .map((word) => word.trim())
          .filter(Boolean)
          .slice(0, 12),
        ipcHints: item.ipcHints
          .map((word) => word.trim())
          .filter(Boolean)
          .slice(0, 8),
        extractionWarnings: [],
        discoveryTier: "observation",
        origin: files.length > 1 ? "cross-file" : "local",
        mechanismIds: [],
        relationIds: [],
        coreSourceFiles: files.slice(0, 5),
        supportingSourceFiles: files.slice(5),
        abstractMechanism: item.abstractMechanism ?? item.implementation,
        effectEvidenceLevel: item.effectEvidenceLevel ?? "inferred",
        groundingStatus: "pending",
        engineeringEvaluation: item.engineeringEvaluation ?? null,
      })
      if (valid.success) output.push(valid.data)
    }
    await config.onBatch?.({
      hash: batch.hash,
      index: index + 1,
      total: batches.length,
      status: "completed",
      candidates: output,
    })
    return { candidates: output, warnings: result.warnings }
  })
  return {
    candidates: deduplicate(rows.flatMap((row) => row.candidates)),
    warnings: [...new Set(rows.flatMap((row) => row.warnings))],
  }
}

export async function discoverAcrossWorkspace(
  evidence: PatentRadar.SourceEvidence[],
  relations: PatentRadar.EvidenceRelation[],
  analysisModel: PatentRadar.AnalysisModel | null,
  abort?: AbortSignal,
  completedMechanisms: PatentRadar.MechanismAtom[] = [],
  onMechanismBatch?: (
    mechanisms: PatentRadar.MechanismAtom[],
    completedEvidence: number,
    totalEvidence: number,
  ) => void | Promise<void>,
  completedBridges: Record<string, PatentRadar.Candidate[]> = {},
  onBridgeBatch?: (hash: string, candidates: PatentRadar.Candidate[]) => void | Promise<void>,
): Promise<DiscoveryResult> {
  const currentEvidence = new Set(evidence.map((item) => item.id))
  const reused = completedMechanisms.filter((atom) => atom.evidenceIds.every((id) => currentEvidence.has(id)))
  const covered = new Set(reused.flatMap((atom) => atom.evidenceIds))
  const distilled = await distillMechanisms(
    evidence.filter((item) => !covered.has(item.id)),
    analysisModel,
    abort,
    (items, completedEvidence, totalEvidence) =>
      onMechanismBatch?.([...reused, ...items], completedEvidence, totalEvidence),
  )
  const mechanisms = [...reused, ...distilled.mechanisms]
  const semantic = await semanticObservationRelations(mechanisms, evidence)
  const allRelations = [...relations, ...semantic.relations]
  const units = bridgeUnits(
    mechanisms,
    allRelations,
    Math.min(8_000, Math.floor((await modelInputBudget(analysisModel)) / 2)),
  )
  const candidates: PatentRadar.Candidate[] = []
  const outputWarnings: string[] = [...distilled.warnings]
  for (const unit of units) {
    abort?.throwIfAborted()
    const ids = new Set(unit.flatMap((atom) => atom.evidenceIds))
    const edges = relations.filter(
      (relation) =>
        relation.strength === "strong" && ids.has(relation.fromEvidenceId) && ids.has(relation.toEvidenceId),
    )
    if (!edges.length) continue
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          mechanisms: unit.map((item) => item.id).sort(),
          relations: edges.map((item) => item.relationId).sort(),
        }),
      )
      .digest("hex")
    if (completedBridges[hash]) {
      candidates.push(...completedBridges[hash])
      continue
    }
    const source = evidence.filter((item) => ids.has(item.id))
    let value: string
    try {
      value = await completion(
        [
          "你是嵌入式系统跨文件技术机制合成器。只能使用输入机制、强关系和原文证据，不能用语义相似替代工程连接。",
          "提炼 A→B→C 的问题、实现和效果。每个必要特征必须引用 evidenceIds，跨文件连接必须引用 relationIds。proposed 效果不得成为必要特征。",
          "普通库调用、教材式结构或纯配置只返回空数组。",
          `只输出 JSON：{"candidates":[{"title":"","technicalProblem":"","implementation":"","technicalEffect":"","features":[{"text":"","necessary":true,"evidenceIds":[""]}],"keywords":[""],"ipcHints":[],"evidenceIds":[""],"relationIds":[""],"abstractMechanism":"","effectEvidenceLevel":"implemented","engineeringEvaluation":${evaluationExample()}}]}。`,
        ].join("\n"),
        JSON.stringify({ mechanisms: unit, relations: edges, evidence: source }),
        analysisModel,
        abort,
        8_000,
      )
    } catch (error) {
      if (!isNoOutputError(error)) throw error
      outputWarnings.push(
        `已跳过一个无模型输出的跨文件合成单元：${error instanceof Error ? error.message : String(error)}`,
      )
      await onBridgeBatch?.(hash, [])
      continue
    }
    let parsed: ReturnType<typeof parseCandidateOutput>
    try {
      parsed = parseCandidateOutput(json(value), "跨文件合成")
    } catch (error) {
      if (!(error instanceof CandidateOutputError)) throw error
      outputWarnings.push(`已跳过一个无法解析的跨文件合成单元：${error.message}`)
      await onBridgeBatch?.(hash, [])
      continue
    }
    outputWarnings.push(...parsed.warnings)
    const batch = normalizeCandidates(parsed.candidates, source, edges, unit)
    candidates.push(...batch)
    await onBridgeBatch?.(hash, batch)
  }
  let frontier = deduplicate(candidates)
  let previousSignature = ""
  for (;;) {
    const groups = higherBridgeUnits(
      frontier,
      relations,
      Math.min(8_000, Math.floor((await modelInputBudget(analysisModel)) / 2)),
    )
    if (!groups.length) break
    const signature = groups
      .map((group) =>
        group
          .map((item) => item.id)
          .sort()
          .join(":"),
      )
      .sort()
      .join("|")
    if (signature === previousSignature) break
    previousSignature = signature
    const next: PatentRadar.Candidate[] = []
    for (const group of groups) {
      abort?.throwIfAborted()
      const ids = new Set(group.flatMap((item) => item.evidenceIds))
      const edges = relations.filter(
        (relation) =>
          relation.strength === "strong" && ids.has(relation.fromEvidenceId) && ids.has(relation.toEvidenceId),
      )
      if (!edges.length) continue
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            level: "hierarchical",
            candidates: group.map((item) => item.id).sort(),
            relations: edges.map((item) => item.relationId).sort(),
          }),
        )
        .digest("hex")
      if (completedBridges[hash]) {
        next.push(...completedBridges[hash])
        continue
      }
      const source = evidence.filter((item) => ids.has(item.id))
      let value: string
      try {
        value = await completion(
          [
            "你是嵌入式系统模块到子系统的层级机制合成器。输入是已经通过局部强关系门禁的候选；只允许沿原始 exact 强关系继续归并。",
            "保留完整 A→B→C 必要特征、evidenceIds 和 relationIds。若输入只是并列功能而非因果协同，返回空数组。",
            `只输出 JSON：{"candidates":[{"title":"","technicalProblem":"","implementation":"","technicalEffect":"","features":[{"text":"","necessary":true,"evidenceIds":[""]}],"keywords":[""],"ipcHints":[],"evidenceIds":[""],"relationIds":[""],"abstractMechanism":"","effectEvidenceLevel":"implemented","engineeringEvaluation":${evaluationExample()}}]}。`,
          ].join("\n"),
          JSON.stringify({ candidates: group, relations: edges, evidence: source }),
          analysisModel,
          abort,
          8_000,
        )
      } catch (error) {
        if (!isNoOutputError(error)) throw error
        outputWarnings.push(
          `已跳过一个无模型输出的层级机制合成单元：${error instanceof Error ? error.message : String(error)}`,
        )
        await onBridgeBatch?.(hash, [])
        continue
      }
      let parsed: ReturnType<typeof parseCandidateOutput>
      try {
        parsed = parseCandidateOutput(json(value), "层级机制合成")
      } catch (error) {
        if (!(error instanceof CandidateOutputError)) throw error
        outputWarnings.push(`已跳过一个无法解析的层级机制合成单元：${error.message}`)
        await onBridgeBatch?.(hash, [])
        continue
      }
      outputWarnings.push(...parsed.warnings)
      const atoms = mechanisms.filter((atom) => atom.evidenceIds.some((id) => ids.has(id)))
      const batch = normalizeCandidates(parsed.candidates, source, edges, atoms)
      next.push(...batch)
      await onBridgeBatch?.(hash, batch)
    }
    const normalized = deduplicate(next)
    if (!normalized.length || normalized.every((item) => frontier.some((current) => current.id === item.id))) break
    candidates.push(...normalized)
    frontier = normalized
  }
  candidates.push(...semanticCandidates(mechanisms, semantic.relations, evidence))
  const grounded = candidates.map((candidate) => groundCandidate(candidate, evidence, allRelations))
  return {
    mechanisms,
    candidates: deduplicate(grounded.filter((item) => item.groundingStatus !== "rejected")),
    bridgeCandidateIds: grounded.map((item) => item.id),
    relations: allRelations,
    warnings: [...semantic.warnings, ...new Set(outputWarnings)],
  }
}

function higherBridgeUnits(
  candidates: PatentRadar.Candidate[],
  relations: PatentRadar.EvidenceRelation[],
  budget: number,
) {
  if (candidates.length < 2) return []
  const byEvidence = new Map<string, PatentRadar.Candidate[]>()
  for (const candidate of candidates)
    for (const id of candidate.evidenceIds) byEvidence.set(id, [...(byEvidence.get(id) ?? []), candidate])
  const adjacency = new Map<string, Set<string>>()
  for (const relation of relations) {
    if (relation.strength !== "strong" || relation.resolution !== "exact") continue
    for (const left of byEvidence.get(relation.fromEvidenceId) ?? [])
      for (const right of byEvidence.get(relation.toEvidenceId) ?? []) {
        if (left.id === right.id) continue
        ;(adjacency.get(left.id) ?? adjacency.set(left.id, new Set()).get(left.id)!).add(right.id)
        ;(adjacency.get(right.id) ?? adjacency.set(right.id, new Set()).get(right.id)!).add(left.id)
      }
  }
  const byId = new Map(candidates.map((item) => [item.id, item]))
  const visited = new Set<string>()
  const output: PatentRadar.Candidate[][] = []
  for (const id of adjacency.keys()) {
    if (visited.has(id)) continue
    const queue = [id]
    const component: PatentRadar.Candidate[] = []
    while (queue.length) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      const candidate = byId.get(current)
      if (candidate) component.push(candidate)
      for (const linked of adjacency.get(current) ?? []) queue.push(linked)
    }
    if (component.length < 2) continue
    if (Token.estimate(JSON.stringify(component)) <= budget) {
      output.push(component)
      continue
    }
    const seen = new Set<string>()
    for (const hub of component) {
      let unit = [hub]
      let tokens = Token.estimate(JSON.stringify(hub))
      for (const id of adjacency.get(hub.id) ?? []) {
        const neighbor = byId.get(id)
        if (!neighbor) continue
        const size = Token.estimate(JSON.stringify(neighbor)) + 128
        if (unit.length > 1 && tokens + size > budget) append()
        unit.push(neighbor)
        tokens += size
      }
      append()

      function append() {
        if (unit.length < 2) return
        const key = unit
          .map((item) => item.id)
          .sort()
          .join(":")
        if (!seen.has(key)) {
          seen.add(key)
          output.push(unit)
        }
        unit = [hub]
        tokens = Token.estimate(JSON.stringify(hub))
      }
    }
  }
  return output
}

function semanticCandidates(
  mechanisms: PatentRadar.MechanismAtom[],
  relations: PatentRadar.EvidenceRelation[],
  evidence: PatentRadar.SourceEvidence[],
) {
  const byEvidence = new Map<string, PatentRadar.MechanismAtom[]>()
  const source = new Map(evidence.map((item) => [item.id, item]))
  for (const atom of mechanisms)
    for (const id of atom.evidenceIds) byEvidence.set(id, [...(byEvidence.get(id) ?? []), atom])
  return relations.flatMap((relation) => {
    const left = byEvidence.get(relation.fromEvidenceId)?.[0]
    const right = byEvidence.get(relation.toEvidenceId)?.[0]
    if (!left || !right) return []
    const evidenceIds = [...new Set([...left.evidenceIds, ...right.evidenceIds])]
    const files = [...new Set(evidenceIds.flatMap((id) => source.get(id)?.location.file ?? []))]
    const candidate = PatentRadar.Candidate.safeParse({
      id: createHash("sha256").update(`semantic:${left.id}:${right.id}`).digest("hex").slice(0, 16),
      title: `${left.abstractMechanism}与${right.abstractMechanism}的潜在协同`,
      technicalProblem: `${left.technicalProblem}；${right.technicalProblem}`,
      implementation: `本地向量索引发现两个机制可能互补，但尚未找到确定性源码或文档关系。`,
      technicalEffect: `${left.technicalEffect}；${right.technicalEffect}`,
      features: [left, right].map((atom, index) => ({
        id: `F${index + 1}`,
        text: atom.abstractMechanism,
        necessary: true,
        evidenceIds: atom.evidenceIds,
        relationIds: [relation.relationId],
      })),
      keywords: [
        ...new Set([...left.bridgeHooks, ...right.bridgeHooks, ...files.map((file) => file.split("/").at(-1) ?? file)]),
      ]
        .filter(Boolean)
        .slice(0, 12),
      ipcHints: [],
      evidenceIds,
      extractionWarnings: ["语义相似只进入观察通道，不能据此晋升技术候选。"],
      discoveryTier: "observation",
      origin: "cross-file",
      mechanismIds: [left.id, right.id],
      relationIds: [relation.relationId],
      coreSourceFiles: files.slice(0, 5),
      supportingSourceFiles: files.slice(5),
      abstractMechanism: `${left.abstractMechanism} + ${right.abstractMechanism}`,
      effectEvidenceLevel: "inferred",
      groundingStatus: "downgraded",
      engineeringEvaluation: null,
    })
    return candidate.success ? [candidate.data] : []
  })
}

export function groundCandidates(
  candidates: PatentRadar.Candidate[],
  evidence: PatentRadar.SourceEvidence[],
  relations: PatentRadar.EvidenceRelation[],
) {
  return candidates.map((candidate) => groundCandidate(candidate, evidence, relations))
}

export async function verifyCandidates(
  candidates: PatentRadar.Candidate[],
  evidence: PatentRadar.SourceEvidence[],
  relations: PatentRadar.EvidenceRelation[],
  analysisModel: PatentRadar.AnalysisModel | null,
  abort?: AbortSignal,
  completed: Record<string, PatentRadar.Candidate> = {},
  onCandidate?: (candidate: PatentRadar.Candidate) => void | Promise<void>,
) {
  const source = new Map(evidence.map((item) => [item.id, item]))
  const edges = new Map(relations.map((item) => [item.relationId, item]))
  const output: PatentRadar.Candidate[] = []
  for (const candidate of groundCandidates(candidates, evidence, relations)) {
    abort?.throwIfAborted()
    if (completed[candidate.id]) {
      output.push(completed[candidate.id]!)
      continue
    }
    if (candidate.groundingStatus === "rejected") continue
    let value = ""
    try {
      value = await completion(
        [
          "你是独立原文复核器，不参与候选生成。逐项检查 evidenceId、必要特征、跨文件关系、技术效果和编译 Variant。",
          "注释中的目标、愿望、proposed 效果、常规库调用、教材式结构或无法同 Variant 成立的组合不得通过。",
          '只输出 JSON：{"candidateId":"","status":"verified","unsupportedEvidenceIds":[],"unsupportedRelationIds":[],"effectSupported":true,"variantCompatible":true,"conventionalOnly":false,"reason":""}。',
        ].join("\n"),
        JSON.stringify({
          candidate,
          evidence: candidate.evidenceIds.flatMap((id) => source.get(id) ?? []),
          relations: candidate.relationIds.flatMap((id) => edges.get(id) ?? []),
        }),
        analysisModel,
        abort,
        4_000,
      )
    } catch (error) {
      if (!isNoOutputError(error)) throw error
    }
    const parsed = VerificationOutput.safeParse(json(value))
    if (!parsed.success || parsed.data.candidateId !== candidate.id) {
      const downgraded: PatentRadar.Candidate = {
        ...candidate,
        discoveryTier: "observation",
        groundingStatus: "downgraded",
        extractionWarnings: [...candidate.extractionWarnings, "独立原文复核响应不合规，已按失败关闭并降级为观察项。"],
      }
      output.push(downgraded)
      await onCandidate?.(downgraded)
      continue
    }
    const failed =
      parsed.data.status !== "verified" ||
      !parsed.data.effectSupported ||
      !parsed.data.variantCompatible ||
      parsed.data.conventionalOnly ||
      parsed.data.unsupportedEvidenceIds.length > 0 ||
      parsed.data.unsupportedRelationIds.length > 0
    const verified: PatentRadar.Candidate = {
      ...candidate,
      discoveryTier: failed ? "observation" : candidate.discoveryTier,
      groundingStatus: failed ? (parsed.data.status === "rejected" ? "rejected" : "downgraded") : "verified",
      extractionWarnings: failed
        ? [...candidate.extractionWarnings, `独立原文复核未通过：${parsed.data.reason.slice(0, 500)}`]
        : candidate.extractionWarnings,
    }
    output.push(verified)
    await onCandidate?.(verified)
  }
  return output.filter((item) => item.groundingStatus !== "rejected")
}

async function distillMechanisms(
  evidence: PatentRadar.SourceEvidence[],
  analysisModel: PatentRadar.AnalysisModel | null,
  abort?: AbortSignal,
  onBatch?: (
    mechanisms: PatentRadar.MechanismAtom[],
    completedEvidence: number,
    totalEvidence: number,
  ) => void | Promise<void>,
) {
  const output: PatentRadar.MechanismAtom[] = []
  const warnings: string[] = []
  const budget = await modelInputBudget(analysisModel)
  const batches = packEvidence(evidence, Math.min(budget, 16_000))
  let completedEvidence = 0
  for (const batch of batches) {
    const system = [
      "你是嵌入式工程机制提炼器。逐项把实现细节归纳为问题—机制—效果卡，只能引用输入 evidenceId。",
      "effectEvidenceLevel 必须是 measured、implemented、documented、inferred、proposed；目标或愿望只能标 proposed。",
      '只输出 JSON：{"mechanisms":[{"abstractMechanism":"","implementation":"","technicalProblem":"","input":[],"processing":[],"output":[],"stateChanges":[],"constraints":[],"technicalEffect":"","effectEvidenceLevel":"implemented","evidenceIds":[""],"bridgeHooks":[]}]}。',
    ].join("\n")
    const result = await mechanismBatch(system, batch, analysisModel, abort)
    warnings.push(...result.warnings)
    const allowed = new Map(batch.map((item) => [item.id, item]))
    for (const item of result.mechanisms) {
      const evidenceIds = [...new Set(item.evidenceIds.filter((id) => allowed.has(id)))]
      if (!evidenceIds.length || item.abstractMechanism.trim().length < 4) continue
      const sourceFiles = [...new Set(evidenceIds.map((id) => allowed.get(id)!.location.file))]
      const valid = PatentRadar.MechanismAtom.safeParse({
        ...item,
        id: createHash("sha256")
          .update(`${item.abstractMechanism}:${evidenceIds.join(",")}`)
          .digest("hex")
          .slice(0, 16),
        evidenceIds,
        sourceFiles,
      })
      if (valid.success) output.push(valid.data)
    }
    completedEvidence += batch.length
    await onBatch?.([...output], completedEvidence, evidence.length)
  }
  return { mechanisms: output, warnings }
}

async function candidateBatch(
  system: string,
  evidence: PatentRadar.SourceEvidence[],
  model: PatentRadar.AnalysisModel | null,
  abort?: AbortSignal,
): Promise<{ candidates: z.infer<typeof CandidateItem>[]; warnings: string[] }> {
  try {
    const value = await completion(system, JSON.stringify(evidence), model, abort, 4_000)
    return parseCandidateOutput(json(value), "候选批次")
  } catch (error) {
    const recoverable = error instanceof CandidateOutputError || isContextLengthError(error) || isNoOutputError(error)
    if (!recoverable) throw error
    if (evidence.length === 1) {
      const children = splitEvidence(evidence[0]!)
      if (children.length < 2) {
        if (error instanceof CandidateOutputError || isNoOutputError(error)) {
          return {
            candidates: [],
            warnings: [
              `单条证据 ${evidence[0]!.id} 的模型响应无法解析，已隔离并跳过：${error instanceof Error ? error.message : String(error)}`,
            ],
          }
        }
        throw error
      }
      const rows = await candidateBatch(system, children, model, abort)
      const ids = new Set(children.map((item) => item.id))
      return {
        candidates: rows.candidates.map((item) => ({
          ...item,
          evidenceIds: item.evidenceIds.map((id) => (ids.has(id) ? evidence[0]!.id : id)),
          features: item.features.map((feature) => ({
            ...feature,
            evidenceIds: feature.evidenceIds.map((id) => (ids.has(id) ? evidence[0]!.id : id)),
          })),
        })),
        warnings: rows.warnings,
      }
    }
    const middle = Math.ceil(evidence.length / 2)
    const left = await candidateBatch(system, evidence.slice(0, middle), model, abort)
    const right = await candidateBatch(system, evidence.slice(middle), model, abort)
    return { candidates: [...left.candidates, ...right.candidates], warnings: [...left.warnings, ...right.warnings] }
  }
}

async function mechanismBatch(
  system: string,
  evidence: PatentRadar.SourceEvidence[],
  model: PatentRadar.AnalysisModel | null,
  abort?: AbortSignal,
): Promise<{ mechanisms: z.infer<typeof MechanismItem>[]; warnings: string[] }> {
  try {
    const value = await completion(system, JSON.stringify(evidence), model, abort, 4_000)
    return parseMechanismOutput(json(value))
  } catch (error) {
    const recoverable = error instanceof MechanismOutputError || isContextLengthError(error) || isNoOutputError(error)
    if (!recoverable) throw error
    if (evidence.length === 1) {
      const children = splitEvidence(evidence[0]!)
      if (children.length < 2) {
        if (error instanceof MechanismOutputError || isNoOutputError(error)) {
          return {
            mechanisms: [],
            warnings: [
              `单条证据 ${evidence[0]!.id} 的机制响应无法解析，已隔离并跳过：${error instanceof Error ? error.message : String(error)}`,
            ],
          }
        }
        throw error
      }
      const rows = await mechanismBatch(system, children, model, abort)
      const ids = new Set(children.map((item) => item.id))
      return {
        mechanisms: rows.mechanisms.map((item) => ({
          ...item,
          evidenceIds: item.evidenceIds.map((id) => (ids.has(id) ? evidence[0]!.id : id)),
        })),
        warnings: rows.warnings,
      }
    }
    const middle = Math.ceil(evidence.length / 2)
    const left = await mechanismBatch(system, evidence.slice(0, middle), model, abort)
    const right = await mechanismBatch(system, evidence.slice(middle), model, abort)
    return {
      mechanisms: [...left.mechanisms, ...right.mechanisms],
      warnings: [...left.warnings, ...right.warnings],
    }
  }
}

function splitEvidence(item: PatentRadar.SourceEvidence) {
  const lines = item.excerpt.split("\n")
  if (lines.length < 4 && item.excerpt.length < 800) return [item]
  const middle = lines.length >= 4 ? Math.ceil(lines.length / 2) : undefined
  const parts = middle
    ? [lines.slice(0, middle).join("\n"), lines.slice(middle).join("\n")]
    : [
        item.excerpt.slice(0, Math.ceil(item.excerpt.length / 2)),
        item.excerpt.slice(Math.ceil(item.excerpt.length / 2)),
      ]
  return parts.map((excerpt, index) => ({
    ...item,
    id: createHash("sha256").update(`${item.id}:part:${index}`).digest("hex").slice(0, 16),
    parentId: item.id,
    excerpt,
    location: {
      ...item.location,
      lineStart:
        index === 0
          ? item.location.lineStart
          : Math.min(item.location.lineEnd, item.location.lineStart + (middle ?? 0)),
      lineEnd:
        index === 0 && middle
          ? Math.min(item.location.lineEnd, item.location.lineStart + middle - 1)
          : item.location.lineEnd,
    },
  }))
}

export async function compareFeatures(
  candidate: PatentRadar.Candidate,
  hits: PatentRadar.PatentHit[],
  analysisModel: PatentRadar.AnalysisModel | null,
  abort?: AbortSignal,
) {
  if (!hits.length) return []
  const batches = chunk(hits.slice(0, 50), 4)
  const rows = await parallel(batches, 2, async (batch) => {
    const compact = batch.map((hit) => ({
      publicationNumber: hit.publicationNumber,
      passages: hit.passages.slice(0, 8),
    }))
    const value = await completion(
      [
        "你是专利证据逐项比对器。只能依据提供的专利段落判断技术特征是否被明确公开，不得用常识补齐。",
        "covered=true 时必须给出输入中真实存在的 locator，并提供不超过 100 个汉字的原文摘录。含糊、推断或只有技术效果相似时一律 false。",
        '对每个 featureId 与每个 publicationNumber 都输出一个单元格。只输出 JSON：{"cells":[{"featureId":"F1","publicationNumber":"","covered":false,"locator":null,"quote":null,"rationale":""}]}。',
      ].join("\n"),
      JSON.stringify({ features: candidate.features, patents: compact }),
      analysisModel,
      abort,
      4_000,
    )
    const parsed = MatrixOutput.safeParse(json(value))
    return parsed.success ? validateCells(candidate, batch, parsed.data.cells) : []
  })
  return rows.flat()
}

async function completion(
  system: string,
  prompt: string,
  analysisModel: PatentRadar.AnalysisModel | null,
  abort?: AbortSignal,
  requestedOutput = 4_000,
) {
  const resolved = await resolveModel(analysisModel)
  assertModelEndpoint(resolved.endpoint)
  const result = await generateText({
    model: resolved.language,
    output: Output.json(),
    temperature: resolved.model.capabilities.temperature ? 0.1 : undefined,
    providerOptions: ProviderTransform.providerOptions(
      resolved.model,
      mergeDeep(ProviderTransform.smallOptions(resolved.model), resolved.model.options),
    ),
    maxRetries: 0,
    maxOutputTokens: Math.min(requestedOutput, resolved.model.limit.output || requestedOutput),
    abortSignal: abort,
    headers: { [PATENT_RADAR_LONG_RUNNING_HEADER]: "patent-radar" },
    system,
    messages: [{ role: "user", content: prompt }],
  })
  return JSON.stringify(result.output)
}

async function resolveModel(analysisModel: PatentRadar.AnalysisModel | null) {
  return AppRuntime.runPromise(
    Provider.Service.use((service) =>
      Effect.gen(function* () {
        const ref = analysisModel
          ? {
              providerID: ProviderV2.ID.make(analysisModel.providerID),
              modelID: ModelV2.ID.make(analysisModel.modelID),
            }
          : yield* service.defaultModel()
        const model = analysisModel
          ? yield* service.getModel(ref.providerID, ref.modelID)
          : ((yield* service.getSmallModel(ref.providerID)) ?? (yield* service.getModel(ref.providerID, ref.modelID)))
        const provider = yield* service.getProvider(model.providerID)
        const endpoint = provider.options.baseURL ?? provider.options.endpoint ?? model.api.url
        return { model, endpoint, language: yield* service.getLanguage(model) }
      }),
    ),
  )
}

async function modelInputBudget(analysisModel: PatentRadar.AnalysisModel | null) {
  const resolved = await resolveModel(analysisModel)
  const context = resolved.model.limit.input || resolved.model.limit.context || 32_000
  return Math.max(1_024, Math.floor(Math.min(context, 64_000) * 0.7) - 1_500)
}

function normalizeCandidates(
  items: z.infer<typeof CandidateItem>[],
  evidence: PatentRadar.SourceEvidence[],
  relations: PatentRadar.EvidenceRelation[],
  mechanisms: PatentRadar.MechanismAtom[],
) {
  const allowedEvidence = new Map(evidence.map((item) => [item.id, item]))
  const allowedRelations = new Set(relations.map((item) => item.relationId))
  return items.flatMap((item) => {
    const evaluation = normalizeEngineeringEvaluation(item.engineeringEvaluation)
    const features = item.features.flatMap((feature, index) => {
      const evidenceIds = [...new Set(feature.evidenceIds.filter((id) => allowedEvidence.has(id)))]
      if (!evidenceIds.length || feature.text.trim().length < 4) return []
      return [
        {
          ...feature,
          id: `F${index + 1}`,
          evidenceIds,
          relationIds: (item.relationIds ?? []).filter((id) => allowedRelations.has(id)),
        },
      ]
    })
    if (features.filter((feature) => feature.necessary).length < 2) return []
    const evidenceIds = [
      ...new Set([
        ...item.evidenceIds.filter((id) => allowedEvidence.has(id)),
        ...features.flatMap((feature) => feature.evidenceIds),
      ]),
    ]
    const files = [...new Set(evidenceIds.map((id) => allowedEvidence.get(id)!.location.file))]
    const relationIds = [...new Set((item.relationIds ?? []).filter((id) => allowedRelations.has(id)))]
    const valid = PatentRadar.Candidate.safeParse({
      ...item,
      id: createHash("sha256")
        .update(`${item.title}:${evidenceIds.join(",")}`)
        .digest("hex")
        .slice(0, 16),
      features,
      evidenceIds,
      keywords: item.keywords
        .map((word) => word.trim())
        .filter(Boolean)
        .slice(0, 12),
      ipcHints: item.ipcHints
        .map((word) => word.trim())
        .filter(Boolean)
        .slice(0, 8),
      extractionWarnings: evaluation.warning ? [evaluation.warning] : [],
      discoveryTier: "observation",
      origin: files.length > 1 ? "cross-file" : "local",
      mechanismIds: mechanisms
        .filter((atom) => atom.evidenceIds.some((id) => evidenceIds.includes(id)))
        .map((atom) => atom.id),
      relationIds,
      coreSourceFiles: files.slice(0, 5),
      supportingSourceFiles: files.slice(5),
      abstractMechanism: item.abstractMechanism ?? item.implementation,
      effectEvidenceLevel: item.effectEvidenceLevel ?? "inferred",
      groundingStatus: "pending",
      engineeringEvaluation: evaluation.value,
    })
    return valid.success ? [valid.data] : []
  })
}

export function parseCandidateOutput(
  value: unknown,
  phase: string,
): { candidates: z.infer<typeof CandidateItem>[]; warnings: string[] } {
  const output = CandidateOutput.safeParse(value)
  if (!output.success) {
    const issue = output.error.issues[0]
    const location = issue?.path.length ? `（${issue.path.join(".")}）` : ""
    throw new CandidateOutputError(`${phase}返回不合规 JSON${location}：${issue?.message ?? "结构不匹配"}`)
  }
  const warnings: string[] = []
  const candidates = output.data.candidates.flatMap((item, index) => {
    const parsed = CandidateItem.safeParse(item)
    if (parsed.success) return [parsed.data]
    const issue = parsed.error.issues[0]
    const location = issue?.path.length ? `.${issue.path.join(".")}` : ""
    warnings.push(
      `${phase}已忽略第 ${index + 1} 个不合规候选（candidates.${index}${location}）：${issue?.message ?? "结构不匹配"}`,
    )
    return []
  })
  return { candidates, warnings }
}

export function parseMechanismOutput(value: unknown): {
  mechanisms: z.infer<typeof MechanismItem>[]
  warnings: string[]
} {
  const output = AtomOutput.safeParse(value)
  if (!output.success) {
    const issue = output.error.issues[0]
    const location = issue?.path.length ? `（${issue.path.join(".")}）` : ""
    throw new MechanismOutputError(`机制提炼返回不合规 JSON${location}：${issue?.message ?? "结构不匹配"}`)
  }
  const warnings: string[] = []
  const mechanisms = output.data.mechanisms.flatMap((item, index) => {
    const parsed = MechanismItem.safeParse(item)
    if (parsed.success) return [parsed.data]
    const issue = parsed.error.issues[0]
    const location = issue?.path.length ? `.${issue.path.join(".")}` : ""
    warnings.push(
      `机制提炼已忽略第 ${index + 1} 个不合规机制（mechanisms.${index}${location}）：${issue?.message ?? "结构不匹配"}`,
    )
    return []
  })
  return { mechanisms, warnings }
}

export function normalizeEngineeringEvaluation(value: unknown): {
  value: z.infer<typeof PatentRadar.EngineeringEvaluation> | null
  warning?: string
} {
  if (value === undefined || value === null) return { value: null }
  const parsed = PatentRadar.EngineeringEvaluation.safeParse(value)
  if (parsed.success) return { value: parsed.data }
  return {
    value: null,
    warning: "模型返回的工程评估不符合 0-5 分约束，已忽略该辅助评分；技术证据仍按原门禁复核。",
  }
}

function groundCandidate(
  candidate: PatentRadar.Candidate,
  evidence: PatentRadar.SourceEvidence[],
  relations: PatentRadar.EvidenceRelation[],
): PatentRadar.Candidate {
  const evidenceIds = new Set(evidence.map((item) => item.id))
  const relationMap = new Map(relations.map((item) => [item.relationId, item]))
  if (candidate.evidenceIds.some((id) => !evidenceIds.has(id)))
    return {
      ...candidate,
      discoveryTier: "observation",
      groundingStatus: "rejected",
      extractionWarnings: [...candidate.extractionWarnings, "候选引用了不存在的原文证据。"],
    }
  const strong = candidate.relationIds
    .map((id) => relationMap.get(id))
    .filter((item): item is PatentRadar.EvidenceRelation => item?.strength === "strong" && item.resolution === "exact")
  const unsupportedEffect = candidate.effectEvidenceLevel === "proposed" || candidate.effectEvidenceLevel === "inferred"
  const necessaryEvidence = [
    ...new Set(candidate.features.filter((feature) => feature.necessary).flatMap((feature) => feature.evidenceIds)),
  ]
  const crossFileGrounded = candidate.origin === "local" || connected(necessaryEvidence, strong)
  const verified =
    !unsupportedEffect &&
    crossFileGrounded &&
    candidate.engineeringEvaluation !== null &&
    candidate.features.every((feature) => feature.evidenceIds.every((id) => evidenceIds.has(id)))
  return {
    ...candidate,
    discoveryTier: verified ? "technical-candidate" : "observation",
    groundingStatus: verified ? "verified" : "downgraded",
    extractionWarnings: [
      ...candidate.extractionWarnings,
      ...(unsupportedEffect ? ["技术效果缺少直接实现、文档或测量证据，不能晋升技术候选。"] : []),
      ...(candidate.engineeringEvaluation === null ? ["工程质量八项评价缺失，不能晋升技术候选。"] : []),
      ...(!crossFileGrounded ? ["跨文件机制未形成 exact 强关系连通路径。"] : []),
    ],
  }
}

function connected(ids: string[], relations: PatentRadar.EvidenceRelation[]) {
  const nodes = new Set(ids)
  if (nodes.size < 2) return false
  const seen = new Set<string>([ids[0]!])
  for (;;) {
    const size = seen.size
    for (const edge of relations) {
      if (seen.has(edge.fromEvidenceId)) seen.add(edge.toEvidenceId)
      if (seen.has(edge.toEvidenceId)) seen.add(edge.fromEvidenceId)
    }
    if (seen.size === size) return [...nodes].every((id) => seen.has(id))
  }
}

export function bridgeUnits(
  mechanisms: PatentRadar.MechanismAtom[],
  relations: PatentRadar.EvidenceRelation[],
  budget = 8_000,
) {
  const strong = relations.filter((item) => item.strength === "strong" && item.resolution === "exact")
  const byEvidence = new Map<string, PatentRadar.MechanismAtom[]>()
  for (const atom of mechanisms)
    for (const id of atom.evidenceIds) byEvidence.set(id, [...(byEvidence.get(id) ?? []), atom])
  const adjacency = new Map<string, Set<string>>()
  for (const edge of strong)
    for (const left of byEvidence.get(edge.fromEvidenceId) ?? [])
      for (const right of byEvidence.get(edge.toEvidenceId) ?? []) {
        if (left.id === right.id) continue
        ;(adjacency.get(left.id) ?? adjacency.set(left.id, new Set()).get(left.id)!).add(right.id)
        ;(adjacency.get(right.id) ?? adjacency.set(right.id, new Set()).get(right.id)!).add(left.id)
      }
  const byId = new Map(mechanisms.map((item) => [item.id, item]))
  const visited = new Set<string>()
  const units: PatentRadar.MechanismAtom[][] = []
  for (const id of adjacency.keys()) {
    if (visited.has(id)) continue
    const queue = [id]
    const component: PatentRadar.MechanismAtom[] = []
    while (queue.length) {
      const next = queue.shift()!
      if (visited.has(next)) continue
      visited.add(next)
      const atom = byId.get(next)
      if (atom) component.push(atom)
      for (const linked of adjacency.get(next) ?? []) queue.push(linked)
    }
    if (component.length > 1) units.push(...partitionMechanisms(component, budget, adjacency))
  }
  for (const edge of strong) {
    const linked = [
      ...new Set([...(byEvidence.get(edge.fromEvidenceId) ?? []), ...(byEvidence.get(edge.toEvidenceId) ?? [])]),
    ]
    if (linked.length > 1 && !units.some((unit) => linked.every((atom) => unit.some((item) => item.id === atom.id))))
      units.push(linked)
  }
  return units
}

function partitionMechanisms(items: PatentRadar.MechanismAtom[], budget: number, adjacency: Map<string, Set<string>>) {
  if (Token.estimate(JSON.stringify(items)) <= budget) return [items]
  const byId = new Map(items.map((item) => [item.id, item]))
  const output: PatentRadar.MechanismAtom[][] = []
  const seen = new Set<string>()
  for (const hub of items) {
    const neighbors = [...(adjacency.get(hub.id) ?? [])].flatMap((id) => byId.get(id) ?? [])
    if (!neighbors.length) continue
    let current = [hub]
    let tokens = Token.estimate(JSON.stringify(hub))
    for (const neighbor of neighbors) {
      const size = Token.estimate(JSON.stringify(neighbor)) + 128
      if (current.length > 1 && tokens + size > budget) {
        append(current)
        current = [hub]
        tokens = Token.estimate(JSON.stringify(hub))
      }
      current.push(neighbor)
      tokens += size
    }
    append(current)
  }
  return output

  function append(unit: PatentRadar.MechanismAtom[]) {
    if (unit.length < 2) return
    const key = unit
      .map((item) => item.id)
      .sort()
      .join(":")
    if (seen.has(key)) return
    seen.add(key)
    output.push(unit)
  }
}

function packEvidence(evidence: PatentRadar.SourceEvidence[], budget = 20_900) {
  const batches: PatentRadar.SourceEvidence[][] = []
  let current: PatentRadar.SourceEvidence[] = []
  let tokens = 0
  for (const item of evidence) {
    const size = Token.estimate(JSON.stringify(item)) + 128
    if (current.length && tokens + size > budget) {
      batches.push(current)
      current = []
      tokens = 0
    }
    current.push(item)
    tokens += size
  }
  if (current.length) batches.push(current)
  return batches
}

function evaluationExample() {
  return '{"technicalProblemSpecificity":0,"implementationDepth":0,"crossComponentCoordination":0,"causalEffectCompleteness":0,"conventionalDifference":0,"mechanismReusability":0,"productCentrality":0,"designAroundDifficulty":0,"reasons":{"technicalProblemSpecificity":"","implementationDepth":"","crossComponentCoordination":"","causalEffectCompleteness":"","conventionalDifference":"","mechanismReusability":"","productCentrality":"","designAroundDifficulty":""}}'
}

export function assertModelEndpoint(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Patent Radar 无法确认模型端点，已阻止发送源码证据")
  }
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Patent Radar 模型端点只允许使用 HTTP 或 HTTPS")
  }
}

export function isTimeoutError(error: unknown): boolean {
  const seen = new Set<object>()
  let value = error
  while (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value)
    const item = value as { name?: unknown; message?: unknown; cause?: unknown }
    if (item.name === "TimeoutError") return true
    if (typeof item.message === "string" && /(?:operation\s+timed\s+out|time[ -]?out)/iu.test(item.message)) return true
    value = item.cause
  }
  return false
}

export function isNoOutputError(error: unknown): boolean {
  const seen = new Set<object>()
  let value = error
  while (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value)
    const item = value as { name?: unknown; message?: unknown; cause?: unknown }
    if (item.name === "NoOutputGeneratedError") return true
    if (typeof item.message === "string" && /no output generated/iu.test(item.message)) return true
    value = item.cause
  }
  return false
}

export function isContextLengthError(error: unknown): boolean {
  const seen = new Set<object>()
  let value = error
  while (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value)
    const item = value as { status?: unknown; message?: unknown; cause?: unknown }
    if (item.status === 413) return true
    if (
      typeof item.message === "string" &&
      /(?:context(?:_| |-)?length|maximum context|too many tokens|payload too large|http 413)/iu.test(item.message)
    )
      return true
    value = item.cause
  }
  return false
}

function validateCells(
  candidate: PatentRadar.Candidate,
  hits: PatentRadar.PatentHit[],
  cells: z.infer<typeof MatrixOutput>["cells"],
) {
  const features = new Set(candidate.features.map((item) => item.id))
  const patents = new Map(hits.map((hit) => [hit.publicationNumber, hit]))
  const unique = new Map<string, PatentRadar.MatrixCell>()
  for (const cell of cells) {
    const patent = patents.get(cell.publicationNumber)
    if (!patent || !features.has(cell.featureId)) continue
    const passage = cell.locator ? patent.passages.find((item) => item.locator === cell.locator) : undefined
    const covered = cell.covered && Boolean(passage) && Boolean(cell.quote && passage!.text.includes(cell.quote.trim()))
    unique.set(`${cell.featureId}:${cell.publicationNumber}`, {
      ...cell,
      covered,
      locator: covered ? cell.locator : null,
      quote: covered ? cell.quote!.trim().slice(0, 100) : null,
      rationale: cell.rationale.slice(0, 500),
    })
  }
  return [...unique.values()]
}

function json(value: string): unknown {
  const text = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start < 0 || end <= start) return undefined
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return undefined
    }
  }
}

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  )
}

async function parallel<T, R>(items: T[], concurrency: number, callback: (item: T, index: number) => Promise<R>) {
  const output = Array.from<R>({ length: items.length })
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        output[index] = await callback(items[index]!, index)
      }
    }),
  )
  return output
}

export function batchHash(evidence: PatentRadar.SourceEvidence[]) {
  return createHash("sha256")
    .update(
      evidence
        .map((item) => `${item.id}:${item.location.sha256}`)
        .sort()
        .join("\n"),
    )
    .digest("hex")
}

function deduplicate(items: PatentRadar.Candidate[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.keywords
      .map((word) => word.toLowerCase())
      .sort()
      .slice(0, 5)
      .join("|")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
