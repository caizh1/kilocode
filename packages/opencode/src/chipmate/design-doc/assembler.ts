import { Schema } from "effect"
import { createHash } from "crypto"
import { topicEvidenceApplies } from "@chipmate/chipmate-indexing/design-doc"
import {
  DiagramIR,
  EvidencePack as EvidencePackSchema,
  ModuleManifest as ModuleManifestSchema,
  ValidationReport as ValidationReportSchema,
  type DesignDocJob,
} from "./domain"
import { DesignDocStore } from "./store"
import { assembleFullDesignDocument } from "./full-document"
import { validateFullDesignMatrix } from "./content-contract"
import { assembleProductDesignDocument } from "./product-document"
import { validateProductDesignMatrix } from "./product-contract"

type ParsedDesignDocIR = typeof DiagramIR.Type
type ParsedEvidencePack = typeof EvidencePackSchema.Type
type ParsedModuleManifest = typeof ModuleManifestSchema.Type
type ParsedValidationReport = typeof ValidationReportSchema.Type
type PassedIR = { workItemID: string; ir: ParsedDesignDocIR }

export interface DesignDocQualityReport {
  schemaVersion: 1
  jobID: string
  passed: boolean
  sourceSnapshotHashes: string[]
  workItems: Array<{
    id: string
    moduleID: string
    artifactType: string
    status: string
    attempts: number
    validationPassed: boolean
    errorCount: number
    warningCount: number
    evidenceScope?: string
  }>
  metrics: {
    requiredArtifacts: number
    passedArtifacts: number
    evidenceCount: number
    modelAttempts: number
    retryAttempts: number
    totalTokens: number
    totalCost: number
    totalDurationMs: number
    schemaPassRate: number
    evidenceCoverageRate: number
    renderSuccessRate: number
    relationCoverageRate: number
  }
  issues: Array<{
    code: string
    message: string
    workItemIDs: string[]
  }>
  createdAt: number
}

export async function buildQualityReport(job: DesignDocJob): Promise<DesignDocQualityReport> {
  const reportCandidates = new Map<string, ParsedValidationReport[]>()
  const packs: ParsedEvidencePack[] = []
  let manifest: ParsedModuleManifest | undefined
  for (const artifact of job.artifacts) {
    if (artifact.kind !== "validation-report" && artifact.kind !== "evidence-pack" && artifact.kind !== "manifest")
      continue
    const value = await DesignDocStore.readDeclaredArtifact(job, artifact.id)
    if (artifact.kind === "validation-report") {
      const report = await Schema.decodeUnknownPromise(ValidationReportSchema)(
        JSON.parse(value.content.toString("utf8")),
      )
      const candidates = reportCandidates.get(artifact.workItemID) ?? []
      candidates.push(report)
      reportCandidates.set(artifact.workItemID, candidates)
    } else if (artifact.kind === "evidence-pack") {
      packs.push(await Schema.decodeUnknownPromise(EvidencePackSchema)(JSON.parse(value.content.toString("utf8"))))
    } else
      manifest = await Schema.decodeUnknownPromise(ModuleManifestSchema)(JSON.parse(value.content.toString("utf8")))
  }
  const contentItems = job.workItems.filter((item) => item.artifactType !== "review")
  const reports = new Map(
    contentItems.flatMap((item) => {
      const candidates = reportCandidates.get(item.id) ?? []
      const eligible = item.status === "passed" ? candidates.filter((report) => report.passed) : candidates
      const report = eligible.toSorted((left, right) => right.attempt - left.attempt)[0]
      return report ? [[item.id, report] as const] : []
    }),
  )
  const irs = await readPassedIRs(job)
  const duplicates = duplicateViewIssues(irs)
  const missing = missingRequiredArtifactIssues(job, manifest, contentItems, packs)
  const behaviorCoverage = behaviorCoverageIssues(job, manifest, contentItems)
  const topicCoverage = topicCoverageIssues(job, contentItems, packs, irs)
  const topicDiagramCoverage = topicDiagramEvidenceIssues(manifest, contentItems, packs, irs)
  const consistency = await contentConsistencyIssues(job, contentItems, packs, irs)
  const matrix =
    job.config.documentProfile === "source-backed-full" && manifest
      ? validateFullDesignMatrix(
          manifest.modules
            .filter((module) => module.sourceFiles.length + module.testFiles.length > 0)
            .map((module) => module.id),
          job.workItems,
        )
      : job.config.documentProfile === "product-detailed-design-v2" && manifest
        ? validateProductDesignMatrix(
            manifest.modules
              .filter((module) => module.sourceFiles.length + module.testFiles.length > 0)
              .map((module) => module.id),
            job.workItems,
          )
      : { passed: true, errors: [] }
  const issues = [
    ...duplicates,
    ...missing,
    ...behaviorCoverage,
    ...topicCoverage,
    ...topicDiagramCoverage,
    ...consistency,
    ...matrix.errors.map((message) => ({ code: "DESIGN_MATRIX_INCOMPLETE", message, workItemIDs: [] })),
  ]
  const attempts = contentItems.flatMap((item) => item.attempts.filter((attempt) => attempt.status !== "interrupted"))
  const passed = contentItems.filter((item) => item.status === "passed").length
  const renderItems = contentItems
    .filter((item) => item.purpose?.kind !== "topic" && item.purpose?.kind !== "product-section")
    .filter(
      (item) => !reports.get(item.id)?.warnings.some((warning) => warning.code === "STATE_MACHINE_NOT_APPLICABLE"),
    )
  const ratio = (numerator: number, denominator: number) => (denominator ? numerator / denominator : 0)
  return {
    schemaVersion: 1,
    jobID: job.id,
    passed:
      contentItems.length > 0 &&
      contentItems.every((item) => item.status === "passed" && reports.get(item.id)?.passed === true) &&
      issues.length === 0,
    sourceSnapshotHashes: [...new Set(packs.map((pack) => pack.sourceSnapshotHash))],
    workItems: contentItems.map((item) => {
      const report = reports.get(item.id)
      return {
        id: item.id,
        moduleID: item.moduleID,
        artifactType: item.artifactType,
        status: item.status,
        attempts: item.attempts.filter((attempt) => attempt.status !== "interrupted").length,
        validationPassed: report?.passed ?? false,
        errorCount: report?.errors.length ?? 0,
        warningCount: report?.warnings.length ?? 0,
        ...(item.evidenceScope ? { evidenceScope: item.evidenceScope.label } : {}),
      }
    }),
    metrics: {
      requiredArtifacts: contentItems.length,
      passedArtifacts: passed,
      evidenceCount: packs.reduce((total, pack) => total + pack.evidence.length, 0),
      modelAttempts: attempts.length,
      retryAttempts: contentItems.reduce(
        (total, item) =>
          total + Math.max(0, item.attempts.filter((attempt) => attempt.status !== "interrupted").length - 1),
        0,
      ),
      totalTokens: attempts.reduce(
        (total, attempt) =>
          total +
          (attempt.tokens?.total ?? attempt.tokens?.input ?? 0) +
          (attempt.tokens?.total === undefined ? (attempt.tokens?.output ?? 0) + (attempt.tokens?.reasoning ?? 0) : 0),
        0,
      ),
      totalCost: attempts.reduce((total, attempt) => total + (attempt.cost ?? 0), 0),
      totalDurationMs: Math.max(0, job.updatedAt - job.createdAt),
      schemaPassRate: ratio([...reports.values()].filter((report) => report.passed).length, contentItems.length),
      evidenceCoverageRate: ratio(passed, contentItems.length),
      renderSuccessRate: ratio(
        renderItems.filter((item) =>
          job.artifacts.some(
            (artifact) => artifact.workItemID === item.id && artifact.kind === "render" && artifact.status === "passed",
          ),
        ).length,
        renderItems.length,
      ),
      relationCoverageRate: behaviorCoverage.length ? 0 : 1,
    },
    issues,
    createdAt: Date.now(),
  }
}

