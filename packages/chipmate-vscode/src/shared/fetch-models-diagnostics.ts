export { diagnosticErrors as modelFetchErrors } from "@opencode-ai/core/chipmate/diagnostics/redact"

export type ModelFetchDiagnostic = {
  phase: "开始" | "收到响应" | "成功" | "失败"
  stage: "连接与响应头" | "响应正文" | "解析模型"
  elapsed: number
  budget: number
  httpStatus?: number
  count?: number
  details?: unknown
}
