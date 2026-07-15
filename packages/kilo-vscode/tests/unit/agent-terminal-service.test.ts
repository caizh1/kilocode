import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as vscode from "vscode"
import { registerAgentTerminal } from "../../src/services/agent-terminal"

type State = {
  workspaceRoot: string
  agentTerminalEnabled: boolean
  warningChoice: string | undefined
  registeredCommands: Map<string, (...args: unknown[]) => unknown>
  createdTerminals: Array<{ options: Record<string, unknown>; shown: boolean; sent: string[] }>
  registeredProfileProvider?: vscode.TerminalProfileProvider
}

const original = {
  commands: vscode.commands.registerCommand,
  config: vscode.workspace.getConfiguration,
  folders: vscode.workspace.workspaceFolders,
  terminal: vscode.window.createTerminal,
  profile: vscode.window.registerTerminalProfileProvider,
  warning: vscode.window.showWarningMessage,
}

afterEach(() => {
  ;(vscode.commands as unknown as { registerCommand: typeof original.commands }).registerCommand = original.commands
  ;(vscode.workspace as unknown as { getConfiguration: typeof original.config }).getConfiguration = original.config
  ;(vscode.workspace as unknown as { workspaceFolders: typeof original.folders }).workspaceFolders = original.folders
  ;(vscode.window as unknown as { createTerminal: typeof original.terminal }).createTerminal = original.terminal
  ;(
    vscode.window as unknown as { registerTerminalProfileProvider: typeof original.profile }
  ).registerTerminalProfileProvider = original.profile
  ;(vscode.window as unknown as { showWarningMessage: typeof original.warning }).showWarningMessage = original.warning
})

function state(): State {
  return {
    workspaceRoot: "/workspace",
    agentTerminalEnabled: false,
    warningChoice: "Enable for Workspace",
    registeredCommands: new Map(),
    createdTerminals: [],
  }
}

function install(value: State) {
  ;(vscode.commands as unknown as { registerCommand: typeof original.commands }).registerCommand = (
    command: string,
    callback: (...args: unknown[]) => unknown,
  ) => {
    value.registeredCommands.set(command, callback)
    return { dispose: () => value.registeredCommands.delete(command) }
  }
  ;(vscode.workspace as unknown as { getConfiguration: typeof original.config }).getConfiguration = () =>
    ({
      get: (key: string, fallback: unknown) =>
        key === "kilo.agentTerminal.enabled" ? value.agentTerminalEnabled : fallback,
      update: async (key: string, next: unknown) => {
        if (key === "kilo.agentTerminal.enabled") value.agentTerminalEnabled = Boolean(next)
      },
    }) as vscode.WorkspaceConfiguration
  ;(vscode.workspace as unknown as { workspaceFolders: vscode.WorkspaceFolder[] }).workspaceFolders = [
    { uri: { fsPath: value.workspaceRoot } } as vscode.WorkspaceFolder,
  ]
  ;(vscode.window as unknown as { showWarningMessage: typeof original.warning }).showWarningMessage = async () =>
    value.warningChoice
  ;(vscode.window as unknown as { createTerminal: typeof original.terminal }).createTerminal = (options) => {
    const terminal = {
      options: options as Record<string, unknown>,
      shown: false,
      sent: [] as string[],
      show: () => {
        terminal.shown = true
      },
      sendText: (text: string) => {
        terminal.sent.push(text)
      },
    }
    value.createdTerminals.push(terminal)
    return terminal as unknown as vscode.Terminal
  }
  ;(
    vscode.window as unknown as { registerTerminalProfileProvider: typeof original.profile }
  ).registerTerminalProfileProvider = (_id, provider) => {
    value.registeredProfileProvider = provider
    return { dispose: () => undefined }
  }
}

describe("agent terminal service", () => {
  test("opens Agent Console while keeping the legacy terminal profile", async () => {
    const value = state()
    value.workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-agent-terminal-service-"))
    await fs.writeFile(
      path.join(value.workspaceRoot, "package.json"),
      JSON.stringify({ name: "demo", scripts: { build: "make" } }),
    )
    install(value)
    let opens = 0

    const context = { subscriptions: [] as Array<{ dispose: () => void }> }
    registerAgentTerminal(context as never, () => opens++)

    await value.registeredCommands.get("kilo-code.new.agentTerminal.open")?.()

    expect(opens).toBe(1)
    expect(value.agentTerminalEnabled).toBe(false)
    expect(value.createdTerminals).toHaveLength(0)

    value.agentTerminalEnabled = true
    const profile = (await value.registeredProfileProvider?.provideTerminalProfile(undefined)) as
      | { options?: Record<string, unknown> }
      | undefined
    expect(
      await fs.readFile(path.join(value.workspaceRoot, ".kilo", "agent-terminal", "agent-terminal.sh"), "utf8"),
    ).toContain("kilo_run_checked")
    expect(
      await fs.readFile(path.join(value.workspaceRoot, ".kilo", "agent-terminal", "context.md"), "utf8"),
    ).toContain("Package: demo")
    expect(profile?.options).toMatchObject({
      name: "Kilo Agent Terminal (Legacy)",
      cwd: value.workspaceRoot,
      env: { KILO_AGENT_TERMINAL: "1" },
    })
  })

  test("does not create the legacy profile when its default-off prompt is cancelled", async () => {
    const value = state()
    value.workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-agent-terminal-cancel-"))
    value.warningChoice = "Cancel"
    install(value)

    const context = { subscriptions: [] as Array<{ dispose: () => void }> }
    registerAgentTerminal(context as never, () => undefined)
    const profile = await value.registeredProfileProvider?.provideTerminalProfile(undefined)

    expect(value.agentTerminalEnabled).toBe(false)
    expect(value.createdTerminals).toHaveLength(0)
    expect(profile).toBeUndefined()
  })
})
