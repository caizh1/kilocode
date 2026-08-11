import path from "path"
import { readFile } from "fs/promises"
import { Schema } from "effect"
import {
  createWordDocument,
  inspectWordDocument,
  materializeWordFields,
  renderWordDocument,
  type WordBlock,
  type WordSection,
} from "@/kilocode/documents/word"
import { validateWordDocument } from "@/kilocode/documents/word-validation"
import {
  AnyCurrentLifecycleState,
  DiagramIR,
  EvidencePack as EvidencePackSchema,
  ModuleManifest as ModuleManifestSchema,
  type DesignDocJob,
  type DesignTopic,
  type ModuleManifest,
  type WorkItem,
} from "./domain"
import { fullDesignTopics, fullDesignViews, topicTitle, validateFullDesignMatrix } from "./content-contract"
import { DesignDocStore } from "./store"
import type { DesignDocQualityReport } from "./assembler"

interface FullDocumentValue {
  item: WorkItem
  ir: typeof DiagramIR.Type
  pack: typeof EvidencePackSchema.Type
  mermaid?: string
  imagePath?: string
  mermaids?: string[]
  imagePaths?: string[]
}

export interface DetailedDesignDocument {
  schemaVersion: 1
  jobID: string
  title: string
  targetPath: string
  sourceSnapshotHash: string
  manifest: ModuleManifest
  modules: Array<{
    id: string
    name: string
    path: string
    topics: Array<{ topic: DesignTopic; ir: Extract<typeof DiagramIR.Type, { readonly viewType: "topic" }> }>
    diagrams: Array<{
      view: (typeof fullDesignViews)[number]
      role: "base" | "focused"
      topic?: DesignTopic
      focus?: string
      ir: Exclude<typeof DiagramIR.Type, { readonly viewType: "topic" }>
      applicable: boolean
      scopeNotes: string[]
      mermaid?: string
      imagePath?: string
      mermaids?: string[]
      imagePaths?: string[]
    }>
  }>
  evidence: Array<(typeof EvidencePackSchema.Type)["evidence"][number]>
  quality: DesignDocQualityReport
}

export async function assembleFullDesignDocument(
  workspace: string,
  job: DesignDocJob,
  quality: DesignDocQualityReport,
) {
  const model = await buildDetailedDesignDocument(job, quality)
  const markdown = renderDetailedDesignMarkdown(model)
  const document = await DesignDocStore.writeText(workspace, job.id, "design-doc.md", markdown, "text/markdown")
  const word = job.config.outputFormats?.includes("docx")
    ? await publishDetailedDesignWord(workspace, job, model)
    : undefined
  const modelArtifact = await DesignDocStore.writeJSON(workspace, job.id, "detailed-design-document.json", model)
  return { document, word, model: modelArtifact }
}

async function buildDetailedDesignDocument(
  job: DesignDocJob,
  quality: DesignDocQualityReport,
): Promise<DetailedDesignDocument> {
  const manifestArtifact = job.artifacts.find((artifact) => artifact.kind === "manifest")
  if (!manifestArtifact) throw new Error("完整设计缺少 Module Manifest")
  const manifestValue = await DesignDocStore.readDeclaredArtifact(job, manifestArtifact.id)
  const decodedManifest = await Schema.decodeUnknownPromise(ModuleManifestSchema)(
    JSON.parse(manifestValue.content.toString("utf8")),
  )
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Schema 已验证，文档模型需要可序列化的可变对象。
  const manifest = structuredClone(decodedManifest) as ModuleManifest
  const sourceModules = manifest.modules.filter((module) => module.sourceFiles.length + module.testFiles.length > 0)
  const matrix = validateFullDesignMatrix(
    sourceModules.map((module) => module.id),
    job.workItems,
  )
  if (!matrix.passed) throw new Error(`完整设计内容矩阵未通过：${matrix.errors.join("；")}`)
  const values = await readValues(job)
  const evidence = [
    ...new Map(values.flatMap((value) => value.pack.evidence).map((item) => [item.id, item] as const)).values(),
  ].sort(
    (left, right) =>
      left.source.path.localeCompare(right.source.path) || left.source.startLine - right.source.startLine,
  )
  const modules = sourceModules.map((module) => {
    const topics = fullDesignTopics.map((topic) => {
      const matches = values.filter(
        (candidate) =>
          candidate.item.moduleID === module.id &&
          candidate.item.purpose?.kind === "topic" &&
          candidate.item.purpose.topic === topic &&
          candidate.ir.viewType === "topic",
      )
      const fragments = matches.flatMap((value) => (value.ir.viewType === "topic" ? [value.ir] : []))
      if (!fragments.length) throw new Error(`${module.path} 缺少主题 ${topic}`)
      return { topic, ir: mergeTopicFragments(module.name, topic, fragments) }
    })
    const diagrams = fullDesignViews.flatMap((view) => {
      const matches = values.filter(
        (candidate) =>
          candidate.item.moduleID === module.id &&
          candidate.item.purpose?.kind === "diagram" &&
          candidate.item.purpose.view === view,
      )
      const base = matches.filter(
        (value) => value.item.purpose?.kind === "diagram" && value.item.purpose.role === "base",
      )
      if (base.length !== 1) {
        throw new Error(`${module.path} 缺少可发布的 ${view} 基础图`)
      }
      return matches
        .sort((left, right) => {
          const leftRole = left.item.purpose?.kind === "diagram" ? left.item.purpose.role : "focused"
          const rightRole = right.item.purpose?.kind === "diagram" ? right.item.purpose.role : "focused"
          return (
            (leftRole === "base" ? 0 : 1) - (rightRole === "base" ? 0 : 1) || left.item.id.localeCompare(right.item.id)
          )
        })
        .map((value) => {
          if (value.ir.viewType === "topic") throw new Error(`${module.path} 的 ${view} 返回了 TopicIR`)
          const purpose = value.item.purpose?.kind === "diagram" ? value.item.purpose : undefined
          const common = {
            view,
            role: purpose?.role ?? ("focused" as const),
            ...(purpose?.topic ? { topic: purpose.topic } : {}),
            scopeNotes: value.pack.unknowns
              .filter((item) => item.startsWith("scope-disclosure:"))
              .map((item) => item.slice("scope-disclosure:".length)),
            ...(value.item.evidenceScope ? { focus: value.item.evidenceScope.label } : {}),
          }
          if (value.ir.viewType === "not-applicable") return { ...common, ir: value.ir, applicable: false }
          if (
            !value.mermaids?.length ||
            !value.imagePaths?.length ||
            value.mermaids.length !== value.imagePaths.length
          ) {
            throw new Error(`${module.path} 缺少可发布的 ${view} 图像`)
          }
          return {
            ...common,
            ir: value.ir,
            applicable: true,
            mermaid: value.mermaids[0],
            imagePath: value.imagePaths[0],
            mermaids: value.mermaids,
            imagePaths: value.imagePaths,
          }
        })
    })
    return { id: module.id, name: module.name, path: module.path, topics, diagrams }
  })
  const root = modules.find((module) => module.id === manifest.rootModuleID)
  if (!root) throw new Error(`完整设计缺少根模块 ${manifest.rootModuleID}`)
  return {
    schemaVersion: 1,
    jobID: job.id,
    title: `${root.name} 模块详细设计`,
    targetPath: job.config.targetPath,
    sourceSnapshotHash: manifest.sourceSnapshotHash,
    manifest,
    modules,
    evidence,
    quality,
  }
}

