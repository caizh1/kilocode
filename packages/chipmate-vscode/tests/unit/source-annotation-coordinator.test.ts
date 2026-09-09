import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { validateSourceAnnotationSnapshots } from "../../src/services/source-annotations/apply"
import { coordinateSourceAnnotationArtifacts } from "../../src/services/source-annotations/coordinator"
import type { SourceAnnotationArtifact } from "../../src/services/source-annotations/types"

const source = ["struct Packet {", "    unsigned length;", "};", "", "int run(void) { return 0; }", ""].join("\n")

function artifact(overrides: Partial<SourceAnnotationArtifact> = {}): SourceAnnotationArtifact {
  return {
    workflowId: "declaration",
    targetKind: "struct",
    displayName: "Packet",
    uri: "file:///repo/main.c",
    filePath: "/repo/main.c",
    relativePath: "main.c",
    languageId: "c",
    documentVersion: 1,
    documentText: source,
    eol: "\n",
    documentHash: createHash("sha256").update(source).digest("hex"),
    targetHash: createHash("sha256")
      .update(source.slice(0, source.indexOf("\n\n")))
      .digest("hex"),
    targetStartIndex: 0,
    targetEndIndex: source.indexOf("\n\n"),
    targetScope: "syntax-target",
    operations: [
      {
        anchorId: "declaration",
        operation: "insert",
        placement: "target-header",
        insertBeforeLine: 0,
        indent: "",
        commentText: "/** 报文布局。 */",
        targetLineText: "struct Packet {",
      },
    ],
    quality: "complete",
    diagnostics: [],
    providerID: "chipmate",
    modelID: "model",
    rounds: 1,
    ...overrides,
  }
}

