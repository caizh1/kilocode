import { Exit, Schema } from "effect"
import {
  StructureIR as StructureIRSchema,
  type EvidencePack,
  type StructureIR,
  type ValidationIssue,
  type ValidationReport,
} from "./domain"
import { artifactTitle } from "./reader-label"

export interface ValidateStructureInput {
  candidate: unknown
  pack: EvidencePack
  attempt: number
  currentSourceSnapshotHash: string
}

export function validateStructure(input: ValidateStructureInput): {
  ir?: StructureIR
  report: ValidationReport
} {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const decoded = Schema.decodeUnknownExit(StructureIRSchema)(input.candidate)
  if (Exit.isFailure(decoded)) {
    errors.push(issue("SCHEMA_INVALID", String(decoded.cause), true))
    return result(input, errors, warnings)
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已验证候选，克隆只把只读容器转换为校验阶段的可变 IR。
  const ir = structuredClone(decoded.value) as StructureIR
  if (input.pack.artifactType !== "structure") {
    errors.push(issue("ARTIFACT_TYPE_MISMATCH", "Evidence Pack 不是 structure 类型", false))
  }
  if (input.currentSourceSnapshotHash !== input.pack.sourceSnapshotHash) {
    errors.push(issue("SOURCE_CHANGED", "源码快照在生成期间发生变化", false))
  }
  if (ir.moduleID !== input.pack.moduleID) {
    errors.push(issue("MODULE_MISMATCH", "StructureIR moduleID 与 Evidence Pack 不一致", true))
  }

  const evidence = new Map(input.pack.evidence.map((item) => [item.id, item]))
  const nodes = new Map<string, StructureIR["nodes"][number]>()
  const refs = new Set<string>()
  const degree = new Map<string, number>()
  for (const node of ir.nodes) {
    if (nodes.has(node.id)) errors.push(issue("DUPLICATE_NODE_ID", `节点 ID 重复：${node.id}`, true))
    if (refs.has(node.sourceRef)) errors.push(issue("DUPLICATE_SOURCE_REF", `源码引用重复：${node.sourceRef}`, true))
    nodes.set(node.id, node)
    refs.add(node.sourceRef)
    degree.set(node.id, 0)
    validateReferences(node.evidenceIDs, evidence, errors, `节点 ${node.id}`)
    if (node.kind === "source-file") {
      const proved = node.evidenceIDs.some((id) => {
        const item = evidence.get(id)
        return production(item) && item.kind === "source-file" && item.attributes.ref === node.sourceRef
      })
      if (!proved) {
        errors.push(issue("UNSUPPORTED_SOURCE_FILE", `节点 ${node.id} 没有匹配 sourceRef 的生产源码证据`, true))
      }
      continue
    }
    const internal = input.pack.evidence.some(
      (item) => production(item) && item.kind === "source-file" && item.attributes.ref === node.sourceRef,
    )
    if (internal) {
      errors.push(issue("INTERNAL_NODE_MARKED_EXTERNAL", `内部文件 ${node.sourceRef} 不能标记为外部依赖`, true))
    }
    const proved = node.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return production(item) && item.kind === "dependency" && item.attributes.to === node.sourceRef
    })
    if (!proved) {
      errors.push(issue("UNSUPPORTED_EXTERNAL_DEPENDENCY", `外部依赖 ${node.sourceRef} 没有匹配证据`, true))
    }
  }
  if (nodes.size < 2) errors.push(issue("INSUFFICIENT_NODES", "结构图至少需要两个节点", true))

  const edgeIDs = new Set<string>()
  const semantics = new Set<string>()
  for (const edge of ir.edges) {
    if (edgeIDs.has(edge.id)) errors.push(issue("DUPLICATE_EDGE_ID", `边 ID 重复：${edge.id}`, true))
    edgeIDs.add(edge.id)
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) {
      errors.push(issue("BROKEN_EDGE_REFERENCE", `边 ${edge.id} 引用了不存在的节点`, true))
      continue
    }
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
    validateReferences(edge.evidenceIDs, evidence, errors, `边 ${edge.id}`)
    const proved = edge.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return (
        production(item) &&
        item.kind === "dependency" &&
        item.attributes.from === from.sourceRef &&
        item.attributes.to === to.sourceRef
      )
    })
    if (!proved) {
      errors.push(issue("UNSUPPORTED_DEPENDENCY", `边 ${edge.id} 没有 from/to 完全一致的生产源码证据`, true))
    }
    const key = `${from.sourceRef}\0${to.sourceRef}`
    if (semantics.has(key)) errors.push(issue("DUPLICATE_SEMANTICS", `存在重复依赖：${edge.id}`, true))
    semantics.add(key)
  }
  if (ir.edges.length === 0) errors.push(issue("INSUFFICIENT_EDGES", "结构图至少需要一条依赖边", true))
  for (const [id, count] of degree) {
    if (count === 0) warnings.push(issue("ISOLATED_NODE", `节点 ${id} 在当前模块中没有依赖关系`, false, [], "warning"))
  }

  for (const note of [...ir.assumptions, ...ir.unknowns]) {
    validateReferences(note.evidenceIDs, evidence, errors, "推断或待确认项")
  }
  validateObligations(ir, input.pack, errors)
  return result(input, errors, warnings, errors.length === 0 ? verifiedIR(ir, input.pack) : ir)
}

