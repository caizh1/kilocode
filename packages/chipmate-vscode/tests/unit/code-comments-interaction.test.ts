import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  chooseBatchTargets,
  commentCommandHandler,
  commentModeForTarget,
  readyBatchResults,
} from "../../src/services/code-comments/register"
import type { BatchCommentItemResult, FunctionTarget } from "../../src/services/code-comments/types"

function target(index: number, existing = false): FunctionTarget {
  const source = `int value_${index}(void) { return ${index}; }\n`
  return {
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
    existingFunctionHeader: existing
      ? { startLine: 0, endLine: 0, hash: "header", text: "/** 原说明。 */", style: "docBlock", tagContract: [] }
      : undefined,
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
}

describe("高可信注释简化交互", () => {
  const originalError = vscode.window.showErrorMessage
  const originalInformation = vscode.window.showInformationMessage

  afterEach(() => {
    ;(vscode.window as unknown as { showErrorMessage: typeof originalError }).showErrorMessage = originalError
    ;(vscode.window as unknown as { showInformationMessage: typeof originalInformation }).showInformationMessage =
      originalInformation
  })

  it("选区只有一个函数时不显示 Quick Pick 并直接选择正确模式", async () => {
    let calls = 0
    const selected = await chooseBatchTargets([target(0, true)], async () => {
      calls += 1
      return undefined
    })

    expect(calls).toBe(0)
    expect(selected).toMatchObject([{ mode: "revise" }])
    expect(commentModeForTarget(target(0, true))).toBe("revise")
    expect(commentModeForTarget(target(0))).toBe("insert")
  })

  it("多函数只在生成前显示一次目标选择", async () => {
    let calls = 0
    const selected = await chooseBatchTargets([target(0), target(1)], async (items) => {
      calls += 1
      return items
    })

    expect(calls).toBe(1)
    expect(selected).toHaveLength(2)
  })

  it("生成后直接收集全部可靠候选，不再二次选择", () => {
    const ready = {
      target: target(0),
      mode: "insert",
      result: {
        status: "ready",
        target: target(0),
        strategy: "single-self-check",
        rounds: 1,
        recovered: false,
        providerID: "chipmate",
        modelID: "deepseek-v4-flash",
        result: {
          status: "proposed",
          quality: "complete",
          coverage: { required: 0, covered: 0, missing: 0, coveredRegionIds: [], eligibleAnchors: [] },
          summary: "可靠候选",
          proposals: [],
          candidateComments: [],
        },
      },
    } as BatchCommentItemResult
    const failed = {
      target: target(1),
      mode: "insert",
      result: {
        status: "unresolved",
        target: target(1),
        strategy: "single-self-check",
        rounds: 1,
        reasons: ["证据不足"],
      },
    } as BatchCommentItemResult

    expect(readyBatchResults([ready, failed])).toEqual([ready])
  })

  it("失败通知未被用户处理时也立即释放任务锁", async () => {
    let resolveNotification: ((choice: string | undefined) => void) | undefined
    let runs = 0
    let busyMessages = 0
    ;(vscode.window as unknown as { showErrorMessage: typeof originalError }).showErrorMessage = (() =>
      new Promise<string | undefined>((resolve) => {
        resolveNotification = resolve
      })) as typeof originalError
    ;(vscode.window as unknown as { showInformationMessage: typeof originalInformation }).showInformationMessage = (() => {
      busyMessages += 1
      return Promise.resolve(undefined)
    }) as typeof originalInformation

    const handler = commentCommandHandler(
      "chipmate.test.generateComments",
      async () => {
        runs += 1
        if (runs === 1) throw new Error("候选校验失败")
      },
      {
        log: () => undefined,
        output: { show: () => undefined } as unknown as vscode.OutputChannel,
        status: { hide: () => undefined } as unknown as vscode.StatusBarItem,
      },
      { running: false },
    )

    const first = handler()
    await Bun.sleep(0)
    await handler()

    expect(runs).toBe(2)
    expect(busyMessages).toBe(0)
    resolveNotification?.(undefined)
    await first
  })

  it("源码中不再包含生成后的候选选择窗口", async () => {
    const source = await Bun.file(new URL("../../src/services/code-comments/register.ts", import.meta.url)).text()
    expect(source).not.toContain("选择要加入统一 Diff 的候选")
  })
})
