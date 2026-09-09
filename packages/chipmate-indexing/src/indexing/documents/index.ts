export { DocumentIndexService } from "./service"
export { extractDocument } from "./extractors"
export { classifyDocumentIssue, DocumentExtractionError, sanitizeDocumentDiagnostic } from "./diagnostics"
export {
  extractDocxPlantUml,
  type DocxPlantUmlDiagram,
  type DocxPlantUmlOptions,
  type DocxPlantUmlResult,
} from "./plantuml"
export type {
  DocumentChunk,
  DocumentDiagnostic,
  DocumentDiagnosticReport,
  DocumentIndexStatus,
  DocumentIndexStatusState,
  DocumentSearchOptions,
  DocumentSearchResult,
  DocumentSection,
  DocumentIssueCategory,
  DocumentIssueSummary,
} from "./types"
export { DOCUMENT_ISSUE_CATEGORIES } from "./types"
