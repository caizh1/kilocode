import { Exit, Schema } from "effect"
import {
  OverviewIR as OverviewIRSchema,
  type Evidence,
  type EvidencePack,
  type OverviewIR,
  type ValidationIssue,
  type ValidationReport,
} from "./domain"
import { artifactTitle } from "./reader-label"

interface ValidateOverviewInput {
  candidate: unknown
  pack: EvidencePack
  attempt: number
  currentSourceSnapshotHash: string
}

export function validateOverview(input: ValidateOverviewInput): { ir?: OverviewIR; report: ValidationReport } {
  const errors: ValidationIssue[] = []
  const decoded = Schema.decodeUnknownExit(OverviewIRSchema)(input.candidate)
  if (Exit.isFailure(decoded)) {
    errors.push(issue("SCHEMA_INVALID", String(decoded.cause), true))
    return result(input, errors)
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已完成运行时解码。
  const ir = structuredClone(decoded.value) as OverviewIR
  if (input.pack.artifactType !== "overview") errors.push(issue("ARTIFACT_TYPE_MISMATCH", "Evidence Pack 不是 overview 类型", false))
  if (input.currentSourceSnapshotHash !== input.pack.sourceSnapshotHash) errors.push(issue("SOURCE_CHANGED", "源码快照在生成期间发生变化", false))
  if (ir.moduleID !== input.pack.moduleID) errors.push(issue("MODULE_MISMATCH", "OverviewIR moduleID 与 Evidence Pack 不一致", true))

  const evidence = new Map(input.pack.evidence.map((item) => [item.id, item]))
  validateClaims(ir.responsibilities, evidence, errors, "职责")
  validateClaims(ir.boundaries, evidence, errors, "边界")
  if (!ir.responsibilities.length) errors.push(issue("RESPONSIBILITY_REQUIRED", "模块概览至少需要一条职责说明", true))
  if (!ir.boundaries.length) errors.push(issue("BOUNDARY_REQUIRED", "模块概览至少需要一条边界说明", true))
  const ids = new Set<string>()
  const claimedEvidence = new Set<string>()
  for (const item of ir.items) {
    if (ids.has(item.id)) errors.push(issue("DUPLICATE_ITEM_ID", `概览项 ID 重复：${item.id}`, true))
    ids.add(item.id)
    references(item.evidenceIDs, evidence, errors, item.id)
    for (const id of item.evidenceIDs) {
      if (claimedEvidence.has(id)) errors.push(issue("DUPLICATE_SEMANTICS", `概览证据被重复声明：${id}`, true, [id]))
      claimedEvidence.add(id)
    }
    if (!item.evidenceIDs.some((id) => matches(evidence.get(id), item))) {
      errors.push(issue("UNSUPPORTED_OVERVIEW_ITEM", `概览项 ${item.id} 没有完全匹配的源码证据`, true))
    }
  }
  for (const obligation of input.pack.obligations.filter((item) => item.required)) {
    const covered = obligation.evidenceIDs.every((id) => {
      const source = evidence.get(id)
      return source ? ir.items.some((item) => item.evidenceIDs.includes(id) && matches(source, item)) : false
    })
    if (!covered) errors.push(issue("MISSING_REQUIRED_EVIDENCE", `必需概览证据未被精确覆盖：${obligation.id}`, true, obligation.evidenceIDs))
  }
  if (ir.items.length < 2) errors.push(issue("INSUFFICIENT_OVERVIEW_ITEMS", "模块概览至少需要两个事实项", true))
  return result(input, errors, errors.length ? ir : verified(ir, input.pack))
}

function matches(evidence: Evidence | undefined, item: OverviewIR["items"][number]) {
  if (evidence?.confidence !== "explicit" || evidence.source.sourceKind === "test") return false
  return overviewKind(evidence) === item.kind
}

function references(ids: readonly string[], evidence: Map<string, Evidence>, errors: ValidationIssue[], owner: string) {
  if (!ids.length) errors.push(issue("EVIDENCE_REQUIRED", `概览项 ${owner} 缺少 evidenceId`, true))
  for (const id of ids) if (!evidence.has(id)) errors.push(issue("INVALID_EVIDENCE_ID", `概览项 ${owner} 引用了无效 evidenceId：${id}`, true, [id]))
}

function validateClaims(
  claims: OverviewIR["responsibilities"] | OverviewIR["boundaries"],
  evidence: Map<string, Evidence>,
  errors: ValidationIssue[],
  kind: string,
) {
  const texts = new Set<string>()
  for (const claim of claims) {
    const normalized = claim.text.trim().replace(/\s+/g, " ")
    if (!normalized) errors.push(issue("EMPTY_OVERVIEW_CLAIM", `${kind}说明不能为空`, true))
    if (texts.has(normalized)) errors.push(issue("DUPLICATE_OVERVIEW_CLAIM", `${kind}说明重复：${normalized}`, true))
    texts.add(normalized)
    references(claim.evidenceIDs, evidence, errors, `${kind}说明`)
    if (
      !claim.evidenceIDs.some((id) => {
        const item = evidence.get(id)
        return item?.confidence === "explicit" && item.source.sourceKind !== "test"
      })
    ) {
      errors.push(issue("UNSUPPORTED_OVERVIEW_CLAIM", `${kind}说明缺少显式生产源码证据`, true, claim.evidenceIDs))
    }
  }
}

function verified(ir: OverviewIR, pack: EvidencePack): OverviewIR {
  const explicit = pack.evidence.filter(
    (item) => item.confidence === "explicit" && item.source.sourceKind === "production",
  )
  const claims = (items: Array<{ text: string; evidenceIDs: string[] }>) => [
    ...new Map(items.map((item) => [item.text, item] as const)).values(),
  ]
  const responsibilities = claims(
    explicit.flatMap((item) => {
      if (item.kind === "flow-node" && item.attributes.nodeKind === "entry") {
        return [{ text: `提供执行入口 ${String(item.attributes.label)}`, evidenceIDs: [item.id] }]
      }
      if (item.kind === "code-symbol") {
        return [
          {
            text: `声明 ${String(item.attributes.symbolKind)} ${String(item.attributes.qualifiedName ?? item.attributes.name)}`,
            evidenceIDs: [item.id],
          },
        ]
      }
      if (item.kind === "configuration") {
        return [{ text: `读取配置 ${String(item.attributes.key)}`, evidenceIDs: [item.id] }]
      }
      return []
    }),
  )
  const boundaries = claims(
    explicit.flatMap((item) => {
      if (item.kind === "dependency") {
        return [
          {
            text: `依赖边界 ${String(item.attributes.from)} → ${String(item.attributes.to)}`,
            evidenceIDs: [item.id],
          },
        ]
      }
      if (item.kind === "source-file") {
        return [{ text: `源码边界包含 ${String(item.attributes.ref)}`, evidenceIDs: [item.id] }]
      }
      return []
    }),
  )
  const items = ir.items.flatMap((item) =>
    item.evidenceIDs.flatMap((id) => {
      const source = explicit.find((candidate) => candidate.id === id)
      if (!source || !matches(source, item)) return []
      const kind = overviewKind(source)!
      return [{
        id: `overview-${source.id}`,
        kind,
        sourceRef: overviewSourceRef(source),
        label: overviewLabel(source, kind),
        evidenceIDs: [source.id],
      }]
    }),
  )
  return {
    ...ir,
    title: artifactTitle(pack, "模块概览"),
    summary: `基于源码证据生成，共 ${ir.items.length} 个可追溯事实项。`,
    assumptions: [],
    unknowns: [],
    responsibilities,
    boundaries,
    items,
    relations: overviewRelations(items, explicit),
  }
}

function overviewRelations(items: OverviewIR["items"], evidence: Evidence[]): NonNullable<OverviewIR["relations"]> {
  const byEvidence = new Map(items.flatMap((item) => item.evidenceIDs.map((id) => [id, item] as const)))
  const byRef = new Map(items.map((item) => [item.sourceRef, item]))
  return evidence.flatMap((source) => {
    const to = byEvidence.get(source.id)
    if (!to) return []
    const relation = (() => {
      if (source.kind === "dependency") {
        return { from: byRef.get(String(source.attributes.from)), kind: "depends-on" as const, label: "依赖" }
      }
      if (source.kind === "code-symbol") {
        return { from: byRef.get(String(source.attributes.parentRef)), kind: "contains" as const, label: "声明" }
      }
      if (source.kind === "flow-node" && source.attributes.nodeKind === "entry") {
        return { from: byRef.get(String(source.attributes.ownerRef)), kind: "entry" as const, label: "提供入口" }
      }
      if (source.kind === "configuration") {
        return { from: byRef.get(source.source.path), kind: "configures" as const, label: "读取配置" }
      }
      return undefined
    })()
    if (!relation?.from || relation.from.id === to.id) return []
    return [{
      id: `overview-relation-${source.id}`,
      from: relation.from.id,
      to: to.id,
      kind: relation.kind,
      label: relation.label,
      evidenceIDs: [source.id],
    }]
  })
}

function overviewKind(evidence: Evidence): OverviewIR["items"][number]["kind"] | undefined {
  if (evidence.kind === "source-file") return "file"
  if (evidence.kind === "code-symbol") return "symbol"
  if (evidence.kind === "flow-node" && evidence.attributes.nodeKind === "entry") return "entry"
  if (evidence.kind === "configuration") return "configuration"
  if (evidence.kind === "dependency") return "dependency"
  return undefined
}

function overviewSourceRef(evidence: Evidence) {
  if (evidence.kind === "dependency") return `${String(evidence.attributes.from)}->${String(evidence.attributes.to)}`
  return String(evidence.attributes.ref)
}

function overviewLabel(evidence: Evidence, kind: OverviewIR["items"][number]["kind"]) {
  if (kind === "file") return String(evidence.attributes.ref).split("/").at(-1) ?? String(evidence.attributes.ref)
  if (kind === "symbol") return `${String(evidence.attributes.symbolKind)} ${String(evidence.attributes.name)}`
  if (kind === "entry") return String(evidence.attributes.label)
  if (kind === "configuration") return String(evidence.attributes.key)
  return String(evidence.attributes.to)
}

function result(input: ValidateOverviewInput, errors: ValidationIssue[], ir?: OverviewIR): { ir?: OverviewIR; report: ValidationReport } {
  return {
    ir,
    report: {
      schemaVersion: 1,
      workItemID: input.pack.workItemID,
      attempt: input.attempt,
      passed: errors.length === 0,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      validatorVersions: { schema: "1", evidence: "1", overview: "1" },
      errors,
      warnings: [],
      metrics: { evidenceCount: input.pack.evidence.length, requiredObligationCount: input.pack.obligations.filter((item) => item.required).length, errorCount: errors.length, warningCount: 0 },
      createdAt: Date.now(),
    },
  }
}

function issue(code: string, message: string, retryable: boolean, evidenceIDs: readonly string[] = []): ValidationIssue {
  return { severity: "error", code, message, evidenceIDs: [...evidenceIDs], sourcePaths: [], retryable }
}

const evidenceIDs = { type: "array", minItems: 1, items: { type: "string" } } as const
const note = { type: "object", additionalProperties: false, required: ["text", "evidenceIDs"], properties: { text: { type: "string" }, evidenceIDs } } as const

export const overviewJSONSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "moduleID", "viewType", "title", "summary", "assumptions", "unknowns", "responsibilities", "boundaries", "items"],
  properties: {
    schemaVersion: { const: 1 },
    moduleID: { type: "string" },
    viewType: { const: "overview" },
    title: { type: "string" },
    summary: { type: "string" },
    assumptions: { type: "array", items: note },
    unknowns: { type: "array", items: note },
    responsibilities: { type: "array", minItems: 1, items: note },
    boundaries: { type: "array", minItems: 1, items: note },
    items: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "sourceRef", "label", "evidenceIDs"],
        properties: {
          id: { type: "string" },
          kind: { enum: ["file", "symbol", "entry", "dependency", "configuration"] },
          sourceRef: { type: "string" },
          label: { type: "string" },
          evidenceIDs,
        },
      },
    },
  },
} as const
