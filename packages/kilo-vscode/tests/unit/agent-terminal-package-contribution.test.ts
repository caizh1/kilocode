import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packagePath = path.resolve(import.meta.dir, "../../package.json")

describe("agent terminal package contributions", () => {
  test("contributes a disabled-by-default Agent Terminal command, profile, and setting", async () => {
    const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"))
    const contributes = pkg.contributes ?? {}

    expect(contributes.commands).toContainEqual(
      expect.objectContaining({
        command: "kilo-code.new.agentTerminal.open",
        title: "ChipMate: Open Agent Terminal",
      }),
    )
    expect(contributes.terminal?.profiles).toContainEqual(
      expect.objectContaining({
        id: "kilo.agentTerminal",
        title: "Kilo Agent Terminal",
      }),
    )
    expect(contributes.configuration?.properties?.["kilo.agentTerminal.enabled"]).toMatchObject({
      type: "boolean",
      default: false,
    })
  })
})
