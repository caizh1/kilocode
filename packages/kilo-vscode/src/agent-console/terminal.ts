import type { KiloClient } from "@kilocode/sdk/v2/client"
import { TerminalManager } from "../agent-manager/terminal-manager"
import type { TerminalFont } from "../agent-manager/types"
import type { AgentConsoleInMessage, AgentConsoleOutMessage } from "./types"
import { routeAgentConsoleInput } from "./input"

interface Config {
  baseUrl: string
  password: string
}

interface Deps {
  client(): KiloClient
  config(): Config | undefined
  root(): string | undefined
  font(): TerminalFont
  post(message: AgentConsoleOutMessage): void
  log(message: string): void
}

export class AgentConsoleTerminal {
  private readonly manager: TerminalManager
  private current: string | undefined
  private pending: Promise<void> | undefined

  constructor(private readonly deps: Deps) {
    this.manager = new TerminalManager({
      getClient: deps.client,
      buildWsUrl: (id, dir) => this.url(id, dir),
      log: (message) => deps.log(String(message)),
    })
  }

  handle(message: AgentConsoleInMessage): boolean {
    if (message.type === "agentConsole.terminal.create") {
      void this.create()
      return true
    }
    if (message.type === "agentConsole.shell.restart") {
      void this.restart()
      return true
    }
    if (message.type === "agentConsole.terminal.close") {
      void this.close(message.terminalId)
      return true
    }
    if (message.type === "agentConsole.terminal.resize") {
      void this.manager.resize(message.terminalId, message.cols, message.rows)
      return true
    }
    if (message.type === "agentConsole.input.route") {
      void this.route(message.requestId, message.input)
      return true
    }
    return message.type === "agentConsole.session.new" || message.type === "agentConsole.mode.changed"
  }

  dispose(): Promise<void> {
    this.current = undefined
    return this.manager.dispose()
  }

  private create(): Promise<void> {
    if (this.current) return Promise.resolve()
    if (this.pending) return this.pending
    const root = this.deps.root()
    if (!root) {
      this.deps.post({ type: "agentConsole.terminal.error", message: "Open a folder before creating a shell." })
      return Promise.resolve()
    }
    this.pending = this.manager
      .create({ worktreeId: null, cwd: root, title: "Shell" })
      .then((created) => {
        this.current = created.terminalId
        this.deps.post({
          type: "agentConsole.terminal.created",
          terminalId: created.terminalId,
          title: created.title,
          wsUrl: created.wsUrl,
          font: this.deps.font(),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.deps.log(`Shell create failed: ${message}`)
        this.deps.post({ type: "agentConsole.terminal.error", message })
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }

  private async close(id: string): Promise<void> {
    await this.manager.close(id)
    if (this.current === id) this.current = undefined
    this.deps.post({ type: "agentConsole.terminal.closed", terminalId: id })
  }

  private async restart(): Promise<void> {
    const id = this.current
    if (id) await this.close(id)
    await this.create()
  }

  private async route(requestId: string, input: string): Promise<void> {
    const routed = await routeAgentConsoleInput(input)
    this.deps.post({ type: "agentConsole.input.routed", requestId, ...routed })
  }

  private url(id: string, dir: string): string {
    const config = this.deps.config()
    if (!config) throw new Error("Not connected to CLI backend")
    const base = config.baseUrl.replace(/^http/i, "ws")
    const token = Buffer.from(`kilo:${config.password}`).toString("base64")
    return `${base}/pty/${encodeURIComponent(id)}/connect?directory=${encodeURIComponent(dir)}&cursor=-1&auth_token=${encodeURIComponent(token)}`
  }
}
