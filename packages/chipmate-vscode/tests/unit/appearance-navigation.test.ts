import { expect, test, spyOn } from "bun:test"
import * as vscode from "vscode"
import { openAppearanceSidebar } from "../../src/appearance-navigation"

test("已显示聊天时连续新建保持侧栏，并在就绪后各投递一次", async () => {
  let visible = true
  const events: string[] = []
  const command = spyOn(vscode.commands, "executeCommand").mockImplementation(async (id: string) => {
    if (id === "workbench.view.extension.chipmate-v2-activitybar") visible = !visible
    if (id === "chipmate.v2.SidebarProvider.focus") visible = true
    events.push(id)
  })
  let ready = () => {}
  const messages: unknown[] = []
  const provider = {
    waitForReady: () => new Promise<void>((resolve) => (ready = resolve)),
    postMessage: (message: unknown) => messages.push(message),
  }
  try {
    for (let count = 0; count < 2; count++) {
      const pending = openAppearanceSidebar(provider, "plusButtonClicked")
      await Promise.resolve()
      expect(visible).toBe(true)
      expect(messages).toHaveLength(count)
      ready()
      await pending
      expect(messages).toHaveLength(count + 1)
    }
    expect(events).toEqual(["chipmate.v2.SidebarProvider.focus", "chipmate.v2.SidebarProvider.focus"])
    expect(messages).toEqual(Array(2).fill({ type: "action", action: "plusButtonClicked" }))
  } finally {
    command.mockRestore()
  }
})
