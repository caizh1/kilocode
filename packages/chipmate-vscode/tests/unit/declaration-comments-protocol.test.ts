import { describe, expect, it } from "bun:test"
import {
  buildDeclarationCommentPrompt,
  DECLARATION_COMMENT_SYSTEM_PROMPT,
  parseDeclarationCommentResponse,
} from "../../src/services/declaration-comments/protocol"
import type { DeclarationTarget } from "../../src/services/declaration-comments/types"
import { buildValidatedDeclarationCandidate } from "../../src/services/declaration-comments/validator"

const source = ["struct Packet {", "    unsigned length;", "    unsigned flags;", "};", ""].join("\n")

function target(overrides: Partial<DeclarationTarget> = {}): DeclarationTarget {
  return {
    uri: "file:///repo/main.c",
    filePath: "/repo/main.c",
    relativePath: "main.c",
    workspacePath: "/repo",
    languageId: "c",
    documentVersion: 1,
    documentText: source,
    eol: "\n",
    kind: "struct",
    displayName: "Packet",
    declarationSource: source.slice(0, -1),
    declarationHash: "target",
    documentHash: "document",
    startIndex: 0,
    endIndex: source.length - 1,
    startLine: 0,
    endLine: 3,
    contextBefore: "",
    contextAfter: "",
    headerStyle: "docBlock",
    existingComments: [],
    memberAnchors: [
      {
        id: "M1",
        kind: "field",
        label: "length",
        startLine: 1,
        endLine: 1,
        insertBeforeLine: 1,
        targetLineText: "    unsigned length;",
        indent: "    ",
        existingCovered: false,
      },
      {
        id: "M2",
        kind: "field",
        label: "flags",
        startLine: 2,
        endLine: 2,
        insertBeforeLine: 2,
        targetLineText: "    unsigned flags;",
        indent: "    ",
        existingCovered: false,
      },
    ],
    ...overrides,
  }
}

function response(...blocks: string[]): string {
  return `结论：生成注释\n理解：该结构保存报文长度和控制标志。\n${blocks.join("\n")}`
}

function comment(anchor: string, text: string): string {
  return `<comment anchor="${anchor}">\n${text}\n</comment>`
}

