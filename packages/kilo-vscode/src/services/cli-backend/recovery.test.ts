import { describe, expect, test } from "bun:test"
import { CrashRecovery, MAX_FAILURES } from "./recovery"

describe("CrashRecovery", () => {
  test("allows four restarts then opens the circuit on the fifth consecutive failure", () => {
    const state = new CrashRecovery()
    for (let index = 1; index < MAX_FAILURES; index++) expect(state.failed()).toBe(true)
    expect(state.failed()).toBe(false)
    expect(state.failures).toBe(MAX_FAILURES)
    expect(state.exhausted).toBe(true)
  })

  test("resets the failure circuit after a stable connection or manual retry", () => {
    const state = new CrashRecovery()
    state.failed()
    state.failed()
    state.stable()
    expect(state.failures).toBe(0)
    expect(state.exhausted).toBe(false)
    state.failed()
    state.manual()
    expect(state.failures).toBe(0)
  })
})
