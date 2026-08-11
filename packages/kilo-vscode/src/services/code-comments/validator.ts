import { buildCommentedDocument } from "./apply"
import type { CommentMode, FunctionTarget, RawCommentProposal, ValidatedCommentResult } from "./types"

const DECISION = /^\s*结论\s*[:：]\s*(生成注释|通过|修订|存在冲突)\s*$/gm
const DIFF_FENCE = /```(?:diff|patch)[ \t]*\r?\n([\s\S]*?)\r?\n```/gi
const MAX_COMMENT_LENGTH = 1200
const CODE_LIKE = [
  /^return\b/,
  /^#\s*(?:define|include|if|ifdef|ifndef|pragma)\b/,
  /^(?:if|for|while|switch)\s*\(/,
  /^(?:else|case\b.*:|default\s*:)/,
  /^[{}]\s*$/,
  /^[A-Za-z_][\w\s*()[\].>\-]*\s*=\s*[^=].*;\s*$/,
  /^[A-Za-z_][\w.>\-]*\s*\([^)]*\)\s*;\s*$/,
]

export type CommentQaDecision = "generate" | "approve" | "revise" | "conflict"

export type CommentQaResponse = {
  decision: CommentQaDecision
  summary: string
  patch?: string
}

export type CommentQaParseResult = { ok: true; value: CommentQaResponse } | { ok: false; reason: string }

export type CommentCandidateResult = { ok: true; value: ValidatedCommentResult } | { ok: false; reasons: string[] }

export function parseCommentQaResponse(input: unknown, round: "primary" | "review"): CommentQaParseResult {
  if (typeof input !== "string" || !input.trim()) return { ok: false, reason: "Code 会话没有返回文本" }
  const text = input.trim()
  const decisions = [...text.matchAll(DECISION)]
  if (decisions.length !== 1) return { ok: false, reason: "响应必须且只能包含一行结论" }
  const label = decisions[0]![1]!
  const decision = decisionValue(label)
  const allowed =
    round === "primary"
      ? new Set<CommentQaDecision>(["generate"])
      : new Set<CommentQaDecision>(["approve", "revise", "conflict"])
  if (!allowed.has(decision)) return { ok: false, reason: `${round} 阶段不接受“${label}”结论` }

  const fences = [...text.matchAll(DIFF_FENCE)]
  const needsPatch = decision === "generate" || decision === "revise"
  if (needsPatch && fences.length === 0) return { ok: false, reason: "生成或修订结论必须包含注释 Diff" }
  if (fences.length > 4) return { ok: false, reason: "注释 Diff 超过四段" }
  if (!needsPatch && fences.length > 0) return { ok: false, reason: "当前结论不应包含 Diff" }

  const summary = text.replace(DECISION, "").replace(DIFF_FENCE, "").trim()
  if (!containsChinese(summary)) return { ok: false, reason: "响应必须包含简短的中文理解或复核说明" }
  return {
    ok: true,
    value: {
      decision,
      summary,
      ...(needsPatch ? { patch: fences.map((fence) => fence[1]!).join("\n@@\n") } : {}),
    },
  }
}

export function buildValidatedCommentCandidate(
  target: FunctionTarget,
  response: CommentQaResponse,
  mode: CommentMode = "insert",
): CommentCandidateResult {
  if (response.decision !== "generate" && response.decision !== "revise") {
    return { ok: false, reasons: ["当前结论没有可验证的注释 Diff"] }
  }
  const derived = deriveProposals(target, response.patch!, mode)
  if (!derived.ok) return derived
  return {
    ok: true,
    value: {
      status: "proposed",
      summary: response.summary,
      proposals: derived.proposals,
      patch: canonicalPatch(derived.proposals),
    },
  }
}

