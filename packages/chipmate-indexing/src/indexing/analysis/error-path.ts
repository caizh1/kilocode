import type {
  ErrorPathBranchKind,
  ErrorPathEvidence,
  EvidenceBudget,
  EvidenceConfidence,
  EvidenceRef,
  QueryEvidenceAnswerPolicy,
  QueryEvidenceErrorPathIntentTrace,
} from "./types"

const guidance =
  "Do not make code-level conclusions unless the answer is grounded in file path and line-number evidence returned by codebase_analysis."

const MAX_ERROR_PATH_ITEMS = 8
const MAX_CLEANUP_CALLS_PER_PATH = 6

const phrases = [
  "error path",
  "cleanup path",
  "error handling",
  "failure path",
  "return error",
  "error return",
  "goto fail",
  "goto error",
  "resource cleanup",
  "release resource",
  "unwind path",
  "rollback path",
  "fail label",
  "cleanup label",
  "错误路径",
  "异常路径",
  "失败路径",
  "错误处理",
  "清理路径",
  "资源释放",
  "返回错误",
  "失败后怎么处理",
  "错误标签",
  "释放资源",
]

const words = ["cleanup"]

export type ErrorPathBuildResult = {
  trace: QueryEvidenceErrorPathIntentTrace
  refs: EvidenceRef[]
  paths: ErrorPathEvidence[]
}

export function buildErrorPaths(input: {
  query: string
  refs: EvidenceRef[]
  budget: EvidenceBudget
}): ErrorPathBuildResult {
  const matched = keywords(input.query)
  const counts = count(input.refs)
  if (matched.length === 0) {
    return {
      trace: {
        enabled: false,
        reason: "intent-not-matched",
        matchedKeywords: [],
        ...counts,
        generatedCount: 0,
        droppedByBudget: 0,
        limitations: [],
      },
      refs: [],
      paths: [],
    }
  }

  const candidates = input.refs.flatMap((item) => path(item)).filter((item) => item !== undefined)
  const max = Math.min(MAX_ERROR_PATH_ITEMS, input.budget.maxEvidenceItems)
  const kept = candidates.slice(0, max)
  const refs = kept.map((item) => item.ref)
  const paths = kept.map((item) => item.path)
  const dropped = Math.max(0, candidates.length - kept.length)
  const limitations = [...new Set(paths.flatMap((item) => item.limitations))]

  return {
    trace: {
      enabled: true,
      reason: paths.length > 0 ? "intent-matched-line-backed-evidence" : "intent-matched-no-line-backed-evidence",
      matchedKeywords: matched,
      ...counts,
      generatedCount: paths.length,
      droppedByBudget: dropped,
      limitations:
        paths.length > 0 ? limitations : ["No source-backed error/cleanup path evidence was returned for this query."],
    },
    refs,
    paths,
  }
}

export function policyForErrorPaths(paths: ErrorPathEvidence[]): QueryEvidenceAnswerPolicy {
  if (paths.length === 0) {
    return {
      mode: "conservative",
      confidence: "none",
      allowed: false,
      requiresCitations: true,
      reason: "No source-backed error/cleanup path evidence with file paths and line numbers was returned.",
      guidance,
    }
  }

  const conf = confidence(paths)
  return {
    mode: "grounded",
    confidence: conf,
    allowed: true,
    requiresCitations: true,
    reason: "Source-backed error/cleanup path evidence with file paths and line numbers was returned.",
    guidance,
  }
}

export function errorPathLines(paths: ErrorPathEvidence[]): string[] {
  if (paths.length === 0) {
    return [
      "- No source-backed error/cleanup path evidence matched this query.",
      "- No file path and line-number evidence was returned for an error or cleanup path.",
    ]
  }

  return paths.map((item) => {
    const name = item.functionName ?? item.labelName ?? item.id
    const calls = item.cleanupCalls.length > 0 ? ` cleanupCalls="${xml(item.cleanupCalls.join(", "))}"` : ""
    const ret = item.returnStyle ? ` returnStyle="${xml(item.returnStyle)}"` : ""
    const limits = item.limitations.length > 0 ? ` limitations="${xml(item.limitations.join("; "))}"` : ""
    return `- [error-path:${item.branchKind}] ${xml(item.filePath)}:${item.startLine}-${item.endLine} name="${xml(name)}" confidence="${item.confidence}"${calls}${ret}${limits}`
  })
}

function path(item: EvidenceRef): { ref: EvidenceRef; path: ErrorPathEvidence } | undefined {
  if (!range(item)) return undefined

  const kind = branch(item)
  if (!kind) return undefined

  const source = item.source
  const conf =
    source === "vector"
      ? "low"
      : source === "bm25"
        ? item.confidence === "high"
          ? "medium"
          : "low"
        : kind === "unknown"
          ? "medium"
          : "high"
  const calls = (item.cleanupCalls ?? callsFrom(item)).slice(0, MAX_CLEANUP_CALLS_PER_PATH)
  const ref = errorRef(item, kind, conf, calls)
  const limitations = limits(item, kind)

  return {
    ref,
    path: {
      id: `path_${hash([item.id, item.filePath, item.startLine, item.endLine, kind].join(":")).slice(0, 16)}`,
      ...(item.functionName ? { functionName: item.functionName } : {}),
      ...(item.labelName ? { labelName: item.labelName } : {}),
      branchKind: kind,
      cleanupCalls: calls,
      ...(item.returnStyle ? { returnStyle: item.returnStyle } : {}),
      filePath: item.filePath,
      startLine: item.startLine,
      endLine: item.endLine,
      confidence: conf,
      limitations,
      backingEvidenceRefs: [item.id, ref.id],
    },
  }
}