describe("声明注释锚点协议", () => {
  it("只返回 declaration/M 锚点并由插件构造安全候选", async () => {
    const parsed = parseDeclarationCommentResponse(
      response(
        comment("declaration", "/** 保存报文长度与控制标志，供收发路径共享。 */"),
        comment("M1", "// 以字节为单位记录有效负载长度。"),
      ),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = await buildValidatedDeclarationCandidate({ target: target(), ...parsed })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.proposals.map((proposal) => proposal.insertBeforeLine)).toEqual([0, 1])
  })

  it("拒绝未知、重复和已有注释覆盖的成员锚点", async () => {
    expect(
      parseDeclarationCommentResponse(
        response(
          comment("declaration", "/** 报文信息。 */"),
          comment("M1", "// 长度单位为字节。"),
          comment("M1", "// 重复说明。"),
        ),
      ),
    ).toMatchObject({ ok: false })

    const parsed = parseDeclarationCommentResponse(
      response(comment("declaration", "/** 报文信息。 */"), comment("M9", "// 未知成员。")),
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(await buildValidatedDeclarationCandidate({ target: target(), ...parsed })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([expect.stringContaining("未知成员锚点")]),
    })
  })

  it("成员建议数量不是门禁，但每个成员最多两行且总计八行", async () => {
    const onlyHeader = parseDeclarationCommentResponse(response(comment("declaration", "/** 保存报文元数据。 */")))
    if (!onlyHeader.ok) throw new Error(onlyHeader.reason)
    expect((await buildValidatedDeclarationCandidate({ target: target(), ...onlyHeader })).ok).toBe(true)

    const tooLong = parseDeclarationCommentResponse(
      response(
        comment("declaration", "/** 保存报文元数据。 */"),
        comment("M1", "// 第一行说明。\n// 第二行说明。\n// 第三行说明。"),
      ),
    )
    if (!tooLong.ok) throw new Error(tooLong.reason)
    expect(await buildValidatedDeclarationCandidate({ target: target(), ...tooLong })).toMatchObject({ ok: false })
  })

  it("允许在完整多行宏首行之前添加说明，但拒绝在续行内部插入", async () => {
    const macroSource = ["#define UPDATE(v) \\", "    apply(v)", ""].join("\n")
    const parsed = parseDeclarationCommentResponse(
      response(comment("declaration", "/** 对参数求值一次，并把结果交给底层更新路径。 */")),
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    const macroTarget = target({
      documentText: macroSource,
      declarationSource: macroSource.slice(0, -1),
      kind: "function-macro",
      displayName: "UPDATE",
      startIndex: 0,
      endIndex: macroSource.length - 1,
      startLine: 0,
      endLine: 1,
      memberAnchors: [],
    })
    expect((await buildValidatedDeclarationCandidate({ target: macroTarget, ...parsed })).ok).toBe(true)

    const unsafeTarget = target({
      documentText: macroSource,
      startLine: 1,
      endLine: 1,
      memberAnchors: [],
    })
    expect(await buildValidatedDeclarationCandidate({ target: unsafeTarget, ...parsed })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([expect.stringContaining("宏续行内部")]),
    })
  })

  it("修订既有 Doxygen 时保护标签集合、顺序和自定义标签", async () => {
    const old = ["/**", " * @brief 旧说明", " * @custom keep exactly", " */"].join("\n")
    const revisedSource = `${old}\n${source}`
    const revisedTarget = target({
      documentText: revisedSource,
      declarationSource: source.slice(0, -1),
      startIndex: old.length + 1,
      endIndex: revisedSource.length - 1,
      startLine: 4,
      endLine: 7,
      existingHeader: {
        startLine: 0,
        endLine: 3,
        text: old,
        hash: "old",
        style: "docBlock",
        tagContract: [
          { name: "brief", identity: "" },
          { name: "custom", identity: "", rawLine: "@custom keep exactly" },
        ],
      },
      existingComments: [old],
      memberAnchors: [],
    })
    const parsed = parseDeclarationCommentResponse(
      response(comment("declaration", "/**\n * @brief 保存设备报文元数据。\n * @custom keep exactly\n */")),
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    expect((await buildValidatedDeclarationCandidate({ target: revisedTarget, ...parsed })).ok).toBe(true)

    const broken = parseDeclarationCommentResponse(
      response(comment("declaration", "/** @brief 保存设备报文元数据。 */")),
    )
    if (!broken.ok) throw new Error(broken.reason)
    expect(await buildValidatedDeclarationCandidate({ target: revisedTarget, ...broken })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([expect.stringContaining("标签数量变化")]),
    })
  })

  it("Prompt 按声明类型给出选择性成员要求和安全锚点", () => {
    const prompt = buildDeclarationCommentPrompt({ target: target({ kind: "union" }), round: "primary" })
    expect(prompt).toContain("活跃成员、判别条件和共享存储约束")
    expect(prompt).toContain("M1")
    expect(prompt).toContain("建议数量不是硬性要求")
    expect(prompt).not.toContain("function/R1")
  })

  it("Prompt 禁止把标识符、外部标准记忆和实现相关假设当成源码证据", () => {
    const prompt = buildDeclarationCommentPrompt({ target: target(), round: "primary" })
    expect(prompt).toContain("仅凭 NVMe 等外部标准记忆")
    expect(prompt).toContain("不得仅凭字段或类型名称推断用途")
    expect(prompt).toContain("volatile 的访问顺序")
    expect(prompt).toContain("单个成员或单个调用点")
    expect(DECLARATION_COMMENT_SYSTEM_PROMPT).toContain("标识符名称、通用标准记忆和看似合理的硬件语义都不是证据")
  })
})
