import { describe, expect, it } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { buildCommentedDocument, validateOnlyCommentInsertions } from "../../src/services/code-comments/apply"
import type { FunctionHeaderStyle, FunctionTarget } from "../../src/services/code-comments/types"
import { buildValidatedCommentCandidate, parseCommentQaResponse } from "../../src/services/code-comments/validator"

const source = [
  "static int parse_value(const char *text)",
  "{",
  "    if (!text) {",
  "        return -1;",
  "    }",
  "    return atoi(text);",
  "}",
  "",
].join("\n")

function target(
  existingComments: string[] = [],
  functionHeaderStyle: FunctionHeaderStyle = "docBlock",
): FunctionTarget {
  return {
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
    endLine: 6,
    contextBefore: "",
    contextAfter: "",
    functionHeaderStyle,
    existingComments,
    anchors: [
      {
        line: 0,
        kind: "function",
        targetLineText: "static int parse_value(const char *text)",
        indent: "",
      },
      {
        line: 2,
        kind: "controlBlock",
        targetLineText: "    if (!text) {",
        indent: "    ",
      },
      {
        line: 5,
        kind: "statement",
        targetLineText: "    return atoi(text);",
        indent: "    ",
      },
    ],
    eol: "\n",
  }
}

function patch(candidate: string): string {
  return createTwoFilesPatch("a/main.c", "b/main.c", source, candidate).trim()
}

function primary(candidate: string, summary = "理解：该函数拒绝空指针，并把有效文本交给 atoi 转换。") {
  return `结论：生成注释\n${summary}\n\`\`\`diff\n${patch(candidate)}\n\`\`\``
}

function parseCandidate(output: string, currentTarget = target()) {
  const parsed = parseCommentQaResponse(output, "primary")
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(parsed.reason)
  return buildValidatedCommentCandidate(currentTarget, parsed.value)
}

