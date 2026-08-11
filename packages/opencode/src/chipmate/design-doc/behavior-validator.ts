import { Exit, Schema } from "effect"
import {
  DataFlowIR as DataFlowIRSchema,
  ErrorFlowIR as ErrorFlowIRSchema,
  ExecutionFlowIR as ExecutionFlowIRSchema,
  SequenceIR as SequenceIRSchema,
  type DataFlowIR,
  type ErrorFlowIR,
  type Evidence,
  type EvidencePack,
  type ExecutionFlowIR,
  type SequenceIR,
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

export function validateExecutionFlow(input: ValidateInput): { ir?: ExecutionFlowIR; report: ValidationReport } {
  const decoded = Schema.decodeUnknownExit(ExecutionFlowIRSchema)(withExecutionIdentity(input.candidate, input.pack))
  if (Exit.isFailure(decoded)) return invalid(input, "execution-flow", decoded.cause)
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已完成运行时解码。
  const ir = structuredClone(decoded.value) as ExecutionFlowIR
  const errors = common(input, ir.moduleID, "execution-flow")
  const evidence = evidenceMap(input.pack)
  validateGraphIdentity(ir.nodes, ir.edges, errors)
  for (const node of ir.nodes) {
    const proved = node.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return (
        explicit(item) &&
        item.kind === "flow-node" &&
        item.attributes.ref === node.sourceRef &&
        item.attributes.nodeKind === node.kind
      )
    })
    references(node.evidenceIDs, evidence, errors, `节点 ${node.id}`)
    if (!proved) errors.push(issue("UNSUPPORTED_FLOW_NODE", `执行节点 ${node.id} 没有完全匹配的源码证据`, true))
  }
  const nodes = new Map(ir.nodes.map((node) => [node.id, node]))
  for (const edge of ir.edges) {
    if (!edge.label.trim()) errors.push(issue("EDGE_LABEL_REQUIRED", `执行边 ${edge.id} 缺少中文语义`, true))
    references(edge.evidenceIDs, evidence, errors, `边 ${edge.id}`)
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) continue
    const proved = edge.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return (
        explicit(item) &&
        item.kind === "flow-edge" &&
        item.attributes.fromRef === from.sourceRef &&
        item.attributes.toRef === to.sourceRef &&
        item.attributes.edgeKind === edge.kind
      )
    })
    if (!proved) errors.push(issue("UNSUPPORTED_FLOW_EDGE", `执行边 ${edge.id} 没有完全匹配的源码证据`, true))
  }
  exactObligations(input.pack, errors, (item, id) => {
    if (item.kind === "flow-node")
      return ir.nodes.some((node) => node.sourceRef === item.attributes.ref && node.evidenceIDs.includes(id))
    if (item.kind === "flow-edge") {
      return ir.edges.some((edge) => {
        const from = nodes.get(edge.from)
        const to = nodes.get(edge.to)
        return (
          from?.sourceRef === item.attributes.fromRef &&
          to?.sourceRef === item.attributes.toRef &&
          edge.kind === item.attributes.edgeKind &&
          edge.evidenceIDs.includes(id)
        )
      })
    }
    return false
  })
  return finish(input, errors, [], errors.length ? ir : verifyExecution(ir, input.pack))
}