async function readValues(job: DesignDocJob): Promise<FullDocumentValue[]> {
  return Promise.all(
    job.workItems
      .filter((item) => item.artifactType !== "review")
      .map(async (item) => {
        const find = (kind: "ir" | "evidence-pack") =>
          job.artifacts.find(
            (artifact) => artifact.workItemID === item.id && artifact.kind === kind && artifact.status === "passed",
          )
        const irArtifact = find("ir")
        const packArtifact = find("evidence-pack")
        if (!irArtifact || !packArtifact) throw new Error(`WorkItem ${item.id} 缺少已通过 IR 或 Evidence Pack`)
        const [irValue, packValue] = await Promise.all([
          DesignDocStore.readDeclaredArtifact(job, irArtifact.id),
          DesignDocStore.readDeclaredArtifact(job, packArtifact.id),
        ])
        const ir = await Schema.decodeUnknownPromise(DiagramIR)(JSON.parse(irValue.content.toString("utf8")))
        const pack = await Schema.decodeUnknownPromise(EvidencePackSchema)(
          JSON.parse(packValue.content.toString("utf8")),
        )
        if (ir.viewType === "topic" || ir.viewType === "not-applicable") return { item, ir, pack }
        const ordered = (kind: "mermaid" | "render") =>
          job.artifacts
            .filter(
              (artifact) => artifact.workItemID === item.id && artifact.kind === kind && artifact.status === "passed",
            )
            .toSorted((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }))
        const mermaidArtifacts = ordered("mermaid")
        const renderArtifacts = ordered("render")
        if (!mermaidArtifacts.length || mermaidArtifacts.length !== renderArtifacts.length) {
          throw new Error(`WorkItem ${item.id} 缺少已通过 Mermaid 或 PNG`)
        }
        const mermaidValues = await Promise.all(
          mermaidArtifacts.map((artifact) => DesignDocStore.readDeclaredArtifact(job, artifact.id)),
        )
        const imagePaths = renderArtifacts.map((artifact) =>
          portable(
            path.relative(job.workspace, path.join(DesignDocStore.directory(job.workspace, job.id), artifact.path)),
          ),
        )
        return {
          item,
          ir,
          pack,
          mermaid: mermaidValues[0]!.content.toString("utf8").trim(),
          imagePath: imagePaths[0],
          mermaids: mermaidValues.map((value) => value.content.toString("utf8").trim()),
          imagePaths,
        }
      }),
  )
}

function renderDetailedDesignMarkdown(model: DetailedDesignDocument) {
  const sources = evidenceSources(model)
  const root = rootModule(model)
  const children = model.modules.filter((module) => module.id !== root.id)
  const lines = [
    `# ${cleanText(model.title, sources)}`,
    "",
    "## 阅读路径",
    "",
    "- 业务与评审人员：模块概览与系统位置 → 模块职责和边界 → 输入输出 → 完整业务流程。",
    "- 开发人员：内部架构 → 目标模块实现 → 子模块详细设计 → 源码参考索引。",
    "- 测试与维护人员：异常恢复 → 调试与可观测性 → 待确认事项。",
    "",
    "## 设计范围与阅读说明",
    "",
    `- 目标范围：${cleanText(model.targetPath, sources)}`,
    `- 纳入设计的模块与子模块：${model.modules.length}`,
    "- 重要说明和图关系只引用本快照中的源码位置。‘需要验证的推测’表示已有间接证据，但还不能完全证实；‘源码中没有说明的问题’表示当前没有足够证据，需要补充源码、配置或人工信息。",
    "",
    "## 模块概览与系统位置",
    "",
  ]
  appendTopicMarkdown(lines, findTopic(root, "positioning"), sources)
  lines.push("## 模块职责、边界与整体结构", "", "### 本模块负责的工作", "")
  appendTopicMarkdown(lines, findTopic(root, "responsibilities"), sources)
  lines.push(
    "### 本模块处理到哪里，之后交给谁",
    "",
    "本节区分模块内部完成的工作、交给其他模块或硬件继续完成的工作，以及当前源码无法证明的责任，避免把依赖关系误写成模块自身职责。",
    "",
  )
  appendTopicMarkdown(lines, findTopic(root, "boundaries"), sources)
  lines.push(
    "### 模块组成和调用关系",
    "",
    "下面的图把入口、源码单元、共享对象和外部依赖放在同一张结构地图中。总览用于定位；后续详图逐条展示调用、依赖和数据交接，图后的关系表给出对应源码位置。",
    "",
  )
  appendDiagramsMarkdown(lines, root, "architecture", sources)
  lines.push(
    "## 输入、输出与主要能力",
    "",
    children.length
      ? `目标模块及其 ${children.length} 个已确认子模块共同完成以下输入处理、结果输出和对外副作用。`
      : "目标模块完成以下输入处理、结果输出和对外副作用。",
    "",
  )
  appendTopicMarkdown(lines, findTopic(root, "inputs-outputs"), sources)
  lines.push(
    "## 完整业务流程",
    "",
    "本章按“全流程导航 → 分支与步骤详图”的顺序展示。导航图帮助定位入口和主要阶段，不能替代随后对条件、调用、数据变化、异常和结果的逐项展开。",
    "",
  )
  appendTopicMarkdown(lines, findTopic(root, "business-process"), sources)
  appendDiagramsMarkdown(lines, root, "business-flow", sources)
  lines.push("## 内部组成与子模块", "", "| 模块或源码组件 | 类型 | 所属模块 | 源码文件 |", "|---|---|---|---:|")
  for (const module of model.manifest.modules.filter((item) => item.sourceFiles.length + item.testFiles.length > 0)) {
    const parent = module.parentID ? model.manifest.modules.find((item) => item.id === module.parentID)?.name : "—"
    lines.push(
      `| ${cleanText(module.name, sources)} | ${moduleKindLabel(module.unitKind)} | ${cleanText(parent ?? "—", sources)} | ${module.sourceFiles.length + module.testFiles.length} |`,
    )
  }
  lines.push("", "本章只说明拆分和所有权；每个子模块的连续详细设计位于下一章。", "")
  lines.push("## 目标模块实现细节", "")
  appendLocalImplementationMarkdown(lines, root, sources, 3, false)
  lines.push("## 已确认子模块详细设计", "")
  if (!children.length) lines.push("当前源码边界内未发现独立子模块；目标模块实现细节即为完整设计范围。", "")
  for (const module of children) {
    lines.push(`### ${cleanText(module.name, sources)}`, "", `源码边界：${cleanText(module.path, sources)}`, "")
    appendLocalImplementationMarkdown(lines, module, sources, 4, true)
  }
  appendGlobalMarkdown(lines, model, sources)
  assertPublishableReaderText(lines.join("\n"))
  return `${lines.join("\n")}\n`
}

async function publishDetailedDesignWord(workspace: string, job: DesignDocJob, model: DetailedDesignDocument) {
  const expectedImages = model.modules.reduce(
    (total, module) =>
      total +
      module.diagrams.reduce(
        (count, diagram) => count + (diagram.applicable ? diagramImagePaths(diagram).length : 0),
        0,
      ),
    0,
  )
  return publishDesignDocWord(workspace, job, {
    title: model.title,
    documentType: "模块与子模块源码支撑详细设计",
    sections: wordSections(model),
    summary: [
      `目标范围：${cleanText(model.targetPath, evidenceSources(model))}`,
      `纳入设计的模块与子模块：${model.modules.length}`,
      "{{TOC}}",
    ],
    expectedImages,
  })
}

