import { describe, expect, it } from "bun:test"
import {
  resolveDeclarationTarget,
  resolveDeclarationTargetsInRange,
} from "../../src/services/declaration-comments/target"

function resolve(source: string, marker: string, languageId: "c" | "cpp" = "c") {
  return resolveDeclarationTarget({
    uri: `file:///repo/main.${languageId}`,
    filePath: `/repo/main.${languageId}`,
    relativePath: `main.${languageId}`,
    workspacePath: "/repo",
    languageId,
    documentVersion: 3,
    documentText: source,
    cursorOffset: source.indexOf(marker),
    eol: "\n",
  })
}

function resolveRange(source: string, start = 0, end = source.length) {
  return resolveDeclarationTargetsInRange({
    uri: "file:///repo/main.c",
    filePath: "/repo/main.c",
    relativePath: "main.c",
    workspacePath: "/repo",
    languageId: "c",
    documentVersion: 3,
    documentText: source,
    selectionStartOffset: start,
    selectionEndOffset: end,
    eol: "\n",
  })
}

describe("C/C++ 声明注释目标定位", () => {
  it("识别 struct、union 和 enum 定义及其直接成员", async () => {
    const source = [
      "struct Packet {",
      "    unsigned length;",
      "    union {",
      "        unsigned raw;",
      "        float value;",
      "    } payload;",
      "};",
      "",
      "enum State { STATE_IDLE, STATE_BUSY, STATE_END };",
    ].join("\n")
    const structure = await resolve(source, "length")
    const enumeration = await resolve(source, "STATE_BUSY")

    expect(structure?.kind).toBe("struct")
    expect(structure?.displayName).toBe("Packet")
    expect(structure?.memberAnchors.map((anchor) => anchor.label)).toEqual(["length", "payload"])
    expect(enumeration?.kind).toBe("enum")
    expect(enumeration?.memberAnchors).toHaveLength(0)
  })

  it("把 typedef 聚合归一为最外层单一目标", async () => {
    const source = [
      "typedef struct {",
      "    unsigned id;",
      "    union { unsigned raw; float value; } payload;",
      "} Packet, *PacketPtr;",
    ].join("\n")
    const target = await resolve(source, "raw")
    const targets = await resolveRange(source)

    expect(target?.kind).toBe("struct")
    expect(target?.startLine).toBe(0)
    expect(target?.declarationSource).toContain("PacketPtr")
    expect(targets).toHaveLength(1)
  })

  it("支持普通 typedef、全局变量声明组和命名空间变量", async () => {
    const source = [
      "typedef unsigned long sector_t;",
      "static unsigned request_count, error_count;",
      "namespace device {",
      "unsigned status_word = 0;",
      "}",
    ].join("\n")
    expect((await resolve(source, "sector_t"))?.kind).toBe("typedef")
    expect((await resolve(source, "request_count"))?.kind).toBe("global-variable")
    expect((await resolve(source, "status_word", "cpp"))?.kind).toBe("global-variable")
  })

  it("支持文件级函数指针变量和 extern C 全局变量，但仍排除函数声明", async () => {
    const source = ["void (*global_callback)(int);", 'extern "C" int shared_state;', "int execute(int value);"].join(
      "\n",
    )
    expect((await resolve(source, "global_callback", "cpp"))?.kind).toBe("global-variable")
    expect((await resolve(source, "shared_state", "cpp"))?.kind).toBe("global-variable")
    expect(await resolve(source, "execute", "cpp")).toBeUndefined()
  })

  it("支持对象宏和函数宏，并把完整续行宏作为一个目标", async () => {
    const source = ["#define PAGE_SIZE 4096U", "#define FIELD_MASK(width) \\", "    ((1U << (width)) - 1U)"].join("\n")
    const objectMacro = await resolve(source, "PAGE_SIZE")
    const functionMacro = await resolve(source, "FIELD_MASK")

    expect(objectMacro?.kind).toBe("object-macro")
    expect(functionMacro?.kind).toBe("function-macro")
    expect(functionMacro?.startLine).toBe(1)
    expect(functionMacro?.endLine).toBe(2)
    expect(functionMacro?.memberAnchors).toEqual([])
  })

  it("排除函数声明、局部变量、前向类型、函数内宏和 C++ using", async () => {
    const source = [
      "struct Forward;",
      "int execute(int value);",
      "using Count = unsigned;",
      "void run(void)",
      "{",
      "    unsigned local = 0;",
      "#define LOCAL_MASK 3U",
      "}",
    ].join("\n")
    expect(await resolve(source, "Forward", "cpp")).toBeUndefined()
    expect(await resolve(source, "execute", "cpp")).toBeUndefined()
    expect(await resolve(source, "Count", "cpp")).toBeUndefined()
    expect(await resolve(source, "local", "cpp")).toBeUndefined()
    expect(await resolve(source, "LOCAL_MASK", "cpp")).toBeUndefined()
  })

  it("支持函数内的局部类型定义，但仍拒绝局部变量", async () => {
    const source = [
      "void run(void)",
      "{",
      "    typedef struct {",
      "        unsigned value;",
      "    } LocalState;",
      "    unsigned local = 0;",
      "}",
    ].join("\n")
    expect((await resolve(source, "LocalState"))?.kind).toBe("struct")
    expect(await resolve(source, "local =")).toBeUndefined()
  })

  it("不会把文件许可证误当成可修订的声明说明", async () => {
    const source = ["/* SPDX-License-Identifier: MIT */", "typedef unsigned count_t;"].join("\n")
    expect((await resolve(source, "count_t"))?.existingHeader).toBeUndefined()
  })

  it("识别既有说明并标记已有成员注释覆盖", async () => {
    const source = [
      "/**",
      " * @brief 设备状态。",
      " * @note 保持 ABI。",
      " */",
      "struct Device {",
      "    // 单位为扇区。",
      "    unsigned capacity;",
      "    unsigned flags; /* 位标志。 */",
      "};",
    ].join("\n")
    const target = await resolve(source, "flags")

    expect(target?.existingHeader?.tagContract.map((tag) => tag.name)).toEqual(["brief", "note"])
    expect(target?.memberAnchors.map((anchor) => anchor.existingCovered)).toEqual([true, true])
  })
})
