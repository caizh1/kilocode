import { describe, expect, test } from "bun:test"
import path from "path"
import { chunkDocument } from "../../../../src/indexing/documents/chunker"

const root = path.resolve("/tmp", "workspace")

describe("Document chunker", () => {
  test("adds line range refs for text chunks", () => {
    const chunks = chunkDocument(
      {
        filePath: path.join(root, "docs", "manual.md"),
        text: "Alpha\nBeta\nGamma",
        kind: "text",
        startLine: 10,
        endLine: 12,
      },
      root,
      8,
      0,
    )

    expect(chunks.map((item) => item.sourceRef)).toEqual([
      path.join("docs", "manual.md") + ":10-10",
      path.join("docs", "manual.md") + ":11-11",
      path.join("docs", "manual.md") + ":12-12",
    ])
  })

  test("adds page and sheet refs for binary document extracts", () => {
    const pdf = chunkDocument(
      {
        filePath: path.join(root, "guide.pdf"),
        text: "Page text",
        kind: "pdf",
        page: 3,
        startLine: 3,
        endLine: 3,
      },
      root,
      1200,
      0,
    )
    const sheet = chunkDocument(
      {
        filePath: path.join(root, "tables", "book.xlsx"),
        text: "Name\tValue\nalpha\t42",
        kind: "spreadsheet",
        sheet: "Data Sheet",
        startLine: 2,
        endLine: 4,
      },
      root,
      1200,
      0,
    )

    expect(pdf[0]?.sourceRef).toBe("guide.pdf#page=3")
    expect(sheet[0]?.sourceRef).toBe(path.join("tables", "book.xlsx") + "#sheet=Data%20Sheet rows=2-4")
  })

  test("adds media refs for embedded diagram extracts", () => {
    const chunks = chunkDocument(
      {
        filePath: path.join(root, "design.docx"),
        text: "@startuml\nAlice -> Bob\n@enduml",
        kind: "diagram",
        mediaPath: "word/media/image2.png",
        startLine: 1,
        endLine: 3,
      },
      root,
      1200,
      0,
    )

    expect(chunks[0]?.sourceRef).toBe("design.docx#media=word/media/image2.png")
  })

  test("splits an oversized single line without shrinking ordinary chunks", () => {
    const text = `${"甲".repeat(900)}。${"乙".repeat(1900)}结束`
    const chunks = chunkDocument(
      {
        filePath: path.join(root, "长段落.md"),
        text,
        kind: "text",
        startLine: 7,
        endLine: 7,
      },
      root,
      1200,
      200,
    )

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every((item) => item.content.length <= 1200)).toBe(true)
    expect(chunks.every((item) => item.startLine === 7 && item.endLine === 7)).toBe(true)
    expect(chunks.every((item) => item.sourceRef.endsWith(":7-7"))).toBe(true)
    expect(chunks[0]?.content.endsWith("。")).toBe(true)
    expect(chunks.at(-1)?.content.endsWith("结束")).toBe(true)
    expect(chunks[1]?.content.startsWith("甲")).toBe(true)
  })

  test("does not split Unicode surrogate pairs at hard boundaries", () => {
    const chunks = chunkDocument(
      {
        filePath: path.join(root, "emoji.txt"),
        text: "😀".repeat(400),
        kind: "text",
        startLine: 1,
        endLine: 1,
      },
      root,
      101,
      20,
    )

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((item) => item.content.length <= 101)).toBe(true)
    expect(
      chunks.every((item) => {
        const first = item.content.charCodeAt(0)
        const last = item.content.charCodeAt(item.content.length - 1)
        return !(first >= 0xdc00 && first <= 0xdfff) && !(last >= 0xd800 && last <= 0xdbff)
      }),
    ).toBe(true)
  })

  test("always advances when a configured character limit is smaller than one Unicode scalar", () => {
    const chunks = chunkDocument(
      {
        filePath: path.join(root, "tiny-limit.txt"),
        text: "😀😀",
        kind: "text",
        startLine: 1,
        endLine: 1,
      },
      root,
      1,
      0,
    )

    expect(chunks.map((item) => item.content)).toEqual(["😀", "😀"])
  })
})
