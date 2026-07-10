import { describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

type VscodeMockState = {
  workspaceRoot: string
  agentTerminalEnabled: boolean
  warningChoice: string | undefined
  registeredCommands: Map<string, (...args: unknown[]) => unknown>
  executedCommands: Array<{ command: string; args: unknown[] }>
  createdTerminals: Array<{ options: Record<string, unknown>; shown: boolean; sent: string[] }>
  registeredProfileProvider?: { provideTerminalProfile: () => unknown }
}

function vscodeMockState(): VscodeMockState {
  const global = globalThis as typeof globalThis & { __kiloVscodeMockState?: VscodeMockState }
  global.__kiloVscodeMockState ??= {
    workspaceRoot: "/workspace",
    agentTerminalEnabled: false,
    warningChoice: "Enable for Workspace",
    registeredCommands: new Map(),
    executedCommands: [],
    createdTerminals: [],
  }
  return global.__kiloVscodeMockState
}

mock.module("vscode", () => ({
  ConfigurationTarget: {
    Workspace: 2,
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  commands: {
    registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => {
      vscodeMockState().registeredCommands.set(command, callback)
      return { dispose: () => vscodeMockState().registeredCommands.delete(command) }
    },
    executeCommand: (command: string, ...args: unknown[]) => {
      vscodeMockState().executedCommands.push({ command, args })
      return Promise.resolve()
    },
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => (key === "kilo.agentTerminal.enabled" ? vscodeMockState().agentTerminalEnabled : fallback),
      update: (key: string, value: unknown) => {
        if (key === "kilo.agentTerminal.enabled") vscodeMockState().agentTerminalEnabled = Boolean(value)
        return Promise.resolve()
      },
    }),
    get workspaceFolders() {
      return [{ uri: { fsPath: vscodeMockState().workspaceRoot } }]
    },
  },
  window: {
    showInputBox: () => undefined,
    showInformationMessage: () => undefined,
    showWarningMessage: () => Promise.resolve(vscodeMockState().warningChoice),
    createTerminal: (options: Record<string, unknown>) => {
      const terminal = {
        options,
        shown: false,
        sent: [] as string[],
        show: () => {
          terminal.shown = true
        },
        sendText: (text: string) => {
          terminal.sent.push(text)
        },
      }
      vscodeMockState().createdTerminals.push(terminal)
      return terminal
    },
    registerTerminalProfileProvider: (_id: string, provider: { provideTerminalProfile: () => unknown }) => {
      vscodeMockState().registeredProfileProvider = provider
      return { dispose: () => undefined }
    },
  },
  TerminalProfile: class TerminalProfile {
    options: unknown
    constructor(options: unknown) {
      this.options = options
    }
  },
}))

const { registerAgentTerminal } = await import("../../src/services/agent-terminal")

describe("agent terminal service", () => {
  test("opens a default-off sidecar terminal after workspace confirmation", async () => {
    const state = vscodeMockState()
    state.workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-agent-terminal-service-"))
    await fs.writeFile(path.join(state.workspaceRoot, "package.json"), JSON.stringify({ name: "demo", scripts: { build: "make" } }))
    state.agentTerminalEnabled = false
    state.warningChoice = "Enable for Workspace"
    state.registeredCommands.clear()
    state.createdTerminals.length = 0
    state.registeredProfileProvider = undefined

    const context = { subscriptions: [] as Array<{ dispose: () => void }> }
    registerAgentTerminal(context as never)

    await state.registeredCommands.get("kilo-code.new.agentTerminal.open")?.()

    expect(state.agentTerminalEnabled).toBe(true)
    expect(state.createdTerminals).toHaveLength(1)
    expect(state.createdTerminals[0]?.options).toMatchObject({
      name: "Kilo Agent Terminal",
      cwd: state.workspaceRoot,
      env: {
        KILO_AGENT_TERMINAL: "1",
      },
    })
    expect(state.createdTerminals[0]?.shown).toBe(true)
    expect(state.createdTerminals[0]?.sent[0]).toContain("kilo_agent_intro")
    expect(await fs.readFile(path.join(state.workspaceRoot, ".kilo", "agent-terminal", "agent-terminal.sh"), "utf8")).toContain("kilo_run_checked")
    expect(await fs.readFile(path.join(state.workspaceRoot, ".kilo", "agent-terminal", "context.md"), "utf8")).toContain("Package: demo")

    const profile = (await state.registeredProfileProvider?.provideTerminalProfile()) as { options?: Record<string, unknown> } | undefined
    expect(profile?.options).toMatchObject({
      name: "Kilo Agent Terminal",
      cwd: state.workspaceRoot,
      env: {
        KILO_AGENT_TERMINAL: "1",
      },
    })
  })

  test("does not open a terminal when the default-off prompt is cancelled", async () => {
    const state = vscodeMockState()
    state.workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-agent-terminal-cancel-"))
    state.agentTerminalEnabled = false
    state.warningChoice = "Cancel"
    state.registeredCommands.clear()
    state.createdTerminals.length = 0

    const context = { subscriptions: [] as Array<{ dispose: () => void }> }
    registerAgentTerminal(context as never)

    await state.registeredCommands.get("kilo-code.new.agentTerminal.open")?.()

    expect(state.agentTerminalEnabled).toBe(false)
    expect(state.createdTerminals).toHaveLength(0)
  })
})