export async function publishDesignDocWord(
  workspace: string,
  job: DesignDocJob,
  input: {
    title: string
    documentType: string
    sections: WordSection[]
    summary: string[]
    expectedImages: number
  },
) {
  const artifactDir = portable(path.relative(workspace, DesignDocStore.directory(workspace, job.id)))
  const draft = await createWordDocument({
    title: input.title,
    artifactDir,
    documentType: input.documentType,
    language: "zh-CN",
    headingNumbering: "decimal",
    outputFile: "design-doc.draft.docx",
    summary: input.summary,
    sections: input.sections,
  })
  const materialized = await materializeWordFields({
    sourcePath: draft.path,
    artifactDir,
    outputFile: "design-doc.docx",
    title: input.title,
    tocMode: "materialize",
    tocMaxLevel: 3,
  })
  if (materialized.summary.toc !== "materialized" || materialized.summary.tocEntryCount === 0) {
    throw new Error("DOCX 原生目录未生成或没有可索引标题")
  }
  const initialValidation = await validateWordDocument({ path: materialized.path, repairMode: "none" })
  if (initialValidation.status !== "valid") {
    throw new Error(`DOCX OPC/XML 校验失败：${initialValidation.errors.map((item) => item.message).join("；")}`)
  }
  const initialInspection = await inspectWordDocument({
    path: materialized.path,
    internalMaxParagraphs: 10_000,
    internalMaxTables: 1_000,
  })
  if (initialInspection.images.length !== input.expectedImages) {
    throw new Error(`DOCX 图片数量不完整：期望 ${input.expectedImages}，实际 ${initialInspection.images.length}`)
  }
  if (
    initialInspection.imageDiagnostics.orphanRelationshipIds.length ||
    initialInspection.imageDiagnostics.missingRelationshipIds.length ||
    initialInspection.imageDiagnostics.missingMediaTargets.length
  ) {
    throw new Error("DOCX 图片关系校验失败")
  }
  if (initialInspection.imageDiagnostics.duplicateMediaHashes.length) {
    throw new Error("DOCX 包含重复图像，5D 视图不得以同一图片换皮发布")
  }
  const render = await renderWordDocument({
    sourcePath: materialized.path,
    artifactDir,
    title: input.title,
    maxPages: 2_000,
    // Large source-backed reports can contain hundreds of high-resolution diagrams.
    // Give the isolated Word renderer enough time to refresh fields and paginate the
    // complete document instead of treating LibreOffice's work as a content failure.
    // The renderer applies its own configured cap to each LibreOffice stage.
    // Keep the end-to-end request budget larger because field refresh, PDF
    // pagination and page-image transfer run sequentially for large reports.
    timeoutMs: 3_600_000,
  })
  if (render.visualQaStatus !== "completed" || render.pageEvidenceStatus !== "completed") {
    throw new Error(
      `DOCX 页面视觉验收未完成：${render.visualQaSkipReason ?? render.pageEvidenceStatus}；${render.diagnostics.map((item) => `${item.code}: ${item.message}`).join("；")}`,
    )
  }
  if (render.diagnostics.some((item) => item.severity === "error")) {
    throw new Error(
      `DOCX 页面视觉验收失败：${render.diagnostics
        .filter((item) => item.severity === "error")
        .map((item) => item.message)
        .join("；")}`,
    )
  }
  if (render.refreshedDocxPath) {
    const refreshed = await readFile(path.join(workspace, render.refreshedDocxPath))
    await DesignDocStore.writeBytes(
      workspace,
      job.id,
      "design-doc.docx",
      refreshed,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
  }
  const finalPath = path.join(DesignDocStore.directory(workspace, job.id), "design-doc.docx")
  const validation = await validateWordDocument({ path: finalPath, repairMode: "none" })
  if (validation.status !== "valid") {
    throw new Error(`最终 DOCX OPC/XML 校验失败：${validation.errors.map((item) => item.message).join("；")}`)
  }
  const inspection = await inspectWordDocument({
    path: finalPath,
    internalMaxParagraphs: 10_000,
    internalMaxTables: 1_000,
  })
  if (inspection.images.length !== input.expectedImages) {
    throw new Error(`最终 DOCX 图片数量不完整：期望 ${input.expectedImages}，实际 ${inspection.images.length}`)
  }
  return {
    document: await DesignDocStore.describe(
      workspace,
      job.id,
      "design-doc.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    validation,
    inspection: { imageCount: inspection.images.length, headingCount: inspection.outline.length },
    toc: materialized.summary,
    render,
  }
}

function wordSections(model: DetailedDesignDocument): WordSection[] {
  const sources = evidenceSources(model)
  const root = rootModule(model)
  const children = model.modules.filter((module) => module.id !== root.id)
  const sections: WordSection[] = [
    {
      title: "阅读路径",
      level: 1,
      blocks: [
        {
          type: "list",
          items: [
            "业务与评审人员：模块概览与系统位置 → 模块职责和边界 → 输入输出 → 完整业务流程。",
            "开发人员：内部架构 → 目标模块实现 → 子模块详细设计 → 源码参考索引。",
            "测试与维护人员：异常恢复 → 调试与可观测性 → 待确认事项。",
          ],
        },
      ],
    },
    {
      title: "设计范围与阅读说明",
      level: 1,
      blocks: [
        {
          type: "list",
          items: [
            `纳入设计的模块与子模块：${model.modules.length}`,
            "重要说明和图关系只引用本快照中的源码位置。‘需要验证的推测’表示已有间接证据，但还不能完全证实；‘源码中没有说明的问题’表示当前没有足够证据，需要补充源码、配置或人工信息。",
          ],
        },
      ],
    },
    {
      title: "模块概览与系统位置",
      level: 1,
      blocks: topicBlocks(findTopic(root, "positioning"), sources),
    },
    { title: "模块职责、边界与整体结构", level: 1, blocks: [] },
    { title: "本模块负责的工作", level: 2, blocks: topicBlocks(findTopic(root, "responsibilities"), sources) },
    {
      title: "本模块处理到哪里，之后交给谁",
      level: 2,
      blocks: [
        {
          type: "paragraph",
          text: "本节区分模块内部完成的工作、交给其他模块或硬件继续完成的工作，以及当前源码无法证明的责任，避免把依赖关系误写成模块自身职责。",
        },
        ...topicBlocks(findTopic(root, "boundaries"), sources),
      ],
    },
    {
      title: "模块组成和调用关系",
      level: 2,
      blocks: [
        {
          type: "paragraph",
          text: "下面的图把入口、源码单元、共享对象和外部依赖放在同一张结构地图中。总览用于定位；后续详图逐条展示调用、依赖和数据交接，图后的关系表给出对应源码位置。",
        },
        ...diagramBlocks(root, "architecture", sources),
      ],
    },
    {
      title: "输入、输出与主要能力",
      level: 1,
      blocks: [
        {
          type: "paragraph",
          text: children.length
            ? `目标模块及其 ${children.length} 个已确认子模块共同完成以下输入处理、结果输出和对外副作用。`
            : "目标模块完成以下输入处理、结果输出和对外副作用。",
        },
        ...topicBlocks(findTopic(root, "inputs-outputs"), sources),
      ],
    },
    {
      title: "完整业务流程",
      level: 1,
      blocks: [
        {
          type: "paragraph",
          text: "本章按“全流程导航 → 分支与步骤详图”的顺序展示。导航图帮助定位入口和主要阶段，不能替代随后对条件、调用、数据变化、异常和结果的逐项展开。",
        },
        ...topicBlocks(findTopic(root, "business-process"), sources),
        ...diagramBlocks(root, "business-flow", sources),
      ],
    },
    {
      title: "内部组成与子模块",
      level: 1,
      blocks: [
        {
          type: "table",
          headers: ["模块或源码组件", "类型", "所属模块", "源码文件"],
          rows: model.manifest.modules
            .filter((item) => item.sourceFiles.length + item.testFiles.length > 0)
            .map((module) => [
              cleanText(module.name ?? path.posix.basename(module.path), sources),
              moduleKindLabel(module.unitKind),
              cleanText(
                module.parentID
                  ? (model.manifest.modules.find((item) => item.id === module.parentID)?.name ?? "—")
                  : "—",
                sources,
              ),
              String(module.sourceFiles.length + module.testFiles.length),
            ]),
          caption: "模块、源码组件及其归属关系",
        },
        { type: "paragraph", text: "本章只说明拆分和所有权；每个子模块的连续详细设计位于下一章。" },
      ],
    },
    { title: "目标模块实现细节", level: 1, blocks: [] },
    ...localImplementationSections(root, sources, 2, false),
    {
      title: "已确认子模块详细设计",
      level: 1,
      blocks: children.length
        ? []
        : [{ type: "paragraph", text: "当前源码边界内未发现独立子模块；目标模块实现细节即为完整设计范围。" }],
    },
  ]
  for (const module of children) {
    sections.push({
      title: module.name,
      level: 2,
      blocks: [{ type: "paragraph", text: `源码边界：${cleanText(module.path, sources)}` }],
    })
    sections.push(...localImplementationSections(module, sources, 3, true))
  }
  sections.push(...globalWordSections(model, sources))
  assertPublishableReaderText(JSON.stringify(sections))
  return sections
}

type DesignModule = DetailedDesignDocument["modules"][number]
type TopicIR = DesignModule["topics"][number]["ir"]
type EvidenceItem = DetailedDesignDocument["evidence"][number]
type EvidenceSources = ReadonlyMap<string, EvidenceItem>
type Claim = { readonly text: string; readonly evidenceIDs: readonly string[] }

interface LocalTopic {
  title: string
  topics: readonly DesignTopic[]
  view?: (typeof fullDesignViews)[number]
  diagramRole?: "base" | "focused"
  interfaces?: boolean
  labels?: Partial<Record<DesignTopic, string>>
}

const localTopics: readonly LocalTopic[] = [
  { title: "模块概览与系统位置", topics: ["positioning"] as const },
  {
    title: "职责、内部协作与外部交接",
    topics: ["responsibilities", "boundaries"] as const,
    view: "architecture" as const,
    labels: { responsibilities: "本模块负责的工作", boundaries: "本模块处理到哪里，之后交给谁" },
  },
  { title: "何时触发，以及输入输出什么", topics: ["inputs-outputs"] as const },
  { title: "业务处理过程", topics: ["business-process"] as const, view: "business-flow" as const },
  { title: "核心对象与状态载体", topics: ["core-models"] as const },
  {
    title: "数据如何流转和保存",
    topics: ["data-persistence"] as const,
    view: "data-lifecycle" as const,
  },
  { title: "代码如何执行", topics: ["algorithms"] as const, view: "code-flow" as const },
  { title: "状态如何变化", topics: ["state-lifecycle"] as const, view: "state-machine" as const },
  { title: "对外接口与模块协作", topics: [] as const, interfaces: true },
  { title: "异常如何处理和恢复", topics: ["error-recovery"] as const },
  { title: "并发、资源与性能约束", topics: ["concurrency"] as const },
  { title: "配置、构建、注册与启动", topics: ["configuration-startup"] as const },
  { title: "调试、日志与可观测性", topics: ["observability-debugging"] as const },
  { title: "源码依据与尚未确认的问题", topics: ["constraints-risks"] as const },
]

function evidenceSources(model: DetailedDesignDocument): EvidenceSources {
  return new Map(model.evidence.map((item) => [item.id, item] as const))
}

function rootModule(model: DetailedDesignDocument) {
  const root = model.modules.find((module) => module.id === model.manifest.rootModuleID)
  if (!root) throw new Error(`完整设计缺少根模块 ${model.manifest.rootModuleID}`)
  return root
}

function findTopic(module: DesignModule, topic: DesignTopic) {
  const value = module.topics.find((item) => item.topic === topic)?.ir
  if (!value) throw new Error(`${module.path} 缺少主题 ${topic}`)
  return value
}

function mergeTopicFragments(moduleName: string, topic: DesignTopic, fragments: readonly TopicIR[]): TopicIR {
  const first = fragments[0]
  if (!first) throw new Error(`${moduleName} 缺少主题 ${topic}`)
  const applicability = fragments.some((item) => item.applicability === "applicable")
    ? "applicable"
    : fragments.every((item) => item.applicability === "not-applicable")
      ? "not-applicable"
      : "unknown"
  return {
    schemaVersion: 1,
    moduleID: first.moduleID,
    viewType: "topic",
    topic,
    applicability,
    title: topicTitle(topic),
    summary:
      applicability === "applicable"
        ? `${moduleName} 的${topicTitle(topic)}按源码文件和函数范围汇总如下。`
        : first.summary,
    conclusions: mergeClaims(fragments.flatMap((item) => item.conclusions)),
    mechanisms: mergeClaims(fragments.flatMap((item) => item.mechanisms)),
    flows: mergeClaims(fragments.flatMap((item) => item.flows)),
    exceptions: mergeClaims(fragments.flatMap((item) => item.exceptions)),
    constraints: mergeClaims(fragments.flatMap((item) => item.constraints)),
    assumptions: mergeClaims(fragments.flatMap((item) => item.assumptions)),
    unknowns: mergeClaims(fragments.flatMap((item) => item.unknowns)),
  }
}

function mergeClaims(claims: readonly Claim[]) {
  const merged = new Map<string, { text: string; evidenceIDs: string[] }>()
  for (const claim of claims) {
    const key = claim.text.trim().replace(/\s+/g, " ")
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, { text: claim.text.trim(), evidenceIDs: [...new Set(claim.evidenceIDs)] })
      continue
    }
    previous.evidenceIDs = [...new Set([...previous.evidenceIDs, ...claim.evidenceIDs])]
  }
  return [...merged.values()]
}

