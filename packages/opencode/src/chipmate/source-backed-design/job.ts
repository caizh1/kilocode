import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { declareArtifact } from "@/chipmate/documents/artifacts"
import { renderMermaidDiagram } from "@/chipmate/documents/mermaid"
import * as SemanticGuard from "@/chipmate/documents/mermaid-semantic-guard"
import {
  createWordDocument,
  inspectWordDocument,
  materializeWordFields,
  renderWordDocument,
  type WordBlock,
  type WordSection,
} from "@/chipmate/documents/word"
import { validateWordDocument } from "@/chipmate/documents/word-validation"
import { Instance } from "@/chipmate/instance"
import { ProductProfile } from "@/chipmate/product-profile"

const SCHEMA_VERSION = 1
const SKILL_REVISION = "SBDD_JOB_REVISION=2026-08-chunked-v1"
const JOB_KIND = "source-backed-detail-design-job"
const STATE_FILE = "job.json"
const LEASE_MS = 10 * 60 * 1000
const LOCK_STALE_MS = 5 * 60 * 1000
const TURN_BYTES = 192 * 1024
const PROSE_PER_TURN = 3
const DIAGRAMS_PER_TURN = 5
const MAX_ATTEMPTS = 4
const MAX_SOURCE_FILES = 2_000
const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const VIEWS = ["architecture", "business-flow", "code-flow", "state-machine", "data-lifecycle"] as const
const RELATION_KINDS = [
  "source-ownership",
  "owning-module",
  "system-position",
  "caller",
  "callee",
  "data-flow",
  "state-flow",
  "control-flow",
  "dependency",
  "collaboration",
  "management",
  "resource-ownership",
] as const
const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".h",
  ".cc",
  ".hh",
  ".cpp",
  ".hpp",
  ".cxx",
  ".hxx",
  ".inc",
  ".inl",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".cs",
  ".s",
  ".asm",
  ".ld",
  ".lds",
  ".mk",
  ".cmake",
  ".toml",
  ".yaml",
  ".yml",
  ".json",
  ".jsonc",
  ".xml",
  ".ini",
  ".cfg",
  ".conf",
])
const SOURCE_FILENAMES = new Set([
  "Makefile",
  "CMakeLists.txt",
  "Kconfig",
  "meson.build",
  "BUILD",
  "BUILD.bazel",
  "WORKSPACE",
  "WORKSPACE.bazel",
])
const IMPLEMENTATION_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".cs",
  ".s",
  ".asm",
])

type Phase = "scope" | "prose" | "diagrams" | "closing" | "assembly" | "complete" | "blocked"
type WorkKind = "scope" | "prose" | "diagram" | "closing"
type WorkStatus = "pending" | "leased" | "complete" | "failed"
type DiagramView = (typeof VIEWS)[number]

type SourceFile = {
  path: string
  sha256: string
  bytes: number
  lines: number
  implementation: boolean
}

type Evidence = {
  id?: string
  path: string
  startLine: number
  endLine: number
  symbols?: string[]
  summary?: string
}

type DesignUnit = {
  id: string
  name: string
  kind: "target" | "confirmed-submodule"
  parentId?: string
  implementationPaths: string[]
  stateMachine?: "required" | "not-applicable"
}

type Scope = {
  target: DesignUnit
  submodules: DesignUnit[]
  implementationUnits: Array<{
    path: string
    disposition: "target" | "confirmed-submodule" | "excluded"
    designUnitId?: string
    reason?: string
    evidence: Evidence[]
  }>
  relationships: Array<{
    kind:
      | "source-ownership"
      | "owning-module"
      | "system-position"
      | "caller"
      | "callee"
      | "data-flow"
      | "state-flow"
      | "control-flow"
      | "dependency"
      | "collaboration"
      | "management"
      | "resource-ownership"
    subject: string
    object: string
    statement: string
    confidence: "source-confirmed" | "high" | "medium" | "low-review" | "not-confirmed"
    evidence: Evidence[]
  }>
  evidence: Evidence[]
}

type WorkItem = {
  id: string
  kind: WorkKind
  status: WorkStatus
  unitId?: string
  topicIds?: number[]
  view?: DiagramView
  draftPath: string
  resultPath?: string
  attempts: number
  sourceHashes: Record<string, string>
  lease?: { sessionId: string; messageId: string; expiresAt: number; resultPath: string }
  error?: string
}

type DiagramRecord = {
  workItemId: string
  diagramId: string
  unitId: string
  view: DiagramView
  sourcePaths: string[]
  claimPaths: string[]
  pngPaths: string[]
  pngHashes: string[]
  semanticStatus: "valid" | "valid-with-unknowns"
  split: boolean
}

type TurnUsage = { prose: number; diagrams: number; bytes: number }

export type JobState = {
  schemaVersion: 1
  skillRevision: string
  jobId: string
  artifactDir: string
  workspace: string
  targetPath: string
  request: string
  createdAt: string
  updatedAt: string
  revision: number
  phase: Phase
  sourceFiles: SourceFile[]
  scope?: Scope
  workItems: WorkItem[]
  diagrams: DiagramRecord[]
  turns: Record<string, TurnUsage>
  firstIncompleteItem?: string
  finalDocxPath?: string
  renderArtifactDir?: string
  assemblyAttempts: number
  warnings: string[]
}

export type WorkPacket = {
  id: string
  kind: WorkKind
  /** 控制器租约对应的唯一绝对结果路径；模型必须原位写入并原样提交。 */
  draftPath: string
  relativeDraftPath: string
  unitId?: string
  topicIds?: number[]
  view?: DiagramView
  sourcePaths: string[]
  sourcePathsTruncated?: boolean
  instructions: string[]
  worker: {
    tool: "task"
    subagentType: "general"
    command: string
    description: string
    prompt: string
  }
}

export type JobResponse = {
  status: "work-ready" | "awaiting-continuation" | "needs-selection" | "blocked" | "complete" | "not-found"
  jobId?: string
  revision?: number
  artifactDir?: string
  absoluteArtifactDir?: string
  phase?: Phase
  progress?: { completed: number; total: number; pending: number; failed: number }
  workItem?: WorkPacket
  workItemError?: string
  candidates?: Array<{ jobId: string; artifactDir: string; phase: Phase; updatedAt: string; request: string }>
  firstIncompleteItem?: string
  finalDocxPath?: string
  absoluteFinalDocxPath?: string
  message: string
}

type ScopeDraft = {
  version: 1
  target: { id: string; name: string; implementationPaths: string[] }
  submodules: Array<{ id: string; name: string; implementationPaths: string[] }>
  implementationUnits: Scope["implementationUnits"]
  relationships: Scope["relationships"]
  evidence?: Evidence[]
}

type DiagramNode = {
  id: string
  label: string
  kind: string
  symbol?: string
  designUnitId?: string
  evidence: Evidence[]
}

type DiagramEdge = {
  id: string
  from: string
  to: string
  label: string
  relation: "direct-call" | "callback" | "ownership" | "dependency" | "data-flow" | "state-transition" | "unknown"
  fromSymbol?: string
  toSymbol?: string
  event?: string
  evidence: Evidence[]
}

type DiagramSpec = {
  version: 1
  diagramId: string
  designUnitId: string
  view: DiagramView
  title: string
  direction?: "TB" | "LR"
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  groups?: Array<{ id: string; label: string; nodeIds: string[] }>
  coverage: Record<string, string[]>
}

const TOPICS = [
  "业务定位与设计结论",
  "职责、非职责与边界",
  "触发、前置条件、输入与输出",
  "内部架构、上下游与依赖",
  "业务能力与完整业务流程",
  "核心对象、队列、缓存与生命周期",
  "函数功能覆盖与代码执行流程",
  "状态、事件、条件、动作与转换",
  "接口与协作",
  "异常、等待、重试、恢复与清理",
  "算法、配置、并发、资源与性能",
  "构建、注册、初始化与平台差异",
  "调试、可观测性与源码点读",
  "源码证据、置信度、缺口与审核项",
] as const

const COVERAGE: Record<DiagramView, string[]> = {
  architecture: ["boundaryNodeIds", "entryNodeIds", "componentNodeIds", "dependencyEdgeIds", "resourceNodeIds"],
  "business-flow": ["flowFamilyIds", "decisionEdgeIds", "errorEdgeIds", "terminalNodeIds", "effectNodeIds"],
  "code-flow": ["entryNodeIds", "conditionEdgeIds", "mutationNodeIds", "errorEdgeIds", "cleanupNodeIds"],
  "state-machine": ["transitionEdgeIds", "guardEdgeIds", "recoveryEdgeIds", "terminalStateNodeIds"],
  "data-lifecycle": ["objectNodeIds", "ownerNodeIds", "readWriteEdgeIds", "handoffEdgeIds", "releaseNodeIds"],
}

export async function start(input: { targetPath: string; request: string; sessionId: string; messageId: string }) {
  const workspace = await fs.realpath(Instance.directory)
  const target = await secureTarget(workspace, input.targetPath)
  const targetPath = portable(path.relative(workspace, target)) || "."
  const request = input.request.trim()
  if (!request) throw new Error("request 不能为空")
  const sourceFiles = await inventory(workspace, target)
  if (!sourceFiles.some((item) => item.implementation)) throw new Error("目标范围内没有可分析的实现源文件")
  const artifact = await declareArtifact({
    kind: JOB_KIND,
    title: `源码驱动详细设计：${path.basename(target)}`,
    taskSlug: `${path.basename(target)}-source-backed-detail-design`,
    sourceFiles: sourceFiles.map((item) => item.path),
    qualityStatus: "unknown",
  })
  const jobId = path.basename(artifact.artifactDir)
  const state: JobState = {
    schemaVersion: SCHEMA_VERSION,
    skillRevision: SKILL_REVISION,
    jobId,
    artifactDir: artifact.artifactDir,
    workspace,
    targetPath,
    request,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    phase: "scope",
    sourceFiles,
    workItems: [scopeWork(sourceFiles)],
    diagrams: [],
    turns: {},
    assemblyAttempts: 0,
    firstIncompleteItem: "scope-lock",
    warnings: [],
  }
  await initialize(state)
  return next(state, input.sessionId, input.messageId)
}

