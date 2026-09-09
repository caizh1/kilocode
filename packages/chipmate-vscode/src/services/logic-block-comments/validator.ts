import { validateCommentOnlyDocument } from "../code-comments/apply"
import { buildSourceAnnotationDocument } from "../source-annotations/coordinator"
import type { LogicBlockComment, LogicBlockProposal, LogicBlockTarget, ValidatedLogicBlockComments } from "./types"

const CODE_LIKE = [
  /^return\b/u,
  /^#\s*(?:define|include|if|ifdef|ifndef|pragma)\b/u,
  /^(?:if|for|while|switch)\s*\(/u,
  /^(?:else|case\b.*:|default\s*:)/u,
  /^[{}]\s*$/u,
  /^[A-Za-z_][\w\s*()[\].>\-]*\s*=\s*[^=].*;\s*$/u,
]

export async function buildValidatedLogicBlockCandidate(input: {
  target: LogicBlockTarget
  summary: string
  comments: readonly LogicBlockComment[]
}): Promise<
  | { ok: true; value: ValidatedLogicBlockComments }
  | { ok: false; reasons: string[]; safePartial?: ValidatedLogicBlockComments }
> {
  const reasons: string[] = []
  const proposals: LogicBlockProposal[] = []
  const safeComments: LogicBlockComment[] = []
  const anchors = new Map(input.target.anchors.map((anchor) => [anchor.id, anchor]))
  const normalized: string[] = []
  for (const block of input.comments) {
    const current: string[] = []
    const anchor = anchors.get(block.anchorId)
    if (!anchor) {
      reasons.push(`候选引用了未知或选区外锚点：${block.anchorId}`)
      continue
    }
    const commentText = normalize(block.commentText)
    validateComment(input.target, commentText, normalized, current)
    if (input.target.documentText.split(/\r?\n/u)[anchor.insertBeforeLine - 1]?.trimEnd().endsWith("\\"))
      current.push("不能在宏续行内部插入注释")
    if (current.length > 0) {
      reasons.push(...current.map((reason) => `${block.anchorId}: ${reason}`))
      continue
    }
    proposals.push({
      anchorId: block.anchorId,
      insertBeforeLine: anchor.insertBeforeLine,
      indent: anchor.indent,
      commentText,
      targetLineText: anchor.targetLineText,
    })
    safeComments.push({ anchorId: block.anchorId, commentText })
  }
  if (proposals.length > 8) reasons.push("逻辑块最多允许八个注释锚点")
  const safePartial = proposals.length
    ? { summary: input.summary, proposals, candidateComments: safeComments }
    : undefined
  if (reasons.length > 0) return { ok: false, reasons: [...new Set(reasons)], ...(safePartial ? { safePartial } : {}) }
  const operations = proposals.map((proposal) => ({
    anchorId: proposal.anchorId,
    operation: "insert" as const,
    placement: "inline" as const,
    insertBeforeLine: proposal.insertBeforeLine,
    indent: proposal.indent,
    commentText: proposal.commentText,
    targetLineText: proposal.targetLineText,
  }))
  const candidate = buildSourceAnnotationDocument(input.target.documentText, input.target.eol, operations)
  if (!(await validateCommentOnlyDocument(input.target.filePath, input.target.documentText, candidate)))
    return { ok: false, reasons: ["逻辑块候选改变了非注释 token"], ...(safePartial ? { safePartial } : {}) }
  return { ok: true, value: { summary: input.summary, proposals, candidateComments: safeComments } }
}

function validateComment(target: LogicBlockTarget, value: string, normalized: string[], reasons: string[]): void {
  const lines = value.split(/\r?\n/u)
  if (lines.length < 1 || lines.length > 2 || lines.some((line) => !line.trimStart().startsWith("//") || !line.trim()))
    reasons.push("每个逻辑锚点只允许一至两行连续 // 注释")
  if (/\/\*|\*\//u.test(value)) reasons.push("逻辑块不允许使用块注释")
  if (!/[\u3400-\u9fff]/u.test(value)) reasons.push("逻辑注释必须包含简体中文")
  if (/\b(?:TODO|FIXME|XXX)\b/iu.test(value)) reasons.push("逻辑注释不能包含 TODO/FIXME/XXX")
  if (value.length > 500) reasons.push("单个逻辑锚点注释过长")
  if (commentBody(value).some((line) => CODE_LIKE.some((pattern) => pattern.test(line))))
    reasons.push("逻辑注释正文看起来包含代码语句")
  const compact = normalizeBody(value)
  if (normalized.some((item) => duplicate(item, compact))) reasons.push("新增逻辑注释之间存在重复")
  if (target.existingComments.some((item) => duplicate(normalizeBody(item), compact)))
    reasons.push("新增逻辑注释与已有注释重复")
  normalized.push(compact)
}

function normalize(value: string): string {
  const lines = value.split(/\r?\n/u)
  while (lines[0] !== undefined && !lines[0].trim()) lines.shift()
  while (lines.at(-1) !== undefined && !lines.at(-1)!.trim()) lines.pop()
  return lines.map((line) => line.trimStart()).join("\n")
}

function commentBody(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\/\/\s?/u, "").trim())
    .filter(Boolean)
}

function normalizeBody(value: string): string {
  return commentBody(value)
    .join("")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
}

function duplicate(left: string, right: string): boolean {
  if (left.length < 8 || right.length < 8) return left === right
  return left.includes(right) || right.includes(left)
}
