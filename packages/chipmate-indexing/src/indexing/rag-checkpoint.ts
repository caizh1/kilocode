import { createHash } from "crypto"
import path from "path"
import { v5 as uuidv5 } from "uuid"
import type { CodeBlock } from "./interfaces"
import { QDRANT_CODE_BLOCK_NAMESPACE } from "./constants"
import { generateNormalizedAbsolutePath, generateRelativeFilePath } from "./shared/get-relative-path"

export const RAG_CHECKPOINT_SCHEMA_VERSION = 1
export const RAG_PARSER_VERSION = 1
export const RAG_CHUNKER_VERSION = 1

export type RagCheckpointMeta = {
  root: string
  schemaVersion: number
  parserVersion: number
  chunkerVersion: number
  embedderProvider: string
  embedderModel: string
  embeddingDimension: number
  dimensionMode?: "auto" | "fixed"
  requestedDimension?: number
  endpointDigest?: string
  fingerprintDigest?: string
  qualityVersion?: string
  instructionVersion?: string
  vectorStoreProvider: string
  collectionName: string
  ignoreFingerprint: string
}

export type RagVectorContext = {
  workspaceId: string
  normalizedRoot: string
  runId: string
  checkpointMetaHash: string
}

export function normalizedRoot(root: string): string {
  return path.resolve(root).split(path.sep).join("/")
}

export function workspaceId(root: string): string {
  return digest(normalizedRoot(root))
}

export function checkpointMetaHash(meta: RagCheckpointMeta): string {
  return digest(JSON.stringify(meta))
}

export function checkpointMetaMatches(left?: RagCheckpointMeta, right?: RagCheckpointMeta): boolean {
  if (!left || !right) return false
  return checkpointMetaHash(left) === checkpointMetaHash(right)
}

export function checkpointCacheCompatible(left?: RagCheckpointMeta, right?: RagCheckpointMeta): boolean {
  if (!left || !right) return false
  return checkpointMetaChangedFields(left, right).every((field) => field === "ignoreFingerprint")
}

export function checkpointMetaChangedFields(left?: RagCheckpointMeta, right?: RagCheckpointMeta): string[] {
  if (!left || !right) return ["metadata"]
  const leftValues = new Map(Object.entries(left))
  const rightValues = new Map(Object.entries(right))
  const fields = new Set([...leftValues.keys(), ...rightValues.keys()])
  return [...fields].filter((field) => JSON.stringify(leftValues.get(field)) !== JSON.stringify(rightValues.get(field)))
}

export function generationForFile(meta: RagCheckpointMeta, filePath: string, fileHash: string): string {
  return digest(`${checkpointMetaHash(meta)}\0${filePath}\0${fileHash}`)
}

export function vectorContext(root: string, runId: string, meta: RagCheckpointMeta): RagVectorContext {
  return {
    workspaceId: workspaceId(root),
    normalizedRoot: normalizedRoot(root),
    runId,
    checkpointMetaHash: checkpointMetaHash(meta),
  }
}

export function fallbackCheckpointMeta(root: string): RagCheckpointMeta {
  return {
    root,
    schemaVersion: RAG_CHECKPOINT_SCHEMA_VERSION,
    parserVersion: RAG_PARSER_VERSION,
    chunkerVersion: RAG_CHUNKER_VERSION,
    embedderProvider: "unknown",
    embedderModel: "unknown",
    embeddingDimension: 0,
    vectorStoreProvider: "unknown",
    collectionName: "unknown",
    ignoreFingerprint: "unknown",
  }
}

export function pointForBlock(input: {
  block: CodeBlock
  vector: number[]
  workspace: string
  ctx: RagVectorContext
  generation: string
}) {
  const normalized = generateNormalizedAbsolutePath(input.block.file_path, input.workspace)
  const filePath = generateRelativeFilePath(normalized, input.workspace)
  const chunkHash = input.block.segmentHash
  const chunkRange = `${input.block.start_line}:${input.block.end_line}`
  const id = uuidv5(
    [input.ctx.workspaceId, filePath, input.block.fileHash, chunkHash, chunkRange, input.generation].join("\0"),
    QDRANT_CODE_BLOCK_NAMESPACE,
  )

  return {
    id,
    vector: input.vector,
    payload: {
      workspaceId: input.ctx.workspaceId,
      normalizedRoot: input.ctx.normalizedRoot,
      filePath,
      fileHash: input.block.fileHash,
      chunkHash,
      chunkRange,
      runId: input.ctx.runId,
      generation: input.generation,
      checkpointMetaHash: input.ctx.checkpointMetaHash,
      active: false,
      codeChunk: input.block.content,
      startLine: input.block.start_line,
      endLine: input.block.end_line,
      segmentHash: input.block.segmentHash,
    },
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
