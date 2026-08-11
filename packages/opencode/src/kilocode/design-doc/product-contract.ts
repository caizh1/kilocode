import type { ArtifactType, ProductSection, WorkItem } from "./domain"

export const productSections: readonly ProductSection[] = [
  "module-overview",
  "requirements",
  "overall-structure",
  "data-entities",
  "algorithms",
  "provided-interfaces",
  "required-interfaces",
  "internal-interfaces",
  "key-flows",
  "resource-performance",
  "dfx",
  "sfmea",
  "verification",
]

export const productViews = ["architecture", "business-flow", "code-flow", "state-machine", "data-lifecycle"] as const

const viewArtifact: Record<(typeof productViews)[number], ArtifactType> = {
  architecture: "overview",
  "business-flow": "business-flow",
  "code-flow": "execution-flow",
  "state-machine": "lifecycle",
  "data-lifecycle": "data-flow",
}

const viewSection: Record<(typeof productViews)[number], ProductSection> = {
  architecture: "overall-structure",
  "business-flow": "key-flows",
  "code-flow": "algorithms",
  "state-machine": "key-flows",
  "data-lifecycle": "data-entities",
}

export function buildProductDesignWorkItems(
  moduleIDs: readonly string[],
  now: number,
  createID: () => string,
): WorkItem[] {
  const content = moduleIDs.flatMap((moduleID) => {
    const sections = productSections.map(
      (section): WorkItem => ({
        id: createID(),
        moduleID,
        artifactType: "product-section",
        purpose: { kind: "product-section", section },
        status: "pending",
        dependencies: [],
        attempts: [],
        artifactIDs: [],
        createdAt: now,
        updatedAt: now,
      }),
    )
    const sectionIDs = new Map(
      sections.flatMap((item) =>
        item.purpose?.kind === "product-section" ? ([[item.purpose.section, item.id]] as const) : [],
      ),
    )
    const diagrams = productViews.map((view): WorkItem => ({
      id: createID(),
      moduleID,
      artifactType: viewArtifact[view],
      purpose: { kind: "diagram", view, role: "base" },
      status: "pending",
      dependencies: sectionIDs.get(viewSection[view]) ? [sectionIDs.get(viewSection[view])!] : [],
      attempts: [],
      artifactIDs: [],
      createdAt: now,
      updatedAt: now,
    }))
    return [...sections, ...diagrams]
  })
  return [
    ...content,
    {
      id: createID(),
      moduleID: moduleIDs[0] ?? "pending",
      artifactType: "review",
      purpose: { kind: "review" },
      status: "pending",
      dependencies: content.map((item) => item.id),
      attempts: [],
      artifactIDs: [],
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function validateProductDesignMatrix(moduleIDs: readonly string[], workItems: readonly WorkItem[]) {
  const errors: string[] = []
  for (const moduleID of moduleIDs) {
    for (const section of productSections) {
      const matches = workItems.filter(
        (item) =>
          item.moduleID === moduleID &&
          item.purpose?.kind === "product-section" &&
          item.purpose.section === section,
      )
      if (!matches.length) errors.push(`${moduleID} / section:${section} 至少需要 1 个原子工作项，实际为 0`)
    }
    for (const view of productViews) {
      const matches = workItems.filter(
        (item) =>
          item.moduleID === moduleID &&
          item.purpose?.kind === "diagram" &&
          item.purpose.view === view &&
          item.purpose.role === "base",
      )
      if (matches.length !== 1) errors.push(`${moduleID} / view:${view} 基础图数量应为 1，实际为 ${matches.length}`)
      const section = viewSection[view]
      const dependencies = workItems.filter(
        (item) =>
          item.moduleID === moduleID &&
          item.purpose?.kind === "product-section" &&
          item.purpose.section === section,
      )
      const missing = dependencies.filter((dependency) => !matches[0]?.dependencies.includes(dependency.id))
      if (matches.length === 1 && (!dependencies.length || missing.length)) {
        errors.push(`${moduleID} / view:${view} 必须依赖 section:${section} 的全部原子工作项`)
      }
    }
  }
  const review = workItems.filter((item) => item.purpose?.kind === "review")
  if (review.length !== 1) errors.push(`全局 review 数量应为 1，实际为 ${review.length}`)
  return { passed: errors.length === 0, errors }
}

export function productSectionTitle(section: ProductSection) {
  return {
    "module-overview": "模块概述",
    requirements: "需求设计",
    "overall-structure": "总体结构",
    "data-entities": "数据实体结构",
    algorithms: "关键算法设计",
    "provided-interfaces": "对外提供接口",
    "required-interfaces": "对外依赖接口",
    "internal-interfaces": "内部接口定义",
    "key-flows": "关键流程设计",
    "resource-performance": "资源开销和性能设计",
    dfx: "DFX 设计",
    sfmea: "SFMEA 设计",
    verification: "自验证用例设计",
  }[section]
}
