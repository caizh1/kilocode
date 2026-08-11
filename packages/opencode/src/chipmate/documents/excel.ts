import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js"
import { read, utils } from "xlsx"
import { Instance } from "@/chipmate/instance"
import { declareArtifact } from "@/chipmate/documents/artifacts"

export type ExcelCell = string | number | boolean | null

export type ExcelSheetSpec = {
  name: string
  headers: readonly string[]
  rows: readonly (readonly ExcelCell[])[]
}

export type CreateExcelWorkbookSpec = {
  title: string
  outputFile?: string
  sheets: readonly ExcelSheetSpec[]
}

export type CreatedExcelWorkbook = {
  path: string
  artifactDir: string
  manifestPath: string
  sheetCount: number
  rowCount: number
  cellCount: number
  sizeBytes: number
  sha256: string
  warnings: string[]
}

type NormalizedSheet = {
  name: string
  headers: string[]
  rows: ExcelCell[][]
  widths: number[]
}

type NormalizedWorkbook = {
  title: string
  outputFile: string
  sheets: NormalizedSheet[]
  rowCount: number
  cellCount: number
  warnings: string[]
}

const MAX_SHEETS = 10
const MAX_COLUMNS = 50
const MAX_ROWS_PER_SHEET = 5_000
const MAX_CELLS = 100_000
const MAX_CELL_TEXT = 32_767
const MIN_COLUMN_WIDTH = 10
const MAX_COLUMN_WIDTH = 40

export async function createExcelWorkbook(spec: CreateExcelWorkbookSpec): Promise<CreatedExcelWorkbook> {
  const ctx = Instance.current
  return Instance.restore(ctx, () => createExcelWorkbookWithin(spec))
}

async function createExcelWorkbookWithin(spec: CreateExcelWorkbookSpec): Promise<CreatedExcelWorkbook> {
  const workbook = normalizeWorkbook(spec)
  const bytes = await buildWorkbook(workbook)
  verifyWorkbook(bytes, workbook)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const artifact = await declareArtifact({
    kind: "excel-workbook",
    title: workbook.title,
    taskSlug: workbook.title,
    primaryFile: workbook.outputFile,
    warnings: workbook.warnings,
    qualityStatus: workbook.warnings.length ? "warning" : "ok",
  })
  const root = path.join(Instance.directory, artifact.artifactDir)
  const output = path.join(root, workbook.outputFile)
  const stage = path.join(root, `.${workbook.outputFile}.${process.pid}.${Date.now()}.tmp`)
  await fs.mkdir(root, { recursive: true })

  try {
    await fs.writeFile(stage, bytes)
    await fs.rename(stage, output)
    const written = await fs.readFile(output)
    const writtenHash = createHash("sha256").update(written).digest("hex")
    if (written.byteLength !== bytes.byteLength || writtenHash !== sha256) {
      throw new Error("Excel 文件写入后的长度或 SHA-256 校验不一致")
    }
  } catch (err) {
    await fs.rm(stage, { force: true }).catch((cleanupError) => {
      console.warn("[excel-workbook] 清理临时文件失败", cleanupError)
    })
    await declareArtifact({
      kind: "excel-workbook",
      title: workbook.title,
      artifactDir: artifact.artifactDir,
      primaryFile: workbook.outputFile,
      warnings: [`Excel 文件写入失败：${errorMessage(err)}`],
      qualityStatus: "failed",
    })
    throw err
  }

  return {
    path: portable(path.relative(Instance.directory, output)),
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
    sheetCount: workbook.sheets.length,
    rowCount: workbook.rowCount,
    cellCount: workbook.cellCount,
    sizeBytes: bytes.byteLength,
    sha256,
    warnings: workbook.warnings,
  }
}

