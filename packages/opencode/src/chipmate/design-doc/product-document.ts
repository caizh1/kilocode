import path from "path"
import { Schema } from "effect"
import type { WordBlock, WordSection } from "@/chipmate/documents/word"
import {
  DiagramIR,
  EvidencePack as EvidencePackSchema,
  ModuleManifest as ModuleManifestSchema,
  type DesignDocJob,
  type ModuleManifest,
  type ProductSection,
  type ProductSectionIR,
  type WorkItem,
} from "./domain"
import type { DesignDocQualityReport } from "./assembler"
import { productSections, productSectionTitle, validateProductDesignMatrix } from "./product-contract"
import { publishDesignDocWord } from "./full-document"
import { DesignDocStore } from "./store"

type ParsedIR = typeof DiagramIR.Type
type ParsedPack = typeof EvidencePackSchema.Type
type Evidence = ParsedPack["evidence"][number]
type ProductClaim = Extract<ParsedIR, { readonly viewType: "product-section" }>["claims"][number]

interface ProductValue {
  item: WorkItem
  ir: ParsedIR
  pack: ParsedPack
  imagePaths: string[]
}

export async function assembleProductDesignDocument(
  workspace: string,
  job: DesignDocJob,
  quality: DesignDocQualityReport,
) {
  const manifest = await readManifest(job)
  const moduleIDs = manifest.modules.filter((module) => module.sourceFiles.length + module.testFiles.length).map((module) => module.id)
  const matrix = validateProductDesignMatrix(moduleIDs, job.workItems)
  if (!matrix.passed) throw new Error(`产品详细设计内容矩阵未通过：${matrix.errors.join("；")}`)
  const values = await readValues(job)
  const evidence = new Map(
    values.flatMap((value) => value.pack.evidence).map((item) => [item.id, item] as const),
  )
  const title = `${manifest.modules.find((module) => module.id === manifest.rootModuleID)?.name ?? job.config.targetPath} 模块详细设计`
  const sections = productWordSections(manifest, values, evidence, quality)
  assertProductDocumentReaderSafe(sections)
  const markdown = renderMarkdown(title, sections)
  const document = await DesignDocStore.writeText(workspace, job.id, "design-doc.md", markdown, "text/markdown")
  const expectedImages = values.reduce((total, value) => total + value.imagePaths.length, 0)
  const word = job.config.outputFormats?.includes("docx")
    ? await publishDesignDocWord(workspace, job, {
        title,
        documentType: "产品级源码详细设计",
        summary: [
          `设计范围：${job.config.targetPath}`,
          `逻辑模块：${moduleIDs.length} 个；设计视图：每个模块 5 类覆盖槽。`,
          "正文按功能、数据、算法、接口和场景组织；完整源码清单与证据索引位于附录。",
          "{{TOC}}",
        ],
        sections,
        expectedImages,
      })
    : undefined
  const model = await DesignDocStore.writeJSON(workspace, job.id, "product-detailed-design-v2.json", {
    schemaVersion: 2,
    jobID: job.id,
    title,
    manifest,
    quality,
  })
  return { document, word, model }
}

