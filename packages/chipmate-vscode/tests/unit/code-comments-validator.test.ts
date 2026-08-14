import { describe, expect, it } from "bun:test"
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
    documentText: `${source}\n`,
    functionSource: source,
    functionHash: "hash",
    startIndex: 0,
    endIndex: source.length,
    startLine: 0,
    endLine: 6,
    contextBefore: "",
    contextAfter: "",
    functionHeaderStyle,
    existingComments,
    complexity: {
      lineCount: 7,
      controlRegionCount: 1,
      existingCoveredRegionCount: 0,
      minimumInlineComments: 0,
      controlRegions: [
        {
          id: "control-2-4",
          startLine: 2,
          endLine: 4,
          existingCovered: false,
          anchor: { line: 2, kind: "controlBlock", targetLineText: "    if (!text) {", indent: "    " },
        },
      ],
    },
    anchors: [
      { line: 0, kind: "function", targetLineText: "static int parse_value(const char *text)", indent: "" },
      { line: 2, kind: "controlBlock", targetLineText: "    if (!text) {", indent: "    " },
      { line: 5, kind: "statement", targetLineText: "    return atoi(text);", indent: "    " },
    ],
    eol: "\n",
  }
}

function comment(anchorId: string, text: string): string {
  return `<comment anchor="${anchorId}">\n${text}\n</comment>`
}

function primary(
  comments: string,
  summary = "理解：该函数拒绝空指针，并把有效文本交给 atoi 转换。",
): string {
  return `结论：生成注释\n${summary}\n${comments}`
}

function parseCandidate(output: string, currentTarget = target(), mode: "insert" | "revise" = "insert") {
  const parsed = parseCommentQaResponse(output, "primary")
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(parsed.reason)
  return buildValidatedCommentCandidate(currentTarget, parsed.value, mode)
}

