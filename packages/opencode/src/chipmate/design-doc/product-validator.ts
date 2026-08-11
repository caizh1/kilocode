import { Exit, Schema } from "effect"
import * as ToolJsonSchema from "@/tool/json-schema"
import {
  AlgorithmIR,
  ArchitectureIR,
  DataEntityIR,
  DfxIR,
  InterfaceContractIR,
  ModuleOverviewIR,
  ProductSectionIR as ProductSectionIRSchema,
  RequirementTraceIR,
  ResourcePerformanceIR,
  ScenarioFlowIR,
  SfmeaIR,
  VerificationCaseIR,
  type EvidencePack,
  type ProductSection,
  type ProductSectionIR,
  type ValidationIssue,
  type ValidationReport,
} from "./domain"

const sectionSchemas = {
  "module-overview": ModuleOverviewIR,
  requirements: RequirementTraceIR,
  "overall-structure": ArchitectureIR,
  "data-entities": DataEntityIR,
  algorithms: AlgorithmIR,
  "provided-interfaces": InterfaceContractIR,
  "required-interfaces": InterfaceContractIR,
  "internal-interfaces": InterfaceContractIR,
  "key-flows": ScenarioFlowIR,
  "resource-performance": ResourcePerformanceIR,
  dfx: DfxIR,
  sfmea: SfmeaIR,
  verification: VerificationCaseIR,
} as const

export function productJSONSchema(section: ProductSection) {
  return ToolJsonSchema.fromSchema(sectionSchemas[section])
}

export interface ValidateProductSectionInput {
  candidate: unknown
  pack: EvidencePack
  attempt: number
  currentSourceSnapshotHash: string
}

