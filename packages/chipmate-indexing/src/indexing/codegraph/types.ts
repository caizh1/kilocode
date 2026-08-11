import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS,
  CODE_POSTINGS_FIELD_WEIGHTS,
  CODE_POSTINGS_SCHEMA_VERSION,
  CODE_POSTINGS_TOKENIZER_VERSION,
} from "./constants"

export type CodeGraphSidecarState = "disabled" | "stopped" | "container_ready" | "disposed"

export type CodeGraphSidecarTransition = {
  state: CodeGraphSidecarState
  reason: string
  timestamp: number
}

export type CodeGraphFileRecordStatus = "ok" | "parse_error" | "unsupported" | "stale"

export type CodePostingsFileRecordStatus = "ok" | "parse_error" | "unsupported" | "stale" | "postings_error"

export type CodePostingsField = keyof typeof CODE_POSTINGS_FIELD_WEIGHTS

export type CodeGraphLanguage = "c" | "cpp"

export type CodeGraphLineRange = {
  startLine: number
  endLine: number
}

export type CodeGraphSymbolBase = CodeGraphLineRange & {
  name: string
  shortSnippet?: string
}

export type CodeGraphInclude = CodeGraphLineRange & {
  target: string
  system: boolean
  shortSnippet?: string
}

export type CodeGraphMacro = CodeGraphSymbolBase & {
  kind: "macro"
  parameters?: string[]
}

export type CodeGraphFunction = CodeGraphSymbolBase & {
  kind: "function"
  id: string
  signature: string
  isStatic: boolean
  calls: CodeGraphCall[]
}

export type CodeGraphDeclaration = CodeGraphSymbolBase & {
  kind: "function"
  signature: string
}

export type CodeGraphCall = CodeGraphLineRange & {
  callerName: string
  calleeName: string
  args: string[]
  returnHandling?: string
  shortSnippet?: string
}

export type CodeGraphTypeField = CodeGraphSymbolBase & {
  type: string
}

export type CodeGraphTypeSymbol = CodeGraphSymbolBase & {
  kind: "typedef" | "struct" | "union" | "enum"
  fields?: CodeGraphTypeField[]
}

export type CodeGraphGlobalSymbol = CodeGraphSymbolBase & {
  kind: "global"
}

export type CodeGraphInitializer = CodeGraphLineRange & {
  typeName?: string
  fields: string[]
  shortSnippet?: string
}

export type CodeGraphLabel = CodeGraphSymbolBase & {
  kind: "label" | "error_label"
  functionName: string
  functionId: string
  cleanupCalls: string[]
  returnStyle?: string
}

export type CodeGraphRegisterMacro = CodeGraphSymbolBase & {
  suffix: string
}

export type CodeGraphRegisterMacroFamily = CodeGraphLineRange & {
  family: string
  path: string
  macros: CodeGraphRegisterMacro[]
  mmioIdentifiers: string[]
  shortSnippet?: string
}

export type CodeGraphFileGraph = {
  workspacePath: string
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  filePath: string
  fileHash: string
  language: CodeGraphLanguage
  includes: CodeGraphInclude[]
  macros: CodeGraphMacro[]
  functions: CodeGraphFunction[]
  declarations: CodeGraphDeclaration[]
  calls: CodeGraphCall[]
  types: CodeGraphTypeSymbol[]
  globals: CodeGraphGlobalSymbol[]
  initializers: CodeGraphInitializer[]
  labels: CodeGraphLabel[]
  registerMacroFamilies: CodeGraphRegisterMacroFamily[]
  updatedAt: string
}

export type CodeGraphFileRecord = {
  filePath: string
  graphFile: string
  graphParts?: CodeGraphShardPartInfo[]
  fileHash?: string
  status: CodeGraphFileRecordStatus
  updatedAt: string
  error?: string
}

export type CodeGraphStoredFileArrayField =
  | "includes"
  | "macros"
  | "functions"
  | "declarations"
  | "calls"
  | "types"
  | "globals"
  | "initializers"
  | "labels"
  | "registerMacroFamilies"

export type CodeGraphStoredFileBase = Omit<
  CodeGraphFileGraph,
  | "includes"
  | "macros"
  | "functions"
  | "declarations"
  | "calls"
  | "types"
  | "globals"
  | "initializers"
  | "labels"
  | "registerMacroFamilies"
>

export type CodeGraphStoredFilePart =
  | {
      kind: "whole"
      path: string
      file: CodeGraphFileGraph
    }
  | {
      kind: "base"
      path: string
      file: CodeGraphStoredFileBase
    }
  | {
      kind: "array"
      path: string
      field: CodeGraphStoredFileArrayField
      offset: number
      items: unknown[]
    }