function production(item: EvidencePack["evidence"][number] | undefined): item is EvidencePack["evidence"][number] {
  return item?.confidence === "explicit" && item.source.sourceKind !== "test"
}

function validateObligations(ir: StructureIR, pack: EvidencePack, errors: ValidationIssue[]) {
  const nodes = new Map(ir.nodes.map((node) => [node.sourceRef, node]))
  for (const obligation of pack.obligations.filter((item) => item.required)) {
    const covered = obligation.evidenceIDs.every((id) => {
      const evidence = pack.evidence.find((item) => item.id === id)
      if (obligation.kind === "file") {
        const ref = typeof evidence?.attributes.ref === "string" ? evidence.attributes.ref : undefined
        return Boolean(ref && nodes.get(ref)?.evidenceIDs.includes(id))
      }
      if (obligation.kind !== "relationship") return false
      const fromRef = typeof evidence?.attributes.from === "string" ? evidence.attributes.from : undefined
      const toRef = typeof evidence?.attributes.to === "string" ? evidence.attributes.to : undefined
      if (!fromRef || !toRef) return false
      const from = nodes.get(fromRef)
      const to = nodes.get(toRef)
      return Boolean(
        from &&
          to &&
          ir.edges.some(
            (edge) =>
              edge.from === from.id &&
              edge.to === to.id &&
              edge.kind === "depends-on" &&
              edge.evidenceIDs.includes(id),
          ),
      )
    })
    if (!covered) {
      errors.push(
        issue(
          "MISSING_REQUIRED_EVIDENCE",
          `必需证据未被 ${obligation.kind} 产物覆盖：${obligation.id}`,
          true,
          obligation.evidenceIDs,
        ),
      )
    }
  }
}

function validateReferences(
  ids: readonly string[],
  evidence: Map<string, EvidencePack["evidence"][number]>,
  errors: ValidationIssue[],
  owner: string,
) {
  if (ids.length === 0) errors.push(issue("EVIDENCE_REQUIRED", `${owner} 缺少 evidenceId`, true))
  for (const id of ids) {
    if (!evidence.has(id))
      errors.push(issue("INVALID_EVIDENCE_ID", `${owner} 引用了无效 evidenceId：${id}`, true, [id]))
  }
}

function verifiedIR(ir: StructureIR, pack: EvidencePack): StructureIR {
  return {
    ...ir,
    title: artifactTitle(pack, "模块结构"),
    summary: `基于源码证据生成，共 ${ir.nodes.length} 个节点、${ir.edges.length} 条依赖。`,
    assumptions: [],
    unknowns: [],
  }
}

function issue(
  code: string,
  message: string,
  retryable: boolean,
  evidenceIDs: readonly string[] = [],
  severity: "error" | "warning" = "error",
): ValidationIssue {
  return { severity, code, message, evidenceIDs: [...evidenceIDs], sourcePaths: [], retryable }
}

function result(
  input: ValidateStructureInput,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  ir?: StructureIR,
): { ir?: StructureIR; report: ValidationReport } {
  return {
    ir,
    report: {
      schemaVersion: 1,
      workItemID: input.pack.workItemID,
      attempt: input.attempt,
      passed: errors.length === 0,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      validatorVersions: { schema: "1", evidence: "1", structure: "1" },
      errors,
      warnings,
      metrics: {
        evidenceCount: input.pack.evidence.length,
        requiredObligationCount: input.pack.obligations.filter((item) => item.required).length,
        errorCount: errors.length,
        warningCount: warnings.length,
      },
      createdAt: Date.now(),
    },
  }
}

export const structureJSONSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "moduleID", "viewType", "title", "summary", "assumptions", "unknowns", "nodes", "edges"],
  properties: {
    schemaVersion: { const: 1 },
    moduleID: { type: "string" },
    viewType: { const: "structure" },
    title: { type: "string" },
    summary: { type: "string" },
    assumptions: { type: "array", items: evidenceNoteSchema() },
    unknowns: { type: "array", items: evidenceNoteSchema() },
    nodes: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "sourceRef", "evidenceIDs"],
        properties: {
          id: { type: "string" },
          kind: { enum: ["source-file", "external-dependency"] },
          sourceRef: { type: "string" },
          evidenceIDs: evidenceIDsSchema(),
        },
      },
    },
    edges: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "from", "to", "kind", "evidenceIDs"],
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          kind: { const: "depends-on" },
          evidenceIDs: evidenceIDsSchema(),
        },
      },
    },
  },
} as const

function evidenceNoteSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["text", "evidenceIDs"],
    properties: { text: { type: "string" }, evidenceIDs: evidenceIDsSchema() },
  } as const
}

function evidenceIDsSchema() {
  return { type: "array", minItems: 1, items: { type: "string" } } as const
}