function withExecutionIdentity(candidate: unknown, pack: EvidencePack) {
  if (!isRecord(candidate) || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return candidate
  const evidence = evidenceMap(pack)
  const nodes = candidate.nodes.map((value) => {
    if (!isRecord(value)) return value
    const proved = rawEvidenceIDs(value)
      .map((id) => evidence.get(id))
      .find((item) => explicit(item) && item.kind === "flow-node")
    if (!proved || typeof proved.attributes.ref !== "string" || typeof proved.attributes.nodeKind !== "string")
      return value
    return {
      ...value,
      sourceRef: proved.attributes.ref,
      kind: proved.attributes.nodeKind,
    }
  })
  const nodeByRef = new Map(
    nodes.flatMap((value) =>
      isRecord(value) && typeof value.sourceRef === "string" && typeof value.id === "string"
        ? [[value.sourceRef, value.id] as const]
        : [],
    ),
  )
  const edges = normalizeRelationLabels(candidate.edges, evidence).map((value) => {
    if (!isRecord(value)) return value
    const proved = rawEvidenceIDs(value)
      .map((id) => evidence.get(id))
      .find((item) => explicit(item) && item.kind === "flow-edge")
    if (!proved) return value
    const from = typeof proved.attributes.fromRef === "string" ? nodeByRef.get(proved.attributes.fromRef) : undefined
    const to = typeof proved.attributes.toRef === "string" ? nodeByRef.get(proved.attributes.toRef) : undefined
    return {
      ...value,
      from: from ?? value.from,
      to: to ?? value.to,
      kind: typeof proved.attributes.edgeKind === "string" ? proved.attributes.edgeKind : value.kind,
    }
  })
  return { ...candidate, nodes, edges }
}

function rawEvidenceIDs(value: Record<string, unknown>) {
  return Array.isArray(value.evidenceIDs) ? value.evidenceIDs.filter((id): id is string => typeof id === "string") : []
}

export function validateSequence(input: ValidateInput): { ir?: SequenceIR; report: ValidationReport } {
  const decoded = Schema.decodeUnknownExit(SequenceIRSchema)(input.candidate)
  if (Exit.isFailure(decoded)) return invalid(input, "sequence", decoded.cause)
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已完成运行时解码。
  const ir = structuredClone(decoded.value) as SequenceIR
  const errors = common(input, ir.moduleID, "sequence")
  const evidence = evidenceMap(input.pack)
  const participants = new Map(ir.participants.map((item) => [item.id, item]))
  const refs = new Set<string>()
  for (const participant of ir.participants) {
    if (refs.has(participant.sourceRef))
      errors.push(issue("DUPLICATE_SOURCE_REF", `参与者引用重复：${participant.sourceRef}`, true))
    refs.add(participant.sourceRef)
    references(participant.evidenceIDs, evidence, errors, `参与者 ${participant.id}`)
    const proved = participant.evidenceIDs.some((id) =>
      participantEvidence(evidence.get(id), participant.sourceRef, participant.kind),
    )
    if (!proved) errors.push(issue("UNSUPPORTED_PARTICIPANT", `参与者 ${participant.id} 没有匹配证据`, true))
  }
  const messageIDs = new Set<string>()
  for (const message of ir.messages) {
    if (messageIDs.has(message.id)) errors.push(issue("DUPLICATE_MESSAGE_ID", `消息 ID 重复：${message.id}`, true))
    messageIDs.add(message.id)
    const from = participants.get(message.from)
    const to = participants.get(message.to)
    if (!from || !to) {
      errors.push(issue("BROKEN_MESSAGE_REFERENCE", `消息 ${message.id} 引用了不存在的参与者`, true))
      continue
    }
    references(message.evidenceIDs, evidence, errors, `消息 ${message.id}`)
    const proved = message.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return callMessageEvidence(item, from.sourceRef, to.sourceRef) && message.kind === "call"
    })
    if (!proved) errors.push(issue("UNSUPPORTED_MESSAGE", `消息 ${message.id} 没有完全匹配的调用证据`, true))
  }
  if (ir.participants.length < 2) errors.push(issue("INSUFFICIENT_PARTICIPANTS", "时序图至少需要两个参与者", true))
  if (!ir.messages.length) errors.push(issue("INSUFFICIENT_MESSAGES", "时序图至少需要一条消息", true))
  exactObligations(input.pack, errors, (item, id) => {
    if (item.kind === "flow-node")
      return ir.participants.some(
        (part) => part.sourceRef === item.attributes.ownerRef && part.evidenceIDs.includes(id),
      )
    if (item.kind === "call-message") {
      return ir.messages.some((message) => {
        const from = participants.get(message.from)
        const to = participants.get(message.to)
        return (
          from?.sourceRef === item.attributes.fromRef &&
          to?.sourceRef === item.attributes.toRef &&
          message.evidenceIDs.includes(id)
        )
      })
    }
    return false
  })
  return finish(input, errors, [], errors.length ? ir : verifySequence(ir, input.pack))
}