describe("Code QA 注释 Diff 协议与确定性校验", () => {
  it("接受带简短理解、外层自然文本和唯一注释 Diff 的结果", async () => {
    const candidate = [
      "/** 将文本转换为整数；空指针输入返回 -1。 */",
      "static int parse_value(const char *text)",
      "{",
      "    // 先拒绝空指针，避免将其传给 atoi。",
      "    if (!text) {",
      "        return -1;",
      "    }",
      "    return atoi(text);",
      "}",
      "",
    ].join("\n")
    const result = parseCandidate(primary(candidate))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe("proposed")
    expect(result.value.proposals).toHaveLength(2)
    expect(buildCommentedDocument(target(), result.value.proposals)).toBe(candidate)
    expect(await validateOnlyCommentInsertions(target(), result.value.proposals, candidate)).toBe(true)
  })

  it("允许第一轮判断无需注释，并允许复核通过或否决", () => {
    expect(parseCommentQaResponse("结论：无需注释\n理解：现有实现已经直白，无需重复代码。", "primary")).toMatchObject({
      ok: true,
      value: { decision: "skip" },
    })
    expect(parseCommentQaResponse("结论：通过\n复核：候选事实与源码一致。", "review")).toMatchObject({
      ok: true,
      value: { decision: "approve" },
    })
    expect(parseCommentQaResponse("结论：存在冲突\n复核：调用方对负值的含义存在冲突。", "review")).toMatchObject({
      ok: true,
      value: { decision: "conflict" },
    })
  })

  it("严格限制每轮结论类型、结论数量和 Diff 上限", () => {
    expect(parseCommentQaResponse("结论：通过\n复核：事实一致。", "primary")).toMatchObject({ ok: false })
    expect(parseCommentQaResponse("结论：生成注释\n结论：无需注释\n理解：无法确定。", "primary")).toMatchObject({
      ok: false,
    })
    expect(parseCommentQaResponse("结论：生成注释\n理解：缺少候选补丁。", "primary")).toMatchObject({ ok: false })
    expect(
      parseCommentQaResponse("结论：无需注释\n```diff\n--- a\n+++ b\n```\n理解：无需添加。", "primary"),
    ).toMatchObject({
      ok: false,
    })
    const five = Array.from({ length: 5 }, () => "```diff\n+// 注释\n int value;\n```").join("\n")
    expect(parseCommentQaResponse(`结论：生成注释\n理解：需要解释关键约束。\n${five}`, "primary")).toMatchObject({
      ok: false,
    })
  })

  it("不依赖模型容易写错的 unified diff 行数声明", () => {
    const candidate = "/** 拒绝空指针后再转换文本。 */\n" + source
    const wrongCounts = patch(candidate).replace(/@@ -1,\d+ \+1,\d+ @@/u, "@@ -1,99 +1,88 @@")
    const result = parseCandidate(
      `结论：生成注释\n理解：该函数先拒绝空指针，再转换有效文本。\n\`\`\`diff\n${wrongCounts}\n\`\`\``,
    )

    expect(result.ok).toBe(true)
  })

  it("拒绝没有任何注释增量的伪 Diff", () => {
    const output = "结论：生成注释\n理解：该函数拒绝空指针。\n```diff\n--- a/main.c\n+++ b/main.c\n无效 hunk\n```"
    const parsed = parseCommentQaResponse(output, "primary")
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(buildValidatedCommentCandidate(target(), parsed.value)).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining("没有新增注释")],
    })
  })

  it("接受省略文件头和 hunk 计数的精简注释 Diff", () => {
    const output = [
      "结论：生成注释",
      "理解：空指针保护避免把无效地址传给转换函数。",
      "```diff",
      "+/** 将有效文本转换为整数，空指针返回 -1。 */",
      " static int parse_value(const char *text)",
      "+    // 先拦截空指针，避免将其传给 atoi。",
      "     if (!text) {",
      "```",
    ].join("\n")

    expect(parseCandidate(output).ok).toBe(true)
  })

  it("接受模型按注释位置拆开的多个 Diff 块", () => {
    const output = [
      "结论：生成注释",
      "理解：函数契约和空指针保护都值得说明。",
      "```diff",
      "+/** 将有效文本转换为整数，空指针返回 -1。 */",
      " static int parse_value(const char *text)",
      "```",
      "```diff",
      "+    // 先拦截空指针，避免将其传给 atoi。",
      "     if (!text) {",
      "```",
    ].join("\n")

    const result = parseCandidate(output)
    if (!result.ok) throw new Error(result.reasons.join("；"))
    expect(result.ok).toBe(true)
    expect(result.value.proposals).toHaveLength(2)
  })

  it("兼容 diff 围栏内漏写加号、但注释语法与锚点均准确的回答", () => {
    const output = [
      "结论：生成注释",
      "理解：函数契约和空指针保护都值得说明。",
      "```diff",
      "/**",
      " * 将有效文本转换为整数，空指针返回 -1。",
      " */",
      "static int parse_value(const char *text)",
      "```",
      "```diff",
      "    // 先拦截空指针，避免将其传给 atoi。",
      "    if (!text) {",
      "```",
    ].join("\n")

    const result = parseCandidate(output)
    if (!result.ok) throw new Error(result.reasons.join("；"))
    expect(result.ok).toBe(true)
    expect(result.value.proposals).toHaveLength(2)
  })

  it("按源码真实缩进归一模型在 AST 锚点上多写或少写的前导空白", () => {
    const output = [
      "结论：生成注释",
      "理解：函数的返回契约值得说明。",
      "```diff",
      "+\t/** 将有效文本转换为整数，空指针返回 -1。 */",
      " \tstatic int parse_value(const char *text)",
      "```",
    ].join("\n")

    const result = parseCandidate(output)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.proposals[0]?.indent).toBe("")

    const nested = [
      "结论：生成注释",
      "理解：空指针保护值得说明。",
      "```diff",
      "+// 先拦截空指针，避免将其传给 atoi。",
      " if (!text) {",
      "```",
    ].join("\n")
    const nestedResult = parseCandidate(nested)
    expect(nestedResult.ok).toBe(true)
    if (!nestedResult.ok) return
    expect(nestedResult.value.proposals[0]?.indent).toBe("    ")
  })

  it("拒绝修改原代码的 Diff", () => {
    const candidate = source.replace("return atoi(text);", "return 0;")
    const result = parseCandidate(primary(candidate))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons).toContain("Diff 删除或修改了原有代码")
  })

  it("拒绝在非锚点位置插注释", () => {
    const candidate = source.replace("{\n", "// 这里不是允许的锚点。\n{\n")
    const result = parseCandidate(primary(candidate))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons.some((reason) => reason.includes("锚点无效"))).toBe(true)
  })

  it("拒绝注释中夹带代码、TODO 或与已有注释重复", () => {
    const codeCandidate = source.replace("    if (!text) {", "    // 保护空指针。\n    return 0;\n    if (!text) {")
    expect(parseCandidate(primary(codeCandidate)).ok).toBe(false)

    const todoCandidate = source.replace("    if (!text) {", "    // TODO：以后补充边界处理。\n    if (!text) {")
    expect(parseCandidate(primary(todoCandidate)).ok).toBe(false)

    const duplicateCandidate = source.replace(
      "static int parse_value",
      "/** 将文本转换为整数；空指针输入返回 -1。 */\nstatic int parse_value",
    )
    const duplicate = parseCandidate(
      primary(duplicateCandidate),
      target(["/** 将文本转换为整数；空指针输入返回 -1。 */"]),
    )
    expect(duplicate.ok).toBe(false)
  })

  it("函数说明必须跟随文件既有风格", () => {
    const blockCandidate = source.replace(
      "static int parse_value",
      "/* 将文本转换为整数；空指针输入返回 -1。 */\nstatic int parse_value",
    )
    expect(parseCandidate(primary(blockCandidate), target([], "block")).ok).toBe(true)

    const docCandidate = blockCandidate.replace("/* 将", "/** 将")
    expect(parseCandidate(primary(docCandidate), target([], "block")).ok).toBe(false)
  })
})