export async function resume(input: { jobId?: string; sessionId: string; messageId: string; takeover?: boolean }) {
  const candidates = await list()
  const selected = input.jobId
    ? await loadById(input.jobId).catch(() => undefined)
    : candidates.length === 1
      ? candidates[0]
      : undefined
  if (!selected) {
    if (!candidates.length)
      return {
        status: "not-found",
        message: "当前工作区没有由分块控制器创建的未完成详细设计任务。",
      } satisfies JobResponse
    return {
      status: "needs-selection",
      candidates: candidates.map(summary),
      message: "当前工作区存在多个未完成详细设计任务，请指定 jobId；控制器不会猜测。",
    } satisfies JobResponse
  }
  if (selected.phase === "complete") return response(selected, "complete")
  const state = await refreshSourceDrift(selected)
  if (input.takeover) {
    const active = state.workItems.filter(
      (item) => item.status === "leased" && item.lease?.sessionId !== input.sessionId,
    )
    if (active.length) {
      for (const item of active) {
        item.status = "pending"
        item.lease = undefined
      }
      state.warnings.push(`显式 Skill 续作已回收 ${active.length} 个旧会话租约。`)
      await save(state, state.revision)
    }
  }
  return next(state, input.sessionId, input.messageId)
}

export async function status(jobId?: string): Promise<JobResponse> {
  const candidates = await list()
  const state = jobId
    ? await loadById(jobId).catch(() => undefined)
    : candidates.length === 1
      ? candidates[0]
      : undefined
  if (!state) {
    if (!candidates.length) return { status: "not-found", message: "没有未完成的分块详细设计任务。" }
    return { status: "needs-selection", candidates: candidates.map(summary), message: "存在多个任务，请指定 jobId。" }
  }
  return response(
    state,
    state.phase === "complete" ? "complete" : state.phase === "blocked" ? "blocked" : "work-ready",
    undefined,
  )
}

export async function authorizeWorker(input: { command: string; sessionId: string; boundJobId: string }) {
  const match = /^source-backed-design-job-worker:([^:]+):(\d+):([A-Za-z0-9_-]+)$/.exec(input.command)
  if (!match || match[1] !== input.boundJobId) return false
  const itemId = Buffer.from(match[3]!, "base64url").toString("utf8")
  const state = await loadById(match[1]!).catch(() => undefined)
  if (!state || state.revision !== Number(match[2])) return false
  const item = state.workItems.find((candidate) => candidate.id === itemId)
  const root = path.join(state.workspace, state.artifactDir)
  const nested = item?.lease ? path.relative(root, path.resolve(root, item.lease.resultPath)) : ".."
  return Boolean(
    item?.status === "leased" &&
      item.lease?.sessionId === input.sessionId &&
      nested !== "" &&
      !nested.startsWith("..") &&
      !path.isAbsolute(nested),
  )
}

export async function submit(input: {
  jobId: string
  workItemId: string
  expectedRevision: number
  resultPath: string
  sessionId: string
  messageId: string
}): Promise<JobResponse> {
  const state = await loadById(input.jobId)
  if (state.revision !== input.expectedRevision)
    throw new Error(
      `任务 revision 已变化：期望 ${input.expectedRevision}，当前 ${state.revision}。请重新调用 resume/status。`,
    )
  const item = state.workItems.find((candidate) => candidate.id === input.workItemId)
  if (!item) throw new Error(`未知工作项：${input.workItemId}`)
  if (item.status !== "leased" || item.lease?.sessionId !== input.sessionId)
    throw new Error(`工作项 ${item.id} 未租给当前会话，拒绝覆盖。`)
  const resultPath = await exactResultPath(state, item, input.resultPath)
  const stat = await fs.stat(resultPath)
  if (!stat.isFile() || stat.size === 0) throw new Error(`工作项结果为空：${input.resultPath}`)
  if (stat.size > 256 * 1024) throw new Error(`单个工作项结果超过 256 KiB：${stat.size}`)
  await verifySourceHashes(state, item)
  try {
    if (item.kind === "scope") await acceptScope(state, item, resultPath)
    if (item.kind === "prose") await acceptProse(state, item, resultPath)
    if (item.kind === "diagram") await acceptDiagram(state, item, resultPath)
    if (item.kind === "closing") await acceptClosing(state, item, resultPath)
    item.status = "complete"
    item.resultPath = portable(path.relative(state.workspace, resultPath))
    item.lease = undefined
    item.error = undefined
    usage(state, input.messageId, item, stat.size)
    advance(state)
    await save(state, input.expectedRevision)
  } catch (error) {
    item.attempts += 1
    item.status = item.attempts >= MAX_ATTEMPTS ? "failed" : "pending"
    item.lease = undefined
    item.error = error instanceof Error ? error.message : String(error)
    state.firstIncompleteItem = item.id
    if (item.status === "failed") {
      state.phase = "blocked"
      state.warnings.push(`工作项 ${item.id} 连续 ${item.attempts} 次未通过：${item.error}`)
    }
    await save(state, input.expectedRevision)
    throw error
  }
  if (paused(state, input.messageId))
    return response(state, "awaiting-continuation", undefined, "本回合已达到分块预算，请回复“继续”。")
  return next(state, input.sessionId, input.messageId)
}

async function next(state: JobState, sessionId: string, messageId: string): Promise<JobResponse> {
  releaseExpired(state)
  if (state.phase === "complete") return response(state, "complete")
  if (state.phase === "blocked") return response(state, "blocked")
  if (paused(state, messageId))
    return response(state, "awaiting-continuation", undefined, "本回合已达到分块预算，请回复“继续”。")
  const leased = state.workItems.find((candidate) => candidate.status === "leased")
  if (leased) {
    if (leased.lease?.sessionId === sessionId) return response(state, "work-ready", packet(state, leased))
    return response(
      state,
      "awaiting-continuation",
      undefined,
      `工作项 ${leased.id} 仍由另一会话持有短租约；请在原会话继续，或通过显式 Skill 命令恢复以回收租约。`,
    )
  }
  const item = state.workItems.find((candidate) => candidate.status === "pending")
  if (!item) {
    if (state.phase === "assembly") {
      try {
        await assemble(state)
        await save(state, state.revision)
        return response(state, "complete")
      } catch (error) {
        state.assemblyAttempts += 1
        state.phase = state.assemblyAttempts >= MAX_ATTEMPTS ? "blocked" : "assembly"
        state.firstIncompleteItem = "word-assembly"
        state.warnings.push(error instanceof Error ? error.message : String(error))
        await save(state, state.revision)
        return response(
          state,
          state.phase === "blocked" ? "blocked" : "awaiting-continuation",
          undefined,
          `最终 Word 组装第 ${state.assemblyAttempts} 次未通过：${state.warnings.at(-1)}`,
        )
      }
    }
    advance(state)
    await save(state, state.revision)
    return next(state, sessionId, messageId)
  }
  item.status = "leased"
  item.lease = {
    sessionId,
    messageId,
    expiresAt: Date.now() + LEASE_MS,
    resultPath: leaseResultPath(item, state.revision + 1, sessionId),
  }
  item.sourceHashes = Object.fromEntries(
    packet(state, item).sourcePaths.flatMap((source) => {
      const hash = state.sourceFiles.find((candidate) => candidate.path === source)?.sha256
      return hash ? [[source, hash]] : []
    }),
  )
  state.firstIncompleteItem = item.id
  await prepareDraft(state, item)
  await save(state, state.revision)
  return response(state, "work-ready", packet(state, item))
}

function response(
  state: JobState,
  status: JobResponse["status"],
  workItem?: WorkPacket,
  message?: string,
): JobResponse {
  const complete = state.workItems.filter((item) => item.status === "complete").length
  const failed = state.workItems.filter((item) => item.status === "failed").length
  const pending = state.workItems.length - complete - failed
  const absoluteFinalDocxPath = state.finalDocxPath ? path.join(state.workspace, state.finalDocxPath) : undefined
  const absoluteArtifactDir = path.join(state.workspace, state.artifactDir)
  return {
    status,
    jobId: state.jobId,
    revision: state.revision,
    artifactDir: state.artifactDir,
    absoluteArtifactDir,
    phase: state.phase,
    progress: { completed: complete, total: state.workItems.length, pending, failed },
    workItem,
    workItemError: state.workItems.find((item) => item.id === state.firstIncompleteItem)?.error,
    firstIncompleteItem: state.firstIncompleteItem,
    finalDocxPath: state.finalDocxPath,
    absoluteFinalDocxPath,
    message:
      message ??
      (status === "complete"
        ? `详细设计已完成。Word 文档绝对路径：${absoluteFinalDocxPath}`
        : status === "blocked"
          ? `任务被确定性门禁阻塞：${state.firstIncompleteItem ?? "unknown"}；${state.warnings.at(-1) ?? "无附加诊断"}`
          : `下一工作项：${workItem?.id ?? state.firstIncompleteItem ?? "unknown"}`),
  }
}

function packet(state: JobState, item: WorkItem): WorkPacket {
  const unit = item.unitId ? units(state).find((candidate) => candidate.id === item.unitId) : undefined
  const candidates = unit
    ? [
        ...unitSources(state, unit),
        ...state.sourceFiles.filter((file) => !file.implementation).map((file) => file.path),
      ]
    : state.sourceFiles.map((file) => file.path)
  const uniqueSources = [...new Set(candidates)]
  const relativeDraftPath = item.lease?.resultPath ?? item.draftPath
  const base = {
    id: item.id,
    kind: item.kind,
    draftPath: path.join(state.workspace, state.artifactDir, relativeDraftPath),
    relativeDraftPath,
    unitId: item.unitId,
    topicIds: item.topicIds,
    view: item.view,
    sourcePaths: uniqueSources.slice(0, 64),
    sourcePathsTruncated: uniqueSources.length > 64,
  }
  let instructions: string[]
  if (item.kind === "scope")
    instructions = [
        "控制器已创建范围 JSON 模板；只写入 draftPath 给出的绝对路径，提交时原样传回该路径。读取同一 absoluteArtifactDir 下的 01-scope/source-inventory.json 和实际源码后原位填写。",
        "target.implementationPaths 只列目标单元自己拥有的实现文件；每个 submodules[*].implementationPaths 只列该子单元自己拥有的实现文件，不能在父子单元间重复。",
        "implementationUnits.disposition 只允许精确填写 target、confirmed-submodule、excluded；每个冻结范围内的实现文件必须且只能出现一次。target 和每个 confirmed-submodule 至少拥有一个实现文件；excluded 不填写 designUnitId，且必须给出原因和范围内源码证据。",
        "所有 Evidence.path 只能取 source-inventory.json 的 files[*].path；不要引用冻结范围外的父目录或相邻目录文件。无法在冻结范围内证明的关系使用 not-confirmed，但仍用范围内证据说明为何无法确认。",
        "在 relationships 中把系统位置、源码归属、所属上级模块、调用、数据/状态/控制流、依赖、协作、管理和所有权分别取证；证据不足时不要猜测。",
      ]
  else if (item.kind === "prose")
    instructions = [
        `控制器已创建正文模板；只写入 draftPath 给出的绝对路径，提交时原样传回该路径；只完成主题 ${item.topicIds?.map((id) => String(id).padStart(2, "0")).join("、")}。`,
        "每个主题使用独立 H4、紧邻的 SBDD-TOPIC-STATUS，以及“设计结论、机制与流程、异常与边界、源码证据”四个字段。",
        "源码证据必须包含工作区相对 path:start-end；每个主题至少包含一项当前 DesignUnit 自有实现文件证据，也可以引用冻结范围内的上游、下游或协作实现作为接口上下文；名称、列表或表格不能代替解释性正文。",
      ]
  else if (item.kind === "diagram")
    instructions = [
        `控制器已创建 ${item.view} 的 version=1 DiagramSpec 模板；只写入 draftPath 给出的绝对路径并原样提交，不要直接写 Mermaid。`,
        `coverage 必须包含：${COVERAGE[item.view!].join("、")}，其中的 ID 必须引用真实节点或边。`,
        ...(item.view === "architecture" && item.unitId === state.scope?.target.id
          ? [
              `目标架构图必须用 node.designUnitId 将每个确认子模块恰好映射一次：${state.scope?.submodules.map((child) => child.id).join("、") || "当前没有确认子模块"}。`,
            ]
          : []),
        "每个节点使用 kind 字段描述角色，禁止使用旧的 type 字段；节点和边逐项提供源码证据；整张图至少包含一项当前 DesignUnit 自有实现文件证据，也可以用冻结范围内的上游、下游或协作实现证明接口边界。",
        "图必须覆盖适用分支、异常、异步、状态或生命周期语义。",
        "每个节点必须填写 designUnitId；目标架构图中的确认子模块节点填写各自 ID，其余节点填写当前工作项 ID。",
      ]
  else
    instructions = [
      "只写入 draftPath 给出的绝对路径，提交时原样传回该路径。用中文完成跨模块协作、全局索引、算法并发资源、调试点读、覆盖检查和风险限制章节。",
      "每个 H2/H3 标题后必须有解释性正文和源码证据；不得重复逐单元正文。",
    ]
  const current = { ...base, instructions }
  const command = workerCommand(state, item)
  return {
    ...current,
    worker: {
      tool: "task",
      subagentType: "general",
      command,
      description: `完成 ${item.id}`.slice(0, 80),
      prompt: workerPrompt(state, item, current, command),
    },
  }
}

