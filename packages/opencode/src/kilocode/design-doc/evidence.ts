import { createHash } from "crypto"
import type {
  BehaviorExtractionResult,
  CodeStructureExtractionResult,
  LifecycleExtractionResult,
  OverviewExtractionResult,
  ProductExtractionResult,
  RawCodeStructureEvidence,
  RawBehaviorEvidence,
  RawLifecycleEvidence,
  RawStructureEvidence,
  RawProductEvidence,
  StructureExtractionResult,
  TopicExtractionResult,
} from "@kilocode/kilo-indexing/design-doc"
import type { ArtifactType, Evidence, EvidenceObligation, EvidencePack, WorkItemPurpose } from "./domain"

export interface BuildEvidencePackInput {
  extraction: LifecycleExtractionResult
  workItemID: string
  moduleName?: string
  maxItems: number
  maxPromptBytes: number
  maxSnippetCharacters: number
}

export interface BuildStructureEvidencePackInput extends Omit<BuildEvidencePackInput, "extraction"> {
  extraction: StructureExtractionResult
}

export interface BuildCodeStructureEvidencePackInput extends Omit<BuildEvidencePackInput, "extraction"> {
  extraction: CodeStructureExtractionResult
}

export interface BuildBehaviorEvidencePackInput extends Omit<BuildEvidencePackInput, "extraction"> {
  artifactType: "business-flow" | "execution-flow" | "sequence" | "data-flow" | "error-flow"
  extraction: BehaviorExtractionResult
}

export interface BuildOverviewEvidencePackInput extends Omit<BuildEvidencePackInput, "extraction"> {
  extraction: OverviewExtractionResult
}

export interface BuildTopicEvidencePackInput extends Omit<BuildEvidencePackInput, "extraction"> {
  extraction: TopicExtractionResult
  purpose: Extract<WorkItemPurpose, { kind: "topic" }>
}

export interface BuildProductEvidencePackInput extends Omit<BuildEvidencePackInput, "extraction"> {
  extraction: ProductExtractionResult
  purpose: Extract<WorkItemPurpose, { kind: "product-section" }>
}

export class EvidenceBudgetError extends Error {
  readonly code = "EVIDENCE_BUDGET_EXCEEDED"

  constructor(message: string) {
    super(message)
    this.name = "EvidenceBudgetError"
  }
}

export function buildEvidencePack(input: BuildEvidencePackInput): EvidencePack {
  return buildPack("lifecycle", input)
}

export function buildStructureEvidencePack(input: BuildStructureEvidencePackInput): EvidencePack {
  return buildPack("structure", input)
}

export function buildCodeStructureEvidencePack(input: BuildCodeStructureEvidencePackInput): EvidencePack {
  return buildPack("code-structure", input)
}

export function buildBehaviorEvidencePack(input: BuildBehaviorEvidencePackInput): EvidencePack {
  const relevantOwners = relevantCallableRefs(input)
  const selected: BehaviorExtractionResult = {
    ...input.extraction,
    evidence: input.extraction.evidence.filter((item) =>
      behaviorEvidenceApplies(input.artifactType, item, relevantOwners),
    ),
  }
  return buildPack(input.artifactType, { ...input, extraction: selected })
}

export function buildOverviewEvidencePack(input: BuildOverviewEvidencePackInput): EvidencePack {
  return buildPack("overview", input)
}

export function buildTopicEvidencePack(input: BuildTopicEvidencePackInput): EvidencePack {
  return { ...buildPack("topic", input), purpose: input.purpose }
}

export function buildProductEvidencePack(input: BuildProductEvidencePackInput): EvidencePack {
  return { ...buildPack("product-section", input), purpose: input.purpose }
}

const behaviorKinds: Record<
  BuildBehaviorEvidencePackInput["artifactType"],
  ReadonlySet<RawBehaviorEvidence["kind"]>
