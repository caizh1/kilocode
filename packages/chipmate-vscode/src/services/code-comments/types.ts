export type CommentStrategy = "single-self-check" | "independent-review"
export type FunctionHeaderStyle = "docBlock" | "block" | "line"
export type CommentMode = "insert" | "revise"

export type CommentAnchor = {
  line: number
  kind: "function" | "controlBlock" | "statement"
  targetLineText: string
  indent: string
}

export type CommentControlRegion = {
  id: string
  startLine: number
  endLine: number
  existingCovered: boolean
  anchor?: CommentAnchor
}

export type CommentCoverageDiagnostics = {
  required: number
  covered: number
  missing: number
  coveredRegionIds: string[]
  eligibleAnchors: Array<{
    regionId: string
    line: number
    targetLineText: string
  }>
}

export type DoxygenTagContract = {
  name: string
  identity: string
  rawLine?: string
}

export type CommentComplexity = {
  lineCount: number
  controlRegionCount: number
  existingCoveredRegionCount: number
  minimumInlineComments: number
  controlRegions: CommentControlRegion[]
}

export type FunctionTarget = {
  uri: string
  filePath: string
  relativePath: string
  workspacePath: string
  languageId: "c" | "cpp"
  documentVersion: number
  documentText: string
  functionSource: string
  functionHash: string
  startIndex: number
  endIndex: number
  startLine: number
  endLine: number
  contextBefore: string
  contextAfter: string
  functionHeaderStyle: FunctionHeaderStyle
  existingFunctionHeader?: {
    startLine: number
    endLine: number
    text: string
    hash: string
    style: FunctionHeaderStyle
    tagContract: DoxygenTagContract[]
  }
  existingComments: string[]
  complexity: CommentComplexity
  anchors: CommentAnchor[]
  eol: "\n" | "\r\n"
}

export type CodeCommentRequest = {
  targets: FunctionTarget[]
  mode?: CommentMode
  model?: {
    providerID: string
    modelID: string
  }
  strategy: CommentStrategy
}

export type RawCommentProposal = {
  kind: "functionHeader" | "inline"
  operation: "insert" | "replace"
  insertBeforeLine: number
  replaceEndLine?: number
  indent: string
  commentText: string
  anchor: {
    targetLineText: string
  }
}

export type CommentCandidateBlock = {
  anchorId: string
  commentText: string
}

export type CodeCommentProgressEvent = {
  stage: "primary" | "recovery" | "review"
}

export type BatchCommentTarget = {
  target: FunctionTarget
  mode: CommentMode
}

export type BatchCommentItemResult = BatchCommentTarget & {
  result: CommentGenerationResult
}

export type BatchCommentProgress = {
  total: number
  queued: number
  running: number
  recovering: number
  completed: number
  ready: number
  failed: number
}

export type ValidatedCommentResult = {
  status: "proposed"
  quality: "complete" | "coverage-incomplete"
  coverage: CommentCoverageDiagnostics
  summary: string
  proposals: RawCommentProposal[]
  candidateComments: CommentCandidateBlock[]
}

export type CommentGenerationResult =
  | {
      status: "ready"
      target: FunctionTarget
      result: ValidatedCommentResult
      providerID: string
      modelID: string
      strategy: CommentStrategy
      rounds: number
      recovered: boolean
    }
  | {
      status: "unresolved"
      target: FunctionTarget
      reasons: string[]
      strategy: CommentStrategy
      rounds: number
    }