export function validateDataFlow(input: ValidateInput): { ir?: DataFlowIR; report: ValidationReport } {
  const aligned = isTopicAlignedDataFlow(input.pack)
  const decoded = Schema.decodeUnknownExit(DataFlowIRSchema)(withDataIdentity(input.candidate, input.pack))
  if (Exit.isFailure(decoded)) return invalid(input, "data-flow", decoded.cause)
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已完成运行时解码。
  const ir = structuredClone(decoded.value) as DataFlowIR
  const errors = common(input, ir.moduleID, "data-flow")
  const evidence = evidenceMap(input.pack)
  const entities = new Map(ir.entities.map((item) => [item.id, item]))
  const refs = new Set<string>()
  for (const entity of ir.entities) {
    if (refs.has(entity.sourceRef))
      errors.push(issue("DUPLICATE_SOURCE_REF", `数据实体引用重复：${entity.sourceRef}`, true))
    refs.add(entity.sourceRef)
    references(entity.evidenceIDs, evidence, errors, `数据实体 ${entity.id}`)
    const proved = entity.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      if (aligned) return topicEntityEvidence(item, entity.sourceRef, entity.kind, input.pack)
      return (
        explicit(item) &&
        item.kind === "data-entity" &&
        item.attributes.ref === entity.sourceRef &&
        item.attributes.entityKind === entity.kind
      )
    })
    if (!proved) errors.push(issue("UNSUPPORTED_DATA_ENTITY", `数据实体 ${entity.id} 没有完全匹配的源码证据`, true))
  }
  for (const flow of ir.flows) {
    if (!flow.label.trim()) errors.push(issue("EDGE_LABEL_REQUIRED", `数据流 ${flow.id} 缺少中文语义`, true))
    const from = entities.get(flow.from)
    const to = entities.get(flow.to)
    if (!from || !to) {
      errors.push(issue("BROKEN_DATA_FLOW_REFERENCE", `数据流 ${flow.id} 引用了不存在的数据实体`, true))
      continue
    }
    references(flow.evidenceIDs, evidence, errors, `数据流 ${flow.id}`)
    const proved = flow.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      const exact =
        explicit(item) &&
        item.kind === "data-flow" &&
        item.attributes.fromRef === from.sourceRef &&
        item.attributes.toRef === to.sourceRef &&
        item.attributes.flowKind === flow.kind
      if (aligned) return exact || (explicit(item) && topicClaimForEvidence(input.pack, id))
      return exact
    })
    if (!proved) errors.push(issue("UNSUPPORTED_DATA_FLOW", `数据流 ${flow.id} 没有完全匹配的源码证据`, true))
  }
  if (ir.entities.length < 2) errors.push(issue("INSUFFICIENT_DATA_ENTITIES", "数据流图至少需要两个实体", true))
  if (!ir.flows.length) errors.push(issue("INSUFFICIENT_DATA_FLOWS", "数据流图至少需要一条数据流", true))
  if (aligned) validateTopicFlowCoverage(ir, input.pack, errors)
  else {
    exactObligations(input.pack, errors, (item, id) => {
      if (item.kind === "data-entity")
        return ir.entities.some((entity) => entity.sourceRef === item.attributes.ref && entity.evidenceIDs.includes(id))
      if (item.kind === "data-flow")
        return ir.flows.some((flow) => {
          const from = entities.get(flow.from)
          const to = entities.get(flow.to)
          return (
            from?.sourceRef === item.attributes.fromRef &&
            to?.sourceRef === item.attributes.toRef &&
            flow.evidenceIDs.includes(id)
          )
        })
      return false
    })
  }
  return finish(input, errors, [], errors.length ? ir : verifyData(ir, input.pack))
}

