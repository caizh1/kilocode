import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packagePath = path.resolve(import.meta.dir, "../../package.json")

describe("agent terminal package contributions", () => {
  test("contributes the Agent Console command and disabled legacy terminal profile", async () => {
    const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"))
    const contributes = pkg.contributes ?? {}
    const commands = contributes.commands ?? []

    expect(commands).toContainEqual(
      expect.objectContaining({
        command: "kilo-code.new.agentTerminal.open",
        title: "ChipMate: Open Agent Console",
      }),
    )
    expect(commands).toContainEqual({
      command: "kilo-code.new.sidebarTitle.agentTerminalOpen",
      title: "Agent Console",
      icon: "$(terminal)",
    })
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

  test("adds Agent Console to the sidebar title without changing existing toolbar commands", async () => {
    const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"))
    const contributes = pkg.contributes ?? {}
    const commands = contributes.commands ?? []
    const toolbar = [
      ["kilo-code.new.sidebarTitle.plusButtonClicked", "New Task", "$(add)"],
      ["kilo-code.new.sidebarTitle.historyButtonClicked", "History", "$(history)"],
      ["kilo-code.new.sidebarTitle.agentManagerOpen", "Agent Manager", "$(organization)"],
      ["kilo-code.new.sidebarTitle.agentTerminalOpen", "Agent Console", "$(terminal)"],
      ["kilo-code.new.sidebarTitle.kiloClawOpen", "KiloClaw", "$(comment-discussion)"],
      ["kilo-code.new.sidebarTitle.marketplaceButtonClicked", "市场", "$(extensions)"],
      ["kilo-code.new.sidebarTitle.profileButtonClicked", "Profile", "$(account)"],
      ["kilo-code.new.sidebarTitle.settingsButtonClicked", "Settings", "$(settings-gear)"],
    ]

    for (const item of toolbar) {
      expect(commands).toContainEqual({ command: item[0], title: item[1], icon: item[2] })
    }

    const title = contributes.menus?.["view/title"] ?? []
    expect(
      title
        .filter((item: { when?: string }) => item.when === "view == kilo-code.SidebarProvider")
        .map((item: { command: string; group: string; when: string }) => ({
          command: item.command,
          group: item.group,
          when: item.when,
        })),
    ).toEqual(
      toolbar.map((item, index) => ({
        command: item[0],
        group: `navigation@${index}`,
        when: "view == kilo-code.SidebarProvider",
      })),
    )

    expect(contributes.menus?.commandPalette).toContainEqual({
      command: "kilo-code.new.sidebarTitle.agentTerminalOpen",
      when: "false",
    })
    const surfaces = Object.entries(contributes.menus ?? {})
      .filter((entry) =>
        (entry[1] as Array<{ command?: string }>).some(
          (item) => item.command === "kilo-code.new.sidebarTitle.agentTerminalOpen",
        ),
      )
      .map((entry) => entry[0])
      .sort()
    expect(surfaces).toEqual(["commandPalette", "view/title"])
  })
})