const topicDiagramContracts = [
  {
    topic: "business-process",
    view: "business-flow",
    viewType: "business-flow",
    evidenceKinds: new Set(["flow-node", "flow-edge"]),
  },
  {
    topic: "algorithms",
    view: "code-flow",
    viewType: "execution-flow",
    evidenceKinds: new Set(["flow-node", "flow-edge"]),
  },
  {
    topic: "data-persistence",
    view: "data-lifecycle",
    viewType: "data-flow",
    evidenceKinds: new Set(["data-entity", "data-flow"]),
  },
  {
    topic: "state-lifecycle",
    view: "state-machine",
    viewType: "lifecycle",
    evidenceKinds: new Set(["state-definition", "initial-state", "state-transition", "terminal-state"]),
  },
] as const

/**
 * 最终发布门禁：主题正文和对应图分别由独立 Session 生成，但必须覆盖同一组可图示源码事实。
 * 比较对象是同一模块下全部主题分片与全部对应分图的 evidence union，不能只取第一个依赖。
 */
function topicDiagramEvidenceIssues(
  manifest: ParsedModuleManifest | undefined,
  items: DesignDocJob["workItems"],
  packs: ParsedEvidencePack[],
  values: PassedIR[],
) {
  const issues: DesignDocQualityReport["issues"] = []
  const packByWorkItem = new Map(packs.map((pack) => [pack.workItemID, pack]))
  const irByWorkItem = new Map(values.map((value) => [value.workItemID, value.ir]))
  const moduleIDs = new Set(items.flatMap((item) => (item.purpose?.kind === "topic" ? [item.moduleID] : [])))

  for (const moduleID of moduleIDs) {
    for (const contract of topicDiagramContracts) {
      const topicItems = items.filter(
        (item) => item.moduleID === moduleID && item.purpose?.kind === "topic" && item.purpose.topic === contract.topic,
      )
      if (!topicItems.length) continue
      const topicEvidence = topicItems.flatMap((item) => packByWorkItem.get(item.id)?.evidence ?? [])
      const referencedDataEntities = new Set(
        topicEvidence
          .filter((evidence) => evidence.kind === "data-flow")
          .flatMap((evidence) => [evidence.attributes.fromRef, evidence.attributes.toRef])
          .filter((value): value is string => typeof value === "string"),
      )
      const requiredByWorkItem = topicItems.map((item) => ({
        item,
        ids: (packByWorkItem.get(item.id)?.evidence ?? [])
          .filter(
            (evidence) =>
              evidence.confidence === "explicit" &&
              evidence.source.sourceKind !== "test" &&
              contract.evidenceKinds.has(evidence.kind) &&
              (evidence.kind !== "data-entity" ||
                (typeof evidence.attributes.ref === "string" && referencedDataEntities.has(evidence.attributes.ref))),
          )
          .map((evidence) => evidence.id),
      }))
      const required = new Set(requiredByWorkItem.flatMap(({ ids }) => ids))
      if (!required.size) continue

      const topicItemIDs = new Set(topicItems.map((item) => item.id))
      const diagramItems = items.filter(
        (item) =>
          item.moduleID === moduleID &&
          item.purpose?.kind === "diagram" &&
          item.purpose.view === contract.view &&
          (item.purpose.topic === contract.topic ||
            (item.purpose.role === "focused" && item.dependencies.some((id) => topicItemIDs.has(id)))),
      )
      const diagramIRs = diagramItems.flatMap((item) => {
        const ir = irByWorkItem.get(item.id)
        return ir ? [ir] : []
      })
      if (diagramIRs.length > 0 && diagramIRs.every((ir) => ir.viewType === "not-applicable")) continue
      const covered = new Set(
        diagramItems.flatMap((item) => {
          const ir = irByWorkItem.get(item.id)
          return ir?.viewType === contract.viewType ? collectGraphEvidenceIDs(ir) : []
        }),
      )
      const missing = [...required].filter((id) => !covered.has(id))
      if (!missing.length) continue
      const missingTopicItems = requiredByWorkItem
        .filter(({ ids }) => ids.some((id) => !covered.has(id)))
        .map(({ item }) => item.id)
      issues.push({
        code: "TOPIC_DIAGRAM_EVIDENCE_INCOMPLETE",
        message: `模块 ${manifest?.modules.find((module) => module.id === moduleID)?.path ?? moduleID} 的主题“${contract.topic}”有 ${missing.length} 条可图示源码证据未进入对应 ${contract.view} 图集。`,
        workItemIDs: [...missingTopicItems, ...diagramItems.map((item) => item.id)],
      })
    }
  }
  return issues
}

