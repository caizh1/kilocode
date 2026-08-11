// chipmate_change - new file
import { describe, expect, test } from "bun:test"
import { TelemetryEvent } from "@chipmate/chipmate-telemetry"

describe("TelemetryEvent.FEEDBACK_SUBMITTED", () => {
  test("enum value is human-readable title case", () => {
    expect(String(TelemetryEvent.FEEDBACK_SUBMITTED)).toBe("Feedback Submitted")
  })
})