function productWordSections(
  manifest: ModuleManifest,
  values: ProductValue[],
  evidence: Map<string, Evidence>,
  quality: DesignDocQualityReport,
): WordSection[] {
  const modules = orderedModules(manifest)
  const section = (moduleID: string, name: ProductSection) => {
    const matches = values.filter(
      (candidate) =>
        candidate.item.moduleID === moduleID &&
        candidate.item.purpose?.kind === "product-section" &&
        candidate.item.purpose.section === name &&
        candidate.ir.viewType === "product-section",
    )
    const fragments = matches.flatMap((value) => value.ir.viewType === "product-section" ? [value.ir] : [])
    if (!fragments.length) throw new Error(`${moduleID} 缺少产品章节 ${name}`)
    return mergeProductFragments(fragments)
  }
  const view = (moduleID: string, name: "architecture" | "business-flow" | "code-flow" | "state-machine" | "data-lifecycle") =>
    values.filter(
      (candidate) =>
        candidate.item.moduleID === moduleID &&
        candidate.item.purpose?.kind === "diagram" &&
        candidate.item.purpose.view === name,
    )

  const sections: WordSection[] = [
    {
      title: "模块概述",
      level: 1,
      blocks: moduleBlocks(modules, (module) => sectionBlocks(section(module.id, "module-overview"), evidence)),
    },
    {
      title: "需求设计",
      level: 2,
      blocks: requirementBlocks(modules, section, evidence),
    },
    {
      title: "总体结构",
      level: 2,
      blocks: moduleBlocks(modules, (module) => [
        ...sectionBlocks(section(module.id, "overall-structure"), evidence),
        ...diagramBlocks(view(module.id, "architecture"), "总体结构图", evidence),
      ]),
    },
    {
      title: "数据实体结构",
      level: 1,
      blocks: moduleBlocks(modules, (module) => [
        ...sectionBlocks(section(module.id, "data-entities"), evidence),
        ...diagramBlocks(view(module.id, "data-lifecycle"), "数据流转图", evidence),
      ]),
    },
    {
      title: "关键算法设计",
      level: 1,
      blocks: moduleBlocks(modules, (module) => [
        ...sectionBlocks(section(module.id, "algorithms"), evidence),
        ...diagramBlocks(view(module.id, "code-flow"), "代码控制流图", evidence),
      ]),
    },
    {
      title: "对外提供接口",
      level: 1,
      blocks: moduleBlocks(modules, (module) => sectionBlocks(section(module.id, "provided-interfaces"), evidence)),
    },
    {
      title: "对外依赖接口",
      level: 1,
      blocks: moduleBlocks(modules, (module) => sectionBlocks(section(module.id, "required-interfaces"), evidence)),
    },
    {
      title: "内部接口定义",
      level: 1,
      blocks: moduleBlocks(modules, (module) => sectionBlocks(section(module.id, "internal-interfaces"), evidence)),
    },
    {
      title: "关键流程设计",
      level: 1,
      blocks: moduleBlocks(modules, (module) => [
        ...sectionBlocks(section(module.id, "key-flows"), evidence),
        ...diagramBlocks(view(module.id, "business-flow"), "业务流程图", evidence),
        ...diagramBlocks(view(module.id, "state-machine"), "状态与生命周期图", evidence),
      ]),
    },
    {
      title: "资源开销和性能设计",
      level: 1,
      blocks: moduleBlocks(modules, (module) => sectionBlocks(section(module.id, "resource-performance"), evidence)),
    },
    {
      title: "DFX 设计",
      level: 1,
      blocks: moduleBlocks(modules, (module) => sectionBlocks(section(module.id, "dfx"), evidence)),
    },
    {
      title: "SFMEA 设计",
      level: 1,
      blocks: moduleBlocks(modules, (module) => sectionBlocks(section(module.id, "sfmea"), evidence)),
    },
    {
      title: "自验证用例设计",
      level: 1,
      blocks: moduleBlocks(modules, (module) => sectionBlocks(section(module.id, "verification"), evidence)),
    },
  ]
  return [
    ...sections,
    { title: "附录 A：需求追踪", level: 1, blocks: requirementAppendix(modules, section, evidence) },
    { title: "附录 B：接口索引", level: 1, blocks: interfaceAppendix(modules, section, evidence) },
    { title: "附录 C：源码文件与符号清单", level: 1, blocks: sourceAppendix(manifest, evidence) },
    { title: "附录 D：证据索引", level: 1, blocks: evidenceAppendix(evidence) },
    { title: "附录 E：待确认项与质量报告", level: 1, blocks: qualityAppendix(values, quality, evidence) },
  ]
}

function mergeProductFragments(
  fragments: ReadonlyArray<Extract<ParsedIR, { readonly viewType: "product-section" }>>,
): ProductSectionIR {
  const normalized = fragments.map((fragment, index) => namespaceClaims(fragment, `F${index + 1}`))
  const first = normalized[0]
  if (!first) throw new Error("产品章节没有可合并的原子产物")
  const section = first.section
  if (normalized.some((fragment) => fragment.section !== section)) throw new Error("产品章节原子产物类型不一致")
  const common = {
    ...first,
    summary: [...new Set(normalized.map((fragment) => fragment.summary))].join(" "),
    claims: normalized.flatMap((fragment) => fragment.claims),
    paragraphs: normalized.flatMap((fragment) => fragment.paragraphs),
    assumptions: normalized.flatMap((fragment) => fragment.assumptions),
    unknowns: normalized.flatMap((fragment) => fragment.unknowns),
  }
  if (section === "module-overview") return { ...common, section, responsibilities: normalized.flatMap((fragment) => fragment.section === section ? fragment.responsibilities : []), boundaries: normalized.flatMap((fragment) => fragment.section === section ? fragment.boundaries : []) } as ProductSectionIR
  if (section === "requirements") return { ...common, section, requirements: normalized.flatMap((fragment) => fragment.section === section ? fragment.requirements : []), sourceStatus: normalized.some((fragment) => fragment.section === section && fragment.sourceStatus === "provided") ? "provided" : "missing" } as ProductSectionIR
  if (section === "overall-structure") return { ...common, section, components: normalized.flatMap((fragment) => fragment.section === section ? fragment.components : []) } as ProductSectionIR
  if (section === "data-entities") return { ...common, section, entities: normalized.flatMap((fragment) => fragment.section === section ? fragment.entities : []) } as ProductSectionIR
  if (section === "algorithms") return { ...common, section, algorithms: normalized.flatMap((fragment) => fragment.section === section ? fragment.algorithms : []) } as ProductSectionIR
  if (section === "provided-interfaces" || section === "required-interfaces" || section === "internal-interfaces") return { ...common, section, interfaces: normalized.flatMap((fragment) => "interfaces" in fragment ? fragment.interfaces : []) } as ProductSectionIR
  if (section === "key-flows") return { ...common, section, scenarios: normalized.flatMap((fragment) => fragment.section === section ? fragment.scenarios : []) } as ProductSectionIR
  if (section === "resource-performance") return { ...common, section, resources: normalized.flatMap((fragment) => fragment.section === section ? fragment.resources : []) } as ProductSectionIR
  if (section === "dfx") return { ...common, section, mechanisms: normalized.flatMap((fragment) => fragment.section === section ? fragment.mechanisms : []) } as ProductSectionIR
  if (section === "sfmea") return { ...common, section, failureModes: normalized.flatMap((fragment) => fragment.section === section ? fragment.failureModes : []) } as ProductSectionIR
  return { ...common, section: "verification", cases: normalized.flatMap((fragment) => fragment.section === "verification" ? fragment.cases : []) } as ProductSectionIR
}