function collectGraphEvidenceIDs(ir: ParsedDesignDocIR): string[] {
  if (ir.viewType === "business-flow") {
    return [...new Set([...ir.activities, ...ir.flows].flatMap((item) => item.evidenceIDs))]
  }
  if (ir.viewType === "execution-flow") {
    return [...new Set([...ir.nodes, ...ir.edges].flatMap((item) => item.evidenceIDs))]
  }
  if (ir.viewType === "data-flow") {
    return [...new Set([...ir.entities, ...ir.flows].flatMap((item) => item.evidenceIDs))]
  }
  if (ir.viewType === "lifecycle") {
    return [...new Set([...ir.states, ...ir.transitions].flatMap((item) => item.evidenceIDs))]
  }
  return []
}

function topicCoverageIssues(
  job: DesignDocJob,
  contentItems: DesignDocJob["workItems"],
  packs: ParsedEvidencePack[],
  values: PassedIR[],
) {
  const issues: DesignDocQualityReport["issues"] = []
  if (job.config.documentProfile !== "source-backed-full") return issues
  const packByWorkItem = new Map(packs.map((pack) => [pack.workItemID, pack]))
  const irByWorkItem = new Map(values.map((value) => [value.workItemID, value.ir]))
  const groups = Map.groupBy(
    contentItems.filter((item) => item.purpose?.kind === "topic"),
    (item) => `${item.moduleID}\0${item.purpose?.kind === "topic" ? item.purpose.topic : ""}`,
  )
  for (const items of groups.values()) {
    const workItemIDs = items.map((item) => item.id)
    for (const item of items) {
      const pack = packByWorkItem.get(item.id)
      const ir = irByWorkItem.get(item.id)
      if (pack?.unknowns.some((value) => value.startsWith("topic-evidence-sampled:"))) {
        issues.push({
          code: "TOPIC_COVERAGE_INCOMPLETE",
          message: `主题工作项 ${item.id} 使用了破坏性代表采样，禁止发布为完整详细设计。`,
          workItemIDs: [item.id],
        })
      }
      if (!pack || ir?.viewType !== "topic" || ir.applicability !== "applicable") continue
      const cited = new Set(
        [ir.conclusions, ir.mechanisms, ir.flows, ir.exceptions, ir.constraints]
          .flat()
          .flatMap((claim) => claim.evidenceIDs),
      )
      const missing = pack.obligations
        .filter((obligation) => obligation.required)
        .flatMap((obligation) => obligation.evidenceIDs)
        .filter((id) => !cited.has(id))
      if (!missing.length) continue
      issues.push({
        code: "TOPIC_EVIDENCE_COVERAGE_INCOMPLETE",
        message: `主题工作项 ${item.id} 遗漏 ${missing.length} 条必需源码证据。`,
        workItemIDs: [item.id],
      })
    }
    const scoped = items.flatMap((item) =>
      item.evidenceScope?.kind === "topic-evidence" ? [{ item, scope: item.evidenceScope }] : [],
    )
    if (!scoped.length && items.length === 1) continue
    if (scoped.length !== items.length) {
      issues.push({
        code: "TOPIC_COVERAGE_METADATA_MISSING",
        message: "同一模块主题拆为多个原子工作项后，部分工作项缺少完整覆盖元数据。",
        workItemIDs,
      })
      continue
    }
    const totals = new Set(scoped.map(({ scope }) => scope.coverageTotal))
    const hashes = new Set(scoped.map(({ scope }) => scope.coverageSetHash))
    const refs = scoped.flatMap(({ scope }) => scope.values)
    const unique = [...new Set(refs)].sort()
    const total = [...totals][0] ?? 0
    if (totals.size !== 1 || hashes.size !== 1 || refs.length !== unique.length || unique.length !== total) {
      issues.push({
        code: "TOPIC_COVERAGE_INCOMPLETE",
        message: `主题原子工作项未无遗漏、无重复地覆盖完整证据集合：期望 ${total} 条，实际唯一覆盖 ${unique.length} 条。`,
        workItemIDs,
      })
      continue
    }
    const hash = createHash("sha256").update(unique.join("\n")).digest("hex")
    if (hash !== [...hashes][0]) {
      issues.push({
        code: "TOPIC_COVERAGE_HASH_MISMATCH",
        message: "主题原子工作项的证据集合哈希不匹配，证据分片可能被替换或遗漏。",
        workItemIDs,
      })
    }
  }
  return issues
}

