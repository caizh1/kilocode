import type { VectorStoreSearchResult } from "./vector-store"
import type { CodeGraphEvidenceQueryOptions, QueryEvidenceResult } from "../analysis"
import type { CodeGraphSidecarStatus } from "../codegraph"
import type { DocumentSearchOptions, DocumentSearchResult } from "../documents"
import type { Emitter } from "../runtime"
import type { IndexingTelemetryEvent } from "./telemetry"

export type IndexingNoticeLevel = "info" | "warning"
export type IndexingNoticeAction = "openIndexingOutput"

export type IndexingNotice = {
  id: string
  level: IndexingNoticeLevel
  message: string
  action?: IndexingNoticeAction
}

export interface ICodeIndexManager {
  onProgressUpdate: Emitter<{
    systemStatus: IndexingState
    message?: string
    processedItems: number
    totalItems: number
    currentItemUnit: string
    notices?: IndexingNotice[]
    gitBranch?: string
    manifest?: { totalFiles: number; totalChunks: number; lastUpdated: string }
  }>

  onTelemetry: Emitter<IndexingTelemetryEvent>

  readonly state: IndexingState
  readonly isFeatureEnabled: boolean
  readonly isFeatureConfigured: boolean

  loadConfiguration(): Promise<void>
  startIndexing(): Promise<void>
  stopWatcher(): void
  clearIndexData(): Promise<void>
  searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]>
  searchDocuments(query: string, options?: DocumentSearchOptions): Promise<DocumentSearchResult[]>
  queryEvidence(query: string, options?: CodeGraphEvidenceQueryOptions): Promise<QueryEvidenceResult>
  rebuildDocuments(): Promise<void>
  getCodeGraphStatus(): CodeGraphSidecarStatus
  getCurrentStatus(): {
    systemStatus: IndexingState
    message?: string
    processedItems: number
    totalItems: number
    currentItemUnit: string
    notices?: IndexingNotice[]
  }
  dispose(): Promise<void>
}

export type IndexingState = "Standby" | "Indexing" | "Indexed" | "Error"

export type EmbedderProvider =
  | "chipmate"
  | "openai"
  | "ollama"
  | "openai-compatible"
  | "gemini"
  | "mistral"
  | "vercel-ai-gateway"
  | "bedrock"
  | "openrouter"
  | "voyage"

export interface IndexProgressUpdate {
  systemStatus: IndexingState
  message?: string
  processedBlockCount?: number
  totalBlockCount?: number
}