> = {
  "execution-flow": new Set(["flow-node", "flow-edge"]),
  "business-flow": new Set(["flow-node", "flow-edge"]),
  sequence: new Set(["flow-node", "call-message"]),
  "data-flow": new Set(["data-entity", "data-flow"]),
  "error-flow": new Set(["flow-node", "error-node", "error-edge"]),
}

function behaviorEvidenceApplies(
  artifactType: BuildBehaviorEvidencePackInput["artifactType"],
  item: RawBehaviorEvidence,
  relevantOwners: Set<string>,
) {
  if (!behaviorKinds[artifactType].has(item.kind)) return false
  if ((artifactType === "business-flow" || artifactType === "execution-flow") && item.kind === "flow-node") {
    return relevantOwners.has(String(item.attributes.ref))
  }
  if ((artifactType === "sequence" || artifactType === "error-flow") && item.kind === "flow-node") {
    return item.attributes.nodeKind === "entry" && relevantOwners.has(String(item.attributes.ownerRef))
  }
  return true
}

function relevantCallableRefs(input: BuildBehaviorEvidencePackInput) {
  if (input.artifactType === "business-flow" || input.artifactType === "execution-flow") {
    return new Set(
      input.extraction.evidence
        .filter((item) => item.kind === "flow-edge")
        .flatMap((item) => [item.attributes.fromRef, item.attributes.toRef])
        .filter((value): value is string => typeof value === "string"),
    )
  }
  if (input.artifactType === "sequence") {
    return new Set(
      input.extraction.evidence
        .filter((item) => item.kind === "call-message")
        .flatMap((item) => [item.attributes.fromRef, item.attributes.toRef])
        .filter((value): value is string => typeof value === "string" && !value.startsWith("external:")),
    )
  }
  if (input.artifactType === "error-flow") {
    return new Set(
      input.extraction.evidence
        .filter((item) => item.kind === "error-node")
        .flatMap((item) => (typeof item.attributes.ownerRef === "string" ? [item.attributes.ownerRef] : [])),
    )
  }
  return new Set<string>()
}

function buildPack(
  artifactType: ArtifactType,
  input:
    | BuildEvidencePackInput
    | BuildStructureEvidencePackInput
    | BuildCodeStructureEvidencePackInput
    | BuildBehaviorEvidencePackInput
    | BuildOverviewEvidencePackInput
    | BuildTopicEvidencePackInput
    | BuildProductEvidencePackInput,
): EvidencePack {
  const evidence = uniqueEvidence(
    input.extraction.evidence.map((item) => materialize(input.extraction.sourceSnapshotHash, item)),
  )
  const required = evidence.filter((item) => item.confidence === "explicit" && item.source.sourceKind !== "test")
  if (required.length > input.maxItems) {
    throw new EvidenceBudgetError(`必需证据数量 ${required.length} 超过限制 ${input.maxItems}`)
  }

  const selected = selectEvidence(evidence, input.maxItems)
  const bounded = selected.map((item) => ({
    ...item,
    snippet: item.snippet.slice(0, input.maxSnippetCharacters),
  }))
  const obligations = buildObligations(bounded)
  const draft = {
    schemaVersion: 1 as const,
    id: `PACK-${sha256(`${input.extraction.moduleID}\0${input.workItemID}\0${input.extraction.sourceSnapshotHash}`).slice(0, 20)}`,
    moduleID: input.extraction.moduleID,
    ...(input.moduleName ? { moduleName: input.moduleName } : {}),
    workItemID: input.workItemID,
    artifactType,
    sourceSnapshotHash: input.extraction.sourceSnapshotHash,
    evidence: bounded,
    obligations,
    unknowns: input.extraction.unknowns,
  }
  const promptBytes = Buffer.byteLength(
    JSON.stringify({
      ...draft,
      budget: {
        items: bounded.length,
        promptBytes: input.maxPromptBytes,
        truncated: false,
      },
    }),
  )
  if (promptBytes > input.maxPromptBytes) {
    throw new EvidenceBudgetError(`必需证据包 ${promptBytes} 字节超过限制 ${input.maxPromptBytes} 字节`)
  }

  return {
    ...draft,
    budget: { items: bounded.length, promptBytes, truncated: false },
  }
}

