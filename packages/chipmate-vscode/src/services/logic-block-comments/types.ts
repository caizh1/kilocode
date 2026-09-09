export type LogicBlockAnchor = Readonly<{
  id: string
  kind: "control" | "exit" | "statement" | "declaration"
  nodeType: string
  startLine: number
  endLine: number
  insertBeforeLine: number
  targetLineText: string
  indent: string
  source: string
}>

export type LogicBlockTarget = Readonly<{
  uri: string
  filePath: string
  relativePath: string
  workspacePath: string
  languageId: "c" | "cpp"
  documentVersion: number
  documentText: string
  documentHash: string
  eol: "\n" | "\r\n"
  displayName: string
  functionSource: string
  selectedSource: string
  targetHash: string
  startIndex: number
  endIndex: number
  startLine: number
  endLine: number
  anchors: readonly LogicBlockAnchor[]
  existingComments: readonly string[]
  detailTarget: number
}>

export type LogicBlockComment = Readonly<{
  anchorId: string
  commentText: string
}>

export type LogicBlockProposal = Readonly<{
  anchorId: string
  insertBeforeLine: number
  indent: string
  commentText: string
  targetLineText: string
}>

export type ValidatedLogicBlockComments = Readonly<{
  summary: string
  proposals: readonly LogicBlockProposal[]
  candidateComments: readonly LogicBlockComment[]
}>

export type LogicBlockGenerationResult =
  | Readonly<{
      status: "ready"
      target: LogicBlockTarget
      result: ValidatedLogicBlockComments
      providerID: string
      modelID: string
      rounds: number
      recovered: boolean
    }>
  | Readonly<{
      status: "not-needed"
      target: LogicBlockTarget
      summary: string
      providerID: string
      modelID: string
      rounds: number
    }>
  | Readonly<{
      status: "unresolved"
      target: LogicBlockTarget
      reasons: readonly string[]
      rounds: number
    }>
