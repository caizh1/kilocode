import { Exit, Schema } from "effect"
import {
  BusinessFlowIR as BusinessFlowIRSchema,
  type BusinessFlowIR,
  type Evidence,
  type EvidencePack,
  type ValidationIssue,
  type ValidationReport,
} from "./domain"
import { artifactTitle } from "./reader-label"

interface ValidateInput {
  candidate: unknown
  pack: EvidencePack
  attempt: number
  currentSourceSnapshotHash: string
}

export function validateBusinessFlow(input: ValidateInput): { ir?: BusinessFlowIR; report: ValidationReport } {
  const errors: ValidationIssue[] = []
  const decoded = Schema.decodeUnknownExit(BusinessFlowIRSchema)(withFlowLabels(input.candidate, input.pack))
  if (Exit.isFailure(decoded)) {
    errors.push(issue("SCHEMA_INVALID", String(decoded.cause), true))
    return result(input, errors)
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已完成运行时解码。
  const ir = structuredClone(decoded.value) as BusinessFlowIR
  if (input.pack.artifactType !== "business-flow") errors.push(issue("ARTIFACT_TYPE_MISMATCH", "Evidence Pack 不是 business-flow 类型", false))
  if (input.currentSourceSnapshotHash !== input.pack.sourceSnapshotHash) errors.push(issue("SOURCE_CHANGED", "源码快照在生成期间发生变化", false))
  if (ir.moduleID !== input.pack.moduleID) errors.push(issue("MODULE_MISMATCH", "BusinessFlowIR moduleID 与 Evidence Pack 不一致", true))
  const evidence = new Map(input.pack.evidence.map((item) => [item.id, item]))
  const activities = new Map<string, BusinessFlowIR["activities"][number]>()
  const refs = new Set<string>()
  for (const activity of ir.activities) {
    if (activities.has(activity.id)) errors.push(issue("DUPLICATE_ACTIVITY_ID", `活动 ID 重复：${activity.id}`, true))
    if (refs.has(activity.sourceRef)) errors.push(issue("DUPLICATE_SOURCE_REF", `活动源码引用重复：${activity.sourceRef}`, true))
    activities.set(activity.id, activity)
    refs.add(activity.sourceRef)
    references(activity.evidenceIDs, evidence, errors, `活动 ${activity.id}`)
    const meaning = activity.businessMeaning.trim()
    if (
      meaning.length < 4 ||
      meaning === activity.label.trim() ||
      /^.+包含 (entry|action|decision|exit|error) 步骤$/.test(meaning)
    ) {
      errors.push(issue("BUSINESS_MEANING_REQUIRED", `活动 ${activity.id} 缺少区别于源码语句的业务含义`, true))
    }
    const proved = activity.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return explicit(item) && item.kind === "flow-node" && item.attributes.ref === activity.sourceRef && activityKind(item) === activity.kind
    })
    if (!proved) errors.push(issue("UNSUPPORTED_BUSINESS_ACTIVITY", `活动 ${activity.id} 没有完全匹配的源码证据`, true))
  }
  const flowIDs = new Set<string>()
  for (const flow of ir.flows) {
    if (!flow.label.trim()) errors.push(issue("EDGE_LABEL_REQUIRED", `业务流 ${flow.id} 缺少中文语义`, true))
    if (flowIDs.has(flow.id)) errors.push(issue("DUPLICATE_BUSINESS_FLOW_ID", `业务流 ID 重复：${flow.id}`, true))
    flowIDs.add(flow.id)
    const from = activities.get(flow.from)
    const to = activities.get(flow.to)
    if (!from || !to) {
      errors.push(issue("BROKEN_BUSINESS_FLOW_REFERENCE", `业务流 ${flow.id} 引用了不存在的活动`, true))
      continue
    }
    references(flow.evidenceIDs, evidence, errors, `业务流 ${flow.id}`)
    const proved = flow.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return explicit(item) && item.kind === "flow-edge" && item.attributes.fromRef === from.sourceRef && item.attributes.toRef === to.sourceRef && flowKind(item) === flow.kind
    })
    if (!proved) errors.push(issue("UNSUPPORTED_BUSINESS_FLOW", `业务流 ${flow.id} 没有完全匹配的源码证据`, true))
  }
  const connected = new Set(ir.flows.flatMap((flow) => [flow.from, flow.to]))
  for (const activity of ir.activities) {
    if (!connected.has(activity.id)) {
      errors.push(issue("ISOLATED_BUSINESS_ACTIVITY", `业务活动 ${activity.id} 没有任何入边或出边`, true))
    }
  }
  if (ir.activities.length < 2 || !ir.flows.length) errors.push(issue("INSUFFICIENT_BUSINESS_FLOW", "业务流程至少需要两个活动和一条关系", true))
  for (const obligation of input.pack.obligations.filter((item) => item.required)) {
    const covered = obligation.evidenceIDs.every((id) => {
      const item = evidence.get(id)
      if (item?.kind === "flow-node") return ir.activities.some((activity) => activity.sourceRef === item.attributes.ref && activity.evidenceIDs.includes(id))
      if (item?.kind === "flow-edge") return ir.flows.some((flow) => {
        const from = activities.get(flow.from)
        const to = activities.get(flow.to)
        return from?.sourceRef === item.attributes.fromRef && to?.sourceRef === item.attributes.toRef && flow.evidenceIDs.includes(id)
      })
      return false
    })
    if (!covered) errors.push(issue("MISSING_REQUIRED_EVIDENCE", `必需业务流证据未被精确覆盖：${obligation.id}`, true, obligation.evidenceIDs))
  }
  return result(input, errors, errors.length ? ir : verified(ir, evidence, input.pack))
}

