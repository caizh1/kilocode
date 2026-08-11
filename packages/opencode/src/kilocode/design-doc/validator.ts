import { Exit, Schema } from "effect"
import {
  AnyCurrentLifecycleState,
  LifecycleIR as LifecycleIRSchema,
  type EvidencePack,
  type LifecycleIR,
  type ValidationIssue,
  type ValidationReport,
} from "./domain"
import { artifactTitle } from "./reader-label"

export interface ValidateLifecycleInput {
  candidate: unknown
  pack: EvidencePack
  attempt: number
  currentSourceSnapshotHash: string
}

export function validateLifecycle(input: ValidateLifecycleInput): {
  ir?: LifecycleIR
  report: ValidationReport
} {
  const errors: ValidationIssue[] = []
  const decoded = Schema.decodeUnknownExit(LifecycleIRSchema)(input.candidate)
  if (Exit.isFailure(decoded)) {
    errors.push(issue("SCHEMA_INVALID", String(decoded.cause), true))
    return result(input, errors)
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已验证候选，克隆只把只读容器转换为校验阶段的可变 IR。
  const ir = normalizeAnyCurrentState(structuredClone(decoded.value) as LifecycleIR)
  if (input.pack.artifactType !== "lifecycle") {
    errors.push(issue("ARTIFACT_TYPE_MISMATCH", "Evidence Pack 不是 lifecycle 类型", false))
  }
  if (input.currentSourceSnapshotHash !== input.pack.sourceSnapshotHash) {
    errors.push(issue("SOURCE_CHANGED", "源码快照在生成期间发生变化", false))
  }
  if (ir.moduleID !== input.pack.moduleID) {
    errors.push(issue("MODULE_MISMATCH", "LifecycleIR moduleID 与 Evidence Pack 不一致", true))
  }

  const evidence = new Map(input.pack.evidence.map((item) => [item.id, item]))
  const states = new Map<string, LifecycleIR["states"][number]>()
  const sourceValues = new Set<string>()
  for (const state of ir.states) {
    if (states.has(state.id)) errors.push(issue("DUPLICATE_STATE_ID", `状态 ID 重复：${state.id}`, true))
    if (sourceValues.has(state.sourceValue)) {
      errors.push(issue("DUPLICATE_SOURCE_STATE", `源码状态值重复映射：${state.sourceValue}`, true))
    }
    states.set(state.id, state)
    sourceValues.add(state.sourceValue)
    validateReferences(state.evidenceIDs, evidence, errors, `状态 ${state.id}`)
    if (state.label !== state.sourceValue) {
      errors.push(issue("STATE_LABEL_MISMATCH", `状态 ${state.id} 的显示标签必须等于源码状态值`, true))
    }
    const provesState = state.evidenceIDs.some((id) => {
      const item = evidence.get(id)
      return (
        item?.confidence === "explicit" &&
        item.source.sourceKind !== "test" &&
        (item.kind === "state-definition" || item.kind === "initial-state") &&
        item.attributes.state === state.sourceValue
      )
    })
    if (!provesState) {
      errors.push(
        issue("UNSUPPORTED_STATE", `状态 ${state.id} 的 sourceValue 没有显式生产源码证据`, true, state.evidenceIDs),
      )
    }
  }
  if (states.size < 2) errors.push(issue("INSUFFICIENT_STATES", "生命周期图至少需要两个状态", true))
  if (!states.has(ir.initialStateID)) {
    errors.push(issue("INITIAL_STATE_MISSING", `初始状态不存在：${ir.initialStateID}`, true))
  } else if (states.get(ir.initialStateID)?.role !== "initial") {
    errors.push(issue("INITIAL_STATE_ROLE_INVALID", "initialStateID 对应状态必须标记为 initial", true))
  }

  const terminal = new Set(ir.terminalStateIDs)
  for (const id of terminal) {
    if (!states.has(id)) errors.push(issue("TERMINAL_STATE_MISSING", `终态不存在：${id}`, true))
    else if (states.get(id)?.role !== "terminal" && states.get(id)?.role !== "error") {
      errors.push(issue("TERMINAL_STATE_ROLE_INVALID", `终态 ${id} 必须标记为 terminal 或 error`, true))
    }
    const state = states.get(id)
    const provesTerminal = state?.evidenceIDs.some((evidenceID) => {
      const item = evidence.get(evidenceID)
      return (
        item?.kind === "terminal-state" &&
        item.confidence === "explicit" &&
        item.source.sourceKind !== "test" &&
        item.attributes.state === state.sourceValue
      )
    })
    if (state && !provesTerminal) {
      errors.push(issue("UNSUPPORTED_TERMINAL_STATE", `终态 ${id} 没有显式生产源码证据`, true, state.evidenceIDs))
    }
  }
  for (const state of states.values()) {
    if ((state.role === "terminal" || state.role === "error") && !terminal.has(state.id)) {
      errors.push(issue("TERMINAL_STATE_NOT_DECLARED", `状态 ${state.id} 未列入 terminalStateIDs`, true))
    }
  }

  const transitionIDs = new Set<string>()
  const degree = new Map([...states.keys()].map((id) => [id, 0]))
  for (const transition of ir.transitions) {
    if (transitionIDs.has(transition.id)) {
      errors.push(issue("DUPLICATE_TRANSITION_ID", `迁移 ID 重复：${transition.id}`, true))
    }
    transitionIDs.add(transition.id)
    const fromAnyState = transition.from === AnyCurrentLifecycleState
    if ((!fromAnyState && !states.has(transition.from)) || !states.has(transition.to)) {
      errors.push(issue("BROKEN_TRANSITION_REFERENCE", `迁移 ${transition.id} 引用了不存在的状态`, true))
      continue
    }
    if (!fromAnyState) degree.set(transition.from, (degree.get(transition.from) ?? 0) + 1)
    degree.set(transition.to, (degree.get(transition.to) ?? 0) + 1)
    validateReferences(transition.evidenceIDs, evidence, errors, `迁移 ${transition.id}`)
    const fromValue = fromAnyState ? AnyCurrentLifecycleState : states.get(transition.from)?.sourceValue
    const toValue = states.get(transition.to)?.sourceValue
    const transitionEvidence = transition.evidenceIDs.flatMap((id) => {
      const item = evidence.get(id)
      return item?.kind === "state-transition" && item.confidence === "explicit" ? [item] : []
    })
    const provesTransition = transitionEvidence.some(
      (item) => item.attributes.from === fromValue && item.attributes.to === toValue,
    )
    if (!provesTransition) {
      errors.push(
        issue(
          "UNSUPPORTED_TRANSITION",
          `迁移 ${transition.id} 没有 from/to 完全一致的显式源码证据`,
          true,
          transition.evidenceIDs,
        ),
      )
    }
    const matchingEvidence = transitionEvidence.filter(
      (item) => item.attributes.from === fromValue && item.attributes.to === toValue,
    )
    if (transition.trigger && !matchingEvidence.some((item) => item.attributes.trigger === transition.trigger)) {
      errors.push(issue("UNSUPPORTED_TRIGGER", `迁移 ${transition.id} 的 trigger 没有源码证据`, true))
    }
    const expectedGuards = matchingEvidence.flatMap((item) =>
      typeof item.attributes.guard === "string" && item.attributes.guard ? [item.attributes.guard] : [],
    )
    const expectedActions = matchingEvidence.flatMap((item) =>
      typeof item.attributes.action === "string" && item.attributes.action ? [item.attributes.action] : [],
    )
    if (transition.guard && !expectedGuards.includes(transition.guard)) {
      errors.push(issue("UNSUPPORTED_TRANSITION_GUARD", `迁移 ${transition.id} 的切换条件没有源码证据`, true))
    }
    if (!transition.guard && expectedGuards.length) {
      errors.push(issue("MISSING_TRANSITION_GUARD", `迁移 ${transition.id} 漏掉源码中的切换条件`, true, transition.evidenceIDs))
    }
    if (transition.action && !expectedActions.includes(transition.action)) {
      errors.push(issue("UNSUPPORTED_TRANSITION_ACTION", `迁移 ${transition.id} 的执行动作没有源码证据`, true))
    }
    if (!transition.action && expectedActions.length) {
      errors.push(issue("MISSING_TRANSITION_ACTION", `迁移 ${transition.id} 漏掉源码中的状态更新动作`, true, transition.evidenceIDs))
    }
  }
  if (ir.transitions.length === 0) errors.push(issue("INSUFFICIENT_TRANSITIONS", "生命周期图至少需要一条迁移", true))
  for (const [id, count] of degree) {
    if (count === 0) errors.push(issue("ISOLATED_STATE", `状态 ${id} 是孤立节点`, true))
  }

  for (const item of [...ir.assumptions, ...ir.unknowns]) {
    validateReferences(item.evidenceIDs, evidence, errors, "推断或待确认项")
  }
  validateObligations(ir, input.pack, errors)

  const duplicate = semanticDuplicates(ir)
  if (duplicate.length) {
    errors.push(issue("DUPLICATE_SEMANTICS", `存在重复语义迁移：${duplicate.join("、")}`, true))
  }

  return result(input, errors, errors.length === 0 ? verifiedIR(ir, input.pack) : ir)
}

function normalizeAnyCurrentState(ir: LifecycleIR): LifecycleIR {
  const aliases = new Set(
    ir.states.filter((state) => state.sourceValue === AnyCurrentLifecycleState).map((state) => state.id),
  )
  if (!aliases.size) return ir
  return {
    ...ir,
    states: ir.states.filter((state) => !aliases.has(state.id)),
    transitions: ir.transitions.map((transition) =>
      aliases.has(transition.from) ? { ...transition, from: AnyCurrentLifecycleState } : transition,
    ),
    terminalStateIDs: ir.terminalStateIDs.filter((id) => !aliases.has(id)),
  }
}

function verifiedIR(ir: LifecycleIR, pack: EvidencePack): LifecycleIR {
  return {
    ...ir,
    title: artifactTitle(pack, "生命周期"),
    summary: `基于源码证据生成，共 ${ir.states.length} 个状态、${ir.transitions.length} 条迁移。`,
    assumptions: [],
    unknowns: [],
    states: ir.states.map(({ description: _description, ...state }) => state),
    transitions: ir.transitions,
  }
}

function validateObligations(ir: LifecycleIR, pack: EvidencePack, errors: ValidationIssue[]) {
  const states = new Map(ir.states.map((state) => [state.sourceValue, state]))
  for (const obligation of pack.obligations.filter((item) => item.required)) {
    const covered = obligation.evidenceIDs.every((id) => {
      const evidence = pack.evidence.find((item) => item.id === id)
      if (obligation.kind === "transition") {
        const fromValue = typeof evidence?.attributes.from === "string" ? evidence.attributes.from : undefined
        const toValue = typeof evidence?.attributes.to === "string" ? evidence.attributes.to : undefined
        const from = fromValue === AnyCurrentLifecycleState ? AnyCurrentLifecycleState : fromValue ? states.get(fromValue) : undefined
        const to = toValue ? states.get(toValue) : undefined
        return Boolean(
          from &&
            to &&
            ir.transitions.some(
              (item) =>
                item.from === (from === AnyCurrentLifecycleState ? AnyCurrentLifecycleState : from.id) &&
                item.to === to.id &&
                item.evidenceIDs.includes(id),
            ),
        )
      }
      if (obligation.kind === "entry") {
        const value = typeof evidence?.attributes.state === "string" ? evidence.attributes.state : undefined
        const state = value ? states.get(value) : undefined
        return Boolean(state && state.id === ir.initialStateID && state.evidenceIDs.includes(id))
      }
      if (obligation.kind === "state") {
        const value = typeof evidence?.attributes.state === "string" ? evidence.attributes.state : undefined
        return Boolean(value && states.get(value)?.evidenceIDs.includes(id))
      }
      return false
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

function semanticDuplicates(ir: LifecycleIR) {
  const seen = new Set<string>()
  const duplicate: string[] = []
  for (const item of ir.transitions) {
    const key = [item.from, item.to, item.trigger ?? "", item.guard ?? "", [...item.evidenceIDs].sort().join(",")].join(
      "\0",
    )
    if (seen.has(key)) duplicate.push(item.id)
    seen.add(key)
  }
  return duplicate
}

function issue(
  code: string,
  message: string,
  retryable: boolean,
  evidenceIDs: readonly string[] = [],
): ValidationIssue {
  return { severity: "error", code, message, evidenceIDs: [...evidenceIDs], sourcePaths: [], retryable }
}

function result(
  input: ValidateLifecycleInput,
  errors: ValidationIssue[],
  ir?: LifecycleIR,
): { ir?: LifecycleIR; report: ValidationReport } {
  return {
    ir,
    report: {
      schemaVersion: 1,
      workItemID: input.pack.workItemID,
      attempt: input.attempt,
      passed: errors.length === 0,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      validatorVersions: { schema: "1", evidence: "1", lifecycle: "1" },
      errors,
      warnings: [],
      metrics: {
        evidenceCount: input.pack.evidence.length,
        requiredObligationCount: input.pack.obligations.filter((item) => item.required).length,
        errorCount: errors.length,
      },
      createdAt: Date.now(),
    },
  }
}

export const lifecycleJSONSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "moduleID",
    "viewType",
    "title",
    "summary",
    "assumptions",
    "unknowns",
    "states",
    "transitions",
    "initialStateID",
    "terminalStateIDs",
  ],
  properties: {
    schemaVersion: { const: 1 },
    moduleID: { type: "string" },
    viewType: { const: "lifecycle" },
    title: { type: "string" },
    summary: { type: "string" },
    assumptions: { type: "array", items: evidenceNoteSchema() },
    unknowns: { type: "array", items: evidenceNoteSchema() },
    states: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "sourceValue", "role", "evidenceIDs"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          sourceValue: { type: "string" },
          description: { type: "string" },
          role: { enum: ["initial", "intermediate", "terminal", "error", "unknown"] },
          evidenceIDs: evidenceIDsSchema(),
        },
      },
    },
    transitions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "from", "to", "evidenceIDs"],
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          trigger: { type: "string" },
          guard: { type: "string" },
          action: { type: "string" },
          evidenceIDs: evidenceIDsSchema(),
        },
      },
    },
    initialStateID: { type: "string" },
    terminalStateIDs: { type: "array", items: { type: "string" } },
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
  return { type: "array", items: { type: "string" } } as const
}
