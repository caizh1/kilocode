import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { AgentConsoleTerminal } from "../../src/agent-console/terminal"
import type { AgentConsoleOutMessage } from "../../src/agent-console/types"

describe("standalone Agent Console architecture", () => {
  test("uses its own panel, bundle, and protocol without Agent Manager modes", () => {
    const provider = fs.readFileSync(
      path.join(import.meta.dir, "../../src/agent-console/AgentConsoleProvider.ts"),
      "utf8",
    )
    const manager = fs.readFileSync(
      path.join(import.meta.dir, "../../src/agent-manager/AgentManagerProvider.ts"),
      "utf8",
    )
    const app = fs.readFileSync(
      path.join(import.meta.dir, "../../webview-ui/agent-manager/AgentManagerApp.tsx"),
      "utf8",
    )
    const console = fs.readFileSync(
      path.join(import.meta.dir, "../../webview-ui/agent-console/AgentConsoleApp.tsx"),
      "utf8",
    )
    const terminal = fs.readFileSync(
      path.join(import.meta.dir, "../../webview-ui/agent-manager/terminal/TerminalTab.tsx"),
      "utf8",
    )
    const dialog = fs.readFileSync(
      path.join(import.meta.dir, "../../webview-ui/agent-manager/NewWorktreeDialog.tsx"),
      "utf8",
    )

    expect(provider).toContain('viewType = "chipmate.v2.AgentConsolePanel"')
    expect(provider).toContain('"dist", "agent-console.js"')
    expect(provider).toContain("agentConsole.terminal.fontChanged")
    expect(manager).not.toContain("AgentManagerMode")
    expect(manager).not.toContain("agentManager.openMode")
    expect(app).not.toContain("AgentConsoleSurface")
    expect(app).not.toContain("consoleInput")
    expect(console).not.toContain("<ChatView")
    expect(console).toContain("<HybridTimeline")
    expect(console).toContain("<HybridPrompt")
    expect(console).toContain("shortcuts={false}")
    expect(terminal).toContain("props.shortcuts === false || !isAgentManagerShortcut(event)")
    expect(manager).toContain('msg.type === "agentManager.importFromPR"')
    expect(app).toContain("allowPR={!internal}")
    expect(dialog).toContain("props.allowPR === false")
  })
})

describe("Agent Console terminal protocol", () => {
  test("creates, resizes, restarts, and disposes a real backend PTY", async () => {
    const posts: AgentConsoleOutMessage[] = []
    const calls: string[] = []
    let id = 0
    const client = {
      pty: {
        create: async () => {
          id++
          calls.push(`create:${id}`)
          return { data: { id: `pty-${id}`, title: "Shell" } }
        },
        update: async (input: { ptyID: string }) => {
          calls.push(`resize:${input.ptyID}`)
          return { data: true }
        },
        remove: async (input: { ptyID: string }) => {
          calls.push(`remove:${input.ptyID}`)
          return { data: true }
        },
      },
    }
    const terminal = new AgentConsoleTerminal({
      client: () => client as never,
      config: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      root: () => "/workspace",
      font: () => ({ fontFamily: "monospace", fontSize: 13 }),
      post: (message) => posts.push(message),
      log: () => undefined,
    })

    expect(terminal.handle({ type: "agentConsole.terminal.create" })).toBe(true)
    await Bun.sleep(0)
    const created = posts.find((message) => message.type === "agentConsole.terminal.created")
    expect(created?.type).toBe("agentConsole.terminal.created")
    if (!created || created.type !== "agentConsole.terminal.created") return
    expect(created.wsUrl).toContain("/pty/pty-1/connect")
    expect(created.wsUrl).toContain("directory=%2Fworkspace")

    terminal.handle({
      type: "agentConsole.terminal.resize",
      terminalId: created.terminalId,
      cols: 120,
      rows: 40,
    })
    await Bun.sleep(0)
    expect(calls).toContain("resize:pty-1")

    terminal.handle({ type: "agentConsole.shell.restart" })
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(calls).toContain("remove:pty-1")
    expect(calls).toContain("create:2")

    await terminal.dispose()
    expect(calls).toContain("remove:pty-2")
  })

  test("surfaces a missing workspace instead of spawning", async () => {
    const posts: AgentConsoleOutMessage[] = []
    const terminal = new AgentConsoleTerminal({
      client: () => ({}) as never,
      config: () => undefined,
      root: () => undefined,
      font: () => ({ fontFamily: "monospace", fontSize: 13 }),
      post: (message) => posts.push(message),
      log: () => undefined,
    })

    terminal.handle({ type: "agentConsole.terminal.create" })
    await Bun.sleep(0)
    expect(posts).toEqual([{ type: "agentConsole.terminal.error", message: "Open a folder before creating a shell." }])
  })

  test("routes forced shell and agent input without executing it", async () => {
    const posts: AgentConsoleOutMessage[] = []
    const terminal = new AgentConsoleTerminal({
      client: () => ({}) as never,
      config: () => undefined,
      root: () => "/workspace",
      font: () => ({ fontFamily: "monospace", fontSize: 13 }),
      post: (message) => posts.push(message),
      log: () => undefined,
    })

    terminal.handle({ type: "agentConsole.input.route", requestId: "shell", input: "!internal-tool --check" })
    terminal.handle({ type: "agentConsole.input.route", requestId: "agent", input: "/agent explain the failure" })
    await Bun.sleep(0)

    expect(posts).toContainEqual({
      type: "agentConsole.input.routed",
      requestId: "shell",
      route: "shell",
      input: "internal-tool --check",
    })
    expect(posts).toContainEqual({
      type: "agentConsole.input.routed",
      requestId: "agent",
      route: "agent",
      input: "explain the failure",
    })
  })
})