async function buildWorkbook(workbook: NormalizedWorkbook): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add("[Content_Types].xml", new TextReader(contentTypesXml(workbook.sheets.length)))
  await writer.add("_rels/.rels", new TextReader(packageRelationshipsXml()))
  await writer.add("docProps/core.xml", new TextReader(corePropertiesXml(workbook.title)))
  await writer.add("docProps/app.xml", new TextReader(appPropertiesXml()))
  await writer.add("xl/workbook.xml", new TextReader(workbookXml(workbook.sheets)))
  await writer.add("xl/_rels/workbook.xml.rels", new TextReader(workbookRelationshipsXml(workbook.sheets.length)))
  await writer.add("xl/styles.xml", new TextReader(stylesXml()))
  for (const [index, sheet] of workbook.sheets.entries()) {
    await writer.add(`xl/worksheets/sheet${index + 1}.xml`, new TextReader(worksheetXml(sheet)))
  }
  return writer.close()
}

function verifyWorkbook(bytes: Uint8Array, expected: NormalizedWorkbook): void {
  const workbook = read(bytes, { type: "array", raw: true, cellDates: false })
  const expectedNames = expected.sheets.map((sheet) => sheet.name)
  if (JSON.stringify(workbook.SheetNames) !== JSON.stringify(expectedNames)) {
    throw new Error("Excel 回读校验失败：工作表名称或顺序不一致")
  }

  for (const expectedSheet of expected.sheets) {
    const sheet = workbook.Sheets[expectedSheet.name]
    if (!sheet) throw new Error(`Excel 回读校验失败：缺少工作表 ${expectedSheet.name}`)
    const actual = utils.sheet_to_json<ExcelCell[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
      range: `A1:${columnName(expectedSheet.headers.length)}${expectedSheet.rows.length + 1}`,
    })
    const rows = [expectedSheet.headers, ...expectedSheet.rows]
    if (actual.length !== rows.length) {
      throw new Error(`Excel 回读校验失败：工作表 ${expectedSheet.name} 的行数不一致`)
    }
    for (const [rowIndex, expectedRow] of rows.entries()) {
      const actualRow = Array.from(
        { length: expectedSheet.headers.length },
        (_, index) => actual[rowIndex]?.[index] ?? null,
      )
      for (const [columnIndex, expectedCell] of expectedRow.entries()) {
        if (actualRow[columnIndex] !== expectedCell) {
          throw new Error(
            `Excel 回读校验失败：工作表 ${expectedSheet.name} 单元格 ${columnName(columnIndex + 1)}${rowIndex + 1} 不一致`,
          )
        }
      }
    }
  }
}

function normalizeWorkbook(spec: CreateExcelWorkbookSpec): NormalizedWorkbook {
  const title = normalizeRequiredText(spec.title, "工作簿标题")
  if (spec.sheets.length === 0) throw new Error("Excel 工作簿至少需要一个工作表")
  if (spec.sheets.length > MAX_SHEETS) throw new Error(`Excel 工作簿最多支持 ${MAX_SHEETS} 个工作表`)

  const names = new Set<string>()
  const warnings: string[] = []
  const sheets = spec.sheets.map((sheet, index) => {
    if (sheet.headers.length === 0) throw new Error(`工作表 ${index + 1} 至少需要一列表头`)
    if (sheet.headers.length > MAX_COLUMNS) {
      throw new Error(`工作表 ${index + 1} 最多支持 ${MAX_COLUMNS} 列`)
    }
    if (sheet.rows.length > MAX_ROWS_PER_SHEET) {
      throw new Error(`工作表 ${index + 1} 最多支持 ${MAX_ROWS_PER_SHEET} 行数据`)
    }

    const originalName = sheet.name.trim() || `Sheet${index + 1}`
    const name = uniqueSheetName(originalName, names)
    if (name !== originalName) warnings.push(`工作表名称“${originalName}”已规范为“${name}”`)
    names.add(name.toLocaleLowerCase("en-US"))
    const headers = sheet.headers.map((header, column) =>
      normalizeRequiredText(header, `工作表 ${name} 的第 ${column + 1} 列表头`),
    )
    const rows = sheet.rows.map((row, rowIndex) => {
      if (row.length !== headers.length) {
        throw new Error(
          `工作表 ${name} 第 ${rowIndex + 1} 行包含 ${row.length} 列，必须与表头 ${headers.length} 列一致`,
        )
      }
      return row.map((cell, columnIndex) => normalizeCell(cell, name, rowIndex, columnIndex))
    })
    const widths = headers.map((header, column) =>
      clamp(
        Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[column]))) + 2,
        MIN_COLUMN_WIDTH,
        MAX_COLUMN_WIDTH,
      ),
    )
    return { name, headers, rows, widths }
  })
  const cellCount = sheets.reduce((total, sheet) => total + sheet.headers.length * (sheet.rows.length + 1), 0)
  if (cellCount > MAX_CELLS) throw new Error(`Excel 工作簿最多支持 ${MAX_CELLS} 个单元格`)

  return {
    title,
    outputFile: safeXlsxName(spec.outputFile ?? title),
    sheets,
    rowCount: sheets.reduce((total, sheet) => total + sheet.rows.length, 0),
    cellCount,
    warnings,
  }
}

