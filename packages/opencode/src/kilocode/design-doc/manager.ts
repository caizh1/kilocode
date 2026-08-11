import { Cause, Effect, Exit, Schema } from "effect"
import { createHash } from "crypto"
import { ulid } from "ulid"
import path from "path"
import {
  DesignDocDiscoveryError,
  type BehaviorExtractionResult,
  type CodeStructureExtractionResult,
  type DiscoveredDesignDocModule,
  type DiscoveredDesignDocModuleTree,
  type LifecycleExtractionResult,
  type OverviewExtractionResult,
  type ProductExtractionResult,
  type RawProductEvidence,
  type StructureExtractionResult,
  type TopicExtractionResult,
  discoverDesignDocModules,
  discoverDesignDocUnits,
  discoverLogicalDesignDocUnits,
  extractBehaviorEvidence,
  extractRootComponentBehaviorEvidence,
  extractCodeStructureEvidence,
  extractLifecycleEvidence,
  extractOverviewEvidence,
  extractProductEvidence,
  extractStructureEvidence,
  extractTopicEvidence,
} from "@kilocode/kilo-indexing/design-doc"
import { Bus } from "@/bus"
import { BackgroundJob } from "@/background/job"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"
import { isInterrupted } from "@/kilocode/effect/cause"
import { provide as provideInstance } from "@/kilocode/instance"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import {
  type Artifact,
  type ArtifactType,
  type CreateJobInput,
  type DesignDocIR,
  type DesignDocJob,
  type EvidencePack,
  EvidencePack as EvidencePackSchema,
  type EvidenceScope,
  type JobConfig,
  type ModelReference,
  type RetryWorkItemInput,
  type ValidationIssue,
  type ValidationReport,
  ValidationReport as ValidationReportSchema,
  type WorkItem,
  consumedAttempts,
  progress,
} from "./domain"
import { DesignDocJobUpdated } from "./event"
import {
  buildEvidencePack,
  buildBehaviorEvidencePack,
  buildCodeStructureEvidencePack,
  buildOverviewEvidencePack,
  buildProductEvidencePack,
  buildTopicEvidencePack,
  buildStructureEvidencePack,
  EvidenceBudgetError,
  hasSufficientLifecycleEvidence,
  hasSufficientBehaviorEvidence,
  hasSufficientCodeStructureEvidence,
  hasSufficientOverviewEvidence,
  hasSufficientProductEvidence,
  hasSufficientTopicEvidence,
  hasSufficientStructureEvidence,
} from "./evidence"
import { buildModuleManifest } from "./manifest"
import { buildFullDesignWorkItems, topicTitle } from "./content-contract"
import { buildProductDesignWorkItems, productSectionTitle } from "./product-contract"
import {
  renderCodeStructure,
  renderBusinessFlow,
  renderDataFlow,
  renderErrorFlow,
  renderExecutionFlow,
  renderLifecycle,
  renderOverview,
  renderSequence,
  renderStructure,
  renderedDiagramParts,
} from "./renderer"
import {
  createWorkerSession,
  DesignDocModelTimeoutError,
  DesignDocSessionInterruptedError,
  DesignDocWorkerResponseError,
  promptWorker,
} from "./session-runner"
import { artifact, DesignDocStore, JobStoreError } from "./store"
import { assembleDesignDocument, buildQualityReport } from "./assembler"
import { validateLifecycle } from "./validator"
import { validateStructure } from "./structure-validator"
import { validateCodeStructure } from "./code-structure-validator"
import { validateOverview } from "./overview-validator"
import { validateTopic } from "./topic-validator"
import { validateReaderContent } from "./reader-validator"
import { validateProductSection } from "./product-validator"
import { validateBusinessFlow } from "./business-flow-validator"
import { validateDataFlow, validateErrorFlow, validateExecutionFlow, validateSequence } from "./behavior-validator"

type RunningJob = {
  workspace: string
  sessionIDs: Set<string>
}

export type DesignDocExtraction =
  | LifecycleExtractionResult
  | StructureExtractionResult
  | CodeStructureExtractionResult
  | BehaviorExtractionResult
  | OverviewExtractionResult
  | ProductExtractionResult
  | TopicExtractionResult

const running = new Map<string, RunningJob>()
const launching = new Set<string>()

export class DesignDocManagerError extends Error {
  constructor(
    readonly code:
      | "JOB_NOT_FOUND"
      | "INVALID_JOB_STATE"
      | "WORK_ITEM_NOT_FOUND"
      | "RETRY_LIMIT_EXHAUSTED"
      | "UNSUPPORTED_CONFIG"
      | "INVALID_ARTIFACT",
    message: string,
  ) {
    super(message)
    this.name = "DesignDocManagerError"
  }
}

export namespace DesignDocManager {
  export function start(input: CreateJobInput) {
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const workspace = workspaceRoot(ctx)
      yield* ensureRecovered(workspace)
      const now = Date.now()
      const jobID = ulid()
      const targetPath = path.relative(workspace, path.resolve(ctx.directory, input.targetPath)) || "."
      const config = yield* Effect.try({
        try: () => configFor(input, targetPath),
        catch: (error) =>
          new DesignDocManagerError(
            "UNSUPPORTED_CONFIG",
            error instanceof Error ? error.message : String(error),
          ),
      })
      const content = config.artifactTypes.filter((artifactType) => artifactType !== "review")
      if (!content.length) return yield* Effect.fail(new Error("至少选择一个 review 以外的设计产物"))
      const workItems = content.map(
        (artifactType): WorkItem => ({
          id: `WI-${ulid()}`,
          moduleID: "pending",
          artifactType,
          status: "pending",
          dependencies: [],
          attempts: [],
          artifactIDs: [],
          createdAt: now,
          updatedAt: now,
        }),
      )
      if (config.artifactTypes.includes("review")) {
        workItems.push({
          id: `WI-${ulid()}`,
          moduleID: "pending",
          artifactType: "review",
          status: "pending",
          dependencies: workItems.map((item) => item.id),
          attempts: [],
          artifactIDs: [],
          createdAt: now,
          updatedAt: now,
        })
      }
      const job: DesignDocJob = {
        schemaVersion: 1,
        id: jobID,
        revision: 0,
        status: "created",
        workspace,
        ...(input.ownerSessionID ? { ownerSessionID: input.ownerSessionID } : {}),
        config,
        workItems,
        artifacts: [],
        progress: progress(workItems),
        createdAt: now,
        updatedAt: now,
      }
      yield* Effect.promise(() => DesignDocStore.create(job))
      yield* publish(job)
      yield* launch(job.workspace, job.id)
      return job
    })
  }

  export function list() {
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const workspace = workspaceRoot(ctx)
      yield* ensureRecovered(workspace)
      return yield* Effect.promise(() => DesignDocStore.list(workspace))
    })
  }

  export function get(jobID: string) {
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const workspace = workspaceRoot(ctx)
      yield* ensureRecovered(workspace)
      return yield* read(workspace, jobID)
    })
  }

  export function pause(jobID: string) {
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const workspace = workspaceRoot(ctx)
      const current = yield* read(workspace, jobID)
      if (["completed", "cancelled", "failed", "blocked"].includes(current.status)) {
        return yield* Effect.fail(new DesignDocManagerError("INVALID_JOB_STATE", `状态 ${current.status} 不能暂停`))
      }
      const next = yield* change(workspace, jobID, (job) => {
        const resumeFrom = job.status === "paused" ? job.resumeFrom : job.status
        job.status = "paused"
        job.resumeFrom = resumeFrom
        job.workItems = job.workItems.map((item) => interruptItem(item))
        job.progress = progress(job.workItems)
        return job
      })
      yield* stopRuntime(jobID)
      return next
    })
  }

  export function resume(jobID: string) {
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const workspace = workspaceRoot(ctx)
      const current = yield* read(workspace, jobID)
      if (current.status !== "paused") {
        return yield* Effect.fail(new DesignDocManagerError("INVALID_JOB_STATE", `状态 ${current.status} 不能恢复`))
      }
      const next = yield* change(
        workspace,
        jobID,
        (job) => {
          job.status = "discovering"
          delete job.resumeFrom
          job.progress = progress(job.workItems)
          return job
        },
        true,
      )
      yield* launch(workspace, jobID)
      return next
    })
  }

  export function cancel(jobID: string) {
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const workspace = workspaceRoot(ctx)
      const current = yield* read(workspace, jobID)
      if (current.status === "completed" || current.status === "cancelled") return current
      const next = yield* change(
        workspace,
        jobID,
        (job) => {
          job.status = "cancelled"
          delete job.resumeFrom
          job.workItems = job.workItems.map((item) => ({
            ...interruptItem(item),
            status: item.status === "passed" ? "passed" : "cancelled",
            updatedAt: Date.now(),
          }))
          job.progress = progress(job.workItems)
          return job
        },
        true,
      )
      yield* stopRuntime(jobID)
      return next
    })
  }

  export function retry(jobID: string, workItemID: string, input: RetryWorkItemInput = {}) {
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const workspace = workspaceRoot(ctx)
      const current = yield* read(workspace, jobID)
      const item = current.workItems.find((candidate) => candidate.id === workItemID)
      if (!item) return yield* Effect.fail(new DesignDocManagerError("WORK_ITEM_NOT_FOUND", workItemID))
      const deterministicReview =
        item.artifactType === "review" &&
        item.status === "passed" &&
        (current.status === "completed" || current.status === "failed")
      const revalidatePassed =
        item.artifactType !== "review" &&
        item.status === "passed" &&
        current.status !== "paused" &&
        current.status !== "cancelled"
      if (item.status !== "failed" && item.status !== "blocked" && !deterministicReview && !revalidatePassed) {
        return yield* Effect.fail(
          new DesignDocManagerError("INVALID_JOB_STATE", `WorkItem 状态 ${item.status} 不能重试`),
        )
      }
      const next = yield* change(
        workspace,
        jobID,
        (job) => {
          job.status = "discovering"
          delete job.lastError
          job.workItems = job.workItems.map((candidate) => {
            if (candidate.id !== workItemID) {
              if (revalidatePassed && candidate.artifactType === "review") {
                const { failure: _failure, ...clean } = candidate
                return { ...clean, status: "pending" as const, updatedAt: Date.now() }
              }
              return candidate
            }
            return {
              ...retryable(candidate),
              retryCursor: candidate.attempts.length,
              ...(revalidatePassed ? { validationReportPath: undefined } : {}),
              ...(input.model ? { modelOverride: input.model } : {}),
            }
          })
          job.progress = progress(job.workItems)
          return job
        },
        true,
      )
      yield* launch(workspace, jobID)
      return next
    })
  }

  export function artifacts(jobID: string) {
    return Effect.map(get(jobID), (job) => job.artifacts)
  }

  export function readArtifact(jobID: string, artifactID: string) {
    return Effect.gen(function* () {
      const job = yield* get(jobID)
      const value = yield* Effect.tryPromise({
        try: () => DesignDocStore.readDeclaredArtifact(job, artifactID),
        catch: (error) =>
          new DesignDocManagerError("INVALID_ARTIFACT", error instanceof Error ? error.message : String(error)),
      })
      const text = value.artifact.mediaType.startsWith("text/") || value.artifact.mediaType === "application/json"
      return {
        artifact: value.artifact,
        encoding: text ? ("utf8" as const) : ("base64" as const),
        content: text ? value.content.toString("utf8") : value.content.toString("base64"),
      }
    })
  }
}

function configFor(input: CreateJobInput, targetPath: string): JobConfig {
  const full = input.documentProfile === "source-backed-full"
  const product = input.documentProfile === "product-detailed-design-v2"
  if (product && (input.model.providerID !== "deepseek" || input.model.modelID !== "deepseek-v4-flash")) {
    throw new Error("product-detailed-design-v2 固定使用 DeepSeek 官方 provider 的 deepseek-v4-flash")
  }
  if (product && input.modelFallbacks?.length) {
    throw new Error("product-detailed-design-v2 不允许自动切换模型")
  }
  const requested = product
    ? (["product-section", "overview", "business-flow", "execution-flow", "lifecycle", "data-flow", "review"] satisfies ArtifactType[])
    : full
    ? (["overview", "review"] satisfies ArtifactType[])
    : input.artifactTypes?.length
      ? input.artifactTypes
      : [input.artifactType ?? "lifecycle"]
  return {
    targetPath,
    artifactTypes: [...new Set(requested)],
    languages: ["typescript", "tsx", "c"],
    concurrency: input.concurrency ?? 1,
    recursive: full || product ? true : (input.recursive ?? false),
    documentProfile: input.documentProfile ?? "artifact-set",
    outputFormats: input.outputFormats?.length
      ? [...new Set(input.outputFormats)]
      : full || product
        ? ["markdown", "docx"]
        : ["markdown"],
    evidenceBudget: {
      maxItems: product ? 160 : 64,
      maxPromptBytes: product ? 128 * 1024 : 48 * 1024,
      maxSnippetCharacters: 800,
    },
    atomicEvidenceBudget: {
      maxItems: 160,
      maxPromptBytes: 128 * 1024,
      maxSnippetCharacters: 400,
    },
    retryPolicy: {
      maxAttempts: input.maxAttempts ?? 3,
      timeoutMs: input.timeoutMs ?? 300_000,
      backoffMs: [0, 500, 1_000],
      retryableCodes: [
        "MODEL_TIMEOUT",
        "MODEL_API_ERROR",
        "STRUCTURED_OUTPUT_MISSING",
        "SCHEMA_INVALID",
        "VALIDATION_FAILED",
      ],
    },
    modelPolicy: {
      primary: product ? { ...input.model, variant: "thinking" } : input.model,
      fallbacks: input.modelFallbacks ? [...input.modelFallbacks] : [],
      structuredOutput: "tool-json-schema",
    },
    renderer: "mermaid",
    ...(input.referenceInputs ? { referenceInputs: input.referenceInputs.map((item) => ({ ...item })) } : {}),
    ...(input.moduleHints
      ? { moduleHints: input.moduleHints.map((hint) => ({ name: hint.name, includePaths: [...hint.includePaths] })) }
      : {}),
  }
}