function withDataIdentity(candidate: unknown, pack: EvidencePack) {
  if (!isRecord(candidate) || !Array.isArray(candidate.entities) || !Array.isArray(candidate.flows)) return candidate
  const evidence = evidenceMap(pack)
  const dataEntities = pack.evidence.filter(
    (item) =>
      explicit(item) &&
      item.kind === "data-entity" &&
      typeof item.attributes.ref === "string" &&
      typeof item.attributes.entityKind === "string",
  )
  const entities = candidate.entities.map((value) => {
    if (!isRecord(value)) return value
    const proved =
      rawEvidenceIDs(value)
        .map((id) => evidence.get(id))
        .find((item) => explicit(item) && item.kind === "data-entity") ??
      dataEntities.find((item) => item.attributes.ref === value.sourceRef)
    if (!proved || typeof proved.attributes.ref !== "string" || typeof proved.attributes.entityKind !== "string")
      return value
    return {
      ...value,
      sourceRef: proved.attributes.ref,
      kind: proved.attributes.entityKind,
      evidenceIDs: [proved.id],
    }
  })
  const entityRefByID = new Map(
    entities.flatMap((value) =>
      isRecord(value) && typeof value.sourceRef === "string" && typeof value.id === "string"
        ? [[value.id, value.sourceRef] as const]
        : [],
    ),
  )
  const entityByRef = new Map(
    entities.flatMap((value) =>
      isRecord(value) && typeof value.sourceRef === "string" && typeof value.id === "string"
        ? [[value.sourceRef, value.id] as const]
        : [],
    ),
  )
  const flows = normalizeRelationLabels(candidate.flows, evidence).map((value) => {
    if (!isRecord(value)) return value
    const candidateFrom = typeof value.from === "string" ? entityRefByID.get(value.from) : undefined
    const candidateTo = typeof value.to === "string" ? entityRefByID.get(value.to) : undefined
    const proved =
      rawEvidenceIDs(value)
        .map((id) => evidence.get(id))
        .find((item) => explicit(item) && item.kind === "data-flow") ??
      pack.evidence.find(
        (item) =>
          explicit(item) &&
          item.kind === "data-flow" &&
          item.attributes.fromRef === candidateFrom &&
          item.attributes.toRef === candidateTo &&
          (typeof value.kind !== "string" || item.attributes.flowKind === value.kind),
      )
    if (!proved) return value
    const from = typeof proved.attributes.fromRef === "string" ? entityByRef.get(proved.attributes.fromRef) : undefined
    const to = typeof proved.attributes.toRef === "string" ? entityByRef.get(proved.attributes.toRef) : undefined
    return {
      ...value,
      from: from ?? value.from,
      to: to ?? value.to,
      kind: typeof proved.attributes.flowKind === "string" ? proved.attributes.flowKind : value.kind,
      evidenceIDs: [proved.id],
    }
  })
  return { ...candidate, entities, flows }
}

function isTopicAlignedDataFlow(pack: EvidencePack) {
  return (
    pack.artifactType === "data-flow" &&
    pack.purpose?.kind === "diagram" &&
    pack.purpose.topic === "data-persistence" &&
    Boolean(pack.topicClaims?.length)
  )
}

function topicEntityEvidence(
  item: Evidence | undefined,
  sourceRef: string,
  kind: DataFlowIR["entities"][number]["kind"],
  pack: EvidencePack,
) {
  if (!explicit(item)) return false
  if (item.kind === "data-entity" && item.attributes.ref === sourceRef && item.attributes.entityKind === kind)
    return true
  if (kind === "external" && sourceRef.startsWith("external:")) return topicClaimForEvidence(pack, item.id)
  return [item.attributes.ref, item.attributes.ownerRef, item.source.symbol].includes(sourceRef)
}

function topicClaimForEvidence(pack: EvidencePack, evidenceID: string) {
  return pack.topicClaims?.some((claim) => claim.evidenceIDs.includes(evidenceID)) ?? false
}

function validateTopicFlowCoverage(ir: DataFlowIR, pack: EvidencePack, errors: ValidationIssue[]) {
  const covered = new Set([
    ...ir.entities.flatMap((item) => item.evidenceIDs),
    ...ir.flows.flatMap((item) => item.evidenceIDs),
    ...ir.assumptions.flatMap((item) => item.evidenceIDs),
    ...ir.unknowns.flatMap((item) => item.evidenceIDs),
  ])
  for (const claim of pack.topicClaims ?? []) {
    if (!claim.evidenceIDs.every((id) => covered.has(id))) {
      errors.push(
        issue("MISSING_TOPIC_FLOW_EVIDENCE", `章节流程未被图完整覆盖：${claim.text}`, true, claim.evidenceIDs),
      )
    }
    if (!ir.flows.some((flow) => flow.evidenceIDs.some((id) => claim.evidenceIDs.includes(id)))) {
      errors.push(issue("MISSING_TOPIC_FLOW_EDGE", `章节流程没有对应图中关系：${claim.text}`, true, claim.evidenceIDs))
    }
  }
  const boundaryRequired = (pack.topicClaims ?? []).some((claim) =>
    /不在|模块外|外部|无法证明|不能证明|非易失|持久化本身/u.test(claim.text),
  )
  if (
    boundaryRequired &&
    !ir.entities.some((entity) => entity.kind === "external") &&
    !ir.unknowns.some((item) => /边界|模块外|外部|无法证明|不能证明|非易失|持久化/u.test(item.text))
  ) {
    errors.push(
      issue("PERSISTENCE_BOUNDARY_REQUIRED", "章节说明了模块外或无法证明的持久化边界，图中必须明确展示该边界", true),
    )
  }
}

