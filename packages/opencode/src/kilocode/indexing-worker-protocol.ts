import type {
  CodeGraphSidecarStatus,
  CodeGraphEvidenceQueryOptions,
  IndexingConfigInput,
  IndexingTelemetryEvent,
  DocumentSearchResult,
  QueryEvidenceResult,
  VectorStoreSearchResult,
} from "@kilocode/kilo-indexing/engine"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"

export type InitInput = {
  directory: string
  root: string
  config: IndexingConfigInput
  lancedbPath?: string
}

export type QueryEvidenceInput = {
  query: string
  directoryPrefix?: string
  retrievalMode?: CodeGraphEvidenceQueryOptions["retrievalMode"]
  maxEvidenceItems?: number
  maxPackChars?: number
}

export type DocumentSearchInput = {
  query: string
  directoryPrefix?: string
  maxResults?: number
}

export type Request =
  | { type: "request"; id: number; method: "init"; input: InitInput }
  | { type: "request"; id: number; method: "updateConfig"; input: IndexingConfigInput }
  | { type: "request"; id: number; method: "search"; input: { query: string; directoryPrefix?: string } }
  | { type: "request"; id: number; method: "documentSearch"; input: DocumentSearchInput }
  | { type: "request"; id: number; method: "rebuildDocuments"; input: undefined }
  | { type: "request"; id: number; method: "queryEvidence"; input: QueryEvidenceInput }
  | { type: "request"; id: number; method: "codeGraphStatus"; input: undefined }
  | { type: "request"; id: number; method: "dispose"; input: undefined }

export type Result =
  | { type: "result"; id: number; method: "init"; ok: true; value: IndexingStatus }
  | { type: "result"; id: number; method: "updateConfig"; ok: true; value: IndexingStatus }
  | { type: "result"; id: number; method: "search"; ok: true; value: VectorStoreSearchResult[] }
  | { type: "result"; id: number; method: "documentSearch"; ok: true; value: DocumentSearchResult[] }
  | { type: "result"; id: number; method: "rebuildDocuments"; ok: true; value: IndexingStatus }
  | { type: "result"; id: number; method: "queryEvidence"; ok: true; value: QueryEvidenceResult }
  | { type: "result"; id: number; method: "codeGraphStatus"; ok: true; value: CodeGraphSidecarStatus }
  | { type: "result"; id: number; method: "dispose"; ok: true; value: undefined }
  | { type: "result"; id: number; method: Request["method"]; ok: false; error: string }

export type Event =
  | { type: "event"; event: "status"; data: IndexingStatus }
  | { type: "event"; event: "telemetry"; data: IndexingTelemetryEvent }

export type Message = Result | Event
