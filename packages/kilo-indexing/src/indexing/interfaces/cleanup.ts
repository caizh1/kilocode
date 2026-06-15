export type IndexingCleanupStats = {
  filesDeleted: number
  directoriesDeleted: number
  bytesDeleted: number
  skipped: string[]
}

export type VectorStoreCleanupStats = {
  pointsDeleted?: number
  skipped: string[]
}

export type IndexingCleanupSummary = {
  codeGraph: IndexingCleanupStats
  postings: IndexingCleanupStats
  vector?: VectorStoreCleanupStats
}

export type IndexingCompatibilityDecision = {
  action: "reuse" | "rebuild"
  reason: string
}
