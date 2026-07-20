import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { classifyCommand, permissionSeverity } from "../../src/shared/command-risk"
import { createTerminalState } from "../../webview-ui/agent-manager/terminal/state"
import { LOCAL } from "../../webview-ui/agent-manager/navigate"
import {
  editPermission,
  permissionEditPrompt,
  permissionPresentation,
} from "../../webview-ui/src/components/chat/permission-presentation"
import type { PermissionRequest } from "../../webview-ui/src/types/messages"
import { routeAgentConsoleInput } from "../../src/agent-console/input"

const request = (command: string): PermissionRequest => ({
  id: "permission-1",
  sessionID: "session-1",
  toolName: "bash",
  patterns: [],
  always: [],
  args: { command },
})

describe("agent console command presentation", () => {
  test("routes real commands to the shell and natural language to the agent", async () => {
    expect(await routeAgentConsoleInput("pwd", { PATH: "" })).toEqual({ route: "shell", input: "pwd" })
    expect(await routeAgentConsoleInput("echo hello", { PATH: "" })).toEqual({
      route: "shell",
      input: "echo hello",
    })
    expect(await routeAgentConsoleInput("帮我分析当前错误", { PATH: "" })).toEqual({
      route: "agent",
      input: "帮我分析当前错误",
    })
    expect(await routeAgentConsoleInput("/agent explain ls output", { PATH: "" })).toEqual({
      route: "agent",
      input: "explain ls output",
    })
    expect(await routeAgentConsoleInput("!unknown-internal-command", { PATH: "" })).toEqual({
      route: "shell",
      input: "unknown-internal-command",
    })
  })

  test("classifies safe, review, and high-risk shell commands", () => {
    expect(classifyCommand("df -h").level).toBe("safe")
    expect(classifyCommand("git push origin main").level).toBe("review")
    expect(classifyCommand("rm -rf /tmp/example").level).toBe("danger")
    expect(permissionSeverity("sudo rm -rf /tmp/example")).toBe("high")
  })

  test("marks dangerous bash permissions as high risk and preserves edit text", () => {
    const safe = request("df -h")
    const danger = request("sudo rm -rf /tmp/example")

    expect(permissionPresentation(safe)).toBe("standard")
    expect(permissionPresentation(danger)).toBe("high")
    expect(permissionEditPrompt(danger)).toBe("sudo rm -rf /tmp/example")
  })

  test("rejects the original permission before prefilling and ignores duplicate edits", () => {
    const danger = request("sudo rm -rf /tmp/example")
    const events: string[] = []
    const edit = () =>
      editPermission(
        danger,
        false,
        () => events.push("reject"),
        (command) => events.push(`prefill:${command}`),
      )

    expect(edit()).toBe(true)
    expect(events).toEqual(["reject", "prefill:sudo rm -rf /tmp/example"])
    expect(
      editPermission(
        danger,
        true,
        () => events.push("duplicate"),
        () => events.push("duplicate"),
      ),
    ).toBe(false)
    expect(events).toHaveLength(2)
  })
})

describe("agent console terminal bridge", () => {
  test("queues the first shell command until the PTY websocket binds", () => {
    createRoot((dispose) => {
      const [selection] = createSignal<string | null>(LOCAL)
      const state = createTerminalState(selection)
      const sent: string[] = []

      expect(state.send("df -h")).toBe("missing")
      state.add(null, { id: "terminal:1", title: "Terminal 1", wsUrl: "ws://terminal" })
      state.bind("terminal:1", (data) => {
        sent.push(data)
        return true
      })

      expect(sent).toEqual(["df -h\r"])
      expect(state.send("pwd")).toBe("sent")
      expect(sent).toEqual(["df -h\r", "pwd\r"])
      dispose()
    })
  })
})