export type CodeGraphShardPartInfo = {
  key: string
  path: string
  entries: number
  estimatedBytes: number
}

export type CodeGraphShardInfo = {
  key: string
  files: number
  functions: number
  macros: number
  bytes: number
  parts: CodeGraphShardPartInfo[]
}

export type CodeGraphShardData = {
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  key: string
  part: string
  fileParts: CodeGraphStoredFilePart[]
}

export type CodeGraphDirectoryStats = {
  files: number
  functions: number
  macros: number
  types: number
  globals: number
  bytes: number
}

export type CodeGraphSymbolKind = "function" | "macro" | "type" | "global" | "field" | "file"

export type CodeGraphSymbol = {
  id: string
  kind: CodeGraphSymbolKind
  name: string
  path: string
  startLine: number
  endLine: number
  signature?: string
  snippet: string
}

export type CodeGraphPostingKind =
  | "path"
  | "identifier"
  | "comment"
  | "macro"
  | "type"
  | "global"
  | "function"
  | "include"

export type CodeGraphPosting = {
  term: string
  path: string
  line: number
  kind: CodeGraphPostingKind
  weight: number
  symbolId?: string
}

export type CodeGraphModuleStats = CodeGraphDirectoryStats & {
  externalCallers: number
  hotSymbols: string[]
}

export type CodeGraphDerivedIndex = {
  functionIdsByName: Record<string, string[]>
  callerIdsByCallee: Record<string, string[]>
  includeTargetsByFile: Record<string, string[]>
  filePathsByInclude: Record<string, string[]>
  directoryStats: Record<string, CodeGraphDirectoryStats>
  symbolsByName: Record<string, CodeGraphSymbol[]>
  symbolsByPath: Record<string, CodeGraphSymbol[]>
  postingsByTerm: Record<string, CodeGraphPosting[]>
  moduleStats: Record<string, CodeGraphModuleStats>
}

export type CodeGraphDerivedSidecarField = keyof CodeGraphDerivedIndex

export type CodeGraphDerivedSidecarShard = CodeGraphShardPartInfo

export type CodeGraphDerivedSidecarManifest = {
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  fields: Record<CodeGraphDerivedSidecarField, CodeGraphDerivedSidecarShard[]>
}

export type CodeGraphDerivedSidecarPartData = {
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  field: CodeGraphDerivedSidecarField
  key: string
  records: Record<string, unknown>
}

export type CodeGraphManifest = {
  workspacePath: string
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  dataGeneration?: string
  lastFullScanAt?: string
  records: Record<string, CodeGraphFileRecord>
  shards?: CodeGraphShardInfo[]
  derived?: CodeGraphDerivedSidecarManifest
}

export type CodeGraphStorageStatus = {
  workspacePath: string
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  recordCount: number
  validFileCount: number
  parseErrorCount: number
  unsupportedCount: number
  staleCount: number
  schemaMismatch: boolean
  parserMismatch: boolean
  needsRebuild: boolean
  evidenceAvailable: false
  lastFullScanAt?: string
  graphDirectory?: string
}

export type CodeGraphStatusInput = {
  fileHash?: string
  error?: string
}

export interface ICodeGraphStorage {
  upsertFileGraph(filePath: string, fileHash: string, graph: CodeGraphFileGraph): Promise<void>
  removeFileGraph(filePath: string): Promise<void>
  getFileGraph(filePath: string): Promise<CodeGraphFileGraph | undefined>
  listFiles(): Promise<string[]>
  clear(): Promise<void>
  status(): CodeGraphStorageStatus
  markFileGraphStatus(
    filePath: string,
    status: Exclude<CodeGraphFileRecordStatus, "ok">,
    input?: CodeGraphStatusInput,
  ): Promise<void>
  beginFullScan(): Promise<void>
  markFullScanComplete(): Promise<void>
}

export type CodePostingsRange = CodeGraphLineRange & {
  field: CodePostingsField
  kind: string
  displayName: string
  weight: number
  shortSnippet?: string
}

export type CodePostingsTermDocument = {
  filePath: string
  fileHash: string
  termFrequency: number
  weightedFrequency: number
  fields: Partial<Record<CodePostingsField, number>>
  ranges: CodePostingsRange[]
}

export type CodePostingsTermShard = {
  term: string
  documents: Record<string, CodePostingsTermDocument>
  updatedAt: string
}