export function hasSufficientLifecycleEvidence(pack: EvidencePack) {
  if (pack.artifactType !== "lifecycle") return false
  if (pack.unknowns.some((item) => item.includes("多个候选状态字段"))) return false
  const states = new Set(
    pack.evidence
      .filter(
        (item) =>
          item.source.sourceKind !== "test" &&
          item.confidence === "explicit" &&
          (item.kind === "state-definition" || item.kind === "initial-state"),
      )
      .flatMap((item) => (typeof item.attributes.state === "string" ? [item.attributes.state] : [])),
  )
  const transitions = pack.evidence.filter(
    (item) => item.source.sourceKind !== "test" && item.confidence === "explicit" && item.kind === "state-transition",
  )
  const initial = pack.evidence.some(
    (item) => item.source.sourceKind !== "test" && item.confidence === "explicit" && item.kind === "initial-state",
  )
  return states.size >= 2 && transitions.length >= 1 && initial
}

export function hasSufficientStructureEvidence(pack: EvidencePack) {
  if (pack.artifactType !== "structure") return false
  const production = pack.evidence.filter((item) => item.source.sourceKind !== "test" && item.confidence === "explicit")
  return (
    production.some((item) => item.kind === "source-file") &&
    production.some((item) => item.kind === "dependency") &&
    pack.unknowns.length === 0
  )
}

export function hasSufficientCodeStructureEvidence(pack: EvidencePack) {
  if (pack.artifactType !== "code-structure") return false
  const production = pack.evidence.filter((item) => item.source.sourceKind !== "test" && item.confidence === "explicit")
  return (
    production.some((item) => item.kind === "source-file") &&
    production.some((item) => item.kind === "code-symbol") &&
    pack.unknowns.length === 0
  )
}

export function hasSufficientBehaviorEvidence(pack: EvidencePack) {
  const production = pack.evidence.filter((item) => item.source.sourceKind !== "test" && item.confidence === "explicit")
  if (pack.artifactType === "execution-flow") {
    return production.filter((item) => item.kind === "flow-node").length >= 2 && production.some((item) => item.kind === "flow-edge")
  }
  if (pack.artifactType === "business-flow") {
    return production.filter((item) => item.kind === "flow-node").length >= 2 && production.some((item) => item.kind === "flow-edge")
  }
  if (pack.artifactType === "sequence") {
    return production.some((item) => item.kind === "call-message")
  }
  if (pack.artifactType === "data-flow") {
    return production.filter((item) => item.kind === "data-entity").length >= 2 && production.some((item) => item.kind === "data-flow")
  }
  if (pack.artifactType === "error-flow") {
    return production.some((item) => item.kind === "error-node") && production.some((item) => item.kind === "error-edge")
  }
  return false
}

export function hasSufficientOverviewEvidence(pack: EvidencePack) {
  if (pack.artifactType !== "overview") return false
  const production = pack.evidence.filter((item) => item.source.sourceKind !== "test" && item.confidence === "explicit")
  return production.some((item) => item.kind === "source-file") && production.some((item) => item.kind === "code-symbol")
}

export function hasSufficientTopicEvidence(pack: EvidencePack) {
  if (pack.artifactType !== "topic" || pack.purpose?.kind !== "topic") return false
  return pack.evidence.some(
    (item) => item.source.sourceKind !== "test" && item.confidence === "explicit",
  )
}

