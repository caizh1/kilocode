import { describe, test, expect } from "bun:test"
import path from "path"

// Regression guard for branding drift in user-facing MCP strings.
//
// History: upstream OpenCode has repeatedly overwritten the ChipMate-branded
// toast message and MCP client `name` field during large refactors — most
// recently in upstream PR #22913 (commit 5fccdc9fc, "refactor: collapse mcp
// barrel into mcp/index.ts") which ChipMate picked up via the v1.4.7 merge (PR
// #9346, commit 57630eaf1). The original fix was PR #7174.
//
// This test asserts the surviving ChipMate-branded strings directly against the
// source so that the next upstream churn on this file fails the ChipMate test
// suite instead of shipping an "opencode mcp auth" popup to end users.

const mcpSource = path.join(__dirname, "..", "..", "src", "mcp", "index.ts")

describe("ChipMate MCP branding", () => {
  test("auth toast tells the user to run `chipmate mcp auth`, never `opencode mcp auth`", async () => {
    const src = await Bun.file(mcpSource).text()
    expect(src).toContain("Run: chipmate mcp auth ${key}")
    expect(src).not.toContain("Run: opencode mcp auth")
  })

  test("MCP `Client` instances identify themselves as `chipmate`", async () => {
    const src = await Bun.file(mcpSource).text()
    // `name: "opencode"` is the upstream default and appears in the protocol
    // handshake / client identification fields. Any new `new Client({ ... })`
    // must use the ChipMate brand.
    const opencodeClientName = /name:\s*"opencode"/g
    expect(src.match(opencodeClientName)).toBeNull()
  })
})
