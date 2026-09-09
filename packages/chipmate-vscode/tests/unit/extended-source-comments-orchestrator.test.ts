import { describe, expect, it } from "bun:test"
import { CodeCommentSessionError } from "../../src/services/code-comments/session-runner"
import { FileHeaderCommentOrchestrator, resolveFileHeaderTarget } from "../../src/services/file-header-comments"
import { LogicBlockCommentOrchestrator, resolveLogicBlockTarget } from "../../src/services/logic-block-comments"

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
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

async function fileTarget() {
  return (await resolveFileHeaderTarget({
    uri: "file:///repo/module.c",
    filePath: "/repo/module.c",
    relativePath: "module.c",
    workspacePath: "/repo",
    languageId: "c",
    documentVersion: 1,
    documentText: "int run(void) { return 0; }\n",
    eol: "\n",
  }))!
}

async function logicTarget() {
  const source = "int run(int value)\n{\n    if (value < 0)\n        return value;\n    return 0;\n}\n"
  const selected = "    if (value < 0)\n        return value;\n    return 0;"
  const start = source.indexOf(selected)
  return (await resolveLogicBlockTarget({
    uri: "file:///repo/main.c",
    filePath: "/repo/main.c",
    relativePath: "main.c",
    workspacePath: "/repo",
    languageId: "c",
    documentVersion: 1,
    documentText: source,
    selectionStartOffset: start,
    selectionEndOffset: start + selected.length,
    eol: "\n",
  }))!
}

describe("文件级与逻辑块注释编排器", () => {
  it("文件头协议解析失败时只进行一次恢复", async () => {
    const fake = runner([
      "没有协议输出",
      '结论：生成注释\n理解：该文件提供执行入口。\n<comment anchor="file">\n/** 提供执行入口并返回调用状态。 */\n</comment>',
    ])
    const result = await new FileHeaderCommentOrchestrator(fake as never, () => undefined).generate({
      target: await fileTarget(),
      token: token as never,
    })
    expect(result).toMatchObject({ status: "ready", rounds: 2, recovered: true })
    expect(fake.inputs).toHaveLength(2)
  })

  it("文件头主轮会话超时时立即失败而不重复等待", async () => {
    const fake = runner([new CodeCommentSessionError("120 秒超时"), "不应执行"])
    const result = await new FileHeaderCommentOrchestrator(fake as never, () => undefined).generate({
      target: await fileTarget(),
      token: token as never,
    })
    expect(result).toMatchObject({ status: "unresolved", rounds: 1 })
    expect(fake.inputs).toHaveLength(1)
  })

  it("逻辑块格式失败后恢复并保留锚点协议", async () => {
    const target = await logicTarget()
    const anchor = target.anchors[0]!.id
    const fake = runner([
      "没有协议输出",
      `结论：生成注释\n理解：负值路径提前返回。\n<comment anchor="${anchor}">\n// 负值输入直接返回，避免继续执行正常路径。\n</comment>`,
    ])
    const result = await new LogicBlockCommentOrchestrator(fake as never, () => undefined).generate({
      target,
      token: token as never,
    })
    expect(result).toMatchObject({ status: "ready", rounds: 2, recovered: true })
    expect(fake.inputs).toHaveLength(2)
  })

  it("逻辑块主轮会话超时时立即失败", async () => {
    const fake = runner([new CodeCommentSessionError("120 秒超时"), "不应执行"])
    const result = await new LogicBlockCommentOrchestrator(fake as never, () => undefined).generate({
      target: await logicTarget(),
      token: token as never,
    })
    expect(result).toMatchObject({ status: "unresolved", rounds: 1 })
    expect(fake.inputs).toHaveLength(1)
  })

  it("逻辑块包含非法锚点且恢复失败时不会降级应用安全子集", async () => {
    const target = await logicTarget()
    const anchor = target.anchors[0]!.id
    const fake = runner([
      `结论：生成注释\n理解：负值路径提前返回。\n<comment anchor="${anchor}">\n// 负值输入直接返回，避免继续执行正常路径。\n</comment>\n<comment anchor="L999">\n// 伪造的选区外锚点。\n</comment>`,
      new CodeCommentSessionError("恢复会话超时"),
    ])
    const result = await new LogicBlockCommentOrchestrator(fake as never, () => undefined).generate({
      target,
      token: token as never,
    })
    expect(result).toMatchObject({ status: "unresolved", rounds: 2 })
    expect(fake.inputs).toHaveLength(2)
  })
})