function namespaceClaims(
  fragment: Extract<ParsedIR, { readonly viewType: "product-section" }>,
  prefix: string,
) {
  const value = structuredClone(fragment) as ProductSectionIR
  const mapping = new Map([...value.claims, ...value.assumptions, ...value.unknowns].map((claim) => [claim.id, `${prefix}-${claim.id}`] as const))
  const visit = (current: unknown) => {
    if (Array.isArray(current)) return current.forEach(visit)
    if (!current || typeof current !== "object") return
    const record = current as Record<string, unknown>
    if (typeof record.id === "string" && mapping.has(record.id)) record.id = mapping.get(record.id)!
    if (Array.isArray(record.claimIDs)) record.claimIDs = record.claimIDs.map((id) => typeof id === "string" ? (mapping.get(id) ?? id) : id)
    for (const child of Object.values(record)) visit(child)
  }
  visit(value)
  return value
}

function moduleBlocks(
  modules: ModuleManifest["modules"],
  render: (module: ModuleManifest["modules"][number]) => WordBlock[],
) {
  return modules.flatMap((module, index) => [
    ...(modules.length > 1
      ? [{ type: "heading" as const, level: 3 as const, text: `${module.name ?? path.posix.basename(module.path)}${index === 0 ? "（目标模块）" : ""}` }]
      : []),
    ...render(module),
  ])
}

