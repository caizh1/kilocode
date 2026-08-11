export {
  GENERATE_CURRENT_FUNCTION_COMMENTS_COMMAND,
  GENERATE_SELECTED_FUNCTION_COMMENTS_COMMAND,
  registerHighConfidenceCodeComments,
} from "./register"
export { PRODUCTION_COMMENT_STRATEGY } from "./strategy"
export { isSupportedCodeCommentLanguage, resolveFunctionTarget, resolveFunctionTargetsInRange } from "./function-target"
export { BATCH_COMMENT_CONCURRENCY, MAX_BATCH_COMMENT_TARGETS, generateCommentBatch } from "./batch"
export { buildValidatedCommentCandidate, parseCommentQaResponse } from "./validator"
export {
  APPLY_CODE_COMMENT_PREVIEW_COMMAND,
  CODE_COMMENT_PREVIEW_PENDING_CONTEXT,
  CODE_COMMENT_PREVIEW_SCHEME,
  CodeCommentPreviewController,
  DISCARD_CODE_COMMENT_PREVIEW_COMMAND,
} from "./preview-controller"
export type {
  CodeCommentRequest,
  CommentMode,
  CommentGenerationResult,
  CommentStrategy,
  FunctionTarget,
  RawCommentProposal,
} from "./types"