function normalizeRequiredText(input: string, label: string): string {
  const value = normalizeText(input).trim()
  if (!value) throw new Error(`${label}不能为空`)
  if (value.length > MAX_CELL_TEXT) throw new Error(`${label}超过 Excel 单元格 ${MAX_CELL_TEXT} 字符限制`)
  return value
}

function normalizeCell(input: ExcelCell, sheet: string, row: number, column: number): ExcelCell {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new Error(`工作表 ${sheet} 单元格 ${columnName(column + 1)}${row + 2} 必须是有限数字`)
    }
    return Object.is(input, -0) ? 0 : input
  }
  if (typeof input !== "string") return input
  const value = normalizeText(input)
  if (value.length > MAX_CELL_TEXT) {
    throw new Error(`工作表 ${sheet} 单元格 ${columnName(column + 1)}${row + 2} 超过 ${MAX_CELL_TEXT} 字符限制`)
  }
  return value
}

function uniqueSheetName(input: string, used: Set<string>): string {
  const cleaned = normalizeText(input)
    .replace(/[\\:*?/]/g, "_")
    .replaceAll("[", "_")
    .replaceAll("]", "_")
    .replace(/^'+|'+$/g, "")
    .trim()
  const base = truncateText(cleaned || "Sheet", 31)
  if (!used.has(base.toLocaleLowerCase("en-US"))) return base
  const suffix = Array.from({ length: MAX_SHEETS - 1 }, (_, index) => ` (${index + 2})`).find((candidate) => {
    const name = `${truncateText(base, 31 - candidate.length)}${candidate}`
    return !used.has(name.toLocaleLowerCase("en-US"))
  })
  if (!suffix) throw new Error(`无法为重复工作表名称“${input}”生成唯一名称`)
  return `${truncateText(base, 31 - suffix.length)}${suffix}`
}

