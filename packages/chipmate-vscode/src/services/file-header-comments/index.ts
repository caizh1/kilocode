export { fileHeaderResultToSourceAnnotationArtifact } from "./artifact-adapter"
export { FileHeaderCommentOrchestrator } from "./orchestrator"
export {
  buildFileHeaderCommentPrompt,
  FILE_HEADER_COMMENT_SYSTEM_PROMPT,
  parseFileHeaderCommentResponse,
} from "./protocol"
export { fileHeaderTagContract, meaningfulHeader, resolveFileHeaderTarget } from "./target"
export type * from "./types"
