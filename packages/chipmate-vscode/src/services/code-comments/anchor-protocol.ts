import type { CommentAnchor, FunctionTarget, ValidatedCommentResult } from "./types"

export type CommentAnchorBinding = {
  id: string
  regionId: string
  anchor: CommentAnchor
}

export function commentAnchorBindings(target: FunctionTarget): CommentAnchorBinding[] {
  return target.complexity.controlRegions.flatMap((region, index) => {
    if (region.existingCovered || !region.anchor) return []
    return [{ id: `R${index + 1}`, regionId: region.id, anchor: region.anchor }]
  })
}

export function promptCommentAnchorBindings(target: FunctionTarget): CommentAnchorBinding[] {
  return selectEvenlyDistributed(commentAnchorBindings(target), 12)
}

export function eligibleCommentAnchorBindings(
  target: FunctionTarget,
  candidate?: ValidatedCommentResult,
): CommentAnchorBinding[] {
  const bindings = promptCommentAnchorBindings(target)
  if (candidate?.quality !== "coverage-incomplete") return bindings
  const eligible = new Set(candidate.coverage.eligibleAnchors.map((anchor) => anchor.regionId))
  return bindings.filter((binding) => eligible.has(binding.regionId))
}

export function proposalAnchorId(target: FunctionTarget, line: number): string | undefined {
  return promptCommentAnchorBindings(target).find((binding) => binding.anchor.line === line)?.id
}

function selectEvenlyDistributed<T>(values: T[], maximum: number): T[] {
  if (values.length <= maximum) return values
  return Array.from({ length: maximum }, (_, index) =>
    values[Math.round((index * (values.length - 1)) / (maximum - 1))]!,
  )
}
