import { describe, expect, it } from "bun:test"
import {
  doxygenTagContract,
  minimumControlCoverage,
  resolveFunctionTarget,
  resolveFunctionTargetsInRange,
} from "../../src/services/code-comments/function-target"

function resolve(source: string, marker: string, languageId: "c" | "cpp" = "cpp") {
  return resolveFunctionTarget({
    uri: `file:///repo/main.${languageId === "c" ? "c" : "cpp"}`,
    filePath: `/repo/main.${languageId === "c" ? "c" : "cpp"}`,
    relativePath: `main.${languageId === "c" ? "c" : "cpp"}`,
    workspacePath: "/repo",
    languageId,
    documentVersion: 7,
    documentText: source,
    cursorOffset: source.indexOf(marker),
    eol: "\n",
  })
}

function resolveRange(source: string, start: string, end: string, languageId: "c" | "cpp" = "cpp") {
  const selectionStartOffset = source.indexOf(start)
  return resolveFunctionTargetsInRange({
    uri: `file:///repo/main.${languageId === "c" ? "c" : "cpp"}`,
    filePath: `/repo/main.${languageId === "c" ? "c" : "cpp"}`,
    relativePath: `main.${languageId === "c" ? "c" : "cpp"}`,
    workspacePath: "/repo",
    languageId,
    documentVersion: 7,
    documentText: source,
    selectionStartOffset,
    selectionEndOffset: source.indexOf(end, selectionStartOffset) + end.length,
    eol: "\n",
  })
}

