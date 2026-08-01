export type CommentStrategy = "single-self-check" | "independent-review"
export type FunctionHeaderStyle = "docBlock" | "block" | "line"

export type CommentAnchor = {
  line: number
  kind: "function" | "controlBlock" | "statement"
  targetLineText: string
  indent: string
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
  existingComments: string[]
  anchors: CommentAnchor[]
  eol: "\n" | "\r\n"
}

export type CodeCommentRequest = {
  targets: FunctionTarget[]
  model?: {
    providerID: string
    modelID: string
  }
  strategy: CommentStrategy
}

export type RawCommentProposal = {
  kind: "functionHeader" | "inline"
  insertBeforeLine: number
  indent: string
  commentText: string
  anchor: {
    targetLineText: string
  }
}

export type ValidatedCommentResult = {
  status: "proposed" | "skip"
  summary: string
  proposals: RawCommentProposal[]
  patch?: string
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
      status: "skip"
      target: FunctionTarget
      summary: string
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
