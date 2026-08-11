import { Effect } from "effect"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { DESIGN_DOC_STRUCTURED_OUTPUT_TOOL, DESIGN_DOC_WORKER, designDocWorkerRules } from "@/chipmate/agent"
import type { ArtifactType, EvidencePack, ModelReference, ValidationReport } from "./domain"
import { lifecycleJSONSchema } from "./validator"
import { structureJSONSchema } from "./structure-validator"
import { codeStructureJSONSchema } from "./code-structure-validator"
import { overviewJSONSchema } from "./overview-validator"
import { topicJSONSchema } from "./topic-validator"
import { businessFlowJSONSchema } from "./business-flow-validator"
import {
  dataFlowJSONSchema,
  errorFlowJSONSchema,
  executionFlowJSONSchema,
  sequenceJSONSchema,
} from "./behavior-validator"
import { productJSONSchema } from "./product-validator"

export class DesignDocModelTimeoutError extends Error {
  readonly code = "MODEL_TIMEOUT"

  constructor(readonly timeoutMs: number) {
    super(`模型在 ${timeoutMs} ms 内未返回结构化结果`)
    this.name = "DesignDocModelTimeoutError"
  }
}

export class DesignDocWorkerResponseError extends Error {
  constructor(
    readonly code: "MODEL_AUTHENTICATION" | "MODEL_API_ERROR" | "MODEL_RESPONSE_ERROR" | "STRUCTURED_OUTPUT_MISSING",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = "DesignDocWorkerResponseError"
  }
}

export class DesignDocSessionInterruptedError extends Error {
  constructor(message = "DesignDoc Session 已中断") {
    super(message)
    this.name = "DesignDocSessionInterruptedError"
  }
}

export interface CreateWorkerSessionInput {
  jobID: string
  workItemID: string
  attempt: number
  kind: "generate" | "repair"
  artifactType: ArtifactType
  moduleName: string
  sourceSnapshotHash: string
  model: ModelReference
  ownerSessionID?: string
  repairedFromSessionID?: string
}

export function createWorkerSession(input: CreateWorkerSessionInput) {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    return yield* sessions.create({
      parentID: input.ownerSessionID ? SessionID.make(input.ownerSessionID) : undefined,
      title: `DesignDoc ${input.artifactType}: ${input.moduleName} #${input.attempt}`,
      agent: DESIGN_DOC_WORKER,
      model: {
        providerID: ProviderV2.ID.make(input.model.providerID),
        id: ModelV2.ID.make(input.model.modelID),
        variant: designDocModelVariant(input.model),
      },
      metadata: {
        designDocJobID: input.jobID,
        designDocWorkItemID: input.workItemID,
        designDocAttempt: input.attempt,
        designDocAttemptKind: input.kind,
        designDocArtifactType: input.artifactType,
        designDocSourceSnapshotHash: input.sourceSnapshotHash,
        ...(input.repairedFromSessionID ? { designDocRepairedFromSessionID: input.repairedFromSessionID } : {}),
      },
      permission: designDocWorkerRules(),
    })
  })
}

export interface PromptWorkerInput {
  sessionID: SessionID
  pack: EvidencePack
  model: ModelReference
  timeoutMs: number
  previousCandidate?: unknown
  previousReport?: ValidationReport
}

