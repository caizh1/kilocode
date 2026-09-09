import type { SourceAnnotationArtifact } from "../source-annotations/types"
import type { LogicBlockGenerationResult } from "./types"

export function logicBlockResultToSourceAnnotationArtifact(
  result: Extract<LogicBlockGenerationResult, { status: "ready" }>,
): SourceAnnotationArtifact {
  const target = result.target
  return {
    workflowId: "logic-block",
    targetKind: "logic-block",
    displayName: `${target.displayName} 逻辑块`,
    uri: target.uri,
    filePath: target.filePath,
    relativePath: target.relativePath,
    languageId: target.languageId,
    documentVersion: target.documentVersion,
    documentText: target.documentText,
    eol: target.eol,
    documentHash: target.documentHash,
    targetHash: target.targetHash,
    targetStartIndex: target.startIndex,
    targetEndIndex: target.endIndex,
    targetScope: "syntax-target",
    operations: result.result.proposals.map((proposal) => ({
      anchorId: proposal.anchorId,
      operation: "insert",
      placement: "inline",
      insertBeforeLine: proposal.insertBeforeLine,
      indent: proposal.indent,
      commentText: proposal.commentText,
      targetLineText: proposal.targetLineText,
    })),
    quality: "complete",
    diagnostics: [],
    providerID: result.providerID,
    modelID: result.modelID,
    rounds: result.rounds,
  }
}