function isDocumentProfile(profile?: JobConfig["documentProfile"]) {
  return profile === "source-backed-full" || profile === "product-detailed-design-v2"
}

function discoverForJob(workspace: string, job: DesignDocJob) {
  if (job.config.documentProfile === "product-detailed-design-v2") {
    return discoverLogicalDesignDocUnits({
      workspace,
      targetPath: job.config.targetPath,
      moduleHints: job.config.moduleHints,
    })
  }
  if (job.config.documentProfile === "source-backed-full") {
    return discoverDesignDocUnits({
      workspace,
      targetPath: job.config.targetPath,
    })
  }
  return discoverDesignDocModules({
    workspace,
    targetPath: job.config.targetPath,
    recursive: job.config.recursive,
  })
}

function expandModuleWorkItems(job: DesignDocJob, tree: DiscoveredDesignDocModuleTree) {
  if (!job.workItems.length || job.workItems.some((item) => item.moduleID !== "pending")) return job
  if (job.config.documentProfile === "source-backed-full") {
    const now = Date.now()
    const workItems = buildFullDesignWorkItems(
      tree.modules.filter((module) => module.files.length > 0).map((module) => module.id),
      now,
      () => `WI-${ulid()}`,
    )
    return { ...job, workItems, progress: progress(workItems) }
  }
  if (job.config.documentProfile === "product-detailed-design-v2") {
    const now = Date.now()
    const workItems = buildProductDesignWorkItems(
      tree.modules.filter((module) => module.files.length > 0).map((module) => module.id),
      now,
      () => `WI-${ulid()}`,
    )
    return { ...job, workItems, progress: progress(workItems) }
  }
  const templates = job.workItems.filter((item) => item.artifactType !== "review")
  const review = job.workItems.find((item) => item.artifactType === "review")
  const now = Date.now()
  const sourceModules = tree.modules.filter((module) => module.files.length > 0)
  const content = sourceModules.flatMap((module, moduleIndex) =>
    templates.map((template) => ({
      ...template,
      id: moduleIndex === 0 ? template.id : `WI-${ulid()}`,
      moduleID: module.id,
      dependencies: [],
      attempts: moduleIndex === 0 ? template.attempts : [],
      artifactIDs: moduleIndex === 0 ? template.artifactIDs : [],
      status: moduleIndex === 0 ? template.status : ("pending" as const),
      updatedAt: now,
    })),
  )
  const workItems = review
    ? [
        ...content,
        {
          ...review,
          moduleID: tree.rootModuleID,
          dependencies: content.map((item) => item.id),
          updatedAt: now,
        },
      ]
    : content
  return { ...job, workItems, progress: progress(workItems) }
}

function buildPack(
  artifactType: ArtifactType,
  extraction: DesignDocExtraction,
  workItemID: string,
  budget: JobConfig["evidenceBudget"],
  purpose?: WorkItem["purpose"],
  moduleName?: string,
) {
  if (artifactType === "product-section") {
    if (purpose?.kind !== "product-section") throw new Error("产品章节 WorkItem 缺少 section purpose")
    return buildProductEvidencePack({
      extraction: extraction as ProductExtractionResult,
      workItemID,
      moduleName,
      purpose,
      ...budget,
    })
  }
  if (artifactType === "topic") {
    const topicPurpose = purpose?.kind === "topic" ? purpose : ({ kind: "topic", topic: "responsibilities" } as const)
    return buildTopicEvidencePack({
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Topic 复用组合概览证据。
      extraction: extraction as TopicExtractionResult,
      workItemID,
      moduleName,
      purpose: topicPurpose,
      ...budget,
    })
  }
  if (artifactType === "structure") {
    return buildStructureEvidencePack({
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 提取器由同一 artifactType 分支选择。
      extraction: extraction as StructureExtractionResult,
      workItemID,
      moduleName,
      ...budget,
    })
  }
  if (artifactType === "code-structure") {
    return buildCodeStructureEvidencePack({
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 提取器由同一 artifactType 分支选择。
      extraction: extraction as CodeStructureExtractionResult,
      workItemID,
      moduleName,
      ...budget,
    })
  }
  if (artifactType === "overview") {
    return buildOverviewEvidencePack({
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 提取器由同一 artifactType 分支选择。
      extraction: extraction as OverviewExtractionResult,
      workItemID,
      moduleName,
      ...budget,
    })
  }
  if (
    artifactType === "execution-flow" ||
    artifactType === "business-flow" ||
    artifactType === "sequence" ||
    artifactType === "data-flow" ||
    artifactType === "error-flow"
  ) {
    const pack = buildBehaviorEvidencePack({
      artifactType,
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 提取器由同一 artifactType 分支选择。
      extraction: extraction as BehaviorExtractionResult,
      workItemID,
      moduleName,
      ...budget,
    })
    return purpose ? { ...pack, purpose } : pack
  }
  return buildEvidencePack({
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 提取器由同一 artifactType 分支选择。
    extraction: extraction as LifecycleExtractionResult,
    workItemID,
    moduleName,
    ...budget,
  })
}

function extractFor(
  workspace: string,
  artifactType: ArtifactType,
  module: DiscoveredDesignDocModule,
  purpose?: WorkItem["purpose"],
  config?: JobConfig,
  tree?: DiscoveredDesignDocModuleTree,
) {
  if (artifactType === "product-section") {
    if (purpose?.kind !== "product-section") throw new Error("产品章节 WorkItem 缺少 section purpose")
    return extractProductEvidence({
      workspace,
      module,
      section: purpose.section,
      references: config?.referenceInputs,
    }).then((result) => addLogicalModuleEvidence(result, module, tree))
  }
  if (artifactType === "structure") return extractStructureEvidence(module)
  if (artifactType === "code-structure") return extractCodeStructureEvidence(module)
  if (artifactType === "overview") return extractOverviewEvidence(module)
  if (artifactType === "topic") {
    if (purpose?.kind !== "topic") throw new Error("Topic WorkItem 缺少主题 purpose")
    return extractTopicEvidence(module, purpose.topic)
  }
  if (
    artifactType === "execution-flow" ||
    artifactType === "business-flow" ||
    artifactType === "sequence" ||
    artifactType === "data-flow" ||
    artifactType === "error-flow"
  ) {
    if (module.unitKind === "root" && isDocumentProfile(config?.documentProfile)) {
      return extractRootComponentBehaviorEvidence(module)
    }
    return extractBehaviorEvidence(module)
  }
  return extractLifecycleEvidence(module)
}

function addLogicalModuleEvidence(
  result: ProductExtractionResult,
  module: DiscoveredDesignDocModule,
  tree?: DiscoveredDesignDocModuleTree,
): ProductExtractionResult {
  if (!tree) return result
  const scoped = scopeProductEvidenceToLogicalOwner(result, module, tree)
  if (!["module-overview", "overall-structure"].includes(result.section)) return scoped
  const children = tree.modules.filter((candidate) => candidate.parentID === module.id)
  if (!children.length) return scoped
  const evidence: RawProductEvidence[] = children.flatMap((child) => {
    const source = child.files.find((file) => file.sourceKind === "production")
    if (!source) return []
    return [
      {
        kind: "module-boundary",
        fact: `逻辑子模块“${child.name}”由 runtime 根据公开入口、分派、生命周期或资源所有权确认，包含 ${child.implementationFiles?.length ?? 0} 个生产实现单元`,
        source: {
          path: source.path,
          contentHash: source.contentHash,
          startLine: 1,
          endLine: 1,
          sourceKind: "production",
        },
        attributes: {
          childModuleID: child.id,
          childModuleName: child.name,
          implementationUnitCount: child.implementationFiles?.length ?? 0,
        },
        confidence: "explicit",
        snippet: child.implementationFiles?.join("\n") ?? source.path,
      },
    ]
  })
  return { ...scoped, evidence: [...evidence, ...scoped.evidence] }
}

/**
 * 根模块正文只描述根自身和真正的跨逻辑模块协作。子模块拥有的实体、算法、
 * 接口和局部流程由对应子模块 WorkItem 负责，避免在产品文档中重复展开。
 */
export function scopeProductEvidenceToLogicalOwner(
  result: ProductExtractionResult,
  module: DiscoveredDesignDocModule,
  tree: DiscoveredDesignDocModuleTree,
): ProductExtractionResult {
  if (module.id !== tree.rootModuleID || ["module-overview", "overall-structure"].includes(result.section)) {
    return result
  }
  const ownership = new Map((tree.ownership ?? []).map((item) => [item.path, item.ownerModuleID]))
  if (!ownership.size) return result
  const evidence = result.evidence.filter((item) => {
    if (item.source.sourceKind === "document") return true
    if (ownership.get(item.source.path) === module.id) return true
    return crossesLogicalOwners(item, ownership)
  })
  return { ...result, evidence }
}

function crossesLogicalOwners(item: RawProductEvidence, ownership: Map<string, string>) {
  const from = ownerForReference(item.attributes.fromRef, ownership)
  const to = ownerForReference(item.attributes.toRef, ownership)
  return !!from && !!to && from !== to
}

function ownerForReference(value: string | number | boolean | null | undefined, ownership: Map<string, string>) {
  if (typeof value !== "string") return
  const normalized = value.replace(/^root-component(?:-data)?:/, "")
  for (const [sourcePath, owner] of ownership) {
    if (normalized === sourcePath || normalized.startsWith(`${sourcePath}#`)) return owner
  }
}

function sufficientFor(artifactType: ArtifactType, pack: EvidencePack) {
  if (artifactType === "product-section") return hasSufficientProductEvidence(pack)
  if (artifactType === "structure") return hasSufficientStructureEvidence(pack)
  if (artifactType === "code-structure") return hasSufficientCodeStructureEvidence(pack)
  if (artifactType === "overview") return hasSufficientOverviewEvidence(pack)
  if (artifactType === "topic") return hasSufficientTopicEvidence(pack)
  if (
    artifactType === "execution-flow" ||
    artifactType === "business-flow" ||
    artifactType === "sequence" ||
    artifactType === "data-flow" ||
    artifactType === "error-flow"
  ) {
    return hasSufficientBehaviorEvidence(pack)
  }
  return hasSufficientLifecycleEvidence(pack)
}

export function scopeExtraction<T extends DesignDocExtraction>(
  artifactType: ArtifactType,
  extraction: T,
  scope: EvidenceScope,
  disclose = false,
): T {
  const selected = (() => {
    if (scope.kind === "topic-evidence") {
      const refs = new Set(scope.values)
      return extraction.evidence.filter((item) => refs.has(topicEvidenceKey(item)))
    }
    if (scope.kind === "source-files") {
      const paths = new Set(scope.values)
      return extraction.evidence.filter((item) => paths.has(item.source.path))
    }
    if (scope.kind === "behavior-refs") {
      const refs = new Set(scope.values)
      const relations = extraction.evidence.filter(
        (item) => typeof item.attributes.ref === "string" && refs.has(item.attributes.ref),
      )
      const endpoints = new Set(
        relations
          .flatMap((item) => [item.attributes.fromRef, item.attributes.toRef])
          .filter((value): value is string => typeof value === "string"),
      )
      return [
        ...relations,
        ...extraction.evidence.filter(
          (item) => typeof item.attributes.ref === "string" && endpoints.has(item.attributes.ref),
        ),
      ]
    }
    const symbols = new Set(scope.kind === "source-symbol" ? [scope.value] : scope.values)
    const owned = extraction.evidence.filter(
      (item) => typeof item.source.symbol === "string" && symbols.has(item.source.symbol),
    )
    if (artifactType !== "sequence") return owned
    const participants = new Set(
      owned
        .filter((item) => item.kind === "call-message")
        .flatMap((item) => [item.attributes.fromRef, item.attributes.toRef])
        .filter((value): value is string => typeof value === "string" && !value.startsWith("external:")),
    )
    return [
      ...owned,
      ...extraction.evidence.filter(
        (item) =>
          item.kind === "flow-node" &&
          item.attributes.nodeKind === "entry" &&
          typeof item.attributes.ownerRef === "string" &&
          participants.has(item.attributes.ownerRef),
      ),
    ]
  })()
  const unique = [
    ...new Map(
      selected.map(
        (item) =>
          [
            `${item.kind}\0${item.fact}\0${item.source.path}\0${item.source.startLine}\0${String(item.attributes.ref ?? "")}`,
            item,
          ] as const,
      ),
    ).values(),
  ]
  const disclosures = disclose ? scopeDisclosures(artifactType, extraction, scope) : []
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 仅按共同 Evidence 字段过滤，保持原提取结果的判别分支。
  return {
    ...extraction,
    evidence: unique,
    unknowns: [...new Set([...extraction.unknowns, ...disclosures])],
  } as T
}

function scopeDisclosures(artifactType: ArtifactType, extraction: DesignDocExtraction, scope: EvidenceScope) {
  void artifactType
  void extraction
  void scope
  return []
}