export function promptWorker(input: PromptWorkerInput) {
  return Effect.gen(function* () {
    const prompts = yield* SessionPrompt.Service
    const request = prompts.prompt({
      sessionID: input.sessionID,
      agent: DESIGN_DOC_WORKER,
      model: {
        providerID: ProviderV2.ID.make(input.model.providerID),
        modelID: ModelV2.ID.make(input.model.modelID),
      },
      variant: designDocModelVariant(input.model),
      tools: designDocWorkerTools(),
      format: outputFormat(input.pack),
      system: systemPrompt(input.pack),
      // 后台 DesignDoc Job 没有交互式用户；快照初始化较慢时必须静默等待，
      // 不能进入 question 流程把整个持久化调度器挂起。
      snapshotInitialization: "wait",
      parts: [{ type: "text", text: workerPrompt(input) }],
    })
    const timeout = Effect.sleep(`${input.timeoutMs} millis`).pipe(
      Effect.andThen(prompts.cancel(input.sessionID)),
      Effect.andThen(Effect.fail(new DesignDocModelTimeoutError(input.timeoutMs))),
    )
    const result = yield* Effect.raceFirst(request, timeout)
    if (result.info.role !== "assistant") {
      return yield* Effect.fail(
        new DesignDocWorkerResponseError("MODEL_RESPONSE_ERROR", "模型未返回 Assistant 消息", false),
      )
    }
    if (result.info.error) {
      if (SessionV1.AbortedError.isInstance(result.info.error)) {
        return yield* Effect.fail(new DesignDocSessionInterruptedError(result.info.error.data.message))
      }
      return yield* Effect.fail(designDocWorkerResponseError(result.info.error))
    }
    if (result.info.structured === undefined) {
      return yield* Effect.fail(
        new DesignDocWorkerResponseError("STRUCTURED_OUTPUT_MISSING", "模型未返回结构化结果", true),
      )
    }
    return {
      structured: result.info.structured,
      cost: result.info.cost,
      tokens: result.info.tokens,
    }
  })
}

export function designDocWorkerResponseError(
  error: SessionV1.Assistant["error"],
): DesignDocWorkerResponseError | DesignDocSessionInterruptedError {
  if (SessionV1.AbortedError.isInstance(error)) {
    return new DesignDocSessionInterruptedError(error.data.message)
  }
  if (SessionV1.AuthError.isInstance(error)) {
    return new DesignDocWorkerResponseError("MODEL_AUTHENTICATION", error.data.message, false)
  }
  if (SessionV1.APIError.isInstance(error)) {
    const authentication = error.data.statusCode === 401 || error.data.statusCode === 403
    return new DesignDocWorkerResponseError(
      authentication ? "MODEL_AUTHENTICATION" : "MODEL_API_ERROR",
      error.data.message,
      authentication ? false : error.data.isRetryable,
    )
  }
  if (SessionV1.StructuredOutputError.isInstance(error)) {
    return new DesignDocWorkerResponseError("STRUCTURED_OUTPUT_MISSING", error.data.message, true)
  }
  const message =
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data
      ? error.data.message
      : "模型响应失败"
  return new DesignDocWorkerResponseError("MODEL_RESPONSE_ERROR", message, false)
}

export function lifecycleOutputFormat() {
  return new SessionV1.OutputFormatJsonSchema({
    type: "json_schema",
    schema: structuredClone(lifecycleJSONSchema),
    // WorkItem 重试必须由 Orchestrator 创建全新 Session，不能在当前上下文内追加重试。
    retryCount: 0,
  })
}

export function structureOutputFormat() {
  return new SessionV1.OutputFormatJsonSchema({
    type: "json_schema",
    schema: structuredClone(structureJSONSchema),
    retryCount: 0,
  })
}

export function codeStructureOutputFormat() {
  return new SessionV1.OutputFormatJsonSchema({
    type: "json_schema",
    schema: structuredClone(codeStructureJSONSchema),
    retryCount: 0,
  })
}

export function behaviorOutputFormat(
  artifactType: "business-flow" | "execution-flow" | "sequence" | "data-flow" | "error-flow",
) {
  const schemas = {
    "business-flow": businessFlowJSONSchema,
    "execution-flow": executionFlowJSONSchema,
    sequence: sequenceJSONSchema,
    "data-flow": dataFlowJSONSchema,
    "error-flow": errorFlowJSONSchema,
  }
  return new SessionV1.OutputFormatJsonSchema({
    type: "json_schema",
    schema: structuredClone(schemas[artifactType]),
    retryCount: 0,
  })
}