function appendTopicMarkdown(lines: string[], ir: TopicIR, sources: EvidenceSources) {
  if (ir.applicability !== "applicable") {
    appendCompactApplicabilityMarkdown(lines, ir, sources)
    return
  }
  lines.push(cleanText(ir.summary, sources), "")
  appendClaimsMarkdown(lines, "从源码可以确认什么", ir.conclusions, sources, ir.topic)
  appendClaimsMarkdown(lines, "代码中的具体做法", ir.mechanisms, sources, ir.topic)
  appendClaimsMarkdown(lines, topicFlowLabel(ir.topic), ir.flows, sources, ir.topic)
  appendClaimsMarkdown(lines, "异常路径", ir.exceptions, sources, ir.topic)
  appendClaimsMarkdown(lines, "约束", ir.constraints, sources, ir.topic)
  appendClaimsMarkdown(lines, "需要验证的推测", ir.assumptions, sources, ir.topic)
  appendClaimsMarkdown(lines, "源码中没有说明的问题", ir.unknowns, sources, ir.topic)
}

function appendClaimsMarkdown(
  lines: string[],
  label: string,
  claims: readonly Claim[],
  sources: EvidenceSources,
  topic?: DesignTopic,
) {
  if (!claims.length) return
  lines.push(`**${label}**`, "")
  for (const group of claimPresentationGroups(topic, label, claims, sources)) {
    if (group.title) lines.push(`**${cleanText(group.title, sources)}**`, "")
    for (const claim of group.claims) lines.push(`- ${cleanText(claim.text, sources)}`)
    lines.push("", `源码依据：${sourceReferences(collectClaimEvidenceIDs(group.claims), sources, 4, 6)}`, "")
  }
}

function topicBlocks(ir: TopicIR, sources: EvidenceSources): WordBlock[] {
  if (ir.applicability !== "applicable") return compactApplicabilityBlocks(ir, sources)
  const blocks: WordBlock[] = [{ type: "paragraph", text: cleanText(ir.summary, sources) }]
  addClaimGroup(blocks, "从源码可以确认什么", ir.conclusions, sources, ir.topic)
  addClaimGroup(blocks, "代码中的具体做法", ir.mechanisms, sources, ir.topic)
  addClaimGroup(blocks, topicFlowLabel(ir.topic), ir.flows, sources, ir.topic)
  addClaimGroup(blocks, "异常路径", ir.exceptions, sources, ir.topic)
  addClaimGroup(blocks, "约束", ir.constraints, sources, ir.topic)
  addClaimGroup(blocks, "需要验证的推测", ir.assumptions, sources, ir.topic)
  addClaimGroup(blocks, "源码中没有说明的问题", ir.unknowns, sources, ir.topic)
  return blocks
}

function topicFlowLabel(topic: DesignTopic) {
  return {
    positioning: "依赖谁，以及由谁调用",
    responsibilities: "这些职责怎样衔接",
    boundaries: "数据、控制权和结果怎样交给模块外部",
    "inputs-outputs": "输入如何进入、结果如何输出",
    "business-process": "业务步骤与分支",
    "core-models": "对象如何关联和流转",
    algorithms: "关键处理步骤与分支",
    concurrency: "并发任务与资源如何协调",
    "state-lifecycle": "状态在什么条件下变化",
    "error-recovery": "发生异常后如何处理和恢复",
    "data-persistence": "数据从哪里来、到哪里去",
    "configuration-startup": "模块如何配置和启动",
    "observability-debugging": "如何定位运行问题",
    "constraints-risks": "限制会造成什么影响",
  }[topic]
}

function addClaimGroup(
  blocks: WordBlock[],
  label: string,
  claims: readonly Claim[],
  sources: EvidenceSources,
  topic?: DesignTopic,
) {
  if (!claims.length) return
  blocks.push({ type: "paragraph", text: label })
  for (const group of claimPresentationGroups(topic, label, claims, sources)) {
    if (group.title) blocks.push({ type: "paragraph", text: cleanText(group.title, sources) })
    blocks.push(
      { type: "list", items: group.claims.map((claim) => cleanText(claim.text, sources)) },
      {
        type: "paragraph",
        text: `源码依据：${sourceReferences(collectClaimEvidenceIDs(group.claims), sources, 4, 6)}`,
      },
    )
  }
}

function collectClaimEvidenceIDs(claims: readonly Claim[]) {
  return [...new Set(claims.flatMap((claim) => claim.evidenceIDs))]
}

function claimPresentationGroups(
  topic: DesignTopic | undefined,
  label: string,
  claims: readonly Claim[],
  sources: EvidenceSources,
): Array<{ title?: string; claims: readonly Claim[] }> {
  if (topic !== "responsibilities" || label !== "从源码可以确认什么") return [{ claims }]
  const grouped = Map.groupBy(claims, (claim) => responsibilityOwner(claim, sources))
  return [...grouped.entries()].map(([owner, values]) => ({
    title: responsibilityTitle(owner, values, sources),
    claims: values,
  }))
}