describe("源码注释产物协调器", () => {
  it("合并同一快照的函数和声明产物并保持非注释 token 不变", async () => {
    const declaration = artifact()
    const functionArtifact = artifact({
      workflowId: "function",
      targetKind: "function",
      displayName: "run",
      targetStartIndex: source.indexOf("int run"),
      targetEndIndex: source.indexOf("\n", source.indexOf("int run")),
      targetHash: createHash("sha256")
        .update(source.slice(source.indexOf("int run"), source.indexOf("\n", source.indexOf("int run"))))
        .digest("hex"),
      operations: [
        {
          anchorId: "function",
          operation: "insert",
          placement: "target-header",
          insertBeforeLine: 4,
          indent: "",
          commentText: "/** 执行空操作并返回成功。 */",
          targetLineText: "int run(void) { return 0; }",
        },
      ],
    })
    const result = await coordinateSourceAnnotationArtifacts([declaration, functionArtifact])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files).toHaveLength(1)
    expect(result.value.files[0]!.candidateText).toContain("/** 报文布局。 */")
    expect(result.value.files[0]!.candidateText).toContain("/** 执行空操作并返回成功。 */")
  })

  it("拒绝不同快照、目标重叠、重复锚点和编辑冲突", async () => {
    expect(
      await coordinateSourceAnnotationArtifacts([artifact(), artifact({ documentText: `${source} ` })]),
    ).toMatchObject({ ok: false })
    expect(
      await coordinateSourceAnnotationArtifacts([
        artifact(),
        artifact({ displayName: "overlap", targetStartIndex: 2, targetEndIndex: 8 }),
      ]),
    ).toMatchObject({ ok: false })
    expect(
      await coordinateSourceAnnotationArtifacts([
        artifact(),
        artifact({
          displayName: "same-line",
          targetStartIndex: source.length - 1,
          targetEndIndex: source.length,
          operations: [
            {
              anchorId: "other",
              operation: "insert",
              placement: "target-header",
              insertBeforeLine: 0,
              indent: "",
              commentText: "// 冲突。",
              targetLineText: "struct Packet {",
            },
          ],
        }),
      ]),
    ).toMatchObject({ ok: false })
  })

  it("拒绝伪造的文档哈希、目标哈希、越界范围和错误源码锚点", async () => {
    expect(await coordinateSourceAnnotationArtifacts([artifact({ documentHash: "forged" })])).toMatchObject({
      ok: false,
    })
    expect(await coordinateSourceAnnotationArtifacts([artifact({ targetHash: "forged" })])).toMatchObject({ ok: false })
    expect(
      await coordinateSourceAnnotationArtifacts([
        artifact({
          operations: [
            {
              anchorId: "declaration",
              operation: "insert",
              placement: "target-header",
              insertBeforeLine: 0,
              indent: "",
              commentText: "/** 报文布局。 */",
              targetLineText: "伪造源码",
            },
          ],
        }),
      ]),
    ).toMatchObject({ ok: false })
  })

  it("按 URI 分组，为未来多文件原子应用保留稳定结构", async () => {
    const secondSource = "enum State { IDLE, BUSY };\n"
    const second = artifact({
      uri: "file:///repo/state.c",
      filePath: "/repo/state.c",
      relativePath: "state.c",
      documentText: secondSource,
      documentHash: createHash("sha256").update(secondSource).digest("hex"),
      targetEndIndex: secondSource.length - 1,
      targetHash: createHash("sha256").update(secondSource.slice(0, -1)).digest("hex"),
      operations: [
        {
          anchorId: "declaration",
          operation: "insert",
          placement: "target-header",
          insertBeforeLine: 0,
          indent: "",
          commentText: "/** 状态取值。 */",
          targetLineText: "enum State { IDLE, BUSY };",
        },
      ],
    })
    const result = await coordinateSourceAnnotationArtifacts([artifact(), second])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.files.map((file) => file.relativePath).sort()).toEqual(["main.c", "state.c"])
  })

  it("把同一行的文件头和首个目标说明按固定层级合并", async () => {
    const fileHeader = artifact({
      workflowId: "file-header",
      targetKind: "file",
      displayName: "main.c 模块说明",
      targetStartIndex: 0,
      targetEndIndex: source.length,
      targetHash: createHash("sha256").update(source).digest("hex"),
      targetScope: "document",
      operations: [
        {
          anchorId: "file",
          operation: "insert",
          placement: "file-header",
          insertBeforeLine: 0,
          indent: "",
          commentText: "/** 管理报文处理模块。 */",
          targetLineText: "struct Packet {",
        },
      ],
    })
    const result = await coordinateSourceAnnotationArtifacts([fileHeader, artifact()])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files[0]!.operations).toHaveLength(1)
    const candidate = result.value.files[0]!.candidateText
    expect(candidate.indexOf("管理报文处理模块")).toBeLessThan(candidate.indexOf("报文布局"))
    expect(candidate.indexOf("报文布局")).toBeLessThan(candidate.indexOf("struct Packet"))
  })

  it("把模块说明插入与首个目标既有说明替换合成为单一操作", async () => {
    const documented = ["/** 占位说明。 */", ...source.split("\n")].join("\n")
    const base = artifact({
      documentText: documented,
      documentHash: createHash("sha256").update(documented).digest("hex"),
      targetStartIndex: documented.indexOf("struct Packet"),
      targetEndIndex: documented.indexOf("\n\n"),
      targetHash: createHash("sha256")
        .update(documented.slice(documented.indexOf("struct Packet"), documented.indexOf("\n\n")))
        .digest("hex"),
      operations: [
        {
          anchorId: "declaration",
          operation: "replace",
          placement: "target-header",
          insertBeforeLine: 0,
          replaceEndLine: 0,
          indent: "",
          commentText: "/** 报文布局。 */",
          targetLineText: "struct Packet {",
        },
      ],
    })
    const header = artifact({
      ...base,
      workflowId: "file-header",
      targetKind: "file",
      displayName: "main.c 模块说明",
      targetStartIndex: 0,
      targetEndIndex: documented.length,
      targetHash: createHash("sha256").update(documented).digest("hex"),
      targetScope: "document",
      operations: [
        {
          anchorId: "file",
          operation: "insert",
          placement: "file-header",
          insertBeforeLine: 0,
          indent: "",
          commentText: "/** 管理报文处理模块。 */",
          targetLineText: "/** 占位说明。 */",
        },
      ],
    })
    const result = await coordinateSourceAnnotationArtifacts([header, base])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files[0]!.operations).toHaveLength(1)
    expect(result.value.files[0]!.operations[0]).toMatchObject({ operation: "replace", replaceEndLine: 0 })
    expect(result.value.files[0]!.candidateText).not.toContain("占位说明")
  })

  it("已有说明替换使用源码行锚点校验，不会把字符偏移误作行号", async () => {
    const documented = ["int prefix;", "/** 占位说明。 */", ...source.split("\n")].join("\n")
    const targetStart = documented.indexOf("struct Packet")
    const targetEnd = documented.indexOf("\n\n")
    const replacement = artifact({
      documentText: documented,
      documentHash: createHash("sha256").update(documented).digest("hex"),
      targetStartIndex: targetStart,
      targetEndIndex: targetEnd,
      targetHash: createHash("sha256").update(documented.slice(targetStart, targetEnd)).digest("hex"),
      operations: [
        {
          anchorId: "declaration",
          operation: "replace",
          placement: "target-header",
          insertBeforeLine: 1,
          replaceEndLine: 1,
          indent: "",
          commentText: "/** 报文布局。 */",
          targetLineText: "/** 占位说明。 */",
        },
      ],
    })
    const result = await coordinateSourceAnnotationArtifacts([replacement])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const document = {
      uri: { toString: () => replacement.uri },
      version: replacement.documentVersion,
      getText: () => documented,
    }
    expect(validateSourceAnnotationSnapshots(result.value, new Map([[replacement.uri, document as never]]))).toEqual([])
  })

  it("协调器把首行操作移动到 BOM 之后供预览和应用共用", async () => {
    const bomSource = `\uFEFF${source}`
    const targetStart = bomSource.indexOf("struct Packet")
    const targetEnd = bomSource.indexOf("\n\n")
    const result = await coordinateSourceAnnotationArtifacts([
      artifact({
        documentText: bomSource,
        documentHash: createHash("sha256").update(bomSource).digest("hex"),
        targetStartIndex: targetStart,
        targetEndIndex: targetEnd,
        targetHash: createHash("sha256").update(bomSource.slice(targetStart, targetEnd)).digest("hex"),
        operations: [
          {
            anchorId: "declaration",
            operation: "insert",
            placement: "target-header",
            insertBeforeLine: 0,
            indent: "",
            commentText: "/** 报文布局。 */",
            targetLineText: "\uFEFFstruct Packet {",
          },
        ],
      }),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files[0]!.operations[0]!.insertBeforeCharacter).toBe(1)
    expect(result.value.files[0]!.candidateText.startsWith("\uFEFF/** 报文布局。 */")).toBe(true)
  })
})
