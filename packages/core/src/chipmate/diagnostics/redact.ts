import { createHash } from "node:crypto"
import { errorChain, type ErrorDetail } from "./errors"

const sensitive =
  /(?:api.?key|authorization|cookie|password|passwd|secret|access.?token|refresh.?token|credential|headers?|prompt|completion|reasoning|content|body|input|output|command|arguments|env|config)$/i
const allowed =
  /^(?:code|status|statusCode|state|phase|stage|reason|finishReason|type|name|message|error|err|cause|stack|service|source|event|time|timestamp|level|runId|requestId|operationId|gatewayRequestId|parentSessionID|rootSessionID|sessionID|sessionId|messageID|modelID|providerID|model|provider|duration|elapsed|attempt|retry|count|total|size|bytes|version|platform|arch|pid|signal|exitCode|expected|enabled|available|dimension|dimensions|expectedDimension|actualDimension|tokens|inputTokens|outputTokens|cachedTokens|errorCount|staleCount|skippedCount|indexedFiles|totalFiles|runID|startedAt|completedAt|category|location|file|directory|workspace|workspaceId|profileId|remoteName|connectionState|cliHash|cliArch|windowId|truncated|dropped|textLength|reasoningLength|boundaryEligible|fallbackUsed|workerBudgetTokenLimit|budget|limit|used|result|ok|data|details|diagnostics|issueSummary|pipelines|recentErrors|notices|codeGraph|rag|documents|summary|checkedAt|httpStatus|errno|syscall|address|port|configuredDimension|dimensionMode|vectorStore|embeddingModel|hasProxy|strictSSL|extraCaConfigured|extensionVersion|vscodeVersion|packageTarget|hostname|tool|toolName|running|partial|sourceCount|records|from|to|nameHash|samples|diagnosticRunId|processedFiles|percent|lastFullScanAt|validFileCount|detail|created|completed|input|output|reasoning|cache|read|write)$/i

export function anonymous(value: string, salt = "chipmate-diagnostics") {
  return createHash("sha256").update(salt).update("\0").update(value).digest("hex").slice(0, 16)
}

export function redactText(value: string, salt = "chipmate-diagnostics", limit = 8192): string {
  const clean = value
    .replace(/(["'])(?:[A-Za-z]:[\\/]|\/)[^"'\r\n]+\1/g, (path) => maskPath(path.slice(1, -1), salt))
    .replace(/\((?:[A-Za-z]:[\\/]|\/)[^)\r\n]+\)/g, (path) => `(${maskPath(path.slice(1, -1), salt)})`)
    .replace(/\b(Bearer|Basic)\s+[^\s,;"'<>]+/gi, "$1[已脱敏]")
    .replace(
      /((?:["']?)(?:api[_-]?key|authorization|cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token|token|credential)(?:["']?)\s*[:=]\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&}\]]+)/gi,
      "$1[已脱敏]",
    )
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{8,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g, "[已脱敏]")
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => `[服务:${anonymous(url.replace(/[?#].*$/, ""), salt)}]`)
    .replace(
      /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|tmp|var|private|mnt|Volumes|workspace|workspaces|data|opt|srv|project|projects)\/)[^\s"'<>|]*/g,
      (path) => maskPath(path, salt),
    )
    .replace(/(?:\/[a-zA-Z0-9_.-]+){2,}(?:\.[a-zA-Z0-9]+)?(?::\d+(?::\d+)?)?/g, (path) => maskPath(path, salt))
  return clean.length > limit ? `${clean.slice(0, limit)}[文本已截断:${clean.length - limit}]` : clean
}

export function sanitize(value: unknown, salt = "chipmate-diagnostics", depth = 0): unknown {
  if (depth > 8) return "[层级已截断]"
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") return redactText(withoutBodies(value), salt)
  if (value instanceof Error) {
    const details = diagnosticErrors(value, [], salt)
    return { ...details[0], details }
  }
  if (Array.isArray(value))
    return [
      ...value.slice(0, 10000).map((item) => sanitize(item, salt, depth + 1)),
      ...(value.length > 10000 ? [{ truncated: value.length - 10000 }] : []),
    ]
  if (typeof value !== "object" || !value) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (sensitive.test(key) || !allowed.test(key)) continue
    if (/^(file|directory|workspace|hostname|address)$/i.test(key) && typeof item === "string") {
      result[key] = item.startsWith("[标识:")
        ? item
        : `[标识:${anonymous(item, salt)}]${item.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? ""}`
      continue
    }
    const clean = sanitize(item, salt, depth + 1)
    if (clean !== undefined) result[key] = clean
  }
  return result
}

/** 模型列表、聊天传输和通用错误日志共用同一份有界异常展开与脱敏规则。 */
export function diagnosticErrors(error: unknown, secrets: string[] = [], salt?: string): ErrorDetail[] {
  const entries = errorChain(error)
  const hosts = entries.flatMap((entry) => [entry.hostname, entry.address]).filter((value): value is string => typeof value === "string" && !!value)
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value !== "string") continue
      const clean = secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join("[凭据已脱敏]"), value)
      entry[key] = (key === "message" || key === "stack"
        ? hosts.reduce((text, host) => text.split(host).join(`[标识:${anonymous(host, salt)}]`), clean)
        : clean).slice(0, key === "stack" ? 4096 : 2048)
    }
  }
  return sanitize(entries, salt) as ErrorDetail[]
}

// 自由文本日志中的提示词、响应正文等不作为默认诊断事件保留。
export function diagnosticMessage(message: unknown, salt?: string) {
  if (typeof message !== "string") return "运行事件"
  return redactText(withoutBodies(message), salt, 2048)
}

function withoutBodies(value: string) {
  return value.replace(
    /\b(?:prompt|completion|reasoning|request body|response body|content)["']?\s*[:=][\s\S]*/gi,
    "[正文已排除]",
  )
}

// 会话附件只在用户选择后使用；独立于默认日志白名单，保留已有业务文本并再次过滤凭据。
export function redactAttachment(value: unknown, salt: string, depth = 0): unknown {
  if (depth > 12) return "[层级已截断]"
  if (typeof value === "string")
    return /^data:.*;base64,/i.test(value)
      ? "[文件内容已排除]"
      : redactText(value, salt, 64000) + (value.length > 64000 ? "[文本已截断]" : "")
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (Array.isArray(value))
    return [
      ...value
        .slice(0, 2000)
        .filter((item) => !item || typeof item !== "object" || !["file", "image", "audio"].includes(String(item.type)))
        .map((item) => redactAttachment(item, salt, depth + 1)),
      ...(value.length > 2000 ? [{ truncated: value.length - 2000 }] : []),
    ]
  if (!value || typeof value !== "object") return undefined
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) => !/(api.?key|authorization|cookie|password|secret|token|credentials|headers|url|base64)/i.test(key),
      )
      .map(([key, item]) => [key, redactAttachment(item, salt, depth + 1)]),
  )
}

function maskPath(path: string, salt: string) {
  const clean = path.replace(/[)\],;]+$/, "")
  const position = clean.match(/(?::\d+){1,2}$/)?.[0] ?? ""
  const file = position ? clean.slice(0, -position.length) : clean
  return `[路径:${anonymous(file, salt)}]${file.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? ""}${position}${path.slice(clean.length)}`
}
