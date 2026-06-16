import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import mammoth from "mammoth"
import { read, utils, type CellObject, type WorkBook } from "xlsx"
import type { DocumentSection } from "./types"

const sheetRows = 50_000

export async function extractDocument(filePath: string): Promise<DocumentSection[]> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".pdf") return pdf(filePath)
  if (ext === ".docx") return docx(filePath)
  if (ext === ".xlsx" || ext === ".ods") return sheet(filePath)
  return text(filePath)
}

async function text(filePath: string): Promise<DocumentSection[]> {
  const raw = await readFile(filePath, "utf8")
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

async function docx(filePath: string): Promise<DocumentSection[]> {
  const result = await mammoth.extractRawText({ path: filePath })
  const messages: Array<{ type?: string; message?: string }> = result.messages ?? []
  const warnings = messages.filter((item) => item.type === "warning").map((item) => item.message ?? "")
  const note = warnings.length > 0 ? `\n\nDOCX extraction warnings: ${warnings.join("; ")}` : ""
  const value = `${result.value}${note}`
  return [
    {
      filePath,
      text: value,
      kind: "text",
      startLine: 1,
      endLine: Math.max(1, value.split(/\r?\n/).length),
    },
  ]
}

async function pdf(filePath: string): Promise<DocumentSection[]> {
  const raw = await pdftotext(filePath)
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

function pdftotext(filePath: string): Promise<string> {
  const exe = pdftotextPath()
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ["-layout", filePath, "-"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk))
    child.on("error", (cause) => {
      reject(new Error(`PDF extraction requires pdftotext. Tried ${exe}: ${cause.message}`, { cause }))
    })
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString("utf8"))
        return
      }
      const msg = Buffer.concat(err).toString("utf8").trim()
      reject(new Error(msg || `pdftotext failed with code ${code}`))
    })
  })
}

export function pdftotextPath(
  env: NodeJS.ProcessEnv = process.env,
  exec: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.KILO_PDFTOTEXT_PATH?.trim()
  if (override) return override
  const ext = platform === "win32" ? ".exe" : ""
  const dir = path.dirname(exec)
  const candidates = [path.join(dir, "poppler", `pdftotext${ext}`), path.join(dir, `pdftotext${ext}`)]
  return candidates.find((file) => existsSync(file)) ?? `pdftotext${ext}`
}

async function sheet(filePath: string): Promise<DocumentSection[]> {
  const bytes = new Uint8Array(await readFile(filePath))
  const book = read(bytes, { type: "array", cellDates: true })
  return sheets(filePath, book)
}

function sheets(filePath: string, book: WorkBook): DocumentSection[] {
  return book.SheetNames.flatMap((name: string, index: number) => {
    const meta = book.Workbook?.Sheets?.[index]
    if (meta?.Hidden === 1 || meta?.Hidden === 2) return []
    const ws = book.Sheets[name]
    if (!ws?.["!ref"]) return []
    const range = utils.decode_range(ws["!ref"])
    const end = Math.min(range.e.r, sheetRows - 1)
    const rows: string[] = []
    for (let row = range.s.r; row <= end; row++) {
      const values: string[] = []
      for (let col = range.s.c; col <= range.e.c; col++) {
        values.push(cell(ws[utils.encode_cell({ r: row, c: col })]))
      }
      if (values.some((item) => item.trim())) rows.push(values.join("\t"))
    }
    if (rows.length === 0) return []
    return [
      {
        filePath,
        text: [`--- Sheet: ${name} ---`, ...rows].join("\n"),
        kind: "spreadsheet" as const,
        sheet: name,
        startLine: range.s.r + 1,
        endLine: end + 1,
      },
    ]
  })
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