function activityKind(item: Evidence): BusinessFlowIR["activities"][number]["kind"] {
  if (item.attributes.nodeKind === "entry") return "trigger"
  if (item.attributes.nodeKind === "decision") return "decision"
  if (item.attributes.nodeKind === "exit") return "outcome"
  if (item.attributes.nodeKind === "error") return "error"
  return "activity"
}

function flowKind(item: Evidence): BusinessFlowIR["flows"][number]["kind"] {
  if (item.attributes.edgeKind === "branch-true" || item.attributes.edgeKind === "branch-false") return "branch"
  if (item.attributes.edgeKind === "return") return "success"
  if (item.attributes.edgeKind === "error") return "failure"
  if (item.attributes.edgeKind === "loop") return "loop"
  return "next"
}

function verified(ir: BusinessFlowIR, evidence: Map<string, Evidence>, pack: EvidencePack): BusinessFlowIR {
  return {
    ...ir,
    title: artifactTitle(pack, "业务流程"),
    summary: `基于源码控制流证据生成，共 ${ir.activities.length} 个业务活动、${ir.flows.length} 条关系。`,
    assumptions: [],
    unknowns: [],
    activities: ir.activities.map((activity) => {
      const item = activity.evidenceIDs.map((id) => evidence.get(id)).find((candidate) => candidate?.kind === "flow-node")
      return {
        ...activity,
        label: typeof item?.attributes.label === "string" ? item.attributes.label : activity.label,
        businessMeaning: activity.businessMeaning.trim(),
      }
    }),
    flows: ir.flows.map((flow) => {
      const item = flow.evidenceIDs.map((id) => evidence.get(id)).find((candidate) => candidate?.kind === "flow-edge")
      const label = item?.attributes.label
      return { ...flow, label: typeof label === "string" ? label : flow.label }
    }),
  }
}