export function planEvidenceScopes(
  artifactType: ArtifactType,
  extraction: DesignDocExtraction,
  config: JobConfig,
  purpose?: WorkItem["purpose"],
): EvidenceScope[] {
  if (artifactType === "product-section") return planProductSectionScopes(extraction, config, purpose)
  if (artifactType === "topic") return planTopicEvidenceScopes(extraction, config)
  if (artifactType === "lifecycle" || artifactType === "review") return []
  const budget = evidenceScopeBudget(artifactType, config)
  if (
    artifactType === "business-flow" ||
    artifactType === "execution-flow" ||
    artifactType === "data-flow" ||
    artifactType === "error-flow"
  ) {
    return planBehaviorRelationScopes(artifactType, extraction, budget, isDocumentProfile(config.documentProfile))
  }
  if (artifactType === "sequence") {
    const primaryKind = "call-message"
    const primary = extraction.evidence.filter(
      (item) =>
        item.kind === primaryKind &&
        item.confidence === "explicit" &&
        item.source.sourceKind !== "test" &&
        typeof item.source.symbol === "string",
    )
    const symbols = [...new Map(primary.map((item) => [item.source.symbol!, item] as const)).values()]
      .sort(
        (left, right) =>
          left.source.path.localeCompare(right.source.path) || left.source.startLine - right.source.startLine,
      )
      .map((item) => item.source.symbol!)
    const atoms = symbols.map((value) => sourceSymbolScope([value]))
    if (!atoms.length) return []
    for (const scope of atoms) {
      try {
        const pack = buildPack(artifactType, scopeExtraction(artifactType, extraction, scope), "scope-probe", budget)
        if (!sufficientFor(artifactType, pack)) return []
      } catch {
        return []
      }
    }
    const bins: Array<{ scope: Extract<EvidenceScope, { kind: "source-symbols" }>; items: number }> = []
    for (const atom of atoms) {
      const path = sourcePath(atom.values[0])
      const candidates = bins
        .filter((bin) => sourcePath(bin.scope.values[0]) === path)
        .sort((left, right) => right.items - left.items)
      let selected: (typeof candidates)[number] | undefined
      let packedItems = 0
      for (const candidate of candidates) {
        const combined = sourceSymbolScope([...candidate.scope.values, ...atom.values])
        try {
          const pack = buildPack(
            artifactType,
            scopeExtraction(artifactType, extraction, combined),
            "scope-probe",
            budget,
          )
          if (!sufficientFor(artifactType, pack)) continue
          selected = candidate
          packedItems = pack.evidence.length
          break
        } catch {
          continue
        }
      }
      if (!selected) {
        const pack = buildPack(artifactType, scopeExtraction(artifactType, extraction, atom), "scope-probe", budget)
        bins.push({ scope: atom, items: pack.evidence.length })
        continue
      }
      selected.scope = sourceSymbolScope([...selected.scope.values, ...atom.values])
      selected.items = packedItems
    }
    return bins.map((bin) => bin.scope)
  }

  const paths = [
    ...new Set(
      extraction.evidence
        .filter((item) => item.confidence === "explicit" && item.source.sourceKind !== "test")
        .map((item) => item.source.path),
    ),
  ].sort()
  const accepted: Array<{ scope: Extract<EvidenceScope, { kind: "source-files" }>; items: number }> = []
  const deferred: string[] = []
  for (const value of paths) {
    const scope = sourceFilesScope([value])
    try {
      const pack = buildPack(artifactType, scopeExtraction(artifactType, extraction, scope), "scope-probe", budget)
      if (sufficientFor(artifactType, pack)) accepted.push({ scope, items: pack.evidence.length })
      else deferred.push(value)
    } catch {
      return []
    }
  }
  for (const value of deferred) {
    let attached = false
    for (const candidate of [...accepted].sort((left, right) => left.items - right.items)) {
      const scope = sourceFilesScope([...candidate.scope.values, value])
      try {
        const pack = buildPack(artifactType, scopeExtraction(artifactType, extraction, scope), "scope-probe", budget)
        if (!sufficientFor(artifactType, pack)) continue
        candidate.scope = scope
        candidate.items = pack.evidence.length
        attached = true
        break
      } catch {
        continue
      }
    }
    if (!attached) return []
  }
  const bins: typeof accepted = []
  for (const atom of [...accepted].sort((left, right) => right.items - left.items)) {
    let selected: (typeof bins)[number] | undefined
    let packedItems = 0
    for (const candidate of [...bins].sort((left, right) => right.items - left.items)) {
      const scope = sourceFilesScope([...candidate.scope.values, ...atom.scope.values])
      try {
        const pack = buildPack(artifactType, scopeExtraction(artifactType, extraction, scope), "scope-probe", budget)
        if (!sufficientFor(artifactType, pack)) continue
        selected = candidate
        packedItems = pack.evidence.length
        break
      } catch {
        continue
      }
    }
    if (!selected) {
      bins.push(atom)
      continue
    }
    selected.scope = sourceFilesScope([...selected.scope.values, ...atom.scope.values])
    selected.items = packedItems
  }
  return bins.map((item) => item.scope)
}

function planProductSectionScopes(
  extraction: DesignDocExtraction,
  config: JobConfig,
  purpose?: WorkItem["purpose"],
) {
  if (purpose?.kind !== "product-section") return []
  if (
    ![
      "data-entities",
      "algorithms",
      "provided-interfaces",
      "required-interfaces",
      "internal-interfaces",
      "key-flows",
    ].includes(purpose.section)
  )
    return []
  const refs = [
    ...new Set(
      extraction.evidence
        .filter(
          (item) =>
            item.confidence === "explicit" &&
            typeof item.source.symbol === "string" &&
            item.source.symbol.length > 0,
        )
        .map((item) => item.source.symbol!),
    ),
  ].sort()
  if (refs.length < 2) return []
  const budget = evidenceScopeBudget("product-section", config)
  const groupSize =
    purpose.section === "data-entities"
      ? 8
      : ["provided-interfaces", "required-interfaces", "internal-interfaces"].includes(purpose.section)
        ? 6
        : 1
  const byFile = new Map<string, string[]>()
  for (const item of extraction.evidence) {
    if (item.confidence !== "explicit" || typeof item.source.symbol !== "string") continue
    const values = byFile.get(item.source.path) ?? []
    if (!values.includes(item.source.symbol)) values.push(item.source.symbol)
    byFile.set(item.source.path, values)
  }
  const grouped = [...byFile.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, values]) => chunks(values.sort(), groupSize))
  const scopes = grouped.flatMap((values) => fitProductSymbolGroup(extraction, purpose, budget, values))
  for (const scope of scopes) {
    try {
      const pack = buildPack(
        "product-section",
        scopeExtraction("product-section", extraction, scope),
        "scope-probe",
        budget,
        purpose,
      )
      if (!sufficientFor("product-section", pack)) return []
    } catch {
      return []
    }
  }
  return scopes
}

function fitProductSymbolGroup(
  extraction: DesignDocExtraction,
  purpose: Extract<WorkItem["purpose"], { kind: "product-section" }>,
  budget: ReturnType<typeof evidenceScopeBudget>,
  values: string[],
): EvidenceScope[] {
  const scope = sourceSymbolScope(values)
  try {
    const pack = buildPack(
      "product-section",
      scopeExtraction("product-section", extraction, scope),
      "scope-probe",
      budget,
      purpose,
    )
    if (sufficientFor("product-section", pack)) return [scope]
  } catch {
    // 证据包过大时按符号集合二分；不丢弃必需证据，也不靠模型自行裁剪。
  }
  if (values.length <= 1) return []
  const middle = Math.ceil(values.length / 2)
  return [
    ...fitProductSymbolGroup(extraction, purpose, budget, values.slice(0, middle)),
    ...fitProductSymbolGroup(extraction, purpose, budget, values.slice(middle)),
  ]
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

/**
 * 把完整证据分片收敛为适合最终 Word 阅读的确定性图集。
 * 原始证据仍全部进入主题说明和证据索引，模型无权决定省略哪些图。
 */
export function selectDocumentScopes(
  module: DiscoveredDesignDocModule,
  artifactType: ArtifactType,
  planned: EvidenceScope[],
): EvidenceScope[] {
  void module
  void artifactType
  return planned
}

function planBehaviorRelationScopes(
  artifactType: "business-flow" | "execution-flow" | "data-flow" | "error-flow",
  extraction: DesignDocExtraction,
  budget: ReturnType<typeof evidenceScopeBudget>,
  wordDocument: boolean,
) {
  const primaryKind = {
    "business-flow": "flow-edge",
    "execution-flow": "flow-edge",
    "data-flow": "data-flow",
    "error-flow": "error-edge",
  }[artifactType]
  const primary = extraction.evidence
    .filter(
      (item) =>
        item.kind === primaryKind &&
        item.confidence === "explicit" &&
        item.source.sourceKind !== "test" &&
        typeof item.attributes.ref === "string",
    )
    .sort(
      (left, right) =>
        left.source.path.localeCompare(right.source.path) ||
        left.source.startLine - right.source.startLine ||
        String(left.attributes.ref).localeCompare(String(right.attributes.ref)),
    )
  const allRefs = primary.map((item) => String(item.attributes.ref))
  const coverageSetHash = relationSetHash(allRefs)
  const atoms = primary.map((item) =>
    behaviorRefsScope([String(item.attributes.ref)], item.source.path, {
      coverageRole: "detail",
      coverageTotal: allRefs.length,
      coverageSetHash,
    }),
  )
  if (!atoms.length) return []
  const relationLimit = wordDocument
    ? { "business-flow": 8, "execution-flow": 10, "data-flow": 8, "error-flow": 8 }[artifactType]
    : Number.POSITIVE_INFINITY
  const bins: Array<{ scope: Extract<EvidenceScope, { kind: "behavior-refs" }>; items: number }> = []
  for (const atom of atoms) {
    const single = (() => {
      try {
        const pack = buildPack(artifactType, scopeExtraction(artifactType, extraction, atom), "scope-probe", budget)
        return sufficientFor(artifactType, pack) ? pack : undefined
      } catch {
        return undefined
      }
    })()
    if (!single) return []
    let selected: (typeof bins)[number] | undefined
    let packedItems = 0
    for (const candidate of bins.toSorted((left, right) => right.items - left.items)) {
      const combined = behaviorRefsScope([...candidate.scope.values, ...atom.values], candidate.scope.path, {
        coverageRole: "detail",
        coverageTotal: allRefs.length,
        coverageSetHash,
      })
      if (combined.values.length > relationLimit) continue
      try {
        const pack = buildPack(artifactType, scopeExtraction(artifactType, extraction, combined), "scope-probe", budget)
        if (!sufficientFor(artifactType, pack)) continue
        selected = candidate
        packedItems = pack.evidence.length
        break
      } catch {
        continue
      }
    }
    if (!selected) {
      bins.push({ scope: atom, items: single.evidence.length })
      continue
    }
    selected.scope = behaviorRefsScope([...selected.scope.values, ...atom.values], selected.scope.path, {
      coverageRole: "detail",
      coverageTotal: allRefs.length,
      coverageSetHash,
    })
    selected.items = packedItems
  }
  const focused = balanceBehaviorScopes(
    bins.map((bin) => bin.scope),
    relationLimit,
    allRefs.length,
    coverageSetHash,
  )
  if (!wordDocument || focused.length <= 1) return focused
  const entryRefs = new Set(
    extraction.evidence
      .filter(
        (item) =>
          item.kind === "flow-node" && item.attributes.nodeKind === "entry" && typeof item.attributes.ref === "string",
      )
      .map((item) => String(item.attributes.ref)),
  )
  const entryRelations = primary.filter(
    (item) => typeof item.attributes.fromRef === "string" && entryRefs.has(item.attributes.fromRef),
  )
  const priorityKinds = new Set(["branch-true", "branch-false", "loop", "return", "error"])
  const priority = [
    ...entryRelations,
    ...primary.filter((item) => priorityKinds.has(String(item.attributes.edgeKind ?? item.attributes.flowKind))),
    ...primary,
  ]
  const refs = [...new Set(priority.map((item) => String(item.attributes.ref)))].slice(0, Math.min(12, allRefs.length))
  const overview = behaviorRefsScope(refs, primary[0]!.source.path, {
    coverageRole: "overview",
    coverageTotal: allRefs.length,
    coverageSetHash,
  })
  overview.label =
    artifactType === "data-flow"
      ? `数据关系导航总览 / ${refs.length}/${allRefs.length} 条关键关系`
      : `源码流程导航总览 / ${refs.length}/${allRefs.length} 条关键关系`
  return [overview, ...focused]
}

function evidenceScopeBudget(artifactType: ArtifactType, config: JobConfig) {
  const budget = config.atomicEvidenceBudget ?? config.evidenceBudget
  const configured = {
    topic: 96,
    "product-section": 96,
    "business-flow": 64,
    overview: 96,
    structure: 64,
    "code-structure": 48,
    "execution-flow": 64,
    sequence: 64,
    "data-flow": 64,
    "error-flow": 64,
    lifecycle: 64,
    review: 64,
  }[artifactType]
  const fullDocumentLimit =
    config.documentProfile === "source-backed-full"
      ? artifactType === "overview"
        ? 32
        : ["business-flow", "execution-flow", "sequence", "data-flow", "error-flow"].includes(artifactType)
          ? 64
          : configured
      : configured
  const limit = fullDocumentLimit ?? budget.maxItems
  return {
    ...budget,
    maxItems: Math.min(budget.maxItems, limit),
    maxPromptBytes: Math.min(budget.maxPromptBytes, 48 * 1_024),
  }
}

function sourceFilesScope(values: string[]): Extract<EvidenceScope, { kind: "source-files" }> {
  const ordered = [...new Set(values)].sort()
  return {
    kind: "source-files",
    values: ordered,
    label: ordered.length === 1 ? ordered[0] : `${ordered[0]} 等 ${ordered.length} 个文件`,
  }
}

function planTopicEvidenceScopes(extraction: DesignDocExtraction, config: JobConfig) {
  const evidence = extraction.evidence
    .filter((item) => item.confidence === "explicit" && item.source.sourceKind !== "test")
    .toSorted(
      (left, right) =>
        left.source.path.localeCompare(right.source.path) ||
        (left.source.symbol ?? "").localeCompare(right.source.symbol ?? "") ||
        left.source.startLine - right.source.startLine ||
        left.kind.localeCompare(right.kind),
    )
  const refs = [...new Set(evidence.map(topicEvidenceKey))]
  if (!refs.length) return []
  const budget = evidenceScopeBudget("topic", config)
  const byRef = new Map(evidence.map((item) => [topicEvidenceKey(item), item] as const))
  const fits = (values: string[]) => {
    try {
      const pack = buildPack(
        "topic",
        scopeExtraction("topic", extraction, topicEvidenceScope(values, byRef, refs)),
        "scope-probe",
        budget,
      )
      return sufficientFor("topic", pack)
    } catch {
      return false
    }
  }
  const groups = Map.groupBy(evidence, (item) => `${item.source.path}\0${item.source.symbol ?? ""}`)
  const chunks: string[][] = []
  for (const values of groups.values()) {
    let current: string[] = []
    for (const item of values) {
      const ref = topicEvidenceKey(item)
      const candidate = [...current, ref]
      if (fits(candidate)) {
        current = candidate
        continue
      }
      if (current.length) chunks.push(current)
      if (!fits([ref])) return []
      current = [ref]
    }
    if (current.length) chunks.push(current)
  }
  const bins: string[][] = []
  for (const chunk of chunks.toSorted((left, right) => right.length - left.length)) {
    const target = bins
      .toSorted((left, right) => left.length - right.length)
      .find((candidate) => fits([...candidate, ...chunk]))
    if (target) target.push(...chunk)
    else bins.push([...chunk])
  }
  return bins
    .toSorted((left, right) => refs.indexOf(left[0]!) - refs.indexOf(right[0]!))
    .map((values) => topicEvidenceScope(values, byRef, refs))
}

function topicEvidenceScope(
  values: string[],
  evidence: ReadonlyMap<string, DesignDocExtraction["evidence"][number]>,
  coverage: string[],
): Extract<EvidenceScope, { kind: "topic-evidence" }> {
  const ordered = [...new Set(values)].toSorted((left, right) => coverage.indexOf(left) - coverage.indexOf(right))
  const items = ordered.flatMap((value) => {
    const item = evidence.get(value)
    return item ? [item] : []
  })
  const owners = [...new Set(items.map((item) => item.source.symbol ?? item.source.path))]
  const first = items[0]
  const owner = first?.source.symbol?.split("#").at(-1)?.replace(/@\d+$/, "")
  const label = owner
    ? `${path.posix.basename(first!.source.path)} / ${owner}${owners.length > 1 ? ` 等 ${owners.length} 个源码范围` : ""}`
    : `${path.posix.basename(first?.source.path ?? "源码")}${owners.length > 1 ? ` 等 ${owners.length} 个源码范围` : ""}`
  return {
    kind: "topic-evidence",
    values: ordered,
    label,
    coverageTotal: coverage.length,
    coverageSetHash: relationSetHash(coverage),
  }
}

function topicEvidenceKey(item: DesignDocExtraction["evidence"][number]) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        item.kind,
        item.source.path,
        item.source.startLine,
        item.source.endLine,
        item.source.symbol ?? "",
        item.fact,
        item.attributes,
      ]),
    )
    .digest("hex")
}

