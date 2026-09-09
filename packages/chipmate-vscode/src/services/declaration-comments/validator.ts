import { validateCommentOnlyDocument } from "../code-comments/apply"
import { buildSourceAnnotationDocument } from "../source-annotations/coordinator"
import type { SourceAnnotationOperation } from "../source-annotations/types"
import type {
  DeclarationCommentBlock,
  DeclarationCommentProposal,
  DeclarationTarget,
  ValidatedDeclarationComments,
} from "./types"
import { declarationDoxygenTagContract } from "./target"

const MAX_COMMENT_LENGTH = 1600
const CODE_LIKE = [
  /^return\b/u,
  /^#\s*(?:define|include|if|ifdef|ifndef|pragma)\b/u,
  /^(?:if|for|while|switch)\s*\(/u,
  /^(?:else|case\b.*:|default\s*:)/u,
  /^[{}]\s*$/u,
  /^[A-Za-z_][\w\s*()[\].>\-]*\s*=\s*[^=].*;\s*$/u,
]

export type DeclarationCandidateResult =
  | { ok: true; value: ValidatedDeclarationComments }
  | { ok: false; reasons: string[]; safePartial?: ValidatedDeclarationComments }

export async function buildValidatedDeclarationCandidate(input: {
  target: DeclarationTarget
  summary: string
  comments: readonly DeclarationCommentBlock[]
}): Promise<DeclarationCandidateResult> {
  const reasons: string[] = []
  const proposals: DeclarationCommentProposal[] = []
  const safeComments: DeclarationCommentBlock[] = []
  const bindings = new Map(input.target.memberAnchors.map((anchor) => [anchor.id, anchor]))
  const normalized: string[] = []
  for (const block of input.comments) {
    const blockReasons: string[] = []
    const proposal = proposalFromBlock(input.target, block, bindings, blockReasons)
    if (proposal) validateProposal(input.target, proposal, normalized, blockReasons)
    if (proposal && blockReasons.length === 0) {
      proposals.push(proposal)
      safeComments.push({ anchorId: block.anchorId, commentText: proposal.commentText })
    } else {
      reasons.push(...blockReasons)
    }
  }
  validateProposalSet(input.target, proposals, reasons)
  const safePartial =
    proposals.length > 0 ? { summary: input.summary, proposals, candidateComments: safeComments } : undefined
  if (reasons.length > 0) return { ok: false, reasons: unique(reasons), ...(safePartial ? { safePartial } : {}) }

  const operations = proposals.map(proposalToOperation)
  const candidate = buildSourceAnnotationDocument(input.target.documentText, input.target.eol, operations)
  if (!(await validateCommentOnlyDocument(input.target.filePath, input.target.documentText, candidate))) {
    return { ok: false, reasons: ["候选改变了声明中的非注释 token"], ...(safePartial ? { safePartial } : {}) }
  }
  return { ok: true, value: { summary: input.summary, proposals, candidateComments: safeComments } }
}

function proposalFromBlock(
  target: DeclarationTarget,
  block: DeclarationCommentBlock,
  bindings: Map<string, DeclarationTarget["memberAnchors"][number]>,
  reasons: string[],
): DeclarationCommentProposal | undefined {
  const commentText = normalizeCommentText(block.commentText)
  if (block.anchorId === "declaration") {
    const existing = target.existingHeader
    return {
      kind: "declarationHeader",
      operation: existing ? "replace" : "insert",
      insertBeforeLine: existing?.startLine ?? target.startLine,
      ...(existing ? { replaceEndLine: existing.endLine } : {}),
      indent: existing
        ? (existing.text.match(/^\s*/u)?.[0] ?? "")
        : (target.documentText.split(/\r?\n/)[target.startLine]?.match(/^\s*/u)?.[0] ?? ""),
      commentText,
      anchor: { targetLineText: target.documentText.split(/\r?\n/)[target.startLine] ?? "" },
    }
  }
  const anchor = bindings.get(block.anchorId)
  if (!anchor) {
    reasons.push(`候选引用了未知成员锚点：${block.anchorId}`)
    return
  }
  if (anchor.existingCovered) {
    reasons.push(`成员锚点 ${block.anchorId} 已有准确注释，不允许修改或重复添加`)
    return
  }
  return {
    kind: "member",
    operation: "insert",
    insertBeforeLine: anchor.insertBeforeLine,
    indent: anchor.indent,
    commentText,
    anchor: { targetLineText: anchor.targetLineText },
  }
}

function validateProposalSet(
  target: DeclarationTarget,
  proposals: DeclarationCommentProposal[],
  reasons: string[],
): void {
  const headers = proposals.filter((proposal) => proposal.kind === "declarationHeader")
  if (headers.length !== 1) reasons.push(headers.length === 0 ? "必须生成一条声明说明" : "声明说明最多一条")
  const memberLines = proposals
    .filter((proposal) => proposal.kind === "member")
    .reduce((count, proposal) => count + proposal.commentText.split(/\r?\n/).length, 0)
  if (memberLines > 8) reasons.push("成员行间注释最多八行")
  if (
    (target.kind === "object-macro" || target.kind === "function-macro") &&
    proposals.some((item) => item.kind === "member")
  ) {
    reasons.push("宏只允许在完整 #define 前添加声明说明")
  }
}

function validateProposal(
  target: DeclarationTarget,
  proposal: DeclarationCommentProposal,
  normalized: string[],
  reasons: string[],
): void {
  const style = proposal.kind === "declarationHeader" ? (target.existingHeader?.style ?? target.headerStyle) : undefined
  if (!containsChinese(proposal.commentText)) reasons.push("新增注释必须包含简体中文")
  if (/\b(?:TODO|FIXME|XXX)\b/iu.test(proposal.commentText)) reasons.push("新增注释不能包含 TODO/FIXME/XXX")
  if (proposal.commentText.length > MAX_COMMENT_LENGTH) reasons.push("新增注释过长")
  if (!commentOnly(proposal.commentText, style)) reasons.push("候选包含不允许的非注释内容")
  if (proposal.kind === "member" && proposal.commentText.split(/\r?\n/).length > 2) {
    reasons.push("每个成员锚点最多允许两行连续 // 注释")
  }
  if (looksLikeCode(proposal.commentText)) reasons.push("新增注释正文看起来包含代码语句")
  const value = normalizeComment(proposal.commentText)
  if (normalized.some((item) => duplicate(item, value))) reasons.push("新增注释之间存在重复")
  const replacedHeader =
    proposal.kind === "declarationHeader" && target.existingHeader
      ? normalizeComment(target.existingHeader.text)
      : undefined
  let skippedReplacedHeader = false
  const comparableExistingComments = target.existingComments.filter((item) => {
    if (skippedReplacedHeader || replacedHeader === undefined || normalizeComment(item) !== replacedHeader) return true
    skippedReplacedHeader = true
    return false
  })
  if (comparableExistingComments.some((item) => duplicate(normalizeComment(item), value)))
    reasons.push("新增注释与已有注释重复")
  normalized.push(value)
  if (proposal.kind === "declarationHeader" && target.existingHeader)
    validateDoxygenContract(target, proposal.commentText, reasons)
  const lines = target.documentText.split(/\r?\n/)
  // 插在一条以反斜杠结尾的 #define 首行之前是安全的；只有前一源码行仍在续行时，
  // 当前插入位置才真正位于宏体内部。
  if (lines[proposal.insertBeforeLine - 1]?.trimEnd().endsWith("\\")) {
    reasons.push("不能在宏续行内部或边界插入注释")
  }
}

function validateDoxygenContract(target: DeclarationTarget, candidate: string, reasons: string[]): void {
  const expected = target.existingHeader?.tagContract ?? []
  const actual = declarationDoxygenTagContract(candidate)
  if (actual.length !== expected.length) {
    reasons.push(`Doxygen 标签数量变化：应保留 ${expected.length} 个，当前为 ${actual.length} 个`)
    return
  }
  for (let index = 0; index < expected.length; index += 1) {
    const before = expected[index]!
    const after = actual[index]!
    if (before.name !== after.name) reasons.push(`Doxygen 标签顺序或名称变化：第 ${index + 1} 个应为 @${before.name}`)
    if (before.identity !== after.identity)
      reasons.push(`Doxygen @${before.name} 标识变化：必须保留“${before.identity}”`)
    if (before.rawLine !== undefined && before.rawLine !== after.rawLine)
      reasons.push(`自定义 Doxygen 标签必须原样保留：${before.rawLine}`)
  }
}

function proposalToOperation(proposal: DeclarationCommentProposal, index: number): SourceAnnotationOperation {
  return {
    anchorId: proposal.kind === "declarationHeader" ? "declaration" : `member-${index + 1}`,
    operation: proposal.operation,
    placement: proposal.kind === "declarationHeader" ? "target-header" : "inline",
    insertBeforeLine: proposal.insertBeforeLine,
    ...(proposal.replaceEndLine === undefined ? {} : { replaceEndLine: proposal.replaceEndLine }),
    indent: proposal.indent,
    commentText: proposal.commentText,
    targetLineText: proposal.anchor.targetLineText,
  }
}

function normalizeCommentText(value: string): string {
  const lines = value.split(/\r?\n/)
  while (lines[0] !== undefined && !lines[0].trim()) lines.shift()
  while (lines.at(-1) !== undefined && !lines.at(-1)!.trim()) lines.pop()
  const normalized = lines.map((line) => line.trimStart())
  if (!normalized[0]?.startsWith("/*")) return normalized.join("\n")
  return normalized.map((line, index) => (index > 0 && line.startsWith("*") ? ` ${line}` : line)).join("\n")
}

function commentOnly(value: string, style: DeclarationTarget["headerStyle"] | undefined): boolean {
  const text = value.trim()
  if (!text) return false
  if (style === "line" || style === undefined)
    return text.split(/\r?\n/).every((line) => line.trimStart().startsWith("//"))
  if (!text.startsWith(style === "docBlock" ? "/**" : "/*") || !text.endsWith("*/")) return false
  if (style === "block" && text.startsWith("/**")) return false
  if (text.indexOf("*/") !== text.lastIndexOf("*/")) return false
  return text.slice(3).indexOf("/*") === -1
}

function looksLikeCode(value: string): boolean {
  return commentBody(value).some((line) => CODE_LIKE.some((pattern) => pattern.test(line)))
}

function commentBody(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\/\*+\s?/u, "")
        .replace(/\s*\*\/\s*$/u, "")
        .replace(/^\s*\/\/\s?/u, "")
        .replace(/^\s*\*\s?/u, "")
        .trim(),
    )
    .filter(Boolean)
}

function normalizeComment(value: string): string {
  return commentBody(value)
    .join("")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
}

function duplicate(left: string, right: string): boolean {
  if (left.length < 8 || right.length < 8) return left === right
  return left.includes(right) || right.includes(left)
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