function sectionBlocks(ir: ProductSectionIR, evidence: Map<string, Evidence>): WordBlock[] {
  const claims = new Map([...ir.claims, ...ir.assumptions, ...ir.unknowns].map((claim) => [claim.id, claim] as const))
  const blocks: WordBlock[] = [
    { type: "paragraph", text: ir.summary },
    ...ir.paragraphs.map((paragraph) => ({
      type: "paragraph" as const,
      text: withSource(paragraph.text, paragraph.claimIDs, claims, evidence),
    })),
  ]
  if (ir.section === "module-overview") {
    blocks.push(productItemTable("主要职责", ir.responsibilities, claims, evidence))
    blocks.push(productItemTable("责任边界", ir.boundaries, claims, evidence))
  } else if (ir.section === "requirements") {
    if (!ir.requirements.length) blocks.push({ type: "paragraph", text: "未提供上游需求证据，本节不生成需求编号。" })
    else
      blocks.push({
        type: "table",
        headers: ["需求编号", "需求名称", "设计分配", "验证方式", "来源"],
        rows: ir.requirements.map((item) => [
          item.id,
          `${item.title}：${item.description}`,
          item.allocation,
          item.verification,
          claimSources(item.claimIDs, claims, evidence),
        ]),
        caption: "需求到设计和验证的追踪关系",
      })
  } else if (ir.section === "overall-structure") {
    blocks.push(productItemTable("逻辑组成", ir.components, claims, evidence))
  } else if (ir.section === "data-entities") {
    for (const entity of ir.entities) {
      blocks.push({ type: "heading", level: 3, text: entity.name })
      blocks.push({ type: "paragraph", text: withSource(entity.purpose, entity.claimIDs, claims, evidence) })
      blocks.push({
        type: "table",
        headers: ["字段", "类型", "位宽或规模", "说明"],
        rows: entity.fields.map((field) => [
          field.name,
          field.type,
          field.width ?? "未在源码中明确",
          field.description,
        ]),
        caption: `${entity.name} 数据结构`,
      })
      const sourceClaims = [...entity.claimIDs, ...entity.fields.flatMap((field) => field.claimIDs)]
      blocks.push({ type: "paragraph", text: `源码位置：${claimSources(sourceClaims, claims, evidence)}` })
    }
  } else if (ir.section === "algorithms") {
    for (const algorithm of ir.algorithms) {
      blocks.push({ type: "heading", level: 3, text: algorithm.name })
      blocks.push({ type: "paragraph", text: withSource(algorithm.objective, algorithm.claimIDs, claims, evidence) })
      blocks.push({ type: "table", headers: ["设计项", "内容"], rows: [
        ["前置条件", join(algorithm.preconditions)],
        ["处理步骤", algorithm.steps.map((step, index) => `${index + 1}. ${step}`).join("\n") || "无"],
        ["复杂度或约束", algorithm.complexity],
        ["源码位置", claimSources(algorithm.claimIDs, claims, evidence)],
      ] })
    }
  } else if (["provided-interfaces", "required-interfaces", "internal-interfaces"].includes(ir.section)) {
    if ("interfaces" in ir) for (const entry of ir.interfaces) blocks.push(interfaceTable(entry, claims, evidence))
  } else if (ir.section === "key-flows") {
    for (const scenario of ir.scenarios) {
      blocks.push({ type: "heading", level: 3, text: scenario.name })
      blocks.push({ type: "table", headers: ["流程要素", "设计说明"], rows: [
        ["触发条件", scenario.trigger],
        ["前置条件", join(scenario.preconditions)],
        ["主流程", scenario.mainSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")],
        ["分支与异常", join(scenario.alternatives)],
        ["处理结果", join(scenario.outcomes)],
        ["源码位置", claimSources(scenario.claimIDs, claims, evidence)],
      ] })
    }
  } else if (ir.section === "resource-performance") {
    blocks.push({ type: "table", headers: ["资源或性能项", "约束/计算方式", "设计影响", "来源"], rows: ir.resources.map((item) => [item.resource, item.formulaOrLimit, item.designImpact, claimSources(item.claimIDs, claims, evidence)]) })
  } else if (ir.section === "dfx") {
    for (const item of ir.mechanisms) blocks.push({ type: "table", headers: ["项目", "说明"], rows: [
      ["诊断信号", item.signal],
      ["触发条件", item.trigger],
      ["定位方式", item.diagnosis],
      ["已知局限", item.limitation],
      ["源码位置", claimSources(item.claimIDs, claims, evidence)],
    ], caption: item.signal })
  } else if (ir.section === "sfmea") {
    for (const item of ir.failureModes) blocks.push({ type: "table", headers: ["项目", "说明"], rows: [
      ["失效模式", item.failureMode],
      ["可能原因", item.cause],
      ["影响", item.effect],
      ["现有检测", item.detection],
      ["源码已实现的缓解", item.implementedMitigation],
      ["建议措施（非现状）", item.recommendation],
      ["源码位置", claimSources(item.claimIDs, claims, evidence)],
    ], caption: item.failureMode })
  } else if (ir.section === "verification") {
    blocks.push({ type: "table", headers: ["自验证用例", "验证步骤", "预期结果"], rows: ir.cases.map((item) => [
      `${item.name}\n${item.source === "existing" ? "已有测试" : "建议新增"} · ${verificationCategory(item.category)}`,
      join(item.steps),
      `${join(item.expected)}\n依据：${claimSources(item.claimIDs, claims, evidence)}`,
    ]) })
  }
  if (ir.unknowns.length) {
    blocks.push({ type: "paragraph", text: "待确认事项" })
    blocks.push({ type: "list", items: ir.unknowns.map((claim) => withSource(claim.statement, [claim.id], claims, evidence)) })
  }
  return blocks
}

function requirementBlocks(
  modules: ModuleManifest["modules"],
  section: (moduleID: string, name: ProductSection) => ProductSectionIR,
  evidence: Map<string, Evidence>,
) {
  const values = modules.map((module) => ({ module, ir: section(module.id, "requirements") }))
  const provided = values.filter(
    (value): value is { module: ModuleManifest["modules"][number]; ir: Extract<ProductSectionIR, { section: "requirements" }> } =>
      value.ir.section === "requirements" && value.ir.sourceStatus === "provided",
  )
  if (!provided.length) {
    return [
      {
        type: "paragraph" as const,
        text: "本次输入未提供需求规格、概要设计或已批准的需求分解材料，因此无法建立需求编号到实现与验证的双向追踪。本节不虚构 AR 编号；模块的源码实现责任在后续章节说明，补充上游文档后应重新生成需求追踪。",
      },
    ]
  }
  return moduleBlocks(
    provided.map((value) => value.module),
    (module) => sectionBlocks(section(module.id, "requirements"), evidence),
  )
}

function productItemTable(
  caption: string,
  items: ReadonlyArray<{ name: string; description: string; claimIDs: readonly string[] }>,
  claims: Map<string, ProductClaim>,
  evidence: Map<string, Evidence>,
): WordBlock {
  return {
    type: "table",
    headers: ["设计项", "说明", "来源"],
    rows: items.map((item) => [item.name, item.description, claimSources(item.claimIDs, claims, evidence)]),
    caption,
  }
}

function interfaceTable(
  entry: Extract<ProductSectionIR, { section: "provided-interfaces" | "required-interfaces" | "internal-interfaces" }>["interfaces"][number],
  claims: Map<string, ProductClaim>,
  evidence: Map<string, Evidence>,
): WordBlock {
  return {
    type: "table",
    headers: ["项目", "说明"],
    rows: [
      ["函数原型", entry.prototype],
      ["函数功能", entry.purpose],
      ["输入说明", join(entry.inputs)],
      ["输出说明", join(entry.outputs)],
      ["返回值说明", join(entry.returns)],
      ["使用说明", entry.usage],
      ["注意事项", join(entry.cautions)],
      ["源码位置", claimSources(entry.claimIDs, claims, evidence)],
    ],
    caption: entry.prototype,
  }
}

function diagramBlocks(values: ProductValue[], title: string, evidence: Map<string, Evidence>): WordBlock[] {
  return values.flatMap((value) => {
    if (value.ir.viewType === "not-applicable") {
      return [{ type: "paragraph" as const, text: `${title}不适用：${value.ir.reason}` }]
    }
    if (!value.imagePaths.length) throw new Error(`${title}缺少渲染图片`)
    const intro = `下图用于说明${title.replace(/图$/, "")}的入口、关键步骤、分支和结果；复杂链路按聚焦范围拆图，阅读时应沿箭头方向结合图后说明。`
    const evidenceIDs = collectEvidenceIDs(value.ir)
    return [
      { type: "paragraph" as const, text: intro },
      ...value.imagePaths.map((imagePath, index) => ({
        type: "image" as const,
        title: value.imagePaths.length > 1 ? `${title}（${index + 1}/${value.imagePaths.length}）` : title,
        caption: value.imagePaths.length > 1 ? `${title}分图 ${index + 1}` : title,
        altText: `${title}，基于已验证源码关系生成`,
        path: imagePath,
      })),
      {
        type: "paragraph" as const,
        text: `${diagramSummary(value.ir)}（来源：${sourceReferences(evidenceIDs, evidence, 6, 8)}）`,
      },
    ]
  })
}

function diagramSummary(ir: ParsedIR) {
  if (ir.viewType === "overview") return `图中包含 ${ir.items.length} 个组成项和 ${ir.relations?.length ?? 0} 条关系。`
  if (ir.viewType === "business-flow") return `图中包含 ${ir.activities.length} 个业务步骤和 ${ir.flows.length} 条流程关系。`
  if (ir.viewType === "execution-flow") return `图中包含 ${ir.nodes.length} 个代码步骤和 ${ir.edges.length} 条控制关系。`
  if (ir.viewType === "data-flow") return `图中包含 ${ir.entities.length} 个数据实体和 ${ir.flows.length} 条读写或传递关系。`
  if (ir.viewType === "lifecycle") return `图中包含 ${ir.states.length} 个状态和 ${ir.transitions.length} 条状态转换。`
  return "图中关系已经过源码证据校验。"
}

function requirementAppendix(
  modules: ModuleManifest["modules"],
  section: (moduleID: string, name: ProductSection) => ProductSectionIR,
  evidence: Map<string, Evidence>,
): WordBlock[] {
  const rows = modules.flatMap((module) => {
    const ir = section(module.id, "requirements")
    if (ir.section !== "requirements") return []
    const claims = new Map([...ir.claims, ...ir.assumptions, ...ir.unknowns].map((claim) => [claim.id, claim] as const))
    return ir.requirements.map((item) => [item.id, module.name ?? module.path, item.allocation, item.verification, claimSources(item.claimIDs, claims, evidence)])
  })
  return rows.length
    ? [{ type: "table", headers: ["需求编号", "分配模块", "设计分配", "验证方式", "来源"], rows }]
    : [{ type: "paragraph", text: "本次未提供上游需求材料，因此没有可发布的需求追踪条目。" }]
}

function interfaceAppendix(
  modules: ModuleManifest["modules"],
  section: (moduleID: string, name: ProductSection) => ProductSectionIR,
  evidence: Map<string, Evidence>,
): WordBlock[] {
  const rows = (["provided-interfaces", "required-interfaces", "internal-interfaces"] as const).flatMap((name) =>
    modules.flatMap((module) => {
      const ir = section(module.id, name)
      if (!("interfaces" in ir)) return []
      const claims = new Map([...ir.claims, ...ir.assumptions, ...ir.unknowns].map((claim) => [claim.id, claim] as const))
      return ir.interfaces.map((item) => [module.name ?? module.path, interfaceDirection(name), item.prototype, item.purpose, claimSources(item.claimIDs, claims, evidence)])
    }),
  )
  return [{ type: "table", headers: ["模块", "方向", "原型", "功能", "源码位置"], rows }]
}

function sourceAppendix(manifest: ModuleManifest, evidence: Map<string, Evidence>): WordBlock[] {
  const modules = new Map(manifest.modules.map((module) => [module.id, module] as const))
  const owned = new Map((manifest.ownership ?? []).map((item) => [item.path, item.ownerModuleID] as const))
  const files = new Map<string, "生产源码" | "测试源码">()
  for (const module of manifest.modules) {
    for (const file of module.sourceFiles) files.set(file, "生产源码")
    for (const file of module.testFiles) files.set(file, "测试源码")
  }
  const fileRows = [...files]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, kind]) => {
      const owner = modules.get(owned.get(file) ?? manifest.rootModuleID)
      return [owner?.name ?? owner?.path ?? "目标模块", kind, file]
    })
  const symbolRows = [...new Map([...evidence.values()].flatMap((item) => item.source.symbol ? [[`${item.source.path}\0${item.source.symbol}`, [item.source.symbol, `${item.source.path}:${item.source.startLine}`] as string[]] as const] : [])).values()].map((row) => [...row])
  return [
    { type: "paragraph", text: "本附录提供审计与维护入口；正文无需按文件逐项阅读。" },
    { type: "table", headers: ["所属逻辑模块", "类型", "文件"], rows: fileRows, caption: "源码文件归属" },
    { type: "table", headers: ["符号", "定义或证据位置"], rows: symbolRows, caption: "源码符号索引" },
  ]
}

