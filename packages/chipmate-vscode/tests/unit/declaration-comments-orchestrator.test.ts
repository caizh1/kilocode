import { describe, expect, it } from "bun:test"
import { DeclarationCommentOrchestrator } from "../../src/services/declaration-comments/orchestrator"
import { DECLARATION_COMMENT_SYSTEM_PROMPT } from "../../src/services/declaration-comments/protocol"
import type { DeclarationTarget } from "../../src/services/declaration-comments/types"

const source = "typedef unsigned sector_t;\n"
const target: DeclarationTarget = {
  uri: "file:///repo/main.h",
  filePath: "/repo/main.h",
  relativePath: "main.h",
  workspacePath: "/repo",
  languageId: "c",
  documentVersion: 1,
  documentText: source,
  eol: "\n",
  kind: "typedef",
  displayName: "sector_t",
  declarationSource: source.trimEnd(),
  declarationHash: "hash",
  documentHash: "document",
  startIndex: 0,
  endIndex: source.length - 1,
  startLine: 0,
  endLine: 0,
  contextBefore: "",
  contextAfter: "",
  headerStyle: "docBlock",
  existingComments: [],
  memberAnchors: [],
}

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
}

function valid(text = "/** 表示逻辑扇区编号，宽度由 unsigned 的目标 ABI 决定。 */"): string {
  return `结论：生成注释\n理解：该别名用于表示逻辑扇区编号。\n<comment anchor="declaration">\n${text}\n</comment>`
}

function runner(outputs: Array<string | Error>) {
  const inputs: Array<Record<string, unknown>> = []
  return {
    inputs,
    run: async (input: Record<string, unknown>) => {
      inputs.push(input)
      const output = outputs.shift()
      if (output instanceof Error) throw output
      return {
        output: output ?? "",
        providerID: "chipmate",
        modelID: "deepseek-v4-flash",
        sessionID: `session-${inputs.length}`,
      }
    },
  }
}

describe("独立声明注释编排器", () => {
  it("首轮通过时只运行一次声明 Code QA", async () => {
    const fake = runner([valid()])
    const result = await new DeclarationCommentOrchestrator(fake as never, () => undefined).generate({
      target,
      token: token as never,
    })

    expect(result).toMatchObject({ status: "ready", rounds: 1, recovered: false })
    expect(fake.inputs).toHaveLength(1)
    expect(fake.inputs[0]?.systemPrompt).toBe(DECLARATION_COMMENT_SYSTEM_PROMPT)
    expect(fake.inputs[0]?.feature).toBe("high-confidence-declaration-comments")
  })

  it("格式或锚点失败时最多运行一次恢复会话", async () => {
    const invalid = `${valid()}\n<comment anchor="UNKNOWN">\n// 未知成员。\n</comment>`
    const fake = runner([invalid, valid("/** 表示逻辑扇区编号，并保持目标 ABI 的 unsigned 宽度。 */")])
    const result = await new DeclarationCommentOrchestrator(fake as never, () => undefined).generate({
      target,
      token: token as never,
    })

    expect(result).toMatchObject({ status: "ready", rounds: 2, recovered: true })
    expect(fake.inputs).toHaveLength(2)
    expect(String(fake.inputs[1]?.prompt)).toContain("确定性校验反馈")
    expect(String(fake.inputs[1]?.prompt)).toContain("未知成员锚点")
  })

  it("恢复失败时只回退到包含安全声明说明的首轮子集", async () => {
    const primary = `${valid()}\n<comment anchor="UNKNOWN">\n// 未知成员。\n</comment>`
    const fake = runner([primary, new Error("服务暂时不可用")])
    const result = await new DeclarationCommentOrchestrator(fake as never, () => undefined).generate({
      target,
      token: token as never,
    })

    expect(result).toMatchObject({ status: "ready", rounds: 2, recovered: false })
    if (result.status === "ready") expect(result.result.proposals).toHaveLength(1)
  })

  it("两轮都没有安全声明说明时终止且不启动第三轮", async () => {
    const fake = runner(["没有协议输出", "仍然没有协议输出", valid()])
    const result = await new DeclarationCommentOrchestrator(fake as never, () => undefined).generate({
      target,
      token: token as never,
    })

    expect(result).toMatchObject({ status: "unresolved", rounds: 2 })
    expect(fake.inputs).toHaveLength(2)
  })
})
