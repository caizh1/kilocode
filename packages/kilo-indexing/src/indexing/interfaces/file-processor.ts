import type { PointStruct } from "./vector-store"
import type { Disposable, Emitter } from "../runtime"
import type { IndexingTelemetryMode } from "./telemetry"
import type { IndexingPressure } from "../memory"
import type { WorktreeOverlay } from "../worktree-overlay"

export type IndexingScanTarget = "all" | "codeGraph" | "rag"

export type WatcherSyntheticEvent = {
  path: string
  type: "create" | "change" | "delete"
}

export type ScanProgressEvent =
  | {
      type: "target"
      totalFiles: number
      graphTotalFiles: number
    }
  | {
      type: "file"
      filePath: string
    }
  | {
      type: "graph"
      filePath: string
    }

export interface ICodeParser {
  parseFile(
    filePath: string,
    options?: {
      minBlockLines?: number
      maxBlockLines?: number
      content?: string
      fileHash?: string
    },
  ): Promise<CodeBlock[]>
}

export interface IDirectoryScanner {
  scanDirectory(
    directory: string,
    onError?: (error: Error) => void,
    onFilesIndexed?: (indexedCount: number) => void,
    onFileParsed?: () => void,
    mode?: IndexingTelemetryMode,
    onProgress?: (event: ScanProgressEvent) => void,
    target?: IndexingScanTarget,
  ): Promise<{
    stats: {
      processed: number
      skipped: number
    }
    totalBlockCount: number
    candidateFiles?: string[]
    scanStartedAt?: number
    target?: IndexingScanTarget
  }>

  updateBatchSegmentThreshold(newThreshold: number): void
  setMemoryPressure?(pressure: IndexingPressure): void
}

export interface IFileWatcher extends Disposable {
  initialize(): Promise<void>
  updateBatchSegmentThreshold(newThreshold: number): void
  setCollecting(collecting: boolean): void
  enqueueSyntheticEvents?(events: WatcherSyntheticEvent[]): void
  getPendingEventCount?(): number
  takeReconciliationRequest?(): boolean
  setMemoryPressure?(pressure: IndexingPressure): void
  setRunContext?(runId: string, meta: import("../rag-checkpoint").RagCheckpointMeta): void
  setOverlay?(overlay?: WorktreeOverlay): void
  shutdown?(): Promise<void>

  readonly onDidStartBatchProcessing: Emitter<string[]>
  readonly onBatchProgressUpdate: Emitter<{
    processedInBatch: number
    totalInBatch: number
    currentFile?: string
  }>
  readonly onDidFinishBatchProcessing: Emitter<BatchProcessingSummary>

  processFile(filePath: string): Promise<FileProcessingResult>
}

export interface BatchProcessingSummary {
  processedFiles: FileProcessingResult[]
  batchError?: Error
}

export interface FileProcessingResult {
  path: string
  status: "success" | "skipped" | "error" | "processed_for_batching" | "local_error"
  error?: Error
  reason?: string
  newHash?: string
  pointsToUpsert?: PointStruct[]
}

export interface CodeBlock {
  file_path: string
  identifier: string | null
  type: string
  start_line: number
  end_line: number
  content: string
  fileHash: string
  segmentHash: string
}