function evidenceAppendix(evidence: Map<string, Evidence>): WordBlock[] {
  return [{
    type: "table",
    headers: ["来源位置", "证据类型", "可确认事实"],
    rows: [...evidence.values()]
      .sort((left, right) => left.source.path.localeCompare(right.source.path) || left.source.startLine - right.source.startLine)
      .map((item) => [`${item.source.path}:${lineRange(item)}`, evidenceKind(item.kind), item.fact]),
    caption: "可追溯证据索引",
  }]
}

function qualityAppendix(values: ProductValue[], quality: DesignDocQualityReport, evidence: Map<string, Evidence>): WordBlock[] {
  const unknowns = values.flatMap((value) => {
    const ir = value.ir
    if (ir.viewType === "not-applicable") return [ir.reason]
    if (ir.viewType !== "product-section") return []
    const claims = new Map([...ir.claims, ...ir.assumptions, ...ir.unknowns].map((item) => [item.id, item] as const))
    return ir.unknowns.map((claim) => withSource(claim.statement, [claim.id], claims, evidence))
  })
  return [
    ...(unknowns.length ? [{ type: "list" as const, items: [...new Set(unknowns)] }] : [{ type: "paragraph" as const, text: "没有尚待确认的设计项。" }]),
    { type: "table", headers: ["质量项", "结果"], rows: [
      ["产品章节与设计视图", `${quality.metrics.passedArtifacts}/${quality.metrics.requiredArtifacts}`],
      ["已验证证据", String(quality.metrics.evidenceCount)],
      ["结构化输出通过率", percent(quality.metrics.schemaPassRate)],
      ["证据覆盖率", percent(quality.metrics.evidenceCoverageRate)],
      ["图形渲染成功率", percent(quality.metrics.renderSuccessRate)],
      ["总体结果", quality.passed ? "通过" : "未通过"],
    ], caption: "发布质量摘要" },
  ]
}

