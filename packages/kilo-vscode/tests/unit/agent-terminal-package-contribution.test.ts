import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packagePath = path.resolve(import.meta.dir, "../../package.json")

describe("agent terminal package contributions", () => {
  test("contributes the Agent Console command and disabled legacy terminal profile", async () => {
    const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"))
    const contributes = pkg.contributes ?? {}

    expect(contributes.commands).toContainEqual(
      expect.objectContaining({
        command: "kilo-code.new.agentTerminal.open",
        title: "ChipMate: Open Agent Console",
      }),
    )
    expect(contributes.terminal?.profiles).toContainEqual(
      expect.objectContaining({
        id: "kilo.agentTerminal",
        title: "Kilo Agent Terminal (Legacy)",
      }),
    )
    expect(contributes.configuration?.properties?.["kilo.agentTerminal.enabled"]).toMatchObject({
      type: "boolean",
      default: false,
    })
  })
})
