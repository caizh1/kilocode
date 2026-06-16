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
})