function withSource(
  text: string,
  claimIDs: readonly string[],
  claims: Map<string, ProductClaim>,
  evidence: Map<string, Evidence>,
) {
  const sources = claimSources(claimIDs, claims, evidence)
  return sources === "待确认" ? `${text}（待确认）` : `${text}（来源：${sources}）`
}

function claimSources(
  claimIDs: readonly string[],
  claims: Map<string, ProductClaim>,
  evidence: Map<string, Evidence>,
) {
  const ids = [...new Set(claimIDs.flatMap((id) => claims.get(id)?.evidenceIDs ?? []))]
  return ids.length ? sourceReferences(ids, evidence, 6, 8) : "待确认"
}

function sourceReferences(ids: readonly string[], evidence: Map<string, Evidence>, maxFiles: number, maxRanges: number) {
  const groups = new Map<string, Array<{ start: number; end: number }>>()
  for (const id of ids) {
    const item = evidence.get(id)
    if (!item) continue
    const ranges = groups.get(item.source.path) ?? []
    ranges.push({ start: item.source.startLine, end: item.source.endLine })
    groups.set(item.source.path, ranges)
  }
  if (!groups.size) return "待确认"
  const entries = [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([file, ranges]) => {
    const merged = mergeRanges(ranges).slice(0, maxRanges).map((range) => range.start === range.end ? String(range.start) : `${range.start}-${range.end}`).join("、")
    return `${file}:${merged}`
  })
  const shown = entries.slice(0, maxFiles).join("；")
  return entries.length > maxFiles ? `${shown}；其余见附录 D` : shown
}