function sourceSymbolScope(values: string[]): Extract<EvidenceScope, { kind: "source-symbols" }> {
  const ordered = [...new Set(values)]
  const names = ordered.map((value) => value.split("#").at(-1)?.replace(/@\d+$/, "") ?? value)
  return {
    kind: "source-symbols",
    values: ordered,
    label: names.length === 1 ? names[0] : `${names.slice(0, 2).join("、")} 等 ${names.length} 个设计对象`,
  }
}

function behaviorRefsScope(
  values: string[],
  path: string,
  coverage?: Pick<
    Extract<EvidenceScope, { kind: "behavior-refs" }>,
    "coverageRole" | "coverageTotal" | "coverageSetHash"
  >,
): Extract<EvidenceScope, { kind: "behavior-refs" }> {
  const ordered = [...new Set(values)].sort()
  return {
    kind: "behavior-refs",
    values: ordered,
    path,
    label: `${path} / ${ordered.length} 条原子关系`,
    coverageRole: coverage?.coverageRole ?? "detail",
    coverageTotal: coverage?.coverageTotal ?? ordered.length,
    coverageSetHash: coverage?.coverageSetHash ?? relationSetHash(ordered),
  }
}

export function balanceBehaviorScopes(
  scopes: Array<Extract<EvidenceScope, { kind: "behavior-refs" }>>,
  relationLimit: number,
  coverageTotal: number,
  coverageSetHash: string,
) {
  if (!Number.isFinite(relationLimit)) return scopes
  const values = [...new Set(scopes.flatMap((scope) => scope.values))].sort()
  const paths = [...new Set(scopes.map((scope) => scope.path))]
  const sourcePath = paths.length === 1 ? paths[0]! : "跨源码关系组"
  return balancedBehaviorValues(values, relationLimit).map((group) =>
    behaviorRefsScope(group, sourcePath, {
      coverageRole: "detail",
      coverageTotal,
      coverageSetHash,
    }),
  )
}

export function balancedBehaviorValues(values: string[], relationLimit: number) {
  if (!Number.isFinite(relationLimit) || values.length <= relationLimit) return [[...values]]
  const groups = Array.from({ length: Math.ceil(values.length / relationLimit) }, (_, index) =>
    values.slice(index * relationLimit, index * relationLimit + relationLimit),
  )
  const last = groups.at(-1)!
  if (last.length >= 4 || groups.length < 2) return groups
  const previous = groups.at(-2)!
  const tail = [...previous, ...last]
  const split = Math.ceil(tail.length / 2)
  groups.splice(groups.length - 2, 2, tail.slice(0, split), tail.slice(split))
  return groups
}

function relationSetHash(values: string[]) {
  return createHash("sha256")
    .update([...new Set(values)].sort().join("\n"))
    .digest("hex")
}

function sourcePath(symbol: string) {
  return symbol.split("#", 1)[0] ?? symbol
}

function replaceWithScopedWorkItems(workspace: string, jobID: string, workItemID: string, scopes: EvidenceScope[]) {
  return change(workspace, jobID, (job) => {
    const current = job.workItems.find((item) => item.id === workItemID)
    if (!current) return job
    const now = Date.now()
    const replacements = scopes.map((evidenceScope, index): WorkItem => {
      const scoped = index === 0 ? evidenceScope : { ...evidenceScope, label: `${evidenceScope.label} / 聚焦 ${index}` }
      const purpose = (() => {
        if (current.purpose?.kind !== "diagram") return current.purpose
        if (index === 0) return { ...current.purpose, role: "base" as const }
        const { topic: _topic, ...focused } = current.purpose
        return { ...focused, role: "focused" as const, focusID: `focus-${index}-${evidenceScope.label}` }
      })()
      return {
        ...current,
        id: index === 0 ? current.id : `WI-${ulid()}`,
        status: "pending",
        dependencies: current.dependencies,
        attempts: [],
        evidenceScope: scoped,
        ...(purpose ? { purpose } : {}),
        retryCursor: undefined,
        modelOverride: undefined,
        evidencePackPath: undefined,
        candidateArtifactPath: undefined,
        candidateSourceSnapshotHash: undefined,
        validationReportPath: undefined,
        artifactIDs: [],
        failure: undefined,
        createdAt: now,
        updatedAt: now,
      }
    })
    const replacementIDs = replacements.map((item) => item.id)
    job.workItems = job.workItems.flatMap((item) => {
      if (item.id === workItemID) return replacements
      const dependencies = item.dependencies.flatMap((dependency) =>
        dependency === workItemID ? replacementIDs : [dependency],
      )
      return [{ ...item, dependencies }]
    })
    job.status = "running"
    return job
  })
}

function validateCandidate(
  artifactType: ArtifactType,
  candidate: unknown,
  pack: EvidencePack,
  attempt: number,
  currentSourceSnapshotHash: string,
) {
  const input = { candidate: normalizeOptionalNulls(candidate), pack, attempt, currentSourceSnapshotHash }
  const validation = (() => {
    if (artifactType === "product-section") return validateProductSection(input)
    if (artifactType === "structure") return validateStructure(input)
    if (artifactType === "code-structure") return validateCodeStructure(input)
    if (artifactType === "overview") return validateOverview(input)
    if (artifactType === "topic") return validateTopic(input)
    if (artifactType === "business-flow") return validateBusinessFlow(input)
    if (artifactType === "execution-flow") return validateExecutionFlow(input)
    if (artifactType === "sequence") return validateSequence(input)
    if (artifactType === "data-flow") return validateDataFlow(input)
    if (artifactType === "error-flow") return validateErrorFlow(input)
    return validateLifecycle(input)
  })()
  if (artifactType === "topic" || artifactType === "product-section" || !validation.ir) return validation
  const readerErrors = validateReaderContent(validation.ir)
  if (!readerErrors.length) return validation
  return {
    ...validation,
    report: {
      ...validation.report,
      passed: false,
      validatorVersions: { ...validation.report.validatorVersions, reader: "1" },
      errors: [...validation.report.errors, ...readerErrors],
      metrics: {
        ...validation.report.metrics,
        errorCount: validation.report.errors.length + readerErrors.length,
      },
    },
  }
}

/** DeepSeek 等 OpenAI 兼容后端常用 null 表示未填写的可选字段；必需字段仍由 Schema 拒绝。 */
export function normalizeOptionalNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeOptionalNulls)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, normalizeOptionalNulls(item)]),
  )
}

function launch(workspace: string, jobID: string, inheritedLease?: () => Promise<void>) {
  return Effect.gen(function* () {
    const reserved = yield* Effect.sync(() => {
      if (launching.has(jobID) || running.has(jobID)) return false
      launching.add(jobID)
      return true
    })
    if (!reserved) {
      if (inheritedLease) yield* Effect.promise(inheritedLease).pipe(Effect.ignore)
      return
    }
    yield* Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const background = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const prompts = yield* SessionPrompt.Service
      const existing = yield* background.get(backgroundID(jobID))
      if (existing?.status === "running") {
        if (inheritedLease) yield* Effect.promise(inheritedLease).pipe(Effect.ignore)
        return
      }
      const loaded = yield* Effect.exit(read(workspace, jobID))
      if (Exit.isFailure(loaded)) {
        if (inheritedLease) yield* Effect.promise(inheritedLease).pipe(Effect.ignore)
        return yield* Effect.failCause(loaded.cause)
      }
      const job = loaded.value
      const release = inheritedLease ?? (yield* Effect.promise(() => DesignDocStore.acquireRunLease(workspace, jobID)))
      if (!release) return
      const active: RunningJob = { workspace, sessionIDs: new Set() }
      running.set(jobID, active)
      const started = yield* Effect.exit(
        background.start({
          id: backgroundID(jobID),
          type: "design-doc",
          title: `DesignDoc ${jobID}`,
          metadata: { jobID, workspace },
          run: Effect.all(
            Array.from({ length: job.config.concurrency }, () => runJob(workspace, jobID, 0)),
            { concurrency: "unbounded", discard: true },
          ).pipe(
            Effect.catchCause((cause) => {
              if (isInterrupted(cause)) return Effect.void
              return failUnexpected(workspace, jobID, Cause.pretty(cause))
            }),
            Effect.ensuring(
              Effect.all(
                [
                  Effect.sync(() => {
                    if (running.get(jobID) === active) running.delete(jobID)
                  }),
                  Effect.promise(release).pipe(Effect.ignore),
                ],
                { discard: true },
              ),
            ),
            Effect.as("completed"),
            Effect.provideService(InstanceRef, ctx),
            Effect.provideService(Session.Service, sessions),
            Effect.provideService(SessionPrompt.Service, prompts),
          ),
        }),
      )
      if (Exit.isFailure(started)) {
        running.delete(jobID)
        yield* Effect.promise(release).pipe(Effect.ignore)
        return yield* Effect.failCause(started.cause)
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          launching.delete(jobID)
        }),
      ),
    )
  })
}

