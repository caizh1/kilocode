import { describe, expect, it } from "bun:test"
import {
  buildFileHeaderCommentPrompt,
  meaningfulHeader,
  parseFileHeaderCommentResponse,
  resolveFileHeaderTarget,
} from "../../src/services/file-header-comments"
import { buildValidatedFileHeaderCandidate } from "../../src/services/file-header-comments/validator"
import { buildSourceAnnotationDocument } from "../../src/services/source-annotations/coordinator"

function input(source: string, eol: "\n" | "\r\n" = "\n") {
  return {
    uri: "file:///repo/module.c",
    filePath: "/repo/module.c",
    relativePath: "module.c",
    workspacePath: "/repo",
    languageId: "c",
    documentVersion: 3,
    documentText: source,
    eol,
  }
}

describe("文件模块说明目标与协议", () => {
  it("把模块说明放在许可证之后和 include guard 之前", async () => {
    const source = [
      "\uFEFF/* SPDX-License-Identifier: MIT */",
      "",
      "#ifndef MODULE_H",
      "#define MODULE_H",
      "",
      "int run(void);",
      "#endif",
      "",
    ].join("\n")
    const target = await resolveFileHeaderTarget(input(source))
    expect(target?.anchorLine).toBe(2)
    expect(target?.existingHeader).toBeUndefined()
    expect(target?.anchorLineText).toBe("#ifndef MODULE_H")
  })

  it("识别已有 @file 模块说明并保护许可证", async () => {
    const source = [
      "/* Copyright 2026 Example */",
      "",
      "/**",
      " * @file module.c",
      " * @brief 旧模块说明。",
      " */",
      "#include <stdint.h>",
      "int run(void) { return 0; }",
      "",
    ].join("\n")
    const target = await resolveFileHeaderTarget(input(source))
    expect(target?.existingHeader?.startLine).toBe(2)
    expect(target?.existingHeader?.tagContract.map((tag) => tag.name)).toEqual(["file", "brief"])
    expect(target?.existingHeader?.meaningful).toBe(true)
  })

  it("不会把紧邻首个声明的说明误认成模块说明", async () => {
    const source = ["/** 报文状态。 */", "struct Packet { int state; };", ""].join("\n")
    const target = await resolveFileHeaderTarget(input(source))
    expect(target?.existingHeader).toBeUndefined()
    expect(target?.anchorLine).toBe(0)
  })

  it("支持 CRLF、拒绝空文件并识别占位说明", async () => {
    const source = ["/**", " * @brief NONE", " */", "#pragma once", ""].join("\r\n")
    const target = await resolveFileHeaderTarget(input(source, "\r\n"))
    expect(target?.existingHeader?.meaningful).toBe(false)
    expect(await resolveFileHeaderTarget(input("  \n"))).toBeUndefined()
    expect(meaningfulHeader("/** @brief NONE */")).toBe(false)
  })

  it("在文件首行插入模块说明时保持 BOM 位于第一个字节", async () => {
    const source = "\uFEFFint run(void) { return 0; }\n"
    const target = (await resolveFileHeaderTarget(input(source)))!
    const result = await buildValidatedFileHeaderCandidate({
      target,
      summary: "理解模块入口。",
      comment: { anchorId: "file", commentText: "/** 提供模块执行入口。 */" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const candidate = buildSourceAnnotationDocument(source, "\n", [
      {
        anchorId: "file",
        operation: result.value.proposal.operation,
        placement: "file-header",
        insertBeforeLine: result.value.proposal.insertBeforeLine,
        indent: "",
        commentText: result.value.proposal.commentText,
        targetLineText: target.anchorLineText,
      },
    ])
    expect(candidate.startsWith("\uFEFF/** 提供模块执行入口。 */\nint run")).toBe(true)
  })

  it("解析唯一 file 锚点并拒绝额外锚点", () => {
    const parsed = parseFileHeaderCommentResponse(
      [
        "结论：生成注释",
        "理解：该模块管理请求调度。",
        '<comment anchor="file">',
        "/** 管理请求调度及共享队列。 */",
        "</comment>",
      ].join("\n"),
    )
    expect(parsed.ok).toBe(true)
    expect(
      parseFileHeaderCommentResponse('结论：生成注释\n理解：模块。\n<comment anchor="other">// 错误</comment>').ok,
    ).toBe(false)
  })

  it("校验 Doxygen 契约并保持非注释 token 不变", async () => {
    const source = ["/**", " * @file module.c", " * @brief 旧说明。", " */", "int run(void) { return 0; }", ""].join(
      "\n",
    )
    const target = (await resolveFileHeaderTarget(input(source)))!
    const accepted = await buildValidatedFileHeaderCandidate({
      target,
      summary: "理解模块职责。",
      comment: {
        anchorId: "file",
        commentText: "/**\n * @file module.c\n * @brief 管理模块入口并返回执行状态。\n */",
      },
    })
    expect(accepted.ok).toBe(true)
    const rejected = await buildValidatedFileHeaderCandidate({
      target,
      summary: "理解模块职责。",
      comment: { anchorId: "file", commentText: "/** 管理模块入口。 */" },
    })
    expect(rejected.ok).toBe(false)
  })

  it("Prompt 明确使用文件证据且不允许凭名称推断", async () => {
    const target = (await resolveFileHeaderTarget(input("int run(void) { return 0; }\n")))!
    const prompt = buildFileHeaderCommentPrompt({ target, round: "primary" })
    expect(prompt).toContain("当前编辑器快照的顶层证据")
    expect(prompt).toContain("外部标准中存在但仓库内无法证明")
  })
})
