import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import {
  filterOverlappingCodeTargets,
  runUnifiedTargets,
  selectionShouldUseLogicBlock,
} from "../../src/services/code-comments/register"

describe("统一源码注释目标分发", () => {
  it("完整选择函数时保留冻结函数目标并排除其内部声明", () => {
    const result = filterOverlappingCodeTargets(
      [{ startIndex: 10, endIndex: 100 }],
      [{ startIndex: 30, endIndex: 60 }],
      10,
      100,
    )
    expect(result.functions).toHaveLength(1)
    expect(result.declarations).toHaveLength(0)
  })

  it("只选择函数内局部类型时优先更具体的声明目标", () => {
    const result = filterOverlappingCodeTargets(
      [{ startIndex: 10, endIndex: 100 }],
      [{ startIndex: 30, endIndex: 60 }],
      30,
      60,
    )
    expect(result.functions).toHaveLength(0)
    expect(result.declarations).toHaveLength(1)
  })

  it("保留互不重叠的函数和文件级声明，交给协调器统一预览", () => {
    const result = filterOverlappingCodeTargets(
      [{ startIndex: 100, endIndex: 180 }],
      [{ startIndex: 10, endIndex: 60 }],
      0,
      200,
    )
    expect(result.functions).toHaveLength(1)
    expect(result.declarations).toHaveLength(1)
  })

  it("只有严格位于单个函数内且不完整包含声明时才分发到逻辑块", () => {
    const fn = [{ startIndex: 10, endIndex: 100 }]
    expect(selectionShouldUseLogicBlock(fn, [], 30, 70)).toBe(true)
    expect(selectionShouldUseLogicBlock(fn, [], 10, 100)).toBe(false)
    expect(selectionShouldUseLogicBlock(fn, [{ startIndex: 40, endIndex: 60 }], 30, 70)).toBe(false)
  })

  it("整文件单个目标异常时继续保留后续成功产物", async () => {
    const source = "int run(void) { return 0; }\n"
    const base = {
      uri: "file:///repo/main.c",
      filePath: "/repo/main.c",
      relativePath: "main.c",
      workspacePath: "/repo",
      languageId: "c" as const,
      documentVersion: 1,
      documentText: source,
      documentHash: createHash("sha256").update(source).digest("hex"),
      eol: "\n" as const,
      anchorLine: 0,
      anchorLineText: source.trimEnd(),
      style: "docBlock" as const,
      evidence: source,
    }
    const targets = [
      { workflow: "file-header" as const, target: { ...base, relativePath: "bad.c" } },
      { workflow: "file-header" as const, target: base },
    ]
    let completed = 0
    const results = await runUnifiedTargets(
      targets,
      undefined,
      { isCancellationRequested: false } as never,
      (value) => {
        completed = value
      },
      {
        fileHeaderOrchestrator: {
          generate: async ({ target }: { target: typeof base }) => {
            if (target.relativePath === "bad.c") throw new Error("目标会话意外失败")
            return {
              status: "ready" as const,
              target,
              result: {
                summary: "执行入口模块。",
                comment: { anchorId: "file" as const, commentText: "/** 执行入口模块。 */" },
                proposal: {
                  operation: "insert" as const,
                  insertBeforeLine: 0,
                  indent: "",
                  commentText: "/** 执行入口模块。 */",
                  targetLineText: source.trimEnd(),
                },
              },
              providerID: "chipmate",
              modelID: "deepseek-v4-flash",
              rounds: 1,
              recovered: false,
            }
          },
        },
        log: () => undefined,
      } as never,
    )
    expect(results.map((result) => result.status)).toEqual(["unresolved", "ready"])
    expect(completed).toBe(2)
  })
})