function behaviorCoverageIssues(
  job: DesignDocJob,
  manifest: ParsedModuleManifest | undefined,
  contentItems: DesignDocJob["workItems"],
) {
  const issues: DesignDocQualityReport["issues"] = []
  if (
    (job.config.documentProfile !== "source-backed-full" &&
      job.config.documentProfile !== "product-detailed-design-v2") ||
    !manifest
  )
    return issues
  const views = ["business-flow", "execution-flow", "data-flow", "error-flow"] as const
  for (const module of manifest.modules.filter((item) => item.sourceFiles.length + item.testFiles.length > 0)) {
    for (const view of views) {
      const items = contentItems.filter((item) => item.moduleID === module.id && item.artifactType === view)
      if (!items.length) continue
      const scopes = items.flatMap((item) =>
        item.evidenceScope?.kind === "behavior-refs" ? [{ item, scope: item.evidenceScope }] : [],
      )
      if (scopes.length !== items.length) {
        issues.push({
          code: "RELATION_COVERAGE_METADATA_MISSING",
          message: `模块 ${module.path} 的 ${view} 缺少逐关系覆盖元数据，禁止把抽样图发布为完整设计。`,
          workItemIDs: items.map((item) => item.id),
        })
        continue
      }
      const totals = new Set(scopes.map(({ scope }) => scope.coverageTotal))
      const hashes = new Set(scopes.map(({ scope }) => scope.coverageSetHash))
      const details = scopes.filter(({ scope }) => scope.coverageRole === "detail")
      const overviews = scopes.filter(({ scope }) => scope.coverageRole === "overview")
      const detailRefs = details.flatMap(({ scope }) => scope.values)
      const unique = [...new Set(detailRefs)].sort()
      const total = [...totals][0] ?? 0
      const workItemIDs = scopes.map(({ item }) => item.id)
      if (totals.size !== 1 || hashes.size !== 1 || total !== unique.length || detailRefs.length !== unique.length) {
        issues.push({
          code: "RELATION_COVERAGE_INCOMPLETE",
          message: `模块 ${module.path} 的 ${view} 关系分图未形成无遗漏、无重复的完整集合：期望 ${total} 条，实际唯一覆盖 ${unique.length} 条。`,
          workItemIDs,
        })
        continue
      }
      const actualHash = createHash("sha256").update(unique.join("\n")).digest("hex")
      if (actualHash !== [...hashes][0]) {
        issues.push({
          code: "RELATION_COVERAGE_HASH_MISMATCH",
          message: `模块 ${module.path} 的 ${view} 关系集合哈希不匹配，源码关系图集可能被替换或截断。`,
          workItemIDs,
        })
      }
      if (details.length > 1 && overviews.length !== 1) {
        issues.push({
          code: "RELATION_OVERVIEW_REQUIRED",
          message: `模块 ${module.path} 的 ${view} 已拆为 ${details.length} 张分图，但缺少唯一的导航总览。`,
          workItemIDs,
        })
      }
      if (total >= 8 && details.some(({ scope }) => scope.values.length < 4)) {
        issues.push({
          code: "RELATION_DIAGRAM_TOO_FRAGMENTED",
          message: `模块 ${module.path} 的 ${view} 存在少于 4 条关系的碎片图；应重新平衡分图，而不是发布只有一两条边的图片。`,
          workItemIDs,
        })
      }
    }
  }
  return issues
}

