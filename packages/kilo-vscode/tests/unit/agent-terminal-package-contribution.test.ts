import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packagePath = path.resolve(import.meta.dir, "../../package.json")

describe("agent terminal package contributions", () => {
  test("contributes the standalone Agent Console command without the legacy terminal profile", async () => {
    const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"))
    const contributes = pkg.contributes ?? {}
    const commands = contributes.commands ?? []

    expect(commands).toContainEqual(
      expect.objectContaining({
        command: "chipmate.v2.agentTerminal.open",
        title: "ChipMate: Open Agent Console",
      }),
    )
    expect(commands).toContainEqual({
      command: "chipmate.v2.sidebarTitle.agentTerminalOpen",
      title: "Agent Console",
      icon: "$(terminal)",
    })
    expect(contributes.terminal?.profiles).toBeUndefined()
    expect(contributes.configuration?.properties?.["chipmate.v2.agentTerminal.enabled"]).toBeUndefined()
  })

  test("adds Agent Console while preserving the internal-offline toolbar gates", async () => {
    const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"))
    const contributes = pkg.contributes ?? {}
    const commands = contributes.commands ?? []
    const toolbar = [
      ["chipmate.v2.sidebarTitle.plusButtonClicked", "New Task", "$(add)"],
      ["chipmate.v2.sidebarTitle.historyButtonClicked", "History", "$(history)"],
      ["chipmate.v2.sidebarTitle.agentManagerOpen", "Agent Manager", "$(organization)"],
      ["chipmate.v2.sidebarTitle.agentTerminalOpen", "Agent Console", "$(terminal)"],
      ["chipmate.v2.sidebarTitle.kiloClawOpen", "ChipMateClaw", "$(comment-discussion)"],
      ["chipmate.v2.sidebarTitle.marketplaceButtonClicked", "市场", "$(extensions)"],
      ["chipmate.v2.sidebarTitle.profileButtonClicked", "Profile", "$(account)"],
      ["chipmate.v2.sidebarTitle.settingsButtonClicked", "Settings", "$(settings-gear)"],
    ]

    for (const item of toolbar) {
      expect(commands).toContainEqual({ command: item[0], title: item[1], icon: item[2] })
    }

    const title = contributes.menus?.["view/title"] ?? []
    const gated = new Set(["chipmate.v2.sidebarTitle.kiloClawOpen", "chipmate.v2.sidebarTitle.profileButtonClicked"])
    expect(
      title
        .filter((item: { when?: string }) => item.when === "view == chipmate.v2.SidebarProvider")
        .map((item: { command: string; group: string; when: string }) => ({
          command: item.command,
          group: item.group,
          when: item.when,
        })),
    ).toEqual(
      toolbar
        .filter((item) => !gated.has(item[0]))
        .map((item) => {
          const position = toolbar.findIndex((entry) => entry[0] === item[0])
          return {
            command: item[0],
            group: `navigation@${position}`,
            when: "view == chipmate.v2.SidebarProvider",
          }
        }),
    )

    for (const command of gated) {
      const position = toolbar.findIndex((item) => item[0] === command)
      expect(title).toContainEqual({
        command,
        group: `navigation@${position}`,
        when: "view == chipmate.v2.SidebarProvider && !chipmate.v2.internalOffline",
      })
    }

    expect(contributes.menus?.commandPalette).toContainEqual({
      command: "chipmate.v2.sidebarTitle.agentTerminalOpen",
      when: "false",
    })
    const surfaces = Object.entries(contributes.menus ?? {})
      .filter((entry) =>
        (entry[1] as Array<{ command?: string }>).some(
          (item) => item.command === "chipmate.v2.sidebarTitle.agentTerminalOpen",
        ),
      )
      .map((entry) => entry[0])
      .sort()
    expect(surfaces).toEqual(["commandPalette", "view/title"])
  })
})
