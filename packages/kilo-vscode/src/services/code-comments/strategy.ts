import type { CommentStrategy } from "./types"

// 首轮 A/B 未达到发布门槛；暂保留事实正确率更高的双会话方案，不能据此宣称功能已验证。
export const PRODUCTION_COMMENT_STRATEGY: CommentStrategy = "independent-review"
