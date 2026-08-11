import type { EmbeddedReviewScope } from "./types"

export class EmbeddedReviewScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmbeddedReviewScopeError"
  }
}

export function requestedScope(input: string): { kind: "uncommitted" } | { kind: "commit"; requested: string } {
  const value = input.trim()
  if (!value || value === "uncommitted") return { kind: "uncommitted" }
  if (/\s/.test(value)) {
    throw new EmbeddedReviewScopeError("Embedded Review V1 只接受空参数、`uncommitted` 或一个十六进制 commit ID。")
  }
  if (value.startsWith("-") || !/^[0-9a-fA-F]{4,64}$/.test(value)) {
    throw new EmbeddedReviewScopeError("Embedded Review V1 不支持分支、ref、拉取请求、指导文本或类似选项的目标。")
  }
  return { kind: "commit", requested: value }
}

export function scopeLabel(scope: EmbeddedReviewScope) {
  if (scope.kind === "uncommitted") return "未提交变更"
  return `commit ${scope.commit}`
}
