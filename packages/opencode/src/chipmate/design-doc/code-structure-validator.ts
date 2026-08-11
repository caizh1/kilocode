import { Exit, Schema } from "effect"
import {
  CodeStructureIR as CodeStructureIRSchema,
  type CodeStructureIR,
  type EvidencePack,
  type ValidationIssue,
  type ValidationReport,
} from "./domain"
import { artifactTitle } from "./reader-label"

export interface ValidateCodeStructureInput {
  candidate: unknown
  pack: EvidencePack
  attempt: number
  currentSourceSnapshotHash: string
}

export function validateCodeStructure(input: ValidateCodeStructureInput): {
  ir?: CodeStructureIR
  report: ValidationReport
} {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const decoded = Schema.decodeUnknownExit(CodeStructureIRSchema)(input.candidate)
  if (Exit.isFailure(decoded)) {
    errors.push(issue("SCHEMA_INVALID", String(decoded.cause), true))
    return result(input, errors, warnings)
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已验证候选，克隆只把只读容器转换为校验阶段的可变 IR。
  const ir = structuredClone(decoded.value) as CodeStructureIR
  if (input.pack.artifactType !== "code-structure") {
    errors.push(issue("ARTIFACT_TYPE_MISMATCH", "Evidence Pack 不是 code-structure 类型", false))
  }
  if (input.currentSourceSnapshotHash !== input.pack.sourceSnapshotHash) {
    errors.push(issue("SOURCE_CHANGED", "源码快照在生成期间发生变化", false))
  }
  if (ir.moduleID !== input.pack.moduleID) {
    errors.push(issue("MODULE_MISMATCH", "CodeStructureIR moduleID 与 Evidence Pack 不一致", true))
  }

  const evidence = new Map(input.pack.evidence.map((item) => [item.id, item]))
  const nodes = new Map<string, CodeStructureIR["nodes"][number]>()
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
      if (!proved) errors.push(issue("UNSUPPORTED_SOURCE_FILE", `文件节点 ${node.id} 没有匹配证据`, true))
      continue
    }
    const proved = node.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return (
        production(item) &&
        item.kind === "code-symbol" &&
        item.attributes.ref === node.sourceRef &&
        item.attributes.symbolKind === node.kind
      )
    })
    if (!proved) errors.push(issue("UNSUPPORTED_CODE_SYMBOL", `代码符号 ${node.id} 没有完全匹配的生产源码证据`, true))
  }
  if (nodes.size < 2) errors.push(issue("INSUFFICIENT_NODES", "代码结构图至少需要文件和一个代码符号", true))

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
        item.kind === "code-symbol" &&
        item.attributes.parentRef === from.sourceRef &&
        item.attributes.ref === to.sourceRef
      )
    })
    if (!proved) errors.push(issue("UNSUPPORTED_CONTAINMENT", `包含边 ${edge.id} 没有完全匹配的源码证据`, true))
    const key = `${from.sourceRef}\0${to.sourceRef}`
    if (semantics.has(key)) errors.push(issue("DUPLICATE_SEMANTICS", `存在重复包含关系：${edge.id}`, true))
    semantics.add(key)
  }
  if (ir.edges.length === 0) errors.push(issue("INSUFFICIENT_EDGES", "代码结构图至少需要一条包含关系", true))
  for (const [id, count] of degree) {
    if (count === 0) warnings.push(issue("ISOLATED_NODE", `节点 ${id} 没有包含关系`, false, [], "warning"))
  }

  for (const note of [...ir.assumptions, ...ir.unknowns]) {
    validateReferences(note.evidenceIDs, evidence, errors, "推断或待确认项")
  }
  validateObligations(ir, input.pack, errors)
  return result(input, errors, warnings, errors.length === 0 ? verifiedIR(ir, input.pack) : ir)
}

function validateObligations(ir: CodeStructureIR, pack: EvidencePack, errors: ValidationIssue[]) {
  const nodes = new Map(ir.nodes.map((node) => [node.sourceRef, node]))
  for (const obligation of pack.obligations.filter((item) => item.required)) {
    const covered = obligation.evidenceIDs.every((id) => {
      const evidence = pack.evidence.find((item) => item.id === id)
      const ref = typeof evidence?.attributes.ref === "string" ? evidence.attributes.ref : undefined
      if (!ref) return false
      const node = nodes.get(ref)
      if (!node?.evidenceIDs.includes(id)) return false
      if (obligation.kind !== "symbol") return true
      const parentRef =
        typeof evidence?.attributes.parentRef === "string" ? evidence.attributes.parentRef : undefined
      if (!parentRef) return false
      const parent = nodes.get(parentRef)
      return Boolean(
        parent &&
          ir.edges.some(
            (edge) =>
              edge.from === parent.id && edge.to === node.id && edge.kind === "contains" && edge.evidenceIDs.includes(id),
          ),
      )
    })
    if (!covered) {
      errors.push(
        issue(
          "MISSING_REQUIRED_EVIDENCE",
          `必需证据未被 ${obligation.kind} 产物完整覆盖：${obligation.id}`,
          true,
          obligation.evidenceIDs,
        ),
      )
    }
  }
}

function production(item: EvidencePack["evidence"][number] | undefined): item is EvidencePack["evidence"][number] {
  return item?.confidence === "explicit" && item.source.sourceKind !== "test"
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

function verifiedIR(ir: CodeStructureIR, pack: EvidencePack): CodeStructureIR {
  const evidence = new Map(pack.evidence.map((item) => [item.id, item]))
  return {
    ...ir,
    title: artifactTitle(pack, "代码结构"),
    summary: `基于源码证据生成，共 ${ir.nodes.length} 个节点、${ir.edges.length} 条包含关系。`,
    assumptions: [],
    unknowns: [],
    nodes: ir.nodes.map((node) => {
      const source = node.evidenceIDs.map((id) => evidence.get(id)).find((item) => {
        if (!production(item)) return false
        if (node.kind === "source-file") return item.kind === "source-file" && item.attributes.ref === node.sourceRef
        return item.kind === "code-symbol" && item.attributes.ref === node.sourceRef && item.attributes.symbolKind === node.kind
      })
      if (!source) return node
      const label = node.kind === "source-file"
        ? node.sourceRef.split("/").at(-1) ?? node.sourceRef
        : String(source.attributes.name)
      return { ...node, label }
    }),
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
  input: ValidateCodeStructureInput,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  ir?: CodeStructureIR,
): { ir?: CodeStructureIR; report: ValidationReport } {
  return {
    ir,
    report: {
      schemaVersion: 1,
      workItemID: input.pack.workItemID,
      attempt: input.attempt,
      passed: errors.length === 0,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      validatorVersions: { schema: "1", evidence: "1", codeStructure: "1" },
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

const nodeKinds = [
  "source-file",
  "class",
  "interface",
  "type",
  "enum",
  "struct",
  "union",
  "namespace",
  "function",
  "method",
] as const

export const codeStructureJSONSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "moduleID", "viewType", "title", "summary", "assumptions", "unknowns", "nodes", "edges"],
  properties: {
    schemaVersion: { const: 1 },
    moduleID: { type: "string" },
    viewType: { const: "code-structure" },
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
        required: ["id", "kind", "sourceRef", "label", "evidenceIDs"],
        properties: {
          id: { type: "string" },
          kind: { enum: nodeKinds },
          sourceRef: { type: "string" },
          label: { type: "string" },
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
          kind: { const: "contains" },
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
