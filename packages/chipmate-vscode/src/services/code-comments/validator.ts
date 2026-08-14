import { buildCommentedDocument } from "./apply"
import { promptCommentAnchorBindings } from "./anchor-protocol"
import { doxygenTagContract } from "./function-target"
import type {
  CommentCandidateBlock,
  CommentCoverageDiagnostics,
  CommentMode,
  FunctionTarget,
  RawCommentProposal,
  ValidatedCommentResult,
} from "./types"

const DECISION = /^\s*结论\s*[:：]\s*(生成注释|通过|修订|存在冲突)\s*$/gm
const COMMENT_BLOCK = /<comment[ \t]+anchor="([A-Za-z0-9_-]+)">([\s\S]*?)<\/comment>/g
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
  comments?: CommentCandidateBlock[]
}

export type CommentQaParseResult = { ok: true; value: CommentQaResponse } | { ok: false; reason: string }

export type CommentCandidateResult =
  | { ok: true; value: ValidatedCommentResult }
  | {
      ok: false
      kind: "coverage-incomplete"
      reasons: string[]
      partial: ValidatedCommentResult
    }
  | { ok: false; kind: "invalid"; reasons: string[] }

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

  const matches = [...text.matchAll(COMMENT_BLOCK)]
  const needsComments = decision === "generate" || decision === "revise"
  if (needsComments && matches.length === 0) return { ok: false, reason: "生成或修订结论必须包含锚点注释块" }
  if (!needsComments && matches.length > 0) return { ok: false, reason: "当前结论不应包含注释候选" }
  const comments = matches.map((match) => ({
    anchorId: match[1]!,
    commentText: trimCommentBoundary(match[2] ?? ""),
  }))
  if (comments.some((comment) => !comment.commentText)) return { ok: false, reason: "锚点注释块不能为空" }
  if (new Set(comments.map((comment) => comment.anchorId)).size !== comments.length) {
    return { ok: false, reason: "同一个注释锚点只能输出一次" }
  }
  const summary = text.replace(DECISION, "").replace(COMMENT_BLOCK, "").trim()
  if (/<\/?comment\b/i.test(summary)) return { ok: false, reason: "注释块格式无效" }
  if (/```/.test(summary)) return { ok: false, reason: "不得输出完整函数、Diff 或代码围栏" }
  if (!containsChinese(summary)) return { ok: false, reason: "响应必须包含简短的中文理解或复核说明" }
  return {
    ok: true,
    value: {
      decision,
      summary,
      ...(needsComments ? { comments } : {}),
    },
  }
}

export function buildValidatedCommentCandidate(
  target: FunctionTarget,
  response: CommentQaResponse,
  mode: CommentMode = "insert",
): CommentCandidateResult {
  if (response.decision !== "generate" && response.decision !== "revise") {
    return { ok: false, kind: "invalid", reasons: ["当前结论没有可验证的锚点注释候选"] }
  }
  const derived = deriveProposals(target, response.comments ?? [], mode)
  if (!derived.ok) return derived
  const value: ValidatedCommentResult = {
    status: "proposed",
    quality: derived.coverage.missing > 0 ? "coverage-incomplete" : "complete",
    coverage: derived.coverage,
    summary: response.summary,
    proposals: derived.proposals,
    candidateComments: derived.candidateComments,
  }
  if (value.quality === "coverage-incomplete") {
    return {
      ok: false,
      kind: "coverage-incomplete",
      reasons: [coverageFailureReason(value.coverage)],
      partial: value,
    }
  }
  return { ok: true, value }
}

function deriveProposals(
  target: FunctionTarget,
  comments: CommentCandidateBlock[],
  mode: CommentMode,
):
  | {
      ok: true
      proposals: RawCommentProposal[]
      coverage: CommentCoverageDiagnostics
      candidateComments: CommentCandidateBlock[]
    }
  | { ok: false; kind: "invalid"; reasons: string[] } {
  const proposals: RawCommentProposal[] = []
  const candidateComments: CommentCandidateBlock[] = []
  const reasons: string[] = []
  const bindings = new Map(promptCommentAnchorBindings(target).map((binding) => [binding.id, binding]))
  for (const comment of comments) {
    const proposal = proposalFromBlock(target, comment, bindings, reasons, mode)
    if (proposal) {
      proposals.push(proposal)
      candidateComments.push({ anchorId: comment.anchorId, commentText: proposal.commentText })
    }
  }
  const coverage = validateProposalSet(target, proposals, reasons, mode)
  return reasons.length > 0
    ? { ok: false, kind: "invalid", reasons: unique(reasons) }
    : { ok: true, proposals, coverage, candidateComments }
}

function proposalFromBlock(
  target: FunctionTarget,
  block: CommentCandidateBlock,
  bindings: Map<string, ReturnType<typeof promptCommentAnchorBindings>[number]>,
  reasons: string[],
  mode: CommentMode,
): RawCommentProposal | undefined {
  const functionAnchor = target.anchors.find((anchor) => anchor.kind === "function")
  const binding = bindings.get(block.anchorId)
  const anchor = block.anchorId === "function" ? functionAnchor : binding?.anchor
  if (!anchor) {
    reasons.push(`候选引用了未知或不可用的注释锚点：${block.anchorId}`)
    return
  }
  const commentText = normalizeCommentText(block.commentText)
  const replacing = block.anchorId === "function" && mode === "revise"
  if (replacing && !target.existingFunctionHeader) {
    reasons.push("修订模式缺少可安全定位的既有函数说明")
    return
  }
  const header = target.existingFunctionHeader
  const indent = replacing ? (header!.text.match(/^\s*/)?.[0] ?? "") : anchor.indent
  return {
    kind: block.anchorId === "function" ? "functionHeader" : "inline",
    operation: replacing ? "replace" : "insert",
    insertBeforeLine: replacing ? header!.startLine : anchor.line,
    ...(replacing ? { replaceEndLine: header!.endLine } : {}),
    indent,
    commentText,
    anchor: { targetLineText: anchor.targetLineText },
  }
}

function trimCommentBoundary(input: string): string {
  const lines = input.split(/\r?\n/)
  while (lines[0] !== undefined && !lines[0].trim()) lines.shift()
  while (lines.at(-1) !== undefined && !lines.at(-1)!.trim()) lines.pop()
  return lines.join("\n")
}

function normalizeCommentText(input: string): string {
  const values = trimCommentBoundary(input)
    .split(/\r?\n/)
    .map((line) => line.trimStart())
  if (!values[0]?.startsWith("/*")) return values.join("\n")
  return values.map((line, index) => (index > 0 && line.startsWith("*") ? ` ${line}` : line)).join("\n")
}

function validateProposalSet(
  target: FunctionTarget,
  proposals: RawCommentProposal[],
  reasons: string[],
  mode: CommentMode,
): CommentCoverageDiagnostics {
  if (proposals.length === 0) reasons.push("候选函数没有新增注释")
  if (proposals.length > 9) reasons.push("注释候选超过九条")
  const headers = proposals.filter((proposal) => proposal.kind === "functionHeader")
  const headerCountReason = ["必须生成一条函数说明", "", "函数说明最多一条"][Math.min(headers.length, 2)]!
  if (headerCountReason) reasons.push(headerCountReason)
  const inline = proposals.filter((proposal) => proposal.kind === "inline")
  const inlineCount = inline.reduce((count, proposal) => count + inlineCommentCount(proposal.commentText), 0)
  if (inlineCount > 8) reasons.push("行间注释最多八条")
  const coverage = commentCoverageDiagnostics(target, inline)
  const normalized: string[] = []
  const lines = target.documentText.split(/\r?\n/)
  for (const proposal of proposals) validateProposal(target, proposal, mode, lines, normalized, reasons)
  return coverage
}

function inlineCommentCount(comment: string): number {
  return comment.split(/\r?\n/).filter((line) => line.trimStart().startsWith("//")).length
}

export function commentCoverageDiagnostics(
  target: FunctionTarget,
  proposals: RawCommentProposal[],
): CommentCoverageDiagnostics {
  const covered = new Set<string>()
  for (const proposal of proposals) {
    for (const region of target.complexity.controlRegions) {
      if (!region.existingCovered && region.anchor?.line === proposal.insertBeforeLine) covered.add(region.id)
    }
  }
  const required = target.complexity.minimumInlineComments
  const eligibleAnchors = target.complexity.controlRegions
    .filter((region) => !region.existingCovered && !covered.has(region.id) && region.anchor)
    .map((region) => ({
      regionId: region.id,
      line: region.anchor!.line,
      targetLineText: region.anchor!.targetLineText,
    }))
  return {
    required,
    covered: covered.size,
    missing: Math.max(0, required - covered.size),
    coveredRegionIds: [...covered],
    eligibleAnchors,
  }
}

export function coverageFailureReason(coverage: CommentCoverageDiagnostics): string {
  return `复杂逻辑覆盖不足：需要覆盖 ${coverage.required} 个不同控制区域，当前覆盖 ${coverage.covered} 个区域，还缺 ${coverage.missing} 个区域`
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
    if (mode === "revise") validateDoxygenContract(target, proposal.commentText, reasons)
  }
  if (!containsChinese(proposal.commentText)) reasons.push("新增注释必须包含简体中文")
  if (/\b(?:TODO|FIXME|XXX)\b/i.test(proposal.commentText)) reasons.push("新增注释不能包含 TODO/FIXME/XXX")
  if (proposal.commentText.length > MAX_COMMENT_LENGTH) reasons.push("新增注释过长")
  if (!commentOnly(proposal.commentText, proposalHeaderStyle(target, proposal, mode))) {
    reasons.push("候选函数的新增行并非允许的注释形式")
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

function validateDoxygenContract(target: FunctionTarget, candidate: string, reasons: string[]): void {
  const expected = target.existingFunctionHeader?.tagContract ?? []
  const actual = doxygenTagContract(candidate)
  if (actual.length !== expected.length) {
    reasons.push(`Doxygen 标签数量变化：应保留 ${expected.length} 个，当前为 ${actual.length} 个`)
    return
  }
  for (let index = 0; index < expected.length; index += 1) {
    const before = expected[index]!
    const after = actual[index]!
    if (before.name !== after.name) {
      reasons.push(`Doxygen 标签顺序或名称变化：第 ${index + 1} 个应为 @${before.name}，当前为 @${after.name}`)
      continue
    }
    if (before.identity !== after.identity) {
      reasons.push(`Doxygen @${before.name} 标识变化：应保留“${before.identity}”，当前为“${after.identity}”`)
    }
    if (before.rawLine !== undefined && before.rawLine !== after.rawLine) {
      reasons.push(`自定义 Doxygen 标签必须原样保留：${before.rawLine}`)
    }
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