export async function assembleDesignDocument(workspace: string, job: DesignDocJob) {
  const contentItems = job.workItems.filter((item) => item.artifactType !== "review")
  if (!contentItems.length || contentItems.some((item) => item.status !== "passed")) {
    throw new Error("所有必需 WorkItem 通过前禁止组装正式文档")
  }
  const quality = await buildQualityReport(job)
  if (!quality.passed) throw new Error("质量报告未通过，禁止发布正式文档")
  if (job.config.documentProfile === "source-backed-full") {
    const full = await assembleFullDesignDocument(workspace, job, quality)
    return { ...full, quality }
  }
  if (job.config.documentProfile === "product-detailed-design-v2") {
    const product = await assembleProductDesignDocument(workspace, job, quality)
    return { ...product, quality }
  }

  const manifestArtifact = job.artifacts.find((artifact) => artifact.kind === "manifest")
  if (!manifestArtifact) throw new Error("Job 缺少 Module Manifest")
  const manifestValue = await DesignDocStore.readDeclaredArtifact(job, manifestArtifact.id)
  const manifest = await Schema.decodeUnknownPromise(ModuleManifestSchema)(
    JSON.parse(manifestValue.content.toString("utf8")),
  )
  const modules = new Map(manifest.modules.map((module) => [module.id, module]))
  const values = await readPassedArtifacts(job, contentItems)
  const lines = [
    `# ${job.config.targetPath} 详细设计文档`,
    "",
    "## 1. 文档范围",
    "",
    `- 工作区：${job.workspace}`,
    `- 目标模块：${job.config.targetPath}`,
    `- 源码快照：${quality.sourceSnapshotHashes.join("、")}`,
    "",
    "## 2. 模块树",
    "",
    ...moduleTreeLines(manifest),
    "",
    "## 3. 模块覆盖矩阵",
    "",
    "| 模块 | 设计视角 | 状态 | 模型尝试 | 校验错误 | 校验警告 |",
    "|---|---|---:|---:|---:|---:|",
    ...quality.workItems.map(
      (item) =>
        `| ${modules.get(item.moduleID)?.path ?? item.moduleID} | ${item.artifactType}${item.evidenceScope ? ` / ${item.evidenceScope}` : ""} | ${item.status} | ${item.attempts} | ${item.errorCount} | ${item.warningCount} |`,
    ),
    "",
    "## 4. 模块职责与边界",
    "",
  ]

  for (const module of manifest.modules) {
    const overviews = values.filter(
      (value) => value.item.moduleID === module.id && value.item.artifactType === "overview",
    )
    lines.push(`### ${module.name}`, "", overviews[0] ? irSummary(overviews[0].ir) : `模块边界为 ${module.path}。`, "")
    const responsibilities = overviews.flatMap((value) =>
      value.ir.viewType === "overview" ? value.ir.responsibilities : [],
    )
    const boundaries = overviews.flatMap((value) => (value.ir.viewType === "overview" ? value.ir.boundaries : []))
    for (const claim of responsibilities) {
      lines.push(`- 职责：${claim.text}（${claim.evidenceIDs.join("、")}）`)
    }
    for (const claim of boundaries) {
      lines.push(`- 边界：${claim.text}（${claim.evidenceIDs.join("、")}）`)
    }
    lines.push(`- 生产源码文件：${module.sourceFiles.length}`)
    lines.push(`- 测试文件：${module.testFiles.length}`)
    lines.push(`- 支持语言：${module.languages.join("、") || "未识别"}`, "")
    for (const overview of overviews) {
      lines.push(
        `#### 组件概览${overview.item.evidenceScope ? ` / ${overview.item.evidenceScope.label}` : ""}`,
        "",
        irSummary(overview.ir),
        "",
        "```mermaid",
        overview.mermaid,
        "```",
        "",
      )
    }
  }

  lines.push("## 5. 接口与入口", "")
  appendEvidenceFacts(lines, values, new Set(["code-symbol", "flow-node"]), "未发现已验证的接口或执行入口证据。")
  lines.push("## 6. 内部结构", "")
  appendViews(lines, values, new Set(["code-structure", "structure"]))
  lines.push("## 7. 依赖关系", "")
  appendEvidenceFacts(lines, values, new Set(["dependency"]), "未发现已验证的源码依赖关系。")
  lines.push("## 8. 执行流程与调用时序", "")
  appendViews(lines, values, new Set(["execution-flow", "sequence"]))
  lines.push("## 9. 数据流", "")
  appendViews(lines, values, new Set(["data-flow"]))
  lines.push("## 10. 状态、生命周期与异常流程", "")
  appendViews(lines, values, new Set(["lifecycle", "error-flow"]))
  lines.push("## 11. 配置与约束", "")
  appendEvidenceFacts(lines, values, new Set(["configuration"]), "未发现已验证的运行配置读取。")
  lines.push(
    `- 证据包上限：${job.config.evidenceBudget.maxItems} 条、${job.config.evidenceBudget.maxPromptBytes} 字节。`,
  )
  lines.push(`- 单项自动尝试上限：${job.config.retryPolicy.maxAttempts}。`)
  lines.push(`- Worker 普通工具权限：全部禁用；源码只能来自 Evidence Pack。`)
  lines.push("- 当前版本未发现可由受支持源码分析器确认的部署关系；不得据此推断运行环境。", "")
  lines.push("## 12. 源码证据索引", "")
  for (const value of values) {
    lines.push(
      `### ${modules.get(value.item.moduleID)?.name ?? value.item.moduleID} / ${value.item.artifactType}${value.item.evidenceScope ? ` / ${value.item.evidenceScope.label}` : ""}`,
      "",
    )
    for (const evidence of value.pack.evidence) {
      lines.push(`- ${evidence.id}：${evidence.fact}（${evidence.source.path}:${evidence.source.startLine}）`)
    }
    lines.push("")
  }
  lines.push("## 13. 推断与待确认项", "")
  const unknowns = values.flatMap((value) => value.pack.unknowns.map((text) => ({ item: value.item, text })))
  if (!unknowns.length) lines.push("- 无。", "")
  else {
    for (const unknown of unknowns) {
      lines.push(
        `- ${unknown.item.moduleID} / ${unknown.item.artifactType}${unknown.item.evidenceScope ? ` / ${unknown.item.evidenceScope.label}` : ""}：${unknown.text}`,
      )
    }
    lines.push("")
  }
  lines.push(
    "## 14. 生成质量报告",
    "",
    `- 必需产物：${quality.metrics.requiredArtifacts}`,
    `- 通过产物：${quality.metrics.passedArtifacts}`,
    `- 源码证据：${quality.metrics.evidenceCount}`,
    `- 模型尝试：${quality.metrics.modelAttempts}`,
    `- 修复尝试：${quality.metrics.retryAttempts}`,
    `- Token 消耗：${quality.metrics.totalTokens}`,
    `- 模型成本：${quality.metrics.totalCost}`,
    `- 总耗时：${quality.metrics.totalDurationMs} ms`,
    `- Schema 通过率：${(quality.metrics.schemaPassRate * 100).toFixed(2)}%`,
    `- 证据覆盖率：${(quality.metrics.evidenceCoverageRate * 100).toFixed(2)}%`,
    `- 图渲染成功率：${(quality.metrics.renderSuccessRate * 100).toFixed(2)}%`,
    `- 跨视角重复问题：${quality.issues.length}`,
    "- 最终完成状态由程序计算，模型无权发布文档。",
    "",
  )

  const embeddedViews = lines.filter((line) => line === "```mermaid").length
  if (embeddedViews !== values.length) {
    throw new Error(`最终文档图视角不完整：应为 ${values.length}，实际为 ${embeddedViews}`)
  }

  const document = await DesignDocStore.writeText(
    workspace,
    job.id,
    "design-doc.md",
    `${lines.join("\n")}\n`,
    "text/markdown",
  )
  return { document, quality }
}

