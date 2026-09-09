import { describe, expect, it } from "bun:test"
import { planWholeFileTargets } from "../../src/services/source-annotations/whole-file"

function functionTarget(index: number, header = false, missingInline = 0): any {
  return {
    startIndex: index * 20,
    endIndex: index * 20 + 10,
    ...(header ? { existingFunctionHeader: { text: "/** 已有明确的函数职责说明。 */" } } : {}),
    complexity: { minimumInlineComments: missingInline },
  }
}

function declarationTarget(index: number, header = false): any {
  return {
    startIndex: index * 20,
    endIndex: index * 20 + 10,
    ...(header ? { existingHeader: { text: "/** 已有明确的声明用途说明。 */" } } : {}),
  }
}

describe("整文件缺失注释目标规划", () => {
  it("跳过已有完整说明并保留缺失复杂区域的函数", () => {
    const result = planWholeFileTargets(
      [functionTarget(1, true), functionTarget(2, true, 2), functionTarget(3)],
      [declarationTarget(4, true), declarationTarget(5)],
      50,
    )
    expect(result.selected.map((item) => item.target.startIndex)).toEqual([40, 60, 100])
    expect(result.skipped).toBe(2)
  })

  it("按源码顺序截取前五十个并报告剩余数量", () => {
    const result = planWholeFileTargets(
      Array.from({ length: 55 }, (_, index) => functionTarget(index)),
      [],
      50,
    )
    expect(result.selected).toHaveLength(50)
    expect(result.remaining).toBe(5)
    expect(result.selected[0]!.target.startIndex).toBe(0)
    expect(result.selected.at(-1)!.target.startIndex).toBe(980)
  })

  it("不会把函数内部声明作为独立整文件目标", () => {
    const fn = { ...functionTarget(1), startIndex: 20, endIndex: 100 }
    const local = { ...declarationTarget(2), startIndex: 40, endIndex: 60 }
    const result = planWholeFileTargets([fn], [local], 50)
    expect(result.selected).toHaveLength(1)
    expect(result.selected[0]!.workflow).toBe("function")
  })
})