function deriveProposals(
  target: FunctionTarget,
  patch: string,
  mode: CommentMode,
): { ok: true; proposals: RawCommentProposal[] } | { ok: false; reasons: string[] } {
  const proposals: RawCommentProposal[] = []
  const reasons: string[] = []
  let additions: string[] = []
  let files = 0
  let inHunk = false
  let previousLine = target.startLine - 1
  const flush = (contexts: string[] = []) => {
    if (additions.length === 0) return
    const anchor = target.anchors.find(
      (item) =>
        item.line > previousLine &&
        contexts.some(
          (context) => item.targetLineText === context || item.targetLineText.trimStart() === context.trimStart(),
        ),
    )
    if (!anchor) {
      reasons.push(
        contexts.length > 0
          ? `Diff 新增注释后的源码锚点无效或顺序错误：${contexts.at(-1)}`
          : "Diff 新增注释后缺少源码锚点",
      )
      additions = []
      return
    }
    const proposal = proposalFromLines(target, anchor.line, additions, reasons, mode)
    if (proposal) proposals.push(proposal)
    previousLine = anchor.line
    additions = []
  }
  for (const line of patch.split(/\r?\n/)) {
    if (/^diff --git\s/u.test(line)) {
      flush()
      files++
      inHunk = false
      continue
    }
    if (!inHunk && /^(?:index\s|---\s|\+\+\+\s)/u.test(line)) continue
    if (line.startsWith("@@")) {
      flush()
      inHunk = true
      continue
    }
    if (plainCommentLine(line, additions.length > 0)) {
      additions.push(line)
      inHunk = true
      continue
    }
    if (!inHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) inHunk = true
    if (!inHunk) continue
    if (line.startsWith("+")) {
      additions.push(line.slice(1))
      continue
    }
    if (line.startsWith("-")) {
      reasons.push("Diff 删除或修改了原有代码")
      continue
    }
    if (line.startsWith("\\")) continue
    const contexts = line.startsWith(" ") ? [line.slice(1), line] : [line]
    if (additions.length > 0) flush(contexts)
  }
  flush()
  if (files > 1) reasons.push("Diff 不能包含多个文件")
  validateProposalSet(target, proposals, reasons, mode)
  return reasons.length > 0 ? { ok: false, reasons: unique(reasons) } : { ok: true, proposals }
}

function plainCommentLine(line: string, continuing: boolean): boolean {
  const text = line.trimStart()
  if (text.startsWith("//") || text.startsWith("/*")) return true
  return continuing && (text.startsWith("*") || text === "*/")
}

function canonicalPatch(proposals: RawCommentProposal[]): string {
  return proposals
    .map((proposal) =>
      [
        ...proposal.commentText.split(/\r?\n/).map((line) => `+${proposal.indent}${line}`),
        ` ${proposal.anchor.targetLineText}`,
      ].join("\n"),
    )
    .join("\n@@\n")
}

function proposalFromLines(
  target: FunctionTarget,
  line: number,
  lines: string[],
  reasons: string[],
  mode: CommentMode,
): RawCommentProposal | undefined {
  const anchor = target.anchors.find((item) => item.line === line)
  if (!anchor) {
    reasons.push(`Diff 在不允许的位置插入内容：第 ${line + 1} 行`)
    return
  }
  if (lines.length === 0 || lines.some((value) => !value.trim())) {
    reasons.push(`第 ${line + 1} 行的注释插入包含空白行`)
    return
  }
  const commentText = normalizeCommentLines(lines)
  const replacing = anchor.kind === "function" && mode === "revise"
  if (replacing && !target.existingFunctionHeader) {
    reasons.push("修订模式缺少可安全定位的既有函数说明")
    return
  }
  const header = target.existingFunctionHeader
  const indent = replacing ? (header!.text.match(/^\s*/)?.[0] ?? "") : anchor.indent
  return {
    kind: anchor.kind === "function" ? "functionHeader" : "inline",
    operation: replacing ? "replace" : "insert",
    insertBeforeLine: replacing ? header!.startLine : line,
    ...(replacing ? { replaceEndLine: header!.endLine } : {}),
    indent,
    commentText,
    anchor: { targetLineText: anchor.targetLineText },
  }
}

function normalizeCommentLines(lines: string[]): string {
  const values = lines.map((line) => line.trimStart())
  if (!values[0]?.startsWith("/*")) return values.join("\n")
  return values.map((line, index) => (index > 0 && line.startsWith("*") ? ` ${line}` : line)).join("\n")
}

