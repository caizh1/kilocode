import type { TerminalFont } from "../agent-manager/types"
import type { AgentConsoleShellState } from "./integration"

export type AgentConsoleMode = "agent" | "shell"

export type AgentConsoleRunSource = "direct" | "agent"

export type AgentConsoleInputStage = "capture" | "route" | "apply"

export type AgentConsoleInputRecovery = "retain" | "archive"

export type AgentConsoleActivityEvent = {
  seq: number
  time: number
  kind: "idle" | "begin" | "data" | "end"
  data?: string
  cwd?: string
  exitCode?: number
  runId?: string
  source?: AgentConsoleRunSource
  callId?: string
  command?: string
}

export type AgentConsoleInMessage =
  | { type: "agentConsole.terminal.create" }
  | { type: "agentConsole.terminal.connect"; terminalId: string }
  | { type: "agentConsole.terminal.write"; terminalId: string; data: string }
  | { type: "agentConsole.terminal.recover"; terminalId: string }
  | { type: "agentConsole.terminal.disconnect"; terminalId: string }
  | { type: "agentConsole.terminal.resize"; terminalId: string; cols: number; rows: number }
  | { type: "agentConsole.terminal.close"; terminalId: string }
  | {
      type: "agentConsole.terminal.diagnostic"
      terminalId: string
      event: "connecting" | "open" | "error" | "close" | "send-skipped" | "input-gate" | "route-timeout"
      detail?: string
    }
  | { type: "agentConsole.shell.restart" }
  | { type: "agentConsole.session.new" }
  | { type: "agentConsole.mode.changed"; mode: AgentConsoleMode }
  | { type: "agentConsole.input.capture"; terminalId: string; requestId: string }
  | {
      type: "agentConsole.command.expect"
      terminalId: string
      runId: string
      source: AgentConsoleRunSource
      command: string
      callId?: string
    }
  | { type: "agentConsole.command.cancel"; terminalId: string; runId: string }

export type AgentConsoleOutMessage =
  | {
      type: "agentConsole.terminal.created"
      terminalId: string
      title: string
      font: TerminalFont
    }
  | { type: "agentConsole.terminal.connected"; terminalId: string }
  | { type: "agentConsole.terminal.data"; terminalId: string; data: string }
  | { type: "agentConsole.terminal.activity"; terminalId: string; event: AgentConsoleActivityEvent }
  | {
      type: "agentConsole.terminal.activitySnapshot"
      terminalId: string
      events: AgentConsoleActivityEvent[]
      throughSeq: number
    }
  | { type: "agentConsole.terminal.state"; terminalId: string; state: AgentConsoleShellState }
  | {
      type: "agentConsole.terminal.recovery"
      terminalId: string
      success: boolean
      message?: string
    }
  | { type: "agentConsole.terminal.relayError"; terminalId: string; message: string }
  | {
      type: "agentConsole.terminal.disconnected"
      terminalId: string
      code: number
      reason: string
    }
  | { type: "agentConsole.terminal.closed"; terminalId: string }
  | { type: "agentConsole.terminal.error"; terminalId?: string; message: string }
  | { type: "agentConsole.terminal.fontChanged"; font: TerminalFont }
  | {
      type: "agentConsole.input.routed"
      requestId: string
      route: "agent" | "shell"
      input: string
    }
  | {
      type: "agentConsole.input.error"
      requestId: string
      message: string
      stage: AgentConsoleInputStage
      recovery: AgentConsoleInputRecovery
      input?: string
    }

export function isAgentConsoleMessage(message: unknown): message is AgentConsoleInMessage {
  if (!message || typeof message !== "object") return false
  const type = (message as { type?: unknown }).type
  return typeof type === "string" && type.startsWith("agentConsole.")
}
