export { ChipMateIndexingPlugin, default } from "./plugin.js"
export { IndexingConfig, toIndexingConfigInput } from "./config.js"
export { hasIndexingPlugin, isIndexingPlugin, normalizePluginName, INDEXING_PLUGIN_NAMES } from "./detect.js"
export { DOCUMENT_ISSUE_CATEGORIES } from "./indexing/documents/types.js"
export {
  INDEXING_STATUS_STATES,
  IndexingDiagnostic,
  DocumentIssueSummary,
  IndexingPipelineStatus,
  IndexingStatus,
  IndexingStatusPipelines,
  IndexingStatusState,
  disabledIndexingStatus,
  normalizeIndexingStatus,
} from "./status.js"

export type { IndexingConfig as IndexingConfigInfo } from "./config.js"
export type {
  IndexingDiagnostic as IndexingDiagnosticInfo,
  DocumentIssueSummary as DocumentIssueSummaryInfo,
  IndexingPipelineStatus as IndexingPipelineStatusInfo,
  IndexingPipelineRecentErrors as IndexingPipelineRecentErrorsInfo,
  IndexingStatus as IndexingStatusInfo,
  IndexingStatusPipelines as IndexingStatusPipelinesInfo,
  IndexingStatusState as IndexingStatusStateInfo,
} from "./status.js"
