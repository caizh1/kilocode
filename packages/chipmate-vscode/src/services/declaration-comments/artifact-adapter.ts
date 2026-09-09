import type { SourceAnnotationArtifact } from "../source-annotations/types"
import type { DeclarationGenerationResult } from "./types"

export function declarationResultToSourceAnnotationArtifact(
  result: Extract<DeclarationGenerationResult, { status: "ready" }>,
): SourceAnnotationArtifact {
  const target = result.target
  return {
    workflowId: "declaration",
    targetKind: target.kind,
    displayName: target.displayName,
    uri: target.uri,
    filePath: target.filePath,
    relativePath: target.relativePath,
    languageId: target.languageId,
    documentVersion: target.documentVersion,
    documentText: target.documentText,
    eol: target.eol,
    documentHash: target.documentHash,
    targetHash: target.declarationHash,
    targetStartIndex: target.startIndex,
    targetEndIndex: target.endIndex,
    targetScope: "syntax-target",
    operations: result.result.proposals.map((proposal, index) => ({
      anchorId: proposal.kind === "declarationHeader" ? "declaration" : `member-${index + 1}`,
      operation: proposal.operation,
      placement: proposal.kind === "declarationHeader" ? "target-header" : "inline",
      insertBeforeLine: proposal.insertBeforeLine,
      ...(proposal.replaceEndLine === undefined ? {} : { replaceEndLine: proposal.replaceEndLine }),
      indent: proposal.indent,
      commentText: proposal.commentText,
      targetLineText: proposal.anchor.targetLineText,
    })),
    quality: "complete",
    diagnostics: [],
    providerID: result.providerID,
    modelID: result.modelID,
    rounds: result.rounds,
  }
}