function responsibilityOwner(claim: Claim, sources: EvidenceSources) {
  const source = claim.evidenceIDs.flatMap((id) => {
    const item = sources.get(id)
    return item ? [item.source.path] : []
  })[0]
  if (!source) return "跨文件职责"
  return path.posix.basename(source).replace(/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|ts|tsx|js|jsx)$/i, "")
}

function responsibilityTitle(owner: string, claims: readonly Claim[], sources: EvidenceSources) {
  const files = [
    ...new Set(
      claims.flatMap((claim) =>
        claim.evidenceIDs.flatMap((id) => {
          const item = sources.get(id)
          return item ? [path.posix.basename(item.source.path)] : []
        }),
      ),
    ),
  ]
  return files.length ? `${owner}（${files.join("、")}）` : owner
}

function appendCompactApplicabilityMarkdown(lines: string[], ir: TopicIR, sources: EvidenceSources) {
  const status = ir.applicability === "not-applicable" ? "当前源码没有实现此类机制。" : "当前源码还不能确认此类机制。"
  lines.push(status, "", cleanText(ir.summary, sources), "")
  const unknowns = meaningfulUnknowns(ir.unknowns)
  if (unknowns.length) appendClaimsMarkdown(lines, "仍需确认", unknowns, sources, ir.topic)
}

function compactApplicabilityBlocks(ir: TopicIR, sources: EvidenceSources): WordBlock[] {
  const status = ir.applicability === "not-applicable" ? "当前源码没有实现此类机制。" : "当前源码还不能确认此类机制。"
  const unknowns = meaningfulUnknowns(ir.unknowns)
  return [
    { type: "paragraph", text: `${status}${cleanText(ir.summary, sources)}` },
    ...(unknowns.length
      ? [
          { type: "paragraph" as const, text: "仍需确认" },
          { type: "list" as const, items: unknowns.map((item) => cleanText(item.text, sources)) },
        ]
      : []),
  ]
}

function meaningfulUnknowns(claims: readonly Claim[]) {
  return claims.filter((claim) => {
    const text = claim.text.trim()
    return (
      !/^(?:topic-evidence-sampled|topic-absence|scope-disclosure):/iu.test(text) &&
      !/该主题可能由目标目录外部、生成代码或运行时配置实现/u.test(text) &&
      !/需人工确认/u.test(text)
    )
  })
}

function appendDiagramsMarkdown(
  lines: string[],
  module: DesignModule,
  view: (typeof fullDesignViews)[number],
  sources: EvidenceSources,
  role?: "base" | "focused",
) {
  const diagrams = module.diagrams.filter((item) => item.view === view && (!role || item.role === role))
  const focusedTotal = diagrams.filter((item) => item.role === "focused").length
  let focusedIndex = 0
  for (const diagram of diagrams) {
    if (diagram.role === "focused") focusedIndex++
    const heading = diagramDisplayHeading(diagram, focusedIndex, focusedTotal)
    lines.push(`**${cleanText(heading, sources)}**`, "")
    if (diagram.ir.viewType === "not-applicable") {
      lines.push(`不适用：${cleanText(diagram.ir.reason, sources)}`, "")
      appendUnknownsMarkdown(lines, diagram.ir.unknowns, sources)
    } else {
      lines.push(diagramReaderIntroduction(diagram, focusedTotal, sources), "")
      const summary = diagramReaderSummary(diagram, sources)
      if (summary) lines.push(summary, "")
      const images = diagramImagePaths(diagram)
      for (const [index, image] of images.entries()) {
        const title = facetHeading(heading, index, images.length)
        lines.push(`![${cleanText(title, sources)}](${relativeFromDocument(image)})`, "")
      }
      appendDiagramRelationMarkdown(lines, diagram, sources)
      appendLifecycleTransitionMarkdown(lines, diagram, sources)
      lines.push(`图中关系源码摘要：${sourceReferences(collectEvidenceIDs(diagram.ir), sources, 4, 8)}`, "")
    }
    for (const note of diagram.scopeNotes) lines.push(`- 图示范围：${cleanText(note, sources)}`)
    if (diagram.scopeNotes.length) lines.push("")
  }
}

function appendUnknownsMarkdown(lines: string[], unknowns: readonly Claim[], sources: EvidenceSources) {
  appendClaimsMarkdown(lines, "待确认", unknowns, sources)
}

function diagramBlocks(
  module: DesignModule,
  view: (typeof fullDesignViews)[number],
  sources: EvidenceSources,
  role?: "base" | "focused",
): WordBlock[] {
  const diagrams = module.diagrams.filter((item) => item.view === view && (!role || item.role === role))
  const focusedTotal = diagrams.filter((item) => item.role === "focused").length
  let focusedIndex = 0
  return diagrams.flatMap((diagram): WordBlock[] => {
    if (diagram.role === "focused") focusedIndex++
    const heading = cleanText(diagramDisplayHeading(diagram, focusedIndex, focusedTotal), sources)
    if (diagram.ir.viewType === "not-applicable") {
      return [
        { type: "paragraph", text: `${heading}不适用：${cleanText(diagram.ir.reason, sources)}` },
        ...(diagram.ir.unknowns.length
          ? [
              {
                type: "list" as const,
                items: diagram.ir.unknowns.map(
                  (item) =>
                    `待确认：${cleanText(item.text, sources)}（源码：${sourceReferences(item.evidenceIDs, sources, 4, 6)}）`,
                ),
              },
            ]
          : []),
        ...scopeNoteBlocks(diagram.scopeNotes, sources),
      ]
    }
    const summary = diagramReaderSummary(diagram, sources)
    return [
      { type: "paragraph", text: diagramReaderIntroduction(diagram, focusedTotal, sources) },
      ...(summary ? [{ type: "paragraph" as const, text: summary }] : []),
      ...diagramImagePaths(diagram).map((image, index, images): WordBlock => {
        const title = facetHeading(heading, index, images.length)
        return {
          type: "image",
          path: image,
          title,
          altText: `${cleanText(module.name, sources)} ${title}，基于源码证据生成`,
        }
      }),
      ...diagramRelationBlocks(diagram, sources),
      ...lifecycleTransitionBlocks(diagram, sources),
      {
        type: "paragraph",
        text: `图中关系源码摘要：${sourceReferences(collectEvidenceIDs(diagram.ir), sources, 4, 8)}`,
      },
      ...scopeNoteBlocks(diagram.scopeNotes, sources),
    ]
  })
}

interface DiagramRelationTable {
  title: string
  headers: string[]
  rows: string[][]
}

function appendDiagramRelationMarkdown(
  lines: string[],
  diagram: DesignModule["diagrams"][number],
  sources: EvidenceSources,
) {
  const table = diagramRelationTable(diagram, sources)
  if (!table?.rows.length) return
  lines.push(
    `**${table.title}**`,
    "",
    `| ${table.headers.join(" | ")} |`,
    `|${table.headers.map(() => "---").join("|")}|`,
  )
  for (const row of table.rows) lines.push(`| ${row.map((cell) => markdownCell(cell, sources)).join(" | ")} |`)
  lines.push("")
}

function diagramRelationBlocks(diagram: DesignModule["diagrams"][number], sources: EvidenceSources): WordBlock[] {
  const table = diagramRelationTable(diagram, sources)
  if (!table?.rows.length) return []
  return [{ type: "table", headers: table.headers, rows: table.rows, caption: table.title }]
}