function workerCommand(state: JobState, item: WorkItem) {
  return `source-backed-design-job-worker:${state.jobId}:${state.revision}:${Buffer.from(item.id).toString("base64url")}`
}

function workerPrompt(
  state: JobState,
  item: WorkItem,
  packet: Omit<WorkPacket, "worker">,
  command: string,
) {
  const unitFile = item.unitId
    ? path.join(state.workspace, state.artifactDir, `05-enhanced-detail-design/units/${item.unitId}.md`)
    : undefined
  return [
    "你是 source-backed-detail-design 控制器的隔离工作进程，只完成下面一个工作项。",
    `工作项：${item.id}`,
    `工作区：${state.workspace}`,
    `唯一允许写入的结果文件：${packet.draftPath}`,
    `控制器提交令牌（只供父会话调用 task/submit，不要自行调用控制器）：${command}`,
    ...(unitFile && item.kind === "diagram" ? [`已验收正文：${unitFile}`] : []),
    `冻结源码候选：${packet.sourcePaths.join("、")}`,
    ...packet.instructions.map((instruction) => `要求：${instruction}`),
    "先读取结果模板和必要源码，只修改唯一结果文件；禁止修改源码、job.json、其他工作项、Mermaid、PNG 或 DOCX。",
    "不要创建子任务，不要请求用户补充，不要复用其他任务产物。完成后只回复：WORK_ITEM_READY 加结果文件绝对路径。",
  ].join("\n")
}

async function prepareDraft(state: JobState, item: WorkItem) {
  const relative = item.lease?.resultPath ?? item.draftPath
  const file = path.join(state.workspace, state.artifactDir, relative)
  if (
    await fs
      .access(file)
      .then(() => true)
      .catch(() => false)
  )
    return
  if (item.kind === "scope") {
    const implementationUnits = state.sourceFiles
      .filter((source) => source.implementation)
      .map((source) => ({
        path: source.path,
        disposition: "target",
        designUnitId: "target_unit",
        reason: "",
        evidence: [{ path: source.path, startLine: 1, endLine: 1 }],
      }))
    await writeJson(state, relative, {
      version: 1,
      target: {
        id: "target_unit",
        name: "请填写目标模块名称",
        implementationPaths: implementationUnits.map((row) => row.path),
      },
      submodules: [],
      implementationUnits,
      relationships: [
        ...RELATION_KINDS.map((kind) => ({
          kind,
          subject: "请填写目标模块名称",
          object: kind === "source-ownership" ? state.targetPath : "请填写关系对象或待确认",
          statement: `请填写${relationLabel(kind)}结论；证据不足时明确写待确认`,
          confidence: kind === "source-ownership" ? "source-confirmed" : "not-confirmed",
          evidence: implementationUnits.slice(0, 1).flatMap((row) => row.evidence),
        })),
      ],
      evidence: implementationUnits.flatMap((row) => row.evidence),
    })
    return
  }
  if (item.kind === "prose") {
    const body = (item.topicIds ?? [])
      .map(
        (id) =>
          `#### ${String(id).padStart(2, "0")} ${TOPICS[id - 1]}\n\n` +
          `SBDD-TOPIC-STATUS: ${String(id).padStart(2, "0")} | MISSING | 待填写证据\n\n` +
          "设计结论：待填写。\n\n机制与流程：待填写。\n\n异常与边界：待填写。\n\n源码证据：待填写工作区相对路径:start-end。",
      )
      .join("\n\n")
    await writeText(state, relative, `${body}\n`)
    return
  }
  if (item.kind === "diagram") {
    await writeJson(state, relative, {
      version: 1,
      diagramId: `${item.unitId}_${item.view!.replaceAll("-", "_")}`,
      designUnitId: item.unitId,
      view: item.view,
      title: "请填写中文图题",
      direction: item.view === "business-flow" || item.view === "code-flow" ? "TB" : "LR",
      nodes: [],
      edges: [],
      groups: [],
      coverage: Object.fromEntries(COVERAGE[item.view!].map((key) => [key, []])),
    })
    return
  }
  await writeText(
    state,
    relative,
    [
      "## 跨模块协作与端到端链路\n\n待填写。",
      "## 全局对象、接口、状态、配置与构建索引\n\n待填写。",
      "## 算法、并发、资源与性能\n\n待填写。",
      "## 调试、可观测性与建议点读源码\n\n待填写。",
      "## 覆盖、证据、风险与待确认项\n\n待填写。",
    ].join("\n\n"),
  )
}

function scopeWork(files: SourceFile[]): WorkItem {
  return {
    id: "scope-lock",
    kind: "scope",
    status: "pending",
    draftPath: "01-scope/module-scope.json",
    attempts: 0,
    sourceHashes: Object.fromEntries(files.map((file) => [file.path, file.sha256])),
  }
}

async function acceptScope(state: JobState, item: WorkItem, resultPath: string) {
  const value = JSON.parse(await fs.readFile(resultPath, "utf8")) as ScopeDraft
  if (
    value.version !== 1 ||
    !value.target ||
    !Array.isArray(value.submodules) ||
    !Array.isArray(value.implementationUnits) ||
    !Array.isArray(value.relationships)
  )
    throw new Error("范围结果必须是 version=1 且包含 target、submodules、implementationUnits、relationships 的 JSON")
  const designUnits: DesignUnit[] = [
    {
      id: value.target.id,
      name: value.target.name,
      implementationPaths: value.target.implementationPaths,
      kind: "target",
    },
    ...value.submodules.map((unit) => ({
      id: unit.id,
      name: unit.name,
      implementationPaths: unit.implementationPaths,
      kind: "confirmed-submodule" as const,
      parentId: value.target.id,
    })),
  ]
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const unit of designUnits) {
    const name = unit.name?.trim()
    if (!validId(unit.id) || ids.has(unit.id) || !name || names.has(name))
      throw new Error(`非法或重复 DesignUnit：${unit.id}`)
    ids.add(unit.id)
    names.add(name)
  }
  const implementations = new Set(state.sourceFiles.filter((file) => file.implementation).map((file) => file.path))
  const mapped = new Map<string, number>()
  for (const row of value.implementationUnits) {
    if (!implementations.has(row.path)) throw new Error(`implementationUnits 包含范围外实现文件：${row.path}`)
    mapped.set(row.path, (mapped.get(row.path) ?? 0) + 1)
    if (row.disposition !== "excluded" && (!row.designUnitId || !ids.has(row.designUnitId)))
      throw new Error(`实现文件 ${row.path} 没有映射到有效 DesignUnit`)
    if (row.disposition === "excluded" && row.designUnitId)
      throw new Error(`排除文件 ${row.path} 不能同时映射到 DesignUnit`)
    if (row.disposition === "excluded" && (!row.reason?.trim() || !row.evidence?.length))
      throw new Error(`排除实现文件 ${row.path} 必须提供原因和证据`)
    if (row.disposition === "target" && row.designUnitId !== value.target.id)
      throw new Error(`目标实现文件 ${row.path} 必须映射到 target`)
    if (row.disposition === "confirmed-submodule" && !value.submodules.some((unit) => unit.id === row.designUnitId))
      throw new Error(`子模块实现文件 ${row.path} 必须映射到 confirmed submodule`)
    validateEvidence(state, row.evidence ?? [])
  }
  const missing = [...implementations].filter((file) => mapped.get(file) !== 1)
  if (missing.length) throw new Error(`实现文件必须且只能映射一次：${missing.join(", ")}`)
  for (const unit of designUnits) {
    const actual = value.implementationUnits
      .filter((row) => row.designUnitId === unit.id && row.disposition !== "excluded")
      .map((row) => row.path)
      .sort()
    if (
      !actual.length ||
      actual.join("\0") !== [...unit.implementationPaths].sort().join("\0")
    )
      throw new Error(`DesignUnit ${unit.id} 的 implementationPaths 与映射表不一致`)
  }
  const relationshipKinds = new Set(RELATION_KINDS)
  const confidenceLevels = new Set(["source-confirmed", "high", "medium", "low-review", "not-confirmed"])
  const suppliedKinds = new Set(value.relationships.map((relation) => relation.kind))
  const missingKinds = RELATION_KINDS.filter((kind) => !suppliedKinds.has(kind))
  if (missingKinds.length) throw new Error(`relationships 缺少独立审计项：${missingKinds.join(", ")}`)
  if (
    !value.relationships.some(
      (relation) =>
        relation.kind === "source-ownership" && [value.target.id, value.target.name].includes(relation.subject.trim()),
    )
  )
    throw new Error("relationships 必须包含目标模块自身的 source-ownership 证据")
  for (const relation of value.relationships) {
    if (
      !relationshipKinds.has(relation.kind) ||
      !confidenceLevels.has(relation.confidence) ||
      !relation.subject?.trim() ||
      !relation.object?.trim() ||
      !relation.statement?.trim()
    )
      throw new Error("relationships 包含非法或空关系")
    validateEvidence(state, relation.evidence)
  }
  validateEvidence(state, value.evidence ?? [])
  state.scope = {
    target: designUnits[0]!,
    submodules: designUnits.slice(1),
    implementationUnits: value.implementationUnits,
    relationships: value.relationships,
    evidence: value.evidence ?? [],
  }
  const census = {
    version: 1,
    targetDesignUnitId: state.scope.target.id,
    targetSourceRoot: state.targetPath,
    designUnits: designUnits.map(({ implementationPaths: _paths, ...unit }) => unit),
    implementationUnits: value.implementationUnits.map((row) => ({
      path: row.path,
      disposition: row.disposition,
      designUnitId: row.designUnitId,
      ...(row.disposition === "excluded"
        ? { exclusion: { reason: normalizeExclusion(row.reason), evidence: row.evidence } }
        : {}),
    })),
  }
  await writeJson(state, "02-source-evidence/design-unit-census.json", census)
  state.workItems.push(...designUnits.flatMap(proseWork))
  state.phase = "prose"
  item.resultPath = portable(path.relative(state.workspace, resultPath))
}

