export type FileHeaderStyle = "docBlock" | "block" | "line"

export type FileHeaderTagContract = Readonly<{
  name: string
  identity: string
  rawLine?: string
}>

export type FileHeaderTarget = Readonly<{
  uri: string
  filePath: string
  relativePath: string
  workspacePath: string
  languageId: "c" | "cpp"
  documentVersion: number
  documentText: string
  documentHash: string
  eol: "\n" | "\r\n"
  anchorLine: number
  anchorLineText: string
  style: FileHeaderStyle
  evidence: string
  existingHeader?: Readonly<{
    startLine: number
    endLine: number
    text: string
    style: FileHeaderStyle
    tagContract: readonly FileHeaderTagContract[]
    meaningful: boolean
  }>
}>

export type FileHeaderCommentBlock = Readonly<{
  anchorId: "file"
  commentText: string
}>

export type ValidatedFileHeaderComment = Readonly<{
  summary: string
  comment: FileHeaderCommentBlock
  proposal: Readonly<{
    operation: "insert" | "replace"
    insertBeforeLine: number
    replaceEndLine?: number
    indent: string
    commentText: string
    targetLineText: string
  }>
}>

export type FileHeaderGenerationResult =
  | Readonly<{
      status: "ready"
      target: FileHeaderTarget
      result: ValidatedFileHeaderComment
      providerID: string
      modelID: string
      rounds: number
      recovered: boolean
    }>
  | Readonly<{
      status: "unresolved"
      target: FileHeaderTarget
      reasons: readonly string[]
      rounds: number
    }>
