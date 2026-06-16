import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { utils, write } from "xlsx"
import { extractDocument, pdftotextPath } from "../../../../src/indexing/documents/extractors"

const dirs: string[] = []

async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "kilo-documents-"))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("Document extractors", () => {
  test("extracts text files with line ranges", async () => {
    const dir = await temp()
    const file = path.join(dir, "notes.md")
    await writeFile(file, "Alpha\nBeta\nGamma")

    const sections = await extractDocument(file)

    expect(sections).toHaveLength(1)
    expect(sections[0]?.kind).toBe("text")
    expect(sections[0]?.text).toContain("Beta")
    expect(sections[0]?.startLine).toBe(1)
    expect(sections[0]?.endLine).toBe(3)
  })

  test("extracts XLSX and ODS sheets with row ranges", async () => {
    const dir = await temp()
    const book = utils.book_new()
    const sheet = utils.aoa_to_sheet([
      ["Name", "Value"],
      ["alpha", 42],
    ])
    utils.book_append_sheet(book, sheet, "Data Sheet")

    const xlsx = path.join(dir, "data.xlsx")
    const ods = path.join(dir, "data.ods")
    await writeFile(xlsx, write(book, { type: "buffer", bookType: "xlsx" }))
    await writeFile(ods, write(book, { type: "buffer", bookType: "ods" }))

    const xlsxSections = await extractDocument(xlsx)
    const odsSections = await extractDocument(ods)

    expect(xlsxSections[0]?.kind).toBe("spreadsheet")
    expect(xlsxSections[0]?.sheet).toBe("Data Sheet")
    expect(xlsxSections[0]?.text).toContain("alpha\t42")
    expect(xlsxSections[0]?.startLine).toBe(1)
    expect(xlsxSections[0]?.endLine).toBe(2)
    expect(odsSections[0]?.kind).toBe("spreadsheet")
    expect(odsSections[0]?.text).toContain("alpha\t42")
  })

  test("prefers bundled pdftotext beside the compiled CLI", async () => {
    const dir = await temp()
    const poppler = path.join(dir, "bin", "poppler")
    const exe = path.join(poppler, "pdftotext.exe")
    await mkdir(poppler, { recursive: true })
    await writeFile(exe, "")

    expect(pdftotextPath({}, path.join(dir, "bin", "kilo.exe"), "win32")).toBe(exe)
  })

  test("uses explicit pdftotext override before bundled paths", () => {
    expect(
      pdftotextPath({ KILO_PDFTOTEXT_PATH: "C:\\tools\\pdftotext.exe" }, "/extension/bin/kilo.exe", "win32"),
    ).toBe("C:\\tools\\pdftotext.exe")
  })
})