function runJob(
  workspace: string,
  jobID: string,
  sourceRestarts: number,
): Effect.Effect<void, unknown, Session.Service | SessionPrompt.Service> {
  return Effect.gen(function* () {
    let job = yield* read(workspace, jobID)
    if (["paused", "failed", "blocked", "assembling", "completed", "cancelled"].includes(job.status)) return
    job = yield* change(workspace, jobID, (current) => ({
      ...current,
      status: "discovering",
    }))
    if (["paused", "failed", "blocked", "assembling", "completed", "cancelled"].includes(job.status)) return
    const tree = yield* Effect.tryPromise({
      try: () => discoverForJob(workspace, job),
      catch: (error) => error,
    }).pipe(Effect.catch((error) => blockDiscovery(workspace, jobID, error)))
    if (!tree) return

    job = yield* change(workspace, jobID, (current) => expandModuleWorkItems(current, tree))

    let claimedID: string | undefined
    job = yield* change(workspace, jobID, (current) => {
      const passed = new Set(
        current.workItems.filter((candidate) => candidate.status === "passed").map((candidate) => candidate.id),
      )
      const candidate = current.workItems.find(
        (item) =>
          ["pending", "ready", "retryable"].includes(item.status) &&
          item.dependencies.every((dependency) => passed.has(dependency)),
      )
      if (!candidate) return current
      claimedID = candidate.id
      current.workItems = current.workItems.map((item) =>
        item.id === candidate.id ? { ...item, status: "running", updatedAt: Date.now() } : item,
      )
      current.status = "running"
      return current
    })
    const currentItem = claimedID ? job.workItems.find((candidate) => candidate.id === claimedID) : undefined
    if (!currentItem) {
      if (job.workItems.some((candidate) => candidate.status === "running" || candidate.status === "validating")) return
      if (job.workItems.length && job.workItems.every((candidate) => candidate.status === "passed")) {
        let claimedAssembly = false
        yield* change(workspace, jobID, (current) => {
          if (current.status === "assembling" || current.status === "completed") return current
          if (!current.workItems.length || current.workItems.some((candidate) => candidate.status !== "passed"))
            return current
          claimedAssembly = true
          current.status = "assembling"
          return current
        })
        if (claimedAssembly) yield* finalizeAssembly(workspace, jobID)
        return
      }
      yield* settleIncompleteJob(workspace, jobID)
      return
    }
    const module = tree.modules.find((candidate) => candidate.id === currentItem.moduleID)
    if (!module) {
      yield* block(workspace, jobID, issue("MODULE_NOT_FOUND", `WorkItem 模块不存在：${currentItem.moduleID}`, false))
      return
    }
    const artifactType = currentItem.artifactType
    const item = {
      ...currentItem,
      moduleID: module.id,
      status: "running" as const,
      updatedAt: Date.now(),
    }
    const manifest = buildModuleManifest(
      tree,
      job.workItems.map((candidate) => (candidate.id === item.id ? item : candidate)),
      Date.now(),
    )
    const manifestMeta = yield* Effect.promise(() =>
      DesignDocStore.writeJSON(workspace, jobID, "module-manifest.json", manifest),
    )
    job = yield* change(workspace, jobID, (current) => {
      if (!current.workItems.some((candidate) => candidate.id === item.id)) return current
      return {
        ...current,
        status: "extracting",
        moduleManifestPath: manifestMeta.path,
        workItems: current.workItems.map((candidate) => (candidate.id === item.id ? item : candidate)),
        artifacts: upsert(
          current.artifacts,
          artifact({
            ...manifestMeta,
            id: "ART-MODULE-MANIFEST",
            workItemID: item.id,
            kind: "manifest",
            status: "candidate",
          }),
        ),
      }
    })

    if (artifactType === "review") {
      yield* completeReview(workspace, jobID, item.id)
      yield* runJob(workspace, jobID, sourceRestarts)
      return
    }

    const extractionResult = yield* Effect.tryPromise({
      try: async () => extractFor(workspace, artifactType, module, item.purpose, job.config, tree),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, error }),
        onSuccess: (value) => ({ ok: true as const, value }),
      }),
    )
    if (!extractionResult.ok) {
      if (
        extractionResult.error instanceof DesignDocDiscoveryError &&
        extractionResult.error.code === "SOURCE_CHANGED"
      ) {
        if (!(yield* workItemExists(workspace, jobID, item.id))) return
        yield* markStale(workspace, jobID)
        if (sourceRestarts < 1) {
          yield* runJob(workspace, jobID, sourceRestarts + 1)
          return
        }
        yield* block(workspace, jobID, issue("SOURCE_CHANGED", "证据提取期间源码连续变化，任务已阻塞", false))
        return
      }
      yield* failWorkItem(
        workspace,
        jobID,
        item.id,
        issue("EVIDENCE_EXTRACTION_FAILED", message(extractionResult.error), false),
      )
      yield* runJob(workspace, jobID, sourceRestarts)
      return
    }
    const extraction = currentItem.evidenceScope
      ? scopeExtraction(artifactType, extractionResult.value, currentItem.evidenceScope, true)
      : extractionResult.value
    if (
      job.config.documentProfile === "product-detailed-design-v2" &&
      artifactType === "product-section" &&
      !currentItem.evidenceScope
    ) {
      const scopes = planEvidenceScopes(artifactType, extractionResult.value, job.config, item.purpose)
      if (scopes.length > 1) {
        yield* replaceWithScopedWorkItems(workspace, jobID, item.id, scopes)
        yield* runJob(workspace, jobID, sourceRestarts)
        return
      }
    }
    if (
      isDocumentProfile(job.config.documentProfile) &&
      !currentItem.evidenceScope &&
      currentItem.purpose?.kind === "diagram"
    ) {
      const scopes = selectDocumentScopes(
        module,
        artifactType,
        planEvidenceScopes(artifactType, extractionResult.value, job.config, item.purpose),
      )
      if (scopes.length) {
        yield* replaceWithScopedWorkItems(workspace, jobID, item.id, scopes)
        yield* runJob(workspace, jobID, sourceRestarts)
        return
      }
    }
    if (!(yield* workItemExists(workspace, jobID, item.id))) return
    const evidenceBudget = currentItem.evidenceScope
      ? (job.config.atomicEvidenceBudget ?? job.config.evidenceBudget)
      : job.config.evidenceBudget
    const packResult = yield* Effect.try({
      try: () => buildPack(artifactType, extraction, item.id, evidenceBudget, item.purpose, module.name),
      catch: (error) => error,
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, error }),
        onSuccess: (value) => ({ ok: true as const, value }),
      }),
    )
    if (!packResult.ok) {
      if (packResult.error instanceof EvidenceBudgetError && !currentItem.evidenceScope) {
        const planned = planEvidenceScopes(artifactType, extractionResult.value, job.config, item.purpose)
        const scopes =
          isDocumentProfile(job.config.documentProfile)
            ? selectDocumentScopes(module, artifactType, planned)
            : planned
        if (scopes.length) {
          yield* replaceWithScopedWorkItems(workspace, jobID, item.id, scopes)
          yield* runJob(workspace, jobID, sourceRestarts)
          return
        }
      }
      const code = packResult.error instanceof EvidenceBudgetError ? packResult.error.code : "INSUFFICIENT_EVIDENCE"
      yield* blockWorkItem(workspace, jobID, item.id, issue(code, message(packResult.error), false))
      yield* runJob(workspace, jobID, sourceRestarts)
      return
    }
    // 图工作项必须保持静态分析器为该原子范围生成的完整证据和 obligations。
    // 主题/图的一致性在最终组装时对全部主题分片与全部对应图的 evidence union 做确定性校验；
    // 这里不得再用某一个主题 Session 的结果重写图证据包，否则会丢失其他分片和源码关系。
    const pack = packResult.value
    const evidenceMeta = yield* Effect.promise(() =>
      DesignDocStore.writeJSON(workspace, jobID, `work-items/${item.id}/evidence.json`, pack),
    )
    const evidenceArtifact = artifact({
      ...evidenceMeta,
      id: `ART-${item.id}-EVIDENCE`,
      workItemID: item.id,
      kind: "evidence-pack",
      status: "candidate",
    })
    job = yield* change(workspace, jobID, (current) => {
      if (!current.workItems.some((candidate) => candidate.id === item.id)) return current
      const workItems = current.workItems.map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              status: "ready" as const,
              evidencePackPath: evidenceMeta.path,
              updatedAt: Date.now(),
            }
          : candidate,
      )
      return {
        ...current,
        status: "running",
        workItems,
        artifacts: upsert(current.artifacts, evidenceArtifact),
      }
    })

    if (
      artifactType === "product-section" &&
      item.purpose?.kind === "product-section" &&
      item.purpose.section === "requirements" &&
      pack.unknowns.some((value) => value.startsWith("requirements-missing:"))
    ) {
      const candidate = {
        schemaVersion: 2 as const,
        moduleID: pack.moduleID,
        viewType: "product-section" as const,
        section: "requirements" as const,
        title: productSectionTitle("requirements"),
        summary: "未提供可追溯的上游需求材料，本章不生成 AR 编号；仅保留该缺口供发布评审确认。",
        claims: [],
        paragraphs: [
          {
            text: "本次输入未包含需求规格、概要设计或已批准的需求分解材料，因此无法建立需求编号到实现的双向追踪。模块的源码实现责任在后续章节按已验证源码说明；补充上游文档后应重新生成本章。",
            claimIDs: ["UNKNOWN-UPSTREAM-REQUIREMENTS"],
          },
        ],
        assumptions: [],
        unknowns: [
          {
            id: "UNKNOWN-UPSTREAM-REQUIREMENTS",
            subject: "上游需求来源",
            statement: "尚未提供可用于追踪的需求证据。",
            confidence: "unknown" as const,
            evidenceIDs: [],
          },
        ],
        requirements: [],
        sourceStatus: "missing" as const,
      }
      const validation = validateCandidate(artifactType, candidate, pack, 0, pack.sourceSnapshotHash)
      const reportMeta = yield* Effect.promise(() =>
        DesignDocStore.writeJSON(workspace, jobID, `work-items/${item.id}/validation.json`, validation.report),
      )
      yield* change(workspace, jobID, (current) => ({
        ...current,
        status: "validating",
        workItems: current.workItems.map((candidateItem) =>
          candidateItem.id === item.id
            ? {
                ...candidateItem,
                status: "validating" as const,
                validationReportPath: reportMeta.path,
                updatedAt: Date.now(),
              }
            : candidateItem,
        ),
        artifacts: upsert(
          current.artifacts,
          artifact({
            ...reportMeta,
            id: `ART-${item.id}-VALIDATION-0`,
            workItemID: item.id,
            kind: "validation-report",
            status: validation.report.passed ? "passed" : "failed",
          }),
        ),
      }))
      if (!validation.report.passed || !validation.ir) {
        yield* blockWorkItem(
          workspace,
          jobID,
          item.id,
          validation.report.errors[0] ?? issue("REQUIREMENT_SECTION_FAILED", "需求缺失章节校验失败", false),
        )
      } else yield* completeOrFail(workspace, jobID, item.id, validation.ir)
      yield* runJob(workspace, jobID, sourceRestarts)
      return
    }

    const topicPurpose = item.purpose?.kind === "topic" ? item.purpose : undefined
    if (
      artifactType === "topic" &&
      topicPurpose &&
      pack.unknowns.some((value) => value.startsWith(`topic-absence:${topicPurpose.topic}:`))
    ) {
      const topic = topicPurpose.topic
      const candidate = {
        schemaVersion: 1 as const,
        moduleID: pack.moduleID,
        viewType: "topic" as const,
        topic,
        applicability: "not-applicable" as const,
        title: topicTitle(topic),
        summary: `完整源码快照中未发现可直接证明“${topicTitle(topic)}”专用机制的生产源码证据。`,
        conclusions: [],
        mechanisms: [],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [{ text: "该主题可能由目标目录外部、生成代码或运行时配置实现，需人工确认。", evidenceIDs: [] }],
      }
      const validation = validateCandidate(artifactType, candidate, pack, 0, pack.sourceSnapshotHash)
      const reportMeta = yield* Effect.promise(() =>
        DesignDocStore.writeJSON(workspace, jobID, `work-items/${item.id}/validation.json`, validation.report),
      )
      yield* change(workspace, jobID, (current) => ({
        ...current,
        status: "validating",
        workItems: current.workItems.map((candidateItem) =>
          candidateItem.id === item.id
            ? {
                ...candidateItem,
                status: "validating" as const,
                validationReportPath: reportMeta.path,
                updatedAt: Date.now(),
              }
            : candidateItem,
        ),
        artifacts: upsert(
          current.artifacts,
          artifact({
            ...reportMeta,
            id: `ART-${item.id}-VALIDATION-0`,
            workItemID: item.id,
            kind: "validation-report",
            status: validation.report.passed ? "passed" : "failed",
          }),
        ),
      }))
      if (!validation.report.passed || !validation.ir) {
        yield* blockWorkItem(
          workspace,
          jobID,
          item.id,
          validation.report.errors[0] ?? issue("TOPIC_NOT_APPLICABLE_FAILED", "不适用主题校验失败", false),
        )
      } else yield* completeOrFail(workspace, jobID, item.id, validation.ir)
      yield* runJob(workspace, jobID, sourceRestarts)
      return
    }

    const sufficient = sufficientFor(artifactType, pack)
    if (
      !sufficient &&
      isDocumentProfile(job.config.documentProfile) &&
      artifactType === "lifecycle" &&
      item.purpose?.kind === "diagram" &&
      item.purpose.view === "state-machine"
    ) {
      const ir = {
        schemaVersion: 1 as const,
        moduleID: pack.moduleID,
        viewType: "not-applicable" as const,
        designView: "state-machine" as const,
        title: `${module.name} 状态机适用性`,
        reason: "完整源码快照中未形成至少两个明确状态、一条明确迁移和初始状态的可证明状态机。",
        evidenceIDs: pack.evidence
          .filter((evidence) => evidence.confidence === "explicit" && evidence.source.sourceKind !== "test")
          .map((evidence) => evidence.id),
        unknowns: pack.unknowns.map((text) => ({ text, evidenceIDs: [] })),
      }
      const report: ValidationReport = {
        schemaVersion: 1,
        workItemID: item.id,
        attempt: 0,
        passed: true,
        sourceSnapshotHash: pack.sourceSnapshotHash,
        validatorVersions: { schema: "1", evidence: "1", applicability: "1" },
        errors: [],
        warnings: [issue("STATE_MACHINE_NOT_APPLICABLE", ir.reason, false, ir.evidenceIDs, "warning")],
        metrics: { evidenceCount: pack.evidence.length, applicable: 0 },
        createdAt: Date.now(),
      }
      const reportMeta = yield* Effect.promise(() =>
        DesignDocStore.writeJSON(workspace, jobID, `work-items/${item.id}/validation.json`, report),
      )
      yield* change(workspace, jobID, (current) => ({
        ...current,
        status: "validating",
        workItems: current.workItems.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                status: "validating" as const,
                validationReportPath: reportMeta.path,
                updatedAt: Date.now(),
              }
            : candidate,
        ),
        artifacts: upsert(
          current.artifacts,
          artifact({
            ...reportMeta,
            id: `ART-${item.id}-VALIDATION-0`,
            workItemID: item.id,
            kind: "validation-report",
            status: "passed",
          }),
        ),
      }))
      yield* completeOrFail(workspace, jobID, item.id, ir)
      yield* runJob(workspace, jobID, sourceRestarts)
      return
    }
    if (!sufficient) {
      yield* blockWorkItem(
        workspace,
        jobID,
        item.id,
        issue("INSUFFICIENT_EVIDENCE", pack.unknowns.join("；") || `${artifactType} 证据不足`, false),
      )
      yield* runJob(workspace, jobID, sourceRestarts)
      return
    }

    const persistedItem = job.workItems.find((candidate) => candidate.id === item.id)
    const attempts = persistedItem?.attempts ?? []
    let consumed = consumedAttempts(attempts, persistedItem?.retryCursor)
    let sequence = nextAttemptNumber(attempts)
    const restored = yield* Effect.promise(() => restoreRepairContext(workspace, jobID, item, pack.sourceSnapshotHash))
    let previousCandidate = restored.candidate
    let previousReport = restored.report
    // 校验器、证据提取器或源码快照升级后，历史失败报告可能已经过期。
    // 只要候选仍可恢复，就始终用当前 Evidence Pack 和当前校验器重验；
    // 旧报告仅保留审计价值，不能强制启动一次新的模型 Session。
    if (previousCandidate !== undefined) {
      const recoveredAttempt = attempts.at(-1)?.number ?? 0
      const validation = validateCandidate(
        artifactType,
        previousCandidate,
        pack,
        recoveredAttempt,
        pack.sourceSnapshotHash,
      )
      previousReport = validation.report
      const reportMeta = yield* Effect.promise(() =>
        DesignDocStore.writeJSON(
          workspace,
          jobID,
          `work-items/${item.id}/attempts/${recoveredAttempt}/validation.json`,
          validation.report,
        ),
      )
      yield* change(workspace, jobID, (current) => {
        if (!current.workItems.some((candidate) => candidate.id === item.id)) return current
        return {
          ...current,
          status: validation.report.passed ? "validating" : "running",
          workItems: current.workItems.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, validationReportPath: reportMeta.path, updatedAt: Date.now() }
              : candidate,
          ),
          artifacts: upsert(
            current.artifacts,
            artifact({
              ...reportMeta,
              id: `ART-${item.id}-VALIDATION-${recoveredAttempt}`,
              workItemID: item.id,
              kind: "validation-report",
              status: validation.report.passed ? "passed" : "failed",
            }),
          ),
        }
      })
      if (validation.report.passed && validation.ir) {
        yield* completeOrFail(workspace, jobID, item.id, validation.ir)
        yield* runJob(workspace, jobID, sourceRestarts)
        return
      }
      if (!canRetry(previousReport, job.config.retryPolicy) || consumed >= job.config.retryPolicy.maxAttempts) {
        yield* blockWorkItem(
          workspace,
          jobID,
          item.id,
          validation.report.errors[0] ?? issue("VALIDATION_FAILED", "恢复候选校验失败", false),
        )
        yield* runJob(workspace, jobID, sourceRestarts)
        return
      }
    }
    while (consumed < job.config.retryPolicy.maxAttempts) {
      const attempt = sequence++
      const qualityAttempt = ++consumed
      const latest = yield* read(workspace, jobID)
      if (latest.status === "paused" || latest.status === "cancelled") return
      const latestItem = latest.workItems.find((candidate) => candidate.id === item.id)
      if (!latestItem) return
      const model = latestItem?.modelOverride ?? modelFor(latest.config, qualityAttempt)
      const previousSessionID = latest.workItems
        .find((candidate) => candidate.id === item.id)
        ?.attempts.at(-1)?.sessionID
      const kind: WorkItem["attempts"][number]["kind"] =
        previousCandidate === undefined && previousReport === undefined ? "generate" : "repair"
      const session = yield* createWorkerSession({
        jobID,
        workItemID: item.id,
        attempt,
        kind,
        artifactType,
        moduleName: currentItem.evidenceScope ? `${module.name} / ${currentItem.evidenceScope.label}` : module.name,
        sourceSnapshotHash: pack.sourceSnapshotHash,
        model,
        ownerSessionID: latest.ownerSessionID,
        repairedFromSessionID: kind === "repair" ? previousSessionID : undefined,
      })
      const active = running.get(jobID)
      if (active) active.sessionIDs.add(session.id)
      let attemptRegistered = false
      yield* change(workspace, jobID, (current) => {
        const target = current.workItems.find((candidate) => candidate.id === item.id)
        if (!target || !canRegisterAttempt(target)) return current
        attemptRegistered = true
        const workItems = current.workItems.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                status: "running" as const,
                attempts: [
                  ...candidate.attempts,
                  {
                    number: attempt,
                    kind,
                    sessionID: session.id,
                    model,
                    status: "running" as const,
                    ...(kind === "repair" && previousSessionID ? { repairedFromSessionID: previousSessionID } : {}),
                    startedAt: Date.now(),
                  },
                ],
                updatedAt: Date.now(),
              }
            : candidate,
        )
        return { ...current, status: "running", workItems }
      })
      if (!attemptRegistered) {
        if (active) active.sessionIDs.delete(session.id)
        yield* SessionPrompt.Service.use((prompts) => prompts.cancel(session.id).pipe(Effect.ignore))
        return
      }

      const exit = yield* Effect.exit(
        Effect.raceFirst(
          promptWorker({
            sessionID: session.id,
            pack,
            model,
            timeoutMs: latest.config.retryPolicy.timeoutMs,
            previousCandidate,
            previousReport,
          }),
          stopPromptWhenJobStops(workspace, jobID, item.id, session.id),
        ),
      )
      if (active) active.sessionIDs.delete(session.id)
      const afterPrompt = yield* read(workspace, jobID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const afterPromptItem = afterPrompt?.workItems.find((candidate) => candidate.id === item.id)
      if (
        !afterPromptItem ||
        afterPromptItem.status === "cancelled" ||
        (afterPrompt && ["paused", "failed", "blocked", "completed", "cancelled"].includes(afterPrompt.status))
      )
        return
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause)
        if (failure instanceof DesignDocSessionInterruptedError || isInterrupted(exit.cause)) {
          consumed -= 1
          yield* change(workspace, jobID, (current) => ({
            ...current,
            status: "running",
            workItems: current.workItems.map((candidate) =>
              candidate.id === item.id
                ? {
                    ...candidate,
                    status: "retryable" as const,
                    attempts: candidate.attempts.map((currentAttempt) =>
                      currentAttempt.number === attempt && currentAttempt.status === "running"
                        ? { ...currentAttempt, status: "interrupted" as const, completedAt: Date.now() }
                        : currentAttempt,
                    ),
                    updatedAt: Date.now(),
                  }
                : candidate,
            ),
          }))
          continue
        }
        const report = failureReport(pack, attempt, failure)
        yield* saveAttemptFailure(workspace, jobID, item.id, attempt, report)
        previousReport = report
        if (!canRetry(report, latest.config.retryPolicy)) {
          yield* failWorkItem(
            workspace,
            jobID,
            item.id,
            report.errors[0] ?? issue("MODEL_RESPONSE_ERROR", message(failure), false),
          )
          yield* runJob(workspace, jobID, sourceRestarts)
          return
        }
        if (qualityAttempt === latest.config.retryPolicy.maxAttempts) {
          yield* blockWorkItem(workspace, jobID, item.id, issue("RETRY_LIMIT_EXHAUSTED", message(failure), false))
          yield* runJob(workspace, jobID, sourceRestarts)
          return
        }
        yield* Effect.sleep(`${latest.config.retryPolicy.backoffMs[qualityAttempt] ?? 0} millis`)
        continue
      }

      previousCandidate = exit.value.structured
      const candidateMeta = yield* Effect.promise(() =>
        DesignDocStore.writeJSON(
          workspace,
          jobID,
          `work-items/${item.id}/attempts/${attempt}/candidate.json`,
          previousCandidate,
        ),
      )
      yield* change(workspace, jobID, (current) => {
        if (!current.workItems.some((candidate) => candidate.id === item.id)) return current
        return {
          ...current,
          status: "validating",
          workItems: current.workItems.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  status: "validating" as const,
                  candidateArtifactPath: candidateMeta.path,
                  candidateSourceSnapshotHash: pack.sourceSnapshotHash,
                  attempts: completeAttempt(candidate.attempts, attempt, "completed", exit.value),
                  updatedAt: Date.now(),
                }
              : candidate,
          ),
          artifacts: upsert(
            current.artifacts,
            artifact({
              ...candidateMeta,
              id: `ART-${item.id}-IR-${attempt}`,
              workItemID: item.id,
              kind: "ir",
              status: "candidate",
            }),
          ),
        }
      })

      const currentTree = yield* Effect.promise(() => discoverForJob(workspace, latest))
      const currentModule = currentTree.modules.find((candidate) => candidate.path === module.path)
      if (!currentModule || currentModule.sourceSnapshotHash !== pack.sourceSnapshotHash) {
        if (!(yield* workItemExists(workspace, jobID, item.id))) return
        yield* markStale(workspace, jobID)
        if (sourceRestarts < 1) {
          yield* runJob(workspace, jobID, sourceRestarts + 1)
          return
        }
        yield* block(workspace, jobID, issue("SOURCE_CHANGED", "生成期间源码连续变化，任务已阻塞", false))
        return
      }
      const validation = validateCandidate(
        artifactType,
        previousCandidate,
        pack,
        attempt,
        currentModule.sourceSnapshotHash,
      )
      previousReport = validation.report
      const reportMeta = yield* Effect.promise(() =>
        DesignDocStore.writeJSON(
          workspace,
          jobID,
          `work-items/${item.id}/attempts/${attempt}/validation.json`,
          validation.report,
        ),
      )
      yield* change(workspace, jobID, (current) => {
        if (!current.workItems.some((candidate) => candidate.id === item.id)) return current
        return {
          ...current,
          workItems: current.workItems.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  validationReportPath: reportMeta.path,
                  updatedAt: Date.now(),
                }
              : candidate,
          ),
          artifacts: upsert(
            current.artifacts,
            artifact({
              ...reportMeta,
              id: `ART-${item.id}-VALIDATION-${attempt}`,
              workItemID: item.id,
              kind: "validation-report",
              status: validation.report.passed ? "passed" : "failed",
            }),
          ),
        }
      })
      if (!validation.report.passed || !validation.ir) {
        if (!canRetry(validation.report, latest.config.retryPolicy)) {
          yield* blockWorkItem(
            workspace,
            jobID,
            item.id,
            validation.report.errors[0] ?? issue("VALIDATION_FAILED", "校验失败且不可重试", false),
          )
          yield* runJob(workspace, jobID, sourceRestarts)
          return
        }
        if (qualityAttempt === latest.config.retryPolicy.maxAttempts) {
          yield* blockWorkItem(
            workspace,
            jobID,
            item.id,
            validation.report.errors[0] ?? issue("VALIDATION_FAILED", "校验失败", false),
          )
          yield* runJob(workspace, jobID, sourceRestarts)
          return
        }
        yield* change(workspace, jobID, (current) => ({
          ...current,
          status: "running",
          workItems: current.workItems.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  status: "retryable" as const,
                  updatedAt: Date.now(),
                }
              : candidate,
          ),
        }))
        continue
      }

      yield* completeOrFail(workspace, jobID, item.id, validation.ir)
      yield* runJob(workspace, jobID, sourceRestarts)
      return
    }
  })
}

