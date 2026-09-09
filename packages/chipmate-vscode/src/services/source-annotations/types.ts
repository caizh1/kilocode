export type SourceAnnotationWorkflowId =
  | "function"
  | "declaration"
  | "file-header"
  | "logic-block"
  | "whole-file"
  | "git-diff"

export type SourceAnnotationTargetKind =
  | "function"
  | "struct"
  | "union"
  | "enum"
  | "typedef"
  | "global-variable"
  | "object-macro"
  | "function-macro"
  | "file"
  | "logic-block"

export type SourceAnnotationQuality = "complete" | "coverage-incomplete"

export type SourceAnnotationOperation = Readonly<{
  anchorId: string
  operation: "insert" | "replace"
  placement: "file-header" | "target-header" | "inline"
  insertBeforeLine: number
  insertBeforeCharacter?: number
  replaceEndLine?: number
  indent: string
  commentText: string
  targetLineText: string
}>

/**
 * 独立源码注释流水线交给外层协调器的只读产物。
 *
 * 产物只表达已由所属流水线验证过的注释操作；协调器不会重新判断注释事实。
 */
export type SourceAnnotationArtifact = Readonly<{
  workflowId: SourceAnnotationWorkflowId
  targetKind: SourceAnnotationTargetKind
  displayName: string
  uri: string
  filePath: string
  relativePath: string
  languageId: "c" | "cpp"
  documentVersion: number
  documentText: string
  eol: "\n" | "\r\n"
  documentHash: string
  targetHash: string
  targetStartIndex: number
  targetEndIndex: number
  targetScope: "syntax-target" | "document"
  operations: readonly SourceAnnotationOperation[]
  quality: SourceAnnotationQuality
  diagnostics: readonly string[]
  providerID: string
  modelID: string
  rounds: number
}>

export type SourceAnnotationFileGroup = Readonly<{
  uri: string
  filePath: string
  relativePath: string
  languageId: "c" | "cpp"
  documentVersion: number
  documentText: string
  documentHash: string
  eol: "\n" | "\r\n"
  artifacts: readonly SourceAnnotationArtifact[]
  operations: readonly SourceAnnotationOperation[]
  candidateText: string
}>

export type CoordinatedSourceAnnotations = Readonly<{
  files: readonly SourceAnnotationFileGroup[]
  quality: SourceAnnotationQuality
  diagnostics: readonly string[]
}>

/** 为未来 Git Diff 源码注释保留的范围契约；本版本不提供对应工作流。 */
export type GitDiffSourceAnnotationScope = Readonly<{
  baseline: string
  current: string
  changedAfterLines: ReadonlySet<number>
  hunkRanges: readonly Readonly<{ startLine: number; endLine: number }>[]
}>
