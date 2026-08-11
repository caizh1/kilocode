import { expect, test } from "bun:test"
import { indexingBudget, pressureFor } from "../../src/chipmate/indexing-memory"

const gib = 1024 * 1024 * 1024

test("uses an adaptive 2 to 4 GiB indexing budget", () => {
  expect(indexingBudget({}, 8 * gib)).toEqual({
    soft: 1.5 * gib,
    critical: 1.75 * gib,
    hard: 2 * gib,
    recovery: Math.floor(1.5 * gib * 0.85),
  })
  expect(indexingBudget({}, 12 * gib).hard).toBe(3 * gib)
  expect(indexingBudget({}, 16 * gib).hard).toBe(4 * gib)
  expect(indexingBudget({}, 64 * gib).hard).toBe(4 * gib)
})

test("honors explicit indexing memory limits", () => {
  expect(
    indexingBudget(
      {
        CHIPMATE_INDEXING_SOFT_RSS_BYTES: String(2 * gib),
        CHIPMATE_INDEXING_CRITICAL_RSS_BYTES: String(2.5 * gib),
        CHIPMATE_INDEXING_HARD_RSS_BYTES: String(3 * gib),
        CHIPMATE_INDEXING_RECOVERY_RSS_BYTES: String(1.5 * gib),
      },
      64 * gib,
    ),
  ).toEqual({ soft: 2 * gib, critical: 2.5 * gib, hard: 3 * gib, recovery: 1.5 * gib })
})

test("requires three low samples before leaving constrained mode", () => {
  const budget = indexingBudget({}, 8 * gib)
  const first = pressureFor(budget.soft, budget, "normal", 0)
  expect(first.pressure).toBe("constrained")
  const second = pressureFor(budget.recovery, budget, first.pressure, first.recovered)
  const third = pressureFor(budget.recovery, budget, second.pressure, second.recovered)
  const fourth = pressureFor(budget.recovery, budget, third.pressure, third.recovered)
  expect(second.pressure).toBe("constrained")
  expect(third.pressure).toBe("constrained")
  expect(fourth.pressure).toBe("normal")
})
