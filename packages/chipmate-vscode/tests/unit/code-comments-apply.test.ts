import { describe, expect, it } from "bun:test"
import { validateTargetSnapshot } from "../../src/services/code-comments/apply"
import { resolveTargetDocument } from "../../src/services/code-comments/target-document"
import type { FunctionTarget } from "../../src/services/code-comments/types"

const source = "int value(void) { return 1; }\n"
const target: FunctionTarget = {
  uri: "file:///repo/main.c",
  filePath: "/repo/main.c",
  relativePath: "main.c",
  workspacePath: "/repo",
  languageId: "c",
  documentVersion: 7,
  documentText: source,
  functionSource: source.trimEnd(),
  functionHash: "d04c7f342c4a8885069a454301b75a2f9a958d14c8f27e222ea6d9e4550f2b38",
  startIndex: 0,
  endIndex: source.trimEnd().length,
  startLine: 0,
  endLine: 0,
  contextBefore: "",
  contextAfter: "",
  functionHeaderStyle: "docBlock",
  existingComments: [],
  complexity: {
    lineCount: 1,
    controlRegionCount: 0,
    existingCoveredRegionCount: 0,
    minimumInlineComments: 0,
    controlRegions: [],
  },
  anchors: [{ line: 0, kind: "function", targetLineText: source.trimEnd(), indent: "" }],
  eol: "\n",
}

function document(text: string, version = 7, uri = target.uri) {
  const lines = text.split(/\r?\n/)
  return {
    uri: { toString: () => uri },
    version,
    getText: () => text,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? "" }),
  }
}

describe("高可信注释目标文档恢复与快照校验", () => {
  it("优先复用仍然加载的目标文档", async () => {
    const loaded = document(source)
    let opened = 0
    const result = await resolveTargetDocument(target, {
      textDocuments: [loaded] as never,
      openTextDocument: async () => {
        opened += 1
        return loaded as never
      },
    })

    expect(result).toMatchObject({ status: "ready", reopened: false })
    expect(opened).toBe(0)
  })

  it("源码被 Diff 替换并卸载后自动重新打开", async () => {
    const reopened = document(source, 1)
    const result = await resolveTargetDocument(target, {
      textDocuments: [],
      openTextDocument: async () => reopened as never,
    })

    expect(result).toMatchObject({ status: "ready", reopened: true })
    if (result.status === "ready") expect(validateTargetSnapshot(target, result.document)).toEqual([])
  })

  it("完整文本一致时允许重新打开后的版本号变化", () => {
    expect(validateTargetSnapshot(target, document(source, 1) as never)).toEqual([])
  })

  it("任何文本变化都会拒绝应用，并继续报告函数和锚点变化", () => {
    const changed = "int value(void) { return 2; }\n"
    const reasons = validateTargetSnapshot(target, document(changed, 8) as never)

    expect(reasons).toContain("文档内容在生成期间发生变化")
    expect(reasons).toContain("当前函数源码在生成期间发生变化")
    expect(reasons).toContain("第 1 行注释锚点已变化")
  })

  it("重新打开失败时返回具体原因", async () => {
    const result = await resolveTargetDocument(target, {
      textDocuments: [],
      openTextDocument: async () => {
        throw new Error("文件不存在")
      },
    })

    expect(result).toEqual({ status: "unavailable", reason: "目标文件无法重新打开：文件不存在" })
  })
})