async function restoreRepairContext(
  workspace: string,
  jobID: string,
  item: WorkItem,
  sourceSnapshotHash: string,
): Promise<{ candidate?: unknown; report?: ValidationReport }> {
  const job = await DesignDocStore.get(workspace, jobID)
  const read = async (name: string) => {
    const artifact = job.artifacts.find((candidate) => candidate.path === name)
    if (!artifact) throw new JobStoreError("INVALID_ARTIFACT", `Manifest 未声明恢复产物：${name}`)
    const value = await DesignDocStore.readDeclaredArtifact(job, artifact.id)
    return JSON.parse(value.content.toString("utf8")) as unknown
  }
  const candidate =
    item.candidateArtifactPath && item.candidateSourceSnapshotHash === sourceSnapshotHash
      ? await read(item.candidateArtifactPath)
      : undefined
  if (!item.validationReportPath) return { candidate }
  const raw = await read(item.validationReportPath)
  const decoded = await Schema.decodeUnknownPromise(ValidationReportSchema)(raw)
  if (decoded.workItemID !== item.id) {
    throw new JobStoreError("INVALID_ARTIFACT", "ValidationReport 与当前 WorkItem 不匹配")
  }
  if (decoded.sourceSnapshotHash !== sourceSnapshotHash) return {}
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已验证报告，克隆只把只读容器转换为内部可变领域对象。
  return { candidate, report: structuredClone(decoded) as ValidationReport }
}

function complete(workspace: string, jobID: string, workItemID: string, ir: DesignDocIR) {
  return Effect.gen(function* () {
    const artifactType = ir.viewType
    const irMeta = yield* Effect.promise(() =>
      DesignDocStore.writeJSON(workspace, jobID, `work-items/${workItemID}/${artifactType}.ir.json`, ir),
    )
    if (ir.viewType === "topic" || ir.viewType === "product-section" || ir.viewType === "not-applicable") {
      yield* change(workspace, jobID, (job) => {
        if (!job.workItems.some((item) => item.id === workItemID)) return job
        const irArtifact = artifact({
          ...irMeta,
          id: `ART-${workItemID}-IR-VERIFIED`,
          workItemID,
          kind: "ir",
          status: "passed",
        })
        job.artifacts = upsert(job.artifacts, irArtifact).map((item) =>
          item.workItemID === workItemID && item.kind === "evidence-pack"
            ? { ...item, status: "passed" as const }
            : item,
        )
        job.workItems = job.workItems.map((item) =>
          item.id === workItemID
            ? {
                ...item,
                status: "passed" as const,
                failure: undefined,
                artifactIDs: [...new Set([...item.artifactIDs, irArtifact.id])],
                updatedAt: Date.now(),
              }
            : item,
        )
        job.status = "running"
        job.progress = progress(job.workItems)
        return job
      })
      return
    }
    const rendered = yield* Effect.promise(
      async () =>
        await provideInstance({
          directory: workspace,
          fn: () => renderIRWithRetry({ workspace, jobID, workItemID, ir }),
        }),
    )
    const current = yield* read(workspace, jobID)
    const currentItem = current.workItems.find((item) => item.id === workItemID)
    if (currentItem?.purpose?.kind === "diagram" && rendered.wordFit.wordFitStatus !== "readable") {
      throw new Error(
        `DIAGRAM_SPLIT_REQUIRED：${rendered.wordFit.wordFitReasons?.join("；") || "图像不适合 Word 页面阅读"}`,
      )
    }
    const renderParts = renderedDiagramParts(rendered)
    const mermaidMetas = yield* Effect.promise(() =>
      Promise.all(
        renderParts.map((part, index) =>
          DesignDocStore.writeText(
            workspace,
            jobID,
            `work-items/${workItemID}/${artifactType}${renderParts.length > 1 ? `-part-${index + 1}` : ""}.mmd`,
            part.source,
            "text/vnd.mermaid",
          ),
        ),
      ),
    )
    const renderMetas = renderParts.map((part) => part.render)
    yield* change(workspace, jobID, (job) => {
      if (!job.workItems.some((item) => item.id === workItemID)) return job
      const irArtifact = artifact({
        ...irMeta,
        id: `ART-${workItemID}-IR-VERIFIED`,
        workItemID,
        kind: "ir",
        status: "passed",
      })
      const mermaidArtifacts = mermaidMetas.map((metadata, index) =>
        artifact({
          ...metadata,
          id: `ART-${workItemID}-MERMAID${mermaidMetas.length > 1 ? `-${index + 1}` : ""}`,
          workItemID,
          kind: "mermaid",
          status: "passed",
        }),
      )
      const renderArtifacts = renderMetas.map((metadata, index) =>
        artifact({
          ...metadata,
          id: `ART-${workItemID}-RENDER${renderMetas.length > 1 ? `-${index + 1}` : ""}`,
          workItemID,
          kind: "render",
          status: "passed",
        }),
      )
      const retainedArtifacts = job.artifacts.filter(
        (item) => item.workItemID !== workItemID || (item.kind !== "mermaid" && item.kind !== "render"),
      )
      job.artifacts = [...mermaidArtifacts, ...renderArtifacts]
        .reduce((artifacts, item) => upsert(artifacts, item), upsert(retainedArtifacts, irArtifact))
        .map((item) =>
          item.workItemID === workItemID && item.kind === "evidence-pack"
            ? { ...item, status: "passed" as const }
            : item,
        )
      job.workItems = job.workItems.map((item) =>
        item.id === workItemID
          ? {
              ...item,
              status: "passed" as const,
              failure: undefined,
              artifactIDs: [
                ...new Set([
                  ...item.artifactIDs.filter((id) => job.artifacts.some((artifact) => artifact.id === id)),
                  irArtifact.id,
                  ...mermaidArtifacts.map((artifact) => artifact.id),
                  ...renderArtifacts.map((artifact) => artifact.id),
                ]),
              ],
              updatedAt: Date.now(),
            }
          : item,
      )
      if (!job.workItems.some((item) => item.status === "failed" || item.status === "blocked")) {
        delete job.lastError
      }
      job.status = "running"
      job.progress = progress(job.workItems)
      return job
    })
  })
}

