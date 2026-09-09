import type { GitDiffSourceAnnotationScope } from "./types"

/**
 * 未来 Git Diff 源码注释工作流的确定性输出范围契约。
 * 当前版本只固化边界，不创建 Diff 工作流或 Code Review 评论。
 */
export function isGitDiffSourceAnnotationAnchorAllowed(input: {
  line: number
  scope: GitDiffSourceAnnotationScope
  newDeclarationHeader?: boolean
}): boolean {
  if (input.scope.changedAfterLines.has(input.line)) return true
  if (!input.newDeclarationHeader) return false
  return input.scope.hunkRanges.some((range) => input.line === range.startLine || input.line + 1 === range.startLine)
}
