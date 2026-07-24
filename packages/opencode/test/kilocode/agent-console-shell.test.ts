import { describe, expect, test } from "bun:test"
import { semantics } from "../../src/kilocode/tool/agent-console-shell"

describe("Agent Console shell semantics", () => {
  test("uses PowerShell commands on Windows", () => {
    const copy = semantics("win32")

    expect(copy.parameter).toContain("PowerShell command")
    expect(copy.description).toContain("non-interactive PowerShell command")
  })

  test("keeps Bash commands on Unix hosts", () => {
    const copy = semantics("linux")

    expect(copy.parameter).toContain("Bash command")
    expect(copy.description).toContain("non-interactive Bash command")
  })
})
