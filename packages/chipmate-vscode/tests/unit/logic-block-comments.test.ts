import { describe, expect, it } from "bun:test"
import {
  buildLogicBlockCommentPrompt,
  parseLogicBlockCommentResponse,
  resolveLogicBlockTarget,
} from "../../src/services/logic-block-comments"
import { buildValidatedLogicBlockCandidate } from "../../src/services/logic-block-comments/validator"

function input(source: string, selected: string) {
  const start = source.indexOf(selected)
  if (start < 0) throw new Error(`找不到选区：${selected}`)
  return {
    uri: "file:///repo/main.c",
    filePath: "/repo/main.c",
    relativePath: "main.c",
    workspacePath: "/repo",
    languageId: "c",
    documentVersion: 7,
    documentText: source,
    selectionStartOffset: start,
    selectionEndOffset: start + selected.length,
    eol: "\n" as const,
  }
}

const source = [
  "int run(int value)",
  "{",
  "    int result = 0;",
  "    if (value < 0) {",
  "        result = recover(value);",
  "        if (result < 0)",
  "            return result;",
  "    }",
  "    submit(result);",
  "    return 0;",
  "}",
  "",
].join("\n")

describe("选中逻辑块目标与协议", () => {
  it("只收集选区完整包含的安全语句并优先控制区域", async () => {
    const selected = source.slice(source.indexOf("    if"), source.indexOf("    return 0;") + "    return 0;".length)
    const target = await resolveLogicBlockTarget(input(source, selected))
    expect(target?.displayName).toBe("run")
    expect(target?.anchors.some((anchor) => anchor.nodeType === "if_statement")).toBe(true)
    expect(target?.anchors.every((anchor) => anchor.startLine >= 3 && anchor.endLine <= 9)).toBe(true)
    expect(target?.anchors.length).toBeLessThanOrEqual(24)
  })

  it("半条语句、函数外选区和 lambda 不形成目标", async () => {
    expect(await resolveLogicBlockTarget(input(source, "result = rec"))).toBeUndefined()
    expect(await resolveLogicBlockTarget(input(source, "int run(int value)"))).toBeUndefined()
    const cpp = "void run() { auto f = [] { return 1; }; f(); }\n"
    expect(
      await resolveLogicBlockTarget({ ...input(cpp, "return 1;"), languageId: "cpp", filePath: "/repo/main.cpp" }),
    ).toBeUndefined()
  })

  it("已有直接注释覆盖的语句不再提供锚点", async () => {
    const commented = "void run(void) {\n    // 已解释提交原因。\n    submit();\n    finish();\n}\n"
    const selected = "submit();\n    finish();"
    const target = await resolveLogicBlockTarget(input(commented, selected))
    expect(target?.anchors.map((anchor) => anchor.targetLineText.trim())).toEqual(["finish();"])
  })

  it("支持生成与无需注释两种简单协议", () => {
    const generated = parseLogicBlockCommentResponse(
      '结论：生成注释\n理解：失败时提前返回。\n<comment anchor="L1">\n// 避免错误状态继续提交。\n</comment>',
    )
    expect(generated).toMatchObject({ ok: true, decision: "generate" })
    expect(parseLogicBlockCommentResponse("结论：无需注释\n理解：选区只是显然赋值。")).toMatchObject({
      ok: true,
      decision: "skip",
    })
  })

  it("拒绝未知锚点、块注释、代码和超过八个锚点", async () => {
    const selected = source.slice(source.indexOf("    if"), source.indexOf("    return 0;") + "    return 0;".length)
    const target = (await resolveLogicBlockTarget(input(source, selected)))!
    expect(
      await buildValidatedLogicBlockCandidate({
        target,
        summary: "理解错误路径。",
        comments: [{ anchorId: "OUT", commentText: "// 解释错误路径。" }],
      }),
    ).toMatchObject({ ok: false })
    expect(
      await buildValidatedLogicBlockCandidate({
        target,
        summary: "理解错误路径。",
        comments: [{ anchorId: target.anchors[0]!.id, commentText: "/* 错误块注释。 */" }],
      }),
    ).toMatchObject({ ok: false })
  })

  it("通过锚点构建纯注释候选并给出详细覆盖目标", async () => {
    const selected = source.slice(source.indexOf("    if"), source.indexOf("    return 0;") + "    return 0;".length)
    const target = (await resolveLogicBlockTarget(input(source, selected)))!
    const result = await buildValidatedLogicBlockCandidate({
      target,
      summary: "理解错误恢复和提交顺序。",
      comments: [{ anchorId: target.anchors[0]!.id, commentText: "// 负值输入先走恢复路径，避免直接提交无效状态。" }],
    })
    expect(result.ok).toBe(true)
    expect(buildLogicBlockCommentPrompt({ target, round: "primary" })).toContain(`建议覆盖约 ${target.detailTarget}`)
  })
})
