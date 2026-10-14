const fields = ["name", "message", "stack", "code", "errno", "syscall", "hostname", "address", "port"] as const
export type ErrorDetail = Record<string, string | number | boolean>

function read(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key)
  } catch {
    return "[字段读取失败]"
  }
}

/** 只展开错误白名单字段；不读取请求正文、响应正文或凭据。 */
export function errorChain(error: unknown): ErrorDetail[] {
  const seen = new Set<object>()
  const entries: ErrorDetail[] = []
  function visit(value: unknown, location: string, depth: number) {
    if (entries.length >= 24) return
    if (depth > 8) {
      entries.push({ location, message: "[异常层级已截断]", truncated: true })
      return
    }
    if (!value || typeof value !== "object") {
      entries.push({ location, message: String(value).slice(0, 2048) })
      return
    }
    if (seen.has(value)) {
      entries.push({ location, message: "[循环或重复异常引用]" })
      return
    }
    seen.add(value)
    const entry: ErrorDetail = { location }
    for (const key of fields) {
      const item = read(value, key)
      if (typeof item === "string" || typeof item === "number") entry[key] = item
    }
    const status = read(value, "statusCode") ?? read(value, "status")
    if (typeof status === "number") {
      entry.httpStatus = status
      // SDK 的 HTTP 错误消息可能拼入完整响应正文。
      entry.message = `HTTP ${status}`
      delete entry.stack
    }
    if (/^(?:AI_)?(?:JSONParseError|TypeValidationError|InvalidResponseDataError)$/.test(String(entry.name))) {
      entry.message = "模型响应格式不符合协议，原始正文已排除"
      delete entry.stack
    }
    entries.push(entry)
    const cause = read(value, "cause")
    if (cause !== undefined) visit(cause, `${location}.cause`, depth + 1)
    const errors = read(value, "errors")
    if (Array.isArray(errors)) {
      const length = read(errors, "length")
      if (typeof length !== "number") entry.truncated = true
      else {
        for (let index = 0; index < Math.min(length, 16); index++)
          visit(read(errors, String(index)), `${location}.errors[${index}]`, depth + 1)
        if (length > 16) entry.truncated = true
      }
    }
  }
  visit(error, "error", 0)
  if (entries.length >= 24) entries[entries.length - 1]!.truncated = true
  return entries
}

/** 分类只使用实际响应状态和底层错误证据，不能从连接提示推断网关内部原因。 */
export function errorCategory(error: unknown) {
  const entries = errorChain(error)
  const status = entries.find((entry) => typeof entry.httpStatus === "number")?.httpStatus
  if (status === 401 || status === 403) return "鉴权失败"
  if (status === 429) return "请求限流"
  if (typeof status === "number" && status >= 500) return "服务端错误"
  if (status === 408) return "请求超时"
  if (typeof status === "number" && status >= 400) return "请求错误"
  const text = entries.map((entry) => `${entry.name ?? ""} ${entry.code ?? ""} ${entry.message ?? ""}`).join("\n")
  if (/CERT_|CERTIFICATE|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|TLS.*(?:fail|invalid|error)|certificate/i.test(text))
    return "证书错误"
  if (/TimeoutError|TIMEDOUT|TIMEOUT|timed out|timeout/i.test(text)) return "请求超时"
  if (/AbortError|ABORT_ERR/.test(text)) return "用户取消"
  if (/EngineCore encountered an issue/i.test(text)) return "推理服务错误"
  if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(text)) return "域名解析失败"
  if (/ConnectionRefused|ECONNREFUSED|FailedToOpenSocket|ENETUNREACH|EHOSTUNREACH|ENETDOWN/i.test(text))
    return "连接失败"
  if (
    /ConnectionClosed|ECONNRESET|EPIPE|UND_ERR_SOCKET|socket hang up|connection (?:closed|reset|terminated)/i.test(text)
  )
    return "连接中断"
  return "原因未明"
}
