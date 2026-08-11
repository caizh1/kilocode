import { Exit, Schema } from "effect"
import {
  DesignTopicIR as DesignTopicIRSchema,
  type DesignTopicIR,
  type Evidence,
  type EvidencePack,
  type ValidationIssue,
  type ValidationReport,
} from "./domain"
import { canonicalizeTopicIR } from "./topic-canonicalizer"

interface ValidateTopicInput {
  candidate: unknown
  pack: EvidencePack
  attempt: number
  currentSourceSnapshotHash: string
}

export function validateTopic(input: ValidateTopicInput): { ir?: DesignTopicIR; report: ValidationReport } {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const candidate =
    input.candidate && typeof input.candidate === "object" && !Array.isArray(input.candidate)
      ? {
          ...input.candidate,
          moduleID: input.pack.moduleID,
          ...(input.pack.purpose?.kind === "topic" ? { topic: input.pack.purpose.topic } : {}),
        }
      : input.candidate
  const decoded = Schema.decodeUnknownExit(DesignTopicIRSchema)(candidate)
  if (Exit.isFailure(decoded)) {
    errors.push(issue("SCHEMA_INVALID", String(decoded.cause), true))
    return result(input, errors, undefined, warnings)
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已完成运行时解码。
  const ir = structuredClone(decoded.value) as DesignTopicIR
  if (input.pack.artifactType !== "topic" || input.pack.purpose?.kind !== "topic") {
    errors.push(issue("ARTIFACT_TYPE_MISMATCH", "Evidence Pack 不是 topic 类型", false))
  }
  if (input.currentSourceSnapshotHash !== input.pack.sourceSnapshotHash) {
    errors.push(issue("SOURCE_CHANGED", "源码快照在生成期间发生变化", false))
  }
  // moduleID/topic 是 Orchestrator 已锁定的任务身份，不属于模型的语义判断范围。
  // 即使模型回显错误，也由 runtime 覆盖，不能浪费新的修复 Session。
  ir.moduleID = input.pack.moduleID
  if (input.pack.purpose?.kind === "topic") ir.topic = input.pack.purpose.topic
  const evidence = new Map(input.pack.evidence.map((item) => [item.id, item]))
  const explicit = input.pack.evidence.some(
    (item) => item.confidence === "explicit" && item.source.sourceKind !== "test",
  )
  const absence = input.pack.unknowns.some((item) => item.startsWith(`topic-absence:${ir.topic}:`))
  // 适用性由完整静态扫描确定，模型无权用 unknown/not-applicable 跳过已有源码事实。
  ir.applicability = explicit ? "applicable" : absence ? "not-applicable" : "unknown"
  if (ir.applicability === "applicable") {
    const hinted = new Set(
      [ir.conclusions, ir.mechanisms, ir.flows, ir.exceptions, ir.constraints]
        .flat()
        .flatMap((claim) => claim.evidenceIDs),
    )
    const invalid = [...hinted].filter((id) => !evidence.has(id))
    if (invalid.length) {
      warnings.push(
        warning(
          "MODEL_EVIDENCE_HINT_IGNORED",
          `模型分组引用的 ${invalid.length} 个无效或过期 evidenceId 已由 runtime 丢弃`,
          invalid,
        ),
      )
    }
    const missing = input.pack.obligations
      .filter((obligation) => obligation.required)
      .flatMap((obligation) => obligation.evidenceIDs)
      .filter((id) => !hinted.has(id))
    if (missing.length) {
      warnings.push(
        warning(
          "MODEL_EVIDENCE_HINT_COMPLETED",
          `模型分组遗漏的 ${missing.length} 条必需证据已由 runtime 确定性补齐`,
          missing,
        ),
      )
    }
  }

  const canonical = canonicalizeTopicIR(ir, input.pack)
  validatePublishedTopic(canonical, input.pack, evidence, errors)
  return result(input, errors, canonical, warnings)
}

function validatePublishedTopic(
  ir: DesignTopicIR,
  pack: EvidencePack,
  evidence: Map<string, Evidence>,
  errors: ValidationIssue[],
) {
  validateReaderLanguage(ir, errors)
  validateReaderVocabulary(ir, errors)
  validateReaderCompleteness(ir, errors)

  if (ir.applicability !== "applicable") return
  const claims = [...ir.conclusions, ...ir.mechanisms, ...ir.flows, ...ir.exceptions, ...ir.constraints]
  if (!claims.length) {
    errors.push(issue("TOPIC_FACT_REQUIRED", "适用主题的规范化正文至少需要一条源码事实", false))
    return
  }
  const texts = new Set<string>()
  for (const claim of claims) {
    const normalized = claim.text.trim().replace(/\s+/g, " ")
    if (!normalized) errors.push(issue("EMPTY_TOPIC_CLAIM", "规范化主题事实不能为空", false))
    if (texts.has(normalized)) {
      errors.push(issue("DUPLICATE_TOPIC_CLAIM", `规范化主题事实重复：${normalized}`, false))
    }
    texts.add(normalized)
    if (!claim.evidenceIDs.length) {
      errors.push(issue("EVIDENCE_REQUIRED", `规范化主题事实缺少 evidenceId：${normalized}`, false))
      continue
    }
    for (const id of claim.evidenceIDs) {
      if (!evidence.has(id)) {
        errors.push(issue("INVALID_EVIDENCE_ID", `规范化主题事实引用无效 evidenceId：${id}`, false, [id]))
      }
    }
    if (
      !claim.evidenceIDs.some((id) => {
        const item = evidence.get(id)
        return item?.confidence === "explicit" && item.source.sourceKind !== "test"
      })
    ) {
      errors.push(
        issue("UNSUPPORTED_TOPIC_CLAIM", `规范化主题事实缺少显式生产源码证据：${normalized}`, false, claim.evidenceIDs),
      )
    }
  }
  const cited = new Set(claims.flatMap((claim) => claim.evidenceIDs))
  const missing = pack.obligations
    .filter((obligation) => obligation.required)
    .flatMap((obligation) => obligation.evidenceIDs)
    .filter((id) => !cited.has(id))
  if (missing.length) {
    errors.push(
      issue(
        "TOPIC_EVIDENCE_COVERAGE_INCOMPLETE",
        `规范化主题正文遗漏 ${missing.length} 条必需源码证据`,
        false,
        missing,
      ),
    )
  }
}

function result(
  input: ValidateTopicInput,
  errors: ValidationIssue[],
  ir?: DesignTopicIR,
  warnings: ValidationIssue[] = [],
) {
  return {
    ir,
    report: {
      schemaVersion: 1 as const,
      workItemID: input.pack.workItemID,
      attempt: input.attempt,
      passed: errors.length === 0,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      validatorVersions: { schema: "1", evidence: "1", topic: "7" },
      errors,
      warnings,
      metrics: {
        evidenceCount: input.pack.evidence.length,
        claimCount: ir ? claimCount(ir) : 0,
        errorCount: errors.length,
      },
      createdAt: Date.now(),
    } satisfies ValidationReport,
  }
}

function warning(code: string, message: string, evidenceIDs: readonly string[]): ValidationIssue {
  return { severity: "warning", code, message, evidenceIDs: [...evidenceIDs], sourcePaths: [], retryable: false }
}

function claimCount(ir: DesignTopicIR) {
  return ir.conclusions.length + ir.mechanisms.length + ir.flows.length + ir.exceptions.length + ir.constraints.length
}

function validateReaderLanguage(ir: DesignTopicIR, errors: ValidationIssue[]) {
  for (const [jsonPath, text] of readerTexts(ir)) {
    if (!text.trim() || /[\u3400-\u9fff]/u.test(text)) continue
    errors.push({
      ...issue("NON_CHINESE_READER_TEXT", `规范化正文必须使用简体中文：${jsonPath}`, false),
      jsonPath,
    })
  }
}

function validateReaderVocabulary(ir: DesignTopicIR, errors: ValidationIssue[]) {
  const forbidden =
    /\b(?:Evidence Pack|WorkItem|Schema|runtime|Owner|DesignUnit|unknowns?)\b|topic-evidence-[a-z-]+|\bMOD-[a-f0-9]{20}\b|\bflow-(?:node|edge)\b|\b(?:nodeKind|sourceKind|dependencyKind|internal)=|声明\s+(?:function|method|struct|enum)\b|包含\s+(?:action|entry|decision|return|loop)\s+步骤|证据包|工作项|设计单元|内部流水线|代表性采样|已采样|采样证据/u
  for (const [jsonPath, text] of readerTexts(ir)) {
    const match = text.match(forbidden)
    if (!match) continue
    errors.push({
      ...issue("INTERNAL_PIPELINE_TERM", `规范化正文不得包含内部流水线术语“${match[0]}”：${jsonPath}`, false),
      jsonPath,
    })
  }
}

function validateReaderCompleteness(ir: DesignTopicIR, errors: ValidationIssue[]) {
  for (const [jsonPath, text] of readerTexts(ir)) {
    if (text.includes("…")) {
      errors.push({
        ...issue("TRUNCATED_READER_TEXT", `规范化正文不得包含人为省略号：${jsonPath}`, false),
        jsonPath,
      })
    }
  }
  if (ir.applicability !== "applicable") return
  const limitation =
    /(?:(?:当前|完整|已采样|上述)?(?:源码|证据|材料|证据包).{0,16}(?:未发现|没有|不足|未覆盖|无法证明|不能确认|仅能确认|只能确认)|(?:未发现|没有|不足|未覆盖|无法证明|不能确认|仅能确认|只能确认).{0,16}(?:源码|证据|实现|调用|函数体|分支|循环|细节))/u
  for (const [jsonPath, text] of readerFactTexts(ir)) {
    if (!limitation.test(text)) continue
    errors.push({
      ...issue(
        "EPISTEMIC_LIMITATION_IN_READER_FACT",
        `适用主题的正文只陈述已证实事实；证据局限必须移入待确认项：${jsonPath}`,
        false,
      ),
      jsonPath,
    })
  }
}

function readerTexts(ir: DesignTopicIR) {
  return [
    ["$.title", ir.title],
    ["$.summary", ir.summary],
    ...readerClaimTexts("conclusions", ir.conclusions),
    ...readerClaimTexts("mechanisms", ir.mechanisms),
    ...readerClaimTexts("flows", ir.flows),
    ...readerClaimTexts("exceptions", ir.exceptions),
    ...readerClaimTexts("constraints", ir.constraints),
    ...readerClaimTexts("assumptions", ir.assumptions),
    ...readerClaimTexts("unknowns", ir.unknowns),
  ] as const
}

function readerFactTexts(ir: DesignTopicIR) {
  return [
    ["$.summary", ir.summary],
    ...readerClaimTexts("conclusions", ir.conclusions),
    ...readerClaimTexts("mechanisms", ir.mechanisms),
    ...readerClaimTexts("flows", ir.flows),
    ...readerClaimTexts("exceptions", ir.exceptions),
    ...readerClaimTexts("constraints", ir.constraints),
  ] as const
}

function readerClaimTexts(name: string, claims: readonly { readonly text: string }[]) {
  return claims.map((claim, index) => [`$.${name}[${index}].text`, claim.text] as const)
}

function issue(
  code: string,
  message: string,
  retryable: boolean,
  evidenceIDs: readonly string[] = [],
): ValidationIssue {
  return { severity: "error", code, message, evidenceIDs: [...evidenceIDs], sourcePaths: [], retryable }
}

const evidenceIDs = { type: "array", items: { type: "string" } } as const
const claim = {
  type: "object",
  additionalProperties: false,
  required: ["text", "evidenceIDs"],
  properties: { text: { type: "string" }, evidenceIDs },
} as const

export const topicJSONSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "moduleID",
    "viewType",
    "topic",
    "applicability",
    "title",
    "summary",
    "conclusions",
    "mechanisms",
    "flows",
    "exceptions",
    "constraints",
    "assumptions",
    "unknowns",
  ],
  properties: {
    schemaVersion: { const: 1 },
    moduleID: { type: "string" },
    viewType: { const: "topic" },
    topic: {
      enum: [
        "positioning",
        "responsibilities",
        "boundaries",
        "inputs-outputs",
        "business-process",
        "core-models",
        "algorithms",
        "concurrency",
        "state-lifecycle",
        "error-recovery",
        "data-persistence",
        "configuration-startup",
        "observability-debugging",
        "constraints-risks",
      ],
    },
    applicability: { enum: ["applicable", "not-applicable", "unknown"] },
    title: { type: "string" },
    summary: { type: "string" },
    conclusions: { type: "array", items: claim },
    mechanisms: { type: "array", items: claim },
    flows: { type: "array", items: claim },
    exceptions: { type: "array", items: claim },
    constraints: { type: "array", items: claim },
    assumptions: { type: "array", items: claim },
    unknowns: { type: "array", items: claim },
  },
} as const
