import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type {
  DocumentDiagnostic,
  DocumentDiagnosticReport,
  DocumentIssueCategory,
  DocumentIssueSummary,
} from "./types"

const samples = 3

export class DocumentExtractionError extends Error {
  constructor(
    message: string,
    readonly category: DocumentIssueCategory,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "DocumentExtractionError"
  }
}

export function classifyDocumentIssue(err: unknown): DocumentIssueCategory {
  if (err instanceof DocumentExtractionError) return err.category
  const code = record(err)?.code
  if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM") {
    return "file-unavailable"
  }
  const message = errorMessage(err).toLowerCase()
  if (/incorrect password|password required|encrypted pdf|owner password|user password/.test(message)) {
    return "pdf-password"
  }
  if (
    /invalid pdf|damaged pdf|may not be a pdf|syntax error|couldn'?t find trailer dictionary|couldn'?t read xref table|pdf.*(?:syntax|xref)/.test(
      message,
    )
  ) {
    return "pdf-invalid"
  }
  if (/corrupt(?:ed)? zip|end of data reached|invalid central directory|not a zip file/.test(message)) {
    return "office-corrupt"
  }
  if (/not accessible|no such file|cannot find (?:the )?(?:file|path)/.test(message)) return "file-unavailable"
  if (/extraction safety limit|unbounded zip64|expands to more than/.test(message)) {
    return "extraction-safety-limit"
  }
  return "extraction-unknown"
}

export function sanitizeDocumentDiagnostic(value: unknown, max = 8 * 1024): string {
  const raw = errorMessage(value)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, "[已隐藏凭据]")
    .replace(/\b(authorization|api[-_ ]?key|token|password)\s*[:=]\s*\S+/gi, "$1=[已隐藏凭据]")
    .replace(/([?&](?:api[-_]?key|access[-_]?token|token|password)=)[^&#\s]+/gi, "$1[已隐藏凭据]")
    .replace(/:\/\/([^\s/@:]+):([^\s/@]+)@/g, "://$1:[已隐藏凭据]@")
    .replace(/\s+/g, " ")
    .trim()
  if (!raw) return "未知文档抽取错误"
  const bytes = Buffer.from(raw)
  if (bytes.byteLength <= max) return raw
  return bytes.subarray(0, max).toString("utf8").replace(/\uFFFD$/, "")
}

export function summarizeDocumentIssues(diagnostics: readonly DocumentDiagnostic[]): DocumentIssueSummary[] {
  const grouped = new Map<DocumentIssueCategory, DocumentDiagnostic[]>()
  for (const item of diagnostics) grouped.set(item.category, [...(grouped.get(item.category) ?? []), item])
  return [...grouped.entries()].map(([category, items]) => ({
    category,
    count: items.length,
    samples: items.slice(0, samples).map((item) => ({
      ...(item.file ? { file: item.file } : {}),
      message: item.message,
    })),
  }))
}

export class DocumentDiagnosticLedger {
  private report?: DocumentDiagnosticReport
  private readonly directory: string

  constructor(cacheDirectory: string, workspace: string) {
    const hash = createHash("sha256").update(workspace).digest("hex")
    this.directory = path.join(cacheDirectory, "document-diagnostics", hash)
  }

  start(runId: string): void {
    this.report = { runId, startedAt: new Date().toISOString(), issueSummary: [], diagnostics: [] }
  }

  add(input: Omit<DocumentDiagnostic, "time" | "source">): DocumentDiagnostic {
    if (!this.report) this.start(randomUUID())
    const item: DocumentDiagnostic = {
      time: new Date().toISOString(),
      source: "documents",
      ...input,
      message: sanitizeDocumentDiagnostic(input.message),
    }
    this.report!.diagnostics.push(item)
    this.report!.issueSummary = summarizeDocumentIssues(this.report!.diagnostics)
    return item
  }

  current(): DocumentDiagnosticReport | undefined {
    if (!this.report) return undefined
    return structuredClone(this.report)
  }

  async complete(): Promise<DocumentDiagnosticReport | undefined> {
    if (!this.report) return undefined
    this.report.completedAt = new Date().toISOString()
    this.report.issueSummary = summarizeDocumentIssues(this.report.diagnostics)
    await fs.mkdir(this.directory, { recursive: true })
    await this.atomic(path.join(this.directory, `${this.report.runId}.json`), this.report)
    await this.atomic(path.join(this.directory, "latest.json"), this.report)
    await this.removeOlderRuns(this.report.runId)
    return this.current()
  }

  async read(runId?: string): Promise<DocumentDiagnosticReport | undefined> {
    if (runId && !safeRunId(runId)) return undefined
    const name = runId ? `${runId}.json` : "latest.json"
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.directory, name), "utf8")) as unknown
      return valid(data) ? data : undefined
    } catch {
      return undefined
    }
  }

  private async atomic(file: string, value: DocumentDiagnosticReport): Promise<void> {
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(value), "utf8")
    await fs.rename(tmp, file)
  }

  private async removeOlderRuns(runId: string): Promise<void> {
    const files = await fs.readdir(this.directory).catch(() => [])
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json") && file !== "latest.json" && file !== `${runId}.json`)
        .map((file) => fs.unlink(path.join(this.directory, file)).catch(() => undefined)),
    )
  }
}

function safeRunId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function valid(value: unknown): value is DocumentDiagnosticReport {
  const input = record(value)
  return Boolean(
    input &&
      typeof input.runId === "string" &&
      typeof input.startedAt === "string" &&
      Array.isArray(input.issueSummary) &&
      Array.isArray(input.diagnostics),
  )
}