interface PassedValue {
  item: DesignDocJob["workItems"][number]
  ir: ParsedDesignDocIR
  mermaid: string
  pack: ParsedEvidencePack
}

async function readPassedArtifacts(job: DesignDocJob, items: DesignDocJob["workItems"]): Promise<PassedValue[]> {
  return Promise.all(
    items.map(async (item) => {
      const find = (kind: "ir" | "mermaid" | "evidence-pack") =>
        job.artifacts.find(
          (artifact) => artifact.workItemID === item.id && artifact.kind === kind && artifact.status === "passed",
        )
      const irArtifact = find("ir")
      const mermaidArtifact = find("mermaid")
      const packArtifact = find("evidence-pack")
      if (!irArtifact || !mermaidArtifact || !packArtifact) {
        throw new Error(`WorkItem ${item.id} 缺少已通过 IR、Mermaid 或 Evidence Pack`)
      }
      const [irValue, mermaidValue, packValue] = await Promise.all([
        DesignDocStore.readDeclaredArtifact(job, irArtifact.id),
        DesignDocStore.readDeclaredArtifact(job, mermaidArtifact.id),
        DesignDocStore.readDeclaredArtifact(job, packArtifact.id),
      ])
      return {
        item,
        ir: await Schema.decodeUnknownPromise(DiagramIR)(JSON.parse(irValue.content.toString("utf8"))),
        mermaid: mermaidValue.content.toString("utf8").trim(),
        pack: await Schema.decodeUnknownPromise(EvidencePackSchema)(JSON.parse(packValue.content.toString("utf8"))),
      }
    }),
  )
}

function appendViews(lines: string[], values: PassedValue[], kinds: Set<string>) {
  const selected = values.filter((value) => kinds.has(value.item.artifactType))
  if (!selected.length) {
    lines.push("本次 Manifest 未要求该设计视角。", "")
    return
  }
  for (const value of selected) {
    lines.push(
      `### ${value.item.moduleID} / ${value.item.artifactType}${value.item.evidenceScope ? ` / ${value.item.evidenceScope.label}` : ""}`,
      "",
      irSummary(value.ir),
      "",
      "```mermaid",
    )
    lines.push(value.mermaid, "```", "")
  }
}

function appendEvidenceFacts(lines: string[], values: PassedValue[], kinds: Set<string>, empty: string) {
  const facts = new Map<string, ParsedEvidencePack["evidence"][number]>()
  for (const value of values) {
    for (const evidence of value.pack.evidence) if (kinds.has(evidence.kind)) facts.set(evidence.id, evidence)
  }
  if (!facts.size) lines.push(empty, "")
  else {
    for (const evidence of facts.values()) lines.push(`- ${evidence.fact}（${evidence.id}）`)
    lines.push("")
  }
}

async function readPassedIRs(job: DesignDocJob): Promise<PassedIR[]> {
  const artifacts = new Map(
    job.artifacts
      .filter((item) => item.kind === "ir" && item.status === "passed")
      .map((artifact) => [artifact.workItemID, artifact]),
  )
  return Promise.all(
    [...artifacts.values()].map(async (artifact) => {
      const value = await DesignDocStore.readDeclaredArtifact(job, artifact.id)
      return {
        workItemID: artifact.workItemID,
        ir: await Schema.decodeUnknownPromise(DiagramIR)(JSON.parse(value.content.toString("utf8"))),
      }
    }),
  )
}

function duplicateViewIssues(values: PassedIR[]) {
  const semanticFingerprints = new Map<string, PassedIR>()
  const endpointFingerprints = new Map<string, PassedIR[]>()
  const issues: DesignDocQualityReport["issues"] = []
  for (const value of values) {
    const fingerprint = graphFingerprint(value.ir)
    if (!fingerprint) continue
    const previous = semanticFingerprints.get(fingerprint)
    if (previous && previous.workItemID !== value.workItemID) {
      issues.push({
        code: "DUPLICATE_VIEW_SEMANTICS",
        message: `WorkItem ${previous.workItemID} 与 ${value.workItemID} 的节点和关系语义完全相同`,
        workItemIDs: [previous.workItemID, value.workItemID],
      })
      continue
    }
    semanticFingerprints.set(fingerprint, value)
    const endpointFingerprint = graphEndpointFingerprint(value.ir)
    if (!endpointFingerprint) continue
    const endpointPeers = endpointFingerprints.get(endpointFingerprint) ?? []
    const crossView = endpointPeers.find((candidate) => candidate.ir.viewType !== value.ir.viewType)
    if (crossView) {
      issues.push({
        code: "DUPLICATE_VIEW_SEMANTICS",
        message: `WorkItem ${crossView.workItemID} 与 ${value.workItemID} 仅更换视角名称，节点和关系端点完全相同`,
        workItemIDs: [crossView.workItemID, value.workItemID],
      })
    }
    endpointPeers.push(value)
    endpointFingerprints.set(endpointFingerprint, endpointPeers)
  }
  return issues
}