function safeXlsxName(input: string): string {
  const value = normalizeText(input).trim()
  if (/[\\/]/.test(value)) throw new Error("outputFile 只能是文件名，不能包含目录")
  const withoutExtension = value.replace(/\.xlsx$/i, "")
  const cleaned = withoutExtension
    .replace(/[<>:"|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
  const name = truncateText(cleaned || "workbook", 120)
  return `${name}.xlsx`
}

function worksheetXml(sheet: NormalizedSheet): string {
  const lastColumn = columnName(sheet.headers.length)
  const lastRow = sheet.rows.length + 1
  const columns = sheet.widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("")
  const header = `<row r="1" ht="24" customHeight="1">${sheet.headers
    .map((cell, index) => stringCell(`${columnName(index + 1)}1`, cell, 1))
    .join("")}</row>`
  const body = sheet.rows
    .map((row, rowIndex) => {
      const number = rowIndex + 2
      const style = rowIndex % 2 === 0 ? 2 : 3
      const height = rowHeight(row, sheet.widths)
      const heightAttrs = height > 20 ? ` ht="${height}" customHeight="1"` : ""
      const cells = row.map((cell, column) => cellXml(`${columnName(column + 1)}${number}`, cell, style)).join("")
      return `<row r="${number}"${heightAttrs}>${cells}</row>`
    })
    .join("")
  const orientation = sheet.headers.length > 8 ? "landscape" : "portrait"
  return xml(`
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${columns}</cols>
  <sheetData>${header}${body}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="${orientation}" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`)
}

function cellXml(reference: string, value: ExcelCell, style: number): string {
  if (value === null) return `<c r="${reference}" s="${style}"/>`
  if (typeof value === "string") return stringCell(reference, value, style)
  if (typeof value === "boolean") return `<c r="${reference}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`
  return `<c r="${reference}" s="${style}"><v>${value}</v></c>`
}

function stringCell(reference: string, value: string, style: number): string {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function rowHeight(row: ExcelCell[], widths: number[]): number {
  const lines = row.reduce((maximum: number, cell, index) => {
    if (typeof cell !== "string" || !cell) return maximum
    const explicit = cell.split("\n")
    const wrapped = explicit.reduce(
      (total, line) => total + Math.max(1, Math.ceil(displayWidth(line) / widths[index])),
      0,
    )
    return Math.max(maximum, wrapped)
  }, 1)
  return clamp(lines * 18, 20, 80)
}

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("")
  return xml(`
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheets}
</Types>`)
}

function packageRelationshipsXml(): string {
  return xml(`
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`)
}

function workbookRelationshipsXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("")
  return xml(`
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`)
}

function workbookXml(sheets: NormalizedSheet[]): string {
  const items = sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("")
  return xml(`
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets>${items}</sheets>
  <calcPr calcId="0"/>
</workbook>`)
}

function stylesXml(): string {
  return xml(`
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color theme="1"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD6DEE8"/></left><right style="thin"><color rgb="FFD6DEE8"/></right><top style="thin"><color rgb="FFD6DEE8"/></top><bottom style="thin"><color rgb="FFD6DEE8"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`)
}

function corePropertiesXml(title: string): string {
  const now = new Date().toISOString()
  return xml(`
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>ChipMate</dc:creator>
  <cp:lastModifiedBy>ChipMate</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`)
}

function appPropertiesXml(): string {
  return xml(`
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>ChipMate</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <Company>ChipMate</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>1.0</AppVersion>
</Properties>`)
}

function displayWidth(input: ExcelCell | undefined): number {
  if (input === null || input === undefined) return 0
  const text = typeof input === "string" ? input : String(input)
  return Math.max(
    0,
    ...text
      .split("\n")
      .map((line) => Array.from(line).reduce((width, character) => width + (wideCharacter(character) ? 2 : 1), 0)),
  )
}

function wideCharacter(input: string): boolean {
  return /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/u.test(
    input,
  )
}

function columnName(input: number): string {
  if (!Number.isInteger(input) || input < 1) throw new Error(`无效的 Excel 列索引：${input}`)
  const letters: string[] = []
  for (let value = input; value > 0; value = Math.floor((value - 1) / 26)) {
    letters.unshift(String.fromCharCode(65 + ((value - 1) % 26)))
  }
  return letters.join("")
}

function normalizeText(input: string): string {
  return input.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "�")
}

function truncateText(input: string, limit: number): string {
  return Array.from(input).slice(0, limit).join("")
}

function escapeXml(input: string): string {
  return normalizeText(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function xml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body.trim()}`
}

function clamp(input: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, input))
}

function portable(input: string): string {
  return input.split(path.sep).join("/")
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return JSON.stringify(err) ?? String(err)
}