function diagramRelationTable(
  diagram: DesignModule["diagrams"][number],
  sources: EvidenceSources,
): DiagramRelationTable | undefined {
  const ir = diagram.ir
  if (ir.viewType === "not-applicable" || ir.viewType === "product-section" || ir.viewType === "lifecycle") return
  if (ir.viewType === "overview") {
    const items = new Map(ir.items.map((item) => [item.id, item.label]))
    const rows = (ir.relations ?? []).map((relation) => [
      cleanText(items.get(relation.from) ?? relation.from, sources),
      cleanText(relation.label, sources),
      cleanText(items.get(relation.to) ?? relation.to, sources),
      sourceReferences(relation.evidenceIDs, sources, 2, 3),
    ])
    return { title: "图中组件怎样连接", headers: ["起点", "关系", "终点", "源码位置"], rows }
  }
  if (ir.viewType === "business-flow") {
    const activities = new Map(ir.activities.map((item) => [item.id, item.businessMeaning || item.label]))
    const rows = ir.flows.map((flow) => [
      cleanText(activities.get(flow.from) ?? flow.from, sources),
      cleanText(flow.label, sources),
      cleanText(activities.get(flow.to) ?? flow.to, sources),
      sourceReferences(flow.evidenceIDs, sources, 2, 3),
    ])
    return { title: "业务步骤、分支与结果", headers: ["当前步骤", "条件或交接", "下一步骤", "源码位置"], rows }
  }
  if (ir.viewType === "execution-flow") {
    const nodes = new Map(ir.nodes.map((item) => [item.id, item.label]))
    const rows = ir.edges.map((edge) => [
      cleanText(nodes.get(edge.from) ?? edge.from, sources),
      cleanText(edge.label, sources),
      cleanText(nodes.get(edge.to) ?? edge.to, sources),
      sourceReferences(edge.evidenceIDs, sources, 2, 3),
    ])
    return { title: "代码分支与调用明细", headers: ["当前代码步骤", "条件或调用", "下一代码步骤", "源码位置"], rows }
  }
  if (ir.viewType === "data-flow") {
    const entities = new Map(ir.entities.map((item) => [item.id, item.label]))
    const rows = ir.flows.map((flow) => [
      cleanText(entities.get(flow.from) ?? flow.from, sources),
      cleanText(flow.label, sources),
      cleanText(entities.get(flow.to) ?? flow.to, sources),
      sourceReferences(flow.evidenceIDs, sources, 2, 3),
    ])
    return { title: "数据读写与交接明细", headers: ["数据来源", "读写或传递方式", "数据去向", "源码位置"], rows }
  }
  if (ir.viewType === "error-flow") {
    const nodes = new Map(ir.nodes.map((item) => [item.id, item.label]))
    const rows = ir.edges.map((edge) => [
      cleanText(nodes.get(edge.from) ?? edge.from, sources),
      cleanText(edge.label, sources),
      cleanText(nodes.get(edge.to) ?? edge.to, sources),
      sourceReferences(edge.evidenceIDs, sources, 2, 3),
    ])
    return { title: "异常触发、处理与最终结果", headers: ["异常起点", "处理方式", "处理结果", "源码位置"], rows }
  }
  if (ir.viewType === "sequence") {
    const participants = new Map(ir.participants.map((item) => [item.id, item.label]))
    const rows = ir.messages.map((message) => [
      cleanText(participants.get(message.from) ?? message.from, sources),
      cleanText(message.label, sources),
      cleanText(participants.get(message.to) ?? message.to, sources),
      sourceReferences(message.evidenceIDs, sources, 2, 3),
    ])
    return { title: "调用先后与返回关系", headers: ["调用方", "调用或返回", "接收方", "源码位置"], rows }
  }
  const nodes = new Map(
    ir.nodes.map((item) => [item.id, "label" in item ? item.label : path.posix.basename(item.sourceRef)]),
  )
  const rows = ir.edges.map((edge) => [
    cleanText(nodes.get(edge.from) ?? edge.from, sources),
    ir.viewType === "structure" ? "依赖" : "包含",
    cleanText(nodes.get(edge.to) ?? edge.to, sources),
    sourceReferences(edge.evidenceIDs, sources, 2, 3),
  ])
  return { title: "源码组成关系", headers: ["上层单元", "关系", "下层单元", "源码位置"], rows }
}

function diagramReaderIntroduction(
  diagram: DesignModule["diagrams"][number],
  focusedTotal: number,
  sources: EvidenceSources,
) {
  if (diagram.role === "base" && focusedTotal) {
    return `本图用于定位${viewReaderSubject(diagram.view)}的入口、主要阶段和分支方向；随后 ${focusedTotal} 张详图逐项展开源码确认的条件、调用、数据变化和处理结果。`
  }
  if (diagram.role === "focused") {
    return `本图展开 ${humanDiagramFocus(diagram.focus, sources)}，保留该范围内每条源码关系及其方向，不以汇总容器代替具体步骤。`
  }
  return `本图完整展示当前源码能够确认的${viewReaderSubject(diagram.view)}；没有源码证据的关系不会补画。`
}

function diagramReaderSummary(diagram: DesignModule["diagrams"][number], _sources: EvidenceSources) {
  const ir = diagram.ir
  if (ir.viewType === "not-applicable") return ""
  if (ir.viewType === "product-section") return ""
  if (ir.viewType === "overview") return `图中包含 ${ir.items.length} 个组成项和 ${ir.relations?.length ?? 0} 条关系。`
  if (ir.viewType === "business-flow")
    return `图中包含 ${ir.activities.length} 个业务步骤和 ${ir.flows.length} 条步骤关系。`
  if (ir.viewType === "execution-flow")
    return `图中包含 ${ir.nodes.length} 个代码步骤和 ${ir.edges.length} 条执行关系。`
  if (ir.viewType === "data-flow")
    return `图中包含 ${ir.entities.length} 个数据实体和 ${ir.flows.length} 条读写或传递关系。`
  if (ir.viewType === "error-flow")
    return `图中包含 ${ir.nodes.length} 个异常处理节点和 ${ir.edges.length} 条异常路径。`
  if (ir.viewType === "sequence")
    return `图中包含 ${ir.participants.length} 个参与方和 ${ir.messages.length} 条调用消息。`
  if (ir.viewType === "structure" || ir.viewType === "code-structure") {
    return `图中包含 ${ir.nodes.length} 个源码节点和 ${ir.edges.length} 条组成或依赖关系。`
  }
  return `图中包含 ${ir.states.length} 个状态和 ${ir.transitions.length} 条状态切换。`
}

function diagramDisplayHeading(diagram: DesignModule["diagrams"][number], focusedIndex: number, focusedTotal: number) {
  if (diagram.topic === "data-persistence" && diagram.role === "base") {
    return focusedTotal ? "数据流转与保存边界总览（用于定位）" : "数据流转与保存边界图"
  }
  const title = viewReaderTitle(diagram.view)
  if (diagram.role === "base") return focusedTotal ? `${title}总览（用于定位）` : title
  const suffix = focusedTotal ? ` ${focusedIndex}/${focusedTotal}` : ""
  return `${title}详图${suffix}：${humanDiagramFocus(diagram.focus)}`
}

function humanDiagramFocus(value?: string, sources?: EvidenceSources) {
  if (!value) return "具体步骤与关系"
  const cleaned = sources ? cleanText(value, sources) : value
  const withoutInternalTerms = cleaned
    .replace(/\s*\/\s*聚焦\s*\d+\s*$/u, "")
    .replace(/\s*\/\s*\d+\s*条原子关系\s*/u, "")
    .replace(/^跨源码关系组$/u, "跨源码调用与数据交接")
    .trim()
  const basename = path.posix.basename(withoutInternalTerms)
  return basename || "具体步骤与关系"
}

function viewReaderTitle(view: (typeof fullDesignViews)[number]) {
  return {
    architecture: "整体结构图",
    "business-flow": "业务流程图",
    "code-flow": "代码执行图",
    "state-machine": "状态变化图",
    "data-lifecycle": "数据流转图",
  }[view]
}

function viewReaderSubject(view: (typeof fullDesignViews)[number]) {
  return {
    architecture: "整体结构和协作关系",
    "business-flow": "业务处理过程",
    "code-flow": "代码执行过程",
    "state-machine": "状态变化",
    "data-lifecycle": "数据流转和生命周期",
  }[view]
}

function appendLifecycleTransitionMarkdown(
  lines: string[],
  diagram: DesignModule["diagrams"][number],
  sources: EvidenceSources,
) {
  if (diagram.ir.viewType !== "lifecycle") return
  const states = new Map(diagram.ir.states.map((state) => [state.id, state.sourceValue]))
  lines.push(
    "**状态切换条件与动作**",
    "",
    "| 当前状态 | 触发事件 | 切换条件 | 执行动作 | 下一状态 | 源码位置 |",
    "|---|---|---|---|---|---|",
  )
  for (const transition of diagram.ir.transitions) {
    lines.push(
      `| ${markdownCell(lifecycleStateName(transition.from, states), sources)} | ${markdownCell(transition.trigger ?? "持续检查", sources)} | ${markdownCell(transition.guard ?? "当前状态分支内无额外条件", sources)} | ${markdownCell(transition.action ?? `更新状态为 ${states.get(transition.to) ?? transition.to}`, sources)} | ${markdownCell(states.get(transition.to) ?? transition.to, sources)} | ${markdownCell(sourceReferences(transition.evidenceIDs, sources, 2, 3), sources)} |`,
    )
  }
  if (!diagram.ir.terminalStateIDs.length)
    lines.push("", "该状态机由持续循环或外部事件驱动，当前源码没有定义独立终止状态。", "")
}

