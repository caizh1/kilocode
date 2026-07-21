import type { useVSCode } from "../src/context/vscode"
import type { TerminalSocket } from "../agent-manager/terminal/TerminalTab"

type VSCode = Pick<ReturnType<typeof useVSCode>, "onMessage" | "postMessage">

export class AgentConsoleSocket implements TerminalSocket {
  binaryType: BinaryType = "arraybuffer"
  readyState: number = WebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  private readonly dispose: () => void
  private closed = false

  constructor(
    private readonly vscode: VSCode,
    private readonly id: string,
  ) {
    this.dispose = vscode.onMessage((message) => {
      if (!("terminalId" in message) || message.terminalId !== id) return
      if (message.type === "agentConsole.terminal.connected") {
        this.readyState = WebSocket.OPEN
        this.onopen?.(new Event("open"))
        return
      }
      if (message.type === "agentConsole.terminal.data") {
        this.onmessage?.(new MessageEvent("message", { data: message.data }))
        return
      }
      if (message.type === "agentConsole.terminal.relayError") {
        this.readyState = WebSocket.CLOSED
        this.onerror?.(new CustomEvent("error", { detail: message.message }))
        return
      }
      if (message.type !== "agentConsole.terminal.disconnected") return
      this.closed = true
      this.readyState = WebSocket.CLOSED
      this.dispose()
      this.onclose?.(
        new CloseEvent("close", {
          code: message.code,
          reason: message.reason,
          wasClean: message.code === 1000,
        }),
      )
    })
    queueMicrotask(() => {
      if (this.closed) return
      vscode.postMessage({ type: "agentConsole.terminal.connect", terminalId: id })
    })
  }

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) return
    this.vscode.postMessage({ type: "agentConsole.terminal.write", terminalId: this.id, data })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.readyState = WebSocket.CLOSED
    this.dispose()
    this.vscode.postMessage({ type: "agentConsole.terminal.disconnect", terminalId: this.id })
  }
}
