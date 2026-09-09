import type { FunctionTarget } from "../code-comments/types"
import type { DeclarationTarget } from "../declaration-comments"

export const MAX_WHOLE_FILE_TARGETS = 50

export type WholeFileCodeTarget =
  | Readonly<{ workflow: "function"; target: FunctionTarget }>
  | Readonly<{ workflow: "declaration"; target: DeclarationTarget }>

export type WholeFileTargetPlan = Readonly<{
  selected: readonly WholeFileCodeTarget[]
  eligible: number
  skipped: number
  remaining: number
}>

export function planWholeFileTargets(
  functions: readonly FunctionTarget[],
  declarations: readonly DeclarationTarget[],
  limit = MAX_WHOLE_FILE_TARGETS,
): WholeFileTargetPlan {
  const eligibleFunctions = functions.filter(functionNeedsComments)
  const eligibleDeclarations = declarations
    .filter(declarationNeedsComments)
    .filter((declaration) => !functions.some((fn) => overlaps(fn, declaration)))
  const all: WholeFileCodeTarget[] = [
    ...eligibleFunctions.map((target): WholeFileCodeTarget => ({ workflow: "function", target })),
    ...eligibleDeclarations.map((target): WholeFileCodeTarget => ({ workflow: "declaration", target })),
  ].sort((left, right) => left.target.startIndex - right.target.startIndex)
  const selected = all.slice(0, Math.max(0, limit))
  return {
    selected,
    eligible: all.length,
    skipped: functions.length + declarations.length - all.length,
    remaining: Math.max(0, all.length - selected.length),
  }
}

export function functionNeedsComments(target: FunctionTarget): boolean {
  if (!target.existingFunctionHeader) return true
  if (!meaningfulComment(target.existingFunctionHeader.text)) return true
  return target.complexity.minimumInlineComments > 0
}

export function declarationNeedsComments(target: DeclarationTarget): boolean {
  return !target.existingHeader || !meaningfulComment(target.existingHeader.text)
}

function meaningfulComment(value: string): boolean {
  const body = value
    .split(/\r?\n/u)
    .map((line) =>
      line
        .trim()
        .replace(/^\/\*+[!]?\s?/u, "")
        .replace(/^\/\/[\/]?[!]?\s?/u, "")
        .replace(/^\*\s?/u, "")
        .replace(/\*\/$/u, "")
        .replace(/^@\w+\b(?:\s*\[[^\]]+\])?(?:\s+\w+)?/u, "")
        .trim(),
    )
    .filter(Boolean)
    .join("")
    .replace(/\b(?:NA|NONE|N\/A|TODO|TBD)\b/giu, "")
    .replace(/(?:无|暂无|待补充|未知)/gu, "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
  return body.length >= 6
}

function overlaps(
  left: { startIndex: number; endIndex: number },
  right: { startIndex: number; endIndex: number },
): boolean {
  return left.startIndex < right.endIndex && right.startIndex < left.endIndex
}