function proseWork(unit: DesignUnit): WorkItem[] {
  return [
    [1, 2, 3, 4, 5],
    [6, 7, 8, 9],
    [10, 11, 12, 13, 14],
  ].map((topicIds) => ({
    id: `prose:${unit.id}:${String(topicIds[0]).padStart(2, "0")}-${String(topicIds.at(-1)).padStart(2, "0")}`,
    kind: "prose" as const,
    status: "pending" as const,
    unitId: unit.id,
    topicIds,
    draftPath: `05-enhanced-detail-design/drafts/${unit.id}-${String(topicIds[0]).padStart(2, "0")}-${String(topicIds.at(-1)).padStart(2, "0")}.md`,
    attempts: 0,
    sourceHashes: {},
  }))
}

async function acceptProse(state: JobState, item: WorkItem, resultPath: string) {
  const text = await fs.readFile(resultPath, "utf8")
  const topics = parseTopics(text)
  const expected = item.topicIds ?? []
  if (topics.size !== expected.length || expected.some((id) => !topics.has(id)))
    throw new Error(`正文工作项必须且只能包含主题 ${expected.join(", ")}`)
  for (const id of expected) {
    const topic = topics.get(id)!
    if (id !== 8 && topic.status !== "PASS") throw new Error(`主题 ${id} 不允许 N/A`)
    for (const label of ["设计结论", "机制与流程", "异常与边界", "源码证据"])
      if (!topic.body.includes(`${label}：`) && !topic.body.includes(`${label}:`))
        throw new Error(`主题 ${id} 缺少字段：${label}`)
    if (explanatory(topic.body) < 120) throw new Error(`主题 ${id} 的解释性正文过短`)
    const evidence = evidenceFromText(state, topic.body)
    if (!evidence.length) throw new Error(`主题 ${id} 没有 path:start-end 源码证据`)
    validateEvidence(state, evidence)
    validateUnitEvidence(state, item.unitId!, evidence, true)
  }
  item.resultPath = portable(path.relative(state.workspace, resultPath))
  const unit = units(state).find((candidate) => candidate.id === item.unitId)!
  const siblings = state.workItems.filter((candidate) => candidate.kind === "prose" && candidate.unitId === item.unitId)
  if (siblings.every((candidate) => candidate.id === item.id || candidate.status === "complete")) {
    const fragments = await Promise.all(
      siblings
        .sort((left, right) => (left.topicIds?.[0] ?? 0) - (right.topicIds?.[0] ?? 0))
        .map((candidate) =>
          fs.readFile(
            candidate.id === item.id ? resultPath : path.join(state.workspace, candidate.resultPath!),
            "utf8",
          ),
        ),
    )
    await writeText(
      state,
      `05-enhanced-detail-design/units/${unit.id}.md`,
      `# ${unit.name}\n\n${fragments.join("\n\n")}\n`,
    )
    const combined = parseTopics(fragments.join("\n\n"))
    unit.stateMachine = combined.get(8)?.status === "N/A" ? "not-applicable" : "required"
  }
}