export function overviewOutputFormat() {
  return new SessionV1.OutputFormatJsonSchema({
    type: "json_schema",
    schema: structuredClone(overviewJSONSchema),
    retryCount: 0,
  })
}

export function topicOutputFormat() {
  return new SessionV1.OutputFormatJsonSchema({
    type: "json_schema",
    schema: structuredClone(topicJSONSchema),
    retryCount: 0,
  })
}

export function productOutputFormat(pack: EvidencePack) {
  if (pack.purpose?.kind !== "product-section") throw new Error("产品章节 Evidence Pack 缺少 section purpose")
  return new SessionV1.OutputFormatJsonSchema({
    type: "json_schema",
    schema: structuredClone(productJSONSchema(pack.purpose.section)),
    retryCount: 0,
  })
}

function outputFormat(pack: EvidencePack) {
  const artifactType = pack.artifactType
  if (artifactType === "product-section") return productOutputFormat(pack)
  if (artifactType === "topic") return topicOutputFormat()
  if (artifactType === "structure") return structureOutputFormat()
  if (artifactType === "code-structure") return codeStructureOutputFormat()
  if (artifactType === "overview") return overviewOutputFormat()
  if (
    artifactType === "execution-flow" ||
    artifactType === "business-flow" ||
    artifactType === "sequence" ||
    artifactType === "data-flow" ||
    artifactType === "error-flow"
  ) {
    return behaviorOutputFormat(artifactType)
  }
  return lifecycleOutputFormat()
}

export function designDocWorkerTools() {
  return {
    "*": false,
    [DESIGN_DOC_STRUCTURED_OUTPUT_TOOL]: true,
  }
}

export function designDocModelVariant(model: ModelReference) {
  if (!model.variant && model.modelID.toLowerCase().includes("deepseek-v4")) return "thinking"
  return model.variant
}

