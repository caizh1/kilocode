import { validateCommentOnlyDocument } from "../code-comments/apply"
import { createHash } from "node:crypto"
import type {
  CoordinatedSourceAnnotations,
  SourceAnnotationArtifact,
  SourceAnnotationFileGroup,
  SourceAnnotationOperation,
} from "./types"

export type SourceAnnotationCoordinationResult =
  | { ok: true; value: CoordinatedSourceAnnotations }
  | { ok: false; reasons: string[] }

/**
 * 合并各自已经完成事实校验的源码注释产物。
 * 这里只校验快照、编辑冲突和“非注释 token 不变”，不重新评价注释内容。
 */
export async function coordinateSourceAnnotationArtifacts(
  artifacts: readonly SourceAnnotationArtifact[],
): Promise<SourceAnnotationCoordinationResult> {
  if (artifacts.length === 0) return { ok: false, reasons: ["没有可合并的源码注释产物"] }
  const groups = new Map<string, SourceAnnotationArtifact[]>()
  for (const artifact of artifacts) {
    const current = groups.get(artifact.uri) ?? []
    current.push(artifact)
    groups.set(artifact.uri, current)
  }

  const files: SourceAnnotationFileGroup[] = []
  const reasons: string[] = []
  for (const group of groups.values()) {
    const first = group[0]!
    const normalizedOperations = normalizeBomOperationPositions(
      first.documentText,
      group.flatMap((item) => item.operations),
    )
    validateArtifactIntegrity(group, reasons)
    validateSharedSnapshot(group, reasons)
    validateTargetRanges(group, reasons)
    validateOperationConflicts(first.relativePath, normalizedOperations, reasons)
    if (reasons.length > 0) continue
    const operations = mergeSourceAnnotationOperations(normalizedOperations)
    const candidateText = buildSourceAnnotationDocument(first.documentText, first.eol, operations)
    if (!(await validateCommentOnlyDocument(first.filePath, first.documentText, candidateText))) {
      reasons.push(`${first.relativePath}：合并后的候选改变了非注释 token`)
      continue
    }
    files.push({
      uri: first.uri,
      filePath: first.filePath,
      relativePath: first.relativePath,
      languageId: first.languageId,
      documentVersion: first.documentVersion,
      documentText: first.documentText,
      documentHash: first.documentHash,
      eol: first.eol,
      artifacts: [...group],
      operations,
      candidateText,
    })
  }
  if (reasons.length > 0) return { ok: false, reasons: unique(reasons) }
  return {
    ok: true,
    value: {
      files,
      quality: artifacts.some((artifact) => artifact.quality === "coverage-incomplete")
        ? "coverage-incomplete"
        : "complete",
      diagnostics: artifacts.flatMap((artifact) => artifact.diagnostics),
    },
  }
}

function validateArtifactIntegrity(group: readonly SourceAnnotationArtifact[], reasons: string[]): void {
  for (const artifact of group) {
    if (hash(artifact.documentText) !== artifact.documentHash) {
      reasons.push(`${artifact.relativePath}：产物的完整文档哈希与源码快照不一致`)
    }
    if (
      artifact.targetStartIndex < 0 ||
      artifact.targetEndIndex <= artifact.targetStartIndex ||
      artifact.targetEndIndex > artifact.documentText.length ||
      hash(artifact.documentText.slice(artifact.targetStartIndex, artifact.targetEndIndex)) !== artifact.targetHash
    ) {
      reasons.push(`${artifact.relativePath}：目标“${artifact.displayName}”的源码哈希或范围无效`)
    }
    const lines = artifact.documentText.split(/\r?\n/u)
    for (const operation of artifact.operations) {
      if (operation.insertBeforeLine < 0 || operation.insertBeforeLine >= lines.length) {
        reasons.push(`${artifact.relativePath}：注释锚点 ${operation.anchorId} 超出文档范围`)
        continue
      }
      if (operation.operation === "insert" && lines[operation.insertBeforeLine] !== operation.targetLineText) {
        reasons.push(`${artifact.relativePath}：注释锚点 ${operation.anchorId} 与源码快照不一致`)
      }
      if (
        operation.operation === "replace" &&
        (operation.replaceEndLine === undefined ||
          operation.replaceEndLine < operation.insertBeforeLine ||
          operation.replaceEndLine >= lines.length)
      ) {
        reasons.push(`${artifact.relativePath}：注释替换范围 ${operation.anchorId} 无效`)
      }
    }
  }
}

