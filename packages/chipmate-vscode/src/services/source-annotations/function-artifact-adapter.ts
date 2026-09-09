import { sha256 } from "../code-comments/function-target"
import type { FunctionTarget, ValidatedCommentResult } from "../code-comments/types"
import type { SourceAnnotationArtifact } from "./types"

/** 只读适配冻结的函数流水线结果，不改变函数候选或质量判断。 */
export function functionResultToSourceAnnotationArtifact(input: {
  target: FunctionTarget
  result: ValidatedCommentResult
  providerID: string
  modelID: string
  rounds: number
}): SourceAnnotationArtifact {
  return {
    workflowId: "function",
    targetKind: "function",
    displayName: functionDisplayName(input.target),
    uri: input.target.uri,
    filePath: input.target.filePath,
    relativePath: input.target.relativePath,
    languageId: input.target.languageId,
    documentVersion: input.target.documentVersion,
    documentText: input.target.documentText,
    eol: input.target.eol,
    documentHash: sha256(input.target.documentText),
    targetHash: input.target.functionHash,
    targetStartIndex: input.target.startIndex,
    targetEndIndex: input.target.endIndex,
    targetScope: "syntax-target",
    operations: input.result.proposals.map((proposal, index) => ({
      anchorId: proposal.kind === "functionHeader" ? "function" : `function-inline-${index + 1}`,
      operation: proposal.operation,
      placement: proposal.kind === "functionHeader" ? "target-header" : "inline",
      insertBeforeLine: proposal.insertBeforeLine,
      ...(proposal.replaceEndLine === undefined ? {} : { replaceEndLine: proposal.replaceEndLine }),
      indent: proposal.indent,
      commentText: proposal.commentText,
      targetLineText: proposal.anchor.targetLineText,
    })),
    quality: input.result.quality,
    diagnostics:
      input.result.quality === "coverage-incomplete"
        ? [`复杂逻辑覆盖不足：目标 ${input.result.coverage.required} 个区域，当前 ${input.result.coverage.covered} 个`]
        : [],
    providerID: input.providerID,
    modelID: input.modelID,
    rounds: input.rounds,
  }
}

function functionDisplayName(target: FunctionTarget): string {
  const match = target.functionSource.match(/([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:\{|$)/u)
  return match?.[1] ?? `第 ${target.startLine + 1} 行函数`
}