export function validateProductSection(input: ValidateProductSectionInput): {
  ir?: ProductSectionIR
  report: ValidationReport
} {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const decoded = Schema.decodeUnknownExit(ProductSectionIRSchema)(input.candidate)
  if (Exit.isFailure(decoded)) {
    errors.push(issue("SCHEMA_INVALID", String(decoded.cause), true))
    return result(input, errors, warnings)
  }
  const ir = structuredClone(decoded.value) as ProductSectionIR
  const removedParagraphs = ir.paragraphs.filter((paragraph) => containsFileList(paragraph.text)).length
  if (removedParagraphs) {
    ir.paragraphs = ir.paragraphs.filter((paragraph) => !containsFileList(paragraph.text))
    warnings.push(
      warning(
        "FILE_LIST_NARRATIVE_REMOVED",
        `runtime 已移除 ${removedParagraphs} 个按源码文件枚举的段落，正文保留业务组件、结构化条目与可读说明。`,
      ),
    )
  }
  if (!ir.paragraphs.length && input.pack.purpose?.kind === "product-section" && input.pack.purpose.section !== "requirements") {
    ir.paragraphs.push({
      text: `本节按“${ir.title}”组织设计信息，具体职责、边界与关系见下列结构化说明。`,
      claimIDs: [],
    })
  }
  if (input.pack.artifactType !== "product-section" || input.pack.purpose?.kind !== "product-section") {
    errors.push(issue("ARTIFACT_TYPE_MISMATCH", "Evidence Pack 不是产品章节类型", false))
    return result(input, errors, warnings, ir)
  }
  if (input.currentSourceSnapshotHash !== input.pack.sourceSnapshotHash) {
    errors.push(issue("SOURCE_CHANGED", "源码快照在生成期间发生变化", false))
  }
  if (ir.moduleID !== input.pack.moduleID) {
    errors.push(issue("MODULE_MISMATCH", "产品章节 moduleID 与 Evidence Pack 不一致", true))
  }
  if (ir.section !== input.pack.purpose.section) {
    errors.push(issue("SECTION_MISMATCH", `应生成 ${input.pack.purpose.section}，实际为 ${ir.section}`, true))
  }

  const evidence = new Map(input.pack.evidence.map((item) => [item.id, item]))
  const claims = new Map<string, ProductSectionIR["claims"][number]>()
  for (const claim of [...ir.claims, ...ir.assumptions, ...ir.unknowns]) {
    if (claims.has(claim.id)) errors.push(issue("DUPLICATE_CLAIM_ID", `设计主张 ID 重复：${claim.id}`, true))
    claims.set(claim.id, claim)
    validateEvidenceReferences(claim.evidenceIDs, evidence, errors, claim.id, claim.confidence !== "unknown")
    if (claim.confidence === "confirmed") {
      const explicitEvidence = claim.evidenceIDs.flatMap((id) => {
        const item = evidence.get(id)
        return item?.confidence === "explicit" && item.source.sourceKind !== "test" ? [item] : []
      })
      if (!explicitEvidence.length)
        errors.push(issue("UNSUPPORTED_CONFIRMED_CLAIM", `已确认主张 ${claim.id} 缺少生产证据`, true))
      if (explicitEvidence.length && explicitEvidence.every((item) => structuralEvidenceKinds.has(item.kind))) {
        const semantic = claim.statement.match(/负责|承担|用于|用来|实现|表明|意味着|需要|提供.+(?:能力|功能)|构成.+(?:机制|流程)/)
        if (semantic) {
          errors.push(
            issue(
              "CONFIDENCE_OVERSTATED",
              `主张 ${claim.id} 只有声明或依赖证据，不能把“${semantic[0]}”作为已确认行为；请改为 inferred 或仅陈述源码存在关系`,
              true,
            ),
          )
        }
      }
    }
    validateReaderText(claim.statement, `主张 ${claim.id}`, errors, false)
    if (claim.rationale) validateReaderText(claim.rationale, `主张依据 ${claim.id}`, errors, false)
  }
  for (const claim of [...ir.assumptions, ...ir.unknowns]) validateReaderText(claim.statement, `待确认项 ${claim.id}`, errors)

  for (const paragraph of ir.paragraphs) {
    if (!paragraph.text.trim()) errors.push(issue("EMPTY_PARAGRAPH", "正文段落不能为空", true))
    validateClaimReferences(paragraph.claimIDs, claims, errors, "正文段落", false)
    validateReaderText(paragraph.text, "正文段落", errors)
  }
  validateReaderText(ir.title, "章节标题", errors)
  validateReaderText(ir.summary, "章节摘要", errors)
  for (const references of nestedClaimReferences(ir)) validateClaimReferences(references, claims, errors, "章节条目", false)

  const confirmedEvidence = new Set(
    ir.claims
      .filter((claim) => claim.confidence === "confirmed")
      .flatMap((claim) => claim.evidenceIDs),
  )
  for (const obligation of input.pack.obligations.filter((item) => item.required)) {
    const missing = obligation.evidenceIDs.filter((id) => !confirmedEvidence.has(id))
    if (missing.length) {
      errors.push(
        issue(
          "MISSING_REQUIRED_EVIDENCE",
          `章节未覆盖必需的 ${obligation.kind} 证据`,
          true,
          missing,
        ),
      )
    }
  }

  if (ir.section === "requirements") {
    const missing = input.pack.unknowns.some((item) => item.startsWith("requirements-missing:"))
    if (missing && (ir.sourceStatus !== "missing" || ir.requirements.length)) {
      errors.push(issue("REQUIREMENT_SOURCE_MISSING", "未提供需求材料时不得生成需求编号或需求条目", true))
    }
    if (!missing && ir.sourceStatus !== "provided") {
      errors.push(issue("REQUIREMENT_SOURCE_STATUS_INVALID", "已有需求文档证据时 sourceStatus 必须为 provided", true))
    }
    if (missing) {
      warnings.push(
        warning("UPSTREAM_REQUIREMENTS_MISSING", "未提供上游需求证据；正文只说明实现责任，不生成 AR 编号。"),
      )
    }
  }
  if (absenceSection(ir.section) && !input.pack.evidence.length) {
    warnings.push(warning("SECTION_EVIDENCE_ABSENT", `${ir.title}未发现可直接确认的源码机制，已作为待确认项发布。`))
  }
  if (!ir.paragraphs.length && ir.section !== "requirements") {
    errors.push(issue("READER_NARRATIVE_MISSING", "产品章节至少需要一个面向读者的正文段落", true))
  }
  return result(input, errors, warnings, ir)
}

