export function marketplaceIdentityErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/token-resolver-disabled/i.test(message)) {
    return "ChipMate Server 未启用 New API token resolver，请检查服务端 NEW_API_BASE_URL、NEW_API_ADMIN_ACCESS_TOKEN 和 NEW_API_USER_ID。"
  }
  if (/token-not-found/i.test(message)) return "当前 API Key 没有匹配到 @chipmate 用户。"
  if (/invalid-api-key/i.test(message)) return "API Key 格式无效。"
  if (/aborted|aborterror|operation was aborted/i.test(message)) return "连接 ChipMate Server 超时或被中止。"
  if (/failed to fetch|fetch failed|econnrefused|enotfound|network/i.test(message)) {
    return "无法连接 ChipMate Server，请确认 marketplace baseUrl 和服务状态。"
  }
  if (/^HTTP 404/i.test(message)) return "ChipMate Server 未找到用户反查接口。"
  if (/^HTTP 5\d\d/i.test(message) || /new-api-error/i.test(message)) {
    return "ChipMate Server 调用 New API 失败，请检查服务端日志和 admin token 配置。"
  }
  return message || "未知错误。"
}
