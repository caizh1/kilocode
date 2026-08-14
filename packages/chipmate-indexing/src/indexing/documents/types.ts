export const DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".ods",
  ".txt",
  ".md",
  ".markdown",
  ".rst",
  ".csv",
  ".tsv",
] as const

export const UNSUPPORTED_DOCUMENT_EXTENSIONS = [".doc", ".xls", ".ppt", ".pptx"] as const

export const DOCUMENT_ISSUE_CATEGORIES = [
  "extractor-runtime",
  "pdf-password",
  "pdf-invalid",
  "office-corrupt",
  "file-unavailable",
  "extraction-safety-limit",
  "extraction-unknown",
] as const

export type DocumentIssueCategory = (typeof DOCUMENT_ISSUE_CATEGORIES)[number]

export type DocumentIssueSample = {
  file?: string
  message: string
}

export type DocumentIssueSummary = {
  category: DocumentIssueCategory
  count: number
  samples: DocumentIssueSample[]
}

export type DocumentDiagnostic = {
  time: string
  source: "documents"
  location: string
  category: DocumentIssueCategory
  message: string
  file?: string
}

export type DocumentDiagnosticReport = {
  runId: string
  startedAt: string
  completedAt?: string
  issueSummary: DocumentIssueSummary[]
  diagnostics: DocumentDiagnostic[]
}

export type DocumentIndexStatusState = "Disabled" | "In Progress" | "Complete" | "Error" | "Standby"

export type DocumentIndexStatus = {
  state: DocumentIndexStatusState
  message: string
  processedFiles: number
  totalFiles: number
  percent: number
  detail?: string
  lastFullScanAt?: string
  errorCount: number
  staleCount: number
  skippedCount: number
  validFileCount?: number
  issueSummary?: DocumentIssueSummary[]
  diagnosticRunId?: string
  recentErrors?: Array<{
    time: string
    source: string
    location: string
    message: string
    file?: string
    category?: DocumentIssueCategory
  }>
}

export type DocumentSearchOptions = {
  directoryPrefix?: string
  maxResults?: number
}

export type DocumentSearchResult = {
  filePath: string
  sourceRef: string
  score: number
  content: string
  startLine: number
  endLine: number
}

export type DocumentSection = {
  filePath: string
  text: string
  kind: "text" | "pdf" | "spreadsheet" | "diagram"
  page?: number
  sheet?: string
  mediaPath?: string
  startLine: number
  endLine: number
}

export type DocumentChunk = DocumentSection & {
  content: string
  chunkHash: string
  sourceRef: string
}
