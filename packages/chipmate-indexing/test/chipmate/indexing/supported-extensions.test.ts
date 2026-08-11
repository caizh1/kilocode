import { describe, expect, test } from "bun:test"
import {
  parserExtensions,
  resolveFileExtensions,
  scannerExtensions,
} from "../../../src/indexing/shared/supported-extensions"

describe("Code RAG 文件扩展名", () => {
  test("默认仅在解析层保留 Markdown，不交给代码索引扫描器", () => {
    expect(parserExtensions).toContain(".md")
    expect(parserExtensions).toContain(".markdown")
    expect(scannerExtensions).not.toContain(".md")
    expect(scannerExtensions).not.toContain(".markdown")
  })

  test("显式配置也不能把 Markdown 加回代码索引", () => {
    expect(resolveFileExtensions(["TS", ".md", "markdown"])).toEqual([".ts"])
    expect(resolveFileExtensions([".md", ".markdown"])).toEqual([])
  })
})
