import { describe, expect, it } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { CodeCommentOrchestrator } from "../../src/services/code-comments/orchestrator"
import { CodeCommentSessionError } from "../../src/services/code-comments/session-runner"
import { PRODUCTION_COMMENT_STRATEGY } from "../../src/services/code-comments/strategy"
import type { FunctionTarget } from "../../src/services/code-comments/types"

const source = "int value(void)\n{\n    return 1;\n}\n"
const target: FunctionTarget = {
  uri: "file:///repo/main.c",
  filePath: "/repo/main.c",
  relativePath: "main.c",
  workspacePath: "/repo",
  languageId: "c",
  documentVersion: 1,
  documentText: source,
  functionSource: source.trimEnd(),
  functionHash: "hash",
  startIndex: 0,
  endIndex: source.trimEnd().length,
  startLine: 0,
  endLine: 3,
  contextBefore: "",
  contextAfter: "",
  functionHeaderStyle: "docBlock",
  existingComments: [],
  anchors: [
    {
      line: 0,
      kind: "function",
      targetLineText: "int value(void)",
      indent: "",
    },
    {
      line: 2,
      kind: "statement",
      targetLineText: "    return 1;",
      indent: "    ",
    },
  ],
  eol: "\n",
}

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
}

function diff(candidate: string): string {
  return createTwoFilesPatch("a/main.c", "b/main.c", source, candidate).trim()
}

function generate(candidate = "/** 返回固定值 1，且不依赖外部状态。 */\n" + source): string {
  return `结论：生成注释\n理解：该函数无输入与副作用，始终返回固定值 1。\n\`\`\`diff\n${diff(candidate)}\n\`\`\``
}

function revise(candidate: string): string {
  return `结论：修订\n复核：原说明声称过强，已收敛为源码能够证明的返回契约。\n\`\`\`diff\n${diff(candidate)}\n\`\`\``
}

function runner(outputs: Array<string | Error>) {
  const calls: Array<{ stage: string; prompt: string; timeoutMs: number }> = []
  return {
    calls,
    run: async (input: { stage: string; prompt: string; timeoutMs: number }) => {
      calls.push(input)
      const output = outputs.shift()
      if (output instanceof Error) throw output
      return {
        output,
        providerID: "provider",
        modelID: "main",
        sessionID: `session-${calls.length}`,
      }
    },
  }
}

describe("双轮 Code QA 注释编排", () => {
  it("生产默认使用一次 Code QA", () => {
    expect(PRODUCTION_COMMENT_STRATEGY).toBe("single-self-check")
  })

  it("单轮策略在首轮候选通过确定性校验后停止", async () => {
    const fake = runner([generate()])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate({ targets: [target], strategy: "single-self-check" }, token as never)

    expect(result.status).toBe("ready")
    expect(fake.calls.map((call) => call.stage)).toEqual(["primary"])
    expect(fake.calls[0]?.prompt).toContain("comment-only diff")
  })

  it("显式双轮策略启动全新复核会话，通过后才返回候选", async () => {
    const fake = runner([generate(), "结论：通过\n复核：返回值和无外部状态依赖均可由完整函数体直接证明。"])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate({ targets: [target], strategy: "independent-review" }, token as never)

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.rounds).toBe(2)
    expect(result.recovered).toBe(false)
    expect(fake.calls.map((call) => call.stage)).toEqual(["primary", "review"])
    expect(fake.calls[1]?.prompt).toContain("待复核候选")
    expect(fake.calls.every((call) => call.timeoutMs === 120_000)).toBe(true)
  })

  it("复核会话可用新的只注释 Diff 修订首轮候选", async () => {
    const revised = "/** 始终返回整数 1。 */\n" + source
    const fake = runner([generate(), revise(revised)])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate({ targets: [target], strategy: "independent-review" }, token as never)

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.recovered).toBe(true)
    expect(result.result.proposals[0]?.commentText).toContain("始终返回整数 1")
    expect(fake.calls).toHaveLength(2)
  })

  it("复核判定无需注释时返回 skip，而不是强行保留候选", async () => {
    const fake = runner([generate(), "结论：无需注释\n复核：函数只有一个直白返回语句，新增说明只会复述代码。"])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate({ targets: [target], strategy: "independent-review" }, token as never)

    expect(result.status).toBe("skip")
    if (result.status !== "skip") return
    expect(result.recovered).toBe(true)
    expect(result.rounds).toBe(2)
  })

  it("复核发现事实冲突时安全终止，不启动第三轮仲裁", async () => {
    const fake = runner([generate(), "结论：存在冲突\n复核：相邻声明不足以证明返回值对所有构建配置都成立。"])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate({ targets: [target], strategy: "independent-review" }, token as never)

    expect(result.status).toBe("unresolved")
    expect(fake.calls.map((call) => call.stage)).toEqual(["primary", "review"])
  })

  it("首轮格式失败或超时时直接显示具体原因，不用额外会话掩盖失败", async () => {
    const malformed = runner(["我认为应该添加一条注释。", generate()])
    const malformedService = new CodeCommentOrchestrator(malformed as never, () => undefined)
    const malformedResult = await malformedService.generate(
      { targets: [target], strategy: "independent-review" },
      token as never,
    )
    expect(malformedResult.status).toBe("unresolved")
    expect(malformed.calls).toHaveLength(1)

    const timeout = runner([new CodeCommentSessionError("Code 会话在 120000ms 后超时"), generate()])
    const timeoutService = new CodeCommentOrchestrator(timeout as never, () => undefined)
    const timeoutResult = await timeoutService.generate(
      { targets: [target], strategy: "independent-review" },
      token as never,
    )
    expect(timeoutResult.status).toBe("unresolved")
    expect(timeout.calls).toHaveLength(1)
  })

  it("单轮策略只在输出格式失败时启动一次恢复会话", async () => {
    const fake = runner(["我认为应该添加一条注释。", generate()])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate({ targets: [target], strategy: "single-self-check" }, token as never)

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.rounds).toBe(2)
    expect(result.recovered).toBe(true)
    expect(fake.calls.map((call) => call.stage)).toEqual(["primary", "recovery"])
    expect(fake.calls[1]?.prompt).toContain("上一次输出未通过确定性校验")
  })
})