function lifecycleTransitionBlocks(diagram: DesignModule["diagrams"][number], sources: EvidenceSources): WordBlock[] {
  if (diagram.ir.viewType !== "lifecycle") return []
  const states = new Map(diagram.ir.states.map((state) => [state.id, state.sourceValue]))
  return [
    {
      type: "table",
      headers: ["当前状态", "触发事件", "切换条件", "执行动作", "下一状态", "源码位置"],
      rows: diagram.ir.transitions.map((transition) => [
        cleanText(lifecycleStateName(transition.from, states), sources),
        cleanText(transition.trigger ?? "持续检查", sources),
        cleanText(transition.guard ?? "当前状态分支内无额外条件", sources),
        cleanText(transition.action ?? `更新状态为 ${states.get(transition.to) ?? transition.to}`, sources),
        cleanText(states.get(transition.to) ?? transition.to, sources),
        sourceReferences(transition.evidenceIDs, sources, 2, 3),
      ]),
      caption: "源码确认的状态切换条件与动作",
    },
    ...(diagram.ir.terminalStateIDs.length
      ? []
      : [{ type: "paragraph" as const, text: "该状态机由持续循环或外部事件驱动，当前源码没有定义独立终止状态。" }]),
  ]
}

function lifecycleStateName(id: string, states: ReadonlyMap<string, string>) {
  return id === AnyCurrentLifecycleState ? "任意当前状态（外部事件未检查原状态）" : (states.get(id) ?? id)
}

function scopeNoteBlocks(notes: readonly string[], sources: EvidenceSources): WordBlock[] {
  if (!notes.length) return []
  return [{ type: "list", items: notes.map((note) => `图示范围：${cleanText(note, sources)}`) }]
}

function appendLocalImplementationMarkdown(
  lines: string[],
  module: DesignModule,
  sources: EvidenceSources,
  headingLevel: 3 | 4,
  includeContext: boolean,
) {
  const topics = (includeContext ? localTopics : localTopics.slice(4)).filter((topic) =>
    localTopicApplies(module, topic),
  )
  for (const topic of topics) {
    lines.push(`${"#".repeat(headingLevel)} ${topic.title}`, "")
    for (const sourceTopic of topic.topics) {
      const label = topic.labels?.[sourceTopic]
      if (label) lines.push(`**${label}**`, "")
      appendTopicMarkdown(lines, findTopic(module, sourceTopic), sources)
    }
    if (topic.view) appendDiagramsMarkdown(lines, module, topic.view, sources, topic.diagramRole)
    if (topic.interfaces) appendInterfacesMarkdown(lines, module, sources)
  }
}

function localImplementationSections(
  module: DesignModule,
  sources: EvidenceSources,
  level: 2 | 3,
  includeContext: boolean,
): WordSection[] {
  const topics = (includeContext ? localTopics : localTopics.slice(4)).filter((topic) =>
    localTopicApplies(module, topic),
  )
  return topics.map((topic) => ({
    title: topic.title,
    level,
    blocks: [
      ...topic.topics.flatMap((sourceTopic) => [
        ...(topic.labels?.[sourceTopic]
          ? [{ type: "paragraph" as const, text: topic.labels[sourceTopic] ?? sourceTopic }]
          : []),
        ...topicBlocks(findTopic(module, sourceTopic), sources),
      ]),
      ...(topic.view ? diagramBlocks(module, topic.view, sources, topic.diagramRole) : []),
      ...(topic.interfaces ? interfaceBlocks(module, sources) : []),
    ],
  }))
}

function localTopicApplies(module: DesignModule, topic: LocalTopic) {
  if (topic.topics.length || topic.interfaces) return true
  if (!topic.view) return false
  return module.diagrams.some(
    (diagram) => diagram.view === topic.view && (!topic.diagramRole || diagram.role === topic.diagramRole),
  )
}

function appendInterfacesMarkdown(lines: string[], module: DesignModule, sources: EvidenceSources) {
  const diagrams = module.diagrams.filter((item) => item.view === "architecture")
  lines.push("本节提供协作关系导航；关系细节、方向和源码依据以本模块前文的架构图为准。", "")
  for (const diagram of diagrams) {
    const scope = diagram.focus ? `，聚焦 ${cleanText(diagram.focus, sources)}` : "，覆盖整体协作关系"
    lines.push(`- ${cleanText(diagramHeading(diagram), sources)}${scope}；详见本模块架构图。`)
  }
  if (diagrams.length) lines.push("")
}

function interfaceBlocks(module: DesignModule, sources: EvidenceSources): WordBlock[] {
  const diagrams = module.diagrams.filter((item) => item.view === "architecture")
  return [
    { type: "paragraph", text: "本节提供协作关系导航；关系细节、方向和源码依据以本模块前文的架构图为准。" },
    ...(diagrams.length
      ? [
          {
            type: "list" as const,
            items: diagrams.map((diagram) => {
              const scope = diagram.focus ? `，聚焦 ${cleanText(diagram.focus, sources)}` : "，覆盖整体协作关系"
              return `${cleanText(diagramHeading(diagram), sources)}${scope}；详见本模块架构图。`
            }),
          },
        ]
      : []),
  ]
}

function appendGlobalMarkdown(lines: string[], model: DetailedDesignDocument, sources: EvidenceSources) {
  lines.push(
    "## 源码参考索引",
    "",
    "下表使用能够唯一定位文件的最短相对名称；同名文件会自动保留必要的上级目录。",
    "",
    "| 源码文件 | 涉及代码位置 |",
    "|---|---|",
  )
  for (const item of sourceIndex(model, sources)) {
    lines.push(`| ${markdownCell(item.path, sources)} | ${markdownCell(item.locations, sources)} |`)
  }
  lines.push("", "## 待确认事项", "")
  appendOwnerReviewMarkdown(lines, model, sources)
}

function globalWordSections(model: DetailedDesignDocument, sources: EvidenceSources): WordSection[] {
  const outstanding = model.modules
    .map((module) => ({ module, claims: ownerReview(module).priorities }))
    .filter((item) => item.claims.length)
  return [
    {
      title: "源码参考索引",
      level: 1,
      blocks: [
        {
          type: "paragraph",
          text: "下表使用能够唯一定位文件的最短相对名称；同名文件会自动保留必要的上级目录。",
        },
        {
          type: "table",
          headers: ["源码文件", "涉及代码位置"],
          rows: sourceIndex(model, sources).map((item) => [item.path, item.locations]),
          caption: "源码文件与代码位置",
        },
      ],
    },
    {
      title: "待确认事项",
      level: 1,
      blocks: outstanding.length
        ? [
            {
              type: "paragraph",
              text: "以下事项无法仅凭当前源码完全确认，需要项目负责人补充配置、运行环境或业务约定。",
            },
          ]
        : [{ type: "paragraph", text: "当前没有需要额外确认的事项。" }],
    },
    ...outstanding.map(
      ({ module, claims }): WordSection => ({
        title: cleanText(module.name, sources),
        level: 2,
        blocks: ownerReviewBlocks(claims, sources),
      }),
    ),
  ]
}

function sourceIndex(model: DetailedDesignDocument, sources: EvidenceSources) {
  const grouped = Map.groupBy(model.evidence, (item) => item.source.path)
  return [...grouped.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([sourcePath, items]) => {
      const locations = mergeSourceRanges(
        items.map((item) => ({ start: item.source.startLine, end: item.source.endLine })),
      ).map(sourceRangeText)
      return {
        path: shortestSourcePath(sourcePath, sources),
        locations: summarizeValues("位置", locations, 6),
      }
    })
}

function summarizeValues(label: string, values: readonly string[], limit: number) {
  const shown = values.slice(0, limit).join("、")
  return values.length > limit ? `${label}：${shown} 等 ${values.length} 处` : `${label}：${shown}`
}

