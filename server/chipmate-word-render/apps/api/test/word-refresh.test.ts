import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import JSZip from "jszip"

interface Inspection {
  valid: boolean
  hasToc: boolean
  headingCount: number
  headings: string[]
  titles: string[]
  drawingCount: number
  tocEntryCount: number
  tocPageNumberCount: number
  titleCount: number
  tocEntries: Array<{ text: string; page: number }>
  manifest: Record<string, unknown>
}

interface Verification {
  ok: boolean
  diagnostics: string[]
  inspection: Inspection
}

interface TextQa {
  ok: boolean
  titlePresent: boolean
  firstHeadingPresent: boolean
  sentinelCount: number
  matchedSentinelCount: number
  diagnostics: string[]
}

const require = createRequire(import.meta.url)
const legacy = require("../../../server.js") as {
  inspectWordDocx(bytes: Buffer): Promise<Inspection>
  materializeTocPageNumbers(bytes: Buffer, pages: number[]): Promise<Buffer>
  parsePdfOutlineXml(xml: string): Array<{ page: number; title: string }>
  verifyRefreshedWordDocx(source: Inspection, bytes: Buffer): Promise<Verification>
  wordPdfTextQa(source: Inspection & { text: string }, result: { ok: boolean; stdout?: string; message?: string }): TextQa
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/></w:style>
</w:styles>`

function paragraph(style: string, text: string, page?: number) {
  const suffix = page === undefined ? "" : `<w:r><w:tab/></w:r><w:r><w:t>${page}</w:t></w:r>`
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r>${suffix}</w:p>`
}

function tocParagraph(style: string, text: string, bookmark: string, page = 1) {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:hyperlink w:anchor="${bookmark}"><w:r><w:t>${text}</w:t></w:r></w:hyperlink><w:r><w:tab/></w:r><w:fldSimple w:instr=" PAGEREF ${bookmark} \\h "><w:r><w:t>${page}</w:t></w:r></w:fldSimple></w:p>`
}

async function fixture(
  opts: {
    pages?: boolean
    drawings?: number
    toc?: boolean
    field?: boolean
    simpleField?: boolean
    headings?: boolean
    body?: boolean
    table?: boolean
    pageFields?: boolean
  } = {},
) {
  const toc =
    opts.toc === false || opts.field === false
      ? ""
      : opts.simpleField
        ? '<w:p><w:fldSimple w:instr="TOC \\o &quot;1-3&quot; \\h \\z \\u"><w:r><w:t>Update table of contents</w:t></w:r></w:fldSimple></w:p>'
        : '<w:p><w:r><w:instrText> TOC \\o "1-3" </w:instrText></w:r></w:p>'
  const entries =
    opts.toc === false || opts.headings === false
      ? ""
      : opts.pageFields
        ? [tocParagraph("TOC1", "一、总览", "_KiloToc1"), tocParagraph("TOC2", "1.1 子模块", "_KiloToc2")].join("")
        : [paragraph("TOC1", "一、总览", opts.pages ? 1 : undefined), paragraph("TOC2", "1.1 子模块", opts.pages ? 2 : undefined)].join("")
  const drawings = Array.from({ length: opts.drawings ?? 2 }, () => "<w:p><w:r><w:drawing/></w:r></w:p>").join("")
  const body = opts.body === false ? "" : paragraph("Normal", "关键正文不得在刷新时丢失")
  const table = opts.table === false ? "" : `<w:tbl><w:tr><w:tc>${paragraph("Normal", "表格证据")}</w:tc></w:tr></w:tbl>`
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraph("Title", "中文详细设计")}${toc}${entries}${opts.headings === false ? "" : `${paragraph("Heading1", "一、总览")}${body}${paragraph("Heading2", "1.1 子模块")}${table}`}${drawings}
</w:body></w:document>`
  const zip = new JSZip()
  zip.file("word/document.xml", document)
  zip.file("word/styles.xml", styles)
  return zip.generateAsync({ type: "nodebuffer" })
}

test("Word refresh inspection distinguishes no-TOC documents", async () => {
  const inspected = await legacy.inspectWordDocx(await fixture({ toc: false }))
  assert.equal(inspected.valid, true)
  assert.equal(inspected.hasToc, false)
  assert.equal(inspected.headingCount, 2)
  assert.equal(inspected.drawingCount, 2)
})

test("Word refresh inspection recognizes the fldSimple TOC emitted by Kilo", async () => {
  const inspected = await legacy.inspectWordDocx(await fixture({ simpleField: true }))
  assert.equal(inspected.valid, true)
  assert.equal(inspected.hasToc, true)
  assert.equal(inspected.headingCount, 2)
})

