import { describe, expect, test } from "bun:test"
import { ChipMateMcpConfig } from "@/chipmate/cli/cmd/mcp"

const added = `{
  "permission": {
    "bash": "allow"
  },
  "mcp": {
    "linear": {
      "type": "remote",
      "url": "https://mcp.linear.app/mcp",
      "oauth": {}
    }
  },
}`

describe("ChipMateMcpConfig.format", () => {
  test("writes strict JSON for chipmate.json", () => {
    const output = ChipMateMcpConfig.format("/tmp/chipmate.json", added)

    expect(JSON.parse(output)).toEqual({
      permission: { bash: "allow" },
      mcp: {
        linear: {
          type: "remote",
          url: "https://mcp.linear.app/mcp",
          oauth: {},
        },
      },
    })
    expect(output).not.toEndWith(",\n}")
  })

  test("preserves JSONC formatting for chipmate.jsonc", () => {
    expect(ChipMateMcpConfig.format("/tmp/chipmate.jsonc", added)).toBe(added)
  })
})
