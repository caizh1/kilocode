import type { CommentStrategy } from "./types"

// 默认与普通 Code QA 一样只执行一次模型调用；格式或确定性校验失败时由编排器按需恢复。
export const PRODUCTION_COMMENT_STRATEGY: CommentStrategy = "single-self-check"
