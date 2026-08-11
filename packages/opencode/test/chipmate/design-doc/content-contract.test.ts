import { describe, expect, test } from "bun:test"
import {
  buildFullDesignWorkItems,
  fullDesignTopics,
  fullDesignViews,
  validateFullDesignMatrix,
} from "@/chipmate/design-doc/content-contract"

describe("完整详细设计内容矩阵", () => {
  test("程序为每个 DesignUnit 创建 14 个主题和 5 个基础视图", () => {
    let sequence = 0
    const modules = ["MOD-root", "MOD-host"]
    const workItems = buildFullDesignWorkItems(modules, 1, () => `WI-${++sequence}`)

    expect(fullDesignTopics).toHaveLength(14)
    expect(fullDesignViews).toHaveLength(5)
    expect(workItems).toHaveLength(modules.length * 19 + 1)
    expect(validateFullDesignMatrix(modules, workItems)).toEqual({ passed: true, errors: [] })
    expect(workItems.at(-1)?.purpose).toEqual({ kind: "review" })
    expect(workItems.at(-1)?.dependencies).toHaveLength(modules.length * 19)
    for (const moduleID of modules) {
      const topic = workItems.find(
        (item) =>
          item.moduleID === moduleID && item.purpose?.kind === "topic" && item.purpose.topic === "data-persistence",
      )
      const diagram = workItems.find(
        (item) =>
          item.moduleID === moduleID && item.purpose?.kind === "diagram" && item.purpose.view === "data-lifecycle",
      )
      if (!topic) throw new Error(`${moduleID} 缺少 data-persistence 主题`)
      expect(diagram?.purpose).toEqual({
        kind: "diagram",
        view: "data-lifecycle",
        role: "base",
        topic: "data-persistence",
      })
      expect(diagram?.dependencies).toEqual([topic.id])
    }
  })

  test("缺少任一主题时全局矩阵校验失败", () => {
    let sequence = 0
    const workItems = buildFullDesignWorkItems(["MOD-root"], 1, () => `WI-${++sequence}`)
    const incomplete = workItems.filter(
      (item) => !(item.purpose?.kind === "topic" && item.purpose.topic === "concurrency"),
    )

    const result = validateFullDesignMatrix(["MOD-root"], incomplete)

    expect(result.passed).toBeFalse()
    expect(result.errors).toContain("MOD-root / topic:concurrency 至少需要 1 个原子工作项，实际为 0")
  })

  test("主题拆为多个原子工作项后，对应视图必须依赖全部分片", () => {
    let sequence = 0
    const workItems = buildFullDesignWorkItems(["MOD-root"], 1, () => `WI-${++sequence}`)
    const topic = workItems.find((item) => item.purpose?.kind === "topic" && item.purpose.topic === "data-persistence")
    const diagram = workItems.find((item) => item.purpose?.kind === "diagram" && item.purpose.view === "data-lifecycle")
    if (!topic || !diagram) throw new Error("测试缺少主题或视图")
    const fragment = { ...topic, id: "WI-topic-fragment", attempts: [], artifactIDs: [] }
    const expanded = workItems.map((item) =>
      item.id === diagram.id ? { ...item, dependencies: [...item.dependencies, fragment.id] } : item,
    )
    expanded.splice(expanded.indexOf(topic) + 1, 0, fragment)

    expect(validateFullDesignMatrix(["MOD-root"], expanded).passed).toBeTrue()
    const missing = expanded.map((item) =>
      item.id === diagram.id ? { ...item, dependencies: item.dependencies.filter((id) => id !== fragment.id) } : item,
    )
    expect(validateFullDesignMatrix(["MOD-root"], missing).errors).toContain(
      "MOD-root / view:data-lifecycle 必须依赖 topic:data-persistence 的全部原子工作项",
    )
  })
})
