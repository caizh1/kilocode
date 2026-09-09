import { z } from "zod"

export const PatentRadarGoldSet = z.object({
  projects: z
    .array(
      z.object({
        id: z.string(),
        humanMinutes: z.number().nonnegative(),
        radarReviewMinutes: z.number().nonnegative(),
      }),
    )
    .min(1),
  technicalPoints: z.array(z.object({ id: z.string(), crossFile: z.boolean() })),
  discoveries: z.array(
    z.object({
      candidateId: z.string(),
      tier: z.enum(["observation", "technical-candidate"]),
      matchedPointIds: z.array(z.string()),
      worthy: z.boolean(),
      citationsResolved: z.boolean(),
    }),
  ),
  conflicts: z.array(
    z.object({ id: z.string(), rank: z.number().int().positive().nullable(), enteredReviewReady: z.boolean() }),
  ),
})
export type PatentRadarGoldSet = z.infer<typeof PatentRadarGoldSet>

export function evaluateGoldSet(input: PatentRadarGoldSet) {
  const value = PatentRadarGoldSet.parse(input)
  const found = new Set(value.discoveries.flatMap((item) => item.matchedPointIds))
  const expected = new Set(value.technicalPoints.map((item) => item.id))
  const cross = value.technicalPoints.filter((item) => item.crossFile).map((item) => item.id)
  const main = value.discoveries.filter((item) => item.tier === "technical-candidate")
  const recall = ratio([...expected].filter((id) => found.has(id)).length, expected.size)
  const crossFileRecall = ratio(cross.filter((id) => found.has(id)).length, cross.length)
  const precision = ratio(main.filter((item) => item.worthy).length, main.length)
  const conflictRecallAt50 = ratio(
    value.conflicts.filter((item) => item.rank !== null && item.rank <= 50).length,
    value.conflicts.length,
  )
  const human = value.projects.reduce((sum, item) => sum + item.humanMinutes, 0)
  const radar = value.projects.reduce((sum, item) => sum + item.radarReviewMinutes, 0)
  const workReduction = human ? Math.max(0, 1 - radar / human) : 0
  const citationsResolved = value.discoveries.every((item) => item.citationsResolved)
  const fixedConflictSafe = value.conflicts.every((item) => !item.enteredReviewReady)
  const sampleReady = value.projects.length >= 10 && value.technicalPoints.length >= 50 && cross.length >= 30
  const metrics = {
    recall,
    crossFileRecall,
    precision,
    conflictRecallAt50,
    workReduction,
    citationsResolved,
    fixedConflictSafe,
    sampleReady,
  }
  return {
    metrics,
    passed:
      sampleReady &&
      recall >= 0.9 &&
      crossFileRecall >= 0.85 &&
      precision >= 0.75 &&
      conflictRecallAt50 >= 0.95 &&
      workReduction >= 0.8 &&
      citationsResolved &&
      fixedConflictSafe,
  }
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0
}
