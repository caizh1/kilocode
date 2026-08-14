import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import mammoth from "mammoth"
import { read, utils, type CellObject, type WorkBook } from "xlsx"
import { extractDocxPlantUml } from "./plantuml"
import type { DocumentSection } from "./types"
import { classifyDocumentIssue, DocumentExtractionError, sanitizeDocumentDiagnostic } from "./diagnostics"

const sheetRows = 50_000
const archiveFloor = 64 * 1024 * 1024
const archiveCeiling = 256 * 1024 * 1024

export async function extractDocument(
  filePath: string,
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<DocumentSection[]> {
  const ext = path.extname(filePath).toLowerCase()
  const max = Math.max(1, Math.floor(maxBytes))
  if (ext === ".pdf") return pdf(filePath, max)
  if (ext === ".docx") return docx(filePath, max)
  if (ext === ".xlsx" || ext === ".ods") return sheet(filePath, max)
  return text(filePath, max)
}

async function text(filePath: string, max: number): Promise<DocumentSection[]> {
  const raw = limit(await readFile(filePath, "utf8"), max)
  return [
    {
      filePath,
      text: raw,
      kind: "text",
      startLine: 1,
      endLine: Math.max(1, raw.split(/\r?\n/).length),
    },
  ]
}

async function docx(filePath: string, max: number): Promise<DocumentSection[]> {
  const bytes = await readFile(filePath)
  guardArchive(bytes, max)
  const result = await mammoth.extractRawText({ buffer: bytes })
  const messages: Array<{ type?: string; message?: string }> = result.messages ?? []
  const warnings = messages.filter((item) => item.type === "warning").map((item) => item.message ?? "")
  const diagrams = await extractDocxPlantUml(bytes, {
    maxTotalSourceBytes: Math.min(512 * 1024, Math.max(1, Math.floor(max * 0.4))),
  }).catch((err: unknown) => ({
    diagrams: [],
    warnings: [`Embedded PlantUML extraction failed: ${err instanceof Error ? err.message : String(err)}`],
    truncated: true,
  }))
  warnings.push(...diagrams.warnings)
  if (diagrams.truncated) warnings.push("Embedded PlantUML extraction was truncated by safety limits.")
  const candidates = diagrams.diagrams.map((diagram) => {
    const text = `[Embedded PlantUML diagram: ${diagram.mediaPath}]\n${diagram.source}`
    return {
      filePath,
      text,
      kind: "diagram" as const,
      mediaPath: diagram.mediaPath,
      startLine: 1,
      endLine: Math.max(1, text.split(/\r?\n/).length),
    }
  })
  const items: DocumentSection[] = []
  let used = 0
  for (const item of candidates) {
    const bytes = Buffer.byteLength(item.text, "utf8")
    if (used + bytes > max) {
      warnings.push(`${item.mediaPath}: PlantUML source exceeds the extracted document byte budget.`)
      continue
    }
    used += bytes
    items.push(item)
  }
  const note = warnings.length > 0 ? `\n\nDOCX extraction warnings: ${warnings.join("; ")}` : ""
  const reserved = items.reduce((total, item) => total + Buffer.byteLength(item.text, "utf8"), 0)
  const value = limit(`${result.value}${note}`, Math.max(0, max - Math.min(max, reserved)))
  return [
    ...(value
      ? [
          {
            filePath,
            text: value,
            kind: "text" as const,
            startLine: 1,
            endLine: Math.max(1, value.split(/\r?\n/).length),
          },
        ]
      : []),
    ...items,
  ]
}

async function pdf(filePath: string, max: number): Promise<DocumentSection[]> {
  const raw = await pdftotext(filePath, max)
  return raw.split("\f").flatMap((text, index) => {
    const value = text.trim()
    if (!value) return []
    return [
      {
        filePath,
        text: value,
        kind: "pdf" as const,
        page: index + 1,
        startLine: index + 1,
        endLine: index + 1,
      },
    ]
  })
}

export async function preflightPdfExtractor(cacheDirectory: string): Promise<void> {
  await mkdir(cacheDirectory, { recursive: true })
  const dir = await mkdtemp(path.join(cacheDirectory, "PDF 预检 "))
  const file = path.join(dir, "中文 路径.pdf")
  try {
    await writeFile(file, pdfFixture("CHIPMATE_PDF_PREFLIGHT_OK"))
    const text = await pdftotext(file, 64 * 1024)
    if (!text.includes("CHIPMATE_PDF_PREFLIGHT_OK")) {
      throw new DocumentExtractionError(
        `PDF extractor preflight returned no expected text. Executable: ${pdftotextPath()}`,
        "extractor-runtime",
      )
    }
  } catch (err) {
    if (err instanceof DocumentExtractionError && err.category === "extractor-runtime") throw err
    throw new DocumentExtractionError(
      `PDF extractor preflight failed. Executable: ${pdftotextPath()}. ${sanitizeDocumentDiagnostic(err)}`,
      "extractor-runtime",
      { cause: err },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function pdftotext(filePath: string, max: number): Promise<string> {
  const exe = pdftotextPath()
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ["-layout", filePath, "-"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let stderr = 0
    let capped = false
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    child.stdout.on("data", (chunk: Buffer) => {
      const left = Math.max(0, max - size)
      if (left > 0) {
        const part = chunk.subarray(0, left)
        out.push(part)
        size += part.length
      }
      if (chunk.length <= left) return
      capped = true
      child.kill()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      const left = Math.max(0, 64 * 1024 - stderr)
      if (left === 0) return
      const part = chunk.subarray(0, left)
      err.push(part)
      stderr += part.length
    })
    child.on("error", (cause) => {
      finish(() =>
        reject(
          new DocumentExtractionError(
            `PDF extraction process failed to start. Executable: ${exe}. ${sanitizeDocumentDiagnostic(cause)}`,
            "extractor-runtime",
            { cause },
          ),
        ),
      )
    })
    child.on("close", (code, signal) => {
      if (code === 0 || capped) {
        finish(() => resolve(Buffer.concat(out).toString("utf8")))
        return
      }
      const stderr = sanitizeDocumentDiagnostic(Buffer.concat(err).toString("utf8"))
      const details = [
        `Executable: ${exe}`,
        `exitCode=${code ?? "null"}`,
        `signal=${signal ?? "none"}`,
        stderr === "未知文档抽取错误" ? "stderr=(empty)" : `stderr=${stderr}`,
      ].join("; ")
      const category = classifyDocumentIssue(stderr === "未知文档抽取错误" ? details : stderr)
      finish(() => reject(new DocumentExtractionError(`pdftotext failed. ${details}`, category)))
    })
  })
}

function pdfFixture(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET\n`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
  ]
  let value = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(value, "ascii"))
    value += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(value, "ascii")
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  value += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(value, "ascii")
}

export function pdftotextPath(
  env: NodeJS.ProcessEnv = process.env,
  exec: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.CHIPMATE_PDFTOTEXT_PATH?.trim()
  if (override) return override
  const ext = platform === "win32" ? ".exe" : ""
  const dir = path.dirname(exec)
  const candidates = [path.join(dir, "poppler", `pdftotext${ext}`), path.join(dir, `pdftotext${ext}`)]
  return candidates.find((file) => existsSync(file)) ?? `pdftotext${ext}`
}

async function sheet(filePath: string, max: number): Promise<DocumentSection[]> {
  const bytes = await readFile(filePath)
  guardArchive(bytes, max)
  const book = read(bytes, { type: "buffer", cellDates: true, sheetRows })
  return sheets(filePath, book, max)
}

function guardArchive(bytes: Buffer, max: number): void {
  const limit = Math.max(archiveFloor, Math.min(archiveCeiling, max * 64))
  let expanded = 0
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue
    const size = bytes.readUInt32LE(offset + 24)
    const names = bytes.readUInt16LE(offset + 28)
    const extra = bytes.readUInt16LE(offset + 30)
    const comment = bytes.readUInt16LE(offset + 32)
    const end = offset + 46 + names + extra + comment
    if (end > bytes.length) throw new Error("Office archive has an invalid central directory.")
    const name = bytes
      .subarray(offset + 46, offset + 46 + names)
      .toString("utf8")
      .toLowerCase()
    if (size === 0xffffffff) throw new Error("Office archive uses an unbounded ZIP64 entry.")
    if (name.endsWith(".xml") || name.endsWith(".rels")) expanded += size
    if (expanded > limit) {
      throw new Error(`Office archive expands to more than the ${limit}-byte extraction safety limit.`)
    }
    offset = end - 1
  }
}

function sheets(filePath: string, book: WorkBook, max: number): DocumentSection[] {
  const out: DocumentSection[] = []
  let remaining = max
  for (const [index, name] of book.SheetNames.entries()) {
    if (remaining <= 0) break
    const meta = book.Workbook?.Sheets?.[index]
    if (meta?.Hidden === 1 || meta?.Hidden === 2) continue
    const ws = book.Sheets[name]
    if (!ws?.["!ref"]) continue
    const range = utils.decode_range(ws["!ref"])
    const end = Math.min(range.e.r, sheetRows - 1)
    const rows = [`--- Sheet: ${name} ---`]
    let used = Buffer.byteLength(rows[0] ?? "")
    let last = range.s.r
    for (let row = range.s.r; row <= end; row++) {
      const values: string[] = []
      for (let col = range.s.c; col <= range.e.c; col++) {
        values.push(cell(ws[utils.encode_cell({ r: row, c: col })]))
      }
      if (!values.some((item) => item.trim())) continue
      const line = limit(values.join("\t"), Math.max(0, remaining - used - 1))
      if (!line) break
      rows.push(line)
      used += Buffer.byteLength(line) + 1
      last = row
      if (used >= remaining) break
    }
    if (rows.length === 1) continue
    const value = rows.join("\n")
    remaining -= Buffer.byteLength(value)
    out.push({
      filePath,
      text: value,
      kind: "spreadsheet",
      sheet: name,
      startLine: range.s.r + 1,
      endLine: last + 1,
    })
  }
  return out
}

function cell(value: CellObject | undefined): string {
  if (!value) return ""
  if (value.f) {
    if (value.w !== undefined && value.w !== null) return value.w
    if (value.v !== undefined && value.v !== null) return String(value.v)
    return `[Formula: ${value.f}]`
  }
  if (value.v === undefined || value.v === null) return ""
  if (value.t === "e") return `[Error: ${value.w ?? String(value.v)}]`
  if (value.t === "d") return value.v instanceof Date ? value.v.toISOString().slice(0, 10) : String(value.v)
  if (value.l?.Target) return `${value.w ?? String(value.v)} (${value.l.Target})`
  return value.w ?? String(value.v)
}

function limit(value: string, max: number): string {
  if (max <= 0) return ""
  const bytes = Buffer.from(value)
  if (bytes.length <= max) return value
  const result = bytes.subarray(0, max).toString("utf8")
  if (Buffer.byteLength(result, "utf8") <= max) return result
  return result.slice(0, -1)
}