export function buildSourceAnnotationDocument(
  documentText: string,
  eol: "\n" | "\r\n",
  operations: readonly SourceAnnotationOperation[],
): string {
  const lines = documentText.split(/\r?\n/)
  for (const operation of normalizeBomOperationPositions(documentText, operations).sort(compareOperationDescending)) {
    const deleteCount =
      operation.operation === "replace" ? operation.replaceEndLine! - operation.insertBeforeLine + 1 : 0
    const rendered = operation.commentText.split(/\r?\n/).map((line) => {
      const content = line.trimEnd()
      return content ? `${operation.indent}${content}` : operation.indent
    })
    const character = operation.insertBeforeCharacter ?? 0
    if (character > 0) {
      const current = lines[operation.insertBeforeLine] ?? ""
      rendered[0] = `${current.slice(0, character)}${rendered[0] ?? ""}`
      if (operation.operation === "insert") lines[operation.insertBeforeLine] = current.slice(character)
    }
    lines.splice(operation.insertBeforeLine, deleteCount, ...rendered)
  }
  return lines.join(eol)
}

function validateSharedSnapshot(group: readonly SourceAnnotationArtifact[], reasons: string[]): void {
  const first = group[0]!
  for (const artifact of group.slice(1)) {
    if (
      artifact.filePath !== first.filePath ||
      artifact.documentHash !== first.documentHash ||
      artifact.documentText !== first.documentText ||
      artifact.documentVersion !== first.documentVersion ||
      artifact.languageId !== first.languageId ||
      artifact.eol !== first.eol
    ) {
      reasons.push(`${first.relativePath}：源码注释产物不是基于同一份文档快照`)
    }
  }
}

function validateTargetRanges(group: readonly SourceAnnotationArtifact[], reasons: string[]): void {
  const sorted = group
    .filter((artifact) => artifact.targetScope === "syntax-target")
    .sort((left, right) => left.targetStartIndex - right.targetStartIndex)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!
    if (current.targetStartIndex < previous.targetEndIndex) {
      reasons.push(`${current.relativePath}：目标“${previous.displayName}”与“${current.displayName}”范围重叠`)
    }
  }
}

function validateOperationConflicts(
  relativePath: string,
  operations: readonly SourceAnnotationOperation[],
  reasons: string[],
): void {
  const seenAnchors = new Set<string>()
  for (const operation of operations) {
    const key = `${operation.anchorId}:${operation.insertBeforeLine}:${operation.insertBeforeCharacter ?? 0}`
    if (seenAnchors.has(key)) reasons.push(`${relativePath}：注释锚点 ${operation.anchorId} 被重复使用`)
    seenAnchors.add(key)
  }
  for (let leftIndex = 0; leftIndex < operations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < operations.length; rightIndex += 1) {
      const left = operations[leftIndex]!
      const right = operations[rightIndex]!
      if (mergeableInsertions(left, right)) {
        if (left.placement === right.placement) reasons.push(`${relativePath}：同一位置的源码注释插入层级发生冲突`)
        continue
      }
      if (composableFileHeaderReplacement(left, right)) continue
      if (operationRangesOverlap(left, right)) {
        reasons.push(`${relativePath}：源码注释编辑范围发生冲突`)
      }
    }
  }
}

