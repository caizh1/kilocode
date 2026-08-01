export { GENERATE_CURRENT_FUNCTION_COMMENTS_COMMAND, registerHighConfidenceCodeComments } from "./register"
export { PRODUCTION_COMMENT_STRATEGY } from "./strategy"
export { isSupportedCodeCommentLanguage, resolveFunctionTarget } from "./function-target"
export { buildValidatedCommentCandidate, parseCommentQaResponse } from "./validator"
export type {
  CodeCommentRequest,
  CommentGenerationResult,
  CommentStrategy,
  FunctionTarget,
  RawCommentProposal,
} from "./types"
