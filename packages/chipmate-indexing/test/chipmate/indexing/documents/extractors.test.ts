import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { deflateSync } from "node:zlib"
import JSZip from "jszip"
import { utils, write } from "xlsx"
import {
  extractDocument,
  pdftotextPath,
  preflightPdfExtractor,
} from "../../../../src/indexing/documents/extractors"

const dirs: string[] = []
const uml = "@startuml\nclass Controller\nController --> Service\n@enduml"

function chunk(kind: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.byteLength)
  out.writeUInt32BE(data.byteLength, 0)
  out.write(kind, 4, 4, "ascii")
  Buffer.from(data).copy(out, 8)
  return out
}

function plantuml() {
  const payload = Buffer.concat([
    Buffer.from("plantuml\0", "latin1"),
    Buffer.from([1, 0, 0, 0]),
    deflateSync(Buffer.from(`${uml}\n\n1.2026.6`, "utf8")),
  ])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("iTXt", payload),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

async function docx(text: string) {
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  zip.file("word/media/image1.png", plantuml())
  return zip.generateAsync({ type: "uint8array" })
}

function declared(input: Uint8Array, size: number) {
  const bytes = Buffer.from(input)
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue
    const length = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString("utf8")
    if (!/^word\/media\/[^/]+\.png$/i.test(name)) continue
    bytes.writeUInt32LE(size, offset + 24)
    return bytes
  }
  throw new Error("media central directory entry not found")
}

async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "chipmate-documents-"))
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

  test("bounds extracted document text by bytes", async () => {
    const dir = await temp()
    const file = path.join(dir, "large.txt")
    await writeFile(file, "你".repeat(100))

    const sections = await extractDocument(file, 64)

    expect(Buffer.byteLength(sections[0]?.text ?? "")).toBeLessThanOrEqual(64)
    expect(sections[0]?.text).not.toContain("\uFFFD")
  })

  test("reserves DOCX extraction budget for embedded PlantUML source", async () => {
    const dir = await temp()
    const file = path.join(dir, "architecture.docx")
    await writeFile(file, await docx("Long body ".repeat(200)))

    const sections = await extractDocument(file, 256)
    const diagram = sections.find((section) => section.kind === "diagram")

    expect(diagram?.mediaPath).toBe("word/media/image1.png")
    expect(diagram?.text).toContain("Controller --> Service")
    expect(sections.reduce((total, section) => total + Buffer.byteLength(section.text), 0)).toBeLessThanOrEqual(256)
  })

  test("keeps DOCX body text when embedded PNG declarations exceed safety limits", async () => {
    const dir = await temp()
    const file = path.join(dir, "oversized-media.docx")
    await writeFile(file, declared(await docx("Architecture body"), 16 * 1024 * 1024 + 1))

    const sections = await extractDocument(file)

    expect(sections[0]?.text).toContain("Architecture body")
    expect(sections[0]?.text).toContain("Embedded PlantUML extraction failed")
    expect(sections.some((section) => section.kind === "diagram")).toBe(false)
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

  test("rejects Office archives with unsafe declared expansion", async () => {
    const dir = await temp()
    const file = path.join(dir, "bomb.xlsx")
    const name = Buffer.from("xl/sharedStrings.xml")
    const bytes = Buffer.alloc(46 + name.length)
    bytes.writeUInt32LE(0x02014b50, 0)
    bytes.writeUInt32LE(128 * 1024 * 1024, 24)
    bytes.writeUInt16LE(name.length, 28)
    name.copy(bytes, 46)
    await writeFile(file, bytes)

    expect(extractDocument(file, 1024 * 1024)).rejects.toThrow("extraction safety limit")
  })

  test("prefers bundled pdftotext beside the compiled CLI", async () => {
    const dir = await temp()
    const poppler = path.join(dir, "bin", "poppler")
    const exe = path.join(poppler, "pdftotext.exe")
    await mkdir(poppler, { recursive: true })
    await writeFile(exe, "")

    expect(pdftotextPath({}, path.join(dir, "bin", "chipmate.exe"), "win32")).toBe(exe)
  })

  test("uses explicit pdftotext override before bundled paths", () => {
    expect(pdftotextPath({ CHIPMATE_PDFTOTEXT_PATH: "C:\\tools\\pdftotext.exe" }, "/extension/bin/chipmate.exe", "win32")).toBe(
      "C:\\tools\\pdftotext.exe",
    )
  })

  if (process.platform !== "win32") {
    test("preflights the selected PDF extractor through a Chinese path containing spaces", async () => {
      const dir = await temp()
      const exe = path.join(dir, "pdftotext")
      const before = process.env.CHIPMATE_PDFTOTEXT_PATH
      try {
        await writeFile(
          exe,
          "#!/bin/sh\ncase \"$2\" in *'中文 路径.pdf') printf 'CHIPMATE_PDF_PREFLIGHT_OK\\f';; *) exit 17;; esac\n",
        )
        await chmod(exe, 0o755)
        process.env.CHIPMATE_PDFTOTEXT_PATH = exe

        await expect(preflightPdfExtractor(path.join(dir, "缓存 空间"))).resolves.toBeUndefined()
      } finally {
        if (before === undefined) delete process.env.CHIPMATE_PDFTOTEXT_PATH
        else process.env.CHIPMATE_PDFTOTEXT_PATH = before
      }
    })

    test("preserves PDF preflight exit details while keeping an empty code 53 unknown", async () => {
      const dir = await temp()
      const exe = path.join(dir, "pdftotext")
      const before = process.env.CHIPMATE_PDFTOTEXT_PATH
      try {
        await writeFile(exe, "#!/bin/sh\nexit 53\n")
        await chmod(exe, 0o755)
        process.env.CHIPMATE_PDFTOTEXT_PATH = exe

        const failure = await preflightPdfExtractor(path.join(dir, "缓存 空间")).catch((err) => err)
        expect(failure).toMatchObject({ category: "extractor-runtime" })
        expect(failure).toBeInstanceOf(Error)
        expect((failure as Error).message).toContain("exitCode=53; signal=none; stderr=(empty)")
      } finally {
        if (before === undefined) delete process.env.CHIPMATE_PDFTOTEXT_PATH
        else process.env.CHIPMATE_PDFTOTEXT_PATH = before
      }
    })
  }
})