function validateProposalSet(
  target: FunctionTarget,
  proposals: RawCommentProposal[],
  reasons: string[],
  mode: CommentMode,
): void {
  if (proposals.length === 0) reasons.push("Diff 没有新增注释")
  if (proposals.length > 4) reasons.push("注释候选超过四条")
  const headers = proposals.filter((proposal) => proposal.kind === "functionHeader")
  const headerCountReason = ["必须生成一条函数说明", "", "函数说明最多一条"][Math.min(headers.length, 2)]!
  if (headerCountReason) reasons.push(headerCountReason)
  if (proposals.length - headers.length > 3) reasons.push("行内注释最多三条")
  const normalized: string[] = []
  const lines = target.documentText.split(/\r?\n/)
  for (const proposal of proposals) validateProposal(target, proposal, mode, lines, normalized, reasons)
}

function validateProposal(
  target: FunctionTarget,
  proposal: RawCommentProposal,
  mode: CommentMode,
  lines: string[],
  normalized: string[],
  reasons: string[],
): void {
  if (proposal.kind === "functionHeader") {
    const expectedLine = mode === "revise" ? target.existingFunctionHeader?.startLine : target.startLine
    if (proposal.insertBeforeLine !== expectedLine) reasons.push("函数说明位置与目标不一致")
  }
  if (!containsChinese(proposal.commentText)) reasons.push("新增注释必须包含简体中文")
  if (/\b(?:TODO|FIXME|XXX)\b/i.test(proposal.commentText)) reasons.push("新增注释不能包含 TODO/FIXME/XXX")
  if (proposal.commentText.length > MAX_COMMENT_LENGTH) reasons.push("新增注释过长")
  if (!commentOnly(proposal.commentText, proposalHeaderStyle(target, proposal, mode))) {
    reasons.push("Diff 的新增行并非允许的注释形式")
  }
  if (looksLikeCode(proposal.commentText)) reasons.push("新增注释正文看起来包含代码语句")
  const value = normalizeComment(proposal.commentText)
  if (normalized.some((item) => duplicate(item, value))) reasons.push("新增注释之间存在重复")
  if (mode === "insert" && target.existingComments.some((item) => duplicate(normalizeComment(item), value))) {
    reasons.push("新增注释与已有注释重复")
  }
  normalized.push(value)
  if (
    lines[proposal.insertBeforeLine]?.trimEnd().endsWith("\\") ||
    lines[proposal.insertBeforeLine - 1]?.trimEnd().endsWith("\\")
  ) {
    reasons.push("不能在宏续行边界插入注释")
  }
}

function proposalHeaderStyle(
  target: FunctionTarget,
  proposal: RawCommentProposal,
  mode: CommentMode,
): FunctionTarget["functionHeaderStyle"] | undefined {
  if (proposal.kind !== "functionHeader") return
  if (mode === "revise") return target.existingFunctionHeader?.style
  return target.functionHeaderStyle
}

function decisionValue(input: string): CommentQaDecision {
  if (input === "生成注释") return "generate"
  if (input === "通过") return "approve"
  if (input === "修订") return "revise"
  return "conflict"
}

function commentOnly(input: string, headerStyle: FunctionTarget["functionHeaderStyle"] | undefined): boolean {
  const text = input.trim()
  if (!text) return false
  if (headerStyle === "line") return text.split(/\r?\n/).every((line) => line.trimStart().startsWith("//"))
  if (headerStyle) {
    if (!text.startsWith(headerStyle === "docBlock" ? "/**" : "/*") || !text.endsWith("*/")) return false
    if (headerStyle === "block" && text.startsWith("/**")) return false
    if (text.indexOf("*/") !== text.lastIndexOf("*/")) return false
    return text.slice(3).indexOf("/*") === -1
  }
  return text.split(/\r?\n/).every((line) => line.trimStart().startsWith("//"))
}

function looksLikeCode(input: string): boolean {
  return commentBody(input).some((line) => CODE_LIKE.some((pattern) => pattern.test(line)))
}

function commentBody(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\/\*+\s?/, "")
        .replace(/\s*\*\/\s*$/, "")
        .replace(/^\s*\/\/\s?/, "")
        .replace(/^\s*\*\s?/, "")
        .trim(),
    )
    .filter(Boolean)
}

function normalizeComment(input: string): string {
  return commentBody(input)
    .join("")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
}

function duplicate(left: string, right: string): boolean {
  if (left.length < 8 || right.length < 8) return left === right
  return left.includes(right) || right.includes(left)
}

function containsChinese(input: string): boolean {
  return /[\u3400-\u9fff]/u.test(input)
}

function unique(input: string[]): string[] {
  return [...new Set(input)]
}
