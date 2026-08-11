import { describe, test, expect, beforeEach } from "bun:test"
import { isEligible, setKillSwitch, resetEligibility, type OrgState } from "@/chipmate/session-export/eligibility"

const base = {
  model: {
    api: { npm: "@chipmate/chipmate-gateway" },
    isFree: true,
  },
  org: { type: "personal" } as OrgState,
}

describe("isEligible", () => {
  beforeEach(() => resetEligibility())

  test("free ChipMate Gateway personal context is eligible", () => {
    expect(isEligible(base)).toBe(true)
  })

  test("paid ChipMate Gateway is ineligible", () => {
    expect(isEligible({ ...base, model: { ...base.model, isFree: false } })).toBe(false)
  })

  test("isFree=undefined is ineligible", () => {
    expect(isEligible({ ...base, model: { ...base.model, isFree: undefined } })).toBe(false)
  })

  test("non-ChipMate provider with isFree=true is ineligible", () => {
    expect(isEligible({ ...base, model: { ...base.model, api: { npm: "@ai-sdk/openai" } } })).toBe(false)
  })

  test("org context is ineligible regardless of model", () => {
    expect(isEligible({ ...base, org: { type: "org", id: "org_xyz" } })).toBe(false)
  })

  test("unknown org state is ineligible", () => {
    expect(isEligible({ ...base, org: { type: "unknown" } })).toBe(false)
  })

  test("killSwitch blocks everything", () => {
    setKillSwitch(true, "test")
    expect(isEligible(base)).toBe(false)
  })
})