function systemPrompt(pack: EvidencePack) {
  const target = targetIR(pack.artifactType)
  const topic = pack.purpose?.kind === "topic" ? ` 当前主题严格限定为 ${pack.purpose.topic}。` : ""
  const topicContract =
    pack.purpose?.kind === "topic"
      ? [
          "主题任务中，你只负责把每条必需 evidenceId 归入 conclusions、mechanisms、flows、exceptions 或 constraints，并确定同组顺序。",
          "claim.text 只用于说明分组意图；发布正文会由 TypeScript runtime 根据 Evidence.fact 和 attributes 确定性重建，模型措辞不会直接发布。",
          "同一 evidenceId 可以辅助说明分组，但不得用它代表 Evidence.fact 之外的新动作、能力或业务结果。",
        ].join("\n")
      : ""
  const topicDiagram = pack.topicClaims?.length
    ? [
        `这是与 ${pack.purpose?.kind === "diagram" ? pack.purpose.topic : "当前章节"} 对齐的章节图。`,
        "必须把 topicClaims 中每一条流程主张转换为可读的节点和关系，不能退化为若干局部变量读写。",
        "内部阶段的 sourceRef 必须原样复制对应证据的 attributes.ref、attributes.ownerRef 或 source.symbol。",
        "若主题主张说明后续处理位于模块外或当前源码无法证明，必须使用 external 实体或 unknowns 明确画出边界，不能把交接完成写成最终持久化完成。",
        "一条语义关系可以引用多个阶段的 evidenceId，但不得引用 topicClaims 之外的事实来补全业务链路。",
      ].join("\n")
    : ""
  const lifecycle =
    pack.artifactType === "lifecycle"
      ? [
          "生命周期图必须逐条复制源码证据中的 from、to、trigger、guard 和 action，不能把一个迁移拆成多条猜测边。",
          "若迁移证据的 attributes.from 为 __ANY_CURRENT_STATE__，transition.from 必须直接使用该固定字符串；它表示外部事件不检查原状态，不是一个状态节点，严禁把它加入 states。",
          "state.label 必须与 state.sourceValue 完全相同；可读解释放在 summary，不得改写源码状态值。",
        ].join("\n")
      : ""
  const productContract =
    pack.purpose?.kind === "product-section"
      ? [
          `本次只撰写产品文档章节“${pack.purpose.section}”，不得扩展到其他章节。`,
          "claims 是可追溯事实：confirmed 必须引用显式源码或上游文档证据；inferred 必须说明推理边界；unknown 不得伪装成现状。",
          "paragraphs 是将直接进入 Word 的读者正文。必须按业务概念、数据、算法、接口或场景组织，不得按文件逐个介绍，不得列出全量函数清单。",
          "同一段不得连续枚举 4 个或更多源码文件，应使用业务组件或逻辑模块名称。只有调用、流程、状态、数据读写或上游需求证据才能把行为与用途标为 confirmed；仅有文件、声明或依赖证据时只能确认存在、引用或声明关系，任何用途解释必须标为 inferred。",
          "每个 paragraphs.claimIDs 必须引用本次输出的 claims；正文可以保留必要的函数或类型标识符，但不能让读者自行阅读文件列表来理解设计。",
          "所有表格条目的 claimIDs 必须指向其依据。SFMEA 必须把已实现缓解与建议措施分开；验证用例必须区分 existing 与 recommended。",
          "如果证据不足，应把待确认内容写入 unknowns，并让正文明确边界；不得生成 AR 编号、接口语义、资源数值、状态或已有测试。",
          "你不负责生成图。图由独立 WorkItem 根据静态证据生成并由程序校验。",
        ].join("\n")
      : ""
  return [
    `你是 DesignDoc ${target} Worker。`,
    "流程、任务数量、成功状态、重试和文件输出均由 TypeScript runtime 管理。",
    `只把 Evidence Pack 中可直接证明的事实映射到一个 ${target}。`,
    "每个节点和关系必须引用有效 evidenceId；证据不足时写入 unknowns，不得生成无证据事实。",
    "主题正文的每条事实必须写出所引源码中的具体文件、函数、类型、状态、字段或分支条件；不得只堆 evidenceId 来覆盖门禁。",
    "所有面向读者的 title、summary、label、text 和 description 必须使用简体中文；源码标识符保持原样。",
    "面向读者的内容不得出现 Evidence Pack、WorkItem、Schema、runtime、Owner、unknowns、topic-evidence-sampled、MOD-*、flow-node/flow-edge 等内部流水线术语，应改写为自然中文。",
    "不要输出 Markdown、Mermaid、解释性正文或后续任务建议。",
    topic,
    topicContract,
    topicDiagram,
    lifecycle,
    productContract,
  ].join("\n")
}

function workerPrompt(input: PromptWorkerInput) {
  const target = targetIR(input.pack.artifactType)
  const sections = [`请为以下单一 WorkItem 生成 ${target}。`, `Evidence Pack:\n${JSON.stringify(input.pack)}`]
  if (input.previousCandidate !== undefined) {
    sections.push(`上一次候选：\n${JSON.stringify(input.previousCandidate)}`)
  }
  if (input.previousReport) {
    sections.push(`程序校验报告：\n${JSON.stringify(input.previousReport)}`)
    sections.push("只修复报告列出的当前产物错误，不得扩大源码范围或创建其他任务。")
  }
  return sections.join("\n\n")
}

function targetIR(artifactType: ArtifactType) {
  if (artifactType === "product-section") return "ProductSectionIR"
  if (artifactType === "structure") return "StructureIR"
  if (artifactType === "code-structure") return "CodeStructureIR"
  if (artifactType === "overview") return "OverviewIR"
  if (artifactType === "topic") return "DesignTopicIR"
  if (artifactType === "execution-flow") return "ExecutionFlowIR"
  if (artifactType === "business-flow") return "BusinessFlowIR"
  if (artifactType === "sequence") return "SequenceIR"
  if (artifactType === "data-flow") return "DataFlowIR"
  if (artifactType === "error-flow") return "ErrorFlowIR"
  return "LifecycleIR"
}