export type CodePostingsDocument = {
  workspacePath: string
  postingsSchemaVersion: typeof CODE_POSTINGS_SCHEMA_VERSION
  tokenizerVersion: typeof CODE_POSTINGS_TOKENIZER_VERSION
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  filePath: string
  fileHash: string
  documentLength: number
  terms: Record<string, CodePostingsTermDocument>
  updatedAt: string
}

export type CodePostingsFileRecord = {
  filePath: string
  docFile: string
  fileHash?: string
  status: CodePostingsFileRecordStatus
  documentLength?: number
  updatedAt: string
  error?: string
  docParts?: CodeGraphShardPartInfo[]
}

export type CodePostingsManifest = {
  workspacePath: string
  postingsSchemaVersion: typeof CODE_POSTINGS_SCHEMA_VERSION
  tokenizerVersion: typeof CODE_POSTINGS_TOKENIZER_VERSION
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  dataGeneration?: string
  documentCount: number
  updatedAt: string
  lastFullScanAt?: string
  diagnostics: string[]
  records: Record<string, CodePostingsFileRecord>
  docParts?: CodeGraphShardPartInfo[]
  termParts?: CodeGraphShardPartInfo[]
}

export type CodePostingsDocumentPartData = {
  postingsSchemaVersion: typeof CODE_POSTINGS_SCHEMA_VERSION
  tokenizerVersion: typeof CODE_POSTINGS_TOKENIZER_VERSION
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  key: string
  documents: Record<string, CodePostingsDocument>
}

export type CodePostingsTermPartData = {
  postingsSchemaVersion: typeof CODE_POSTINGS_SCHEMA_VERSION
  tokenizerVersion: typeof CODE_POSTINGS_TOKENIZER_VERSION
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  key: string
  terms: Record<string, CodePostingsTermDocument[]>
}

export type CodePostingsStorageStatus = {
  workspacePath: string
  postingsSchemaVersion: typeof CODE_POSTINGS_SCHEMA_VERSION
  tokenizerVersion: typeof CODE_POSTINGS_TOKENIZER_VERSION
  graphSchemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION
  parserVersion: typeof CODE_GRAPH_PARSER_VERSION
  documentCount: number
  recordCount: number
  validFileCount: number
  parseErrorCount: number
  unsupportedCount: number
  staleCount: number
  postingsErrorCount: number
  schemaMismatch: boolean
  tokenizerMismatch: boolean
  graphSchemaMismatch: boolean
  parserMismatch: boolean
  needsRebuild: boolean
  updatedAt?: string
  lastFullScanAt?: string
  postingsDirectory?: string
  diagnostics: string[]
}

export type CodePostingsStatusInput = {
  fileHash?: string
  error?: string
}

export type CodePostingsSearchOptions = {
  directoryPrefix?: string
  maxResults?: number
  diagnostics?: Array<{
    name: string
    reason: string
    count?: number
    filePath?: string
    kind?: string
  }>
}

export type CodePostingsSearchResult = CodeGraphLineRange & {
  filePath: string
  displayName: string
  reason: string
  confidence: "high" | "medium" | "low"
  score: number
  terms: string[]
  fields: CodePostingsField[]
  shortSnippet?: string
}

export type CodePostingsBuildInput = {
  content?: string
}

export interface ICodePostingsStorage {
  upsertFilePostings(
    filePath: string,
    fileHash: string,
    graph: CodeGraphFileGraph,
    input?: CodePostingsBuildInput,
  ): Promise<void>
  removeFilePostings(filePath: string): Promise<void>
  markFilePostingsStatus(
    filePath: string,
    status: Exclude<CodePostingsFileRecordStatus, "ok">,
    input?: CodePostingsStatusInput,
  ): Promise<void>
  getFilePostings(filePath: string): Promise<CodePostingsDocument | undefined>
  listFiles(): Promise<string[]>
  search(query: string, options?: CodePostingsSearchOptions): Promise<CodePostingsSearchResult[]>
  clear(): Promise<void>
  status(): CodePostingsStorageStatus
  beginFullScan(): Promise<void>
  markFullScanComplete(): Promise<void>
}

export type CodeGraphSidecarOptions = {
  workspacePath: string
  cacheDirectory: string
  clock?: () => number
  storage?: ICodeGraphStorage
}

export type CodeGraphSidecarStatus = {
  state: CodeGraphSidecarState
  enabled: boolean
  evidenceAvailable: false
  detail: string
  workspacePath: string
  cacheDirectory?: string
  transitions: CodeGraphSidecarTransition[]
  storage?: CodeGraphStorageStatus
  snippetLimit: typeof CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS
}
