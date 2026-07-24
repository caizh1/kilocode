export { CodeIndexManager } from "./manager"
export { CodeIndexConfigManager, type IndexingConfigInput } from "./config-manager"
export { CodeIndexStateManager, type IndexingState } from "./state-manager"
export { CodeIndexSearchService } from "./search-service"
export { CodeIndexAnalysisService, resolveEvidenceBudget } from "./analysis"
export { CodeGraphSidecarLifecycle, disabledCodeGraphSidecarStatus } from "./codegraph"
export {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS,
  CODE_GRAPH_STORAGE_DIR,
  CODE_GRAPH_STORAGE_VERSION_DIR,
  CODE_GRAPH_SUPPORTED_EXTENSIONS,
  CODE_POSTINGS_FIELD_WEIGHTS,
  CODE_POSTINGS_SCHEMA_VERSION,
  CODE_POSTINGS_STORAGE_DIR,
  CODE_POSTINGS_STORAGE_VERSION_DIR,
  CODE_POSTINGS_TOKENIZER_VERSION,
} from "./codegraph"
export { CodeIndexOrchestrator } from "./orchestrator"
export { CodeIndexServiceFactory } from "./service-factory"
export { CacheManager } from "./cache-manager"
export { Emitter, type Disposable } from "./runtime"
export { DocumentIndexService, extractDocxPlantUml } from "./documents"

export type { ICodeIndexManager, IndexProgressUpdate, EmbedderProvider } from "./interfaces/manager"

export type {
  IndexingTelemetryEvent,
  IndexingTelemetryMode,
  IndexingTelemetryReporter,
  IndexingTelemetrySource,
  IndexingTelemetryTrigger,
} from "./interfaces/telemetry"

export type { CodeIndexConfig, PreviousConfigSnapshot } from "./interfaces/config"

export type {
  DocumentIndexStatus,
  DocumentSearchOptions,
  DocumentSearchResult,
  DocumentSection,
  DocxPlantUmlDiagram,
  DocxPlantUmlOptions,
  DocxPlantUmlResult,
} from "./documents"

export type {
  CodeGraphCall,
  CodeGraphDeclaration,
  CodeGraphFileGraph,
  CodeGraphFileRecord,
  CodeGraphFileRecordStatus,
  CodeGraphGlobalSymbol,
  CodeGraphInclude,
  CodeGraphInitializer,
  CodeGraphLabel,
  CodeGraphLanguage,
  CodeGraphLineRange,
  CodeGraphMacro,
  CodeGraphManifest,
  CodeGraphRegisterMacro,
  CodeGraphRegisterMacroFamily,
  CodeGraphSidecarOptions,
  CodeGraphSidecarState,
  CodeGraphSidecarStatus,
  CodeGraphSidecarTransition,
  CodeGraphStatusInput,
  CodeGraphStorageStatus,
  CodeGraphSymbolBase,
  CodeGraphTypeField,
  CodeGraphTypeSymbol,
  CodePostingsBuildInput,
  CodePostingsDocument,
  CodePostingsField,
  CodePostingsFileRecord,
  CodePostingsFileRecordStatus,
  CodePostingsManifest,
  CodePostingsRange,
  CodePostingsSearchOptions,
  CodePostingsSearchResult,
  CodePostingsStatusInput,
  CodePostingsStorageStatus,
  CodePostingsTermDocument,
  CodePostingsTermShard,
  ICodeGraphStorage,
  ICodePostingsStorage,
} from "./codegraph"

export type {
  CodeGraphEvidenceEffectiveMode,
  CodeGraphEvidenceQueryOptions,
  CodeGraphEvidenceRetrievalMode,
  EvidenceBudget,
  EvidenceConfidence,
  EvidenceRef,
  EvidenceSource,
  QueryEvidenceAnswerPolicy,
  QueryEvidenceDroppedByBudget,
  QueryEvidenceResult,
  QueryEvidenceStageStatus,
  QueryEvidenceStateMachine,
  QueryEvidenceSummaries,
  QueryEvidenceSummary,
  QueryEvidenceTrace,
  QueryEvidenceTraceDiagnostic,
  QueryEvidenceTraceStage,
} from "./analysis"

export type { IEmbedder, EmbeddingResponse, EmbedderInfo, AvailableEmbedders } from "./interfaces/embedder"

export type { IVectorStore, VectorStoreSearchResult, PointStruct, Payload } from "./interfaces/vector-store"

export type {
  ICodeParser,
  IDirectoryScanner,
  IFileWatcher,
  CodeBlock,
  FileProcessingResult,
  BatchProcessingSummary,
  ScanProgressEvent,
} from "./interfaces/file-processor"

export type { ICacheManager } from "./interfaces/cache"
