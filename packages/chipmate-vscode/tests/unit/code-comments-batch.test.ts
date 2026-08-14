import { describe, expect, it } from "bun:test"
import { generateCommentBatch } from "../../src/services/code-comments/batch"
import type { BatchCommentTarget, FunctionTarget } from "../../src/services/code-comments/types"

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
}

function target(index: number): BatchCommentTarget {
  const source = `int value_${index}(void) { return ${index}; }\n`
  const value: FunctionTarget = {
    uri: "file:///repo/main.c",
    filePath: "/repo/main.c",
    relativePath: "main.c",
    workspacePath: "/repo",
    languageId: "c",
    documentVersion: 1,
    documentText: source,
    functionSource: source.trimEnd(),
    functionHash: `hash-${index}`,
    startIndex: 0,
    endIndex: source.trimEnd().length,
    startLine: index,
    endLine: index,
    contextBefore: "",
    contextAfter: "",
    functionHeaderStyle: "docBlock",
    existingComments: [],
    complexity: {
      lineCount: 1,
      controlRegionCount: 0,
      existingCoveredRegionCount: 0,
      minimumInlineComments: 0,
      controlRegions: [],
    },
    anchors: [{ line: index, kind: "function", targetLineText: source.trimEnd(), indent: "" }],
    eol: "\n",
  }
  return { target: value, mode: "insert" }
}

describe("批量代码注释编排", () => {
  it("最多同时运行四个函数并保持输入结果顺序", async () => {
    let active = 0
    let maximum = 0
    const progress: number[] = []
    const targets = Array.from({ length: 8 }, (_, index) => target(index))

    const results = await generateCommentBatch({
      targets,
      token: token as never,
      concurrency: 4,
      report: (value) => progress.push(value.completed),
      generate: async (item) => {
        active += 1
        maximum = Math.max(maximum, active)
        await Bun.sleep(5)
        active -= 1
        return {
          status: "unresolved",
          target: item.target,
          reasons: ["固定测试结果"],
          strategy: "single-self-check",
          rounds: 1,
        }
      },
    })

    expect(maximum).toBe(4)
    expect(results.map((item) => item.target.functionHash)).toEqual(targets.map((item) => item.target.functionHash))
    expect(progress.at(-1)).toBe(8)
  })

  it("单个函数异常只记为失败，不中断其他函数", async () => {
    const targets = [target(0), target(1), target(2)]
    const results = await generateCommentBatch({
      targets,
      token: token as never,
      report: () => undefined,
      generate: async (item) => {
        if (item.target.functionHash === "hash-1") throw new Error("模型连接失败")
        return {
          status: "unresolved",
          target: item.target,
          reasons: ["固定测试结果"],
          strategy: "single-self-check",
          rounds: 1,
        }
      },
    })

    expect(results).toHaveLength(3)
    expect(results[1]?.result).toMatchObject({ status: "unresolved", reasons: ["模型连接失败"] })
  })

  it("拒绝超过十个函数的批次", async () => {
    await expect(
      generateCommentBatch({
        targets: Array.from({ length: 11 }, (_, index) => target(index)),
        token: token as never,
        report: () => undefined,
        generate: async () => {
          throw new Error("不应运行")
        },
      }),
    ).rejects.toThrow("一次最多处理 10 个函数")
  })
})
