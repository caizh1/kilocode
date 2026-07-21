import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { AgentConsoleTerminal } from "../../src/agent-console/terminal"
import { AgentConsoleIntegration } from "../../src/agent-console/integration"
import type { AgentConsoleOutMessage } from "../../src/agent-console/types"

async function until(check: () => boolean): Promise<void> {
  for (const _ of Array.from({ length: 100 })) {
    if (check()) return
    await Bun.sleep(10)
  }
  throw new Error("Timed out waiting for Agent Console terminal event")
}

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
  test("the packaged Bash rcfile emits ready, begin, and end markers", async () => {
    if (process.platform === "win32") return
    const token = "0123456789abcdef0123456789abcdef"
    const script = path.join(import.meta.dir, "../../assets/agent-console/bashrc")
    const child = Bun.spawn(["/usr/bin/env", "bash", "--rcfile", script, "-i"], {
      cwd: "/tmp",
      env: {
        ...process.env,
        KILO_AGENT_CONSOLE: "1",
        KILO_AGENT_CONSOLE_TOKEN: token,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    child.stdin.write(
      "printf 'rcfile-ok\\n'\nPROMPT_COMMAND=()\nPS0=\n__chipmate_resync\nprintf 'after-resync\\n'\nexit\n",
    )
    child.stdin.end()
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
    await child.exited

    const output = `${stdout}${stderr}`
    expect(output).toContain(`\x1b]6973;${token};ready;`)
    expect(output).toContain(`\x1b]6973;${token};begin;`)
    expect(output).toContain(`\x1b]6973;${token};end;0;`)
    expect(output).toContain(`\x1b]6973;${token};resync;`)
    expect(stdout).toContain("rcfile-ok")
    expect(stdout).toContain("after-resync")
  })

  test("resynchronizes a shell that stopped emitting completion markers", () => {
    const states: unknown[] = []
    const token = "0123456789abcdef0123456789abcdef"
    const cwd = Buffer.from("/workspace/recovered").toString("base64")
    const parser = new AgentConsoleIntegration(token, (state) => states.push(state))

    parser.push(`\x1b]6973;${token};ready;${cwd}\x07`)
    parser.push(`\x1b]6973;${token};begin;${cwd}\x07never-finished`)
    parser.recover()
    parser.push(`\x1b]6973;${token};resync;${cwd}\x07`)

    expect(states).toEqual([
      { status: "ready", cwd: "/workspace/recovered" },
      { status: "busy", cwd: "/workspace/recovered" },
      { status: "recovering", cwd: "/workspace/recovered" },
      { status: "ready", cwd: "/workspace/recovered" },
    ])
  })

  test("tracks fragmented Bash readiness and command lifecycle markers", () => {
    const states: unknown[] = []
    const activities: unknown[] = []
    const token = "0123456789abcdef0123456789abcdef"
    const cwd = Buffer.from("/workspace").toString("base64")
    const parser = new AgentConsoleIntegration(
      token,
      (state) => states.push(state),
      (event) => activities.push(event),
    )

    parser.push(`banner\r\n\x1b]6973;${token.slice(0, 12)}`)
    parser.push(`${token.slice(12)};ready;${cwd}\x07prompt`)
    parser.push(`\x1b]6973;${token};begin;${cwd}\x07`)
    parser.push(`output\r\n\x1b]6973;${token};end;0;${cwd}\x1b\\`)

    expect(states).toEqual([
      { status: "ready", cwd: "/workspace" },
      { status: "busy", cwd: "/workspace" },
      { status: "ready", cwd: "/workspace" },
    ])
    expect(parser.state()).toEqual({ status: "ready", cwd: "/workspace" })
    expect(activities).toEqual([
      { kind: "idle", data: "banner\r\n" },
      { kind: "idle", data: "prompt" },
      { kind: "begin", cwd: "/workspace" },
      { kind: "data", data: "output\r\n" },
      { kind: "end", cwd: "/workspace", exitCode: 0 },
    ])
  })

  test("reports a missing Bash integration without overwriting a ready shell", () => {
    const states: unknown[] = []
    const token = "0123456789abcdef0123456789abcdef"
    const cwd = Buffer.from("/workspace").toString("base64")
    const parser = new AgentConsoleIntegration(token, (state) => states.push(state))

    parser.fail("integration timeout")
    parser.push(`\x1b]6973;${token};ready;${cwd}\x07`)
    parser.fail("late timeout")

    expect(states).toEqual([
      { status: "error", message: "integration timeout" },
      { status: "ready", cwd: "/workspace" },
    ])
  })

  test("waits for the shared backend and deduplicates startup shell requests", async () => {
    const posts: AgentConsoleOutMessage[] = []
    const calls: string[] = []
    let release = () => undefined
    let connected = false
    const ready = new Promise<void>((resolve) => {
      release = () => {
        connected = true
        resolve()
      }
    })
    const client = {
      pty: {
        create: async () => {
          calls.push("create")
          return { data: { id: "pty-ready", title: "Shell" } }
        },
        update: async () => ({ data: true }),
        remove: async () => ({ data: true }),
      },
    }
    const terminal = new AgentConsoleTerminal({
      client: () => {
        calls.push("client")
        return client as never
      },
      ready: () => {
        calls.push("ready")
        return ready
      },
      config: () => (connected ? { baseUrl: "http://127.0.0.1:4096", password: "secret" } : undefined),
      root: () => "/workspace",
      rcfile: () => "/tmp/bashrc",
      font: () => ({ fontFamily: "monospace", fontSize: 13 }),
      post: (message) => posts.push(message),
      log: () => undefined,
    })

    terminal.handle({ type: "agentConsole.terminal.create" })
    terminal.handle({ type: "agentConsole.terminal.create" })
    await Bun.sleep(0)
    expect(calls).toEqual(["ready"])
    expect(posts).toEqual([])

    release()
    await until(() => posts.some((message) => message.type === "agentConsole.terminal.created"))
    expect(calls).toEqual(["ready", "client", "create"])
    expect(posts.some((message) => message.type === "agentConsole.terminal.error")).toBe(false)
    await terminal.dispose()
  })

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
      ready: async () => undefined,
      config: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      root: () => "/workspace",
      rcfile: () => "/tmp/bashrc",
      font: () => ({ fontFamily: "monospace", fontSize: 13 }),
      post: (message) => posts.push(message),
      log: () => undefined,
    })

    expect(terminal.handle({ type: "agentConsole.terminal.create" })).toBe(true)
    await Bun.sleep(0)
    const created = posts.find((message) => message.type === "agentConsole.terminal.created")
    expect(created?.type).toBe("agentConsole.terminal.created")
    if (!created || created.type !== "agentConsole.terminal.created") return
    expect("wsUrl" in created).toBe(false)

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

  test("relays PTY input and output through the extension host", async () => {
    const calls: string[] = []
    let token = ""
    const root = process.platform === "darwin" ? fs.mkdtempSync("/tmp/chipmate-agent-console-") : "/tmp/workspace"
    const alias =
      process.platform === "darwin" ? root.replace(/^\/tmp(?=\/)/, "/private/tmp") : "/private/tmp/workspace"
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return
        return new Response("WebSocket upgrade required", { status: 426 })
      },
      websocket: {
        open(socket) {
          const cwd = Buffer.from("/workspace").toString("base64")
          socket.send(`\x1b]6973;${token};ready;${cwd}\x07`)
        },
        message(socket, message) {
          const cwd = Buffer.from("/workspace").toString("base64")
          socket.send(message)
          socket.send(`\x1b]6973;${token};begin;${cwd}\x07`)
          socket.send("\x1b[31mrelay-output\x1b[0m")
          socket.send(`\x1b]6973;${token};end;0;${cwd}\x07`)
        },
      },
    })
    const posts: AgentConsoleOutMessage[] = []
    const terminal = new AgentConsoleTerminal({
      client: () =>
        ({
          pty: {
            create: async (input: { env?: Record<string, string> }) => {
              token = input.env?.KILO_AGENT_CONSOLE_TOKEN ?? ""
              return { data: { id: "pty-relay", title: "Shell" } }
            },
            update: async (input: { ptyID: string; sessionID?: string }) => {
              if (input.sessionID) calls.push(`associate:${input.ptyID}:${input.sessionID}`)
              return { data: true }
            },
            remove: async () => ({ data: true }),
          },
        }) as never,
      ready: async () => undefined,
      config: () => ({ baseUrl: `http://127.0.0.1:${server.port}`, password: "secret" }),
      root: () => root,
      canonical:
        process.platform === "darwin" ? undefined : async (value) => value.replace(/^\/tmp(?=\/)/, "/private/tmp"),
      rcfile: () => "/tmp/bashrc",
      font: () => ({ fontFamily: "monospace", fontSize: 13 }),
      post: (message) => posts.push(message),
      log: () => undefined,
    })

    terminal.handle({ type: "agentConsole.terminal.create" })
    await until(() => posts.some((message) => message.type === "agentConsole.terminal.created"))
    const created = posts.find((message) => message.type === "agentConsole.terminal.created")
    if (!created || created.type !== "agentConsole.terminal.created") throw new Error("Terminal was not created")
    terminal.handle({ type: "agentConsole.terminal.connect", terminalId: created.terminalId })
    await until(() => posts.some((message) => message.type === "agentConsole.terminal.connected"))
    await until(() =>
      posts.some((message) => message.type === "agentConsole.terminal.state" && message.state.status === "ready"),
    )
    await terminal.bind("session-relay", alias)
    await expect(terminal.bind("session-other", "/private/tmp/other")).rejects.toThrow(
      "Agent Console session directory does not match the persistent shell",
    )
    expect(calls).toEqual(["associate:pty-relay:session-relay"])
    terminal.handle({
      type: "agentConsole.command.expect",
      terminalId: created.terminalId,
      runId: "run-relay",
      source: "direct",
      command: "printf relay",
    })
    terminal.handle({ type: "agentConsole.terminal.write", terminalId: created.terminalId, data: "printf relay\r" })
    await until(() =>
      posts.some((message) => message.type === "agentConsole.terminal.data" && message.data === "printf relay\r"),
    )

    expect(posts).toContainEqual({
      type: "agentConsole.terminal.data",
      terminalId: created.terminalId,
      data: "printf relay\r",
    })
    await until(() =>
      posts.some(
        (message) =>
          message.type === "agentConsole.terminal.activity" &&
          message.event.kind === "end" &&
          message.event.runId === "run-relay",
      ),
    )
    expect(
      posts.filter((message) => message.type === "agentConsole.terminal.activity").map((message) => message.event.kind),
    ).toEqual(expect.arrayContaining(["idle", "begin", "data", "end"]))

    terminal.handle({ type: "agentConsole.terminal.connect", terminalId: created.terminalId })
    await until(() =>
      posts.some(
        (message) =>
          message.type === "agentConsole.terminal.activitySnapshot" &&
          message.events.some((event) => event.runId === "run-relay" && event.kind === "end"),
      ),
    )
    await terminal.dispose()
    server.stop(true)
    if (process.platform === "darwin") fs.rmdirSync(root)
  })

  test("reports the extension-host WebSocket handshake failure", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("upgrade blocked", { status: 426 })
      },
    })
    const posts: AgentConsoleOutMessage[] = []
    const logs: string[] = []
    const terminal = new AgentConsoleTerminal({
      client: () =>
        ({
          pty: {
            create: async () => ({ data: { id: "pty-error", title: "Shell" } }),
            update: async () => ({ data: true }),
            remove: async () => ({ data: true }),
          },
        }) as never,
      ready: async () => undefined,
      config: () => ({ baseUrl: `http://127.0.0.1:${server.port}`, password: "secret" }),
      root: () => "/workspace",
      rcfile: () => "/tmp/bashrc",
      font: () => ({ fontFamily: "monospace", fontSize: 13 }),
      post: (message) => posts.push(message),
      log: (message) => logs.push(message),
    })

    terminal.handle({ type: "agentConsole.terminal.create" })
    await until(() => posts.some((message) => message.type === "agentConsole.terminal.created"))
    const created = posts.find((message) => message.type === "agentConsole.terminal.created")
    if (!created || created.type !== "agentConsole.terminal.created") throw new Error("Terminal was not created")
    terminal.handle({ type: "agentConsole.terminal.connect", terminalId: created.terminalId })
    await until(() => posts.some((message) => message.type === "agentConsole.terminal.relayError"))

    expect(logs.some((message) => message.includes("Expected 101 status code"))).toBe(true)
    expect(
      posts.some(
        (message) =>
          message.type === "agentConsole.terminal.relayError" && message.message.includes("Expected 101 status code"),
      ),
    ).toBe(true)
    await terminal.dispose()
    server.stop(true)
  })

  test("recovers the same PTY when Bash does not emit an end marker", async () => {
    const writes: string[] = []
    let token = ""
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return
        return new Response("WebSocket upgrade required", { status: 426 })
      },
      websocket: {
        open(socket) {
          socket.send(`\x1b]6973;${token};ready;${Buffer.from("/workspace").toString("base64")}\x07`)
        },
        message(socket, message) {
          const data = String(message)
          writes.push(data)
          if (data !== "__chipmate_resync\r") return
          socket.send(`\x1b]6973;${token};resync;${Buffer.from("/workspace").toString("base64")}\x07`)
        },
      },
    })
    const posts: AgentConsoleOutMessage[] = []
    const terminal = new AgentConsoleTerminal({
      client: () =>
        ({
          pty: {
            create: async (input: { env?: Record<string, string> }) => {
              token = input.env?.KILO_AGENT_CONSOLE_TOKEN ?? ""
              return { data: { id: "pty-recovery", title: "Shell" } }
            },
            update: async () => ({ data: true }),
            remove: async () => ({ data: true }),
          },
        }) as never,
      ready: async () => undefined,
      config: () => ({ baseUrl: `http://127.0.0.1:${server.port}`, password: "secret" }),
      root: () => "/workspace",
      rcfile: () => "/tmp/bashrc",
      font: () => ({ fontFamily: "monospace", fontSize: 13 }),
      post: (message) => posts.push(message),
      log: () => undefined,
    })

    terminal.handle({ type: "agentConsole.terminal.create" })
    await until(() => posts.some((message) => message.type === "agentConsole.terminal.created"))
    const created = posts.find((message) => message.type === "agentConsole.terminal.created")
    if (!created || created.type !== "agentConsole.terminal.created") throw new Error("Terminal was not created")
    terminal.handle({ type: "agentConsole.terminal.connect", terminalId: created.terminalId })
    await until(() =>
      posts.some((message) => message.type === "agentConsole.terminal.state" && message.state.status === "ready"),
    )
    terminal.handle({ type: "agentConsole.terminal.recover", terminalId: created.terminalId })
    await until(() =>
      posts.some((message) => message.type === "agentConsole.terminal.recovery" && message.success === true),
    )

    expect(writes).toEqual(["\x03", "__chipmate_resync\r"])
    expect(
      posts.some((message) => message.type === "agentConsole.terminal.state" && message.state.status === "recovering"),
    ).toBe(true)
    await terminal.dispose()
    server.stop(true)
  })

  test("surfaces a missing workspace instead of spawning", async () => {
    const posts: AgentConsoleOutMessage[] = []
    const terminal = new AgentConsoleTerminal({
      client: () => ({}) as never,
      ready: async () => undefined,
      config: () => undefined,
      root: () => undefined,
      rcfile: () => "/tmp/bashrc",
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
      ready: async () => undefined,
      config: () => undefined,
      root: () => "/workspace",
      rcfile: () => "/tmp/bashrc",
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

  test("records webview websocket diagnostics without exposing the auth URL", () => {
    const logs: string[] = []
    const terminal = new AgentConsoleTerminal({
      client: () => ({}) as never,
      ready: async () => undefined,
      config: () => undefined,
      root: () => "/workspace",
      rcfile: () => "/tmp/bashrc",
      font: () => ({ fontFamily: "monospace", fontSize: 13 }),
      post: () => undefined,
      log: (message) => logs.push(message),
    })

    expect(
      terminal.handle({
        type: "agentConsole.terminal.diagnostic",
        terminalId: "terminal:1",
        event: "close",
        detail: "code=1006 reason=none clean=false",
      }),
    ).toBe(true)
    expect(logs).toEqual(["Webview close: terminal=terminal:1 code=1006 reason=none clean=false"])
  })
})