export function validateErrorFlow(input: ValidateInput): { ir?: ErrorFlowIR; report: ValidationReport } {
  const decoded = Schema.decodeUnknownExit(ErrorFlowIRSchema)(withRelationLabels(input.candidate, input.pack, "edges"))
  if (Exit.isFailure(decoded)) return invalid(input, "error-flow", decoded.cause)
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已完成运行时解码。
  const ir = structuredClone(decoded.value) as ErrorFlowIR
  const errors = common(input, ir.moduleID, "error-flow")
  const evidence = evidenceMap(input.pack)
  const nodes = new Map(ir.nodes.map((item) => [item.id, item]))
  for (const node of ir.nodes) {
    references(node.evidenceIDs, evidence, errors, `异常节点 ${node.id}`)
    const proved = node.evidenceIDs.some((id) => errorNodeEvidence(evidence.get(id), node.sourceRef, node.kind))
    if (!proved) errors.push(issue("UNSUPPORTED_ERROR_NODE", `异常节点 ${node.id} 没有完全匹配的源码证据`, true))
  }
  for (const edge of ir.edges) {
    if (!edge.label.trim()) errors.push(issue("EDGE_LABEL_REQUIRED", `异常边 ${edge.id} 缺少中文语义`, true))
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) {
      errors.push(issue("BROKEN_ERROR_EDGE_REFERENCE", `异常边 ${edge.id} 引用了不存在的节点`, true))
      continue
    }
    references(edge.evidenceIDs, evidence, errors, `异常边 ${edge.id}`)
    const proved = edge.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return (
        explicit(item) &&
        item.kind === "error-edge" &&
        item.attributes.fromRef === from.sourceRef &&
        item.attributes.toRef === to.sourceRef &&
        item.attributes.edgeKind === edge.kind
      )
    })
    if (!proved) errors.push(issue("UNSUPPORTED_ERROR_EDGE", `异常边 ${edge.id} 没有完全匹配的源码证据`, true))
  }
  if (ir.nodes.length < 2 || !ir.edges.length)
    errors.push(issue("INSUFFICIENT_ERROR_FLOW", "异常流至少需要两个节点和一条边", true))
  exactObligations(input.pack, errors, (item, id) => {
    if (item.kind === "flow-node" || item.kind === "error-node")
      return ir.nodes.some((node) => node.sourceRef === item.attributes.ref && node.evidenceIDs.includes(id))
    if (item.kind === "error-edge")
      return ir.edges.some((edge) => {
        const from = nodes.get(edge.from)
        const to = nodes.get(edge.to)
        return (
          from?.sourceRef === item.attributes.fromRef &&
          to?.sourceRef === item.attributes.toRef &&
          edge.kind === item.attributes.edgeKind &&
          edge.evidenceIDs.includes(id)
        )
      })
    return false
  })
  return finish(input, errors, [], errors.length ? ir : verifyError(ir, input.pack))
}

function participantEvidence(
  item: Evidence | undefined,
  sourceRef: string,
  kind: SequenceIR["participants"][number]["kind"],
) {
  if (!explicit(item)) return false
  if (kind === "internal")
    return item.kind === "flow-node" && item.attributes.nodeKind === "entry" && item.attributes.ownerRef === sourceRef
  return item.kind === "call-message" && item.attributes.toRef === sourceRef && sourceRef.startsWith("external:")
}

function callMessageEvidence(item: Evidence | undefined, fromRef: string, toRef: string) {
  return (
    explicit(item) &&
    item.kind === "call-message" &&
    item.attributes.fromRef === fromRef &&
    item.attributes.toRef === toRef
  )
}