function completeOrFail(workspace: string, jobID: string, workItemID: string, ir: DesignDocIR) {
  return Effect.gen(function* () {
    const result = yield* Effect.exit(complete(workspace, jobID, workItemID, ir))
    if (Exit.isSuccess(result)) return true
    const failure = Cause.squash(result.cause)
    yield* failWorkItem(
      workspace,
      jobID,
      workItemID,
      issue("ARTIFACT_PUBLICATION_FAILED", `确定性渲染或产物发布失败：${message(failure)}`, false),
    )
    return false
  })
}

function completeReview(workspace: string, jobID: string, workItemID: string) {
  return Effect.gen(function* () {
    const job = yield* read(workspace, jobID)
    const report = yield* Effect.promise(() => buildQualityReport(job))
    if (!report.passed) {
      if (report.issues.length > 0 && report.issues.every((item) => item.code === "RELATION_DIAGRAM_TOO_FRAGMENTED")) {
        let repaired = false
        yield* change(workspace, jobID, (current) => {
          const next = repairFragmentedBehaviorWorkItems(current, workItemID)
          if (!next) return current
          repaired = true
          return next
        })
        if (repaired) return
      }
      yield* block(workspace, jobID, issue("QUALITY_REPORT_FAILED", "必需产物尚未全部通过，不能完成 review", false))
      return
    }
    const metadata = yield* Effect.promise(() =>
      DesignDocStore.writeJSON(workspace, jobID, "quality-report.json", report),
    )
    yield* change(workspace, jobID, (current) => {
      const reviewArtifact = artifact({
        ...metadata,
        id: "ART-JOB-QUALITY",
        workItemID,
        kind: "quality-report",
        status: "passed",
      })
      current.artifacts = upsert(current.artifacts, reviewArtifact)
      current.workItems = current.workItems.map((item) =>
        item.id === workItemID
          ? {
              ...item,
              status: "passed" as const,
              failure: undefined,
              artifactIDs: [...new Set([...item.artifactIDs, reviewArtifact.id])],
              updatedAt: Date.now(),
            }
          : item,
      )
      current.status = "running"
      return current
    })
  })
}