export function hasSufficientProductEvidence(pack: EvidencePack) {
  if (pack.artifactType !== "product-section" || pack.purpose?.kind !== "product-section") return false
  if (pack.purpose.section === "requirements") {
    return pack.evidence.some((item) => item.kind === "requirement") ||
      pack.unknowns.some((item) => item.startsWith("requirements-missing:"))
  }
  // DFX、SFMEA、资源和测试章节允许用完整扫描得到的 absence 结论发布；
  // 其他正文至少需要一条显式、非测试源码事实。
  if (["resource-performance", "dfx", "sfmea", "verification"].includes(pack.purpose.section)) {
    return pack.evidence.length > 0 || pack.unknowns.some((item) => item.startsWith("product-section-absence:"))
  }
  return pack.evidence.some(
    (item) => item.source.sourceKind !== "test" && item.confidence === "explicit",
  )
}

function materialize(
  sourceSnapshotHash: string,
  item: RawLifecycleEvidence | RawStructureEvidence | RawCodeStructureEvidence | RawBehaviorEvidence | RawProductEvidence,
): Evidence {
  const key = [
    "1",
    sourceSnapshotHash,
    item.source.path,
    item.kind,
    `${item.source.startLine}:${item.source.endLine}`,
    item.source.symbol ?? "",
    normalize(item.fact),
    stableAttributes(item.attributes),
  ].join("\0")
  return { ...item, id: `EV-${sha256(key).slice(0, 20)}` }
}

function uniqueEvidence(evidence: Evidence[]) {
  const ids = new Map<string, string>()
  return evidence.filter((item) => {
    const serialized = JSON.stringify(item)
    const existing = ids.get(item.id)
    if (existing && existing !== serialized) throw new Error(`Evidence ID 冲突：${item.id}`)
    if (existing) return false
    ids.set(item.id, serialized)
    return true
  })
}

function selectEvidence(evidence: Evidence[], maxItems: number) {
  const priority = (item: Evidence) => {
    if (item.confidence === "explicit" && item.source.sourceKind !== "test") return 0
    if (item.source.sourceKind === "test") return 3
    if (item.kind === "initial-state" || item.kind === "state-transition") return 1
    if (item.kind === "state-definition" || item.kind === "terminal-state") return 2
    return 2
  }
  return [...evidence]
    .sort((left, right) => priority(left) - priority(right) || left.id.localeCompare(right.id))
    .slice(0, maxItems)
}

function buildObligations(evidence: Evidence[]): EvidenceObligation[] {
  return evidence.flatMap((item) => {
    const kind = obligationKind(item)
    if (!kind) return []
    return [
      {
        id: `OB-${sha256(`${kind}\0${item.id}`).slice(0, 20)}`,
        kind,
        evidenceIDs: [item.id],
        required: item.confidence === "explicit" && item.source.sourceKind !== "test",
      },
    ]
  })
}

function obligationKind(item: Evidence): EvidenceObligation["kind"] | undefined {
  if (item.kind === "state-definition" || item.kind === "terminal-state") return "state"
  if (item.kind === "initial-state") return "entry"
  if (item.kind === "state-transition") return "transition"
  if (item.kind === "error-path") return "error"
  if (item.kind === "timeout") return "timeout"
  if (item.kind === "source-file") return "file"
  if (item.kind === "module-boundary") return "relationship"
  if (item.kind === "dependency") return "relationship"
  if (item.kind === "code-symbol") return "symbol"
  if (item.kind === "flow-node") return "flow-node"
  if (item.kind === "flow-edge") return "flow-edge"
  if (item.kind === "call-message") return "message"
  if (item.kind === "data-entity") return "data-entity"
  if (item.kind === "data-flow") return "data-flow"
  if (item.kind === "error-node") return "error-node"
  if (item.kind === "error-edge") return "error-edge"
  if (item.kind === "configuration") return "configuration"
  if (item.kind === "requirement" || item.kind === "architecture-reference" || item.kind === "interface-reference")
    return "requirement"
  if (item.kind === "test-reference") return "verification-case"
  if (item.kind === "resource") return "resource"
  if (item.kind === "diagnostic") return "diagnostic"
  if (item.kind === "failure-mode") return "failure-mode"
  return undefined
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function stableAttributes(attributes: RawLifecycleEvidence["attributes"]) {
  return JSON.stringify(Object.fromEntries(Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right))))
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
