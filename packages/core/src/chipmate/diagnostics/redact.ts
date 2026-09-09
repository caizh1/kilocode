import { createHash } from "node:crypto"

const sensitive = /(?:api.?key|authorization|cookie|password|passwd|secret|access.?token|refresh.?token|credential|headers?|prompt|completion|reasoning|content|body|input|output|command|arguments|env|config)$/i
const allowed = /^(?:code|status|statusCode|state|phase|stage|reason|finishReason|type|name|message|error|cause|stack|service|source|event|time|timestamp|level|runId|requestId|operationId|sessionID|sessionId|messageID|modelID|providerID|model|provider|duration|elapsed|attempt|retry|count|total|size|bytes|version|platform|arch|pid|signal|exitCode|expected|enabled|available|dimension|dimensions|expectedDimension|actualDimension|tokens|inputTokens|outputTokens|cachedTokens|errorCount|staleCount|skippedCount|indexedFiles|totalFiles|runID|startedAt|completedAt|category|location|file|directory|workspace|workspaceId|profileId|remoteName|connectionState|cliHash|cliArch|windowId|truncated|dropped|textLength|reasoningLength|boundaryEligible|fallbackUsed|workerBudgetTokenLimit|budget|limit|used|result|ok|data|details|diagnostics|issueSummary|pipelines|recentErrors|notices|codeGraph|rag|documents|summary|checkedAt|httpStatus|errno|syscall|address|port|configuredDimension|dimensionMode|vectorStore|embeddingModel|hasProxy|strictSSL|extraCaConfigured|extensionVersion|vscodeVersion|packageTarget|hostname|tool|toolName|running|partial|sourceCount|records|from|to|nameHash)$/i

export function anonymous(value: string, salt = "chipmate-diagnostics") {
  return createHash("sha256").update(salt).update("\0").update(value).digest("hex").slice(0, 16)
}

export function redactText(value: string, salt = "chipmate-diagnostics", limit = 8192): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[^\s,;"'<>]+/gi, "$1[已脱敏]")
    .replace(/((?:["']?)(?:api[_-]?key|authorization|cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token|token|credential)(?:["']?)\s*[:=]\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&}\]]+)/gi, "$1[已脱敏]")
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{8,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g, "[已脱敏]")
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => `[服务:${anonymous(url.replace(/[?#].*$/, ""), salt)}]`)
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|tmp|var|private|mnt|Volumes|workspace|workspaces)\/)[^\s"'<>|]*/g, (path) => `[路径:${anonymous(path, salt)}]`)
    .slice(0, limit)
}

export function sanitize(value: unknown, salt = "chipmate-diagnostics", depth = 0): unknown {
  if (depth > 8) return "[层级已截断]"
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") return redactText(value, salt)
  if (value instanceof Error) return sanitize({ name: value.name, message: value.message, stack: value.stack, cause: value.cause }, salt, depth + 1)
  if (Array.isArray(value)) return value.slice(0, 10000).map((item) => sanitize(item, salt, depth + 1))
  if (typeof value !== "object" || !value) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (sensitive.test(key) || !allowed.test(key)) continue
    if (/^(file|directory|workspace|hostname|address)$/i.test(key) && typeof item === "string") {
      result[key] = `[标识:${anonymous(item, salt)}]`
      continue
    }
    const clean = sanitize(item, salt, depth + 1)
    if (clean !== undefined) result[key] = clean
  }
  return result
}

// 自由文本日志中的提示词、响应正文等不作为默认诊断事件保留。
export function diagnosticMessage(message: unknown, salt?: string) {
  if (typeof message !== "string") return "运行事件"
  return redactText(message.replace(/\b(?:prompt|completion|reasoning|request body|response body|content)\s*[:=][\s\S]*/gi, "[正文已排除]"), salt, 2048)
}
