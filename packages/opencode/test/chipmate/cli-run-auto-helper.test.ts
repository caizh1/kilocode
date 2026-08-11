// chipmate_change - new file
import { describe, expect, test } from "bun:test"
import { ChipMateRunAuto } from "../../src/chipmate/cli/run-auto"

describe("ChipMateRunAuto", () => {
  test("tracks task child sessions without allowing unrelated sessions", () => {
    const state = ChipMateRunAuto.create("ses_root")

    expect(ChipMateRunAuto.allowed(state, "ses_root")).toBe(true)
    expect(ChipMateRunAuto.allowed(state, "ses_child")).toBe(false)

    ChipMateRunAuto.track(state, {
      type: "tool",
      tool: "task",
      sessionID: "ses_root",
      state: {
        metadata: {
          sessionId: "ses_child",
        },
      },
    })

    expect(ChipMateRunAuto.allowed(state, "ses_child")).toBe(true)
    expect(ChipMateRunAuto.allowed(state, "ses_other")).toBe(false)
  })

  test("ignores malformed or non-root task metadata", () => {
    const state = ChipMateRunAuto.create("ses_root")

    ChipMateRunAuto.track(state, {
      type: "tool",
      tool: "task",
      sessionID: "ses_root",
      state: {
        metadata: {
          sessionId: "",
        },
      },
    })
    ChipMateRunAuto.track(state, {
      type: "tool",
      tool: "task",
      sessionID: "ses_other",
      state: {
        metadata: {
          sessionId: "ses_wrong",
        },
      },
    })
    ChipMateRunAuto.track(state, {
      type: "text",
      sessionID: "ses_root",
      state: {},
    })

    expect(ChipMateRunAuto.allowed(state, "ses_wrong")).toBe(false)
    expect(ChipMateRunAuto.allowed(state, "")).toBe(false)
  })
})