function nestedClaimReferences(ir: ProductSectionIR) {
  const values: string[][] = []
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "claimIDs" && Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
        values.push(item)
        continue
      }
      if (!["claims", "assumptions", "unknowns", "paragraphs"].includes(key)) visit(item)
    }
  }
  visit(ir)
  return values
}

function validateClaimReferences(
  ids: readonly string[],
  claims: Map<string, ProductSectionIR["claims"][number]>,
  errors: ValidationIssue[],
  owner: string,
  required: boolean,
) {
  if (required && !ids.length) errors.push(issue("CLAIM_REQUIRED", `${owner} 缺少 claimID`, true))
  for (const id of ids) {
    if (!claims.has(id)) errors.push(issue("INVALID_CLAIM_ID", `${owner} 引用了不存在的 claimID：${id}`, true))
  }
}

function validateEvidenceReferences(
  ids: readonly string[],
  evidence: Map<string, EvidencePack["evidence"][number]>,
  errors: ValidationIssue[],
  owner: string,
  required: boolean,
) {
  if (required && !ids.length) errors.push(issue("EVIDENCE_REQUIRED", `${owner} 缺少源码依据`, true))
  for (const id of ids) {
    if (!evidence.has(id)) errors.push(issue("INVALID_EVIDENCE_ID", `${owner} 引用了不存在的 evidenceId`, true, [id]))
  }
}

function validateReaderText(value: string, owner: string, errors: ValidationIssue[], rejectFileList = true) {
  const internal = value.match(/\b(?:EV|MOD|WI|PACK|OB)-[A-Za-z0-9-]+\b|\b(?:Evidence Pack|WorkItem|Schema)\b/i)
  if (internal) errors.push(issue("INTERNAL_TERM_LEAK", `${owner} 暴露内部字段“${internal[0]}”`, true))
  if (rejectFileList && containsFileList(value)) {
    errors.push(issue("FILE_LIST_IN_NARRATIVE", `${owner} 连续枚举多个源码文件，应改用业务组件或逻辑模块说明`, true))
  }
}

function containsFileList(value: string) {
  const files = value.match(/(?:[\w@+.-]+\/)*[\w@+.-]+\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|ts|tsx)\b/gi) ?? []
  return new Set(files.map((file) => file.toLowerCase())).size >= 4
}

const structuralEvidenceKinds = new Set(["source-file", "dependency", "code-symbol"])

function absenceSection(section: ProductSection) {
  return ["resource-performance", "dfx", "sfmea", "verification"].includes(section)
}

function issue(code: string, message: string, retryable: boolean, evidenceIDs: readonly string[] = []): ValidationIssue {
  return { severity: "error", code, message, evidenceIDs: [...evidenceIDs], sourcePaths: [], retryable }
}

function warning(code: string, message: string): ValidationIssue {
  return { severity: "warning", code, message, evidenceIDs: [], sourcePaths: [], retryable: false }
}

function result(
  input: ValidateProductSectionInput,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  ir?: ProductSectionIR,
): { ir?: ProductSectionIR; report: ValidationReport } {
  return {
    ir,
    report: {
      schemaVersion: 1,
      workItemID: input.pack.workItemID,
      attempt: input.attempt,
      passed: errors.length === 0,
      sourceSnapshotHash: input.pack.sourceSnapshotHash,
      validatorVersions: { schema: "2", evidence: "2", productSection: "2" },
      errors,
      warnings,
      metrics: {
        evidenceCount: input.pack.evidence.length,
        requiredObligationCount: input.pack.obligations.filter((item) => item.required).length,
        errorCount: errors.length,
      },
      createdAt: Date.now(),
    },
  }
}
