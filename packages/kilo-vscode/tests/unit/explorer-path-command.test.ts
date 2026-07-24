import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  contributes: {
    commands: Array<{ command: string; title: string }>
    menus: Record<string, Array<{ command: string; when?: string; group?: string }>>
  }
}

describe("Explorer path reference command", () => {
  it("contributes the exact ChipMate QA menu label", () => {
    expect(
      manifest.contributes.commands.find((item) => item.command === "chipmate.v2.addExplorerPathsToQa"),
    ).toEqual({
      command: "chipmate.v2.addExplorerPathsToQa",
      title: "ChipMate: 引用路径到 QA",
    })
  })

  it("shows only in the Explorer context menu", () => {
    expect(manifest.contributes.menus["explorer/context"]).toContainEqual({
      command: "chipmate.v2.addExplorerPathsToQa",
      group: "2_workspace@50",
    })
    expect(manifest.contributes.menus.commandPalette).toContainEqual({
      command: "chipmate.v2.addExplorerPathsToQa",
      when: "false",
    })
  })
})