test("Word refresh verification requires preserved semantics and numeric TOC pages", async () => {
  const source = await legacy.inspectWordDocx(await fixture())
  const verified = await legacy.verifyRefreshedWordDocx(source, await fixture({ pages: true }))
  assert.equal(verified.ok, true, verified.diagnostics.join("; "))
  assert.equal(verified.inspection.tocEntryCount, 2)
  assert.equal(verified.inspection.tocPageNumberCount, 2)

  const missingPage = await legacy.verifyRefreshedWordDocx(source, await fixture())
  assert.equal(missingPage.ok, false)
  assert.ok(missingPage.diagnostics.some((item) => item.includes("page-number count")))

  const missingDrawing = await legacy.verifyRefreshedWordDocx(source, await fixture({ pages: true, drawings: 1 }))
  assert.equal(missingDrawing.ok, false)
  assert.ok(missingDrawing.diagnostics.some((item) => item.includes("drawing identity")))

  const missingBody = await legacy.verifyRefreshedWordDocx(source, await fixture({ pages: true, body: false }))
  assert.equal(missingBody.ok, false)
  assert.ok(missingBody.diagnostics.some((item) => item.includes("body paragraph")))

  const missingTable = await legacy.verifyRefreshedWordDocx(source, await fixture({ pages: true, table: false }))
  assert.equal(missingTable.ok, false)
  assert.ok(missingTable.diagnostics.some((item) => item.includes("table geometry")))

  const missingField = await legacy.verifyRefreshedWordDocx(source, await fixture({ pages: true, field: false }))
  assert.equal(missingField.ok, false)
  assert.ok(missingField.diagnostics.some((item) => item.includes("native TOC")))

  const empty = await legacy.inspectWordDocx(await fixture({ headings: false }))
  const vacuous = await legacy.verifyRefreshedWordDocx(empty, await fixture({ headings: false }))
  assert.equal(vacuous.ok, false)
  assert.ok(vacuous.diagnostics.some((item) => item.includes("no Heading")))
})

test("PDF outline fallback materializes exact TOC pages without changing body content", async () => {
  const sourceBytes = await fixture({ pageFields: true })
  const source = await legacy.inspectWordDocx(sourceBytes)
  const outline = legacy.parsePdfOutlineXml(
    '<pdf2xml><outline><item page="7">1 一、总览</item><outline><item page="9">1.1 子模块</item></outline><item page="12">2 输入输出</item></outline></pdf2xml>',
  )
  assert.deepEqual(outline, [
    { page: 7, title: "1 一、总览" },
    { page: 9, title: "1.1 子模块" },
    { page: 12, title: "2 输入输出" },
  ])

  const updatedBytes = await legacy.materializeTocPageNumbers(sourceBytes, outline.slice(0, 2).map((item) => item.page))
  const updated = await legacy.inspectWordDocx(updatedBytes)
  assert.deepEqual(updated.tocEntries.map((item) => item.page), [7, 9])
  const verified = await legacy.verifyRefreshedWordDocx(source, updatedBytes)
  assert.equal(verified.ok, true, verified.diagnostics.join("; "))
})

test("PDF text QA accepts visual line wraps and automatic TOC numbering", () => {
  const source = {
    valid: true,
    hasToc: true,
    headingCount: 1,
    headings: ["阅读路径"],
    titles: ["source/software/GreedyFTL-3.0.0/nvme 详细设计文档"],
    drawingCount: 0,
    tocEntryCount: 1,
    tocPageNumberCount: 1,
    titleCount: 1,
    tocEntries: [{ text: "1 阅读路径", page: 2 }],
    manifest: {
      body: [{ kind: "body", text: "这是用于确认正文没有丢失的足够长文本" }],
      tables: [],
      images: [],
      controls: [],
      headers: [],
      footers: [],
    },
    text: "source/software/GreedyFTL-3.0.0/nvme 详细设计文档\n阅读路径\n这是用于确认正文没有丢失的足够长文本",
  }
  const qa = legacy.wordPdfTextQa(source, {
    ok: true,
    stdout:
      "source/software/GreedyFTL-3.0.0/\nnvme 详细设计文档\f1 阅读路径\n阅读 路径\n这是用于确认正文没有丢失的足够长文本\f",
  })
  assert.equal(qa.ok, true, qa.diagnostics.join("; "))
  assert.equal(qa.titlePresent, true)
  assert.equal(qa.firstHeadingPresent, true)
  assert.equal(qa.matchedSentinelCount, qa.sentinelCount)
})