function mergeRanges(ranges: Array<{ start: number; end: number }>) {
  const result: Array<{ start: number; end: number }> = []
  for (const range of ranges.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const last = result.at(-1)
    if (!last || range.start > last.end + 1) result.push({ ...range })
    else last.end = Math.max(last.end, range.end)
  }
  return result
}

function collectEvidenceIDs(value: unknown) {
  const ids: string[] = []
  const visit = (current: unknown) => {
    if (Array.isArray(current)) return current.forEach(visit)
    if (!current || typeof current !== "object") return
    for (const [key, item] of Object.entries(current)) {
      if (key === "evidenceIDs" && Array.isArray(item)) ids.push(...item.filter((id): id is string => typeof id === "string"))
      else visit(item)
    }
  }
  visit(value)
  return [...new Set(ids)]
}

async function readManifest(job: DesignDocJob) {
  const artifact = job.artifacts.find((item) => item.kind === "manifest")
  if (!artifact) throw new Error("产品详细设计缺少 Module Manifest")
  const value = await DesignDocStore.readDeclaredArtifact(job, artifact.id)
  const decoded = await Schema.decodeUnknownPromise(ModuleManifestSchema)(JSON.parse(value.content.toString("utf8")))
  return structuredClone(decoded) as ModuleManifest
}

async function readValues(job: DesignDocJob): Promise<ProductValue[]> {
  return Promise.all(job.workItems.filter((item) => item.artifactType !== "review").map(async (item) => {
    const find = (kind: "ir" | "evidence-pack") => job.artifacts.find((artifact) => artifact.workItemID === item.id && artifact.kind === kind && artifact.status === "passed")
    const irArtifact = find("ir")
    const packArtifact = find("evidence-pack")
    if (!irArtifact || !packArtifact) throw new Error(`产品 WorkItem 缺少已通过 IR 或证据包`)
    const [irValue, packValue] = await Promise.all([DesignDocStore.readDeclaredArtifact(job, irArtifact.id), DesignDocStore.readDeclaredArtifact(job, packArtifact.id)])
    const ir = await Schema.decodeUnknownPromise(DiagramIR)(JSON.parse(irValue.content.toString("utf8")))
    const pack = await Schema.decodeUnknownPromise(EvidencePackSchema)(JSON.parse(packValue.content.toString("utf8")))
    const imagePaths = job.artifacts
      .filter((artifact) => artifact.workItemID === item.id && artifact.kind === "render" && artifact.status === "passed")
      .sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }))
      .map((artifact) => portable(path.relative(job.workspace, path.join(DesignDocStore.directory(job.workspace, job.id), artifact.path))))
    return { item, ir, pack, imagePaths }
  }))
}

function orderedModules(manifest: ModuleManifest) {
  const root = manifest.modules.find((module) => module.id === manifest.rootModuleID)
  if (!root) throw new Error("产品详细设计缺少根模块")
  return [root, ...manifest.modules.filter((module) => module.id !== root.id).sort((left, right) => left.path.localeCompare(right.path))]
}