export function mergeSourceAnnotationOperations(
  operations: readonly SourceAnnotationOperation[],
): SourceAnnotationOperation[] {
  const groups = new Map<number, SourceAnnotationOperation[]>()
  const result: SourceAnnotationOperation[] = []
  for (const operation of operations) {
    const key = operation.insertBeforeLine * 1_000_000 + (operation.insertBeforeCharacter ?? 0)
    const current = groups.get(key) ?? []
    current.push(operation)
    groups.set(key, current)
  }
  for (const current of groups.values()) {
    const sorted = [...current].sort((left, right) => placementRank(left.placement) - placementRank(right.placement))
    const first = sorted[0]!
    if (sorted.length === 1) {
      result.push(first)
      continue
    }
    const replacements = sorted.filter((operation) => operation.operation === "replace")
    if (
      replacements.length === 1 &&
      sorted.every((operation) => operation === replacements[0] || operation.placement === "file-header")
    ) {
      result.push({
        ...replacements[0]!,
        placement: "file-header",
        anchorId: sorted.map((operation) => operation.anchorId).join("+"),
        commentText: sorted.map((operation) => operation.commentText).join("\n\n"),
      })
      continue
    }
    result.push({
      ...first,
      anchorId: sorted.map((operation) => operation.anchorId).join("+"),
      commentText: sorted.map((operation) => operation.commentText).join("\n\n"),
    })
  }
  return result.sort(compareOperationDescending)
}

function composableFileHeaderReplacement(left: SourceAnnotationOperation, right: SourceAnnotationOperation): boolean {
  if (left.insertBeforeLine !== right.insertBeforeLine) return false
  if ((left.insertBeforeCharacter ?? 0) !== (right.insertBeforeCharacter ?? 0)) return false
  const replacement = left.operation === "replace" ? left : right.operation === "replace" ? right : undefined
  const insertion = left.operation === "insert" ? left : right.operation === "insert" ? right : undefined
  return Boolean(
    replacement &&
      insertion?.placement === "file-header" &&
      replacement.placement === "target-header" &&
      replacement.indent === insertion.indent,
  )
}

function mergeableInsertions(left: SourceAnnotationOperation, right: SourceAnnotationOperation): boolean {
  return (
    left.operation === "insert" &&
    right.operation === "insert" &&
    left.insertBeforeLine === right.insertBeforeLine &&
    (left.insertBeforeCharacter ?? 0) === (right.insertBeforeCharacter ?? 0) &&
    left.indent === right.indent &&
    left.targetLineText === right.targetLineText
  )
}

function placementRank(value: SourceAnnotationOperation["placement"]): number {
  if (value === "file-header") return 0
  if (value === "target-header") return 1
  return 2
}

function operationRangesOverlap(left: SourceAnnotationOperation, right: SourceAnnotationOperation): boolean {
  if (left.operation === "insert" && right.operation === "insert")
    return left.insertBeforeLine === right.insertBeforeLine
  const leftEnd = left.operation === "replace" ? left.replaceEndLine! : left.insertBeforeLine
  const rightEnd = right.operation === "replace" ? right.replaceEndLine! : right.insertBeforeLine
  return left.insertBeforeLine <= rightEnd && right.insertBeforeLine <= leftEnd
}

function compareOperationDescending(left: SourceAnnotationOperation, right: SourceAnnotationOperation): number {
  return (
    right.insertBeforeLine - left.insertBeforeLine ||
    (right.insertBeforeCharacter ?? 0) - (left.insertBeforeCharacter ?? 0)
  )
}

function normalizeBomOperationPositions(
  documentText: string,
  operations: readonly SourceAnnotationOperation[],
): SourceAnnotationOperation[] {
  if (!documentText.startsWith("\uFEFF")) return [...operations]
  return operations.map((operation) =>
    operation.insertBeforeLine === 0 && (operation.insertBeforeCharacter ?? 0) === 0
      ? { ...operation, insertBeforeCharacter: 1 }
      : operation,
  )
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