function parseTopics(text: string) {
  const matches = [...text.matchAll(/^####\s+(?:主题\s*)?(0?[1-9]|1[0-4])(?:[.、：:\s]|$).*$/gm)]
  const output = new Map<number, { status: "PASS" | "N/A"; title: string; body: string }>()
  for (const [index, match] of matches.entries()) {
    const id = Number(match[1])
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? text.length
    const block = text.slice(start, end).trim()
    const marker = new RegExp(`^SBDD-TOPIC-STATUS:\\s*0?${id}\\s*\\|\\s*(PASS|N/A)\\s*\\|\\s*(.+)$`, "m").exec(block)
    if (!marker) throw new Error(`主题 ${id} 缺少紧邻的 SBDD-TOPIC-STATUS`)
    if (output.has(id)) throw new Error(`主题 ${id} 重复`)
    output.set(id, {
      status: marker[1] as "PASS" | "N/A",
      title: match[0].replace(/^####\s+(?:主题\s*)?(?:0?[1-9]|1[0-4])(?:[.、：:\s]+)?/, "").trim() || TOPICS[id - 1],
      body: block.replace(marker[0], "").trim(),
    })
  }
  return output
}

function explanatory(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const value = line.trim()
      return value && !/^[-*+]\s/.test(value) && !/^\|/.test(value) && !/^[A-Za-z0-9_]+\s*$/.test(value)
    })
    .join("").length
}

function evidenceFromText(state: JobState, text: string): Evidence[] {
  const found: Evidence[] = []
  const seen = new Set<string>()
  for (const source of [...state.sourceFiles].sort((left, right) => right.path.length - left.path.length)) {
    const pattern = new RegExp(`(?:^|[\\s|（(：:\\x60])(${escapeRegex(source.path)}):(\\d+)(?:-(\\d+))?`, "gm")
    for (const match of text.matchAll(pattern)) {
      const startLine = Number(match[2])
      const endLine = Number(match[3] ?? match[2])
      const key = `${source.path}:${startLine}-${endLine}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ path: source.path, startLine, endLine })
    }
  }
  return found
}

function advance(state: JobState) {
  if (
    state.phase === "prose" &&
    state.workItems.filter((item) => item.kind === "prose").every((item) => item.status === "complete")
  ) {
    const allowed = new Set(
      units(state)
        .flatMap(diagramWork)
        .map((item) => item.id),
    )
    state.workItems = state.workItems.filter((item) => item.kind !== "diagram" || allowed.has(item.id))
    state.diagrams = state.diagrams.filter((diagram) => allowed.has(diagram.workItemId))
    const existing = new Set(state.workItems.map((item) => item.id))
    state.workItems.push(
      ...units(state)
        .flatMap(diagramWork)
        .filter((item) => !existing.has(item.id)),
    )
    state.phase = "diagrams"
  }
  if (
    state.phase === "diagrams" &&
    state.workItems.filter((item) => item.kind === "diagram").every((item) => item.status === "complete")
  ) {
    state.workItems.push({
      id: "closing-chapters",
      kind: "closing",
      status: "pending",
      draftPath: "06-cross-module/closing-chapters.md",
      attempts: 0,
      sourceHashes: {},
    })
    state.phase = "closing"
  }
  if (
    state.phase === "closing" &&
    state.workItems.some((item) => item.kind === "closing" && item.status === "complete")
  )
    state.phase = "assembly"
  state.firstIncompleteItem =
    state.workItems.find((item) => item.status !== "complete")?.id ??
    (state.phase === "assembly" ? "word-assembly" : undefined)
}

function diagramWork(unit: DesignUnit): WorkItem[] {
  return VIEWS.filter((view) => view !== "state-machine" || unit.stateMachine !== "not-applicable").map((view) => ({
    id: `diagram:${unit.id}:${view}`,
    kind: "diagram",
    status: "pending",
    unitId: unit.id,
    view,
    draftPath: `04-diagrams/specs/${unit.id}-${view}.json`,
    attempts: 0,
    sourceHashes: {},
  }))
}

async function acceptDiagram(state: JobState, item: WorkItem, resultPath: string) {
  const spec = JSON.parse(await fs.readFile(resultPath, "utf8")) as DiagramSpec
  await validateDiagramSpec(state, item, spec)
  const rendered = await renderSpec(state, spec)
  const hashes = await Promise.all(
    rendered.pngPaths.map(async (file) => sha(await fs.readFile(path.join(state.workspace, file)))),
  )
  if (new Set(hashes).size !== hashes.length) throw new Error(`同一 Diagram 的聚焦 PNG 内容重复：${spec.diagramId}`)
  const used = new Set(state.diagrams.flatMap((record) => record.pngHashes))
  const duplicate = hashes.find((hash) => used.has(hash))
  if (duplicate) throw new Error(`PNG 内容与其他 Diagram 重复：${duplicate}`)
  state.diagrams.push({
    workItemId: item.id,
    diagramId: spec.diagramId,
    unitId: spec.designUnitId,
    view: spec.view,
    sourcePaths: rendered.sourcePaths,
    claimPaths: rendered.claimPaths,
    pngPaths: rendered.pngPaths,
    pngHashes: hashes,
    semanticStatus: rendered.semanticStatus,
    split: rendered.split,
  })
  item.resultPath = portable(path.relative(state.workspace, resultPath))
}

async function validateDiagramSpec(state: JobState, item: WorkItem, spec: DiagramSpec) {
  if (spec.version !== 1 || spec.designUnitId !== item.unitId || spec.view !== item.view || !validId(spec.diagramId))
    throw new Error("DiagramSpec 的 version、designUnitId、view 或 diagramId 与工作项不一致")
  const nodes = new Map<string, DiagramNode>()
  for (const node of spec.nodes ?? []) {
    if (!validId(node.id)) throw new Error(`图节点 ID 非法：${node.id}`)
    if (nodes.has(node.id)) throw new Error(`图节点 ID 重复：${node.id}`)
    if (!node.label?.trim()) throw new Error(`图节点 ${node.id} 缺少可见标签`)
    if (!node.kind?.trim()) {
      const legacy = typeof (node as DiagramNode & { type?: unknown }).type === "string"
      throw new Error(
        legacy ? `图节点 ${node.id} 使用了旧字段 type；必须改为 kind` : `图节点 ${node.id} 缺少 kind 字段`,
      )
    }
    if (!node.designUnitId) throw new Error(`图节点 ${node.id} 缺少 designUnitId`)
    validateEvidence(state, node.evidence)
    validateUnitEvidence(state, spec.designUnitId, node.evidence)
    nodes.set(node.id, node)
  }
  const edges = new Map<string, DiagramEdge>()
  for (const edge of spec.edges ?? []) {
    if (!validId(edge.id) || edges.has(edge.id) || !nodes.has(edge.from) || !nodes.has(edge.to))
      throw new Error(`非法图边：${edge.id}`)
    validateVisibleRelation(edge)
    validateEvidence(state, edge.evidence)
    validateUnitEvidence(state, spec.designUnitId, edge.evidence)
    edges.set(edge.id, edge)
  }
  if (!nodes.size || !edges.size) throw new Error("DiagramSpec 不能是空图或纯节点清单")
  if (state.diagrams.some((diagram) => diagram.diagramId === spec.diagramId))
    throw new Error(`Diagram ID 已被其他视图使用：${spec.diagramId}`)
  const groupIds = new Set<string>()
  const groupedNodes = new Set<string>()
  for (const group of spec.groups ?? []) {
    if (!validId(group.id) || groupIds.has(group.id) || !group.label?.trim() || !group.nodeIds.length)
      throw new Error(`非法或重复图分组：${group.id}`)
    groupIds.add(group.id)
    for (const nodeId of group.nodeIds) {
      if (!nodes.has(nodeId)) throw new Error(`图分组 ${group.id} 引用了未知节点：${nodeId}`)
      if (groupedNodes.has(nodeId)) throw new Error(`节点 ${nodeId} 不能同时属于多个分组`)
      groupedNodes.add(nodeId)
    }
  }
  if (spec.view !== "state-machine" && spec.edges.some((edge) => edge.from === edge.to))
    throw new Error(`${spec.view} 不允许用自环边冒充分支、交接或生命周期步骤`)
  const ids = new Set([...nodes.keys(), ...edges.keys()])
  for (const key of COVERAGE[spec.view]) {
    const values = spec.coverage?.[key]
    if (!Array.isArray(values) || !values.length) throw new Error(`${spec.view} 缺少 coverage.${key}`)
    const missing = values.filter((id) => !ids.has(id))
    if (missing.length) throw new Error(`coverage.${key} 引用未知节点或边：${missing.join(", ")}`)
    const expectedType = key.endsWith("EdgeIds") || key === "flowFamilyIds" ? "edge" : "node"
    const wrong = values.filter((id) => (expectedType === "edge" ? !edges.has(id) : !nodes.has(id)))
    if (wrong.length)
      throw new Error(`coverage.${key} 必须只引用${expectedType === "edge" ? "边" : "节点"}：${wrong.join(", ")}`)
  }
  const coverageValues = Object.values(spec.coverage).flat()
  if (new Set(coverageValues).size < COVERAGE[spec.view].length)
    throw new Error(`${spec.view} 的语义覆盖项不能全部复用同一节点或边冒充详细图`)
  const representatives = COVERAGE[spec.view].map((key) => spec.coverage[key]![0]!)
  if (new Set(representatives).size !== representatives.length)
    throw new Error(`${spec.view} 的每个语义角色必须使用不同的首要节点或边`)
  const incident = new Set(spec.edges.flatMap((edge) => [edge.from, edge.to]))
  const isolated = spec.nodes.filter((node) => !incident.has(node.id))
  if (isolated.length) throw new Error(`图中存在没有关系的孤立节点：${isolated.map((node) => node.id).join(", ")}`)
  if (spec.edges.some((edge) => edge.label.trim().length < 2)) throw new Error("每条可见边必须带有明确语义标签")
  if (spec.view === "state-machine") {
    const invalid = spec.edges.filter((edge) => edge.relation !== "state-transition" || !edge.event?.trim())
    if (invalid.length) throw new Error(`状态机边必须是带 event 的 state-transition：${invalid.map((edge) => edge.id)}`)
  }
  validateDiagramRoutes(spec, edges)
  const allowedUnits = new Set([spec.designUnitId])
  if (spec.view === "architecture" && spec.designUnitId === state.scope?.target.id)
    for (const unit of state.scope.submodules) allowedUnits.add(unit.id)
  const foreign = spec.nodes.filter((node) => node.designUnitId && !allowedUnits.has(node.designUnitId))
  if (foreign.length) throw new Error(`图节点声明了范围外 DesignUnit：${foreign.map((node) => node.id).join(", ")}`)
  if (spec.view === "architecture" && spec.designUnitId === state.scope?.target.id) {
    for (const child of state.scope.submodules) {
      const count = spec.nodes.filter((node) => node.designUnitId === child.id).length
      if (count !== 1) throw new Error(`目标架构图必须将确认子模块 ${child.id} 恰好映射一次，当前为 ${count}`)
    }
  }
  const prose = path.join(
    state.workspace,
    state.artifactDir,
    `05-enhanced-detail-design/units/${spec.designUnitId}.md`,
  )
  if (
    !state.workItems.some(
      (candidate) =>
        candidate.unitId === spec.designUnitId && candidate.kind === "prose" && candidate.status === "complete",
    )
  )
    throw new Error(`DesignUnit ${spec.designUnitId} 正文未完成，禁止绘图`)
  if (!prose.startsWith(state.workspace)) throw new Error("正文路径越界")
  const required = await requiredDiagramEvidence(state, spec.designUnitId, spec.view)
  const visible = [...spec.nodes, ...spec.edges].flatMap((entry) => entry.evidence)
  validateUnitEvidence(state, spec.designUnitId, visible, true)
  const missing = required.filter(
    (expected) =>
      !visible.some(
        (actual) =>
          portable(actual.path) === portable(expected.path) &&
          actual.startLine <= expected.startLine &&
          actual.endLine >= expected.endLine,
      ),
  )
  if (missing.length)
    throw new Error(
      `${spec.view} 未覆盖对应正文的源码证据：${missing
        .slice(0, 20)
        .map((evidence) => `${evidence.path}:${evidence.startLine}-${evidence.endLine}`)
        .join("、")}`,
    )
}

async function requiredDiagramEvidence(state: JobState, unitId: string, view: DiagramView) {
  const topicsByView: Record<DiagramView, number[]> = {
    architecture: [2, 3, 4, 9, 12],
    "business-flow": [3, 5, 10],
    "code-flow": [7, 10],
    "state-machine": [8, 10],
    "data-lifecycle": [6, 10, 11],
  }
  const file = path.join(state.workspace, state.artifactDir, `05-enhanced-detail-design/units/${unitId}.md`)
  const topics = parseTopics(await fs.readFile(file, "utf8"))
  const evidence = topicsByView[view].flatMap((id) => {
    const topic = topics.get(id)
    return topic ? evidenceFromText(state, topic.body) : []
  })
  const unique = new Map(evidence.map((item) => [`${item.path}:${item.startLine}-${item.endLine}`, item]))
  if (!unique.size) throw new Error(`${view} 对应正文没有可用于绘图的源码证据`)
  return [...unique.values()]
}

function validateVisibleRelation(edge: DiagramEdge) {
  const label = edge.label.trim()
  if (edge.relation === "unknown") return
  const callback = /(?:回调|callback)/i.test(label)
  if (callback && edge.relation !== "callback")
    throw new Error(`图边 ${edge.id} 的可见标签表示回调，但 relation 不是 callback`)
  if (!callback && /(?:调用|invoke|\bcall(?:s|ed|ing)?\b)/i.test(label) && edge.relation !== "direct-call")
    throw new Error(`图边 ${edge.id} 的可见标签表示调用，但 relation 不是 direct-call`)
  if (/(?:所有权|拥有|持有|ownership)/i.test(label) && edge.relation !== "ownership")
    throw new Error(`图边 ${edge.id} 的可见标签表示所有权，但 relation 不是 ownership`)
}

function validateDiagramRoutes(spec: DiagramSpec, edges: Map<string, DiagramEdge>) {
  const route = (from: string[], to: string[]) => {
    const targets = new Set(to)
    const pending = [...from]
    const seen = new Set(pending)
    while (pending.length) {
      const current = pending.shift()!
      if (targets.has(current)) return true
      for (const edge of spec.edges) {
        if (edge.from !== current || seen.has(edge.to)) continue
        seen.add(edge.to)
        pending.push(edge.to)
      }
    }
    return false
  }
  const edgeSources = (key: string) => spec.coverage[key]!.map((id) => edges.get(id)!.from)
  const edgeTargets = (key: string) => spec.coverage[key]!.map((id) => edges.get(id)!.to)
  if (spec.view === "business-flow") {
    const entries = edgeSources("flowFamilyIds")
    if (!route(entries, spec.coverage.terminalNodeIds!)) throw new Error("业务流程主路径无法到达终止结果")
    if (!route(edgeTargets("errorEdgeIds"), spec.coverage.terminalNodeIds!))
      throw new Error("业务流程异常路径无法到达终止结果")
    if (!route(entries, spec.coverage.effectNodeIds!)) throw new Error("业务流程主路径没有覆盖状态、数据或资源副作用")
  }
  if (spec.view === "code-flow") {
    if (!route(spec.coverage.entryNodeIds!, spec.coverage.cleanupNodeIds!))
      throw new Error("代码流程入口无法到达清理或完成路径")
    if (!route(edgeTargets("errorEdgeIds"), spec.coverage.cleanupNodeIds!))
      throw new Error("代码流程错误返回无法到达清理路径")
  }
  if (spec.view === "state-machine") {
    if (!route(edgeSources("transitionEdgeIds"), spec.coverage.terminalStateNodeIds!))
      throw new Error("状态转换无法到达终止状态")
    if (!route(edgeTargets("recoveryEdgeIds"), spec.coverage.terminalStateNodeIds!))
      throw new Error("状态机恢复路径无法回到可终止路径")
  }
  if (spec.view === "data-lifecycle") {
    if (!route(spec.coverage.objectNodeIds!, spec.coverage.releaseNodeIds!))
      throw new Error("数据对象从创建/初始化节点无法到达失效或释放节点")
    if (!route(spec.coverage.ownerNodeIds!, spec.coverage.releaseNodeIds!))
      throw new Error("数据所有者无法追踪到失效或释放路径")
  }
}

async function renderSpec(state: JobState, spec: DiagramSpec) {
  const session = `source-backed-job:${state.jobId}`
  SemanticGuard.mark(session)
  const baseDir = `${state.artifactDir}/04-diagrams/rendered/${spec.designUnitId}/${spec.view}/${spec.diagramId}`
  const parent = await renderOne(state, session, spec, baseDir)
  if (parent.documentReady && parent.pngPath && parent.semanticStatus !== "invalid")
    return {
      sourcePaths: [parent.sourcePath!],
      claimPaths: [parent.claimPath],
      pngPaths: [parent.pngPath],
      semanticStatus: parent.semanticStatus,
      split: false,
    }
  if (parent.wordFitStatus !== "split-required" || !parent.fingerprint)
    throw new Error(`图 ${spec.diagramId} 渲染失败：${parent.error}`)
  SemanticGuard.hold(session, parent.fingerprint)
  const detail = SemanticGuard.pendingDetails(session).find((candidate) => candidate.diagramId === spec.diagramId)
  if (!detail?.suggestedChildren.length) throw new Error(`图 ${spec.diagramId} 需要拆分但没有确定性拆分建议`)
  const children = [] as Awaited<ReturnType<typeof renderOne>>[]
  for (const [index, suggestion] of detail.suggestedChildren.entries()) {
    const child = subset(
      spec,
      suggestion.suggestedDiagramId,
      suggestion.splitFromDiagramId,
      suggestion.nodes.map((node) => node.id),
      spec.edges
        .filter((edge) =>
          suggestion.edges.some(
            (candidate) =>
              candidate.from === edge.from && candidate.to === edge.to && candidate.relation === edge.relation,
          ),
        )
        .map((edge) => edge.id),
      index,
    )
    const rendered = await renderOne(state, session, child, `${baseDir}/focus-${index + 1}`)
    if (!rendered.documentReady || !rendered.pngPath || !rendered.fingerprint || rendered.semanticStatus === "invalid")
      throw new Error(`拆分图 ${child.diagramId} 仍不可读：${rendered.error}`)
    SemanticGuard.allow(session, rendered.sourceHash, rendered.pngPath, rendered.fingerprint, rendered.source)
    children.push(rendered)
  }
  if (SemanticGuard.pending(session).includes(spec.diagramId)) throw new Error(`拆分图未完整覆盖父图 ${spec.diagramId}`)
  return {
    sourcePaths: [parent.sourcePath!, ...children.map((item) => item.sourcePath!)],
    claimPaths: [parent.claimPath, ...children.map((item) => item.claimPath)],
    pngPaths: children.map((item) => item.pngPath!),
    semanticStatus: children.some((item) => item.semanticStatus === "valid-with-unknowns")
      ? ("valid-with-unknowns" as const)
      : ("valid" as const),
    split: true,
  }
}

async function renderOne(state: JobState, session: string, spec: DiagramSpec, artifactDir: string) {
  const source = mermaid(spec)
  const sourceHash = sha(source)
  const containers = new Map(
    (spec.groups ?? []).flatMap((group) => group.nodeIds.map((nodeId) => [nodeId, group.id] as const)),
  )
  const claimPath = `${artifactDir}/diagram-claims.json`
  const absoluteClaim = path.join(state.workspace, claimPath)
  const evidenceCatalog: Record<string, Evidence & { fileHash?: string }> = {}
  let evidenceIndex = 0
  const bind = (items: Evidence[]) =>
    items.map((evidence) => {
      const id = `E${String(++evidenceIndex).padStart(4, "0")}`
      evidenceCatalog[id] = {
        ...evidence,
        fileHash: state.sourceFiles.find((file) => file.path === evidence.path)?.sha256,
      }
      return id
    })
  const claim = {
    version: 1,
    diagramId: spec.diagramId,
    ...(typeof (spec as DiagramSpec & { splitFromDiagramId?: string }).splitFromDiagramId === "string"
      ? { splitFromDiagramId: (spec as DiagramSpec & { splitFromDiagramId?: string }).splitFromDiagramId }
      : {}),
    diagramType: spec.view,
    scopePath: state.targetPath,
    sourceHash,
    language: cFamily(state) ? "c" : undefined,
    designUnitId: spec.designUnitId,
    designUnitCensusPath: `${state.artifactDir}/02-source-evidence/design-unit-census.json`,
    evidenceCatalog,
    nodes: spec.nodes.map((node) => ({
      id: node.id,
      symbol: node.symbol,
      container: containers.get(node.id),
      designUnitId: node.designUnitId,
      status: "confirmed",
      evidenceIds: bind(node.evidence),
    })),
    edges: spec.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      fromSymbol: edge.fromSymbol,
      toSymbol: edge.toSymbol,
      event: edge.event,
      status: edge.relation === "unknown" ? "unknown" : "confirmed",
      evidenceIds: bind(edge.evidence),
    })),
  }
  await fs.mkdir(path.dirname(absoluteClaim), { recursive: true })
  await fs.writeFile(absoluteClaim, `${JSON.stringify(claim, null, 2)}\n`, "utf8")
  const budget = SemanticGuard.validate(session, claimPath) ?? SemanticGuard.render(session, claimPath)
  if (budget) throw new Error(budget.message)
  const result = await renderMermaidDiagram({
    source,
    title: spec.title,
    artifactDir,
    sourceFile: `${spec.diagramId}.mmd`,
    pngFile: `${spec.diagramId}.png`,
    scale: 3,
    background: "white",
    semanticMode: "source-backed",
    semanticEvidencePath: claimPath,
    semanticSessionId: session,
  })
  const semantic = result.semanticStatus === "valid" || result.semanticStatus === "valid-with-unknowns"
  if (result.rendered && semantic && result.documentReady && result.pngPath)
    SemanticGuard.allow(session, result.sourceHash, result.pngPath, result.semanticFingerprint, source)
  return {
    source,
    sourceHash: result.sourceHash,
    sourcePath: result.sourcePath,
    claimPath,
    pngPath: result.pngPath,
    semanticStatus: semantic ? (result.semanticStatus as "valid" | "valid-with-unknowns") : ("invalid" as const),
    documentReady: result.documentReady === true,
    wordFitStatus: result.wordFitStatus,
    fingerprint: result.semanticFingerprint,
    error: [...result.semanticIssues, ...result.diagnostics]
      .map((issue) => issue.message)
      .slice(0, 10)
      .join("; "),
  }
}

function subset(
  spec: DiagramSpec,
  diagramId: string,
  splitFromDiagramId: string,
  nodeIds: string[],
  edgeIds: string[],
  index: number,
) {
  const nodes = new Set(nodeIds)
  const edges = spec.edges.filter((edge) => edgeIds.includes(edge.id) || (nodes.has(edge.from) && nodes.has(edge.to)))
  for (const edge of edges) {
    nodes.add(edge.from)
    nodes.add(edge.to)
  }
  const child = {
    ...spec,
    diagramId,
    title: `${spec.title}（聚焦图 ${index + 1}）`,
    nodes: spec.nodes.filter((node) => nodes.has(node.id)),
    edges,
    groups: spec.groups
      ?.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => nodes.has(id)) }))
      .filter((group) => group.nodeIds.length),
    coverage: Object.fromEntries(
      Object.entries(spec.coverage).map(([key, ids]) => [
        key,
        ids.filter((id) => nodes.has(id) || edges.some((edge) => edge.id === id)),
      ]),
    ),
    splitFromDiagramId,
  }
  return child as DiagramSpec
}

function mermaid(spec: DiagramSpec) {
  const lines = [
    `flowchart ${spec.direction ?? (spec.view === "business-flow" || spec.view === "code-flow" ? "TB" : "LR")}`,
  ]
  const grouped = new Set<string>()
  for (const group of spec.groups ?? []) {
    lines.push(`  subgraph ${group.id}["${escapeLabel(group.label)}"]`)
    for (const id of group.nodeIds) {
      const node = spec.nodes.find((candidate) => candidate.id === id)
      if (!node) continue
      grouped.add(id)
      lines.push(`    ${node.id}["${escapeLabel(node.label)}"]`)
    }
    lines.push("  end")
  }
  for (const node of spec.nodes) if (!grouped.has(node.id)) lines.push(`  ${node.id}["${escapeLabel(node.label)}"]`)
  for (const edge of spec.edges) lines.push(`  ${edge.from} -->|"${escapeLabel(edge.label)}"| ${edge.to}`)
  return `${lines.join("\n")}\n`
}

async function acceptClosing(state: JobState, item: WorkItem, resultPath: string) {
  const text = await fs.readFile(resultPath, "utf8")
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)]
  if (headings.length < 4) throw new Error("收尾内容至少需要四个有正文的 H2 章节")
  for (const [index, heading] of headings.entries()) {
    const start = (heading.index ?? 0) + heading[0].length
    const end = headings[index + 1]?.index ?? text.length
    const body = text.slice(start, end)
    if (explanatory(body) < 100) throw new Error(`收尾章节“${heading[1]}”缺少解释性正文`)
    const evidence = evidenceFromText(state, body)
    if (!evidence.length) throw new Error(`收尾章节“${heading[1]}”缺少源码证据`)
    validateEvidence(state, evidence)
  }
  item.resultPath = portable(path.relative(state.workspace, resultPath))
}

async function assemble(state: JobState) {
  if (!state.scope) throw new Error("范围尚未锁定")
  await ensureSourceBaseline(state)
  if (state.workItems.some((item) => item.status !== "complete")) throw new Error("仍有未完成工作项")
  const expected = state.workItems.filter((item) => item.kind === "diagram").length
  if (state.diagrams.length !== expected) throw new Error(`图形覆盖不足：${state.diagrams.length}/${expected}`)
  const sections: WordSection[] = [
    {
      title: "阅读路径",
      level: 1,
      paragraphs: [
        "先阅读范围、系统定位和目标模块总览，再按 DesignUnit 顺序阅读业务、实现、状态和数据生命周期，最后查阅跨模块协作、覆盖与风险。",
      ],
    },
    {
      title: "术语、范围与证据基线",
      level: 1,
      blocks: [
        { type: "paragraph", text: `目标源码范围：${state.targetPath}` },
        {
          type: "paragraph",
          text: `目标模块：${state.scope.target.name}；确认子模块：${state.scope.submodules.map((unit) => unit.name).join("、") || "无"}`,
        },
        {
          type: "table",
          headers: ["DesignUnit", "类型", "实现文件"],
          rows: units(state).map((unit) => [
            unit.name,
            unit.kind === "target" ? "目标模块" : "确认子模块",
            unit.implementationPaths.join("\n"),
          ]),
          caption: "表：冻结的设计单元范围",
        },
      ],
    },
    {
      title: "所属上级模块与目标模块角色",
      level: 1,
      blocks: [
        {
          type: "paragraph",
          text: "本章只陈述源码证据能够证明的系统位置、源码归属、调用关系和数据/控制权传递；不同关系不相互推导，证据不足项保留为待确认。",
        },
        {
          type: "table",
          headers: ["关系类型", "主体", "对象", "结论", "置信度", "源码证据"],
          rows: state.scope.relationships.map((relation) => [
            relationLabel(relation.kind),
            relation.subject,
            relation.object,
            relation.statement,
            relation.confidence,
            relation.evidence.map((item) => `${item.path}:${item.startLine}-${item.endLine}`).join("\n"),
          ]),
          caption: "表：目标模块关系证据账本",
        },
      ],
    },
  ]
  for (const unit of units(state)) sections.push(await unitSection(state, unit))
  sections.push(...(await closingSections(state)))
  const wordDir = `${state.artifactDir}/08-word-export`
  const draft = await createWordDocument({
    artifactDir: wordDir,
    title: `${state.scope.target.name} 源码驱动详细设计文档`,
    documentType: `基于 ${state.targetPath} 当前源码与证据的目标模块及内部子模块详细设计`,
    author: "ChipMate source-backed-detail-design",
    language: "zh-CN",
    headingNumbering: "decimal",
    artifactTitle: `${state.scope.target.name} 源码驱动详细设计`,
    outputFile: "working.docx",
    summary: [
      `文档范围：${state.scope.target.name} 及 ${state.scope.submodules.length} 个源码确认子模块。`,
      `源码基线：${state.sourceFiles.length} 个文件，任务创建时间 ${state.createdAt}。`,
      "证据状态：正文与五类图均已通过分块控制器校验。",
      "{{TOC}}",
    ],
    sections,
  })
  const fields = await materializeWordFields({
    sourcePath: draft.path,
    artifactDir: wordDir,
    outputFile: "final.docx",
    title: `${state.scope.target.name} 详细设计目录物化`,
    tocMode: "materialize",
  })
  const validation = await validateWordDocument({ path: fields.path, repairMode: "none" })
  if (validation.status !== "valid" || !validation.path)
    throw new Error(`DOCX 严格校验失败：${validation.errors.map((item) => item.message).join("; ")}`)
  const inspection = await inspectWordDocument({
    path: validation.path,
    internalMaxParagraphs: 10_000,
    internalMaxTables: 1_000,
  })
  if (inspection.truncated) throw new Error("Word inspection 被截断")
  if (inspection.images.length !== state.diagrams.reduce((count, diagram) => count + diagram.pngPaths.length, 0))
    throw new Error("Word 图片数量与图形账本不一致")
  for (const unit of units(state)) {
    const anchor = inspection.outline.filter((entry) => entry.level === 1 && entry.title === `${unit.name} 详细设计`)
    if (anchor.length !== 1) throw new Error(`Word 中 DesignUnit ${unit.name} 的 H1 数量不是 1`)
  }
  const renderDir = `${wordDir}/render`
  const rendered = await renderWordDocument({
    sourcePath: validation.path,
    artifactDir: renderDir,
    title: `${state.scope.target.name} 详细设计最终渲染`,
    maxPages: 2_000,
  })
  if (
    rendered.visualQaStatus !== "completed" ||
    rendered.pageEvidenceStatus !== "completed" ||
    !rendered.pagePngPaths.length ||
    rendered.diagnostics.some((item) => item.code === "image-loss-suspected")
  )
    throw new Error(
      `最终逐页视觉证据未完成：${rendered.visualQaSkipReason ?? "unknown"}${rendered.warnings.length ? `；${rendered.warnings.join("; ")}` : ""}`,
    )
  let final = validation.path
  if (rendered.refreshedDocxPath) {
    const refreshed = await validateWordDocument({ path: rendered.refreshedDocxPath, repairMode: "none" })
    if (refreshed.status !== "valid" || !refreshed.path) throw new Error("字段刷新后的 DOCX 严格校验失败")
    const target = path.join(state.workspace, wordDir, "final.docx")
    await fs.copyFile(path.join(state.workspace, refreshed.path), target)
    final = portable(path.relative(state.workspace, target))
  }
  state.finalDocxPath = final
  state.renderArtifactDir = rendered.artifactDir
  state.phase = "complete"
  state.firstIncompleteItem = undefined
  await declareArtifact({
    kind: JOB_KIND,
    artifactDir: state.artifactDir,
    title: `${state.scope.target.name} 源码驱动详细设计`,
    primaryFile: portable(
      path.relative(path.join(state.workspace, state.artifactDir), path.join(state.workspace, final)),
    ),
    derivedFiles: [
      portable(
        path.relative(
          path.join(state.workspace, state.artifactDir),
          path.join(state.workspace, rendered.diagnosticsPath),
        ),
      ),
    ],
    sourceFiles: state.sourceFiles.map((file) => file.path),
    qualityStatus: "ok",
  })
}

async function unitSection(state: JobState, unit: DesignUnit): Promise<WordSection> {
  const file = path.join(state.workspace, state.artifactDir, `05-enhanced-detail-design/units/${unit.id}.md`)
  const topics = parseTopics(await fs.readFile(file, "utf8"))
  const blocks: WordBlock[] = []
  for (let id = 1; id <= 14; id++) {
    const topic = topics.get(id)
    if (!topic) throw new Error(`DesignUnit ${unit.id} 缺少主题 ${id}`)
    blocks.push({ type: "heading", level: 2, text: topic.title })
    for (const paragraph of topic.body
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean))
      blocks.push({ type: "paragraph", text: paragraph.replace(/\n/g, " ") })
    const view = topicView(id)
    if (!view) continue
    if (view === "state-machine" && topic.status === "N/A") continue
    const diagram = state.diagrams.find((record) => record.unitId === unit.id && record.view === view)
    if (!diagram) throw new Error(`DesignUnit ${unit.id} 缺少 ${view} 图`)
    for (const [index, pngPath] of diagram.pngPaths.entries()) {
      const visible = diagram.pngPaths.length === 1 ? diagram.diagramId : `${diagram.diagramId}-focus-${index + 1}`
      blocks.push({
        type: "image",
        title: `图 ${visible}：${unit.name} ${viewLabel(view)}`,
        caption: `Diagram ID：${visible}。图中关系均来自该设计单元的源码证据。`,
        altText: `${visible} ${unit.name} ${viewLabel(view)}`,
        path: pngPath,
      })
    }
  }
  return { title: `${unit.name} 详细设计`, level: 1, blocks }
}

async function closingSections(state: JobState): Promise<WordSection[]> {
  const item = state.workItems.find((candidate) => candidate.kind === "closing")!
  const text = await fs.readFile(path.join(state.workspace, item.resultPath!), "utf8")
  const matches = [...text.matchAll(/^##\s+(.+)$/gm)]
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? text.length
    const body = text.slice(start, end).trim()
    return {
      title: match[1]!.trim(),
      level: 1 as const,
      paragraphs: body
        .split(/\n{2,}/)
        .map((paragraph) =>
          paragraph
            .replace(/^[-*+]\s+/gm, "")
            .replace(/\n/g, " ")
            .trim(),
        )
        .filter(Boolean),
    }
  })
}

function topicView(id: number): DiagramView | undefined {
  if (id === 4) return "architecture"
  if (id === 5) return "business-flow"
  if (id === 6) return "data-lifecycle"
  if (id === 7) return "code-flow"
  if (id === 8) return "state-machine"
}

function viewLabel(view: DiagramView) {
  return {
    architecture: "架构图",
    "business-flow": "业务流程图",
    "code-flow": "代码流程图",
    "state-machine": "状态机图",
    "data-lifecycle": "数据生命周期图",
  }[view]
}

async function initialize(state: JobState) {
  const root = path.join(state.workspace, state.artifactDir)
  await Promise.all(
    [
      "01-scope",
      "02-source-evidence",
      "04-diagrams/specs",
      "05-enhanced-detail-design/drafts",
      "05-enhanced-detail-design/units",
      "06-cross-module",
      "08-word-export",
    ].map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })),
  )
  await fs.writeFile(
    path.join(root, "01-scope/source-inventory.json"),
    `${JSON.stringify({ version: 1, targetPath: state.targetPath, files: state.sourceFiles }, null, 2)}\n`,
    "utf8",
  )
  await saveRaw(state)
}

async function list(): Promise<JobState[]> {
  const root = path.join(Instance.directory, ProductProfile.root, "artifacts")
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const states = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readState(path.join(root, entry.name, STATE_FILE)).catch(() => undefined)),
  )
  return states
    .filter((state): state is JobState => Boolean(state && state.schemaVersion === 1 && state.phase !== "complete"))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

async function loadById(jobId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(jobId) || path.basename(jobId) !== jobId)
    throw new Error(`非法 jobId：${jobId}`)
  const state = await readState(path.join(Instance.directory, ProductProfile.root, "artifacts", jobId, STATE_FILE))
  if (state.jobId !== jobId || state.schemaVersion !== 1) throw new Error(`任务状态不匹配：${jobId}`)
  return state
}

async function readState(file: string): Promise<JobState> {
  const state = JSON.parse(await fs.readFile(file, "utf8")) as JobState
  if (state.schemaVersion !== 1 || state.skillRevision !== SKILL_REVISION || !state.jobId || !state.artifactDir)
    throw new Error(`无效或不兼容的任务状态：${file}`)
  const workspace = await fs.realpath(Instance.directory)
  if (state.workspace !== workspace) throw new Error(`任务属于其他工作区：${state.workspace}`)
  const artifactsRoot = path.join(workspace, ProductProfile.root, "artifacts")
  const expectedRoot = path.join(artifactsRoot, state.jobId)
  const target = path.resolve(workspace, state.targetPath)
  const targetRelative = path.relative(workspace, target)
  if (
    path.resolve(workspace, state.artifactDir) !== expectedRoot ||
    path.dirname(path.resolve(file)) !== expectedRoot ||
    targetRelative.startsWith("..") ||
    path.isAbsolute(targetRelative)
  )
    throw new Error(`任务状态包含越界路径：${file}`)
  if (!Array.isArray(state.sourceFiles) || !Array.isArray(state.workItems) || !Array.isArray(state.diagrams))
    throw new Error(`任务状态缺少必需集合：${file}`)
  state.assemblyAttempts ??= 0
  return state
}

async function save(state: JobState, expectedRevision: number) {
  const file = path.join(state.workspace, state.artifactDir, STATE_FILE)
  await withLock(file, async () => {
    const current = await readState(file)
    if (current.revision !== expectedRevision)
      throw new Error(`并发更新冲突：期望 ${expectedRevision}，当前 ${current.revision}`)
    state.revision = expectedRevision + 1
    state.updatedAt = new Date().toISOString()
    await saveRaw(state)
  })
}

async function saveRaw(state: JobState) {
  const file = path.join(state.workspace, state.artifactDir, STATE_FILE)
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  await fs.rename(temp, file)
}

async function refreshSourceDrift(state: JobState) {
  const fresh = await inventory(state.workspace, path.join(state.workspace, state.targetPath))
  const before = new Map(state.sourceFiles.map((file) => [file.path, file]))
  const after = new Map(fresh.map((file) => [file.path, file]))
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file)?.sha256 !== after.get(file)?.sha256,
  )
  if (!changed.length) return state
  const shapeChanged = [...before.keys()].sort().join("\0") !== [...after.keys()].sort().join("\0")
  state.sourceFiles = fresh
  if (shapeChanged) {
    state.scope = undefined
    state.workItems = [scopeWork(fresh)]
    state.diagrams = []
    state.phase = "scope"
    state.firstIncompleteItem = "scope-lock"
    state.finalDocxPath = undefined
    state.renderArtifactDir = undefined
    state.warnings.push(`源码清单变化，范围锁定及其下游已失效：${changed.join(", ")}`)
    await save(state, state.revision)
    return state
  }
  const affected = new Set(
    changed.flatMap((file) => {
      const direct = units(state)
        .filter((unit) => unit.implementationPaths.includes(file))
        .map((unit) => unit.id)
      return direct.length ? [state.scope!.target.id, ...direct] : units(state).map((unit) => unit.id)
    }),
  )
  for (const item of state.workItems) {
    if (item.kind !== "scope" && (item.kind === "closing" || (item.unitId && affected.has(item.unitId)))) {
      item.status = "pending"
      item.resultPath = undefined
      item.lease = undefined
      item.error = `源码已变化：${changed.join(", ")}`
    }
  }
  state.diagrams = state.diagrams.filter((diagram) => !affected.has(diagram.unitId))
  state.phase = state.workItems.some((item) => item.kind === "prose" && item.status !== "complete")
    ? "prose"
    : "diagrams"
  state.firstIncompleteItem = state.workItems.find((item) => item.status !== "complete")?.id
  state.finalDocxPath = undefined
  state.renderArtifactDir = undefined
  state.warnings.push(`检测到源码变化并使相关工作项失效：${changed.join(", ")}`)
  await save(state, state.revision)
  return state
}

async function withLock<T>(file: string, run: () => Promise<T>) {
  const lock = `${file}.lock`
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const handle = await fs.open(lock, "wx")
      try {
        await handle.writeFile(`${process.pid} ${Date.now()}\n`, "utf8")
        return await run()
      } finally {
        await handle.close()
        await fs.rm(lock, { force: true })
      }
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (code !== "EEXIST") throw error
      const stat = await fs.stat(lock).catch(() => undefined)
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lock, { force: true })
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error(`任务状态锁超时：${portable(path.relative(Instance.directory, lock))}`)
}

function releaseExpired(state: JobState) {
  for (const item of state.workItems) {
    if (item.status !== "leased" || !item.lease || item.lease.expiresAt > Date.now()) continue
    item.status = "pending"
    item.lease = undefined
  }
}

function paused(state: JobState, messageId: string) {
  const value = state.turns[messageId]
  return Boolean(
    value && (value.bytes >= TURN_BYTES || value.prose >= PROSE_PER_TURN || value.diagrams >= DIAGRAMS_PER_TURN),
  )
}

function usage(state: JobState, messageId: string, item: WorkItem, bytes: number) {
  const current = state.turns[messageId] ?? { prose: 0, diagrams: 0, bytes: 0 }
  current.bytes += bytes
  if (item.kind === "prose") current.prose += 1
  if (item.kind === "diagram") current.diagrams += 1
  state.turns[messageId] = current
}

async function exactResultPath(state: JobState, item: WorkItem, input: string) {
  const root = path.join(state.workspace, state.artifactDir)
  const expected = path.join(root, item.lease?.resultPath ?? item.draftPath)
  const nested = path.relative(root, expected)
  if (nested.startsWith("..") || path.isAbsolute(nested)) throw new Error(`工作项 ${item.id} 的状态路径越界`)
  const actual = path.resolve(state.workspace, input)
  if (actual !== expected)
    throw new Error(`工作项 ${item.id} 只能提交指定路径：${portable(path.relative(state.workspace, expected))}`)
  const real = await fs.realpath(actual)
  if (real !== expected) throw new Error("工作项结果包含符号链接或路径重定向")
  return real
}

function leaseResultPath(item: WorkItem, revision: number, sessionId: string) {
  const extension = path.extname(item.draftPath)
  const stem = item.draftPath.slice(0, -extension.length)
  return `${stem}.lease-${revision}-${sha(sessionId).slice(0, 8)}${extension}`
}

async function verifySourceHashes(state: JobState, item: WorkItem) {
  const selected = item.unitId ? units(state).find((unit) => unit.id === item.unitId) : undefined
  const paths = new Set([...Object.keys(item.sourceHashes), ...(selected ? unitSources(state, selected) : [])])
  for (const file of paths) {
    const expected = state.sourceFiles.find((candidate) => candidate.path === file)?.sha256
    if (!expected) continue
    const actual = sha(await fs.readFile(path.join(state.workspace, file)))
    if (actual !== expected) throw new Error(`源码在工作项执行期间发生变化：${file}`)
  }
}

async function ensureSourceBaseline(state: JobState) {
  const fresh = await inventory(state.workspace, path.join(state.workspace, state.targetPath))
  const expected = new Map(state.sourceFiles.map((file) => [file.path, file.sha256]))
  const actual = new Map(fresh.map((file) => [file.path, file.sha256]))
  const changed = [...new Set([...expected.keys(), ...actual.keys()])].filter(
    (file) => expected.get(file) !== actual.get(file),
  )
  if (changed.length) throw new Error(`最终组装前源码基线已变化，请先恢复任务：${changed.join(", ")}`)
}

function validateEvidence(state: JobState, evidence: Evidence[]) {
  if (!Array.isArray(evidence) || !evidence.length) throw new Error("必须提供源码证据")
  for (const item of evidence) {
    const source = state.sourceFiles.find((file) => file.path === portable(item.path))
    if (!source) throw new Error(`证据路径不在冻结源码范围内：${item.path}`)
    if (
      !Number.isInteger(item.startLine) ||
      !Number.isInteger(item.endLine) ||
      item.startLine < 1 ||
      item.endLine < item.startLine ||
      item.endLine > source.lines
    )
      throw new Error(`证据行号越界：${item.path}:${item.startLine}-${item.endLine}`)
  }
}

function validateUnitEvidence(state: JobState, unitId: string, evidence: Evidence[], requireLocal = false) {
  const unit = units(state).find((candidate) => candidate.id === unitId)
  if (!unit) throw new Error(`未知 DesignUnit：${unitId}`)
  if (!requireLocal) return
  const local = new Set(unit.implementationPaths)
  if (!evidence.some((item) => local.has(portable(item.path))))
    throw new Error(`DesignUnit ${unitId} 缺少自身实现文件证据；上游、下游或协作证据只能作为接口上下文`)
}

async function inventory(workspace: string, target: string) {
  const output: SourceFile[] = []
  let bytes = 0
  const visit = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (
        entry.name === ".git" ||
        entry.name === ".chipmate-v2" ||
        entry.name === ".chipmate" ||
        entry.name === "node_modules"
      )
        continue
      const file = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await visit(file)
        continue
      }
      const extension = path.extname(entry.name).toLowerCase()
      if (!SOURCE_EXTENSIONS.has(extension) && !SOURCE_FILENAMES.has(entry.name)) continue
      if (output.length >= MAX_SOURCE_FILES) throw new Error(`源码文件数量超过 ${MAX_SOURCE_FILES}`)
      const data = await fs.readFile(file)
      bytes += data.length
      if (bytes > MAX_SOURCE_BYTES) throw new Error(`源码总大小超过 ${MAX_SOURCE_BYTES} 字节`)
      output.push({
        path: portable(path.relative(workspace, file)),
        sha256: sha(data),
        bytes: data.length,
        lines: Buffer.from(data).toString("utf8").split(/\r?\n/).length,
        implementation: IMPLEMENTATION_EXTENSIONS.has(extension),
      })
    }
  }
  await visit(target)
  return output
}

async function secureTarget(workspace: string, input: string) {
  const absolute = path.resolve(workspace, input)
  const relative = path.relative(workspace, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("targetPath 必须位于当前工作区")
  const real = await fs.realpath(absolute)
  const nested = path.relative(workspace, real)
  if (nested.startsWith("..") || path.isAbsolute(nested)) throw new Error("targetPath 解析后越出当前工作区")
  if (!(await fs.stat(real)).isDirectory()) throw new Error("targetPath 必须是目录")
  return real
}

function units(state: JobState) {
  return state.scope ? [state.scope.target, ...state.scope.submodules] : []
}

function unitSources(state: JobState, unit: DesignUnit) {
  if (unit.kind === "confirmed-submodule") return unit.implementationPaths
  return [
    ...new Set([unit.implementationPaths, ...state.scope!.submodules.map((child) => child.implementationPaths)].flat()),
  ]
}

function normalizeExclusion(input?: string) {
  const value = input?.trim()
  if (
    [
      "generated",
      "test-fixture",
      "inactive-platform-variant",
      "outside-target-build",
      "exact-alias-duplicate",
    ].includes(value ?? "")
  )
    return value
  return "outside-target-build"
}

function relationLabel(kind: Scope["relationships"][number]["kind"]) {
  return {
    "source-ownership": "源码归属",
    "owning-module": "所属上级模块",
    "system-position": "系统架构位置",
    caller: "实际调用方",
    callee: "实际被调用方",
    "data-flow": "数据传递",
    "state-flow": "状态传递",
    "control-flow": "控制权传递",
    dependency: "依赖",
    collaboration: "协作",
    management: "管理",
    "resource-ownership": "资源所有权",
  }[kind]
}

function summary(state: JobState) {
  return {
    jobId: state.jobId,
    artifactDir: state.artifactDir,
    phase: state.phase,
    updatedAt: state.updatedAt,
    request: state.request.slice(0, 240),
  }
}

function validId(input: string) {
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(input)
}

function cFamily(state: JobState) {
  return state.sourceFiles.some((file) =>
    [".c", ".h", ".cc", ".hh", ".cpp", ".hpp", ".cxx", ".hxx"].includes(path.extname(file.path).toLowerCase()),
  )
}

function sha(input: string | Uint8Array) {
  return createHash("sha256").update(input).digest("hex")
}

function portable(input: string) {
  return input.split(path.sep).join("/")
}

function escapeLabel(input: string) {
  return input.replaceAll("\\", "\\\\").replaceAll('"', "&quot;").replace(/\r?\n/g, "<br/>")
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function writeJson(state: JobState, relative: string, value: unknown) {
  await writeText(state, relative, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(state: JobState, relative: string, value: string) {
  const file = path.join(state.workspace, state.artifactDir, relative)
  const root = path.join(state.workspace, state.artifactDir)
  const nested = path.relative(root, file)
  if (nested.startsWith("..") || path.isAbsolute(nested)) throw new Error("任务输出路径越界")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, value, "utf8")
}
