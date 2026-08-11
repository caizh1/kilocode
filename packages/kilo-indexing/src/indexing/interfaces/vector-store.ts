import type { VectorStoreCleanupStats } from "./cleanup"

/**
 * Interface for vector database clients
 */
export type PointStruct = {
  id: string
  vector: number[]
  payload: Record<string, any>
}

export type VectorStoreCompatibilityDecision = {
  action: "reuse" | "rebuild"
  reason: string
  created: boolean
}

export interface IVectorStore {
  /**
   * Opens an existing complete store without mutating it.
   */
  openExisting?(): Promise<void>
  close?(): Promise<void>
  abortCandidate?(): Promise<void>

  /**
   * Initializes the vector store
   * @returns Promise resolving to boolean indicating if a new collection was created
   */
  initialize(): Promise<boolean>

  /**
   * Returns the last compatibility decision made while initializing the store.
   */
  getLastCompatibilityDecision?(): VectorStoreCompatibilityDecision | undefined

  /**
   * Upserts points into the vector store
   * @param points Array of points to upsert
   */
  upsertPoints(points: PointStruct[]): Promise<void>

  /**
   * Searches for similar vectors
   * @param queryVector Vector to search for
   * @param directoryPrefix Optional directory prefix to filter results
   * @param minScore Optional minimum score threshold
   * @param maxResults Optional maximum number of results to return
   * @returns Promise resolving to search results
   */
  search(
    queryVector: number[],
    directoryPrefix?: string,
    minScore?: number,
    maxResults?: number,
  ): Promise<VectorStoreSearchResult[]>

  /**
   * Deletes points by file path
   * @param filePath Path of the file to delete points for
   */
  deletePointsByFilePath(filePath: string): Promise<void>

  /**
   * Deletes points by multiple file paths
   * @param filePaths Array of file paths to delete points for
   */
  deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void>

  /**
   * Marks a fully written file generation active and older file generations inactive.
   */
  activateFileGeneration?(filePath: string, generation: string, runId: string): Promise<void>

  /**
   * Removes inactive generations for a file after the replacement generation is active.
   */
  deleteInactiveFilePoints?(filePath: string, activeGeneration: string): Promise<void>

  /**
   * Atomically activates fully written file generations and removes their predecessors.
   */
  finalizeFileGenerations?(
    files: readonly { filePath: string; generation: string; runId: string }[],
  ): Promise<void>

  /**
   * Removes abandoned inactive points from the current workspace collection/table.
   */
  cleanupInactivePoints?(): Promise<VectorStoreCleanupStats>

  /**
   * Stable vector collection/table identity used in checkpoint compatibility metadata.
   */
  getCollectionName?(): string

  /**
   * Clears all points from the collection
   */
  clearCollection(): Promise<void>

  /**
   * Deletes the entire collection.
   */
  deleteCollection(): Promise<void>

  /**
   * Checks if the collection exists
   * @returns Promise resolving to boolean indicating if the collection exists
   */
  collectionExists(): Promise<boolean>

  /**
   * Checks if the collection exists and has indexed points
   * @returns Promise resolving to boolean indicating if the collection exists and has points
   */
  hasIndexedData(): Promise<boolean>

  /**
   * Marks the indexing process as complete by storing metadata
   * Should be called after a successful full workspace scan or incremental scan
   */
  markIndexingComplete(options?: { allowEmpty?: boolean }): Promise<void>

  /**
   * Marks the indexing process as incomplete by storing metadata
   * Should be called at the start of indexing to indicate work in progress
   */
  markIndexingIncomplete(): Promise<void>
}

export interface VectorStoreSearchResult {
  id: string | number
  score: number
  payload?: Payload | null
}

export interface Payload {
  filePath: string
  fileHash?: string
  codeChunk: string
  startLine: number
  endLine: number
  [key: string]: any
}
