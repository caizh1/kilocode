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
import { queue } from "../../webview-ui/agent-console/queue"
import { redact } from "../../webview-ui/agent-manager/terminal/diagnostic"
import { contrast } from "../../webview-ui/agent-manager/terminal/theme"
import { activityBlocks, mergeActivity } from "../../webview-ui/agent-console/activity"
import { terminalLines } from "../../webview-ui/agent-console/output"

const request = (command: string, toolName = "bash"): PermissionRequest => ({
  id: "permission-1",
  sessionID: "session-1",
  toolName,
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

  test("recognizes PowerShell commands and Windows paths on Windows", async () => {
    const env = { PATH: "", PATHEXT: ".COM;.EXE;.BAT;.CMD" }
    for (const input of [
      "Get-ChildItem -Force",
      "Write-Output CHIPMATE_QA_OK",
      "if ($env:CI) { Write-Output ready }",
      "foreach ($item in $items) { Write-Output $item }",
      "function Invoke-Build { Write-Output building }",
      "$env:Path",
      "C:\\workspace\\check.ps1",
      "\\\\server\\share\\check.ps1",
      ".\\check.ps1",
      '"C:\\Program Files\\tool.exe" --version',
      "firmware-tool.exe --version",
      "build.cmd /?",
    ]) {
      expect(await routeAgentConsoleInput(input, env, "win32")).toEqual({ route: "shell", input })
    }
    expect(await routeAgentConsoleInput("帮我分析 PowerShell 输出", env, "win32")).toEqual({
      route: "agent",
      input: "帮我分析 PowerShell 输出",
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
    expect(permissionPresentation(request("sudo rm -rf /tmp/example", "agent_console_shell"))).toBe("high")
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
  test("archives ANSI, carriage returns, backspaces, Unicode, and long tails without constructing xterm", () => {
    const lines = terminalLines(
      `old progress\rnew\x1b[K\n\x1b[31m红色🙂\x1b[0m\nabc\bZ\n${Array.from({ length: 5002 }, (_, index) => `tail-${index}`).join("\n")}`,
    )

    expect(lines).toHaveLength(5000)
    expect(lines[0]?.map((run) => run.text).join("")).toBe("tail-2")
    expect(lines.at(-1)?.map((run) => run.text).join("")).toBe("tail-5001")
    const styled = terminalLines("\x1b[31mred\x1b[0m plain")
    expect(styled[0]?.[0]).toEqual({
      text: "red",
      style: { color: "var(--vscode-terminal-ansiRed, #cd3131)" },
    })
    expect(styled[0]?.[1]?.text).toBe(" plain")
    expect(terminalLines("abc\rZ\x1b[K")[0]?.map((run) => run.text).join("")).toBe("Z")
    expect(terminalLines("abc\bZ")[0]?.map((run) => run.text).join("")).toBe("abZ")
  })

  test("deduplicates replayed activity and groups a live command in order", () => {
    const events = mergeActivity(
      [
        { seq: 1, time: 1, kind: "idle", data: "/workspace $ printf ok\r\n" },
        {
          seq: 2,
          time: 2,
          kind: "begin",
          cwd: "/workspace",
          runId: "run-1",
          source: "direct",
          command: "printf ok",
        },
      ],
      [
        {
          seq: 2,
          time: 2,
          kind: "begin",
          cwd: "/workspace",
          runId: "run-1",
          source: "direct",
          command: "printf ok",
        },
        { seq: 3, time: 3, kind: "data", data: "ok", runId: "run-1", source: "direct" },
        { seq: 4, time: 4, kind: "end", cwd: "/workspace", exitCode: 0, runId: "run-1" },
      ],
    )

    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4])
    expect(activityBlocks(events)).toEqual([
      {
        id: "terminal:1",
        time: 1,
        kind: "idle",
        data: "/workspace $ printf ok\r\n",
        running: false,
      },
      {
        id: "terminal:run-1",
        time: 2,
        kind: "run",
        data: "ok",
        cwd: "/workspace",
        exitCode: 0,
        running: false,
        runId: "run-1",
        source: "direct",
        callId: undefined,
        command: "printf ok",
      },
    ])
  })

  test("does not archive uncorrelated shell lifecycle markers", () => {
    expect(
      activityBlocks([
        { seq: 1, time: 1, kind: "begin", cwd: "/workspace" },
        { seq: 2, time: 2, kind: "data", data: "" },
        { seq: 3, time: 3, kind: "end", cwd: "/workspace", exitCode: 0 },
      ]),
    ).toEqual([])
  })

  test("forces Agent Console terminal text and ANSI white to pure white", () => {
    expect(
      contrast(
        {
          foreground: "#333",
          cursor: "#333",
          cursorAccent: "#eee",
          white: "#ccc",
          brightWhite: "#eee",
          background: "#fff",
        },
        "#fff",
        "#101113",
      ),
    ).toEqual({
      foreground: "#fff",
      cursor: "#fff",
      cursorAccent: "#101113",
      white: "#fff",
      brightWhite: "#fff",
      background: "#101113",
    })
  })

  test("redacts websocket credentials from diagnostics", () => {
    expect(redact("Failed ws://127.0.0.1/pty/1?auth_token=aGVsbG86c2VjcmV0%3D&cursor=-1")).toBe(
      "Failed ws://127.0.0.1/pty/1?auth_token=[redacted]&cursor=-1",
    )
  })

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

  test("queues shell input until the websocket binds without duplicate sends", () => {
    const sent: string[] = []
    const failed: Array<{ id: string; message: string }> = []
    const bridge = queue((id, message) => failed.push({ id, message }))

    expect(bridge.send("first", "test\r")).toBe(false)
    expect(bridge.send("second", "printf ok\r")).toBe(false)
    expect(bridge.send("first", "test\r")).toBe(false)
    const dispose = bridge.bind((data) => {
      sent.push(data)
      return true
    })

    expect(sent).toEqual(["test\r", "printf ok\r"])
    expect(bridge.send("third", "pwd\r")).toBe(true)
    expect(sent).toEqual(["test\r", "printf ok\r", "pwd\r"])
    dispose()
    expect(bridge.send("fourth", "uname -a\r")).toBe(false)
    bridge.reject("terminal connection error")
    bridge.bind((data) => {
      sent.push(data)
      return true
    })

    expect(sent).toEqual(["test\r", "printf ok\r", "pwd\r"])
    expect(failed).toEqual([{ id: "fourth", message: "terminal connection error" }])
  })

  test("sends one hundred sequential commands exactly once", () => {
    const sent: string[] = []
    const bridge = queue(() => undefined)
    bridge.bind((data) => {
      sent.push(data)
      return true
    })

    for (const index of Array.from({ length: 100 }, (_, index) => index)) {
      expect(bridge.send(`run-${index}`, `printf ${index}\r`)).toBe(true)
    }
    expect(sent).toEqual(Array.from({ length: 100 }, (_, index) => `printf ${index}\r`))
  })
})
