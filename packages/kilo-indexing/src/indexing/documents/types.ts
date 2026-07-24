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
  recentErrors?: Array<{
    time: string
    source: string
    location: string
    message: string
    file?: string
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
