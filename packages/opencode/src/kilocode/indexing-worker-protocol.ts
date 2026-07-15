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
import type { IndexingResource } from "./indexing-memory"
import type { IndexingWarning } from "./indexing-warning"

export const INDEXING_PROCESS_PREFIX = "@kilo-indexing:"

export type InitInput = {
  directory: string
  root: string
  config: IndexingConfigInput
  baselineDirectory?: string
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
  | {
      type: "request"
      id: number
      method: "search"
      input: { query: string; directoryPrefix?: string }
    }
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

export type Log = {
  level: "debug" | "info" | "warn" | "error"
  message: string
}

export type Event =
  | { type: "event"; event: "status"; data: IndexingStatus }
  | { type: "event"; event: "telemetry"; data: IndexingTelemetryEvent }
  | { type: "event"; event: "resource"; data: IndexingResource }
  | { type: "event"; event: "warning"; data: IndexingWarning }
  | { type: "event"; event: "log"; data: Log }

export type Message = Result | Event

const methods = new Set<string>([
  "init",
  "updateConfig",
  "search",
  "documentSearch",
  "rebuildDocuments",
  "queryEvidence",
  "codeGraphStatus",
  "dispose",
])

export function isIndexingRequest(value: unknown): value is Request {
  return (
    record(value) &&
    value.type === "request" &&
    typeof value.id === "number" &&
    typeof value.method === "string" &&
    methods.has(value.method)
  )
}

export function isIndexingMessage(value: unknown): value is Message {
  if (!record(value)) return false
  if (value.type === "event") {
    return (
      value.event === "status" ||
      value.event === "telemetry" ||
      value.event === "resource" ||
      value.event === "warning" ||
      value.event === "log"
    )
  }
  return (
    value.type === "result" &&
    typeof value.id === "number" &&
    typeof value.method === "string" &&
    typeof value.ok === "boolean"
  )
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
