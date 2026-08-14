import { describe, expect, it } from "bun:test"
import { CodeCommentOrchestrator } from "../../src/services/code-comments/orchestrator"
import { buildCommentPrompt } from "../../src/services/code-comments/protocol"
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
  complexity: {
    lineCount: 4,
    controlRegionCount: 0,
    existingCoveredRegionCount: 0,
    minimumInlineComments: 0,
    controlRegions: [],
  },
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

function block(anchorId: string, text: string): string {
  return `<comment anchor="${anchorId}">\n${text}\n</comment>`
}

function generate(comments = block("function", "/** 返回固定值 1，且不依赖外部状态。 */")): string {
  return `结论：生成注释\n理解：该函数无输入与副作用，始终返回固定值 1。\n${comments}`
}

function revise(comments: string): string {
  return `结论：修订\n复核：原说明声称过强，已收敛为源码能够证明的返回契约。\n${comments}`
}

function complexTarget(): FunctionTarget {
  const functionSource = [
    "int route(int value)",
    "{",
    "    if (value < 0) return -1;",
    "    if (value == 0) return 0;",
    "    if (value == 1) return 1;",
    "    return 2;",
    "}",
  ].join("\n")
  const controls = [2, 3, 4].map((line) => ({
    id: `control-${line}-${line}`,
    startLine: line,
    endLine: line,
    existingCovered: false,
    anchor: {
      line,
      kind: "controlBlock" as const,
      targetLineText: functionSource.split("\n")[line]!,
      indent: "    ",
    },
  }))
  return {
    ...target,
    documentText: `${functionSource}\n`,
    functionSource,
    endIndex: functionSource.length,
    endLine: 6,
    complexity: {
      lineCount: 60,
      controlRegionCount: 3,
      existingCoveredRegionCount: 0,
      minimumInlineComments: 2,
      controlRegions: controls,
    },
    anchors: [
      { line: 0, kind: "function", targetLineText: "int route(int value)", indent: "" },
      ...controls.map((region) => region.anchor),
      { line: 5, kind: "statement", targetLineText: "    return 2;", indent: "    " },
    ],
  }
}

