import { describe, expect, test } from "bun:test"
import { MemoryDebug } from "../../src/kilocode/memory-debug"

describe("memory debug thresholds", () => {
  test("captures each RSS threshold once in ascending order", () => {
    const gib = 1024 * 1024 * 1024
    const seen = new Set<number>()
    expect(MemoryDebug.nextThreshold(5 * gib, seen)).toBe(2 * gib)
    seen.add(2 * gib)
    expect(MemoryDebug.nextThreshold(5 * gib, seen)).toBe(4 * gib)
    seen.add(4 * gib)
    expect(MemoryDebug.nextThreshold(5 * gib, seen)).toBeUndefined()
  })
})