function errorNodeEvidence(item: Evidence | undefined, sourceRef: string, kind: ErrorFlowIR["nodes"][number]["kind"]) {
  if (!explicit(item)) return false
  if (kind === "entry")
    return item.kind === "flow-node" && item.attributes.ref === sourceRef && item.attributes.nodeKind === "entry"
  return item.kind === "error-node" && item.attributes.ref === sourceRef && item.attributes.nodeKind === kind
}

function validateGraphIdentity(
  nodes: ExecutionFlowIR["nodes"],
  edges: ExecutionFlowIR["edges"],
  errors: ValidationIssue[],
) {
  const nodeIDs = new Set<string>()
  const refs = new Set<string>()
  for (const node of nodes) {
    if (nodeIDs.has(node.id)) errors.push(issue("DUPLICATE_NODE_ID", `节点 ID 重复：${node.id}`, true))
    if (refs.has(node.sourceRef)) errors.push(issue("DUPLICATE_SOURCE_REF", `源码引用重复：${node.sourceRef}`, true))
    nodeIDs.add(node.id)
    refs.add(node.sourceRef)
  }
  const edgeIDs = new Set<string>()
  for (const edge of edges) {
    if (edgeIDs.has(edge.id)) errors.push(issue("DUPLICATE_EDGE_ID", `边 ID 重复：${edge.id}`, true))
    edgeIDs.add(edge.id)
    if (!nodeIDs.has(edge.from) || !nodeIDs.has(edge.to))
      errors.push(issue("BROKEN_EDGE_REFERENCE", `边 ${edge.id} 引用了不存在的节点`, true))
  }
  if (nodes.length < 2 || !edges.length) errors.push(issue("INSUFFICIENT_FLOW", "执行流至少需要两个节点和一条边", true))
}

function exactObligations(
  pack: EvidencePack,
  errors: ValidationIssue[],
  covered: (item: Evidence, id: string) => boolean,
) {
  const evidence = evidenceMap(pack)
  for (const obligation of pack.obligations.filter((item) => item.required)) {
    const complete = obligation.evidenceIDs.every((id) => {
      const item = evidence.get(id)
      return item ? covered(item, id) : false
    })
    if (!complete)
      errors.push(
        issue("MISSING_REQUIRED_EVIDENCE", `必需证据未被产物精确覆盖：${obligation.id}`, true, obligation.evidenceIDs),
      )
  }
}

function common(input: ValidateInput, moduleID: string, artifactType: EvidencePack["artifactType"]) {
  const errors: ValidationIssue[] = []
  if (input.pack.artifactType !== artifactType)
    errors.push(issue("ARTIFACT_TYPE_MISMATCH", `Evidence Pack 不是 ${artifactType} 类型`, false))
  if (input.currentSourceSnapshotHash !== input.pack.sourceSnapshotHash)
    errors.push(issue("SOURCE_CHANGED", "源码快照在生成期间发生变化", false))
  if (moduleID !== input.pack.moduleID)
    errors.push(issue("MODULE_MISMATCH", "IR moduleID 与 Evidence Pack 不一致", true))
  return errors
}

function evidenceMap(pack: EvidencePack) {
  return new Map(pack.evidence.map((item) => [item.id, item]))
}

function references(ids: readonly string[], evidence: Map<string, Evidence>, errors: ValidationIssue[], owner: string) {
  if (!ids.length) errors.push(issue("EVIDENCE_REQUIRED", `${owner} 缺少 evidenceId`, true))
  for (const id of ids)
    if (!evidence.has(id))
      errors.push(issue("INVALID_EVIDENCE_ID", `${owner} 引用了无效 evidenceId：${id}`, true, [id]))
}

function explicit(item: Evidence | undefined): item is Evidence {
  return item?.confidence === "explicit" && item.source.sourceKind !== "test"
}

function invalid(input: ValidateInput, name: string, cause: unknown): { report: ValidationReport } {
  return finish<never>(input, [issue("SCHEMA_INVALID", `${name}: ${String(cause)}`, true)], [])
}

