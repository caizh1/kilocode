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

function capture(id: string): string {
  return `\x18\x12${Array.from(id.replaceAll("-", ""), (digit) => `\x18${digit}`).join("")}\x18\x10`
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
    const timeline = fs.readFileSync(
      path.join(import.meta.dir, "../../webview-ui/agent-console/HybridTimeline.tsx"),
      "utf8",
    )
    const dialog = fs.readFileSync(
      path.join(import.meta.dir, "../../webview-ui/agent-manager/NewWorktreeDialog.tsx"),
      "utf8",
    )
    const windows = fs.readFileSync(path.join(import.meta.dir, "../../qa/windows-real/run.ps1"), "utf8")
    const cdp = fs.readFileSync(path.join(import.meta.dir, "../../qa/windows-real/cdp-agent-console.mjs"), "utf8")

    expect(provider).toContain('viewType = "chipmate.v2.AgentConsolePanel"')
    expect(provider).toContain('"dist", "agent-console.js"')
    expect(provider).toContain("agentConsole.terminal.fontChanged")
    expect(manager).not.toContain("AgentManagerMode")
    expect(manager).not.toContain("agentManager.openMode")
    expect(app).not.toContain("AgentConsoleSurface")
    expect(app).not.toContain("consoleInput")
    expect(console).not.toContain("<ChatView")
    expect(console).toContain("<HybridTimeline")
    expect(console).not.toContain("<HybridPrompt")
    expect(console).not.toContain("<textarea")
    expect(console).toContain("captureInput=")
    expect(console).toContain("shortcuts={false}")
    expect(timeline).toContain("old.update(item.block)")
    expect(timeline).toContain("return old")
    expect(terminal).toContain("props.shortcuts === false || !isAgentManagerShortcut(event)")
    expect(terminal).toContain("committed = true")
    expect(terminal).toContain("let consumed = false")
    expect(terminal).toContain("if (consumed)")
    expect(terminal).toContain("consumed = true")
    expect(terminal).toContain("if (committed)")
    expect(terminal).not.toContain("commitEnter")
    expect(manager).toContain('msg.type === "agentManager.importFromPR"')
    expect(app).toContain("allowPR={!internal}")
    expect(dialog).toContain("props.allowPR === false")
    expect(windows).toContain('[ValidateSet("arm64-vm", "native-x64")]')
    expect(windows).toContain('[ValidateSet("default", "disabled")]')
    expect(windows).toContain("REG-AGENT-CONSOLE-SINGLE-SHELL-01")
    expect(windows).toContain("Wait-AgentConsoleInputReady")
    expect(windows).toContain('Invoke-AgentConsoleCdp -Action "wait"')
    expect(windows).toContain('Invoke-AgentConsoleCdp -Action "submit" -Value $Text')
    expect(windows).toContain("Reset-AgentConsoleCdpTarget")
    expect(windows).toContain("--target=$script:CdpTarget")
    expect(windows).toContain("$limit = (Get-Date).AddSeconds(180)")
    expect(windows).toContain("Stop-GuiSubject -Process $process")
    expect(windows).toContain("[IO.FileShare]::ReadWrite")
    expect(windows).toContain("Set-ChipMateEnglishKeyboard -Process $process")
    expect(cdp).toContain('client.call("Input.insertText", { text: value })')
    expect(cdp).toContain('type: "keyDown"')
    expect(cdp).toContain('type: "mouseWheel"')
    expect(windows).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+p' -ScriptBlock { }")
    expect(windows.indexOf("$timeoutInput =")).toBeGreaterThan(
      windows.indexOf('Invoke-ChipMateCommandPalette -Process $process -Command "Developer: Restart Extension Host"'),
    )
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
      "\x18\x01printf 'rcfile-ok\\n'\x18\x05\x18\x01PROMPT_COMMAND=()\x18\x05\x18\x01PS0=\x18\x05\x18\x01__chipmate_resync\x18\x05\x18\x01printf 'after-resync\\n'\x18\x05\x18\x01exit\x18\x05",
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

  test("captures a live Bash Readline buffer without clearing it", async () => {
    if (process.platform === "win32" || !Bun.which("expect")) return
    const token = "0123456789abcdef0123456789abcdef"
    const script = path.join(import.meta.dir, "../../assets/agent-console/bashrc")
    const program = `
      set timeout 8
      spawn bash --rcfile {${script}} -i
      expect -re "6973;${token};prompt;"
      send "\\030\\001"
      expect -re "6973;${token};ready;"
      send -- "alias cmprobe=printf"
      send "\\030\\005"
      expect -re "6973;${token};end;0;"
      send "\\030\\001"
      expect -re "6973;${token};ready;"
      send -- "cmprobe hello"
      set request "33333333333343338333333333333333"
      send "\\030\\022"
      foreach digit [split $request ""] {
        send "\\030$digit"
      }
      send "\\030\\020"
      expect -re "6973;${token};input;33333333-3333-4333-8333-333333333333;1;Y21wcm9iZSBoZWxsbw=="
      send "\\030\\031\\030\\005"
      expect -re "6973;${token};end;0;"
      send "\\030\\001"
      expect -re "6973;${token};ready;"
      expect -re "6973;${token};applied;33333333-3333-4333-8333-333333333333;agent"
      send -- "exit"
      set request "44444444444444448444444444444444"
      send "\\030\\022"
      foreach digit [split $request ""] {
        send "\\030$digit"
      }
      send "\\030\\020"
      expect -re "6973;${token};input;44444444-4444-4444-8444-444444444444;1;ZXhpdA=="
      send "\\030\\016"
      expect -re "6973;${token};applied;44444444-4444-4444-8444-444444444444;shell"
      send "\\030\\005"
      expect eof
    `
    const child = Bun.spawn(["expect", "-c", program], {
      cwd: "/tmp",
      env: {
        ...process.env,
        KILO_AGENT_CONSOLE: "1",
        KILO_AGENT_CONSOLE_TOKEN: token,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(`${stdout}\n${stderr}`).toMatch(/input;[0-9a-f-]+;1;Y21wcm9iZSBoZWxsbw==/)
    expect(code).toBe(0)
  })

  test("the packaged PowerShell integration wraps input, prompt, and recovery", () => {
    const script = fs.readFileSync(path.join(import.meta.dir, "../../assets/agent-console/powershell.ps1"), "utf8")

    expect(script).toContain("Remove-Item Env:KILO_AGENT_CONSOLE_TOKEN")
    expect(script).toContain("function global:PSConsoleHostReadLine")
    expect(script).toContain("PSReadLine\\PSConsoleHostReadLine")
    expect(script).toContain('"ready;$(__chipmate_cwd)"')
    expect(script).toContain('"begin;$(__chipmate_cwd)"')
    expect(script).toContain('"end;$Code;$(__chipmate_cwd)"')
    expect(script).toContain('"resync;$(__chipmate_cwd)"')
    expect(script).toContain("Set-PSReadLineKeyHandler -Key Enter")
    expect(script).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+e'")
    expect(script).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+a'")
    expect(script).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+h'")
    expect(script).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+y'")
    expect(script).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+n'")
    expect(script).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+r'")
    expect(script).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,0'")
    expect(script).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,f'")
    expect(script).toContain("Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+p'")
    expect(script).toContain("[WildcardPattern]::Escape($First)")
    expect(script).not.toContain("Get-Command -Name $First")
    expect(script).not.toContain("[Guid]::NewGuid().ToString()")
    expect(script).not.toContain("[Console]::ReadKey")
    expect(script).toContain('"input;$RequestId;$Known;$Encoded"')
    expect(script).toContain('"applied;$RequestId;$Route"')
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
    parser.push(`\x1b]6973;${token};ready;${cwd}\x07`)

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
    parser.push(`\x1b]6973;${token};ready;${cwd}\x07`)

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

  test("tracks PowerShell lifecycle markers with a Windows cwd", () => {
    const states: unknown[] = []
    const token = "0123456789abcdef0123456789abcdef"
    const cwd = Buffer.from("C:\\workspace\\firmware").toString("base64")
    const parser = new AgentConsoleIntegration(token, (state) => states.push(state))

    parser.push(`\x1b]6973;${token};ready;${cwd}\x07`)
    parser.push(`\x1b]6973;${token};begin;${cwd}\x07`)
    parser.push(`\x1b]6973;${token};end;1;${cwd}\x07`)
    parser.push(`\x1b]6973;${token};ready;${cwd}\x07`)

    expect(states).toEqual([
      { status: "ready", cwd: "C:\\workspace\\firmware" },
      { status: "busy", cwd: "C:\\workspace\\firmware" },
      { status: "ready", cwd: "C:\\workspace\\firmware" },
    ])
  })

  test("parses fragmented input capture markers and rejects duplicates or invalid payloads", () => {
    const inputs: unknown[] = []
    const applied: unknown[] = []
    const token = "0123456789abcdef0123456789abcdef"
    const id = "11111111-1111-4111-8111-111111111111"
    const input = Buffer.from("帮我检查 PATH").toString("base64")
    const parser = new AgentConsoleIntegration(
      token,
      () => undefined,
      () => undefined,
      (event) => inputs.push(event),
      () => undefined,
      (event) => applied.push(event),
    )

    parser.push(`\x1b]6973;${token};input;${id};0;${input.slice(0, 4)}`)
    parser.push(`${input.slice(4)}\x1b\\`)
    parser.push(`\x1b]6973;${token};input;${id};0;${input}\x07`)
    parser.push(`\x1b]6973;${token};input;22222222-2222-4222-8222-222222222222;0;\x07`)
    parser.push(`\x1b]6973;${token};input;not-a-uuid;1;%%%\x07`)
    parser.push(`\x1b]6973;${token};applied;${id};ag`)
    parser.push("ent\x1b\\")
    parser.push(`\x1b]6973;${token};applied;${id};agent\x07`)
    parser.push(`\x1b]6973;${token};applied;${id};invalid\x07`)

    expect(inputs).toEqual([
      { kind: "input", requestId: id, command: false, input: "帮我检查 PATH" },
      {
        kind: "input",
        requestId: "22222222-2222-4222-8222-222222222222",
        command: false,
        input: "",
      },
    ])
    expect(applied).toEqual([{ kind: "applied", requestId: id, route: "agent" }])
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

  test("prefers PowerShell 7 when creating a Windows Agent Console", async () => {
    const posts: AgentConsoleOutMessage[] = []
    const creates: Array<{ command?: string; args?: string[] }> = []
    const client = {
      pty: {
        shells: async () => ({
          data: [
            {
              path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              name: "powershell",
              acceptable: true,
            },
            { path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", name: "pwsh", acceptable: true },
          ],
        }),
        create: async (input: { command?: string; args?: string[] }) => {
          creates.push(input)
          return { data: { id: "pty-pwsh", title: "Shell" } }
        },
        update: async () => ({ data: true }),
        remove: async () => ({ data: true }),
      },
    }
    const terminal = new AgentConsoleTerminal({
      client: () => client as never,
      ready: async () => undefined,
      config: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      root: () => "C:\\workspace",
      rcfile: () => "C:\\extension\\bashrc",
      psfile: () => "C:\\extension\\powershell.ps1",
      platform: "win32",
      font: () => ({ fontFamily: "monospace", fontSize: 14 }),
      post: (message) => posts.push(message),
      log: () => undefined,
    })

    terminal.handle({ type: "agentConsole.terminal.create" })
    await until(() => posts.some((message) => message.type === "agentConsole.terminal.created"))
    expect(creates).toHaveLength(1)
    expect(creates[0]).toMatchObject({
      command: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      args: ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "C:\\extension\\powershell.ps1"],
    })
    await terminal.dispose()
  })

  test("falls back to Windows PowerShell 5.1", async () => {
    const posts: AgentConsoleOutMessage[] = []
    const creates: Array<{ command?: string }> = []
    const client = {
      pty: {
        shells: async () => ({
          data: [
            {
              path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              name: "powershell",
              acceptable: true,
            },
          ],
        }),
        create: async (input: { command?: string }) => {
          creates.push(input)
          return { data: { id: "pty-powershell", title: "Shell" } }
        },
        update: async () => ({ data: true }),
        remove: async () => ({ data: true }),
      },
    }
    const terminal = new AgentConsoleTerminal({
      client: () => client as never,
      ready: async () => undefined,
      config: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      root: () => "C:\\workspace",
      rcfile: () => "C:\\extension\\bashrc",
      psfile: () => "C:\\extension\\powershell.ps1",
      platform: "win32",
      font: () => ({ fontFamily: "monospace", fontSize: 14 }),
      post: (message) => posts.push(message),
      log: () => undefined,
    })

    terminal.handle({ type: "agentConsole.terminal.create" })
    await until(() => posts.some((message) => message.type === "agentConsole.terminal.created"))
    expect(creates[0]?.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
    await terminal.dispose()
  })

  test("reports missing PowerShell and structured PTY errors without object coercion", async () => {
    const run = async (shells: unknown[], error?: unknown) => {
      const posts: AgentConsoleOutMessage[] = []
      const terminal = new AgentConsoleTerminal({
        client: () =>
          ({
            pty: {
              shells: async () => ({ data: shells }),
              create: async () => (error ? { error } : { data: { id: "unused", title: "Shell" } }),
              update: async () => ({ data: true }),
              remove: async () => ({ data: true }),
            },
          }) as never,
        ready: async () => undefined,
        config: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
        root: () => "C:\\workspace",
        rcfile: () => "C:\\extension\\bashrc",
        psfile: () => "C:\\extension\\powershell.ps1",
        platform: "win32",
        font: () => ({ fontFamily: "monospace", fontSize: 14 }),
        post: (message) => posts.push(message),
        log: () => undefined,
      })
      terminal.handle({ type: "agentConsole.terminal.create" })
      await until(() => posts.some((message) => message.type === "agentConsole.terminal.error"))
      await terminal.dispose()
      return posts.find((message) => message.type === "agentConsole.terminal.error")
    }

    expect((await run([]))?.message).toContain("requires PowerShell 7")
    expect(
      (
        await run([{ path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", name: "pwsh", acceptable: true }], {
          name: "BadRequest",
          data: { message: "The system cannot find the file specified" },
        })
      )?.message,
    ).toBe("Failed to create PTY: The system cannot find the file specified")
    expect(
      (await run([{ path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", name: "pwsh", acceptable: true }], {}))
        ?.message,
    ).toBe("Failed to create PTY: Unknown PTY error")
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

    posts.length = 0
    terminal.handle({ type: "agentConsole.terminal.create" })
    await Bun.sleep(0)
    expect(calls.filter((call) => call.startsWith("create:"))).toEqual(["create:1"])
    expect(posts.map((message) => message.type)).toEqual([
      "agentConsole.terminal.created",
      "agentConsole.terminal.state",
      "agentConsole.terminal.activitySnapshot",
    ])
    expect(posts[0]).toMatchObject({ terminalId: created.terminalId, title: "Shell" })

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
          socket.send(`\x1b]6973;${token};prompt;${cwd}\x07`)
        },
        message(socket, message) {
          const cwd = Buffer.from("/workspace").toString("base64")
          if (String(message) === "\x18\x01") {
            socket.send(`\x1b]6973;${token};ready;${cwd}\x07`)
            return
          }
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
          socket.send(`\x1b]6973;${token};prompt;${Buffer.from("/workspace").toString("base64")}\x07`)
        },
        message(socket, message) {
          const data = String(message)
          writes.push(data)
          const cwd = Buffer.from("/workspace").toString("base64")
          if (data === "\x18\x01") {
            socket.send(`\x1b]6973;${token};ready;${cwd}\x07`)
            return
          }
          if (data !== "__chipmate_resync\x18\x05") return
          socket.send(`\x1b]6973;${token};resync;${cwd}\x07\x1b]6973;${token};end;0;${cwd}\x07`)
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

    expect(writes).toEqual(["\x18\x01", "\x03", "__chipmate_resync\x18\x05", "\x18\x01"])
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

  test("captures the real shell line and routes forced shell input exactly once", async () => {
    const posts: AgentConsoleOutMessage[] = []
    const writes: string[] = []
    let token = ""
    const id = "11111111-1111-4111-8111-111111111111"
    const shell = "22222222-2222-4222-8222-222222222222"
    let peer: { send(data: string): number } | undefined
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return
        return new Response("WebSocket upgrade required", { status: 426 })
      },
      websocket: {
        open(socket) {
          peer = socket
          const cwd = Buffer.from("/workspace").toString("base64")
          socket.send(`\x1b]6973;${token};prompt;${cwd}\x07`)
        },
        message(socket, message) {
          const data = String(message)
          writes.push(data)
          if (data !== "\x18\x01") return
          const cwd = Buffer.from("/workspace").toString("base64")
          socket.send(`\x1b]6973;${token};ready;${cwd}\x07`)
        },
      },
    })
    const terminal = new AgentConsoleTerminal({
      client: () =>
        ({
          pty: {
            create: async (input: { env?: Record<string, string> }) => {
              token = input.env?.KILO_AGENT_CONSOLE_TOKEN ?? ""
              return { data: { id: "pty-capture", title: "Shell" } }
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
    terminal.handle({ type: "agentConsole.input.capture", terminalId: created.terminalId, requestId: "invalid" })
    expect(posts.at(-1)).toEqual({
      type: "agentConsole.input.error",
      requestId: "invalid",
      message: "Invalid input capture request",
      stage: "capture",
      recovery: "retain",
      input: undefined,
    })
    terminal.handle({ type: "agentConsole.input.capture", terminalId: created.terminalId, requestId: id })
    const input = Buffer.from("!internal-tool --check").toString("base64")
    await until(() => writes.includes(capture(id)))
    peer?.send(`\x1b]6973;${token};input;${shell};0;${input}\x07`)
    await Bun.sleep(0)
    expect(posts.some((message) => message.type === "agentConsole.input.routed")).toBe(false)
    peer?.send(`\x1b]6973;${token};input;${id};0;${input}\x07`)
    const apply = "\x18\x15internal-tool --check\x18\x0e\x18\x05"
    await until(() => writes.includes(apply))
    expect(posts.some((message) => message.type === "agentConsole.input.routed")).toBe(false)
    peer?.send(`\x1b]6973;${token};applied;${shell};shell\x07`)
    peer?.send(`\x1b]6973;${token};applied;${id};agent\x07`)
    await Bun.sleep(0)
    expect(posts.some((message) => message.type === "agentConsole.input.routed")).toBe(false)
    peer?.send(`\x1b]6973;${token};applied;${id};shell\x07`)
    await until(() => posts.some((message) => message.type === "agentConsole.input.routed"))
    peer?.send(`\x1b]6973;${token};applied;${id};shell\x07`)
    await Bun.sleep(0)

    expect(posts.filter((message) => message.type === "agentConsole.input.routed")).toEqual([
      {
        type: "agentConsole.input.routed",
        requestId: id,
        route: "shell",
        input: "internal-tool --check",
      },
    ])
    expect(writes).toEqual(["\x18\x01", capture(id), apply])
    const agentId = "33333333-3333-4333-8333-333333333333"
    terminal.handle({ type: "agentConsole.input.capture", terminalId: created.terminalId, requestId: agentId })
    const question = Buffer.from("/agent 帮我检查环境").toString("base64")
    await until(() => writes.includes(capture(agentId)))
    peer?.send(`\x1b]6973;${token};input;${agentId};0;${question}\x07`)
    await until(() => writes.includes("\x18\x19\x18\x05"))
    expect(posts.filter((message) => message.type === "agentConsole.input.routed")).toHaveLength(1)
    peer?.send(`\x1b]6973;${token};applied;${agentId};agent\x07`)
    await until(() => posts.filter((message) => message.type === "agentConsole.input.routed").length === 2)
    expect(posts.filter((message) => message.type === "agentConsole.input.routed").at(-1)).toEqual({
      type: "agentConsole.input.routed",
      requestId: agentId,
      route: "agent",
      input: "帮我检查环境",
    })
    expect(writes).toEqual(["\x18\x01", capture(id), apply, capture(agentId), "\x18\x19\x18\x05"])
    terminal.handle({ type: "agentConsole.input.capture", terminalId: created.terminalId, requestId: id })
    expect(posts.at(-1)).toEqual({
      type: "agentConsole.input.error",
      requestId: id,
      message: "Input capture request was already completed",
      stage: "capture",
      recovery: "retain",
      input: undefined,
    })
    expect(writes).toEqual(["\x18\x01", capture(id), apply, capture(agentId), "\x18\x19\x18\x05"])
    await terminal.dispose()
    server.stop(true)
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