describe("Code QA 锚点注释协议与确定性校验", () => {
  it("按 function 和短区域 ID 构造候选源码，不要求模型复制函数", async () => {
    const output = primary(
      [
        comment("function", "/** 将文本转换为整数；空指针输入返回 -1。 */"),
        comment("R1", "// 先拒绝空指针，避免将其传给 atoi。"),
      ].join("\n"),
    )
    const result = parseCandidate(output)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.proposals).toHaveLength(2)
    expect(result.value.candidateComments.map((item) => item.anchorId)).toEqual(["function", "R1"])
    expect(result.value.coverage).toMatchObject({ required: 0, covered: 1, missing: 0 })
    const candidate = buildCommentedDocument(target(), result.value.proposals)
    expect(candidate).toContain("/** 将文本转换为整数；空指针输入返回 -1。 */\nstatic int parse_value")
    expect(candidate).toContain("    // 先拒绝空指针，避免将其传给 atoi。\n    if (!text)")
    expect(await validateOnlyCommentInsertions(target(), result.value.proposals, candidate)).toBe(true)
  })

  it("严格限制结论、锚点块格式，并拒绝旧完整函数与重复锚点", () => {
    expect(parseCommentQaResponse("结论：通过\n复核：事实一致。", "primary")).toMatchObject({ ok: false })
    expect(parseCommentQaResponse("结论：生成注释\n理解：缺少注释。", "primary")).toMatchObject({ ok: false })
    expect(
      parseCommentQaResponse(`结论：生成注释\n理解：函数清晰。\n\`\`\`c\n${source}\n\`\`\``, "primary"),
    ).toMatchObject({ ok: false })
    expect(
      parseCommentQaResponse(primary(`${comment("function", "/** 说明。 */")}\n${comment("function", "/** 重复。 */")}`), "primary"),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("只能输出一次") })
    expect(
      parseCommentQaResponse('结论：生成注释\n理解：函数清晰。\n<comment anchor="function">未闭合', "primary"),
    ).toMatchObject({ ok: false })
    expect(parseCommentQaResponse("结论：通过\n复核：候选事实与源码一致。", "review")).toMatchObject({
      ok: true,
      value: { decision: "approve" },
    })
  })

  it("自动忽略注释块边界空行和模型缩进，并保留 Doxygen 空说明行", () => {
    const output = primary(
      [
        '<comment anchor="function">',
        "",
        "        /**",
        "         * @brief 转换文本",
        "         *",
        "         * 空指针返回错误码。",
        "         */",
        "",
        "</comment>",
        '<comment anchor="R1">',
        "",
        "        // 空指针必须在调用 atoi 前被拦截。",
        "",
        "</comment>",
      ].join("\n"),
    )
    const result = parseCandidate(output)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.proposals[0]?.commentText).toContain(" *\n * 空指针返回错误码")
    expect(result.value.proposals[1]?.commentText).toBe("// 空指针必须在调用 atoi 前被拦截。")
  })

  it("宏、属性、CRLF、原函数空行和缩进不再进入模型输出协议", async () => {
    const prefixed = "ICODE STATIC void ftl_req_init(void)\r\n{\r\n\r\n    init();\r\n}"
    const current: FunctionTarget = {
      ...target(),
      documentText: `${prefixed}\r\n`,
      functionSource: prefixed,
      endIndex: prefixed.length,
      endLine: 4,
      anchors: [
        { line: 0, kind: "function", targetLineText: "ICODE STATIC void ftl_req_init(void)", indent: "" },
        { line: 3, kind: "statement", targetLineText: "    init();", indent: "    " },
      ],
      complexity: { ...target().complexity, lineCount: 5, controlRegionCount: 0, controlRegions: [] },
      eol: "\r\n",
    }
    const result = parseCandidate(primary(comment("function", "/** 初始化 FTL 请求模块及其全局资源。 */")), current)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const candidate = buildCommentedDocument(current, result.value.proposals)
    expect(candidate).toBe(`/** 初始化 FTL 请求模块及其全局资源。 */\r\n${prefixed}\r\n`)
    expect(await validateOnlyCommentInsertions(current, result.value.proposals, candidate)).toBe(true)
  })

  it("拒绝未知、未提供和已有注释覆盖的区域锚点", () => {
    const unknown = parseCandidate(primary(`${comment("function", "/** 转换文本。 */")}\n${comment("R99", "// 未知位置。")}`))
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.reasons.join("；")).toContain("未知或不可用的注释锚点：R99")

    const covered = target(["// 已有空指针说明。"])
    covered.complexity.existingCoveredRegionCount = 1
    covered.complexity.controlRegions[0]!.existingCovered = true
    const unavailable = parseCandidate(
      primary(`${comment("function", "/** 转换文本。 */")}\n${comment("R1", "// 重复覆盖。")}`),
      covered,
    )
    expect(unavailable.ok).toBe(false)
    if (!unavailable.ok) expect(unavailable.reasons.join("；")).toContain("未知或不可用的注释锚点：R1")
  })

  it("拒绝注释夹带代码、TODO、错误风格和重复说明", () => {
    expect(parseCandidate(primary(comment("function", "/** 转换文本。 */\nreturn 0;"))).ok).toBe(false)
    expect(parseCandidate(primary(comment("function", "/** TODO：以后补充。 */"))).ok).toBe(false)
    expect(
      parseCandidate(primary(comment("function", "/** 转换文本。 */")), target([], "block")).ok,
    ).toBe(false)
    const duplicate = parseCandidate(
      primary(comment("function", "/** 将文本转换为整数；空指针输入返回 -1。 */")),
      target(["/** 将文本转换为整数；空指针输入返回 -1。 */"]),
    )
    expect(duplicate.ok).toBe(false)
  })

  it("修订既有函数说明时只替换说明并保留源码", async () => {
    const revisionSource = `// 旧说明只说进行了转换。\n${source}\n`
    const current = target(["// 旧说明只说进行了转换。"], "line")
    const currentTarget: FunctionTarget = {
      ...current,
      documentText: revisionSource,
      startIndex: revisionSource.indexOf("static int"),
      endIndex: revisionSource.indexOf("static int") + source.length,
      startLine: 1,
      endLine: 7,
      existingFunctionHeader: {
        startLine: 0,
        endLine: 0,
        text: "// 旧说明只说进行了转换。",
        hash: "header-hash",
        style: "line",
        tagContract: [],
      },
      anchors: current.anchors.map((anchor) => ({ ...anchor, line: anchor.line + 1 })),
      complexity: {
        ...current.complexity,
        controlRegions: current.complexity.controlRegions.map((region) => ({
          ...region,
          startLine: region.startLine + 1,
          endLine: region.endLine + 1,
          anchor: region.anchor ? { ...region.anchor, line: region.anchor.line + 1 } : undefined,
        })),
      },
    }
    const result = parseCandidate(
      primary(comment("function", "// 将有效文本转换为整数；空指针输入返回 -1。")),
      currentTarget,
      "revise",
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.proposals[0]).toMatchObject({
      kind: "functionHeader",
      operation: "replace",
      insertBeforeLine: 0,
      replaceEndLine: 0,
    })
    const candidate = buildCommentedDocument(currentTarget, result.value.proposals)
    expect(candidate).toBe(`// 将有效文本转换为整数；空指针输入返回 -1。\n${source}\n`)
    expect(await validateOnlyCommentInsertions(currentTarget, result.value.proposals, candidate)).toBe(true)
  })

  it("Doxygen 修订允许润色描述，但拒绝标签增删、重排和标识变化", () => {
    const header = [
      "/**",
      " * @brief 旧说明",
      " * @param [in] text 输入文本",
      " * @note",
      " * @retval OK 转换成功",
      " * @custom keep exactly",
      " * @return",
      " */",
    ].join("\n")
    const currentTarget: FunctionTarget = {
      ...target([header]),
      documentText: `${header}\n${source}\n`,
      startIndex: header.length + 1,
      endIndex: header.length + 1 + source.length,
      startLine: 8,
      endLine: 14,
      existingFunctionHeader: {
        startLine: 0,
        endLine: 7,
        text: header,
        hash: "header-hash",
        style: "docBlock",
        tagContract: [
          { name: "brief", identity: "" },
          { name: "param", identity: "in:text" },
          { name: "note", identity: "" },
          { name: "retval", identity: "OK" },
          { name: "custom", identity: "", rawLine: "@custom keep exactly" },
          { name: "return", identity: "" },
        ],
      },
      anchors: target().anchors.map((anchor) => ({ ...anchor, line: anchor.line + 8 })),
      complexity: { ...target().complexity, controlRegions: [] },
    }
    const revised = [
      "/**",
      " * @brief 将文本转换为整数",
      " * @param[in] text 待转换文本",
      " * @note 空指针直接返回错误码",
      " * @retval OK 转换成功",
      " * @custom keep exactly",
      " * @return 转换结果",
      " */",
    ].join("\n")
    expect(parseCandidate(primary(comment("function", revised)), currentTarget, "revise").ok).toBe(true)

    for (const invalid of [
      revised.replace(" * @note 空指针直接返回错误码\n", ""),
      revised.replace("@param[in] text", "@param[out] value"),
      revised.replace("@retval OK", "@retval ERROR"),
      revised.replace("@custom keep exactly", "@custom changed"),
      revised.replace(
        " * @note 空指针直接返回错误码\n * @retval OK 转换成功",
        " * @retval OK 转换成功\n * @note 空指针直接返回错误码",
      ),
    ]) {
      expect(parseCandidate(primary(comment("function", invalid)), currentTarget, "revise").ok).toBe(false)
    }
  })

  it("复杂函数按不同短锚点统计覆盖，覆盖不足仍保留安全候选", () => {
    const current = target()
    current.complexity.minimumInlineComments = 2
    current.complexity.controlRegionCount = 2
    current.complexity.controlRegions.push({
      id: "control-5-5",
      startLine: 5,
      endLine: 5,
      existingCovered: false,
      anchor: { line: 5, kind: "controlBlock", targetLineText: "    return atoi(text);", indent: "    " },
    })
    const result = parseCandidate(
      primary(`${comment("function", "/** 转换文本并统一处理异常输入。 */")}\n${comment("R1", "// 空指针不能传给 atoi。")}`),
      current,
    )

    expect(result.ok).toBe(false)
    if (!result.ok && result.kind === "coverage-incomplete") {
      expect(result.partial.coverage).toMatchObject({ required: 2, covered: 1, missing: 1 })
      expect(result.partial.candidateComments.map((item) => item.anchorId)).toEqual(["function", "R1"])
    }
  })

  it("同一区域多行说明只算一个覆盖，且行间注释总计最多八行", () => {
    const current = target()
    current.complexity.minimumInlineComments = 2
    const sameRegion = parseCandidate(
      primary(
        `${comment("function", "/** 转换文本并处理异常路径。 */")}\n${comment(
          "R1",
          "// 先阻止无效地址进入转换。\n// 该保护也统一了空指针错误返回。",
        )}`,
      ),
      current,
    )
    expect(sameRegion.ok).toBe(false)
    if (!sameRegion.ok && sameRegion.kind === "coverage-incomplete") {
      expect(sameRegion.partial.coverage).toMatchObject({ covered: 1, missing: 1 })
    }

    const excessive = parseCandidate(
      primary(
        `${comment("function", "/** 转换文本。 */")}\n${comment(
          "R1",
          Array.from({ length: 9 }, (_, index) => `// 第 ${index + 1} 行不同目的的中文说明。`).join("\n"),
        )}`,
      ),
    )
    expect(excessive.ok).toBe(false)
    if (!excessive.ok) expect(excessive.reasons.join("；")).toContain("行间注释最多八条")
  })
})
