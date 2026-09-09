import type { SourceAnnotationArtifact } from "../source-annotations/types"
import type { FileHeaderGenerationResult } from "./types"

export function fileHeaderResultToSourceAnnotationArtifact(
  result: Extract<FileHeaderGenerationResult, { status: "ready" }>,
): SourceAnnotationArtifact {
  const target = result.target
  const proposal = result.result.proposal
  return {
    workflowId: "file-header",
    targetKind: "file",
    displayName: `${target.relativePath} 模块说明`,
    uri: target.uri,
    filePath: target.filePath,
    relativePath: target.relativePath,
    languageId: target.languageId,
    documentVersion: target.documentVersion,
    documentText: target.documentText,
    eol: target.eol,
    documentHash: target.documentHash,
    targetHash: target.documentHash,
    targetStartIndex: 0,
    targetEndIndex: target.documentText.length,
    targetScope: "document",
    operations: [
      {
        anchorId: "file",
        operation: proposal.operation,
        placement: "file-header",
        insertBeforeLine: proposal.insertBeforeLine,
        ...(proposal.replaceEndLine === undefined ? {} : { replaceEndLine: proposal.replaceEndLine }),
        indent: proposal.indent,
        commentText: proposal.commentText,
        targetLineText: proposal.targetLineText,
      },
    ],
    quality: "complete",
    diagnostics: [],
    providerID: result.providerID,
    modelID: result.modelID,
    rounds: result.rounds,
  }
}