async function contentConsistencyIssues(
  job: DesignDocJob,
  items: DesignDocJob["workItems"],
  packs: ParsedEvidencePack[],
  values: PassedIR[],
) {
  const issues: DesignDocQualityReport["issues"] = []
  const byWorkItem = new Map(values.map((value) => [value.workItemID, value.ir]))
  const internal =
    /\b(?:Evidence Pack|WorkItem|DesignUnit)\b|topic-evidence-[a-z-]+|\bMOD-[a-f0-9]{20}\b|\bflow-(?:node|edge)\b|证据包|工作项|设计单元|内部流水线|代表性采样|已采样|采样证据/iu
  const limitation =
    /(?:(?:当前|完整|已采样|上述)?(?:源码|证据|材料|证据包).{0,16}(?:未发现|没有|不足|未覆盖|无法证明|不能确认|仅能确认|只能确认)|(?:未发现|没有|不足|未覆盖|无法证明|不能确认|仅能确认|只能确认).{0,16}(?:源码|证据|实现|调用|函数体|分支|循环|细节))/u

  for (const item of items) {
    const ir = byWorkItem.get(item.id)
    if (!ir) continue
    for (const text of readerFacingTexts(ir)) {
      if (text.includes("…")) {
        issues.push({
          code: "TRUNCATED_READER_TEXT",
          message: `WorkItem ${item.id} 的读者正文包含人为省略号，禁止发布截断内容。`,
          workItemIDs: [item.id],
        })
        break
      }
      const match = text.match(internal)
      if (!match) continue
      issues.push({
        code: "INTERNAL_PIPELINE_TERM",
        message: `WorkItem ${item.id} 的读者正文包含内部流水线术语“${match[0]}”。`,
        workItemIDs: [item.id],
      })
      break
    }
    if (ir.viewType !== "topic") continue
    const epistemicFacts = [
      ir.summary,
      ...ir.conclusions.map((claim) => claim.text),
      ...ir.mechanisms.map((claim) => claim.text),
      ...ir.flows.map((claim) => claim.text),
      ...ir.exceptions.map((claim) => claim.text),
      ...ir.constraints.map((claim) => claim.text),
    ]
    if (ir.applicability === "applicable" && epistemicFacts.some((text) => limitation.test(text))) {
      issues.push({
        code: "EPISTEMIC_LIMITATION_IN_READER_FACT",
        message: `WorkItem ${item.id} 把证据局限写成了正文事实；局限应进入待确认项。`,
        workItemIDs: [item.id],
      })
    }
    if (ir.applicability !== "not-applicable") continue
    const contradictoryPacks = packs.filter(
      (pack) =>
        pack.moduleID === item.moduleID &&
        pack.evidence.some(
          (evidence) =>
            evidence.confidence === "explicit" &&
            evidence.source.sourceKind !== "test" &&
            topicEvidenceApplies(ir.topic, evidence as Parameters<typeof topicEvidenceApplies>[1]),
        ),
    )
    const contradictoryDiagrams = items.filter((candidate) => {
      if (candidate.moduleID !== item.moduleID || candidate.purpose?.kind !== "diagram") return false
      if (candidate.purpose.topic !== ir.topic) return false
      const diagram = byWorkItem.get(candidate.id)
      return diagram !== undefined && diagram.viewType !== "not-applicable"
    })
    if (!contradictoryPacks.length && !contradictoryDiagrams.length) continue
    issues.push({
      code: "TOPIC_APPLICABILITY_CONTRADICTION",
      message: `主题“${ir.topic}”被标记为不适用，但同一模块的完整证据或对应图已经证明该主题适用。`,
      workItemIDs: [item.id, ...contradictoryDiagrams.map((candidate) => candidate.id)],
    })
  }

  for (const artifact of job.artifacts.filter((item) => item.kind === "mermaid" && item.status === "passed")) {
    const value = await DesignDocStore.readDeclaredArtifact(job, artifact.id)
    if (!value.content.toString("utf8").includes("…")) continue
    issues.push({
      code: "TRUNCATED_DIAGRAM_TEXT",
      message: `WorkItem ${artifact.workItemID} 的 Mermaid 含有人为省略号，禁止发布截断图。`,
      workItemIDs: [artifact.workItemID],
    })
  }
  return issues
}

function readerFacingTexts(ir: ParsedDesignDocIR) {
  const keys = new Set([
    "title",
    "summary",
    "label",
    "text",
    "description",
    "businessMeaning",
    "trigger",
    "guard",
    "action",
    "condition",
    "reason",
  ])
  const texts: string[] = []
  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string") {
      if (key && keys.has(key)) texts.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key)
      return
    }
    if (!isRecord(value)) return
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey)
  }
  visit(ir)
  return texts
}