function renderMarkdown(title: string, sections: WordSection[]) {
  const lines = [`# ${title}`, ""]
  for (const section of sections) {
    lines.push(`${"#".repeat((section.level ?? 1) + 1)} ${section.title}`, "")
    for (const block of section.blocks ?? []) {
      if (block.type === "heading") lines.push(`${"#".repeat((block.level ?? 2) + 1)} ${block.text}`, "")
      else if (block.type === "paragraph") lines.push(block.text, "")
      else if (block.type === "list") lines.push(...block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${item}`), "")
      else if (block.type === "table") {
        lines.push(`| ${block.headers.join(" | ")} |`, `|${block.headers.map(() => "---").join("|")}|`, ...block.rows.map((row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|").replaceAll("\n", "<br>")).join(" | ")} |`), "")
      } else if (block.type === "image") lines.push(`![${block.altText ?? block.title ?? "设计图"}](${block.path})`, "")
    }
  }
  return `${lines.join("\n")}\n`
}

export function assertProductDocumentReaderSafe(sections: WordSection[]) {
  const expected = [
    "模块概述",
    "需求设计",
    "总体结构",
    "数据实体结构",
    "关键算法设计",
    "对外提供接口",
    "对外依赖接口",
    "内部接口定义",
    "关键流程设计",
    "资源开销和性能设计",
    "DFX 设计",
    "SFMEA 设计",
    "自验证用例设计",
  ]
  const actual = sections.slice(0, expected.length).map((section) => section.title)
  if (actual.join("\0") !== expected.join("\0")) throw new Error("产品详细设计正文的 11 章及 1.1、1.2 顺序不正确")
  const body = sections.slice(0, expected.length)
  if (
    body.some((section) =>
      section.blocks?.some((block) => block.type === "table" && block.headers.some((header) => /源码文件清单|文件名/.test(header))),
    )
  )
    throw new Error("产品详细设计正文不得出现完整源码文件清单")
  const images = sections.flatMap((section) => section.blocks?.flatMap((block) => block.type === "image" && block.path ? [block.path] : []) ?? [])
  if (images.length !== new Set(images).size) throw new Error("产品详细设计不得重复插入同一张图片")
  const text = readerVisibleText(sections)
  const internal = text.match(/\b(?:EV|MOD|WI|PACK|OB)-[A-Za-z0-9-]+\b|\b(?:Evidence Pack|WorkItem|Schema)\b/i)
  if (internal) throw new Error(`公开产品文档包含内部字段：${internal[0]}`)
  if (/从源码可以确认什么|设计结论|实现机制|适用性/.test(text)) throw new Error("公开产品文档包含机器化章节标题")
}

function readerVisibleText(sections: WordSection[]) {
  return sections
    .flatMap((section) => [
      section.title,
      ...(section.paragraphs ?? []),
      ...(section.bullets ?? []),
      ...(section.numberedItems ?? []),
      ...(section.tables ?? []).flatMap((table) => [table.caption ?? "", ...table.headers, ...table.rows.flat()]),
      ...(section.images ?? []).flatMap((image) => [image.title ?? "", image.caption ?? "", image.altText ?? ""]),
      ...(section.blocks ?? []).flatMap((block) => {
        if (block.type === "heading" || block.type === "paragraph" || block.type === "code") return [block.text]
        if (block.type === "list") return block.items
        if (block.type === "table") return [block.caption ?? "", ...block.headers, ...block.rows.flat()]
        return [block.title ?? "", block.caption ?? "", block.altText ?? ""]
      }),
    ])
    .join("\n")
}

function interfaceDirection(value: "provided-interfaces" | "required-interfaces" | "internal-interfaces") {
  if (value === "provided-interfaces") return "对外提供"
  if (value === "required-interfaces") return "对外依赖"
  return "模块内部"
}

function verificationCategory(value: "normal" | "abnormal" | "boundary" | "state" | "resource") {
  return { normal: "正常", abnormal: "异常", boundary: "边界", state: "状态迁移", resource: "资源限制" }[value]
}

function evidenceKind(value: Evidence["kind"]) {
  return ({ requirement: "需求", "architecture-reference": "概设", "interface-reference": "接口文档", "test-reference": "测试", resource: "资源", diagnostic: "诊断", "failure-mode": "失效处理", "data-entity": "数据实体", "data-flow": "数据流", "flow-node": "流程步骤", "flow-edge": "流程关系", "call-message": "调用", "code-symbol": "源码符号", dependency: "依赖", "state-definition": "状态", "state-transition": "状态转换" } as Partial<Record<Evidence["kind"], string>>)[value] ?? "源码事实"
}

function lineRange(item: Evidence) {
  return item.source.startLine === item.source.endLine ? String(item.source.startLine) : `${item.source.startLine}-${item.source.endLine}`
}

function join(values: readonly string[]) {
  return values.length ? values.join("；") : "无"
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function portable(value: string) {
  return value.split(path.sep).join("/")
}
