export type DeclarationHeaderStyle = "docBlock" | "block" | "line"

export type DeclarationDoxygenTagContract = Readonly<{
  name: string
  identity: string
  rawLine?: string
}>

export type DeclarationKind =
  | "struct"
  | "union"
  | "enum"
  | "typedef"
  | "global-variable"
  | "object-macro"
  | "function-macro"

export type DeclarationTargetInput = {
  uri: string
  filePath: string
  relativePath: string
  workspacePath: string
  languageId: string
  documentVersion: number
  documentText: string
  cursorOffset: number
  eol: "\n" | "\r\n"
}

export type DeclarationTargetRangeInput = Omit<DeclarationTargetInput, "cursorOffset"> & {
  selectionStartOffset: number
  selectionEndOffset: number
}

export type DeclarationMemberAnchor = Readonly<{
  id: string
  kind: "field" | "enumerator"
  label: string
  startLine: number
  endLine: number
  insertBeforeLine: number
  targetLineText: string
  indent: string
  existingCovered: boolean
}>

export type DeclarationTarget = Readonly<{
  uri: string
  filePath: string
  relativePath: string
  workspacePath: string
  languageId: "c" | "cpp"
  documentVersion: number
  documentText: string
  eol: "\n" | "\r\n"
  kind: DeclarationKind
  displayName: string
  declarationSource: string
  declarationHash: string
  documentHash: string
  startIndex: number
  endIndex: number
  startLine: number
  endLine: number
  contextBefore: string
  contextAfter: string
  headerStyle: DeclarationHeaderStyle
  existingHeader?: Readonly<{
    startLine: number
    endLine: number
    text: string
    hash: string
    style: DeclarationHeaderStyle
    tagContract: readonly DeclarationDoxygenTagContract[]
  }>
  existingComments: readonly string[]
  memberAnchors: readonly DeclarationMemberAnchor[]
}>

export type DeclarationCommentBlock = Readonly<{
  anchorId: string
  commentText: string
}>

export type DeclarationCommentProposal = Readonly<{
  kind: "declarationHeader" | "member"
  operation: "insert" | "replace"
  insertBeforeLine: number
  replaceEndLine?: number
  indent: string
  commentText: string
  anchor: Readonly<{ targetLineText: string }>
}>

export type ValidatedDeclarationComments = Readonly<{
  summary: string
  proposals: readonly DeclarationCommentProposal[]
  candidateComments: readonly DeclarationCommentBlock[]
}>

export type DeclarationGenerationResult =
  | Readonly<{
      status: "ready"
      target: DeclarationTarget
      result: ValidatedDeclarationComments
      providerID: string
      modelID: string
      rounds: number
      recovered: boolean
    }>
  | Readonly<{
      status: "unresolved"
      target: DeclarationTarget
      reasons: readonly string[]
      rounds: number
    }>