function finish<T>(
  input: ValidateInput,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  ir?: T,
): { ir?: T; report: ValidationReport } {
  return {
    ir,
    report: {
      schemaVersion: 1,
      workItemID: input.pack.workItemID,
      attempt: input.attempt,
      passed: errors.length === 0,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      validatorVersions: { schema: "1", evidence: "1", behavior: "1" },
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

function verifyExecution(ir: ExecutionFlowIR, pack: EvidencePack): ExecutionFlowIR {
  const evidence = evidenceMap(pack)
  const nodes = ir.nodes.map((node) =>
    normalizeNodeLabel(
      node,
      evidence,
      (item) =>
        explicit(item) &&
        item.kind === "flow-node" &&
        item.attributes.ref === node.sourceRef &&
        item.attributes.nodeKind === node.kind,
    ),
  )
  return {
    ...ir,
    nodes,
    edges: normalizeRelationLabels(ir.edges, evidence),
    title: artifactTitle(pack, "执行流程"),
    summary: `基于源码证据生成，共 ${ir.nodes.length} 个步骤、${ir.edges.length} 条控制流。`,
    assumptions: [],
    unknowns: [],
  }
}

function verifySequence(ir: SequenceIR, pack: EvidencePack): SequenceIR {
  const evidence = evidenceMap(pack)
  const participants = ir.participants.map((participant) => {
    const item = participant.evidenceIDs
      .map((id) => evidence.get(id))
      .find((candidate) => participantEvidence(candidate, participant.sourceRef, participant.kind))
    const label = item?.attributes.label
    return { ...participant, label: typeof label === "string" ? label : participant.label }
  })
  const byID = new Map(participants.map((participant) => [participant.id, participant]))
  const messages = ir.messages.map((message) => {
    const from = byID.get(message.from)
    const to = byID.get(message.to)
    const item = message.evidenceIDs
      .map((id) => evidence.get(id))
      .find((candidate) => from && to && callMessageEvidence(candidate, from.sourceRef, to.sourceRef))
    const label = item?.attributes.label
    return { ...message, label: typeof label === "string" ? label : message.label }
  })
  return {
    ...ir,
    participants,
    messages,
    title: artifactTitle(pack, "调用时序"),
    summary: `基于源码证据生成，共 ${ir.participants.length} 个参与者、${ir.messages.length} 条消息。`,
    assumptions: [],
    unknowns: [],
  }
}

function verifyData(ir: DataFlowIR, pack: EvidencePack): DataFlowIR {
  if (isTopicAlignedDataFlow(pack)) {
    return {
      ...ir,
      title: artifactTitle(pack, "数据流转与持久化边界图"),
      summary: ir.summary,
      assumptions: [],
      unknowns: [],
    }
  }
  const evidence = evidenceMap(pack)
  const entities = ir.entities.map((entity) =>
    normalizeNodeLabel(
      entity,
      evidence,
      (item) =>
        explicit(item) &&
        item.kind === "data-entity" &&
        item.attributes.ref === entity.sourceRef &&
        item.attributes.entityKind === entity.kind,
    ),
  )
  return {
    ...ir,
    entities,
    flows: normalizeRelationLabels(ir.flows, evidence),
    title: artifactTitle(pack, "数据流"),
    summary: `基于源码证据生成，共 ${ir.entities.length} 个数据实体、${ir.flows.length} 条数据流。`,
    assumptions: [],
    unknowns: [],
  }
}

function verifyError(ir: ErrorFlowIR, pack: EvidencePack): ErrorFlowIR {
  const evidence = evidenceMap(pack)
  const nodes = ir.nodes.map((node) =>
    normalizeNodeLabel(node, evidence, (item) => errorNodeEvidence(item, node.sourceRef, node.kind)),
  )
  return {
    ...ir,
    nodes,
    edges: normalizeRelationLabels(ir.edges, evidence),
    title: artifactTitle(pack, "异常流程"),
    summary: `基于源码证据生成，共 ${ir.nodes.length} 个异常节点、${ir.edges.length} 条异常路径。`,
    assumptions: [],
    unknowns: [],
  }
}

function withRelationLabels(candidate: unknown, pack: EvidencePack, key: "edges" | "flows") {
  if (!isRecord(candidate) || !Array.isArray(candidate[key])) return candidate
  const evidence = evidenceMap(pack)
  return { ...candidate, [key]: normalizeRelationLabels(candidate[key], evidence) }
}

function normalizeRelationLabels<T extends { kind?: unknown; label?: unknown; evidenceIDs?: unknown }>(
  relations: readonly T[],
  evidence: Map<string, Evidence>,
) {
  const defaults: Record<string, string> = {
    next: "顺序执行",
    "branch-true": "条件成立",
    "branch-false": "条件不成立",
    loop: "继续循环",
    return: "返回结果",
    error: "触发异常",
    handle: "进入异常处理",
    retry: "执行重试",
    fallback: "执行降级",
    terminate: "终止处理",
    read: "读取数据",
    write: "写入数据",
    transfer: "传递数据",
  }
  return relations.map((relation) => {
    const ids = Array.isArray(relation.evidenceIDs)
      ? relation.evidenceIDs.filter((id): id is string => typeof id === "string")
      : []
    const proved = ids.map((id) => evidence.get(id)).find((item) => typeof item?.attributes.label === "string")
    const label =
      typeof proved?.attributes.label === "string"
        ? proved.attributes.label
        : typeof relation.label === "string" && relation.label.trim()
          ? relation.label
          : (defaults[String(relation.kind)] ?? "传递控制")
    return { ...relation, label }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeNodeLabel<T extends { label: string; evidenceIDs: readonly string[] }>(
  node: T,
  evidence: Map<string, Evidence>,
  matches: (item: Evidence | undefined) => boolean,
) {
  const item = node.evidenceIDs.map((id) => evidence.get(id)).find(matches)
  const label = item?.attributes.label
  return { ...node, label: typeof label === "string" ? label : node.label }
}

function issue(
  code: string,
  message: string,
  retryable: boolean,
  evidenceIDs: readonly string[] = [],
): ValidationIssue {
  return { severity: "error", code, message, evidenceIDs: [...evidenceIDs], sourcePaths: [], retryable }
}

const notes = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["text", "evidenceIDs"],
    properties: { text: { type: "string" }, evidenceIDs: ids() },
  },
} as const
const base = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "moduleID", "viewType", "title", "summary", "assumptions", "unknowns"],
  properties: {
    schemaVersion: { const: 1 },
    moduleID: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    assumptions: notes,
    unknowns: notes,
  },
} as const

export const executionFlowJSONSchema = graphSchema(
  "execution-flow",
  "nodes",
  ["entry", "action", "decision", "exit", "error"],
  "edges",
  ["next", "branch-true", "branch-false", "loop", "return", "error"],
)
export const errorFlowJSONSchema = graphSchema(
  "error-flow",
  "nodes",
  ["entry", "raise", "handler", "retry", "fallback", "terminal"],
  "edges",
  ["error", "handle", "retry", "fallback", "terminate"],
)
export const sequenceJSONSchema = relationSchema(
  "sequence",
  "participants",
  ["internal", "external"],
  "messages",
  ["call", "return", "event"],
  "label",
)
export const dataFlowJSONSchema = relationSchema(
  "data-flow",
  "entities",
  ["input", "output", "variable", "value", "store", "external"],
  "flows",
  ["read", "write", "return", "transfer"],
)

function graphSchema(viewType: string, nodeKey: string, nodeKinds: string[], edgeKey: string, edgeKinds: string[]) {
  return relationSchema(viewType, nodeKey, nodeKinds, edgeKey, edgeKinds, "label")
}

function relationSchema(
  viewType: string,
  nodeKey: string,
  nodeKinds: string[],
  edgeKey: string,
  edgeKinds: string[],
  edgeLabel = "label",
) {
  const edgeRequired = ["id", "from", "to", "kind", "evidenceIDs", edgeLabel]
  return {
    ...base,
    required: [...base.required, nodeKey, edgeKey],
    properties: {
      ...base.properties,
      viewType: { const: viewType },
      [nodeKey]: {
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
            evidenceIDs: ids(),
          },
        },
      },
      [edgeKey]: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: edgeRequired,
          properties: {
            id: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            kind: { enum: edgeKinds },
            [edgeLabel]: { type: "string" },
            evidenceIDs: ids(),
          },
        },
      },
    },
  } as const
}

function ids() {
  return { type: "array", minItems: 1, items: { type: "string" } } as const
}