function withFlowLabels(candidate: unknown, pack: EvidencePack) {
  if (!isRecord(candidate) || !Array.isArray(candidate.activities) || !Array.isArray(candidate.flows)) return candidate
  const evidence = new Map(pack.evidence.map((item) => [item.id, item]))
  const activities = candidate.activities.map((value) => {
    if (!isRecord(value)) return value
    const ids = evidenceIDs(value)
    const proved = ids.map((id) => evidence.get(id)).find((item) => item?.kind === "flow-node")
    if (!proved || typeof proved.attributes.ref !== "string") return value
    return {
      ...value,
      sourceRef: proved.attributes.ref,
      kind: activityKind(proved),
      label: typeof proved.attributes.label === "string" ? proved.attributes.label : value.label,
    }
  })
  const activityByRef = new Map(
    activities.flatMap((value) =>
      isRecord(value) && typeof value.sourceRef === "string" && typeof value.id === "string"
        ? [[value.sourceRef, value.id] as const]
        : [],
    ),
  )
  const defaults: Record<string, string> = {
    next: "顺序执行",
    branch: "条件分支",
    success: "成功返回",
    failure: "进入失败路径",
    loop: "继续循环",
  }
  return {
    ...candidate,
    activities,
    flows: candidate.flows.map((value) => {
      if (!isRecord(value)) return value
      const proved = evidenceIDs(value).map((id) => evidence.get(id)).find((item) => item?.kind === "flow-edge")
      const label = typeof proved?.attributes.label === "string"
        ? proved.attributes.label
        : typeof value.label === "string" && value.label.trim()
          ? value.label
          : defaults[String(value.kind)] ?? "继续处理"
      if (!proved) return { ...value, label }
      const from = typeof proved.attributes.fromRef === "string" ? activityByRef.get(proved.attributes.fromRef) : undefined
      const to = typeof proved.attributes.toRef === "string" ? activityByRef.get(proved.attributes.toRef) : undefined
      return { ...value, from: from ?? value.from, to: to ?? value.to, kind: flowKind(proved), label }
    }),
  }
}

function evidenceIDs(value: Record<string, unknown>) {
  return Array.isArray(value.evidenceIDs)
    ? value.evidenceIDs.filter((id): id is string => typeof id === "string")
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function references(ids: readonly string[], evidence: Map<string, Evidence>, errors: ValidationIssue[], owner: string) {
  if (!ids.length) errors.push(issue("EVIDENCE_REQUIRED", `${owner} 缺少 evidenceId`, true))
  for (const id of ids) if (!evidence.has(id)) errors.push(issue("INVALID_EVIDENCE_ID", `${owner} 引用了无效 evidenceId：${id}`, true, [id]))
}

function explicit(item: Evidence | undefined): item is Evidence {
  return item?.confidence === "explicit" && item.source.sourceKind !== "test"
}

function result(input: ValidateInput, errors: ValidationIssue[], ir?: BusinessFlowIR) {
  return {
    ir,
    report: {
      schemaVersion: 1 as const,
      workItemID: input.pack.workItemID,
      attempt: input.attempt,
      passed: errors.length === 0,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      validatorVersions: { schema: "1", evidence: "1", businessFlow: "1" },
      errors,
      warnings: [],
      metrics: { evidenceCount: input.pack.evidence.length, errorCount: errors.length },
      createdAt: Date.now(),
    } satisfies ValidationReport,
  }
}

function issue(code: string, message: string, retryable: boolean, evidenceIDs: readonly string[] = []): ValidationIssue {
  return { severity: "error", code, message, evidenceIDs: [...evidenceIDs], sourcePaths: [], retryable }
}

const ids = { type: "array", minItems: 1, items: { type: "string" } } as const
const note = { type: "object", additionalProperties: false, required: ["text", "evidenceIDs"], properties: { text: { type: "string" }, evidenceIDs: ids } } as const

export const businessFlowJSONSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "moduleID", "viewType", "title", "summary", "assumptions", "unknowns", "activities", "flows"],
  properties: {
    schemaVersion: { const: 1 },
    moduleID: { type: "string" },
    viewType: { const: "business-flow" },
    title: { type: "string" },
    summary: { type: "string" },
    assumptions: { type: "array", items: note },
    unknowns: { type: "array", items: note },
    activities: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "sourceRef", "label", "businessMeaning", "evidenceIDs"],
        properties: {
          id: { type: "string" },
          kind: { enum: ["trigger", "activity", "decision", "outcome", "error"] },
          sourceRef: { type: "string" },
          label: { type: "string" },
          businessMeaning: { type: "string" },
          evidenceIDs: ids,
        },
      },
    },
    flows: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "from", "to", "kind", "label", "evidenceIDs"],
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          kind: { enum: ["next", "branch", "success", "failure", "loop"] },
          label: { type: "string" },
          evidenceIDs: ids,
        },
      },
    },
  },
} as const
