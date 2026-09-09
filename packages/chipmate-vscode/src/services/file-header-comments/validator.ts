import { validateCommentOnlyDocument } from "../code-comments/apply"
import { buildSourceAnnotationDocument } from "../source-annotations/coordinator"
import { fileHeaderTagContract } from "./target"
import type { FileHeaderCommentBlock, FileHeaderTarget, ValidatedFileHeaderComment } from "./types"

const CODE_LIKE = [
  /^return\b/u,
  /^#\s*(?:define|include|if|ifdef|ifndef|pragma)\b/u,
  /^(?:if|for|while|switch)\s*\(/u,
  /^[{}]\s*$/u,
  /^[A-Za-z_][\w\s*()[\].>\-]*\s*=\s*[^=].*;\s*$/u,
]

export async function buildValidatedFileHeaderCandidate(input: {
  target: FileHeaderTarget
  summary: string
  comment: FileHeaderCommentBlock
}): Promise<{ ok: true; value: ValidatedFileHeaderComment } | { ok: false; reasons: string[] }> {
  const target = input.target
  const commentText = normalizeCommentText(input.comment.commentText)
  const reasons: string[] = []
  if (!/[\u3400-\u9fff]/u.test(commentText)) reasons.push("模块说明必须包含简体中文")
  if (/\b(?:TODO|FIXME|XXX)\b/iu.test(commentText)) reasons.push("模块说明不能包含 TODO/FIXME/XXX")
  if (commentText.length > 2400) reasons.push("模块说明过长")
  if (!commentOnly(commentText, target.style)) reasons.push("模块说明包含不允许的非注释内容或风格不匹配")
  if (commentBody(commentText).some((line) => CODE_LIKE.some((pattern) => pattern.test(line))))
    reasons.push("模块说明正文看起来包含代码语句")
  if (target.existingHeader) validateTagContract(target, commentText, reasons)
  if (reasons.length > 0) return { ok: false, reasons: [...new Set(reasons)] }
  const proposal = {
    operation: target.existingHeader ? ("replace" as const) : ("insert" as const),
    insertBeforeLine: target.existingHeader?.startLine ?? target.anchorLine,
    ...(target.existingHeader ? { replaceEndLine: target.existingHeader.endLine } : {}),
    indent: "",
    commentText,
    targetLineText: target.anchorLineText,
  }
  const candidate = buildSourceAnnotationDocument(target.documentText, target.eol, [
    {
      anchorId: "file",
      placement: "file-header",
      ...proposal,
    },
  ])
  if (!(await validateCommentOnlyDocument(target.filePath, target.documentText, candidate)))
    return { ok: false, reasons: ["模块说明候选改变了非注释 token"] }
  return {
    ok: true,
    value: { summary: input.summary, comment: { anchorId: "file", commentText }, proposal },
  }
}

function validateTagContract(target: FileHeaderTarget, candidate: string, reasons: string[]): void {
  const expected = target.existingHeader?.tagContract ?? []
  const actual = fileHeaderTagContract(candidate)
  if (actual.length !== expected.length) {
    reasons.push(`Doxygen 标签数量变化：应保留 ${expected.length} 个，当前为 ${actual.length} 个`)
    return
  }
  for (let index = 0; index < expected.length; index += 1) {
    const before = expected[index]!
    const after = actual[index]!
    if (before.name !== after.name) reasons.push(`Doxygen 标签顺序或名称变化：第 ${index + 1} 个应为 @${before.name}`)
    if (before.identity !== after.identity) reasons.push(`Doxygen @${before.name} 标识变化`)
    if (before.rawLine !== undefined && before.rawLine !== after.rawLine)
      reasons.push(`自定义 Doxygen 标签必须原样保留：${before.rawLine}`)
  }
}

function normalizeCommentText(value: string): string {
  const lines = value.split(/\r?\n/u)
  while (lines[0] !== undefined && !lines[0].trim()) lines.shift()
  while (lines.at(-1) !== undefined && !lines.at(-1)!.trim()) lines.pop()
  const normalized = lines.map((line) => line.trimStart())
  if (!normalized[0]?.startsWith("/*")) return normalized.join("\n")
  return normalized.map((line, index) => (index > 0 && line.startsWith("*") ? ` ${line}` : line)).join("\n")
}

function commentOnly(value: string, style: FileHeaderTarget["style"]): boolean {
  const text = value.trim()
  if (style === "line") return text.split(/\r?\n/u).every((line) => line.trimStart().startsWith("//"))
  if (!text.startsWith(style === "docBlock" ? "/**" : "/*") || !text.endsWith("*/")) return false
  if (style === "block" && text.startsWith("/**")) return false
  if (text.indexOf("*/") !== text.lastIndexOf("*/")) return false
  return text.slice(3).indexOf("/*") === -1
}

function commentBody(value: string): string[] {
  return value
    .split(/\r?\n/u)
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