describe("高可信代码注释函数定位", () => {
  it("按控制区域和函数长度计算自适应覆盖下限", () => {
    expect(minimumControlCoverage(40, 0)).toBe(0)
    expect(minimumControlCoverage(40, 2)).toBe(0)
    expect(minimumControlCoverage(40, 3)).toBe(2)
    expect(minimumControlCoverage(50, 3)).toBe(3)
    expect(minimumControlCoverage(70, 5)).toBe(3)
    expect(minimumControlCoverage(90, 8)).toBe(4)
    expect(minimumControlCoverage(120, 20)).toBe(8)
  })

  it("规范化 Doxygen 标签并保留参数标识与自定义标签原文", () => {
    const contract = doxygenTagContract(
      [
        "/**",
        " * @brief 旧说明",
        " * @param [in] input 输入参数",
        " * @param[out] output 输出参数",
        " * @retval OK 成功",
        " * @custom keep exactly",
        " * @return 状态",
        " */",
      ].join("\n"),
    )

    expect(contract).toEqual([
      { name: "brief", identity: "" },
      { name: "param", identity: "in:input" },
      { name: "param", identity: "out:output" },
      { name: "retval", identity: "OK" },
      { name: "custom", identity: "", rawLine: "@custom keep exactly" },
      { name: "return", identity: "" },
    ])

    expect(doxygenTagContract("/// @brief 行式说明\n//! @param [in] value 输入值\n// @return 结果")).toEqual([
      { name: "brief", identity: "" },
      { name: "param", identity: "in:value" },
      { name: "return", identity: "" },
    ])
  })

  it("使用真实 C 语法树定位包含字符串和注释花括号的函数", async () => {
    const source = [
      "static int parse_value(const char *text)",
      "{",
      '    const char *brace = "}";',
      "    /* } 不能提前结束函数。 */",
      "    if (!text) {",
      "        return -1;",
      "    }",
      "    return brace[0] == text[0];",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "!text", "c")

    expect(target?.startLine).toBe(0)
    expect(target?.endLine).toBe(8)
    expect(target?.anchors.map((anchor) => anchor.line)).toEqual([0, 2, 4, 5, 7])
    expect(target?.functionSource).toContain('const char *brace = "}";')
  })

  it("把模板声明纳入 C++ 函数级注释锚点", async () => {
    const source = [
      "template <typename T>",
      "T clamp_value(",
      "    T value,",
      "    T low,",
      "    T high)",
      "{",
      "    if (value < low) {",
      "        return low;",
      "    }",
      "    return value > high ? high : value;",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "value < low")

    expect(target?.startLine).toBe(0)
    expect(target?.anchors[0]).toEqual({
      line: 0,
      kind: "function",
      targetLineText: "template <typename T>",
      indent: "",
    })
  })

  it("支持构造函数、析构函数和运算符定义", async () => {
    const source = [
      "class Counter {",
      "public:",
      "    Counter() : value_(0) {}",
      "    ~Counter() { reset(); }",
      "    int operator()() const { return value_; }",
      "private:",
      "    void reset();",
      "    int value_;",
      "};",
      "",
    ].join("\n")

    expect((await resolve(source, "value_(0)"))?.startLine).toBe(2)
    expect((await resolve(source, "reset();"))?.startLine).toBe(3)
    expect((await resolve(source, "return value_"))?.startLine).toBe(4)
  })

  it("兼容 QEMU 协程函数标注", async () => {
    const source = [
      "static coroutine_fn void process_request(Request *request)",
      "{",
      "    if (request->cancelled) {",
      "        return;",
      "    }",
      "    request->complete = true;",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "request->cancelled", "c")

    expect(target?.startLine).toBe(0)
    expect(target?.functionSource).toContain("coroutine_fn")
    expect(target?.anchors.map((anchor) => anchor.line)).toEqual([0, 2, 3, 5])
  })

  it("完整保留 Tree-sitter 未识别的同一行声明前缀", async () => {
    const source = [
      "ICODE STATIC void ftl_req_init(void)",
      "{",
      "    init_request_pool();",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "init_request_pool", "c")

    expect(target?.functionSource).toBe(source.trimEnd())
    expect(target?.startIndex).toBe(0)
    expect(target?.anchors[0]?.targetLineText).toBe("ICODE STATIC void ftl_req_init(void)")
  })

  it("通用保留独立行的宏和段属性前缀，但不吞入普通声明", async () => {
    const source = [
      "u32 previous_state;",
      "MEMORY_BANK",
      "NO_INLINE",
      "ALIGN_CACHELINE",
      "FAST_CODE",
      'SECTION(".fast")',
      "STATIC void init_fast_path(void)",
      "{",
      "    previous_state = 0;",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "previous_state = 0", "c")

    expect(target?.startLine).toBe(1)
    expect(target?.functionSource).toStartWith(
      'MEMORY_BANK\nNO_INLINE\nALIGN_CACHELINE\nFAST_CODE\nSECTION(".fast")\nSTATIC void init_fast_path(void)',
    )
    expect(target?.functionSource).not.toContain("u32 previous_state;")
    expect(target?.anchors[0]?.targetLineText).toBe("MEMORY_BANK")
  })

  it("从同文件函数说明推断既有块注释风格", async () => {
    const source = [
      "/* 返回固定值。 */",
      "static int helper(void)",
      "{",
      "    return 1;",
      "}",
      "",
      "static int target(void)",
      "{",
      "    return helper();",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "return helper", "c")

    expect(target?.functionHeaderStyle).toBe("block")
  })

  it("识别与函数紧邻的既有函数说明，供用户显式选择修订", async () => {
    const source = [
      "// 返回旧值。",
      "static int helper(void)",
      "{",
      "    return 1;",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "return 1", "c")

    expect(target?.existingFunctionHeader).toMatchObject({
      startLine: 0,
      endLine: 0,
      text: "// 返回旧值。",
      style: "line",
    })
  })

  it("从真实函数目标提取完整 Doxygen 标签契约", async () => {
    const source = [
      "/**",
      " * @brief 初始化请求模块",
      " * @param [in] input 输入状态",
      " * @param[out] output 输出状态",
      " * @note 必须在调度前调用",
      " * @return 初始化结果",
      " */",
      "static int init_request(int input, int *output)",
      "{",
      "    *output = input;",
      "    return 0;",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "*output = input", "c")

    expect(target?.existingFunctionHeader?.tagContract).toEqual([
      { name: "brief", identity: "" },
      { name: "param", identity: "in:input" },
      { name: "param", identity: "out:output" },
      { name: "note", identity: "" },
      { name: "return", identity: "" },
    ])
  })

  it("已有内部注释只抵扣实际覆盖的控制区域", async () => {
    const source = [
      "static int route(int value)",
      "{",
      "    // 负值必须走错误路径。",
      "    if (value < 0) return -1;",
      "    value += 0; /* 这是上一条语句的尾注，不解释后续分支。 */",
      "    if (value == 0) return 0;",
      "    if (value == 1) return 1;",
      "    return 2;",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "value == 0", "c")

    expect(target?.complexity).toMatchObject({
      lineCount: 9,
      controlRegionCount: 3,
      existingCoveredRegionCount: 1,
      minimumInlineComments: 1,
    })
    expect(target?.complexity.controlRegions).toEqual([
      expect.objectContaining({ id: "control-3-3", startLine: 3, existingCovered: true }),
      expect.objectContaining({ id: "control-5-5", startLine: 5, existingCovered: false }),
      expect.objectContaining({ id: "control-6-6", startLine: 6, existingCovered: false }),
    ])
    expect(target?.complexity.controlRegions[1]?.anchor?.targetLineText).toBe("    if (value == 0) return 0;")
  })

  it("最低覆盖要求不超过实际可安全插入的控制区域", async () => {
    const source = [
      "static int guarded(int value)",
      "{",
      "    if (value < 0) \\",
      "        return -1;",
      "    if (value == 0) \\",
      "        return 0;",
      "    if (value == 1) \\",
      "        return 1;",
      "    return 2;",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "return 0", "c")

    expect(target?.complexity.controlRegionCount).toBe(3)
    expect(target?.complexity.controlRegions.every((region) => region.anchor === undefined)).toBe(true)
    expect(target?.complexity.minimumInlineComments).toBe(0)
  })

  it("按源码区域去重同一行的 else-if 控制节点", async () => {
    const source = [
      "static int classify(int value)",
      "{",
      "    if (value < 0) {",
      "        return -1;",
      "    } else if (value == 0) {",
      "        return 0;",
      "    }",
      "    return 1;",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "value == 0", "c")
    const starts = target?.complexity.controlRegions.map((region) => region.startLine) ?? []

    expect(new Set(starts).size).toBe(starts.length)
    expect(target?.complexity.controlRegionCount).toBe(2)
  })

  it("批量解析选区内相交的函数并保持源码顺序", async () => {
    const source = [
      "int first(void) { return 1; }",
      "",
      "int second(void) { return 2; }",
      "",
      "int third(void) { return 3; }",
      "",
    ].join("\n")

    const targets = await resolveRange(source, "first", "return 2", "c")

    expect(targets.map((target) => target.startLine)).toEqual([0, 2])
    expect(targets.map((target) => target.anchors[0]?.targetLineText)).toEqual([
      "int first(void) { return 1; }",
      "int second(void) { return 2; }",
    ])
  })

  it("不会把代码尾部的块注释误识别为可替换函数说明", async () => {
    const source = [
      "int state = 1; /* 状态说明。 */",
      "int value(void)",
      "{",
      "    return state;",
      "}",
      "",
    ].join("\n")

    const target = await resolve(source, "return state", "c")

    expect(target?.existingFunctionHeader).toBeUndefined()
  })

  it("拒绝只有声明、匿名 lambda 和语法缺失的函数", async () => {
    const declaration = "int parse_value(const char *text);\n"
    const lambda = [
      "void run(void)",
      "{",
      "    auto callback = [](int value) {",
      "        return value + 1;",
      "    };",
      "    callback(1);",
      "}",
      "",
    ].join("\n")
    const malformed = ["int broken(int value)", "{", "    if (value) {", "        return value;", ""].join("\n")

    expect(await resolve(declaration, "parse_value", "c")).toBeUndefined()
    expect(await resolve(lambda, "value + 1")).toBeUndefined()
    expect(await resolve(malformed, "return value", "c")).toBeUndefined()
  })

  it("拒绝不支持的语言", async () => {
    const target = await resolveFunctionTarget({
      uri: "file:///repo/main.rs",
      filePath: "/repo/main.rs",
      relativePath: "main.rs",
      workspacePath: "/repo",
      languageId: "rust",
      documentVersion: 1,
      documentText: "fn main() {}",
      cursorOffset: 4,
      eol: "\n",
    })

    expect(target).toBeUndefined()
  })
})