function missingRequiredArtifactIssues(
  job: DesignDocJob,
  manifest: ParsedModuleManifest | undefined,
  contentItems: DesignDocJob["workItems"],
  packs: ParsedEvidencePack[],
) {
  const issues: DesignDocQualityReport["issues"] = []
  if (!manifest) {
    return [{ code: "MODULE_MANIFEST_MISSING", message: "缺少模块清单，无法证明模块覆盖完整", workItemIDs: [] }]
  }
  const artifactTypes = job.config.artifactTypes.filter((artifactType) => artifactType !== "review")
  const modules = manifest.modules.filter((module) => module.sourceFiles.length + module.testFiles.length > 0)
  for (const module of modules) {
    for (const artifactType of artifactTypes) {
      const matches = contentItems.filter((item) => item.moduleID === module.id && item.artifactType === artifactType)
      if (matches.length) continue
      issues.push({
        code: "MISSING_REQUIRED_ARTIFACT",
        message: `模块 ${module.path} 缺少必需设计视角 ${artifactType}`,
        workItemIDs: [],
      })
    }
    const modulePacks = packs.filter((pack) =>
      contentItems.some((item) => item.id === pack.workItemID && item.moduleID === module.id),
    )
    for (const artifactType of artifactTypes.filter(
      (item) => item === "overview" || item === "structure" || item === "code-structure",
    )) {
      const matches = contentItems.filter((item) => item.moduleID === module.id && item.artifactType === artifactType)
      const covered = new Set(
        (job.config.documentProfile === "source-backed-full"
          ? modulePacks
          : packs.filter((pack) => matches.some((item) => item.id === pack.workItemID))
        ).flatMap((pack) =>
          pack.evidence.flatMap((evidence) =>
            evidence.kind === "source-file" &&
            evidence.confidence === "explicit" &&
            evidence.source.sourceKind === "production" &&
            typeof evidence.attributes.ref === "string"
              ? [evidence.attributes.ref]
              : [],
          ),
        ),
      )
      const missingFiles = module.sourceFiles.filter((path) => !covered.has(path))
      if (!matches.length || !missingFiles.length) continue
      issues.push({
        code: "MISSING_SOURCE_FILE_COVERAGE",
        message: `模块 ${module.path} 的 ${artifactType} 缺少 ${missingFiles.length} 个生产源码文件：${missingFiles.join("、")}`,
        workItemIDs: matches.map((item) => item.id),
      })
    }
  }
  return issues
}

function graphFingerprint(ir: ParsedDesignDocIR) {
  const graph = graphParts(ir)
  if (!graph) return undefined
  const normalized = graph.relations
    .map((relation) => ({
      from: graph.refs.get(String(relation.from)),
      to: graph.refs.get(String(relation.to)),
      kind: String(relation.kind ?? relation.type ?? ""),
      label: String(relation.label ?? relation.trigger ?? relation.action ?? ""),
      condition: String(relation.condition ?? relation.guard ?? ""),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return JSON.stringify({ viewType: ir.viewType, nodes: [...graph.refs.values()].sort(), relations: normalized })
}

function graphEndpointFingerprint(ir: ParsedDesignDocIR) {
  const graph = graphParts(ir)
  if (!graph) return undefined
  const normalized = graph.relations
    .map((relation) => [graph.refs.get(String(relation.from)), graph.refs.get(String(relation.to))])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return JSON.stringify({ nodes: [...graph.refs.values()].sort(), relations: normalized })
}

function graphParts(ir: ParsedDesignDocIR) {
  const record: Record<string, unknown> = ir
  const relationKey = ["edges", "transitions", "messages", "flows", "relations"].find((key) =>
    Array.isArray(record[key]),
  )
  const nodeKey = ["nodes", "states", "participants", "entities", "activities"].find((key) =>
    Array.isArray(record[key]),
  )
  if (!relationKey || !nodeKey) return undefined
  const nodes = record[nodeKey]
  const relations = record[relationKey]
  if (!Array.isArray(nodes) || !nodes.every(isRecord) || !Array.isArray(relations) || !relations.every(isRecord))
    return undefined
  if (nodes.length < 2 || !relations.length) return undefined
  const refs = new Map(
    nodes.map((node) => {
      const ref = String(node.sourceRef ?? node.sourceValue ?? node.label ?? node.id)
      const semantic =
        ir.viewType === "business-flow"
          ? `${ref}::${String(node.kind ?? "activity")}::${String(node.businessMeaning ?? "")}`
          : ref
      return [String(node.id), semantic]
    }),
  )
  return { refs, relations }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function irSummary(ir: ParsedDesignDocIR) {
  return ir.viewType === "not-applicable" ? ir.reason : ir.summary
}

function moduleTreeLines(manifest: ParsedModuleManifest) {
  const children = new Map<string | undefined, Array<ParsedModuleManifest["modules"][number]>>()
  for (const module of manifest.modules) {
    const values = children.get(module.parentID) ?? []
    values.push(module)
    children.set(module.parentID, values)
  }
  const lines: string[] = []
  const visit = (parentID: string | undefined, depth: number) => {
    for (const module of children.get(parentID) ?? []) {
      lines.push(`${"  ".repeat(depth)}- ${module.name}（${module.path}）`)
      visit(module.id, depth + 1)
    }
  }
  visit(undefined, 0)
  return lines
}
