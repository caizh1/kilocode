import type { TerminalFont } from "../agent-manager/types"

export type AgentConsoleMode = "agent" | "shell"

export type AgentConsoleInMessage =
  | { type: "agentConsole.terminal.create" }
  | { type: "agentConsole.terminal.resize"; terminalId: string; cols: number; rows: number }
  | { type: "agentConsole.terminal.close"; terminalId: string }
  | { type: "agentConsole.shell.restart" }
  | { type: "agentConsole.session.new" }
  | { type: "agentConsole.mode.changed"; mode: AgentConsoleMode }
  | { type: "agentConsole.input.route"; requestId: string; input: string }

export type AgentConsoleOutMessage =
  | {
      type: "agentConsole.terminal.created"
      terminalId: string
      title: string
      wsUrl: string
      font: TerminalFont
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

export function isAgentConsoleMessage(message: unknown): message is AgentConsoleInMessage {
  if (!message || typeof message !== "object") return false
  const type = (message as { type?: unknown }).type
  return typeof type === "string" && type.startsWith("agentConsole.")
}