export function repairFragmentedBehaviorWorkItems(job: DesignDocJob, reviewWorkItemID: string) {
  const limits: Partial<Record<ArtifactType, number>> = {
    "business-flow": 8,
    "execution-flow": 10,
    "data-flow": 8,
    "error-flow": 8,
  }
  const positions = new Map(job.workItems.map((item, index) => [item.id, index]))
  const groups = new Map<string, WorkItem[]>()
  for (const item of job.workItems) {
    if (item.evidenceScope?.kind !== "behavior-refs" || item.evidenceScope.coverageRole !== "detail") continue
    const key = `${item.moduleID}\u0000${item.artifactType}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const scopes = new Map<string, Extract<EvidenceScope, { kind: "behavior-refs" }>>()
  for (const items of groups.values()) {
    const ordered = items.toSorted((left, right) => (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0))
    for (const [index, item] of ordered.entries()) {
      const scope = item.evidenceScope
      if (scope?.kind !== "behavior-refs" || scope.values.length >= 4 || scope.coverageTotal < 8) continue
      const neighbor = ordered[index - 1] ?? ordered[index + 1]
      const neighborScope = neighbor?.evidenceScope
      const limit = limits[item.artifactType]
      if (!neighbor || neighborScope?.kind !== "behavior-refs" || !limit) continue
      const values = [...new Set([...neighborScope.values, ...scope.values])].sort()
      const balanced = balancedBehaviorValues(values, limit)
      if (balanced.length !== 2 || balanced.some((group) => group.length < 4 || group.length > limit)) continue
      const sourcePath = neighborScope.path === scope.path ? scope.path : "跨源码关系组"
      const coverage = {
        coverageRole: "detail" as const,
        coverageTotal: scope.coverageTotal,
        coverageSetHash: scope.coverageSetHash,
      }
      scopes.set(neighbor.id, behaviorRefsScope(balanced[0]!, sourcePath, coverage))
      scopes.set(item.id, behaviorRefsScope(balanced[1]!, sourcePath, coverage))
    }
  }
  if (!scopes.size) return
  const now = Date.now()
  const reset = new Set(scopes.keys())
  const workItems = job.workItems.map((item) => {
    if (item.id === reviewWorkItemID) {
      return {
        ...item,
        status: "pending" as const,
        failure: undefined,
        artifactIDs: [],
        updatedAt: now,
      }
    }
    const evidenceScope = scopes.get(item.id)
    if (!evidenceScope) return item
    return {
      ...item,
      status: "pending" as const,
      attempts: [],
      evidenceScope,
      retryCursor: undefined,
      modelOverride: undefined,
      artifactIDs: [],
      evidencePackPath: undefined,
      candidateArtifactPath: undefined,
      candidateSourceSnapshotHash: undefined,
      validationReportPath: undefined,
      failure: undefined,
      updatedAt: now,
    }
  })
  const next = {
    ...job,
    status: "running" as const,
    workItems,
    artifacts: job.artifacts.map((item) =>
      reset.has(item.workItemID) || item.workItemID === reviewWorkItemID ? { ...item, status: "stale" as const } : item,
    ),
    progress: progress(workItems),
    updatedAt: now,
  }
  delete next.lastError
  return next
}

function finalizeAssembly(workspace: string, jobID: string) {
  return Effect.gen(function* () {
    yield* change(workspace, jobID, (job) => ({ ...job, status: "assembling" }))
    const job = yield* read(workspace, jobID)
    const assembled = yield* Effect.tryPromise({
      try: async () =>
        await provideInstance({ directory: workspace, fn: () => assembleDesignDocument(workspace, job) }),
      catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
    }).pipe(
      Effect.catch((error) =>
        failUnexpected(workspace, jobID, `文档组装失败：${error.message}`).pipe(Effect.as(undefined)),
      ),
    )
    if (!assembled) return
    const qualityMeta = yield* Effect.promise(() =>
      DesignDocStore.writeJSON(workspace, jobID, "quality-report.json", assembled.quality),
    )
    yield* change(workspace, jobID, (current) => {
      const review = current.workItems.find((item) => item.artifactType === "review")
      const workItemID = review?.id ?? `JOB-${current.id}`
      const documentArtifact = artifact({
        ...assembled.document,
        id: "ART-JOB-DOCUMENT",
        workItemID,
        kind: "document",
        status: "passed",
      })
      const qualityArtifact = artifact({
        ...qualityMeta,
        id: "ART-JOB-QUALITY",
        workItemID,
        kind: "quality-report",
        status: "passed",
      })
      current.artifacts = upsert(upsert(current.artifacts, documentArtifact), qualityArtifact)
      if ("word" in assembled && assembled.word) {
        current.artifacts = upsert(
          current.artifacts,
          artifact({
            ...assembled.word.document,
            id: "ART-JOB-WORD",
            workItemID,
            kind: "document",
            status: "passed",
          }),
        )
      }
      if ("model" in assembled && assembled.model) {
        current.artifacts = upsert(
          current.artifacts,
          artifact({
            ...assembled.model,
            id: "ART-JOB-DOCUMENT-MODEL",
            workItemID,
            kind: "document",
            status: "passed",
          }),
        )
      }
      current.artifacts = current.artifacts.map((item) =>
        item.kind === "manifest" ? { ...item, status: "passed" as const } : item,
      )
      if (review) {
        current.workItems = current.workItems.map((item) =>
          item.id === review.id
            ? { ...item, artifactIDs: [...new Set([...item.artifactIDs, qualityArtifact.id])], updatedAt: Date.now() }
            : item,
        )
      }
      current.status = "completed"
      delete current.lastError
      return current
    })
  })
}

async function renderIRWithRetry(input: { workspace: string; jobID: string; workItemID: string; ir: DesignDocIR }) {
  let failure: unknown
  const outputPath = `work-items/${input.workItemID}/render/${input.ir.viewType}.png`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (input.ir.viewType === "structure") {
        return await renderStructure({ workspace: input.workspace, jobID: input.jobID, ir: input.ir, outputPath })
      }
      if (input.ir.viewType === "code-structure") {
        return await renderCodeStructure({ workspace: input.workspace, jobID: input.jobID, ir: input.ir, outputPath })
      }
      if (input.ir.viewType === "execution-flow") {
        return await renderExecutionFlow({ workspace: input.workspace, jobID: input.jobID, ir: input.ir, outputPath })
      }
      if (input.ir.viewType === "business-flow") {
        return await renderBusinessFlow({ workspace: input.workspace, jobID: input.jobID, ir: input.ir, outputPath })
      }
      if (input.ir.viewType === "sequence") {
        return await renderSequence({ workspace: input.workspace, jobID: input.jobID, ir: input.ir, outputPath })
      }
      if (input.ir.viewType === "data-flow") {
        return await renderDataFlow({ workspace: input.workspace, jobID: input.jobID, ir: input.ir, outputPath })
      }
      if (input.ir.viewType === "error-flow") {
        return await renderErrorFlow({ workspace: input.workspace, jobID: input.jobID, ir: input.ir, outputPath })
      }
      if (input.ir.viewType === "overview") {
        return await renderOverview({ workspace: input.workspace, jobID: input.jobID, ir: input.ir, outputPath })
      }
      if (
        input.ir.viewType === "topic" ||
        input.ir.viewType === "product-section" ||
        input.ir.viewType === "not-applicable"
      ) {
        throw new Error("非图形 IR 不应进入图渲染器")
      }
      return await renderLifecycle({ workspace: input.workspace, jobID: input.jobID, ir: input.ir, outputPath })
    } catch (error) {
      failure = error
    }
  }
  throw failure
}

function ensureRecovered(workspace: string) {
  return Effect.gen(function* () {
    const jobs = yield* Effect.promise(() => DesignDocStore.list(workspace))
    for (const job of jobs) {
      if (job.status === "completed") {
        if (job.lastError || job.workItems.some((item) => item.status === "passed" && item.failure)) {
          yield* change(
            workspace,
            job.id,
            (current) => {
              if (current.status !== "completed") return current
              delete current.lastError
              current.workItems = current.workItems.map((item) =>
                item.status === "passed" ? { ...item, failure: undefined } : item,
              )
              return current
            },
            true,
          )
        }
        continue
      }
      if (["cancelled", "failed", "blocked", "paused"].includes(job.status)) continue
      if (running.has(job.id)) continue
      const release = yield* Effect.promise(() => DesignDocStore.acquireRunLease(workspace, job.id))
      if (!release) continue
      const recovered = yield* Effect.exit(
        Effect.gen(function* () {
          yield* recoverStructuredResults(workspace, job)
          yield* change(workspace, job.id, (current) => {
            current.status = "discovering"
            current.workItems = current.workItems.map((item) => interruptItem(item))
            current.progress = progress(current.workItems)
            return current
          })
        }),
      )
      if (Exit.isFailure(recovered)) {
        yield* Effect.promise(release).pipe(Effect.ignore)
        return yield* Effect.failCause(recovered.cause)
      }
      yield* launch(workspace, job.id, release)
    }
  })
}

function recoverStructuredResults(workspace: string, job: DesignDocJob) {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    for (const item of job.workItems) {
      if (item.candidateArtifactPath || (item.status !== "running" && item.status !== "validating")) continue
      const attempt = [...item.attempts].reverse().find((candidate) => candidate.status === "running")
      if (!attempt) continue
      const messages = yield* sessions
        .messages({ sessionID: SessionID.make(attempt.sessionID) })
        .pipe(Effect.catch(() => Effect.succeed([])))
      let structured: unknown
      let usage: { cost: number; tokens: NonNullable<WorkItem["attempts"][number]["tokens"]> } | undefined
      for (const message of [...messages].reverse()) {
        if (message.info.role !== "assistant" || message.info.structured === undefined || message.info.error) continue
        structured = message.info.structured
        usage = { cost: message.info.cost, tokens: message.info.tokens }
        break
      }
      if (structured === undefined) continue
      const packArtifact = job.artifacts.find(
        (candidate) => candidate.workItemID === item.id && candidate.kind === "evidence-pack",
      )
      if (!packArtifact) continue
      const packValue = yield* Effect.promise(() => DesignDocStore.readDeclaredArtifact(job, packArtifact.id))
      const pack = yield* Effect.promise(() =>
        Schema.decodeUnknownPromise(EvidencePackSchema)(JSON.parse(packValue.content.toString("utf8"))),
      )
      const metadata = yield* Effect.promise(() =>
        DesignDocStore.writeJSON(
          workspace,
          job.id,
          `work-items/${item.id}/attempts/${attempt.number}/candidate.json`,
          structured,
        ),
      )
      yield* change(workspace, job.id, (current) => {
        if (!current.workItems.some((candidate) => candidate.id === item.id)) return current
        return {
          ...current,
          status: "validating",
          workItems: current.workItems.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  status: "validating",
                  candidateArtifactPath: metadata.path,
                  candidateSourceSnapshotHash: pack.sourceSnapshotHash,
                  attempts: completeAttempt(candidate.attempts, attempt.number, "completed", usage),
                  updatedAt: Date.now(),
                }
              : candidate,
          ),
          artifacts: upsert(
            current.artifacts,
            artifact({
              ...metadata,
              id: `ART-${item.id}-IR-${attempt.number}`,
              workItemID: item.id,
              kind: "ir",
              status: "candidate",
            }),
          ),
        }
      })
    }
  })
}

function stopRuntime(jobID: string) {
  return Effect.gen(function* () {
    yield* cancelActiveSessions(jobID)
    const background = yield* BackgroundJob.Service
    yield* background.cancel(backgroundID(jobID)).pipe(Effect.ignore)
  })
}

/**
 * 同一 WorkItem 任一时刻只能注册一个活动 Attempt。
 * 重启恢复可能在 Session 创建与登记之间把 claimed item 归一化为 ready/retryable，
 * 登记事务负责原子地重新声明所有权，但绝不越过校验中或终态。
 */
export function canRegisterAttempt(item: Pick<WorkItem, "status" | "attempts">) {
  return (
    ["pending", "ready", "retryable", "running"].includes(item.status) &&
    !item.attempts.some((attempt) => attempt.status === "running")
  )
}

/** 历史清单即使曾产生重复编号，新 Attempt 也必须从已用最大编号继续。 */
export function nextAttemptNumber(attempts: ReadonlyArray<Pick<WorkItem["attempts"][number], "number">>) {
  return Math.max(0, ...attempts.map((attempt) => attempt.number)) + 1
}

function cancelActiveSessions(jobID: string) {
  return Effect.gen(function* () {
    const active = running.get(jobID)
    if (!active?.sessionIDs.size) return
    const sessionIDs = [...active.sessionIDs]
    active.sessionIDs.clear()
    const prompts = yield* SessionPrompt.Service
    yield* Effect.forEach(sessionIDs, (sessionID) => prompts.cancel(SessionID.make(sessionID)).pipe(Effect.ignore), {
      concurrency: "unbounded",
      discard: true,
    })
  })
}

function workItemExists(workspace: string, jobID: string, workItemID: string) {
  return read(workspace, jobID).pipe(
    Effect.map((job) => job.workItems.some((item) => item.id === workItemID)),
    Effect.catch(() => Effect.succeed(false)),
  )
}

function stopPromptWhenJobStops(workspace: string, jobID: string, workItemID: string, sessionID: SessionID) {
  return Effect.gen(function* () {
    const prompts = yield* SessionPrompt.Service
    while (true) {
      yield* Effect.sleep("250 millis")
      const job = yield* read(workspace, jobID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const item = job?.workItems.find((candidate) => candidate.id === workItemID)
      if (
        job &&
        !["paused", "failed", "blocked", "completed", "cancelled"].includes(job.status) &&
        item?.status === "running"
      ) {
        continue
      }
      yield* prompts.cancel(sessionID).pipe(Effect.ignore)
      return yield* Effect.interrupt
    }
  })
}

function backgroundID(jobID: string) {
  return `design-doc:${jobID}`
}

function change(workspace: string, jobID: string, mutate: (job: DesignDocJob) => DesignDocJob, allowStopped = false) {
  return Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const updated = yield* Effect.promise(() =>
      DesignDocStore.transact(workspace, jobID, (job) => {
        if (!allowStopped && ["paused", "failed", "blocked", "completed", "cancelled"].includes(job.status)) return job
        const next = mutate(job)
        next.progress = progress(next.workItems)
        return next
      }),
    )
    yield* Effect.promise(() => Bus.publish(ctx, DesignDocJobUpdated, event(updated)))
    return updated
  })
}

function publish(job: DesignDocJob) {
  return Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    yield* Effect.promise(() => Bus.publish(ctx, DesignDocJobUpdated, event(job)))
  })
}

function event(job: DesignDocJob) {
  return {
    jobID: job.id,
    revision: job.revision,
    status: job.status,
    progress: job.progress,
    changedWorkItemID: job.progress.currentWorkItemID,
    updatedAt: job.updatedAt,
  }
}

function read(workspace: string, jobID: string) {
  return Effect.tryPromise({
    try: () => DesignDocStore.get(workspace, jobID),
    catch: (error) =>
      error instanceof JobStoreError && error.code === "JOB_NOT_FOUND"
        ? new DesignDocManagerError("JOB_NOT_FOUND", error.message)
        : error,
  })
}

function blockDiscovery(workspace: string, jobID: string, error: unknown) {
  const code = error instanceof DesignDocDiscoveryError ? error.code : "INVALID_TARGET"
  return block(workspace, jobID, issue(code, message(error), false)).pipe(Effect.as(undefined))
}

function block(workspace: string, jobID: string, failure: ValidationIssue) {
  return change(workspace, jobID, (job) => {
    job.status = "blocked"
    job.lastError = failure
    job.workItems = job.workItems.map((item) =>
      item.status === "passed" ? item : { ...item, status: "blocked", failure, updatedAt: Date.now() },
    )
    return job
  })
}

function blockWorkItem(workspace: string, jobID: string, workItemID: string, failure: ValidationIssue) {
  return change(workspace, jobID, (job) => {
    const target = job.workItems.find((item) => item.id === workItemID)
    if (!target || target.status === "passed") return job
    job.status = "running"
    job.lastError = failure
    job.workItems = job.workItems.map((item) =>
      item.id === workItemID && item.status !== "passed"
        ? { ...item, status: "blocked", failure, updatedAt: Date.now() }
        : item,
    )
    return job
  })
}

function failWorkItem(workspace: string, jobID: string, workItemID: string, failure: ValidationIssue) {
  return change(workspace, jobID, (job) => {
    const target = job.workItems.find((item) => item.id === workItemID)
    if (!target || target.status === "passed") return job
    job.status = "running"
    job.lastError = failure
    job.workItems = job.workItems.map((item) =>
      item.id === workItemID && item.status !== "passed"
        ? { ...item, status: "failed", failure, updatedAt: Date.now() }
        : item,
    )
    return job
  })
}

function settleIncompleteJob(workspace: string, jobID: string) {
  return change(workspace, jobID, (job) => {
    const failure = job.workItems.find((item) => item.status === "failed")?.failure
    const blocked = job.workItems.find((item) => item.status === "blocked")?.failure
    if (failure) {
      job.status = "failed"
      job.lastError = failure
      return job
    }
    if (blocked) {
      job.status = "blocked"
      job.lastError = blocked
      return job
    }
    job.status = "blocked"
    job.lastError = issue("WORK_ITEM_MISSING", "Job 缺少可执行的 DesignDoc WorkItem", false)
    return job
  })
}

function failUnexpected(workspace: string, jobID: string, detail: string) {
  return Effect.gen(function* () {
    const current = yield* read(workspace, jobID).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!current || current.status === "paused" || current.status === "cancelled") return
    const failure = issue("RUNTIME_FAILURE", detail, false)
    yield* change(workspace, jobID, (job) => {
      job.status = "failed"
      job.lastError = failure
      job.workItems = job.workItems.map((item) =>
        item.status === "passed" ? item : { ...item, status: "failed", failure, updatedAt: Date.now() },
      )
      return job
    })
  })
}

function markStale(workspace: string, jobID: string) {
  return Effect.gen(function* () {
    yield* cancelActiveSessions(jobID)
    return yield* change(workspace, jobID, (job) => {
      job.status = "discovering"
      job.artifacts = job.artifacts.map((item) => ({ ...item, status: "stale" }))
      const now = Date.now()
      const templates = [
        ...new Map(
          job.workItems
            .filter((item) => item.artifactType !== "review")
            .map((item) => [item.artifactType, item] as const),
        ).values(),
      ].map((item) => ({
        ...item,
        id: `WI-${ulid()}`,
        moduleID: "pending",
        status: "pending" as const,
        dependencies: [],
        attempts: [],
        evidenceScope: undefined,
        retryCursor: undefined,
        modelOverride: undefined,
        artifactIDs: [],
        evidencePackPath: undefined,
        candidateArtifactPath: undefined,
        candidateSourceSnapshotHash: undefined,
        validationReportPath: undefined,
        failure: undefined,
        createdAt: now,
        updatedAt: now,
      }))
      const review = job.workItems.find((item) => item.artifactType === "review")
      job.workItems = review
        ? [
            ...templates,
            {
              ...review,
              id: `WI-${ulid()}`,
              moduleID: "pending",
              status: "pending",
              dependencies: [],
              attempts: [],
              artifactIDs: [],
              failure: undefined,
              createdAt: now,
              updatedAt: now,
            },
          ]
        : templates
      return job
    })
  })
}

function saveAttemptFailure(
  workspace: string,
  jobID: string,
  workItemID: string,
  attempt: number,
  report: ValidationReport,
) {
  return Effect.gen(function* () {
    const metadata = yield* Effect.promise(() =>
      DesignDocStore.writeJSON(
        workspace,
        jobID,
        `work-items/${workItemID}/attempts/${attempt}/validation.json`,
        report,
      ),
    )
    yield* change(workspace, jobID, (job) => {
      const target = job.workItems.find((item) => item.id === workItemID)
      if (!target || target.status === "passed") return job
      job.status = "running"
      job.workItems = job.workItems.map((item) =>
        item.id === workItemID && item.status !== "passed"
          ? {
              ...item,
              status: "retryable",
              validationReportPath: metadata.path,
              attempts: completeAttempt(item.attempts, attempt, "error"),
              updatedAt: Date.now(),
            }
          : item,
      )
      job.artifacts = upsert(
        job.artifacts,
        artifact({
          ...metadata,
          id: `ART-${workItemID}-VALIDATION-${attempt}`,
          workItemID,
          kind: "validation-report",
          status: "failed",
        }),
      )
      return job
    })
  })
}

function failureReport(pack: EvidencePack, attempt: number, error: unknown): ValidationReport {
  const failure = (() => {
    if (error instanceof DesignDocModelTimeoutError) return issue(error.code, error.message, true)
    if (error instanceof DesignDocWorkerResponseError) return issue(error.code, error.message, error.retryable)
    return issue("MODEL_RESPONSE_ERROR", message(error), false)
  })()
  return {
    schemaVersion: 1,
    workItemID: pack.workItemID,
    attempt,
    passed: false,
    sourceSnapshotHash: pack.sourceSnapshotHash,
    validatorVersions: { session: "1" },
    errors: [failure],
    warnings: [],
    metrics: { errorCount: 1 },
    createdAt: Date.now(),
  }
}

function canRetry(report: ValidationReport, policy: JobConfig["retryPolicy"]) {
  return report.errors.some(
    (error) =>
      error.retryable &&
      (policy.retryableCodes.includes(error.code) ||
        (policy.retryableCodes.includes("VALIDATION_FAILED") && report.validatorVersions.session === undefined)),
  )
}

function interruptItem(item: WorkItem): WorkItem {
  if (item.status !== "running" && item.status !== "validating") return item
  return {
    ...item,
    status: "retryable",
    attempts: item.attempts.map((attempt) =>
      attempt.status === "running" ? { ...attempt, status: "interrupted", completedAt: Date.now() } : attempt,
    ),
    updatedAt: Date.now(),
  }
}

function retryable(item: WorkItem): WorkItem {
  const { failure: _failure, ...clean } = item
  return { ...clean, status: "retryable", updatedAt: Date.now() }
}

function completeAttempt(
  attempts: WorkItem["attempts"],
  number: number,
  status: "completed" | "error",
  usage?: { cost: number; tokens: NonNullable<WorkItem["attempts"][number]["tokens"]> },
) {
  return attempts.map((attempt) =>
    attempt.number === number ? { ...attempt, status, completedAt: Date.now(), ...usage } : attempt,
  )
}

function modelFor(config: JobConfig, attempt: number): ModelReference {
  return (
    [...config.modelPolicy.fallbacks]
      .filter((item) => item.fromAttempt <= attempt)
      .sort((left, right) => right.fromAttempt - left.fromAttempt)[0]?.model ?? config.modelPolicy.primary
  )
}

function upsert(artifacts: Artifact[], value: Artifact) {
  return [...artifacts.filter((item) => item.id !== value.id), value]
}

function issue(
  code: string,
  text: string,
  retryable: boolean,
  evidenceIDs: readonly string[] = [],
  severity: ValidationIssue["severity"] = "error",
): ValidationIssue {
  return {
    severity,
    code,
    message: text,
    evidenceIDs: [...evidenceIDs],
    sourcePaths: [],
    retryable,
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function workspaceRoot(ctx: { worktree: string; directory: string }) {
  return ctx.worktree === path.parse(ctx.worktree).root ? ctx.directory : ctx.worktree
}