function generateComplex(inlineLines: number[] = []): string {
  const comments: Record<number, string> = {
    2: "// 负值表示无效输入，需要在后续分类前拒绝。",
    3: "// 零值使用独立的中性结果，避免进入正值分类。",
    4: "// 单值具有专用返回约定，其余正值统一走默认路径。",
  }
  return generate(
    [
      block("function", "/** 按输入类别选择对应结果。 */"),
      ...inlineLines.map((line) => block(`R${line - 1}`, comments[line]!)),
    ].join("\n"),
  )
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
    expect(fake.calls[0]?.prompt).toContain("只输出锚点注释块")
    expect(fake.calls[0]?.prompt).not.toContain("添加注释后的完整函数")
    expect(fake.calls[0]?.prompt).toContain("必须生成一条函数说明")
    expect(fake.calls[0]?.prompt).toContain('anchor="function"')
    expect(fake.calls[0]?.prompt).not.toContain("结论：无需注释")
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
    expect(fake.calls[1]?.prompt).toContain("待复核锚点注释")
    expect(fake.calls.every((call) => call.timeoutMs === 120_000)).toBe(true)
  })

  it("复核会话可用新的锚点注释修订首轮候选", async () => {
    const fake = runner([generate(), revise(block("function", "/** 始终返回整数 1。 */"))])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate({ targets: [target], strategy: "independent-review" }, token as never)

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.recovered).toBe(true)
    expect(result.result.proposals[0]?.commentText).toContain("始终返回整数 1")
    expect(fake.calls).toHaveLength(2)
  })

  it("拒绝复核会话替用户决定无需注释", async () => {
    const fake = runner([generate(), "结论：无需注释\n复核：函数只有一个直白返回语句，新增说明只会复述代码。"])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate({ targets: [target], strategy: "independent-review" }, token as never)

    expect(result.status).toBe("unresolved")
    if (result.status !== "unresolved") return
    expect(result.reasons[0]).toContain("响应必须且只能包含一行结论")
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

  it("复杂逻辑覆盖不足时只启动现有一次恢复并传递具体缺口", async () => {
    const complex = complexTarget()
    const fake = runner([generateComplex(), generateComplex([2, 4])])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate({ targets: [complex], strategy: "single-self-check" }, token as never)

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.recovered).toBe(true)
    expect(result.result.quality).toBe("complete")
    expect(fake.calls.map((call) => call.stage)).toEqual(["primary", "recovery"])
    expect(fake.calls[1]?.prompt).toContain("复杂逻辑覆盖不足")
    expect(fake.calls[0]?.prompt).toContain('准确源码："    if (value < 0) return -1;"')
    expect(fake.calls[0]?.prompt).toContain("最低覆盖 2 个不同控制区域，建议详细覆盖 3 个")
    expect(fake.calls[1]?.prompt).toContain("上一次已通过代码安全检查、但控制区域覆盖不足的锚点注释")
    expect(fake.calls[1]?.prompt).toContain("还缺 2 个区域")
  })

  it("恢复仍覆盖不足时返回覆盖更多的安全降级候选", async () => {
    const fake = runner([generateComplex(), generateComplex([3])])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate(
      { targets: [complexTarget()], strategy: "single-self-check" },
      token as never,
    )

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.recovered).toBe(true)
    expect(result.result).toMatchObject({
      quality: "coverage-incomplete",
      coverage: { required: 2, covered: 1, missing: 1 },
    })
  })

  it("恢复提示保留安全候选，但不再提供已经覆盖的区域锚点", async () => {
    const fake = runner([generateComplex([2]), generateComplex([2, 4])])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate(
      { targets: [complexTarget()], strategy: "single-self-check" },
      token as never,
    )

    expect(result.status).toBe("ready")
    expect(fake.calls[1]?.prompt).toContain('"anchorId":"R1"')
    expect(fake.calls[1]?.prompt).not.toContain("- 锚点 R1；")
    expect(fake.calls[1]?.prompt).toContain("- 锚点 R2；")
    expect(fake.calls[1]?.prompt).toContain("- 锚点 R3；")
  })

  it("覆盖数量相同时保留更克制的首轮安全候选", async () => {
    const fake = runner([generateComplex([2]), generateComplex([3])])
    const service = new CodeCommentOrchestrator(fake as never, () => undefined)

    const result = await service.generate(
      { targets: [complexTarget()], strategy: "single-self-check" },
      token as never,
    )

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.recovered).toBe(false)
    expect(result.result.candidateComments.some((item) => item.commentText.includes("负值表示无效输入"))).toBe(true)
    expect(result.result.candidateComments.some((item) => item.commentText.includes("零值使用独立"))).toBe(false)
  })

  it("Prompt 排除既有覆盖区域，并把大量锚点均匀限制为十二个", () => {
    const current = complexTarget()
    current.complexity.controlRegions[0]!.existingCovered = true
    current.complexity.existingCoveredRegionCount = 1
    const prompt = buildCommentPrompt({ target: current, round: "primary" })
    expect(prompt).not.toContain('准确源码："    if (value < 0) return -1;"')
    expect(prompt).toContain('准确源码："    if (value == 0) return 0;"')

    const many = complexTarget()
    many.complexity.controlRegions = Array.from({ length: 20 }, (_, index) => ({
      id: `control-${index}`,
      startLine: index + 2,
      endLine: index + 2,
      existingCovered: false,
      anchor: {
        line: index + 2,
        kind: "controlBlock" as const,
        targetLineText: `    if (value == ${index}) return ${index};`,
        indent: "    ",
      },
    }))
    const manyPrompt = buildCommentPrompt({ target: many, round: "primary" })
    expect(manyPrompt.match(/^- 锚点 R/gm)).toHaveLength(12)
    expect(manyPrompt).toContain("锚点 R1；区域 control-0")
    expect(manyPrompt).toContain("锚点 R20；区域 control-19")
  })

  it("恢复超时或返回非法锚点时回退到安全的首轮降级候选", async () => {
    for (const recovery of [
      new CodeCommentSessionError("Code 会话在 120000ms 后超时"),
      generate(`${block("function", "/** 按输入类别选择对应结果。 */")}\n${block("R99", "// 非法锚点。")}`),
    ]) {
      const fake = runner([generateComplex([2]), recovery])
      const service = new CodeCommentOrchestrator(fake as never, () => undefined)

      const result = await service.generate(
        { targets: [complexTarget()], strategy: "single-self-check" },
        token as never,
      )

      expect(result.status).toBe("ready")
      if (result.status !== "ready") continue
      expect(result.recovered).toBe(false)
      expect(result.result.quality).toBe("coverage-incomplete")
      expect(result.result.coverage.covered).toBe(1)
    }
  })
})
