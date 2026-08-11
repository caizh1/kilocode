import type { ArtifactType, DesignTopic, DesignView, WorkItem } from "./domain"

export const fullDesignTopics: readonly DesignTopic[] = [
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
]

export const fullDesignViews: readonly DesignView[] = [
  "architecture",
  "business-flow",
  "code-flow",
  "state-machine",
  "data-lifecycle",
]

const viewArtifact: Record<DesignView, ArtifactType> = {
  architecture: "overview",
  "business-flow": "business-flow",
  "code-flow": "execution-flow",
  "state-machine": "lifecycle",
  "data-lifecycle": "data-flow",
}

const viewTopic: Partial<Record<DesignView, DesignTopic>> = {
  "business-flow": "business-process",
  "code-flow": "algorithms",
  "state-machine": "state-lifecycle",
  "data-lifecycle": "data-persistence",
}

export function buildFullDesignWorkItems(
  moduleIDs: readonly string[],
  now: number,
  createID: () => string,
): WorkItem[] {
  const content = moduleIDs.flatMap((moduleID) => {
    const topics = fullDesignTopics.map(
      (topic): WorkItem => ({
        id: createID(),
        moduleID,
        artifactType: "topic",
        purpose: { kind: "topic", topic },
        status: "pending",
        dependencies: [],
        attempts: [],
        artifactIDs: [],
        createdAt: now,
        updatedAt: now,
      }),
    )
    const topicIDs = new Map(
      topics.flatMap((item) => (item.purpose?.kind === "topic" ? [[item.purpose.topic, item.id] as const] : [])),
    )
    const diagrams = fullDesignViews.map((view): WorkItem => {
      const topic = viewTopic[view]
      const dependency = topic ? topicIDs.get(topic) : undefined
      return {
        id: createID(),
        moduleID,
        artifactType: viewArtifact[view],
        purpose: { kind: "diagram", view, role: "base", ...(topic ? { topic } : {}) },
        status: "pending",
        dependencies: dependency ? [dependency] : [],
        attempts: [],
        artifactIDs: [],
        createdAt: now,
        updatedAt: now,
      }
    })
    return [...topics, ...diagrams]
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

export function validateFullDesignMatrix(moduleIDs: readonly string[], workItems: readonly WorkItem[]) {
  const errors: string[] = []
  for (const moduleID of moduleIDs) {
    for (const topic of fullDesignTopics) {
      const matches = workItems.filter(
        (item) => item.moduleID === moduleID && item.purpose?.kind === "topic" && item.purpose.topic === topic,
      )
      if (!matches.length) errors.push(`${moduleID} / topic:${topic} 至少需要 1 个原子工作项，实际为 0`)
    }
    for (const view of fullDesignViews) {
      const matches = workItems.filter(
        (item) =>
          item.moduleID === moduleID &&
          item.purpose?.kind === "diagram" &&
          item.purpose.view === view &&
          item.purpose.role === "base",
      )
      if (matches.length !== 1) errors.push(`${moduleID} / view:${view} 基础图数量应为 1，实际为 ${matches.length}`)
      const topic = viewTopic[view]
      if (topic && matches.length === 1) {
        const dependencies = workItems.filter(
          (item) => item.moduleID === moduleID && item.purpose?.kind === "topic" && item.purpose.topic === topic,
        )
        const missing = dependencies.filter((dependency) => !matches[0]?.dependencies.includes(dependency.id))
        if (!dependencies.length || missing.length) {
          errors.push(`${moduleID} / view:${view} 必须依赖 topic:${topic} 的全部原子工作项`)
        }
      }
    }
  }
  const review = workItems.filter((item) => item.purpose?.kind === "review")
  if (review.length !== 1) errors.push(`全局 review 数量应为 1，实际为 ${review.length}`)
  return { passed: errors.length === 0, errors }
}

export function topicTitle(topic: DesignTopic) {
  return {
    positioning: "业务定位",
    responsibilities: "职责",
    boundaries: "边界",
    "inputs-outputs": "输入与输出",
    "business-process": "业务流程",
    "core-models": "核心模型",
    algorithms: "关键算法",
    concurrency: "并发与同步",
    "state-lifecycle": "状态与生命周期",
    "error-recovery": "异常与恢复",
    "data-persistence": "数据流转与保存边界",
    "configuration-startup": "配置、构建与启动",
    "observability-debugging": "可观测性与调试",
    "constraints-risks": "约束、风险与待确认项",
  }[topic]
}