function appendOwnerReviewMarkdown(lines: string[], model: DetailedDesignDocument, sources: EvidenceSources) {
  const outstanding = model.modules
    .map((module) => ({ module, claims: ownerReview(module).priorities }))
    .filter((item) => item.claims.length)
  if (!outstanding.length) {
    lines.push("当前没有需要额外确认的事项。", "")
    return
  }
  lines.push("以下事项无法仅凭当前源码完全确认，需要项目负责人补充配置、运行环境或业务约定。", "")
  for (const { module, claims } of outstanding) {
    lines.push(`### ${cleanText(module.name, sources)}`, "")
    for (const claim of claims) lines.push(`- ${cleanText(claim.text, sources)}`)
    const evidenceIDs = collectClaimEvidenceIDs(claims)
    if (evidenceIDs.length) lines.push("", `相关源码：${sourceReferences(evidenceIDs, sources, 3, 6)}`, "")
  }
}

function ownerReviewBlocks(claims: readonly Claim[], sources: EvidenceSources): WordBlock[] {
  const evidenceIDs = collectClaimEvidenceIDs(claims)
  return [
    { type: "list", items: claims.map((claim) => cleanText(claim.text, sources)) },
    ...(evidenceIDs.length
      ? [{ type: "paragraph" as const, text: `相关源码：${sourceReferences(evidenceIDs, sources, 3, 6)}` }]
      : []),
  ]
}

function ownerReview(module: DesignModule) {
  const assumptions = uniqueClaims(module.topics.flatMap(({ ir }) => ir.assumptions))
  const unknowns = uniqueClaims(meaningfulUnknowns(module.topics.flatMap(({ ir }) => ir.unknowns)))
  return { priorities: uniqueClaims([...assumptions, ...unknowns]).slice(0, 5) }
}

function uniqueClaims(claims: readonly Claim[]) {
  const seen = new Set<string>()
  return claims.filter((claim) => {
    const key = claim.text.trim().replace(/\s+/g, " ")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function collectEvidenceIDs(value: unknown): string[] {
  const output: string[] = []
  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    if (!current || typeof current !== "object") return
    for (const [key, item] of Object.entries(current)) {
      if (key === "evidenceIDs" && Array.isArray(item)) {
        for (const id of item) if (typeof id === "string") output.push(id)
      } else visit(item)
    }
  }
  visit(value)
  return [...new Set(output)]
}

function sourceReferences(
  ids: readonly string[],
  sources: EvidenceSources,
  maxFiles = Number.POSITIVE_INFINITY,
  maxRanges = Number.POSITIVE_INFINITY,
) {
  if (!ids.length) return "无直接源码位置"
  const groups = new Map<string, Array<{ start: number; end: number }>>()
  for (const id of ids) {
    const item = sources.get(id)
    if (!item) continue
    const ranges = groups.get(item.source.path) ?? []
    ranges.push({ start: item.source.startLine, end: item.source.endLine })
    groups.set(item.source.path, ranges)
  }
  if (!groups.size) return "未找到对应源码位置"
  const entries = [...groups]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([sourcePath, ranges]) => ({
      displayPath: shortestSourcePath(sourcePath, sources),
      ranges: summarizeSourceRanges(mergeSourceRanges(ranges), maxRanges),
    }))
  const visible = entries.slice(0, maxFiles)
  const shown = visible.map((entry) => `${entry.displayPath}:${entry.ranges}`).join("；")
  return entries.length > maxFiles ? `${shown}；等 ${entries.length} 个源码文件，详见源码参考索引` : shown
}

function shortestSourcePath(sourcePath: string, sources: EvidenceSources) {
  const normalized = portable(sourcePath).replace(/^\.\//, "")
  const segments = normalized.split("/").filter(Boolean)
  const paths = [...new Set([...sources.values()].map((item) => portable(item.source.path).replace(/^\.\//, "")))]
  for (let length = 1; length <= segments.length; length++) {
    const suffix = segments.slice(-length).join("/")
    const matches = paths.filter((candidate) => candidate === suffix || candidate.endsWith(`/${suffix}`))
    if (matches.length === 1) return suffix
  }
  return normalized
}

function moduleKindLabel(kind?: ModuleManifest["modules"][number]["unitKind"]) {
  return {
    root: "目标模块",
    directory: "目录子模块",
    "c-component": "C/C++ 源码组件",
    "logical-submodule": "逻辑子模块",
  }[kind ?? "root"]
}

function summarizeSourceRanges(ranges: ReadonlyArray<{ start: number; end: number }>, limit: number) {
  const shown = ranges.slice(0, limit).map(sourceRangeText).join("、")
  return ranges.length > limit ? `${shown} 等 ${ranges.length} 处` : shown
}

function mergeSourceRanges(ranges: ReadonlyArray<{ start: number; end: number }>) {
  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges.toSorted((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end + 1) {
      merged.push({ ...range })
      continue
    }
    previous.end = Math.max(previous.end, range.end)
  }
  return merged
}

function sourceRangeText(range: { start: number; end: number }) {
  return range.start === range.end ? String(range.start) : `${range.start}-${range.end}`
}

function sourceReference(item: EvidenceItem, sources: EvidenceSources) {
  return `${sourceLocation(item, sources)}${item.source.symbol ? ` @ ${item.source.symbol}` : ""}`
}

function sourceLocation(item: EvidenceItem, sources: EvidenceSources) {
  return `${shortestSourcePath(item.source.path, sources)}:${sourceLineRange(item)}`
}

function sourceLineRange(item: EvidenceItem) {
  return item.source.startLine === item.source.endLine
    ? String(item.source.startLine)
    : `${item.source.startLine}-${item.source.endLine}`
}

function cleanText(text: string, sources: EvidenceSources) {
  return text
    .replace(/\bEV-[A-Za-z0-9_-]+\b/g, (id) => {
      const item = sources.get(id)
      return item ? sourceReference(item, sources) : "未解析源码证据"
    })
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff，。；：、“”‘’（）])/gu, "$1")
    .replace(/([，。；：、“”‘’（）])\s+(?=[\u3400-\u9fff])/gu, "$1")
}

function markdownCell(text: string, sources: EvidenceSources) {
  return cleanText(text, sources).replaceAll("|", "\\|").replaceAll("\n", "<br>")
}

function assertPublishableReaderText(value: string) {
  if (/\bEV-[A-Za-z0-9_-]+\b/.test(value)) throw new Error("公开详细设计文档不得包含程序内部证据编号")
  if (
    /\b(?:Evidence Pack|WorkItem|DesignUnit)\b|topic-evidence-[a-z-]+|\bMOD-[a-f0-9]{20}\b|证据包|设计单元|代表性采样|证据采用[^。；]*采样/iu.test(
      value,
    )
  ) {
    throw new Error("公开详细设计文档不得包含程序内部任务或证据采样术语")
  }
  if (/\bPASS\b|结构校验通过率|证据覆盖率|图渲染成功率|模型无权/iu.test(value)) {
    throw new Error("公开详细设计文档不得包含内部验收状态或生成流程说明")
  }
  if (value.includes("…")) throw new Error("公开详细设计文档不得包含无法追溯的截断省略号")
}

function diagramHeading(diagram: DetailedDesignDocument["modules"][number]["diagrams"][number]) {
  if (diagram.topic === "data-persistence" && diagram.role === "base") return "数据流转与保存边界图"
  return `${viewReaderTitle(diagram.view)}${diagram.role === "focused" ? `：${humanDiagramFocus(diagram.focus)}` : ""}`
}

function diagramImagePaths(diagram: DetailedDesignDocument["modules"][number]["diagrams"][number]) {
  if (diagram.imagePaths?.length) return diagram.imagePaths
  return diagram.imagePath ? [diagram.imagePath] : []
}

function facetHeading(heading: string, index: number, count: number) {
  return count > 1 ? `${heading}（分面 ${index + 1}/${count}）` : heading
}

function relativeFromDocument(imagePath: string) {
  const marker = "/design-doc-"
  const index = imagePath.indexOf(marker)
  if (index < 0) return imagePath
  const slash = imagePath.indexOf("/", index + marker.length)
  return slash < 0 ? imagePath : imagePath.slice(slash + 1)
}

function portable(value: string) {
  return value.split(path.sep).join("/")
}