function errorRef(
  item: EvidenceRef,
  branch: ErrorPathBranchKind,
  conf: Exclude<EvidenceConfidence, "none">,
  calls: string[],
): EvidenceRef {
  const cleanup = branch === "cleanup-call" || calls.length > 0
  const id = `error_${hash([item.id, branch, item.filePath, item.startLine, item.endLine].join(":")).slice(0, 16)}`
  return {
    ...item,
    id,
    kind: cleanup ? "cleanup-path" : "error-path",
    confidence: conf,
    reason: `${cleanup ? "cleanup" : "error"} path evidence derived from ${item.source} candidate`,
    displayName:
      item.displayName ??
      item.functionName ??
      item.labelName ??
      item.symbolName ??
      `${item.filePath}:${item.startLine}`,
    ...(calls.length > 0 ? { cleanupCalls: calls } : {}),
  }
}

function branch(item: EvidenceRef): ErrorPathBranchKind | undefined {
  const text = blob(item)
  if (item.kind === "error_label") return item.cleanupCalls?.length ? "cleanup-call" : "error-label"
  if (item.labelName && /err|fail|cleanup|out/i.test(item.labelName))
    return item.cleanupCalls?.length ? "cleanup-call" : "error-label"
  if ((item.cleanupCalls?.length ?? 0) > 0) return "cleanup-call"
  if (item.returnStyle && /return\s+[-\w]+|return\s+.*err|return\s+.*rc/i.test(item.returnStyle)) return "return-error"
  if (/\bgoto\s+(err|fail|cleanup|out)/i.test(text)) return "goto-label"
  if (/\b(cleanup|release|free|close|destroy|unmap|put|disable)_?\w*\b/i.test(text)) return "cleanup-call"
  if (/\b(rollback|unwind)\b/i.test(text)) return "unknown"
  if (/\b(error|failure|fail|errno|eio|enomem|einval|return\s+[-\w]+)\b/i.test(text))
    return item.source === "vector" || item.source === "bm25" ? "unknown" : "return-error"
  return undefined
}

function callsFrom(item: EvidenceRef): string[] {
  const text = blob(item)
  const out = new Set<string>()
  for (const match of text.matchAll(/\b(?:cleanup|release|free|close|destroy|unmap|put|disable)_?[A-Za-z0-9_]*\b/g)) {
    out.add(match[0])
  }
  return [...out]
}

function limits(item: EvidenceRef, kind: ErrorPathBranchKind): string[] {
  if (item.source === "vector") {
    return ["Only semantic/vector evidence supports this path; verify with source reads."]
  }
  if (item.source === "bm25") {
    return ["Lexical evidence can identify relevant error/cleanup text but does not prove control flow by itself."]
  }
  if (kind === "unknown") {
    return ["Graph evidence is line-backed but the exact error branch kind is ambiguous."]
  }
  return []
}

function confidence(paths: ErrorPathEvidence[]): Exclude<EvidenceConfidence, "none"> {
  if (paths.some((item) => item.confidence === "high")) return "high"
  if (paths.some((item) => item.confidence === "medium")) return "medium"
  return "low"
}

function count(refs: EvidenceRef[]) {
  return {
    graphCandidateCount: refs.filter((item) => item.source === "graph").length,
    bm25CandidateCount: refs.filter((item) => item.source === "bm25").length,
    vectorCandidateCount: refs.filter((item) => item.source === "vector").length,
  }
}

function keywords(query: string): string[] {
  const lower = query.toLowerCase()
  const matched = phrases.filter((item) => lower.includes(item.toLowerCase()))
  for (const item of words) {
    if (new RegExp(`(?:^|[^A-Za-z0-9_])${item}(?:$|[^A-Za-z0-9_])`, "i").test(query)) {
      matched.push(item)
    }
  }
  return [...new Set(matched)]
}

function range(item: EvidenceRef): boolean {
  return (
    Number.isFinite(item.startLine) &&
    Number.isFinite(item.endLine) &&
    item.startLine > 0 &&
    item.endLine >= item.startLine
  )
}

function blob(item: EvidenceRef): string {
  return [
    item.kind,
    item.reason,
    item.symbolName,
    item.functionName,
    item.labelName,
    item.displayName,
    item.callerName,
    item.calleeName,
    item.returnStyle,
    item.shortSnippet,
    item.snippet,
    item.cleanupCalls?.join(" "),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
}

function hash(value: string): string {
  let out = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    out ^= value.charCodeAt(index)
    out = Math.imul(out, 0x01000193)
  }
  return (out >>> 0).toString(16).padStart(8, "0")
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
