import { describe, expect, it } from "bun:test"
import { resolveFunctionTarget, resolveFunctionTargetsInRange } from "../../src/services/code-comments/function-target"

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
